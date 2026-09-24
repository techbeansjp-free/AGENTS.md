import { LAYA_ACTIONS, LAYA_QUESTION_IDS, LAYA_SEVERITY, LAYA_VALIDITY, digestLayaArtifact, validateTeacherAssessment, } from "./laya-decision-training.js";
import { parseJsonStrict, stableJson } from "../lib/security.js";
const ROW_KEYS = [
    "schemaVersion",
    "id",
    "workflow",
    "state",
    "questions",
    "gold",
    "provenance",
];
const QUESTION_CLASSES = {
    "finding-validity": LAYA_VALIDITY,
    severity: LAYA_SEVERITY,
    "required-action": LAYA_ACTIONS,
    "distribution-impact": ["yes", "no", "insufficient-evidence"],
};
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
export function digestLayaTrainingInput(state, questionId, question) {
    return digestLayaArtifact({ state, questionId, question });
}
const bindingKey = (caseId, questionId, partition) => `${caseId}\0${questionId}\0${partition}`;
export function createLayaTrainingArtifactBindings(input) {
    const split = record(input.split, "sealed split");
    exactKeys(split, ["schemaVersion", "createdAt", "sourceDigest", "partitions", "splitDigest"], "sealed split");
    const partitions = record(split.partitions, "sealed split partitions");
    exactKeys(partitions, ["train", "validation", "holdout", "reserve"], "sealed split partitions");
    const seen = new Set();
    for (const name of ["train", "validation", "holdout", "reserve"]) {
        const ids = partitions[name];
        if (!Array.isArray(ids) ||
            ids.some((id) => typeof id !== "string" || !SAFE_ID.test(id)))
            throw new Error(`sealed split ${name}が不正です`);
        for (const id of ids) {
            if (seen.has(id))
                throw new Error(`sealed splitでcaseが重複しています: ${id}`);
            seen.add(id);
        }
    }
    if (split.schemaVersion !== "asc/laya-split/v1" ||
        split.splitDigest !== input.manifest.splitDigest ||
        digestLayaArtifact({
            schemaVersion: split.schemaVersion,
            createdAt: split.createdAt,
            sourceDigest: split.sourceDigest,
            partitions: split.partitions,
        }) !== split.splitDigest)
        throw new Error("sealed splitのdigestがmanifestと一致しません");
    const teacherAssessments = new Map();
    const teacherDigests = {};
    for (const artifact of input.teachers) {
        const value = record(artifact.value, `${artifact.teacher} teacher artifact`);
        exactKeys(value, ["schemaVersion", "teacher", "assessments"], `${artifact.teacher} teacher artifact`);
        if (value.schemaVersion !== "asc/laya-teacher-assessment-set/v1" ||
            value.teacher !== artifact.teacher ||
            !Array.isArray(value.assessments))
            throw new Error(`${artifact.teacher} teacher artifactが不正です`);
        teacherDigests[artifact.teacher] = artifact.sha256;
        for (const raw of value.assessments) {
            const assessment = record(raw, `${artifact.teacher} assessment`);
            exactKeys(assessment, [
                "schemaVersion",
                "teacher",
                "runId",
                "caseId",
                "questionId",
                "purpose",
                "partition",
                "answer",
                "inputDigest",
                "confidence",
                "evidenceReason",
                "splitDigest",
                "sealDigest",
                "recordedAt",
            ], `${artifact.teacher} assessment`);
            if (assessment.schemaVersion !== "asc/laya-teacher-assessment/v1" ||
                assessment.teacher !== artifact.teacher ||
                !LAYA_QUESTION_IDS.includes(assessment.questionId) ||
                (assessment.partition !== "train" &&
                    assessment.partition !== "validation") ||
                assessment.purpose !== "train-label" ||
                assessment.splitDigest !== input.manifest.splitDigest ||
                assessment.sealDigest !== input.manifest.sealDigest ||
                !partitions[assessment.partition].includes(String(assessment.caseId)) ||
                !QUESTION_CLASSES[assessment.questionId].includes(String(assessment.answer)) ||
                typeof assessment.inputDigest !== "string" ||
                !DIGEST.test(assessment.inputDigest))
                throw new Error(`${artifact.teacher} assessmentのbindingが不正です`);
            validateTeacherAssessment(assessment, split, input.manifest.sealDigest);
            const key = bindingKey(String(assessment.caseId), String(assessment.questionId), assessment.partition);
            if (teacherAssessments.has(`${artifact.teacher}\0${key}`))
                throw new Error(`${artifact.teacher} assessmentが重複しています`);
            teacherAssessments.set(`${artifact.teacher}\0${key}`, assessment);
        }
    }
    if (!teacherDigests.codex || !teacherDigests.opus)
        throw new Error("CodexとOpusのteacher artifactが必要です");
    const adjudications = new Map();
    const adjudicationDigests = new Set();
    for (const artifact of input.adjudications) {
        const value = record(artifact.value, "strong adjudication artifact");
        exactKeys(value, ["schemaVersion", "adjudications"], "strong adjudication artifact");
        if (value.schemaVersion !== "asc/laya-strong-adjudication-set/v1" ||
            !Array.isArray(value.adjudications))
            throw new Error("strong adjudication artifactが不正です");
        adjudicationDigests.add(artifact.sha256);
        for (const raw of value.adjudications) {
            const item = record(raw, "strong adjudication");
            exactKeys(item, [
                "caseId",
                "questionId",
                "purpose",
                "partition",
                "answer",
                "inputDigest",
                "splitDigest",
                "sealDigest",
            ], "strong adjudication");
            if (!LAYA_QUESTION_IDS.includes(item.questionId) ||
                (item.partition !== "train" && item.partition !== "validation") ||
                item.purpose !== "train-label" ||
                item.splitDigest !== input.manifest.splitDigest ||
                item.sealDigest !== input.manifest.sealDigest ||
                !partitions[item.partition].includes(String(item.caseId)) ||
                !QUESTION_CLASSES[item.questionId].includes(String(item.answer)) ||
                typeof item.inputDigest !== "string" ||
                !DIGEST.test(item.inputDigest))
                throw new Error("strong adjudicationのbindingが不正です");
            const key = bindingKey(String(item.caseId), String(item.questionId), item.partition);
            if (adjudications.has(key))
                throw new Error("strong adjudicationが重複しています");
            adjudications.set(key, item);
        }
    }
    return {
        split: split,
        teacherAssessments,
        adjudications,
        teacherDigests,
        adjudicationDigests,
    };
}
function record(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error(`${label}はobjectが必要です`);
    return value;
}
function exactKeys(value, keys, label) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length ||
        actual.some((key, i) => key !== expected[i]))
        throw new Error(`${label}のfieldが契約と一致しません`);
}
function canonicalObject(source, label) {
    if (typeof source !== "string" ||
        source.length === 0 ||
        source.length > 1_048_576)
        throw new Error(`${label}は上限内のJSON文字列が必要です`);
    const parsed = record(parseJsonStrict(source, label), label);
    if (stableJson(parsed) !== source)
        throw new Error(`${label}はcanonical JSONが必要です`);
    return parsed;
}
function validateProvenance(input, manifest, labels, inputDigests, partition, bindings) {
    const value = record(input, "training row provenance");
    const source = value.labelSource;
    if (source === "teacher-consensus") {
        exactKeys(value, [
            "labelSource",
            "sourceCaseId",
            "splitDigest",
            "sealDigest",
            "purpose",
            "partition",
            "teacherAssessments",
        ], "teacher consensus provenance");
        if (!Array.isArray(value.teacherAssessments) ||
            value.teacherAssessments.length !== 2)
            throw new Error("teacher consensusにはCodexとOpusの2 assessmentが必要です");
        const teachers = value.teacherAssessments.map((assessment, index) => {
            const item = record(assessment, `teacherAssessments[${index}]`);
            exactKeys(item, ["teacher", "assessmentDigest", "answers"], `teacherAssessments[${index}]`);
            if ((item.teacher !== "codex" && item.teacher !== "opus") ||
                typeof item.assessmentDigest !== "string" ||
                !DIGEST.test(item.assessmentDigest))
                throw new Error("teacher assessment provenanceが不正です");
            if (item.assessmentDigest !==
                bindings.teacherDigests[item.teacher])
                throw new Error("teacher assessment digestがmanifest artifactと一致しません");
            const answers = record(item.answers, `teacherAssessments[${index}].answers`);
            exactKeys(answers, Object.keys(labels), `teacherAssessments[${index}].answers`);
            if (Object.entries(labels).some(([questionId, label]) => {
                const bound = bindings.teacherAssessments.get(`${String(item.teacher)}\0${bindingKey(String(value.sourceCaseId), questionId, partition)}`);
                return (answers[questionId] !== label ||
                    bound?.answer !== label ||
                    bound.inputDigest !== inputDigests[questionId]);
            }))
                throw new Error("teacher assessmentがgoldと合意していません");
            return item.teacher;
        });
        if (new Set(teachers).size !== 2)
            throw new Error("teacher consensusは異なるCodexとOpusが必要です");
    }
    else if (source === "strong-adjudication") {
        exactKeys(value, [
            "labelSource",
            "sourceCaseId",
            "splitDigest",
            "sealDigest",
            "purpose",
            "partition",
            "adjudicationDigest",
            "adjudicatedAnswers",
        ], "strong adjudication provenance");
        if (typeof value.adjudicationDigest !== "string" ||
            !DIGEST.test(value.adjudicationDigest))
            throw new Error("strong adjudication digestが不正です");
        if (!bindings.adjudicationDigests.has(value.adjudicationDigest))
            throw new Error("strong adjudication digestがmanifest artifactと一致しません");
        const answers = record(value.adjudicatedAnswers, "adjudicatedAnswers");
        exactKeys(answers, Object.keys(labels), "adjudicatedAnswers");
        if (Object.entries(labels).some(([questionId, label]) => {
            const bound = bindings.adjudications.get(bindingKey(String(value.sourceCaseId), questionId, partition));
            return (answers[questionId] !== label ||
                bound?.answer !== label ||
                bound.inputDigest !== inputDigests[questionId]);
        }))
            throw new Error("strong adjudicationがgoldと一致しません");
    }
    else {
        throw new Error("弱いreview statusを学習goldへ使用できません");
    }
    if (typeof value.sourceCaseId !== "string" ||
        !SAFE_ID.test(value.sourceCaseId))
        throw new Error("provenance sourceCaseIdが不正です");
    if (value.splitDigest !== manifest.splitDigest ||
        value.sealDigest !== manifest.sealDigest)
        throw new Error("training row provenanceのsplit/sealがmanifestと一致しません");
    if (value.purpose !== "train-label" || value.partition !== partition)
        throw new Error("training rowのpurpose/partitionがdatasetと一致しません");
    if (!bindings.split.partitions[partition].includes(String(value.sourceCaseId)))
        throw new Error("training row caseがsealed splitのpartitionにありません");
    return value;
}
export function validateLayaTrainingRow(input, manifest, partition, bindings) {
    const value = record(input, "Laya training row");
    exactKeys(value, ROW_KEYS, "Laya training row");
    if (value.schemaVersion !== "asc/laya-training-row/v1")
        throw new Error("training row schemaVersionが不正です");
    if (typeof value.id !== "string" || !SAFE_ID.test(value.id))
        throw new Error("training row idが不正です");
    if (value.workflow !== "general" && value.workflow !== "distribution")
        throw new Error("training row workflowが不正です");
    const state = canonicalObject(value.state, "training state");
    exactKeys(state, ["claim", "evidence", "slice"], "training state");
    if (state.slice !== value.workflow)
        throw new Error("training state sliceとworkflowが一致しません");
    if (typeof state.claim !== "string" ||
        !state.claim.trim() ||
        !Array.isArray(state.evidence) ||
        state.evidence.length === 0)
        throw new Error("training stateが不正です");
    const questions = canonicalObject(value.questions, "training questions");
    const gold = canonicalObject(value.gold, "training gold");
    const questionIds = Object.keys(questions);
    const expected = value.workflow === "distribution"
        ? ["distribution-impact"]
        : ["finding-validity", "required-action", "severity"];
    if (questionIds.length === 0 ||
        questionIds.some((questionId) => !expected.includes(questionId)))
        throw new Error("workflowで許可されたquestion集合と一致しません");
    if (Object.keys(gold).sort().join("\0") !== [...questionIds].sort().join("\0"))
        throw new Error("questionsとgoldのquestion集合が一致しません");
    const labels = {};
    const inputDigests = {};
    for (const questionId of questionIds) {
        if (!LAYA_QUESTION_IDS.includes(questionId))
            throw new Error(`questionIdが不正です: ${questionId}`);
        const question = record(questions[questionId], `questions.${questionId}`);
        exactKeys(question, ["type", "instructions", "criteria"], `questions.${questionId}`);
        if (question.type !== "choice" ||
            typeof question.instructions !== "string" ||
            !question.instructions.trim())
            throw new Error(`question定義が不正です: ${questionId}`);
        const criteria = record(question.criteria, `criteria.${questionId}`);
        const classes = QUESTION_CLASSES[questionId];
        exactKeys(criteria, classes, `criteria.${questionId}`);
        if (Object.values(criteria).some((entry) => typeof entry !== "string" || !entry.trim()))
            throw new Error(`criteria説明が不正です: ${questionId}`);
        inputDigests[questionId] = digestLayaTrainingInput(state, questionId, question);
        const answer = record(gold[questionId], `gold.${questionId}`);
        exactKeys(answer, ["label", "probabilities"], `gold.${questionId}`);
        if (typeof answer.label !== "string" || !classes.includes(answer.label))
            throw new Error(`gold labelが不正です: ${questionId}`);
        labels[questionId] = answer.label;
        const probabilities = record(answer.probabilities, `probabilities.${questionId}`);
        exactKeys(probabilities, classes, `probabilities.${questionId}`);
        for (const name of classes) {
            const probability = probabilities[name];
            const expectedProbability = name === answer.label ? 1 : 0;
            if (probability !== expectedProbability)
                throw new Error(`gold probabilitiesはone-hotが必要です: ${questionId}`);
        }
    }
    const provenance = validateProvenance(value.provenance, manifest, labels, inputDigests, partition, bindings);
    if (provenance.sourceCaseId !== value.id)
        throw new Error("training row idとsourceCaseIdが一致しません");
    return value;
}
export function validateLayaTrainingDatasets(trainSource, validationSource, manifest, bindings) {
    const parse = (source, partition) => {
        const rows = source
            .split(/\r?\n/u)
            .filter((line) => line.length > 0)
            .map((line, index) => validateLayaTrainingRow(parseJsonStrict(line, `${partition} line ${index + 1}`), manifest, partition, bindings));
        if (rows.length === 0)
            throw new Error(`${partition} datasetが空です`);
        const ids = rows.map((row) => row.id);
        if (new Set(ids).size !== ids.length)
            throw new Error(`${partition} datasetに重複idがあります`);
        const sourceCaseIds = rows.map((row) => row.provenance.sourceCaseId);
        if (new Set(sourceCaseIds).size !== sourceCaseIds.length)
            throw new Error(`${partition} datasetに重複sourceCaseIdがあります`);
        return rows;
    };
    const train = parse(trainSource, "train");
    const validation = parse(validationSource, "validation");
    const trainIds = new Set(train.map((row) => row.id));
    const overlap = validation.find((row) => trainIds.has(row.id));
    if (overlap)
        throw new Error(`train/validationに重複idがあります: ${overlap.id}`);
    return { train, validation };
}
export function validateLayaValidationPredictions(source) {
    const predictions = source
        .split(/\r?\n/u)
        .filter((line) => line.length > 0)
        .map((line, index) => {
        const label = `prediction line ${index + 1}`;
        const value = record(parseJsonStrict(line, label), label);
        exactKeys(value, [
            "schemaVersion",
            "caseId",
            "questionId",
            "classes",
            "probabilities",
            "predicted",
            "gold",
        ], label);
        if (value.schemaVersion !== "asc/laya-validation-prediction/v1")
            throw new Error(`${label} schemaVersionが不正です`);
        if (typeof value.caseId !== "string" || !SAFE_ID.test(value.caseId))
            throw new Error(`${label} caseIdが不正です`);
        if (typeof value.questionId !== "string" ||
            !LAYA_QUESTION_IDS.includes(value.questionId))
            throw new Error(`${label} questionIdが不正です`);
        const questionId = value.questionId;
        const expectedClasses = QUESTION_CLASSES[questionId];
        if (!Array.isArray(value.classes) ||
            value.classes.length !== expectedClasses.length ||
            value.classes.some((entry, i) => entry !== expectedClasses[i]))
            throw new Error(`${label} classesが契約と一致しません`);
        const probabilities = record(value.probabilities, `${label} probabilities`);
        exactKeys(probabilities, expectedClasses, `${label} probabilities`);
        let sum = 0;
        for (const name of expectedClasses) {
            const probability = probabilities[name];
            if (typeof probability !== "number" ||
                !Number.isFinite(probability) ||
                probability < 0 ||
                probability > 1)
                throw new Error(`${label} probabilityが不正です: ${name}`);
            sum += probability;
        }
        if (Math.abs(sum - 1) > 1e-6)
            throw new Error(`${label} probability合計が1ではありません`);
        if (typeof value.predicted !== "string" ||
            !expectedClasses.includes(value.predicted) ||
            typeof value.gold !== "string" ||
            !expectedClasses.includes(value.gold))
            throw new Error(`${label} predicted/goldが不正です`);
        const maximum = Math.max(...expectedClasses.map((name) => probabilities[name]));
        if (probabilities[value.predicted] !== maximum)
            throw new Error(`${label} predictedがargmaxではありません`);
        return value;
    });
    if (predictions.length === 0)
        throw new Error("prediction datasetが空です");
    const keys = predictions.map((prediction) => `${prediction.caseId}\0${prediction.questionId}`);
    if (new Set(keys).size !== keys.length)
        throw new Error("predictionにcaseId/questionIdの重複があります");
    return predictions;
}
export function evaluateLayaValidationPredictions(predictions) {
    if (predictions.length === 0)
        throw new Error("prediction datasetが空です");
    const byQuestion = {};
    for (const questionId of LAYA_QUESTION_IDS) {
        const rows = predictions.filter((row) => row.questionId === questionId);
        if (rows.length === 0)
            continue;
        const classes = [...QUESTION_CLASSES[questionId]];
        const errors = [];
        const highConfidenceErrors = [];
        const f1 = [];
        const bins = Array.from({ length: 10 }, () => ({
            count: 0,
            confidence: 0,
            correct: 0,
        }));
        let brier = 0;
        let correctCount = 0;
        let highConfidence = 0;
        for (const row of rows) {
            const correct = row.predicted === row.gold;
            correctCount += correct ? 1 : 0;
            const key = `${row.caseId}:${questionId}`;
            if (!correct)
                errors.push(key);
            const confidence = row.probabilities[row.predicted];
            const bin = bins[Math.min(9, Math.floor(confidence * 10))];
            bin.count++;
            bin.confidence += confidence;
            bin.correct += correct ? 1 : 0;
            if (confidence >= 0.9) {
                highConfidence++;
                if (!correct)
                    highConfidenceErrors.push(key);
            }
            for (const name of classes)
                brier += (row.probabilities[name] - (row.gold === name ? 1 : 0)) ** 2;
        }
        for (const name of classes) {
            const tp = rows.filter((row) => row.gold === name && row.predicted === name).length;
            const fp = rows.filter((row) => row.gold !== name && row.predicted === name).length;
            const fn = rows.filter((row) => row.gold === name && row.predicted !== name).length;
            const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
            const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
            f1.push(precision + recall === 0
                ? 0
                : (2 * precision * recall) / (precision + recall));
        }
        byQuestion[questionId] = {
            classes,
            sampleCount: rows.length,
            accuracy: correctCount / rows.length,
            macroF1: f1.reduce((sum, value) => sum + value, 0) / f1.length,
            brier: brier / rows.length,
            expectedCalibrationError: bins.reduce((total, bin) => {
                if (bin.count === 0)
                    return total;
                return (total +
                    (bin.count / rows.length) *
                        Math.abs(bin.correct / bin.count - bin.confidence / bin.count));
            }, 0),
            highConfidenceErrorRate: highConfidence === 0
                ? null
                : highConfidenceErrors.length / highConfidence,
            highConfidenceErrorCaseQuestionIds: highConfidenceErrors.sort(),
            errorCaseQuestionIds: errors.sort(),
        };
    }
    const byCase = new Map();
    for (const prediction of predictions) {
        const answers = byCase.get(prediction.caseId) ??
            new Map();
        answers.set(prediction.questionId, prediction);
        byCase.set(prediction.caseId, answers);
    }
    let falseEscalationBase = 0;
    let falseEscalations = 0;
    let criticalBase = 0;
    let criticalCorrect = 0;
    const criticalMissCaseIds = [];
    for (const [caseId, answers] of byCase) {
        const validity = answers.get("finding-validity");
        const action = answers.get("required-action");
        const severity = answers.get("severity");
        if (validity?.gold === "no" || action?.gold === "dismiss") {
            falseEscalationBase++;
            if (validity?.predicted === "yes" || action?.predicted === "fix")
                falseEscalations++;
        }
        const actualCritical = severity?.gold === "critical" &&
            (validity?.gold === "yes" || action?.gold === "fix");
        if (actualCritical) {
            criticalBase++;
            if (validity?.predicted === "yes" || action?.predicted === "fix")
                criticalCorrect++;
            else
                criticalMissCaseIds.push(caseId);
        }
    }
    return {
        schemaVersion: "asc/laya-validation-evaluation/v1",
        sampleCount: predictions.length,
        byQuestion,
        safety: {
            falseEscalationRate: falseEscalationBase === 0
                ? null
                : falseEscalations / falseEscalationBase,
            criticalRecall: criticalBase === 0 ? null : criticalCorrect / criticalBase,
            criticalMissCaseIds: criticalMissCaseIds.sort(),
        },
    };
}
//# sourceMappingURL=laya-training-contract.js.map