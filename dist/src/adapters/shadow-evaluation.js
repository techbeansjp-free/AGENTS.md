import fs from "node:fs";
import path from "node:path";
import { isRecord } from "../types.js";
import { parseJsonStrict } from "../lib/security.js";
import { parseDecisionJournalLine } from "./decision-journal-store.js";
import { parseJevShadowLine } from "./jev-shadow-store.js";
import { parseEvaluationLabelInput } from "../domain/evaluation-label.js";
import { evaluateShadowRecords, evaluationId, } from "../domain/shadow-evaluation.js";
import { resolveGitWorkspace } from "./review-workspace.js";
import { assertWorkflowStaging } from "./workflow-journal.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
const ID = /^DR-[a-f0-9]{16}$/u;
const SOURCES = [
    "events.jsonl",
    "jev-shadow.jsonl",
    "evaluation-labels.jsonl",
];
const FIELDS = {
    "events.jsonl": [
        "decisionRecordId",
        "decisionTypeId",
        "inputDigest",
        "subjectRef",
        "candidateHeadSha",
        "executor",
        "providerModel",
        "providerVersion",
        "proposedValue",
        "effectiveValue",
        "authorityMode",
        "adjudicationReason",
        "latencyMs",
        "cost",
        "decidedAt",
    ],
    "jev-shadow.jsonl": [
        "decisionRecordId",
        "decisionTypeId",
        "candidateHeadSha",
        "primaryProposedValue",
        "primaryAuthorityMode",
        "jevModel",
        "jevResolvedModel",
        "jevProposedValue",
        "jevConfidence",
        "outcomeKind",
        "outcomeDetail",
        "matchesPrimaryProposedValue",
        "inputTokens",
        "outputTokens",
        "latencyMs",
        "dispatchedAt",
    ],
    "evaluation-labels.jsonl": [
        "decisionRecordId",
        "referenceValue",
        "labelSource",
        "evidenceRefs",
        "labeledAt",
    ],
};
function invalid() {
    throw new Error("invalid-record");
}
function validTime(v) {
    return (typeof v === "string" &&
        Number.isFinite(Date.parse(v)) &&
        new Date(v).toISOString() === v);
}
function validate(value, source) {
    if (!isRecord(value) ||
        Object.keys(value).some((k) => !FIELDS[source].includes(k)) ||
        typeof value.decisionRecordId !== "string" ||
        !ID.test(value.decisionRecordId))
        return invalid();
    const time = source === "events.jsonl"
        ? value.decidedAt
        : source === "jev-shadow.jsonl"
            ? value.dispatchedAt
            : value.labeledAt;
    if (!validTime(time))
        return invalid();
    if (source !== "evaluation-labels.jsonl") {
        if (typeof value.candidateHeadSha !== "string" ||
            !/^[a-f0-9]{40}$/u.test(value.candidateHeadSha) ||
            typeof value.decisionTypeId !== "string" ||
            !/^DCAND-\d{3}$/u.test(value.decisionTypeId))
            return invalid();
    }
    if (source === "events.jsonl") {
        if (typeof value.inputDigest !== "string" ||
            !/^[a-f0-9]{64}$/u.test(value.inputDigest) ||
            !isRecord(value.executor) ||
            Object.keys(value.executor).some((k) => !["kind", "resolverId", "target", "model"].includes(k)))
            return invalid();
    }
    if (source === "jev-shadow.jsonl") {
        for (const key of ["inputTokens", "outputTokens"])
            if (!Number.isSafeInteger(value[key]) || value[key] < 0)
                return invalid();
        if (value.jevConfidence !== null &&
            (typeof value.jevConfidence !== "number" ||
                !Number.isFinite(value.jevConfidence) ||
                value.jevConfidence < 0 ||
                value.jevConfidence > 1))
            return invalid();
        if (value.outcomeKind === "ok") {
            if (typeof value.jevProposedValue !== "string" ||
                typeof value.jevResolvedModel !== "string" ||
                value.outcomeDetail !== null ||
                value.matchesPrimaryProposedValue !==
                    (value.jevProposedValue === value.primaryProposedValue))
                return invalid();
        }
        else if (value.jevProposedValue !== null ||
            value.jevResolvedModel !== null ||
            value.jevConfidence !== null ||
            value.matchesPrimaryProposedValue !== null)
            return invalid();
    }
    return value;
}
/** 全祖先を読取前後に検査する。既存writerへ新たな権限を与えない。 */
function snapshot(root, target) {
    const parts = path.relative(root, target).split(path.sep);
    let current = root;
    const values = [];
    for (const [i, part] of parts.entries()) {
        current = path.join(current, part);
        let stat;
        try {
            stat = fs.lstatSync(current);
        }
        catch (error) {
            if (error.code === "ENOENT") {
                values.push("missing");
                break;
            }
            throw error;
        }
        const last = i === parts.length - 1;
        if (stat.isSymbolicLink() ||
            (last ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()))
            throw new Error("shadow-evaluation unsafe-path");
        values.push([
            stat.dev,
            stat.ino,
            last ? stat.size : 0,
            last ? stat.mtimeMs : 0,
            last ? stat.ctimeMs : 0,
        ].join(":"));
    }
    return values.join("/");
}
function selectedId(root, raw) {
    if (raw === "" ||
        /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\ufeff]/u.test(raw) ||
        raw.split(/[\\/]/u).some((x) => x === ".." || x === "."))
        throw new Error("shadow-evaluation invalid-staging");
    if (raw.includes("/") || raw.includes("\\")) {
        const resolved = assertWorkflowStaging(path.resolve(root, raw));
        if (stagingRepositoryRoot(resolved) !== root)
            throw new Error("shadow-evaluation invalid-staging");
        return path.basename(resolved);
    }
    return raw;
}
function readInput(root, staging) {
    const input = {
        staging,
        decisions: [],
        shadows: [],
        labels: [],
        unavailable: false,
        diagnostics: [],
        invalidKeys: [],
    };
    const badKeys = [];
    const directory = path.join(root, ".agent-skill-chain/runtime/decisions", staging);
    const files = SOURCES.map((source) => path.join(directory, source));
    const before = files.map((file) => snapshot(root, file));
    const diagnostic = (code, source, line) => input.diagnostics.push({
        code,
        stagingId: evaluationId(staging),
        ...(source ? { source } : {}),
        ...(line ? { line } : {}),
    });
    for (const [index, source] of SOURCES.entries()) {
        const file = files[index];
        if (before[index].endsWith("missing")) {
            diagnostic("missing-journal", source);
            continue;
        }
        let text;
        try {
            const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            try {
                const st = fs.fstatSync(fd);
                if (!st.isFile() || st.nlink !== 1)
                    throw new Error("unsafe");
                text = fs.readFileSync(fd, "utf8");
            }
            finally {
                fs.closeSync(fd);
            }
        }
        catch {
            input.unavailable = true;
            diagnostic("read-unavailable", source);
            continue;
        }
        for (const [lineIndex, line] of text.split(/\r?\n/u).entries()) {
            if (!line.trim())
                continue;
            let raw;
            try {
                raw = parseJsonStrict(line, "evaluation");
                const value = validate(raw, source);
                if (source === "events.jsonl")
                    input.decisions.push(parseDecisionJournalLine(value));
                else if (source === "jev-shadow.jsonl")
                    input.shadows.push(parseJevShadowLine(value));
                else
                    input.labels.push(parseEvaluationLabelInput(value.labelSource === "owner-adjudicated" &&
                        Array.isArray(value.evidenceRefs) &&
                        value.evidenceRefs.length === 0
                        ? { ...value, evidenceRefs: undefined }
                        : value));
            }
            catch {
                if (isRecord(raw) &&
                    typeof raw.decisionRecordId === "string" &&
                    ID.test(raw.decisionRecordId))
                    badKeys.push(raw.decisionRecordId);
                else
                    input.unavailable = true;
                diagnostic("invalid-record", source, lineIndex + 1);
            }
        }
    }
    input.invalidKeys = badKeys;
    if (files.some((file, i) => snapshot(root, file) !== before[i])) {
        input.unavailable = true;
        diagnostic("source-changed");
    }
    return input;
}
/** 指定したstagingだけをprimary worktreeの耐久記録から読み取る。 */
export function buildShadowEvaluation(input) {
    if (!input.stagings.length)
        throw new Error("shadow-evaluation staging-required");
    let active, primary;
    try {
        active = fs.realpathSync(input.root);
        primary = resolveGitWorkspace(active).primaryRoot;
    }
    catch {
        throw new Error("shadow-evaluation invalid-root");
    }
    let ids;
    try {
        ids = [...new Set(input.stagings.map((s) => selectedId(active, s)))].sort();
    }
    catch {
        throw new Error("shadow-evaluation invalid-staging");
    }
    return evaluateShadowRecords(ids.map((id) => {
        try {
            return readInput(primary, id);
        }
        catch (error) {
            if (error instanceof Error &&
                error.message === "shadow-evaluation unsafe-path")
                throw error;
            return {
                staging: id,
                decisions: [],
                shadows: [],
                labels: [],
                unavailable: true,
                diagnostics: [
                    { code: "read-unavailable", stagingId: evaluationId(id) },
                ],
            };
        }
    }));
}
export function unavailableShadowEvaluation(staging) {
    const diagnostics = [
        {
            code: "read-unavailable",
            stagingId: evaluationId(path.basename(staging)),
        },
    ];
    return evaluateShadowRecords([
        {
            staging: path.basename(staging),
            decisions: [],
            shadows: [],
            labels: [],
            diagnostics,
            unavailable: true,
        },
    ]);
}
//# sourceMappingURL=shadow-evaluation.js.map