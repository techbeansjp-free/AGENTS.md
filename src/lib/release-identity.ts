import fs from "node:fs";
import path from "node:path";
import { findPackageRoot } from "./package-root.js";
import { isPackageVersion, PACKAGE_VERSION } from "./version.js";

export const RELEASE_IDENTITY_SCHEMA_VERSION =
  "agent-skill-chain/release-identity/v1";
export const RELEASE_IDENTITY_FILE = "release-identity.json";

const SOURCE_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const CONTENT_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const IDENTITY_KEYS = new Set([
  "schemaVersion",
  "version",
  "tag",
  "sourceSha",
  "contentDigest",
]);

export interface ReleaseDistributionIdentity {
  kind: "release";
  version: string;
  tag: string;
  sourceSha: string;
  contentDigest: string;
}

export interface SourceBuildIdentity {
  kind: "source";
  packageVersion: string;
}

export type DistributionIdentity =
  ReleaseDistributionIdentity | SourceBuildIdentity;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `release-identity.json`の有無・形式だけから配布物の由来を判定する。
 *
 * **`.git`・tag ref・GitHub APIを読まない。** `.git`が無い正式配布物でも
 * 判定できることを保証する（FR-08）。不正な内容は`source`として扱い、
 * `release version不明`のsentinelをrelease versionと誤表示しない（FR-12）。
 */
export function resolveDistributionIdentity(
  packageRoot: string,
  packageVersion: string,
): DistributionIdentity {
  const source: SourceBuildIdentity = { kind: "source", packageVersion };
  const identityPath = path.join(packageRoot, RELEASE_IDENTITY_FILE);
  if (!fs.existsSync(identityPath)) return source;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(identityPath, "utf8"));
  } catch {
    return source;
  }
  if (!isRecord(parsed)) return source;
  if (!Object.keys(parsed).every((key) => IDENTITY_KEYS.has(key)))
    return source;
  const { schemaVersion, version, tag, sourceSha, contentDigest } = parsed;
  if (schemaVersion !== RELEASE_IDENTITY_SCHEMA_VERSION) return source;
  if (!isPackageVersion(version)) return source;
  if (tag !== `v${version}`) return source;
  if (typeof sourceSha !== "string" || !SOURCE_SHA_PATTERN.test(sourceSha))
    return source;
  if (
    typeof contentDigest !== "string" ||
    !CONTENT_DIGEST_PATTERN.test(contentDigest)
  )
    return source;
  /**
   * **`release-identity.json`のversionと`package.json`のversionが一致しない
   * 場合はsourceとして扱う（fail-closed、INV-REL-07）。** `materialize_release.ts`
   * は両fileへ同じ`plan.version`を書くため、正しく生成された配布物では常に
   * 一致する。stale・混入した`release-identity.json`だけがrelease扱いになり
   * managed記録（`package.json`のversionを正本とする）と食い違う経路を閉じる
   * （独立review REV-15指摘）。
   */
  if (version !== packageVersion) return source;
  return { kind: "release", version, tag, sourceSha, contentDigest };
}

const packageRoot = findPackageRoot(import.meta.url);

/** 実行中の配布物そのものの識別結果（実行毎に算出、永続化しない）。 */
export const DISTRIBUTION_IDENTITY: DistributionIdentity =
  resolveDistributionIdentity(packageRoot, PACKAGE_VERSION);
