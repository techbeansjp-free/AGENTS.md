import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseJsonStrict, resolveContained, stableJson, } from "../lib/security.js";
import { isRecord, } from "../types.js";
const ISSUE_INPUT_KEYS = [
    "repositoryRoot",
    "storeRoot",
    "retention",
    "baseSha",
    "issue",
    "scope",
    "role",
    "routeMode",
    "provider",
    "model",
    "modelSelection",
    "routingReason",
    "mappingVersion",
    "reasoningEffort",
    "serviceTier",
    "identity",
    "evaluatorRef",
];
const COMPLETION_INPUT_KEYS = [
    "repositoryRoot",
    "storeRoot",
    "retention",
    "routingEvidenceId",
    "implementationHead",
    "endState",
];
const STATE_INPUT_KEYS = [
    "repositoryRoot",
    "storeRoot",
    "retention",
    "routingEvidenceId",
    "state",
    "reason",
];
const RETENTION_KEYS = [
    "retentionDays",
    "maxRecordsPerIssue",
    "maxRecordBytes",
    "rotationCondition",
    "deletionMethod",
];
const EVIDENCE_KEYS = [
    "id",
    "routeMode",
    "provider",
    "model",
    "modelSelection",
    "routingReason",
    "mappingVersion",
    "reasoningEffort",
    "serviceTier",
    "role",
    "identity",
    "issue",
    "scope",
    "baseSha",
    "evaluatorRef",
    "issuedAt",
    "startState",
];
const COMPLETION_KEYS = [
    "id",
    "routingEvidenceId",
    "endState",
    "implementationHead",
    "recordedAt",
];
const STATE_KEYS = [
    "id",
    "routingEvidenceId",
    "state",
    "reason",
    "recordedAt",
];
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_STORE_ROOT = /^(?!\/)(?!\.\.\/)(?!.*\/\.\.\/)(?!.*\\)(?:[A-Za-z0-9._-]+\/)+$/u;
const SHA = /^[a-f0-9]{40}$/iu;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
function exactKeys(value, expected) {
    return (Object.keys(value).length === expected.length &&
        expected.every((key) => Object.hasOwn(value, key)));
}
function requireRecord(value, expected, label) {
    if (!isRecord(value) || !exactKeys(value, expected))
        throw new Error(`${label}に未知fieldまたは不足fieldがあります`);
    return value;
}
function safeIdentifier(value, label) {
    if (typeof value !== "string" ||
        value !== value.normalize("NFC") ||
        !SAFE_IDENTIFIER.test(value) ||
        EMAIL.test(value))
        throw new Error(`${label}はNFC正規化済みの安全な識別子でなければなりません`);
    return value;
}
function safeReason(value) {
    if (typeof value !== "string" ||
        value.trim() === "" ||
        value.length > 256 ||
        value !== value.normalize("NFC") ||
        CONTROL.test(value) ||
        EMAIL.test(value))
        throw new Error("state reasonは秘密・個人情報を含まない安全な文字列が必要です");
    return value;
}
function isoTimestamp(value, label) {
    if (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
        !Number.isFinite(Date.parse(value)))
        throw new Error(`${label}がISO 8601 UTC時刻ではありません`);
    return value;
}
function requireRetention(value) {
    const record = requireRecord(value, RETENTION_KEYS, "routing evidence保持方針");
    for (const key of [
        "retentionDays",
        "maxRecordsPerIssue",
        "maxRecordBytes",
    ]) {
        const item = record[key];
        if (typeof item !== "number" || !Number.isInteger(item) || item < 1)
            throw new Error(`routing evidence保持方針.${key}は1以上の整数が必要です`);
    }
    if (record.rotationCondition !== "oldest_first")
        throw new Error("routing evidence保持方針.rotationConditionが不正です");
    if (record.deletionMethod !== "preview_then_explicit")
        throw new Error("routing evidence保持方針.deletionMethodが不正です");
    return record;
}
function storage(input) {
    if (typeof input.repositoryRoot !== "string" || input.repositoryRoot === "")
        throw new Error("repository rootが必要です");
    if (!fs.existsSync(input.repositoryRoot))
        throw new Error("repository rootが存在しません");
    const repositoryRoot = fs.realpathSync(input.repositoryRoot);
    if (typeof input.storeRoot !== "string" ||
        input.storeRoot !== input.storeRoot.normalize("NFC") ||
        !SAFE_STORE_ROOT.test(input.storeRoot))
        throw new Error("evidence store rootはproject choiceの必須値です");
    const retention = requireRetention(input.retention);
    const storePath = resolveContained(repositoryRoot, input.storeRoot, {
        allowMissingLeaf: true,
    });
    return { repositoryRoot, storeRoot: input.storeRoot, retention, storePath };
}
function ensureStore(storePath, repositoryRoot) {
    fs.mkdirSync(storePath, { recursive: true, mode: 0o700 });
    const realStore = fs.realpathSync(storePath);
    const relative = path.relative(repositoryRoot, realStore);
    if (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative))
        throw new Error("evidence store rootの実体がrepository外を指しています");
}
function durableSyncDirectory(directory) {
    const descriptor = fs.openSync(directory, "r");
    try {
        fs.fsyncSync(descriptor);
    }
    finally {
        fs.closeSync(descriptor);
    }
}
function containedRecordPath(storePath, relative) {
    return resolveContained(storePath, relative, { allowMissingLeaf: true });
}
function verifyContainedParent(storePath, destination) {
    const parent = path.dirname(destination);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const relative = path.relative(fs.realpathSync(storePath), fs.realpathSync(parent));
    if (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative))
        throw new Error("evidence record directoryがstore外を指しています");
}
function createAtomicExclusive(storePath, destination, contents) {
    const parent = path.dirname(destination);
    verifyContainedParent(storePath, destination);
    const lock = `${destination}.lock`;
    const lockDescriptor = acquireRecordLock(lock);
    fs.closeSync(lockDescriptor);
    const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
    try {
        if (fs.existsSync(destination))
            throw new Error("同一識別子のrecordが既に存在します");
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, contents, "utf8");
            fs.fsyncSync(descriptor);
        }
        finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(temporary, destination);
        durableSyncDirectory(parent);
    }
    finally {
        fs.rmSync(temporary, { force: true });
        fs.rmSync(lock, { force: true });
    }
}
function lockKey(domain, value) {
    return `${domain}-${crypto.createHash("sha256").update(stableJson(value)).digest("hex")}`;
}
function acquireRecordLock(lock) {
    try {
        return fs.openSync(lock, "wx", 0o600);
    }
    catch (error) {
        if (error.code === "EEXIST")
            throw new Error(`evidence store lockを取得できません。別処理の完了を確認し、異常終了で残存した場合だけlockを手動削除してください: ${lock}`, { cause: error });
        throw error;
    }
}
function withExclusiveRecordLock(storePath, key, action) {
    const lock = containedRecordPath(storePath, `.locks/${key}.lock`);
    verifyContainedParent(storePath, lock);
    const descriptor = acquireRecordLock(lock);
    try {
        return action();
    }
    finally {
        fs.closeSync(descriptor);
        fs.rmSync(lock, { force: true });
    }
}
function json(record, maxBytes) {
    const source = `${JSON.stringify(record, null, 2)}\n`;
    if (Buffer.byteLength(source) > maxBytes)
        throw new Error("routing evidence recordが容量上限を超えています");
    return source;
}
function timestampSlug(timestamp) {
    return timestamp.replace(/[^0-9]/gu, "");
}
function evidencePath(storePath, id) {
    return resolveContained(storePath, `routing/${safeIdentifier(id, "routing evidence id")}.json`, {
        allowMissingLeaf: true,
    });
}
function readJsonFile(file, label) {
    return parseJsonStrict(fs.readFileSync(file, "utf8"), label);
}
function isRoutingRole(value) {
    return (value === "coordinator" || value === "implementer" || value === "reviewer");
}
const FALLBACK_REASONS = new Set([
    "preferred_implementer_unavailable",
    "preferred_capability_mapping_missing",
    "preferred_capability_unconfirmed",
    "preferred_selection_source_unconfirmed",
    "preferred_model_catalog_empty",
    "preferred_recommended_default_missing",
    "preferred_recommended_default_ambiguous",
    "preferred_reasoning_effort_unsupported",
]);
function hasConsistentRoutingBinding(record) {
    if (record.routeMode === "preferred")
        return (record.modelSelection === "provider_recommended_default" &&
            record.routingReason === "preferred_implementer_available" &&
            record.model !== "project_default");
    return (record.routeMode === "fallback" &&
        record.modelSelection === "project_default" &&
        record.model === "project_default" &&
        FALLBACK_REASONS.has(record.routingReason));
}
function readRoutingEvidenceFile(file) {
    const record = requireRecord(readJsonFile(file, "routing evidence"), EVIDENCE_KEYS, "routing evidence");
    if (!isRoutingRole(record.role) ||
        (record.routeMode !== "preferred" && record.routeMode !== "fallback") ||
        (record.modelSelection !== "provider_recommended_default" &&
            record.modelSelection !== "project_default") ||
        !hasConsistentRoutingBinding(record) ||
        record.reasoningEffort !== "high" ||
        record.serviceTier !== "default" ||
        record.startState !== "issued" ||
        typeof record.issue !== "number" ||
        !Number.isInteger(record.issue) ||
        record.issue < 1 ||
        typeof record.baseSha !== "string" ||
        !SHA.test(record.baseSha))
        throw new Error("routing evidenceの拘束値が不正です");
    for (const key of [
        "id",
        "provider",
        "model",
        "mappingVersion",
        "identity",
        "scope",
        "evaluatorRef",
    ])
        safeIdentifier(record[key], `routing evidence.${key}`);
    safeReason(record.routingReason);
    isoTimestamp(record.issuedAt, "routing evidence.issuedAt");
    return record;
}
function listJson(directory) {
    if (!fs.existsSync(directory))
        return [];
    if (fs.lstatSync(directory).isSymbolicLink())
        throw new Error("evidence record directoryにsymlinkは使えません");
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.name.endsWith(".json"))
        .map((entry) => path.join(directory, entry.name))
        .sort();
}
function listRoutingEvidence(storePath) {
    return listJson(containedRecordPath(storePath, "routing")).map(readRoutingEvidenceFile);
}
function validateIssueInput(value) {
    const record = requireRecord(value, ISSUE_INPUT_KEYS, "routing evidence発行入力");
    const validatedStorage = storage(record);
    if (typeof record.issue !== "number" ||
        !Number.isInteger(record.issue) ||
        record.issue < 1 ||
        !isRoutingRole(record.role) ||
        (record.routeMode !== "preferred" && record.routeMode !== "fallback") ||
        (record.modelSelection !== "provider_recommended_default" &&
            record.modelSelection !== "project_default") ||
        !hasConsistentRoutingBinding(record) ||
        record.reasoningEffort !== "high" ||
        record.serviceTier !== "default" ||
        typeof record.baseSha !== "string" ||
        !SHA.test(record.baseSha))
        throw new Error("routing evidence発行入力の拘束値が不正です");
    for (const key of [
        "scope",
        "provider",
        "model",
        "mappingVersion",
        "identity",
        "evaluatorRef",
    ])
        safeIdentifier(record[key], `routing evidence発行入力.${key}`);
    safeReason(record.routingReason);
    return {
        input: record,
        storage: validatedStorage,
    };
}
export function issueRoutingEvidence(value, now = () => new Date()) {
    const { input, storage: validatedStorage } = validateIssueInput(value);
    const issuedAt = now().toISOString();
    isoTimestamp(issuedAt, "routing evidence issuedAt");
    const id = safeIdentifier(`routing-${input.issue}-${input.scope}-${input.baseSha.slice(0, 12)}-${timestampSlug(issuedAt)}`, "routing evidence id");
    const evidence = {
        id,
        routeMode: input.routeMode,
        provider: input.provider,
        model: input.model,
        modelSelection: input.modelSelection,
        routingReason: input.routingReason,
        mappingVersion: input.mappingVersion,
        reasoningEffort: input.reasoningEffort,
        serviceTier: input.serviceTier,
        role: input.role,
        identity: input.identity,
        issue: input.issue,
        scope: input.scope,
        baseSha: input.baseSha.toLowerCase(),
        evaluatorRef: input.evaluatorRef,
        issuedAt,
        startState: "issued",
    };
    const source = json(evidence, validatedStorage.retention.maxRecordBytes);
    ensureStore(validatedStorage.storePath, validatedStorage.repositoryRoot);
    withExclusiveRecordLock(validatedStorage.storePath, lockKey("binding", [evidence.issue, evidence.scope, evidence.baseSha]), () => {
        const issueRecords = listRoutingEvidence(validatedStorage.storePath).filter((record) => record.issue === evidence.issue);
        const activeDuplicate = issueRecords.some((record) => record.scope === evidence.scope &&
            record.baseSha === evidence.baseSha &&
            (stateRecords(validatedStorage.storePath, record.id).at(-1)?.state ??
                "issued") === "issued");
        if (activeDuplicate)
            throw new Error("同じIssue、scope、base SHAの有効なrouting evidenceが既に存在します");
        if (issueRecords.length >= validatedStorage.retention.maxRecordsPerIssue)
            throw new Error("routing evidenceのIssue単位件数上限に達しています");
        createAtomicExclusive(validatedStorage.storePath, evidencePath(validatedStorage.storePath, id), source);
    });
    return evidence;
}
export function assertRoutingEvidenceBinding(evidence, issue, scope) {
    safeIdentifier(scope, "scope");
    if (evidence.issue !== issue || evidence.scope !== scope)
        throw new Error("routing evidenceを別Issueまたは別scopeへ再利用できません");
}
function requireExistingEvidence(storePath, id) {
    const file = evidencePath(storePath, id);
    if (!fs.existsSync(file))
        throw new Error("routing evidenceが存在しません");
    return readRoutingEvidenceFile(file);
}
function readCompletionRecord(file) {
    const record = requireRecord(readJsonFile(file, "completion record"), COMPLETION_KEYS, "completion record");
    if ((record.endState !== "completed" && record.endState !== "interrupted") ||
        typeof record.implementationHead !== "string" ||
        !SHA.test(record.implementationHead))
        throw new Error("completion recordの終了状態またはheadが不正です");
    safeIdentifier(record.id, "completion record id");
    safeIdentifier(record.routingEvidenceId, "completion routing evidence id");
    isoTimestamp(record.recordedAt, "completion recordedAt");
    return record;
}
function completionRecords(storePath, evidenceId) {
    return listJson(containedRecordPath(storePath, "completion"))
        .map(readCompletionRecord)
        .filter((record) => record.routingEvidenceId === evidenceId)
        .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}
