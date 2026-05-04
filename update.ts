import { Octokit } from "octokit";
import { mkdir } from "fs/promises";

process.env.FDROID_DIR = `${__dirname}/fdroid`;
await mkdir(`${process.env.FDROID_DIR}/repo`, { recursive: true });

const octokit = new Octokit();

const releaseUpdatedAtFile = Bun.file(`${process.env.FDROID_DIR}/releases.json`);
const releaseUpdatedAt = new Map<string, string>(
    await releaseUpdatedAtFile
        .json()
        .catch(() => ({}))
        .then(Object.entries),
);

function isReleaseUpToDate(name: string, updatedAt: string) {
    if (!releaseUpdatedAt.has(name))
        return true;
    if (Date.parse(releaseUpdatedAt.get(name)!) <= Date.parse(updatedAt))
        return true;
    return false;
}

async function setReleaseUpdatedAt(name: string, updatedAt: string) {
    releaseUpdatedAt.set(name, updatedAt);
    await releaseUpdatedAtFile.write(JSON.stringify(Object.fromEntries(releaseUpdatedAt), null, 2));
}

async function gh(owner: string, repo: string) {
    const { data: release } = await octokit.request("GET /repos/{owner}/{repo}/releases/latest", { owner, repo });
    if (!isReleaseUpToDate(`gh/${owner}/${repo}`, release.updated_at || release.published_at || release.created_at))
        return;
    for (const asset of release.assets) {
        if (asset.content_type !== "application/vnd.android.package-archive")
            continue;
        console.log("download: %s", asset.browser_download_url);
        await Bun.$`curl -L ${asset.browser_download_url} -o ${`${Bun.randomUUIDv7("hex")}.apk`}`.cwd(`${process.env.FDROID_DIR}/repo`);
    }
    await setReleaseUpdatedAt(`gh/${owner}/${repo}`, new Date().toISOString());
}

await gh("open-ani", "animeko");

await gh("deretame", "Breeze");

await gh("HapeLee", "legado-with-MD3");

await gh("bggRGjQaUbCoE", "PiliPlus");

await gh("SlotSun", "dart_simple_live");

await Bun.$`fdroid update --create-metadata --rename-apks --use-date-from-apk --pretty --delete-unknown`.cwd(process.env.FDROID_DIR);
