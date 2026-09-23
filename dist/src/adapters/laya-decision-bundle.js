import crypto from "node:crypto";
import fs from "node:fs";
import { validateDecisionBundle, } from "../domain/laya-distribution.js";
import { parseJsonStrict, resolveContained } from "../lib/security.js";
function fileDigest(file) {
    return crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
}
function assertArtifact(root, relative, expectedDigest, label) {
    const file = resolveContained(root, relative);
    if (!fs.statSync(file).isFile())
        throw new Error(`${label}は通常fileが必要です`);
    if (fileDigest(file) !== expectedDigest)
        throw new Error(`${label} digestがDecision Bundleと一致しません`);
}
export function validateDecisionBundleArtifacts(bundle, root, currentAscVersion) {
    const weight = resolveContained(root, bundle.model.path);
    const validated = validateDecisionBundle(bundle, fileDigest(weight), currentAscVersion);
    assertArtifact(root, validated.questionSchemaPath, validated.questionSchemaSha256, "question schema");
    assertArtifact(root, validated.thresholdPath, validated.thresholdSha256, "threshold");
    assertArtifact(root, validated.modelCardPath, validated.modelCardSha256, "model card");
    assertArtifact(root, validated.evaluationPath, validated.evaluationSha256, "evaluation");
    const evaluation = parseJsonStrict(fs.readFileSync(resolveContained(root, validated.evaluationPath), "utf8"), "Laya evaluation");
    if (!evaluation ||
        typeof evaluation !== "object" ||
        Array.isArray(evaluation))
        throw new Error("Laya evaluationはobjectが必要です");
    const record = evaluation;
    if (record.eligibility !== "eligible" ||
        record.datasetDigest !== validated.datasetDigest ||
        record.splitDigest !== validated.splitDigest ||
        record.sealDigest !== validated.sealDigest)
        throw new Error("Decision Bundleとeligible evaluationのdigest chainが一致しません");
    return validated;
}
//# sourceMappingURL=laya-decision-bundle.js.map