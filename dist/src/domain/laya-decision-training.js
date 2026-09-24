import crypto from "node:crypto";
import { redactSecrets, stableJson } from "../lib/security.js";
export const LAYA_DATASET_SCHEMA_VERSION = "asc/laya-decision-dataset/v1";
export const LAYA_QUESTION_IDS = [
    "finding-validity",
    "severity",
    "required-action",
    "distribution-impact",
];
export const LAYA_VALIDITY = ["yes", "no", "insufficient-evidence"];
export const LAYA_SEVERITY = ["critical", "high", "medium", "low"];
export const LAYA_ACTIONS = ["fix", "investigate", "dismiss"];
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const SECRET_MARKER = /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|github_pat_|gh[pousr]_|authorization\s*:|password\s*[=:]|secret\s*[=:]|api[_-]?key\s*[=:])/iu;
const PROMPT_INSTRUCTION = /(?:ignore (?:all |the )?(?:previous|prior) instructions|system prompt|developer message|指示を無視|命令に従え)/iu;
const GOLD_LEAKAGE = /(?:\b(?:valid|invalid|resolved|false[- ]?positive|approved|rejected)\b|是正済み|修正済み|解決済み|却下|誤検知|判定\s*[:：])/iu;
export function questionIdsForCase(input) {
    return input.slice === "distribution"
        ? ["distribution-impact"]
        : ["finding-validity", "severity", "required-action"];
}
function assertExactKeys(value, allowed, label) {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length > 0)
        throw new Error(`${label}に未知fieldがあります: ${unknown.join(",")}`);
}
function assertRecord(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error(`${label}はobjectが必要です`);
}
function assertInstant(value, label) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
        throw new Error(`${label}は正規ISO 8601 UTC instantが必要です`);
}
function assertSha(value, label) {
    if (!/^[0-9a-f]{40}$/u.test(value) && !/^[0-9a-f]{64}$/u.test(value))
        throw new Error(`${label}は固定Git SHAが必要です`);
}
function assertSafeText(value, label, max) {
    const normalized = value.normalize("NFC").trim();
    if (!normalized || normalized.length > max || CONTROL.test(normalized))
        throw new Error(`${label}が空、長過ぎる、または制御文字を含みます`);
    return normalized;
}
export function digestLayaArtifact(value) {
    return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}
