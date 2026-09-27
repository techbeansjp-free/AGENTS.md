import fs from "node:fs";
import path from "node:path";
import { findPackageRoot } from "./package-root.js";
const packageRoot = findPackageRoot(import.meta.url);
const packageMetadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const policyNamespace = "agent-skill-chain/project-policy/v";
/**
 * **package release lineとpolicy schema versionは別の量である**（Issue #1503）。
 * package releaseは0.4.xだけを新しいversionとして受理する。policy schemaは
 * 利用projectのpolicyが宣言する契約番号であり、0.3.xのまま変えない。
 * 0.4.xへ進める前の旧release（`0.3.1-beta.N`）は`isLegacyPackageVersion`で
 * 別に識別する。
 */
const packageVersionCore = String.raw `0\.4\.(?:0|[1-9]\d*)`;
const legacyPackageVersionCore = String.raw `0\.3\.(?:0|[1-9]\d*)`;
const policyVersionCore = legacyPackageVersionCore;
const prereleaseIdentifier = String.raw `(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const versionSuffix = String.raw `(?:-${prereleaseIdentifier}(?:\.${prereleaseIdentifier})*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const packageVersionPattern = new RegExp(String.raw `^${packageVersionCore}${versionSuffix}$`, "u");
const legacyPackageVersionPattern = new RegExp(String.raw `^${legacyPackageVersionCore}${versionSuffix}$`, "u");
const policyVersionPattern = new RegExp(String.raw `^${policyVersionCore}$`, "u");
export function isPackageVersion(value) {
    return typeof value === "string" && packageVersionPattern.test(value);
}
/** 0.4.xへ進める前に切った旧package version（例: `0.3.1-beta.300`）。 */
export function isLegacyPackageVersion(value) {
    return typeof value === "string" && legacyPackageVersionPattern.test(value);
}
export function isPolicySchemaPatchVersion(value) {
    return typeof value === "string" && policyVersionPattern.test(value);
}
export function packageReleaseVersion(value) {
    return value.split(/[+-]/u, 1)[0] ?? value;
}
if (!isPackageVersion(packageMetadata.version))
    throw new Error("package.json.versionは0.4.x SemVerでなければなりません");
if (!isPolicySchemaPatchVersion(packageMetadata.agentSkillChain?.policySchemaVersion))
    throw new Error("package.jsonのpolicySchemaVersionが不正です");
if (!Array.isArray(packageMetadata.agentSkillChain?.compatiblePolicySchemaVersions) ||
    packageMetadata.agentSkillChain.compatiblePolicySchemaVersions.some((version) => !isPolicySchemaPatchVersion(version)))
    throw new Error("package.jsonのcompatiblePolicySchemaVersionsが不正です");
if (!packageMetadata.agentSkillChain?.deprecatedPolicySchemaAliases ||
    typeof packageMetadata.agentSkillChain.deprecatedPolicySchemaAliases !==
        "object" ||
    Array.isArray(packageMetadata.agentSkillChain.deprecatedPolicySchemaAliases))
    throw new Error("package.jsonのdeprecatedPolicySchemaAliasesが不正です");
for (const [alias, canonical] of Object.entries(packageMetadata.agentSkillChain.deprecatedPolicySchemaAliases))
    if (!/^0\.3$/u.test(alias) ||
        typeof canonical !== "string" ||
        !packageMetadata.agentSkillChain.compatiblePolicySchemaVersions.includes(canonical))
        throw new Error("package.jsonのdeprecated policy schema aliasが不正です");
export const PACKAGE_VERSION = packageMetadata.version;
export const CURRENT_POLICY_SCHEMA_VERSION = `${policyNamespace}${packageMetadata.agentSkillChain.policySchemaVersion}`;
export const COMPATIBLE_POLICY_SCHEMA_VERSIONS = packageMetadata.agentSkillChain.compatiblePolicySchemaVersions.map((version) => `${policyNamespace}${version}`);
export const SUPPORTED_POLICY_SCHEMA_VERSIONS = [
    ...COMPATIBLE_POLICY_SCHEMA_VERSIONS,
    CURRENT_POLICY_SCHEMA_VERSION,
];
export const DEPRECATED_POLICY_SCHEMA_ALIASES = Object.fromEntries(Object.entries(packageMetadata.agentSkillChain.deprecatedPolicySchemaAliases).map(([alias, canonical]) => [
    `${policyNamespace}${alias}`,
    `${policyNamespace}${canonical}`,
]));
//# sourceMappingURL=version.js.map