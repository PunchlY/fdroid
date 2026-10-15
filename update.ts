import { Fdroid } from ".";

new Fdroid()
  .octokit({
    auth: process.env.GITHUB_TOKEN,
  })
  .gh({
    owner: "open-ani",
    repo: "animeko",
    filter: /universal\.apk$/,
  })
  .gh({
    owner: "deretame",
    repo: "Breeze",
  })
  .gh({
    owner: "HapeLee",
    repo: "legado-with-MD3",
    preRelease: true,
    filter: (_, { tag_name }) => `legado-${tag_name}.apk`,
  })
  .gh({
    owner: "bggRGjQaUbCoE",
    repo: "PiliPlus",
  })
  .gh({
    owner: "SlotSun",
    repo: "dart_simple_live",
  })
  .gh({
    owner: "cwuom",
    repo: "NeriPlayer",
  })
  .gh({
    owner: "zzc10086",
    repo: "TiebaLite",
    preRelease: true,
  })
  .gh({
    owner: "NihilDigit",
    repo: "bilby",
    filter: /universal\.apk$/,
  })
  .gh({
    owner: "Nekogram",
    repo: "Nekogram",
    filter: /universal\.apk$/,
  })
  .gh({
    owner: "Miuzarte",
    repo: "ScrcpyForAndroid",
    filter: /universal-release\.apk$/,
  })
  .gh({
    owner: "Bumblebee202111",
    repo: "doubean-public",
  })
  .gh({
    owner: "zly2006",
    repo: "zhihu-plus-plus",
    filter: /^zhihu\+\+-lite\.apk$/,
  })
  .gh({
    owner: "liuchuancong",
    repo: "pure_live",
  })
  .gh({
    owner: "Predidit",
    repo: "Kazumi",
  })
  .gh({
    owner: "ReSukiSU",
    repo: "ReSukiSU",
    preRelease: true,
    filter: /universal-release\.apk$/,
  })
  .gh({
    owner: "Droid-Deck",
    repo: "DroidDeck",
    filter: (_, { tag_name }) => `DroidDeck-${tag_name}.apk`,
  })
  .gh({
    owner: "YuKongA",
    repo: "ghostlock-app",
    tag: "pre-release",
  })
  .gh({
    owner: "HmnDev-Tech",
    repo: "shevery",
  })
  .gh({
    owner: "ChaoMixian",
    repo: "vFlow",
    filter: [
      "app-arm64-v8a-release.apk",
      "app-armeabi-v7a-release.apk",
      "app-x86-release.apk",
      "app-x86_64-release.apk",
    ],
  })
  .gh({
    owner: "xiaoyvyv",
    repo: "bangumi",
  })
  .build();
