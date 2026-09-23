import { digestLayaArtifact } from "./laya-decision-training.js";
export const LAYA_DECISION_BUNDLE_SCHEMA_VERSION = "asc/laya-decision-bundle/v1";
export const DISTRIBUTION_CLASSES = [
    "consumer-break",
    "package-drift",
    "no-impact",
    "unknown",
];
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u;
const VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
function assertExactKeys(value, keys, label) {
    const unknown = Object.keys(value).filter((key) => !keys.includes(key));
    if (unknown.length > 0)
        throw new Error(`${label}に未知fieldがあります: ${unknown.join(",")}`);
}
function assertDigest(value, label) {
    if (!SHA256.test(value))
        throw new Error(`${label}はSHA-256が必要です`);
}
function safeRelativePath(value) {
    return (value.length > 0 &&
        value.length <= 1024 &&
        !value.startsWith("/") &&
        !value.includes("\\") &&
        !value.split("/").some((segment) => segment === ".." || segment === ""));
}
export function assessDistribution(evidence) {
    if (evidence.length === 0)
        return {
            classification: "unknown",
            reasons: ["distribution evidenceなし"],
        };
    const requiredKinds = new Set([
        "source",
        "dist",
        "schema",
        "skill",
        "guide",
        "package",
        "consumer-install",
        "consumer-doctor",
    ]);
    const observedKinds = new Set(evidence.map((item) => item.kind));
    const missingKinds = [...requiredKinds].filter((kind) => !observedKinds.has(kind));
    if (missingKinds.length > 0)
        return {
            classification: "unknown",
            reasons: missingKinds.map((kind) => `${kind} evidence missing`),
        };
    const reasons = [];
    let consumerBreak = false;
    let packageDrift = false;
    let unknown = false;
    for (const item of evidence) {
        if (!item || typeof item !== "object" || Array.isArray(item))
            throw new Error("distribution evidenceはobjectが必要です");
        assertExactKeys(item, ["kind", "path", "expectedSha256", "observedSha256", "succeeded"], "DistributionEvidence");
        if (!requiredKinds.has(item.kind))
            throw new Error(`distribution kindが不正です: ${String(item.kind)}`);
        if (!safeRelativePath(item.path))
            throw new Error(`unsafe distribution path: ${item.path}`);
        if (item.expectedSha256 !== null)
            assertDigest(item.expectedSha256, "expectedSha256");
        if (item.observedSha256 !== null)
            assertDigest(item.observedSha256, "observedSha256");
        if (item.kind === "consumer-install" || item.kind === "consumer-doctor") {
            if (item.succeeded !== true &&
                item.succeeded !== false &&
                item.succeeded !== null)
                throw new Error(`${item.kind} succeededが不正です`);
            if (item.succeeded === false) {
                consumerBreak = true;
                reasons.push(`${item.kind} failed`);
            }
            else if (item.succeeded === null) {
                unknown = true;
                reasons.push(`${item.kind} evidence missing`);
            }
            continue;
        }
        if (item.succeeded !== null)
            throw new Error(`${item.kind} succeededはnullが必要です`);
        if (item.observedSha256 === null) {
            packageDrift = true;
            reasons.push(`${item.kind} artifact missing: ${item.path}`);
            continue;
        }
        if (item.expectedSha256 === null) {
            unknown = true;
            reasons.push(`${item.kind} expected digest missing: ${item.path}`);
            continue;
        }
        if (item.expectedSha256 !== item.observedSha256) {
            packageDrift = true;
            reasons.push(`${item.kind} artifact stale: ${item.path}`);
        }
    }
    if (consumerBreak)
        return { classification: "consumer-break", reasons };
    if (packageDrift)
        return { classification: "package-drift", reasons };
    if (unknown)
        return { classification: "unknown", reasons };
    return { classification: "no-impact", reasons: [] };
}
export function validateDecisionBundle(value, observedWeightSha256, currentAscVersion) {
    assertExactKeys(value, [
        "schemaVersion",
        "bundleId",
        "model",
        "questionSchemaPath",
        "questionSchemaSha256",
        "thresholdPath",
        "thresholdSha256",
        "modelCardPath",
        "modelCardSha256",
        "evaluationPath",
        "evaluationSha256",
        "datasetDigest",
        "splitDigest",
        "sealDigest",
        "eligibility",
        "compatibleAscVersions",
        "authority",
    ], "DecisionBundle");
    if (value.schemaVersion !== LAYA_DECISION_BUNDLE_SCHEMA_VERSION)
        throw new Error("DecisionBundle schemaVersionが不正です");
    if (!SAFE_ID.test(value.bundleId))
        throw new Error("bundleIdが不正です");
    assertExactKeys(value.model, ["id", "path", "weightSha256"], "DecisionBundle.model");
    if (!SAFE_ID.test(value.model.id))
        throw new Error("model.idが不正です");
    for (const [label, artifactPath] of [
        ["model.path", value.model.path],
        ["questionSchemaPath", value.questionSchemaPath],
        ["thresholdPath", value.thresholdPath],
        ["modelCardPath", value.modelCardPath],
        ["evaluationPath", value.evaluationPath],
    ])
        if (!safeRelativePath(artifactPath))
            throw new Error(`${label}が不正です`);
    for (const [label, digest] of [
        ["weightSha256", value.model.weightSha256],
        ["questionSchemaSha256", value.questionSchemaSha256],
        ["thresholdSha256", value.thresholdSha256],
        ["modelCardSha256", value.modelCardSha256],
        ["evaluationSha256", value.evaluationSha256],
        ["datasetDigest", value.datasetDigest],
        ["splitDigest", value.splitDigest],
        ["sealDigest", value.sealDigest],
    ])
        assertDigest(digest, label);
    assertDigest(observedWeightSha256, "observedWeightSha256");
    if (value.model.weightSha256 !== observedWeightSha256)
        throw new Error("model weight digestがDecision Bundleと一致しません");
    if (value.compatibleAscVersions.length === 0 ||
        value.compatibleAscVersions.length > 32 ||
        new Set(value.compatibleAscVersions).size !==
            value.compatibleAscVersions.length ||
        value.compatibleAscVersions.some((version) => !VERSION.test(version)))
        throw new Error("compatibleAscVersionsが不正です");
    if (!VERSION.test(currentAscVersion))
        throw new Error("current ASC versionが不正です");
    if (!value.compatibleAscVersions.includes(currentAscVersion))
        throw new Error("Decision Bundleは現在のASC versionと互換ではありません");
    if (value.authority !== false)
        throw new Error("Decision Bundleはformal approval authorityを持てません");
    if (value.eligibility !== "eligible")
        throw new Error("eligibleではないcandidateをDecision Bundleへ利用できません");
    return value;
}
export function decisionBundleDigest(value) {
    return digestLayaArtifact(value);
}
//# sourceMappingURL=laya-distribution.js.map