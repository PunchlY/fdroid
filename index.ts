#!/usr/bin/env bun
import Type from "typebox";
import { StaticDecode } from "typebox";
import Value from "typebox/value";
import Schema from "typebox/schema";
import PQueue from "p-queue";
import { Octokit } from "octokit";
import { DownloadEngineNodejs, downloadFile, downloadSequence } from "ipull";
import { basename } from "node:path";
import { link, rm } from "node:fs/promises";
import { parseArgs } from "node:util";

namespace Schemas {
  export const args = Type.Object({
    config: Type.String(),
  });

  const strRegexp = Type.Codec(
    Type.String({ pattern: "^/.+/[dgimsuvy]*$" }),
  )
    .Decode((value) => {
      const match = value.match(/^\/(.+)\/([dgimsuvy]*)$/s)!;
      return new RegExp(match[1], match[2]);
    })
    .Encode((value) => value.toString());

  export const meta = Type.Partial(Type.Object({
    author: Type.String(),
    email: Type.String({ format: "uri" }),
    license: Type.String(),
    website: Type.String({ format: "uri" }),
    source: Type.String({ format: "uri" }),
    issue: Type.String({ format: "uri" }),
    changelogUrl: Type.String({ format: "uri" }),
    changelog: Type.String(),
    summary: Type.String(),
    categories: Type.Array(Type.String()),
  }));

  const filter = Type.Partial(Type.Object({
    filter: Type.Union([
      strRegexp,
      Type.Array(Type.String()),
    ]),
  }));

  export const github = Type.Interface([meta, filter], {
    type: Type.Literal("github"),
    owner: Type.String(),
    repo: Type.String(),
    tag: Type.Optional(Type.String()),
    preRelease: Type.Optional(Type.Boolean({ default: false })),
  });

  export const http = Type.Interface([meta, filter], {
    type: Type.Literal("http"),
    url: Type.String({ format: "uri" }),
    ids: Type.Optional(Type.Array(Type.String())),
  });

  export const config = Type.Union([github, http]);
}

namespace Pattern {
  export const github = new URLPattern("github::owner/:repo");
}

const values = Schema.Parse(
  Schemas.args,
  parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: "string" },
    },
  }).values,
);

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const queue = new PQueue();

async function mkMetadata(metadata: StaticDecode<typeof Schemas.meta>) {
  const github = Pattern.github.exec(metadata.source)
    ?.pathname.groups as { owner: string; repo: string } | undefined;
  if (github) {
    const { data: repoData } = await octokit.rest.repos.get(github);
    const { data: ownerData } = await octokit.rest.users.getById({
      account_id: repoData.owner.id,
    });
    return {
      author: ownerData.name || ownerData.login,
      email: ownerData.email || undefined,
      license: repoData.license?.spdx_id || undefined,
      website: repoData.homepage
        ? URL.parse(repoData.homepage)?.href
        : undefined,
      issue: repoData.has_issues ? `${repoData.html_url}/issues` : undefined,
      changelogUrl: `${repoData.html_url}/releases`,
      summary: repoData.description || undefined,
      ...metadata,
      source: repoData.html_url,
    };
  }
  return metadata;
}

const packages = new Map<
  DownloadEngineNodejs,
  Awaited<ReturnType<typeof mkMetadata>> & { url: string }
>();

function subst(input: string, args: Record<string, string>) {
  const names = Object.keys(args)
    .map((key) => RegExp.escape(key))
    .join("|");
  return input.replace(
    new RegExp(`\\$(${names})|\\$\{(${names})}`),
    (sub, name0, name = name0) => Object.hasOwn(args, name) ? args[name] : sub,
  );
}

function callFilter(
  filter: RegExp | string[] | undefined,
  name: string,
  args: Record<string, string>,
) {
  return filter === undefined
    ? true
    : filter instanceof RegExp
    ? filter.test(name)
    : filter.some((value) => subst(value, args) === name);
}

