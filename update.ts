import { Octokit } from "octokit";
import type { DownloadEngineNodejs } from "ipull";
import { downloadFile, downloadSequence } from "ipull";
import { utimes } from "node:fs/promises";
import { rm } from "node:fs/promises";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const downloads = new Set<DownloadEngineNodejs>();
const redirects = new Map<string, string>();

async function gh(
  owner: string,
  repo: string,
  preRelease = false,
  filter = /(?:)/,
) {
  let release;
  if (preRelease) {
    const { data: releases } = await octokit.request(
      "GET /repos/{owner}/{repo}/releases",
      { owner, repo },
    );
    if (!releases.length) {
      return;
    }
    release = releases.at(0)!;
  } else {
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/releases/latest",
      { owner, repo },
    );
    release = data;
  }
  for (const asset of release.assets) {
    if (asset.content_type !== "application/vnd.android.package-archive") {
      continue;
    }
    if (!filter.test(asset.name)) {
      continue;
    }
    const url = asset.browser_download_url;
    const fileName = `${Bun.randomUUIDv5(url, "url", "hex")}.apk`;
    redirects.set(`/${fileName}`, url);
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

await Promise.allSettled([
  gh("open-ani", "animeko", false, /(?<!universal)\.apk$/),
  gh("deretame", "Breeze"),
  gh("HapeLee", "legado-with-MD3", true, /(?<=arm64-v8a|armeabi-v7a)\.apk$/),
  gh("bggRGjQaUbCoE", "PiliPlus"),
  gh("SlotSun", "dart_simple_live"),
  gh("cwuom", "NeriPlayer"),
  gh("zzc10086", "TiebaLite", true),
  gh("NihilDigit", "bilby", false, /(?<!universal)\.apk$/),
  gh("Nekogram", "Nekogram", false, /(?<!universal)\.apk$/),
  gh("Miuzarte", "ScrcpyForAndroid", false, /(?<!universal)-release\.apk$/),
  gh("Bumblebee202111", "doubean-public"),
  gh("zly2006", "zhihu-plus-plus", false, /^zhihu\+\+-lite\.apk$/),
  gh("liuchuancong", "pure_live"),
  gh("Predidit", "Kazumi"),
  gh("ReSukiSU", "ReSukiSU"),
]);

for await (const path of new Bun.Glob("fdroid/repo/*.apk").scan()) {
  await utimes(path, 0, 0);
}

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

const { default: { packages } } = await import("./fdroid/repo/index-v2.json");

const redirectsFile = Bun.file("fdroid/_redirects").writer();
for (const { versions } of Object.values(packages)) {
  for (const { file } of Object.values(versions)) {
    if (!redirects.has(file.name)) {
      continue;
    }
    await redirectsFile.write(
      `/repo${file.name} ${redirects.get(file.name)}\n`,
    );
  }
}
await redirectsFile.end();
