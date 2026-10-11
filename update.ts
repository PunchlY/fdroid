import { Octokit } from "octokit";
import type { components } from "@octokit/openapi-types";
import type { DownloadEngineNodejs } from "ipull";
import { downloadFile, downloadSequence } from "ipull";
import { readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const downloads = new Set<DownloadEngineNodejs>();

const redirects = new Map<string, string>();

const metadatas = new Map<string, Record<string, any>>();

async function gh(cfg: {
  owner: string;
  repo: string;
  tag?: string;
  preRelease?: boolean;
  filter?:
    | string
    | RegExp
    | ((name: string, release: components["schemas"]["release"]) => boolean);
}) {
  const filter = cfg.filter ?? /(?:)/;

  const { data: repo } = await octokit.rest.repos.get({
    owner: cfg.owner,
    repo: cfg.repo,
  });
  const { data: author } = await octokit.rest.users.getById({
    account_id: repo.owner.id,
  });

  let release;
  if (cfg.tag) {
    const { data } = await octokit.rest.repos.getReleaseByTag({
      owner: cfg.owner,
      repo: cfg.repo,
      tag: cfg.tag,
    });
    release = data;
  } else if (cfg.preRelease) {
    const { data: releases } = await octokit.rest.repos.listReleases({
      owner: cfg.owner,
      repo: cfg.repo,
    });
    release = releases.find(({ draft }) => !draft);
    if (!release) return;
  } else {
    const { data } = await octokit.rest.repos.getLatestRelease({
      owner: cfg.owner,
      repo: cfg.repo,
    });
    release = data;
  }

  for (const asset of release.assets) {
    if (asset.content_type !== "application/vnd.android.package-archive") {
      continue;
    }
    if (
      typeof filter === "string"
        ? asset.name === filter
        : filter instanceof RegExp
        ? !filter.test(asset.name)
        : !filter(asset.name, release)
    ) {
      continue;
    }
    const url = asset.browser_download_url;
    const fileName = `${Bun.randomUUIDv5(url, "url", "hex")}.apk`;
    redirects.set(`/${fileName}`, url);
    metadatas.set(`/${fileName}`, {
      AuthorName: author.name || undefined,
      AuthorEmail: author.email || undefined,
      License: repo.license?.spdx_id || undefined,
      WebSite: repo.homepage || undefined,
      SourceCode: repo.html_url,
      IssueTracker: repo.has_issues ? `${repo.html_url}/issues` : undefined,
      Changelog: `${repo.html_url}/releases`,
      Summary: repo.description || undefined,
      Categories: [],
    });
    downloads.add(
      await downloadFile({
        url,
        fileName,
        directory: "fdroid/repo",
        skipExisting: true,
      }),
    );
  }
}

await Promise.all([
  gh({
    owner: "open-ani",
    repo: "animeko",
    filter: /universal\.apk$/,
  }),
  gh({
    owner: "deretame",
    repo: "Breeze",
  }),
  gh({
    owner: "HapeLee",
    repo: "legado-with-MD3",
    preRelease: true,
    filter: (name, release) => name === `legado-${release.tag_name}.apk`,
  }),
  gh({
    owner: "bggRGjQaUbCoE",
    repo: "PiliPlus",
  }),
  gh({
    owner: "SlotSun",
    repo: "dart_simple_live",
  }),
  gh({
    owner: "cwuom",
    repo: "NeriPlayer",
  }),
  gh({
    owner: "zzc10086",
    repo: "TiebaLite",
    preRelease: true,
  }),
  gh({
    owner: "NihilDigit",
    repo: "bilby",
    filter: /universal\.apk$/,
  }),
  gh({
    owner: "Nekogram",
    repo: "Nekogram",
    filter: /universal\.apk$/,
  }),
  gh({
    owner: "Miuzarte",
    repo: "ScrcpyForAndroid",
    filter: /universal-release\.apk$/,
  }),
  gh({
    owner: "Bumblebee202111",
    repo: "doubean-public",
  }),
  gh({
    owner: "zly2006",
    repo: "zhihu-plus-plus",
    filter: /^zhihu\+\+-lite\.apk$/,
  }),
  gh({
    owner: "liuchuancong",
    repo: "pure_live",
  }),
  gh({
    owner: "Predidit",
    repo: "Kazumi",
  }),
  gh({
    owner: "ReSukiSU",
    repo: "ReSukiSU",
    preRelease: true,
    filter: /universal-release\.apk$/,
  }),
  gh({
    owner: "Droid-Deck",
    repo: "DroidDeck",
    filter: (name, release) => name === `DroidDeck-${release.tag_name}.apk`,
  }),
  gh({
    owner: "YuKongA",
    repo: "ghostlock-app",
    tag: "pre-release",
  }),
  gh({
    owner: "HmnDev-Tech",
    repo: "shevery",
  }),
  gh({
    owner: "ChaoMixian",
    repo: "vFlow",
    filter: "app-universal-release.apk",
  }),
]);

const downloader = await downloadSequence(
  {
    cliProgress: true,
  },
  ...downloads,
);

await downloader.download();

await rm("fdroid/repo/icons/icon.png");

Bun.spawnSync([
  "fdroid",
  "update",
  "--create-metadata",
  "--use-date-from-apk",
  "--pretty",
], {
  cwd: "fdroid",
  stdout: "inherit",
  stderr: "inherit",
});

const { packages } = await import("./fdroid/repo/index-v2.json");

const files = new Set<string>();

for (const [packageName, { versions }] of Object.entries(packages)) {
  for (const { file } of Object.values(versions)) {
    if (!metadatas.has(file.name)) {
      continue;
    }
    files.add(file.name);
    metadatas.set(packageName, metadatas.get(file.name)!);
  }
}

await Bun.file("fdroid/_redirects").write(
  files.values()
    .map((name) => `${join("/repo", name)} ${redirects.get(name)}`)
    .toArray()
    .join("\n"),
);

const apkcache = await import("./fdroid/tmp/apkcache.json");
await Bun.file("./fdroid/tmp/apkcache.json").write(
  JSON.stringify({
    METADATA_VERSION: apkcache.METADATA_VERSION,
    allow_disabled_algorithms: apkcache.allow_disabled_algorithms,
    ...Object.fromEntries(
      await Array.fromAsync(async function* () {
        for await (const name of new Bun.Glob("*.apk").scan("fdroid/repo")) {
          if (name in apkcache) {
            // @ts-ignore
            yield [name, apkcache[name]];
          }
        }
      }()),
    ),
  }),
);

for await (const path of new Bun.Glob("fdroid/metadata/*.yml").scan()) {
  const packageName = basename(path, ".yml");
  if (!metadatas.has(packageName)) {
    continue;
  }
  await Bun.file(path).write(
    Bun.YAML.stringify(
      {
        ...Bun.YAML.parse(await readFile(path, "utf-8"))!,
        ...metadatas.get(packageName),
      },
      null,
      2,
    )!,
  );
}

Bun.spawnSync([
  "fdroid",
  "update",
  "--use-date-from-apk",
  "--pretty",
], {
  cwd: "fdroid",
  stdout: "inherit",
  stderr: "inherit",
});