for await (
  const path of new Bun.Glob("*.yaml").scan({
    cwd: values.config,
    absolute: true,
  })
) {
  const config = Value.Decode(Schemas.config, await import(path));
  switch (config.type) {
    case "github":
      queue.add(async () => {
        const { owner, repo, tag, preRelease, filter } = config;
        const { data } = tag
          ? await octokit.rest.repos
            .getReleaseByTag({
              owner,
              repo,
              tag,
            })
          : preRelease
          ? await octokit.rest.repos
            .listReleases({
              owner,
              repo,
            })
          : await octokit.rest.repos
            .getLatestRelease({
              owner,
              repo,
            });
        const release = Array.isArray(data)
          ? data.find(({ draft }) => !draft)
          : data;

        if (!release) {
          return;
        }

        const metadata = await mkMetadata({
          source: `github:${owner}/${repo}`,
          changelog: release.body || undefined,
          ...config,
        });

        for (const asset of release.assets) {
          if (
            asset.content_type !== "application/vnd.android.package-archive"
          ) {
            continue;
          }
          if (
            !callFilter(filter, asset.name, {
              tag_name: release.tag_name,
            })
          ) {
            continue;
          }
          const url = asset.browser_download_url;
          packages.set(
            await downloadFile({
              url,
              fileName: [
                "gh",
                owner,
                repo,
                release.tag_name,
                asset.id,
                asset.name,
              ].join("_"),
              directory: ".cache",
              skipExisting: true,
            }),
            { ...metadata, url },
          );
        }
      });
      break;
    case "http":
      queue.add(async () => {
        const {
          url,
          ids = [Bun.randomUUIDv5(url, "url").replaceAll("-", "")],
        } = config;
        const fileName = basename(
          Bun.fileURLToPath(new URL(new URL(url).pathname, "file:")),
        );
        packages.set(
          await downloadFile({
            url,
            fileName: [
              "http",
              ...ids,
              fileName,
            ].join("_"),
            directory: ".cache",
            skipExisting: true,
          }),
          { ...await mkMetadata(config), url },
        );
      });
      break;
  }
}

queue.start();
await queue.onIdle();

const downloader = await downloadSequence({
  cliProgress: true,
}, ...packages.keys());

await downloader.download();

const redirects = Bun.file("./fdroid/_redirects").writer();

for await (const [pkg, meta] of packages) {
  const [info]: [{
    package: string;
    VersionCode: number;
    VersionName: string;
    AppName: string;
    AppIcon: string;
  }] = await Bun
    .$`APKEditor info -t json -i ${pkg.finalFileAbsolutePath} -package -app-name -app-icon -version-code -version-name`
    .json();

  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(pkg.finalFileAbsolutePath).stream()) {
    hasher.update(chunk);
  }
  const hash = hasher.digest("hex").slice(0, 8);
  const packageFile = `${info.package}.${info.VersionCode}.${hash}.apk`;

  await link(pkg.finalFileAbsolutePath, `./fdroid/repo/${packageFile}`);

  await redirects.write(`/repo/${packageFile} ${meta.url}\n`);

  await Bun.file(`fdroid/metadata/${info.package}.yml`)
    .write(Bun.YAML.stringify(
      {
        Name: info.AppName,
        AuthorName: meta.author,
        AuthorEmail: meta.email,
        License: meta.license,
        WebSite: meta.website,
        SourceCode: meta.source,
        IssueTracker: meta.issue,
        Changelog: meta.changelogUrl,
        Summary: meta.summary,
        Categories: meta.categories,
      },
      null,
      2,
    ));
  if (meta.changelog) {
    await Bun.file(
      `fdroid/metadata/${info.package}/en-US/changelogs/${info.VersionCode}.txt`,
    ).write(meta.changelog);
  }
}

await redirects.end();

await Bun.$`fdroid update --use-date-from-apk --delete-unknown --pretty`
  .cwd("fdroid");

const apkcache = await Bun.file("./fdroid/tmp/apkcache.json").json();
await Bun.write(
  "./fdroid/tmp/apkcache.json",
  JSON.stringify(
    {
      METADATA_VERSION: apkcache.METADATA_VERSION,
      allow_disabled_algorithms: apkcache.allow_disabled_algorithms,
      ...Object.fromEntries(
        Iterator.from(new Bun.Glob("*.apk").scanSync("fdroid/repo"))
          .filter((name) => name in apkcache)
          .map((name) => [name, apkcache[name]]),
      ),
    },
    null,
    2,
  ),
);

const packagesFile = new Set(
  packages.keys()
    .map(({ finalFileAbsolutePath }) => finalFileAbsolutePath),
);
for await (
  const name of new Bun.Glob("**/*").scan({
    cwd: ".cache",
    absolute: true,
    onlyFiles: true,
  })
) {
  if (packagesFile.has(name)) {
    continue;
  }
  await rm(name);
}
