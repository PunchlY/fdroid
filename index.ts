import type { components } from "@octokit/openapi-types";
import type { DownloadEngineNodejs } from "ipull";
import { downloadFile, downloadSequence } from "ipull";
import { Octokit } from "octokit";
import PQueue from "p-queue";
import { basename } from "node:path";

type Filter<T extends any[]> =
  | string
  | string[]
  | RegExp
  | ((name: string, ...args: T) =>
    | string
    | string[]
    | RegExp
    | boolean);

function callFilter<T extends any[]>(
  call: Filter<T> | undefined,
  name: string,
  ...args: T
) {
  const filter = typeof call === "function" ? call(name, ...args) : call;
  return typeof filter === "string"
    ? name === filter
    : filter instanceof RegExp
    ? filter.test(name)
    : Array.isArray(filter)
    ? filter.includes(name)
    : filter ?? true;
}

interface Metadata {
  url: string;
  author?: string;
  email?: string;
  license?: string;
  website?: string;
  source?: string;
  issue?: string;
  changelogUrl?: string;
  changelog?: string;
  summary?: string;
  categories?: [];
}

export class Fdroid {
  #octokit = new Octokit();
  octokit(...args: ConstructorParameters<typeof Octokit>) {
    this.#octokit = new Octokit(...args);
    return this;
  }

  #queue = new PQueue({ concurrency: 1 });

  #packages = new Map<DownloadEngineNodejs, Metadata>();

  gh(cfg: {
    owner: string;
    repo: string;
    tag?: string;
    preRelease?: boolean;
    filter?: Filter<[components["schemas"]["release"]]>;
  }) {
    this.#queue.add(async () => {
      const { data: repo } = await this.#octokit.rest.repos.get({
        owner: cfg.owner,
        repo: cfg.repo,
      });
      const { data: author } = await this.#octokit.rest.users.getById({
        account_id: repo.owner.id,
      });

      let release;
      if (cfg.tag) {
        const { data } = await this.#octokit.rest.repos.getReleaseByTag({
          owner: cfg.owner,
          repo: cfg.repo,
          tag: cfg.tag,
        });
        release = data;
      } else if (cfg.preRelease) {
        const { data: releases } = await this.#octokit.rest.repos.listReleases({
          owner: cfg.owner,
          repo: cfg.repo,
        });
        release = releases.find(({ draft }) => !draft);
        if (!release) return;
      } else {
        const { data } = await this.#octokit.rest.repos.getLatestRelease({
          owner: cfg.owner,
          repo: cfg.repo,
        });
        release = data;
      }

      const metadata: Omit<Metadata, "url"> = {
        author: author.name || author.login,
        email: author.email || undefined,
        license: repo.license?.spdx_id || undefined,
        website: repo.homepage ? URL.parse(repo.homepage)?.href : undefined,
        source: repo.html_url,
        issue: repo.has_issues ? `${repo.html_url}/issues` : undefined,
        changelogUrl: `${repo.html_url}/releases`,
        changelog: release.body ? Bun.markdown.html(release.body) : undefined,
        summary: repo.description || undefined,
        categories: [],
      };

      for (const asset of release.assets) {
        if (asset.content_type !== "application/vnd.android.package-archive") {
          continue;
        }
        if (!callFilter(cfg.filter, asset.name, release)) {
          continue;
        }
        const url = asset.browser_download_url;
        this.#packages.set(
          await downloadFile({
            url,
            fileName: `${Bun.randomUUIDv5(url, "url", "hex")}.apk`,
            directory: ".cache",
            skipExisting: true,
          }),
          { ...metadata, url },
        );
      }
    });
    return this;
  }

  async build() {
    await this.#queue.onIdle();

    const downloader = await downloadSequence({
      cliProgress: true,
    }, ...this.#packages.keys());

    await downloader.download();

    const redirects = Bun.file("./fdroid/_redirects").writer();

    for await (const [pkg, meta] of this.#packages) {
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
      const file = Bun.file(
        `./fdroid/repo/${info.package}.${info.VersionCode}.${hash}.apk`,
      );
      await file.write(Bun.file(pkg.finalFileAbsolutePath));

      await redirects.write(`/repo/${basename(file.name!)} ${meta.url}\n`);

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
          `fdroid/repo/${info.package}/en-US/changelogs/${info.VersionCode}.txt`,
        ).write(meta.changelog);
      }
    }
    await redirects.end();

    await Bun.$`fdroid update --use-date-from-apk --delete-unknown --pretty`
      .cwd("fdroid");

    await this.cleanApkCache();
  }

  async cleanApkCache() {
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
  }
}
