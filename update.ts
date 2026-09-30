import { Octokit } from "octokit";
import type { DownloadEngineNodejs } from "ipull";
import { downloadFile, downloadSequence } from "ipull";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const downloads = new Set<DownloadEngineNodejs>();
const redirects = new Map<string, string>();

async function gh(owner: string, repo: string, preRelease = false) {
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
    const url = asset.browser_download_url;
    const fileName = `${Bun.randomUUIDv5(url, "url", "hex")}.apk`;
    redirects.set(`/repo/${fileName}`, url);
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
  gh("open-ani", "animeko"),
  gh("deretame", "Breeze"),
  gh("HapeLee", "legado-with-MD3"),
  gh("bggRGjQaUbCoE", "PiliPlus"),
  gh("SlotSun", "dart_simple_live"),
  gh("cwuom", "NeriPlayer"),
  gh("zzc10086", "TiebaLite", true),
  gh("NihilDigit", "bilby"),
  gh("Nekogram", "Nekogram"),
  gh("Miuzarte", "ScrcpyForAndroid"),
  gh("Bumblebee202111", "doubean-public"),
  gh("zly2006", "zhihu-plus-plus"),
  gh("liuchuancong", "pure_live"),
]);

const downloader = await downloadSequence(
  {
    cliProgress: true,
    parallelDownloads: 10,
  },
  ...downloads,
);

await downloader.download();

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

const redirectsFile = Bun.file("fdroid/_redirects").writer();
for (const [name, url] of redirects) {
  await redirectsFile.write(`${name} ${url}\n`);
}
await redirectsFile.end();