export function appendCompletionRecord(value, now = () => new Date()) {
    const record = requireRecord(value, COMPLETION_INPUT_KEYS, "completion record入力");
    const validatedStorage = storage(record);
    const evidenceId = safeIdentifier(record.routingEvidenceId, "routing evidence id");
    if ((record.endState !== "completed" && record.endState !== "interrupted") ||
        typeof record.implementationHead !== "string" ||
        !SHA.test(record.implementationHead))
        throw new Error("completion recordの終了状態またはimplementation headが不正です");
    const recordedAt = now().toISOString();
    const completion = {
        id: safeIdentifier(`completion-${evidenceId}-${timestampSlug(recordedAt)}`, "completion record id"),
        routingEvidenceId: evidenceId,
        endState: record.endState,
        implementationHead: record.implementationHead.toLowerCase(),
        recordedAt,
    };
    withExclusiveRecordLock(validatedStorage.storePath, lockKey("evidence", evidenceId), () => {
        requireExistingEvidence(validatedStorage.storePath, evidenceId);
        if (completionRecords(validatedStorage.storePath, evidenceId).length > 0)
            throw new Error("同一routing evidenceのcompletion recordは1件だけ追記できます");
        createAtomicExclusive(validatedStorage.storePath, containedRecordPath(validatedStorage.storePath, `completion/${completion.id}.json`), json(completion, validatedStorage.retention.maxRecordBytes));
    });
    return completion;
}
function readStateRecord(file) {
    const record = requireRecord(readJsonFile(file, "evidence state record"), STATE_KEYS, "evidence state record");
    if (record.state !== "superseded" && record.state !== "invalidated")
        throw new Error("evidence state recordのstateが不正です");
    safeIdentifier(record.id, "evidence state record id");
    safeIdentifier(record.routingEvidenceId, "state routing evidence id");
    safeReason(record.reason);
    isoTimestamp(record.recordedAt, "state recordedAt");
    return record;
}
function stateRecords(storePath, evidenceId) {
    return listJson(containedRecordPath(storePath, "states"))
        .map(readStateRecord)
        .filter((record) => record.routingEvidenceId === evidenceId)
        .sort((left, right) => left.recordedAt === right.recordedAt
        ? left.id.localeCompare(right.id)
        : left.recordedAt.localeCompare(right.recordedAt));
}
export function appendEvidenceStateRecord(value, now = () => new Date()) {
    const record = requireRecord(value, STATE_INPUT_KEYS, "evidence state record入力");
    const validatedStorage = storage(record);
    const evidenceId = safeIdentifier(record.routingEvidenceId, "routing evidence id");
    if (record.state !== "superseded" && record.state !== "invalidated")
        throw new Error("evidence stateはsupersededまたはinvalidatedだけを追記できます");
    const reason = safeReason(record.reason);
    const recordedAt = now().toISOString();
    const stateRecord = {
        id: safeIdentifier(`state-${evidenceId}-${timestampSlug(recordedAt)}-${record.state}`, "evidence state record id"),
        routingEvidenceId: evidenceId,
        state: record.state,
        reason,
        recordedAt,
    };
    withExclusiveRecordLock(validatedStorage.storePath, lockKey("evidence", evidenceId), () => {
        requireExistingEvidence(validatedStorage.storePath, evidenceId);
        createAtomicExclusive(validatedStorage.storePath, containedRecordPath(validatedStorage.storePath, `states/${stateRecord.id}.json`), json(stateRecord, validatedStorage.retention.maxRecordBytes));
    });
    return stateRecord;
}
export function getEffectiveEvidenceState(value, evidenceId) {
    const validatedStorage = storage(value);
    requireExistingEvidence(validatedStorage.storePath, evidenceId);
    return (stateRecords(validatedStorage.storePath, evidenceId).at(-1)?.state ??
        "issued");
}
export function evaluateRoutingEvidenceHead(value, evidenceId, currentHead) {
    if (!SHA.test(currentHead))
        throw new Error("current headが40桁SHAではありません");
    const validatedStorage = storage(value);
    requireExistingEvidence(validatedStorage.storePath, evidenceId);
    const effectiveState = getEffectiveEvidenceState(value, evidenceId);
    return {
        routingEvidenceValid: effectiveState === "issued",
        effectiveState,
        completionRecords: completionRecords(validatedStorage.storePath, evidenceId).map((record) => ({
            endState: record.endState,
            implementationHead: record.implementationHead,
            validForCurrentHead: record.implementationHead.toLowerCase() === currentHead.toLowerCase(),
        })),
    };
}
function previewDigest(targetIds, retention) {
    return crypto
        .createHash("sha256")
        .update(stableJson({
        domain: "agent-skill-chain/routing-evidence-prune/v1",
        retention,
        targetIds,
    }))
        .digest("hex");
}
export function previewEvidencePrune(value, now = () => new Date()) {
    const validatedStorage = storage(value);
    if (!fs.existsSync(validatedStorage.storePath)) {
        const targetIds = [];
        return {
            targetIds,
            digest: previewDigest(targetIds, validatedStorage.retention),
        };
    }
    const records = listRoutingEvidence(validatedStorage.storePath);
    const cutoff = now().getTime() - validatedStorage.retention.retentionDays * 86_400_000;
    const targets = new Set(records
        .filter((record) => Date.parse(record.issuedAt) < cutoff)
        .map((record) => record.id));
    const byIssue = new Map();
    for (const record of records) {
        const issueRecords = byIssue.get(record.issue) ?? [];
        issueRecords.push(record);
        byIssue.set(record.issue, issueRecords);
        const file = evidencePath(validatedStorage.storePath, record.id);
        if (fs.statSync(file).size > validatedStorage.retention.maxRecordBytes)
            targets.add(record.id);
    }
    for (const issueRecords of byIssue.values()) {
        const ordered = issueRecords.sort((left, right) => left.issuedAt.localeCompare(right.issuedAt));
        for (const record of ordered.slice(0, Math.max(0, ordered.length - validatedStorage.retention.maxRecordsPerIssue + 1)))
            targets.add(record.id);
    }
    const targetIds = [...targets].sort();
    return {
        targetIds,
        digest: previewDigest(targetIds, validatedStorage.retention),
    };
}
function auditStartFile(storePath, digest) {
    if (!/^[a-f0-9]{64}$/u.test(digest))
        throw new Error("承認済みprune digestが不正です");
    return containedRecordPath(storePath, `prune-audits/prune-${digest}/start.json`);
}
function readAuditStart(file) {
    const record = requireRecord(readJsonFile(file, "prune audit start"), ["id", "approvedDigest", "targetIds", "startedAt"], "prune audit start");
    if (typeof record.approvedDigest !== "string" ||
        !/^[a-f0-9]{64}$/u.test(record.approvedDigest) ||
        !Array.isArray(record.targetIds) ||
        record.targetIds.some((id) => typeof id !== "string" || !SAFE_IDENTIFIER.test(id)) ||
        new Set(record.targetIds).size !== record.targetIds.length)
        throw new Error("prune audit startの承認情報が不正です");
    safeIdentifier(record.id, "prune audit id");
    isoTimestamp(record.startedAt, "prune audit startedAt");
    return record;
}
function readTombstone(file) {
    const record = requireRecord(readJsonFile(file, "routing evidence tombstone"), ["routingEvidenceId", "pruneAuditId", "deletedAt"], "routing evidence tombstone");
    safeIdentifier(record.routingEvidenceId, "tombstone routing evidence id");
    safeIdentifier(record.pruneAuditId, "tombstone prune audit id");
    isoTimestamp(record.deletedAt, "tombstone deletedAt");
    return record;
}
function readPruneOutcome(file) {
    const record = requireRecord(readJsonFile(file, "prune outcome"), ["routingEvidenceId", "outcome", "recordedAt"], "prune outcome");
    safeIdentifier(record.routingEvidenceId, "prune outcome routing evidence id");
    if (record.outcome !== "succeeded" && record.outcome !== "failed")
        throw new Error("prune outcomeの結果が不正です");
    isoTimestamp(record.recordedAt, "prune outcome recordedAt");
    return record;
}
function relatedRecordFiles(storePath, directory, evidenceId) {
    return listJson(containedRecordPath(storePath, directory)).filter((file) => {
        const record = directory === "completion"
            ? readCompletionRecord(file)
            : readStateRecord(file);
        return record.routingEvidenceId === evidenceId;
    });
}
function latestOutcome(storePath, auditId, evidenceId) {
    const directory = containedRecordPath(storePath, `prune-audits/${safeIdentifier(auditId, "prune audit id")}/outcomes`);
    const outcomes = listJson(directory)
        .map(readPruneOutcome)
        .filter((value) => value.routingEvidenceId === evidenceId)
        .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
    return outcomes.at(-1);
}
function appendPruneOutcome(storePath, auditId, evidenceId, outcome, recordedAt, maxBytes) {
    const record = {
        routingEvidenceId: evidenceId,
        outcome,
        recordedAt,
    };
    const id = safeIdentifier(`outcome-${evidenceId}-${timestampSlug(recordedAt)}-${outcome}`, "prune outcome id");
    createAtomicExclusive(storePath, containedRecordPath(storePath, `prune-audits/${safeIdentifier(auditId, "prune audit id")}/outcomes/${id}.json`), json(record, maxBytes));
}
export function applyEvidencePrune(value, now = () => new Date(), dependencies = {}) {
    const record = requireRecord(value, [
        "repositoryRoot",
        "storeRoot",
        "retention",
        "approvedDigest",
        "targetIds",
        "authorize",
    ], "evidence prune apply入力");
    const validatedStorage = storage(record);
    if (record.authorize !== "approved")
        throw new Error("evidence prune applyにはauthorize=approvedが必要です");
    if (typeof record.approvedDigest !== "string" ||
        !/^[a-f0-9]{64}$/u.test(record.approvedDigest) ||
        !Array.isArray(record.targetIds))
        throw new Error("evidence pruneのdigestまたは対象id一覧が不正です");
    const approvedDigest = record.approvedDigest;
    const targetIds = record.targetIds.map((id) => safeIdentifier(id, "evidence prune対象id"));
    if (new Set(targetIds).size !== targetIds.length ||
        stableJson(targetIds) !== stableJson([...targetIds].sort()))
        throw new Error("evidence pruneの対象id一覧は字句順でなければなりません");
    ensureStore(validatedStorage.storePath, validatedStorage.repositoryRoot);
    const startFile = auditStartFile(validatedStorage.storePath, approvedDigest);
    let audit;
    if (fs.existsSync(startFile)) {
        audit = readAuditStart(startFile);
        if (audit.approvedDigest !== approvedDigest ||
            stableJson(audit.targetIds) !== stableJson(targetIds))
            throw new Error("既存PruneAuditRecordと承認済み対象が一致しません");
    }
    else {
        const current = previewEvidencePrune(record, now);
        if (current.digest !== approvedDigest ||
            stableJson(current.targetIds) !== stableJson(targetIds))
            throw new Error("承認済みpreviewと現在の削除対象が一致しません");
        audit = {
            id: safeIdentifier(`prune-${approvedDigest}`, "prune audit id"),
            approvedDigest,
            targetIds,
            startedAt: now().toISOString(),
        };
        createAtomicExclusive(validatedStorage.storePath, startFile, json(audit, validatedStorage.retention.maxRecordBytes));
        const confirmed = readAuditStart(startFile);
        if (stableJson(confirmed) !== stableJson(audit))
            throw new Error("PruneAuditRecordの書き込み確認に失敗しました");
    }
    const remove = dependencies.remove ?? ((file) => fs.rmSync(file, { force: true }));
    const completed = [];
    for (const evidenceId of audit.targetIds) {
        withExclusiveRecordLock(validatedStorage.storePath, lockKey("evidence", evidenceId), () => {
            const previous = latestOutcome(validatedStorage.storePath, audit.id, evidenceId);
            if (previous?.outcome === "succeeded") {
                completed.push(evidenceId);
                return;
            }
            const tombstoneFile = containedRecordPath(validatedStorage.storePath, `tombstones/${evidenceId}.json`);
            if (!fs.existsSync(tombstoneFile)) {
                const tombstone = {
                    routingEvidenceId: evidenceId,
                    pruneAuditId: audit.id,
                    deletedAt: now().toISOString(),
                };
                createAtomicExclusive(validatedStorage.storePath, tombstoneFile, json(tombstone, validatedStorage.retention.maxRecordBytes));
                const confirmed = readJsonFile(tombstoneFile, "routing evidence tombstone");
                if (stableJson(confirmed) !== stableJson(tombstone))
                    throw new Error("tombstoneの書き込み確認に失敗しました");
            }
            else {
                const existingTombstone = readTombstone(tombstoneFile);
                if (existingTombstone.routingEvidenceId !== evidenceId ||
                    existingTombstone.pruneAuditId !== audit.id)
                    throw new Error("既存tombstoneがPruneAuditRecordと一致しません");
            }
            try {
                const files = [
                    evidencePath(validatedStorage.storePath, evidenceId),
                    ...relatedRecordFiles(validatedStorage.storePath, "completion", evidenceId),
                    ...relatedRecordFiles(validatedStorage.storePath, "states", evidenceId),
                ];
                for (const file of files)
                    if (fs.existsSync(file))
                        remove(file);
                appendPruneOutcome(validatedStorage.storePath, audit.id, evidenceId, "succeeded", now().toISOString(), validatedStorage.retention.maxRecordBytes);
                completed.push(evidenceId);
            }
            catch (error) {
                appendPruneOutcome(validatedStorage.storePath, audit.id, evidenceId, "failed", now().toISOString(), validatedStorage.retention.maxRecordBytes);
                throw new Error(`routing evidenceの削除に失敗しました: ${evidenceId}`, { cause: error });
            }
        });
    }
    return { auditId: audit.id, completed };
}
//# sourceMappingURL=routing-evidence.js.map