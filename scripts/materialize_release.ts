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

  // 検証をすべて終えてから書き込む。途中状態を残さない（02 §4.3）。
  fs.writeFileSync(packageJsonPath, nextPackageJson);
  fs.writeFileSync(packageLockPath, nextPackageLock);
  fs.writeFileSync(identityPath, identityContent);
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
