import fs from "node:fs";
import path from "node:path";
import { findPackageRoot } from "./package-root.js";

interface PackageMetadata {
  version: string;
  agentSkillChain: {
    policySchemaVersion: string;
    compatiblePolicySchemaVersions: string[];
    deprecatedPolicySchemaAliases: Record<string, string>;
  };
}

const packageRoot = findPackageRoot(import.meta.url);
const packageMetadata = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
) as PackageMetadata;
const policyNamespace = "agent-skill-chain/project-policy/v";
/**
 * **package release versionのcoreとcurrent policy schema versionは常に同一
 * 数値である**（`scripts/build.ts`が強制する既存不変条件。Issue #1503で
 * 0.3.xから0.4.xへ両方まとめて進めた）。`packageVersionCore`はpackage
 * releaseの受理範囲（新しいcandidate versionの検証）に使い、0.4.xだけを
 * 受理する。過去のgit tag（`v0.3.1-beta.NNN`等）は比較時に読み捨てるだけで
 * 良く、`isPackageVersion`が0.3.x側を受理し続ける必要はない。
 *
 * `policyVersionCore`は`policySchemaVersion`（現行値）と
 * `compatiblePolicySchemaVersions`（過去の互換値）の両方を検証する。
 * 現行は0.4.xへ進んだが、互換として残す過去値（0.3.0・0.3.1）は0.3.xの
 * ままである。**移行期間中は両系列を受理する必要がある**ため、
 * package release versionの受理範囲とは別に、0.3.xと0.4.xの両方を含む。
 */
const packageVersionCore = String.raw`0\.4\.(?:0|[1-9]\d*)`;
const policyVersionCore = String.raw`(?:0\.3\.(?:0|[1-9]\d*)|0\.4\.(?:0|[1-9]\d*))`;
const prereleaseIdentifier = String.raw`(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const packageVersionPattern = new RegExp(
  String.raw`^${packageVersionCore}(?:-${prereleaseIdentifier}(?:\.${prereleaseIdentifier})*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`,
  "u",
);
const policyVersionPattern = new RegExp(
  String.raw`^${policyVersionCore}$`,
  "u",
);

export function isPackageVersion(value: unknown): value is string {
  return typeof value === "string" && packageVersionPattern.test(value);
}

export function isPolicySchemaPatchVersion(value: unknown): value is string {
  return typeof value === "string" && policyVersionPattern.test(value);
}

export function packageReleaseVersion(value: string): string {
  return value.split(/[+-]/u, 1)[0] ?? value;
}

if (!isPackageVersion(packageMetadata.version))
  throw new Error("package.json.versionは0.4.x SemVerでなければなりません");
if (
  !isPolicySchemaPatchVersion(
    packageMetadata.agentSkillChain?.policySchemaVersion,
  )
)
  throw new Error("package.jsonのpolicySchemaVersionが不正です");
if (
  !Array.isArray(
    packageMetadata.agentSkillChain?.compatiblePolicySchemaVersions,
  ) ||
  packageMetadata.agentSkillChain.compatiblePolicySchemaVersions.some(
    (version) => !isPolicySchemaPatchVersion(version),
  )
)
  throw new Error("package.jsonのcompatiblePolicySchemaVersionsが不正です");
if (
  !packageMetadata.agentSkillChain?.deprecatedPolicySchemaAliases ||
  typeof packageMetadata.agentSkillChain.deprecatedPolicySchemaAliases !==
    "object" ||
  Array.isArray(packageMetadata.agentSkillChain.deprecatedPolicySchemaAliases)
)
  throw new Error("package.jsonのdeprecatedPolicySchemaAliasesが不正です");
for (const [alias, canonical] of Object.entries(
  packageMetadata.agentSkillChain.deprecatedPolicySchemaAliases,
))
  if (
    !/^0\.3$/u.test(alias) ||
    typeof canonical !== "string" ||
    !packageMetadata.agentSkillChain.compatiblePolicySchemaVersions.includes(
      canonical,
    )
  )
    throw new Error("package.jsonのdeprecated policy schema aliasが不正です");

export const PACKAGE_VERSION = packageMetadata.version;
export const CURRENT_POLICY_SCHEMA_VERSION = `${policyNamespace}${packageMetadata.agentSkillChain.policySchemaVersion}`;
export const COMPATIBLE_POLICY_SCHEMA_VERSIONS =
  packageMetadata.agentSkillChain.compatiblePolicySchemaVersions.map(
    (version) => `${policyNamespace}${version}`,
  );
export const SUPPORTED_POLICY_SCHEMA_VERSIONS = [
  ...COMPATIBLE_POLICY_SCHEMA_VERSIONS,
  CURRENT_POLICY_SCHEMA_VERSION,
];
export const DEPRECATED_POLICY_SCHEMA_ALIASES = Object.fromEntries(
  Object.entries(
    packageMetadata.agentSkillChain.deprecatedPolicySchemaAliases,
  ).map(([alias, canonical]) => [
    `${policyNamespace}${alias}`,
    `${policyNamespace}${canonical}`,
  ]),
);
