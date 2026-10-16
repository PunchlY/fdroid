import type { components } from "@octokit/openapi-types";
import type { DownloadEngineNodejs } from "ipull";
import { downloadFile, downloadSequence } from "ipull";
import { Octokit } from "octokit";
import PQueue from "p-queue";
import { link } from "node:fs/promises";
import { rm } from "node:fs/promises";

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

  #queue = new PQueue({
    concurrency: 1,
    autoStart: true,
  });

  #packages = new Map<DownloadEngineNodejs, Metadata>();

  async #ghRelease(
    owner: string,
    repo: string,
    tag?: string,
    preRelease?: boolean,
  ) {
    if (tag) {
      const { data } = await this.#octokit.rest.repos.getReleaseByTag({
        owner,
        repo,
        tag,
      });
      return data;
    }
    if (preRelease) {
      const { data: releases } = await this.#octokit.rest.repos.listReleases({
        owner,
        repo,
      });
      return releases.find(({ draft }) => !draft);
    }
    const { data } = await this.#octokit.rest.repos.getLatestRelease({
      owner,
      repo,
    });
    return data;
  }
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
      const { data: owner } = await this.#octokit.rest.users.getById({
        account_id: repo.owner.id,
      });

      const release = await this.#ghRelease(
        cfg.owner,
        cfg.repo,
        cfg.tag,
        cfg.preRelease,
      );
      if (!release) {
        return;
      }

      const metadata: Omit<Metadata, "url"> = {
        author: owner.name || owner.login,
        email: owner.email || undefined,
        license: repo.license?.spdx_id || undefined,
        website: repo.homepage ? URL.parse(repo.homepage)?.href : undefined,
        source: repo.html_url,
        issue: repo.has_issues ? `${repo.html_url}/issues` : undefined,
        changelogUrl: `${repo.html_url}/releases`,
        // changelog: release.body ? Bun.markdown.html(release.body) : undefined,
        changelog: release.body || undefined,
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
            fileName: [
              "gh",
              owner.login,
              repo.name,
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
    return this;
  }

  async build() {
    this.#queue.start();
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

    await this.cleanApkCache();
    await this.cleanCache();
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

  async cleanCache() {
    const packages = new Set(
      this.#packages.keys()
        .map(({ finalFileAbsolutePath }) => finalFileAbsolutePath),
    );
    for await (
      const name of new Bun.Glob("**/*").scan({
        cwd: ".cache",
        absolute: true,
        onlyFiles: true,
      })
    ) {
      if (packages.has(name)) {
        continue;
      }
      await rm(name);
    }
  }
}
