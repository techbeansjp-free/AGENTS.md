import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { isExecutionEntry } from "../src/lib/entrypoint.js";
import { isPackageVersion } from "../src/lib/version.js";

import { canonicalBumpDiff } from "./prepare_release_bump.js";

/**
 * release tagから導いたversionを、npm公開経路の一時checkoutへ注入する。
 *
 * **版管理下のtreeは`0.3.x-managed-by-tag`のsentinelを持つ**（Issue #1184）。releaseが
 * 既定branchへbump commitを push しなくなったため、`npm publish`が読むversionはここで
 * 与えるしかない。
 *
 * **注入がversion 3 fieldだけを変えたことを`canonicalBumpDiff`で検査する。** 同じ判定を
 * 旧bump経路が使っており、判定を二重に持たない。検査に失敗したら非0で終了し、公開へ
 * 進ませない。**`npm publish <tgz>`は`prepack`を実行しないため、注入漏れを公開前に
 * 検出する機会はここだけである。**
 *
 * 対象はprocessの`cwd`、versionは`RELEASE_TAG`環境変数。**正常時は何も出力しない。**
 */

const MANIFEST = "package.json";
const LOCKFILE = "package-lock.json";

class InjectVersionError extends Error {}

/** `vX.Y.Z…`形式のtagからversionを取り出す。 */
export function versionFromReleaseTag(tag: string): string {
  if (!tag.startsWith("v"))
    throw new InjectVersionError(
      `release tag「${tag}」はvで始まらなければなりません`,
    );
  const version = tag.slice(1);
  if (!isPackageVersion(version))
    throw new InjectVersionError(
      `release tag「${tag}」から正しいpackage versionを導けません`,
    );
  return version;
}

function readPair(): { manifest: string; lockfile: string } {
  return {
    manifest: fs.readFileSync(MANIFEST, "utf8"),
    lockfile: fs.readFileSync(LOCKFILE, "utf8"),
  };
}

function runNpmVersion(version: string): void {
  const result = spawnSync(
    "npm",
    [
      "version",
      version,
      "--no-git-tag-version",
      "--allow-same-version",
      "--ignore-scripts",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0)
    throw new InjectVersionError(
      `versionの注入に失敗しました: npm versionがexit ${String(result.status)}を返しました`,
    );
}

/**
 * @param apply versionを書き込む手段。**既定は`npm version`である。**
 *   test seamであり、`canonicalBumpDiff`の検査が**実行経路の上にある**ことを
 *   固定するために置く。判定関数を直接呼ぶだけのscenarioでは、ここの呼び出し行を
 *   消す変異が生存する。
 * @param read manifestとlockfileの読み取り。既定はprocessの`cwd`から読む。
 */
export function injectPublishVersion(
  tag: string,
  apply: (version: string) => void = runNpmVersion,
  read: () => { manifest: string; lockfile: string } = readPair,
): void {
  const version = versionFromReleaseTag(tag);
  const before = read();
  apply(version);
  const after = read();
  if (!canonicalBumpDiff(before, after, version))
    throw new InjectVersionError(
      "versionの注入がpackage.jsonとpackage-lock.jsonの3 version field以外を変更しました",
    );
}

if (isExecutionEntry(import.meta.url)) {
  const tag = process.env.RELEASE_TAG;
  if (!tag) {
    process.stderr.write("RELEASE_TAGが未設定です\n");
    process.exit(1);
  }
  try {
    injectPublishVersion(tag);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
