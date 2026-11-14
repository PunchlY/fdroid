import Type from "typebox";
import Value from "typebox/value";

export const type = "http";

const { releases: [release] } = Value.Parse(
  Type.Object({
    releases: Type.Array(
      Type.Object({
        file: Type.String(),
        notes: Type.Array(Type.String()),
        versionCode: Type.Number(),
        publishedAt: Type.Number(),
      }),
      { minItems: 1 },
    ),
  }),
  await (await fetch(
    "https://static.ukamnads.icu/releases/android/versions.json",
  )).json(),
);

export const url = new URL(
  release.file,
  "https://static.ukamnads.icu/releases/android/",
).href;

export const summary = "在手机上查看直播弹幕、主播动态与数据分析。";

export const changelog = release.notes.join("\n");

export const ids = [
  release.versionCode,
  release.publishedAt,
];