export function validateDecisionCase(input) {
    assertRecord(input, "DecisionCase");
    const value = input;
    assertExactKeys(value, [
        "schemaVersion",
        "caseId",
        "sourceRepository",
        "sourceCommit",
        "observedAt",
        "groupId",
        "slice",
        "claim",
        "evidence",
        "provenance",
        "strength",
        "gold",
        "critical",
    ], "DecisionCase");
    if (value.schemaVersion !== LAYA_DATASET_SCHEMA_VERSION)
        throw new Error("DecisionCase schemaVersionが不正です");
    if (value.sourceRepository !== "techbeansjp-free/AGENTS.md")
        throw new Error("公開ASC以外のsource repositoryを拒否しました");
    assertSha(value.sourceCommit, "sourceCommit");
    assertInstant(value.observedAt, "observedAt");
    assertSafeText(value.caseId, "caseId", 128);
    assertSafeText(value.groupId, "groupId", 256);
    if (value.slice !== "general" && value.slice !== "distribution")
        throw new Error("DecisionCase sliceが不正です");
    assertSafeText(value.claim, "claim", 4096);
    if (!Array.isArray(value.evidence) ||
        value.evidence.length === 0 ||
        value.evidence.length > 16)
        throw new Error("evidenceは1〜16件が必要です");
    for (const evidence of value.evidence) {
        assertRecord(evidence, "evidence");
        assertExactKeys(evidence, ["path", "lineStart", "lineEnd", "excerpt"], "evidence");
        if (evidence.path.startsWith("/") ||
            evidence.path.includes("..") ||
            evidence.path.includes("\\"))
            throw new Error("evidence pathは安全なrepository相対pathが必要です");
        if (!Number.isSafeInteger(evidence.lineStart) ||
            !Number.isSafeInteger(evidence.lineEnd) ||
            evidence.lineStart < 1 ||
            evidence.lineEnd < evidence.lineStart)
            throw new Error("evidence line範囲が不正です");
        assertSafeText(evidence.excerpt, "evidence excerpt", 8192);
    }
    assertRecord(value.provenance, "provenance");
    assertExactKeys(value.provenance, ["kind", "artifactPath", "failBeforeCommit", "passAfterCommit"], "provenance");
    if (![
        "review-artifact",
        "fix-commit",
        "test-reproduction",
        "distribution-check",
    ].includes(value.provenance.kind))
        throw new Error("provenance.kindが不正です");
    assertSafeText(value.provenance.artifactPath, "provenance.artifactPath", 1024);
    for (const [label, commit] of [
        ["failBeforeCommit", value.provenance.failBeforeCommit],
        ["passAfterCommit", value.provenance.passAfterCommit],
    ])
        if (commit !== null)
            assertSha(commit, label);
    if (!["strong", "weak", "excluded"].includes(value.strength))
        throw new Error("strengthが不正です");
    assertRecord(value.gold, "gold");
    for (const [questionId, answer] of Object.entries(value.gold)) {
        if (!LAYA_QUESTION_IDS.includes(questionId))
            throw new Error(`gold questionIdが不正です: ${questionId}`);
        assertSafeText(answer, `gold.${questionId}`, 256);
    }
    if (typeof value.critical !== "boolean")
        throw new Error("criticalはbooleanが必要です");
    if (value.strength === "strong") {
        if (value.provenance.kind === "review-artifact")
            throw new Error("review artifact単独をstrong ground truthへ昇格できません");
        if (value.provenance.kind === "test-reproduction" &&
            (!value.provenance.failBeforeCommit || !value.provenance.passAfterCommit))
            throw new Error("strong reproductionにはfail-before/pass-afterが必要です");
    }
    return value;
}
export function createTeacherView(input, questionId) {
    validateDecisionCase(input);
    if (!questionIdsForCase(input).includes(questionId))
        throw new Error("DecisionCase sliceに適用できないquestionIdです");
    const raw = stableJson({ claim: input.claim, evidence: input.evidence });
    if (SECRET_MARKER.test(raw) || redactSecrets(raw) !== raw)
        throw new Error("teacher packetに秘密候補が含まれるため拒否しました");
    if (PROMPT_INSTRUCTION.test(raw))
        throw new Error("teacher packetに命令文が含まれるため拒否しました");
    if (GOLD_LEAKAGE.test(raw))
        throw new Error("teacher packetにgoldまたは事後判定の漏洩候補があります");
    const tokenEstimate = Math.ceil([...raw].length / 3);
    if (tokenEstimate > 1024)
        throw new Error("teacher packetが1024 token上限を超えます");
    return {
        caseId: input.caseId,
        questionId,
        claim: input.claim,
        evidence: input.evidence,
        tokenEstimate,
    };
}
export function groupDecisionCases(cases) {
    const groups = new Map();
    for (const item of cases) {
        validateDecisionCase(item);
        const current = groups.get(item.groupId) ?? [];
        current.push(item);
        groups.set(item.groupId, current);
    }
    return [...groups.entries()]
        .map(([groupId, members]) => ({
        groupId,
        observedAt: members
            .map((member) => member.observedAt)
            .sort()
            .at(-1),
        caseIds: members.map((member) => member.caseId).sort(),
    }))
        .sort((left, right) => left.observedAt.localeCompare(right.observedAt) ||
        left.groupId.localeCompare(right.groupId));
}
export function createSealedSplit(cases, createdAt) {
    assertInstant(createdAt, "createdAt");
    const groups = groupDecisionCases(cases);
    if (groups.length < 278)
        throw new Error(`splitには278以上の独立groupが必要です: ${groups.length}`);
    const reserveCount = Math.ceil(groups.length * 0.1);
    const holdoutCount = Math.max(100, Math.ceil(groups.length * 0.2));
    const validationCount = Math.max(50, Math.ceil(groups.length * 0.15));
    const trainCount = groups.length - reserveCount - holdoutCount - validationCount;
    if (trainCount < 100)
        throw new Error("split後のtrain groupが100未満です");
    const toIds = (selected) => selected.flatMap((group) => group.caseIds).sort();
    const partitions = {
        train: toIds(groups.slice(0, trainCount)),
        validation: toIds(groups.slice(trainCount, trainCount + validationCount)),
        holdout: toIds(groups.slice(trainCount + validationCount, groups.length - reserveCount)),
        reserve: toIds(groups.slice(groups.length - reserveCount)),
    };
    const seen = new Set();
    for (const ids of Object.values(partitions))
        for (const id of ids) {
            if (seen.has(id))
                throw new Error(`caseが複数partitionにあります: ${id}`);
            seen.add(id);
        }
    const sourceDigest = digestLayaArtifact(cases.map((item) => validateDecisionCase(item)));
    const unsigned = {
        schemaVersion: "asc/laya-split/v1",
        createdAt,
        sourceDigest,
        partitions,
    };
    return { ...unsigned, splitDigest: digestLayaArtifact(unsigned) };
}
export function validateTeacherAssessment(value, split, sealDigest) {
    assertInstant(value.recordedAt, "assessment recordedAt");
    if (value.splitDigest !== split.splitDigest ||
        value.sealDigest !== sealDigest)
        throw new Error("assessmentのsplit/seal digestが一致しません");
    const expectedPurpose = value.partition === "holdout" ? "holdout-baseline" : "train-label";
    if (value.purpose !== expectedPurpose)
        throw new Error("teacher purposeとpartitionの相互利用を拒否しました");
    if (!split.partitions[value.partition].includes(value.caseId))
        throw new Error("assessment caseが宣言partitionにありません");
    if (value.confidence < 0 ||
        value.confidence > 1 ||
        !Number.isFinite(value.confidence))
        throw new Error("confidenceは0以上1以下が必要です");
    assertSafeText(value.evidenceReason, "evidenceReason", 1024);
}
export function validateTrainingManifest(value) {
    assertExactKeys(value, [
        "schemaVersion",
        "sourceRepository",
        "sourceCommit",
        "datasetDigest",
        "splitDigest",
        "sealDigest",
        "layaRevision",
        "notebookSha256",
        "baseModel",
        "baseModelRevision",
        "environmentDigest",
        "seed",
        "trainPath",
        "validationPath",
        "splitArtifact",
        "teacherArtifacts",
        "adjudicationArtifacts",
    ], "TrainingManifest");
    if (value.schemaVersion !== "asc/laya-training-manifest/v1")
        throw new Error("training manifest schemaが不正です");
    if (value.sourceRepository !== "techbeansjp-free/AGENTS.md")
        throw new Error("privateまたは非ASC sourceを拒否しました");
    assertSha(value.sourceCommit, "training sourceCommit");
    for (const [label, digest] of [
        ["datasetDigest", value.datasetDigest],
        ["splitDigest", value.splitDigest],
        ["sealDigest", value.sealDigest],
    ])
        if (!/^[0-9a-f]{64}$/u.test(digest))
            throw new Error(`${label}が不正です`);
    if (value.layaRevision !== "2c6c16baf3ea3149948777937d5005a7c7fba425" ||
        value.notebookSha256 !==
            "6b81f290bbd213008d3e79c80d207b9abc1d1b5ab0a23f3f4bd9a289611433ed" ||
        value.baseModel !== "convaiinnovations/laya-multilingual" ||
        value.baseModelRevision !== "82d57fc4f2d1be3d2caac494045f2ec51d0842f3" ||
        value.environmentDigest !==
            "0795cbc6120e9d75db2ff77390ac0b82ab4a59de9d1ccbfe8a15acdad032426e")
        throw new Error("review済みLaya/base model pinと一致しません");
    if (!Number.isSafeInteger(value.seed) ||
        value.seed < 0 ||
        value.seed > 2_147_483_647)
        throw new Error("seedが不正です");
    if (typeof value.splitArtifact !== "object" ||
        value.splitArtifact === null ||
        !Array.isArray(value.teacherArtifacts) ||
        value.teacherArtifacts.length !== 2 ||
        !Array.isArray(value.adjudicationArtifacts) ||
        [...value.teacherArtifacts, ...value.adjudicationArtifacts].some((artifact) => typeof artifact !== "object" || artifact === null))
        throw new Error("学習根拠artifact参照が不正です");
    for (const [label, file] of [
        ["trainPath", value.trainPath],
        ["validationPath", value.validationPath],
        ["splitArtifact.path", value.splitArtifact?.path],
        ...(value.teacherArtifacts ?? []).map((artifact, index) => [
            `teacherArtifacts[${index}].path`,
            artifact.path,
        ]),
        ...(value.adjudicationArtifacts ?? []).map((artifact, index) => [
            `adjudicationArtifacts[${index}].path`,
            artifact.path,
        ]),
    ])
        if (!file ||
            file.startsWith("/") ||
            file.includes("..") ||
            file.includes("\\") ||
            CONTROL.test(file))
            throw new Error(`${label}は安全なrepository相対pathが必要です`);
    const artifactRefs = [
        value.splitArtifact,
        ...(value.teacherArtifacts ?? []),
        ...(value.adjudicationArtifacts ?? []),
    ];
    if (new Set(value.teacherArtifacts.map((artifact) => artifact.teacher)).size !==
        2 ||
        !value.teacherArtifacts.every((artifact) => ["codex", "opus"].includes(artifact.teacher)) ||
        artifactRefs.some((artifact) => typeof artifact !== "object" ||
            artifact === null ||
            !/^[0-9a-f]{64}$/u.test(artifact.sha256)))
        throw new Error("学習根拠artifact参照が不正です");
    for (const artifact of artifactRefs) {
        const allowed = "teacher" in artifact
            ? ["path", "sha256", "teacher"]
            : ["path", "sha256"];
        assertExactKeys(artifact, allowed, "学習根拠artifact参照");
    }
    return value;
}
function argmax(probabilities, classes) {
    let selected = classes[0];
    if (selected === undefined)
        throw new Error("classesが空です");
    let maximum = -1;
    let sum = 0;
    for (const name of classes) {
        const probability = probabilities[name];
        if (probability === undefined ||
            !Number.isFinite(probability) ||
            probability < 0 ||
            probability > 1)
            throw new Error(`probabilityが不正です: ${name}`);
        sum += probability;
        if (probability > maximum) {
            maximum = probability;
            selected = name;
        }
    }
    if (Math.abs(sum - 1) > 1e-6)
        throw new Error("probability合計は1でなければなりません");
    return selected;
}
export function evaluatePredictions(classes, rows, predictions) {
    if (new Set(classes).size !== classes.length || classes.length < 2)
        throw new Error("classesは重複なしで2件以上が必要です");
    const byCase = new Map(predictions.map((prediction) => [prediction.caseId, prediction]));
    const errors = [];
    const criticalMisses = [];
    const f1 = [];
    let brier = 0;
    let highConfidence = 0;
    let highConfidenceErrors = 0;
    let falseEscalationBase = 0;
    let falseEscalations = 0;
    let criticalBase = 0;
    let criticalCorrect = 0;
    const bins = Array.from({ length: 10 }, () => ({
        count: 0,
        confidence: 0,
        correct: 0,
    }));
    const resolved = rows.map((row) => {
        const prediction = byCase.get(row.caseId);
        if (!prediction)
            throw new Error(`predictionがありません: ${row.caseId}`);
        const predicted = argmax(prediction.probabilities, classes);
        if (prediction.predicted !== predicted)
            throw new Error(`predictedとargmaxが一致しません: ${row.caseId}`);
        const correct = predicted === row.gold;
        const confidence = prediction.probabilities[predicted];
        const bin = Math.min(9, Math.floor(confidence * 10));
        bins[bin].count++;
        bins[bin].confidence += confidence;
        bins[bin].correct += correct ? 1 : 0;
        if (!correct)
            errors.push(row.caseId);
        if (confidence >= 0.9) {
            highConfidence++;
            if (!correct)
                highConfidenceErrors++;
        }
        if (row.goldAction === "dismiss") {
            falseEscalationBase++;
            if (predicted === "yes" || prediction.predictedAction === "fix")
                falseEscalations++;
        }
        if (row.goldSeverity === "critical") {
            criticalBase++;
            const missed = predicted === "no" || prediction.predictedAction === "dismiss";
            if (missed)
                criticalMisses.push(row.caseId);
            else
                criticalCorrect++;
        }
        for (const name of classes) {
            const target = row.gold === name ? 1 : 0;
            brier += (prediction.probabilities[name] - target) ** 2;
        }
        return { ...row, predicted, correct };
    });
    for (const name of classes) {
        const tp = resolved.filter((row) => row.gold === name && row.predicted === name).length;
        const fp = resolved.filter((row) => row.gold !== name && row.predicted === name).length;
        const fn = resolved.filter((row) => row.gold === name && row.predicted !== name).length;
        const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
        const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
        f1.push(precision + recall === 0
            ? 0
            : (2 * precision * recall) / (precision + recall));
    }
    const ece = bins.reduce((total, bin) => {
        if (bin.count === 0)
            return total;
        return (total +
            (bin.count / rows.length) *
                Math.abs(bin.correct / bin.count - bin.confidence / bin.count));
    }, 0);
    return {
        schemaVersion: "asc/laya-evaluation/v1",
        classes: [...classes],
        sampleCount: rows.length,
        macroF1: f1.reduce((sum, value) => sum + value, 0) / f1.length,
        brier: brier / rows.length,
        expectedCalibrationError: ece,
        highConfidenceErrorRate: highConfidence === 0 ? null : highConfidenceErrors / highConfidence,
        falseEscalationRate: falseEscalationBase === 0 ? null : falseEscalations / falseEscalationBase,
        criticalRecall: criticalBase === 0 ? null : criticalCorrect / criticalBase,
        criticalMissCaseIds: criticalMisses.sort(),
        errorCaseIds: errors.sort(),
        meanLatencyMs: predictions.reduce((sum, prediction) => sum + prediction.latencyMs, 0) /
            predictions.length,
    };
}
export function candidateEligibility(report) {
    if (report.sampleCount === 0 || report.criticalRecall === null)
        return "insufficient-data";
    if (report.criticalMissCaseIds.length > 0)
        return "rejected";
    return "eligible";
}
//# sourceMappingURL=laya-decision-training.js.map