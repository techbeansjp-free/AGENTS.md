import fs from "node:fs";
import path from "node:path";
import { findPackageRoot } from "./package-root.js";
import { isPackageVersion, PACKAGE_VERSION } from "./version.js";
export const RELEASE_IDENTITY_SCHEMA_VERSION = "agent-skill-chain/release-identity/v1";
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
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * `release-identity.json`の有無・形式だけから配布物の由来を判定する。
 *
 * **`.git`・tag ref・GitHub APIを読まない。** `.git`が無い正式配布物でも
 * 判定できることを保証する（FR-08）。不正な内容は`source`として扱い、
 * `release version不明`のsentinelをrelease versionと誤表示しない（FR-12）。
 */
export function resolveDistributionIdentity(packageRoot, packageVersion) {
    const source = { kind: "source", packageVersion };
    const identityPath = path.join(packageRoot, RELEASE_IDENTITY_FILE);
    if (!fs.existsSync(identityPath))
        return source;
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(identityPath, "utf8"));
    }
    catch {
        return source;
    }
    if (!isRecord(parsed))
        return source;
    if (!Object.keys(parsed).every((key) => IDENTITY_KEYS.has(key)))
        return source;
    const { schemaVersion, version, tag, sourceSha, contentDigest } = parsed;
    if (schemaVersion !== RELEASE_IDENTITY_SCHEMA_VERSION)
        return source;
    if (!isPackageVersion(version))
        return source;
    if (tag !== `v${version}`)
        return source;
    if (typeof sourceSha !== "string" || !SOURCE_SHA_PATTERN.test(sourceSha))
        return source;
    if (typeof contentDigest !== "string" ||
        !CONTENT_DIGEST_PATTERN.test(contentDigest))
        return source;
    return { kind: "release", version, tag, sourceSha, contentDigest };
}
const packageRoot = findPackageRoot(import.meta.url);
/** 実行中の配布物そのものの識別結果（実行毎に算出、永続化しない）。 */
export const DISTRIBUTION_IDENTITY = resolveDistributionIdentity(packageRoot, PACKAGE_VERSION);
//# sourceMappingURL=release-identity.js.map