import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { normalizeDistributionContent } from "../src/domain/release.js";
import { isPackageVersion } from "../src/lib/version.js";
import { resolveContained } from "../src/lib/security.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";
import {
  RELEASE_IDENTITY_FILE,
  RELEASE_IDENTITY_SCHEMA_VERSION,
} from "../src/lib/release-identity.js";

const SOURCE_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const CONTENT_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export interface ReleaseMaterializationPlan {
  version: string;
  tag: string;
  sourceSha: string;
  contentDigest: string;
}

export interface MaterializationResult {
  applied: boolean;
  reasons: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ALLOWED_CHANGED_PATHS = new Set([
  "package.json",
  "package-lock.json",
  RELEASE_IDENTITY_FILE,
]);

/**
 * 対象treeの全通常fileをrelative posix pathとSHA-256で記録する。**`.git`は
 * 除外する。** `build_distribution`は`git worktree add --detach`が作った
 * 一時treeを渡すため、`.git`はworktree pointer fileであり配布内容ではない。
 */
function snapshotTree(root: string): Map<string, string> {
  const digests = new Map<string, string>();
  const stack: string[] = [""];
  while (stack.length > 0) {
    const relativeDir = stack.pop() ?? "";
    const absoluteDir =
      relativeDir === "" ? root : path.join(root, relativeDir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const relativePath =
        relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        stack.push(relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = fs.readFileSync(path.join(absoluteDir, entry.name));
      digests.set(
        relativePath,
        crypto.createHash("sha256").update(content).digest("hex"),
      );
    }
  }
  return digests;
}

/** 2つのtree snapshot間で、追加・削除・内容変化のあったrelative pathを返す。 */
export function changedPaths(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const changed = new Set<string>();
  for (const [key, hash] of before)
    if (after.get(key) !== hash) changed.add(key);
  for (const [key, hash] of after)
    if (before.get(key) !== hash) changed.add(key);
  return [...changed].sort();
}

/**
 * release計画入力の形式を検証する。**書き込みの前に検証を終える**（FR-03）。
 */
export function validateMaterializationPlan(value: unknown): {
  plan?: ReleaseMaterializationPlan;
  reasons: string[];
} {
  if (!isRecord(value))
    return { reasons: ["release計画はobjectでなければなりません"] };
  const { version, tag, sourceSha, contentDigest } = value;
  const reasons: string[] = [];
  if (!isPackageVersion(version))
    reasons.push("versionが0.4.xの正しいSemVer形式ではありません");
  if (
    typeof tag !== "string" ||
    (isPackageVersion(version) && tag !== `v${String(version)}`)
  )
    reasons.push("tagはv<version>と一致しません");
  if (typeof sourceSha !== "string" || !SOURCE_SHA_PATTERN.test(sourceSha))
    reasons.push("sourceShaは40桁または64桁の小文字hexでなければなりません");
  if (
    typeof contentDigest !== "string" ||
    !CONTENT_DIGEST_PATTERN.test(contentDigest)
  )
    reasons.push("contentDigestは64桁の小文字hexでなければなりません");
  if (reasons.length > 0) return { reasons };
  return {
    reasons: [],
    plan: {
      version: version as string,
      tag: tag as string,
      sourceSha: sourceSha as string,
      contentDigest: contentDigest as string,
    },
  };
}

/**
 * 検証済み一時treeへversionとrelease identityを1度だけ適用する。
 *
 * **書き込むpathを`package.json`・`package-lock.json`・`release-identity.json`の
 * 3件に閉じる。** `normalizeDistributionContent`（既存、version以外をnull化しない
 * 比較用の正準化）でversion以外のfieldが動いていないことを確認し、1件でも
 * 許可外の変化を検出したら書き込む前に停止する（INV-REL-05）。
 */
export function materializeRelease(
  target: string,
  plan: ReleaseMaterializationPlan,
): MaterializationResult {
  const reasons: string[] = [];
  const packageJsonPath = resolveContained(target, "package.json");
  const packageLockPath = resolveContained(target, "package-lock.json");
  let identityPath: string;
  try {
    identityPath = resolveContained(target, RELEASE_IDENTITY_FILE, {
      allowMissingLeaf: true,
    });
  } catch (error) {
    return {
      applied: false,
      reasons: [
        `${RELEASE_IDENTITY_FILE}のpathを解決できません: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (fs.existsSync(identityPath))
    reasons.push(
      `${RELEASE_IDENTITY_FILE}が対象treeに既に存在します。許可外の変化として扱います`,
    );

  let originalPackageJson: string;
  let originalPackageLock: string;
  try {
    originalPackageJson = fs.readFileSync(packageJsonPath, "utf8");
    originalPackageLock = fs.readFileSync(packageLockPath, "utf8");
  } catch (error) {
    return {
      applied: false,
      reasons: [
        `対象treeのpackage.jsonまたはpackage-lock.jsonを読み取れません: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  let nextPackageJson: string;
  let nextPackageLock: string;
  try {
    const parsedPackageJson = JSON.parse(originalPackageJson) as Record<
      string,
      unknown
    >;
    parsedPackageJson.version = plan.version;
    nextPackageJson = `${JSON.stringify(parsedPackageJson, null, 2)}\n`;
    const parsedPackageLock = JSON.parse(originalPackageLock) as Record<
      string,
      unknown
    >;
    parsedPackageLock.version = plan.version;
    const packagesRoot = parsedPackageLock.packages;
    if (isRecord(packagesRoot) && isRecord(packagesRoot[""]))
      (packagesRoot[""] as Record<string, unknown>).version = plan.version;
    nextPackageLock = `${JSON.stringify(parsedPackageLock, null, 2)}\n`;
  } catch (error) {
    return {
      applied: false,
      reasons: [
        `package.jsonまたはpackage-lock.jsonをparseできません: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  if (
    normalizeDistributionContent("package.json", originalPackageJson) !==
    normalizeDistributionContent("package.json", nextPackageJson)
  )
    reasons.push(
      "package.jsonのversion以外のfieldが変化しました。許可外の変化として扱います",
    );
  if (
    normalizeDistributionContent("package-lock.json", originalPackageLock) !==
    normalizeDistributionContent("package-lock.json", nextPackageLock)
  )
    reasons.push(
      "package-lock.jsonのversion以外のfieldが変化しました。許可外の変化として扱います",
    );

  if (reasons.length > 0) return { applied: false, reasons };

  const identityContent = `${JSON.stringify(
    {
      schemaVersion: RELEASE_IDENTITY_SCHEMA_VERSION,
      version: plan.version,
      tag: plan.tag,
      sourceSha: plan.sourceSha,
      contentDigest: plan.contentDigest,
    },
    null,
    2,
  )}\n`;

  /**
   * **書き込み前に対象tree全体のsnapshotを取る。** package.json・
   * package-lock.jsonの内容検査だけでは、この関数自身に加わる将来の変異
   * （例: 別fileへも書き込む変更）を捕まえられない（独立review REV-08指摘）。
   * 書き込み後に再snapshotし、許可した3 path以外へ変化があれば
   * `applied: false`で名指しする。このscriptが書くのは3 pathだけなので、
   * 通常経路では許可外差分は生じない。差分が出るのは変異または並行外部変更の
   * 場合だけであり、その場合もrelease対象treeは`build_distribution` job内の
   * 使い捨てcopyであるため、以後のtag・publishへ進まなければ外部への影響は無い。
   */
  const before = snapshotTree(target);
  fs.writeFileSync(packageJsonPath, nextPackageJson);
  fs.writeFileSync(packageLockPath, nextPackageLock);
  fs.writeFileSync(identityPath, identityContent);
  const after = snapshotTree(target);
  const disallowed = changedPaths(before, after).filter(
    (changedPath) => !ALLOWED_CHANGED_PATHS.has(changedPath),
  );
  if (disallowed.length > 0) {
    /**
     * **検出後、既知の3 pathを書き込み前の内容へ復元してから非0終了する。**
     * 検出は書き込み後にしか行えないが（この関数自身への変異を検知する仕組み
     * のため）、復元まで行わないと呼び出し側が観測する終了状態は「書き込み前の
     * 状態を保ったまま」（02 §4.3）にならない（round 2独立review REV2-05指摘）。
     * `disallowed`に含まれうる3 path以外の未知pathは内容backupを持たないため
     * 復元対象にしない。このscriptが書くのはこの3 pathだけであり、それ以外への
     * 変化はこの関数自身への変異または並行外部変更のときだけ生じる。
     */
    fs.writeFileSync(packageJsonPath, originalPackageJson);
    fs.writeFileSync(packageLockPath, originalPackageLock);
    try {
      fs.unlinkSync(identityPath);
    } catch {
      // 復元は最善努力。identityPathは書き込み前は存在しなかった
      // （既に存在する場合はこの関数の先頭で書き込み前にreasonsへ積んで停止する）。
    }
    return {
      applied: false,
      reasons: [`許可外file変化を検出しました: ${disallowed.join(", ")}`],
    };
  }
  return { applied: true, reasons: [] };
}

function commandLineInput(args: readonly string[]): {
  planPath: string;
  target: string;
} {
  let planPath = "";
  let target = "";
  for (const argument of args) {
    if (argument.startsWith("--plan=")) {
      planPath = argument.slice("--plan=".length);
      continue;
    }
    if (argument.startsWith("--target=")) {
      target = argument.slice("--target=".length);
      continue;
    }
    throw new Error(`未知のoptionです: ${argument}`);
  }
  if (planPath === "") throw new Error("--planを指定してください");
  if (target === "") throw new Error("--targetを指定してください");
  return { planPath, target };
}

function main(): void {
  try {
    const { planPath, target } = commandLineInput(process.argv.slice(2));
    const rawPlan = JSON.parse(fs.readFileSync(planPath, "utf8")) as unknown;
    const validated = validateMaterializationPlan(rawPlan);
    if (!validated.plan) {
      process.stderr.write(`${validated.reasons.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    const result = materializeRelease(path.resolve(target), validated.plan);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.applied) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (isExecutionEntry(import.meta.url)) main();
