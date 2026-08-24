import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  parseJsonStrict,
  resolveContained,
  stableJson,
} from "../lib/security.js";
import {
  isRecord,
  type RoutingEvidenceRetentionChoice,
  type RoutingRole,
} from "../types.js";

export type EvidenceState = "issued" | "superseded" | "invalidated";
export type CompletionState = "completed" | "interrupted";

export interface RoutingEvidence {
  id: string;
  provider: string;
  model: string;
  mappingVersion: string;
  reasoningEffort: "high";
  serviceTier: "default";
  role: RoutingRole;
  identity: string;
  issue: number;
  scope: string;
  baseSha: string;
  evaluatorRef: string;
  issuedAt: string;
  startState: "issued";
}

export interface CompletionRecord {
  id: string;
  routingEvidenceId: string;
  endState: CompletionState;
  implementationHead: string;
  recordedAt: string;
}

export interface EvidenceStateRecord {
  id: string;
  routingEvidenceId: string;
  state: Exclude<EvidenceState, "issued">;
  reason: string;
  recordedAt: string;
}

type RetentionInput = Partial<RoutingEvidenceRetentionChoice> | undefined;

interface EvidenceStorageInput {
  repositoryRoot: string;
  storeRoot?: string;
  retention?: RetentionInput;
}

export interface RoutingEvidenceIssueInput extends EvidenceStorageInput {
  baseSha: string;
  issue: number;
  scope: string;
  role: RoutingRole;
  provider: string;
  model: string;
  mappingVersion: string;
  reasoningEffort: "high";
  serviceTier: "default";
  identity: string;
  evaluatorRef: string;
}

export interface CompletionRecordInput extends EvidenceStorageInput {
  routingEvidenceId: string;
  implementationHead: string;
  endState: CompletionState;
}

export interface EvidenceStateRecordInput extends EvidenceStorageInput {
  routingEvidenceId: string;
  state: Exclude<EvidenceState, "issued">;
  reason: string;
}

export interface EvidencePrunePreview {
  targetIds: string[];
  digest: string;
}

export interface EvidencePruneInput extends EvidenceStorageInput {
  approvedDigest: string;
  targetIds: string[];
  authorize: "approved";
}

interface PruneAuditStart {
  id: string;
  approvedDigest: string;
  targetIds: string[];
  startedAt: string;
}

interface Tombstone {
  routingEvidenceId: string;
  pruneAuditId: string;
  deletedAt: string;
}

interface PruneOutcome {
  routingEvidenceId: string;
  outcome: "succeeded" | "failed";
  recordedAt: string;
}

const ISSUE_INPUT_KEYS = [
  "repositoryRoot",
  "storeRoot",
  "retention",
  "baseSha",
  "issue",
  "scope",
  "role",
  "provider",
  "model",
  "mappingVersion",
  "reasoningEffort",
  "serviceTier",
  "identity",
  "evaluatorRef",
] as const;
const COMPLETION_INPUT_KEYS = [
  "repositoryRoot",
  "storeRoot",
  "retention",
  "routingEvidenceId",
  "implementationHead",
  "endState",
] as const;
const STATE_INPUT_KEYS = [
  "repositoryRoot",
  "storeRoot",
  "retention",
  "routingEvidenceId",
  "state",
  "reason",
] as const;
const RETENTION_KEYS = [
  "retentionDays",
  "maxRecordsPerIssue",
  "maxRecordBytes",
  "rotationCondition",
  "deletionMethod",
] as const;
const EVIDENCE_KEYS = [
  "id",
  "provider",
  "model",
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
] as const;
const COMPLETION_KEYS = [
  "id",
  "routingEvidenceId",
  "endState",
  "implementationHead",
  "recordedAt",
] as const;
const STATE_KEYS = [
  "id",
  "routingEvidenceId",
  "state",
  "reason",
  "recordedAt",
] as const;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_STORE_ROOT =
  /^(?!\/)(?!\.\.\/)(?!.*\/\.\.\/)(?!.*\\)(?:[A-Za-z0-9._-]+\/)+$/u;
const SHA = /^[a-f0-9]{40}$/iu;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function requireRecord(
  value: unknown,
  expected: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(value) || !exactKeys(value, expected))
    throw new Error(`${label}に未知fieldまたは不足fieldがあります`);
  return value;
}

function safeIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value !== value.normalize("NFC") ||
    !SAFE_IDENTIFIER.test(value) ||
    EMAIL.test(value)
  )
    throw new Error(
      `${label}はNFC正規化済みの安全な識別子でなければなりません`,
    );
  return value;
}

function safeReason(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 256 ||
    value !== value.normalize("NFC") ||
    CONTROL.test(value) ||
    EMAIL.test(value)
  )
    throw new Error(
      "state reasonは秘密・個人情報を含まない安全な文字列が必要です",
    );
  return value;
}

function isoTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error(`${label}がISO 8601 UTC時刻ではありません`);
  return value;
}

function requireRetention(value: unknown): RoutingEvidenceRetentionChoice {
  const record = requireRecord(
    value,
    RETENTION_KEYS,
    "routing evidence保持方針",
  );
  for (const key of [
    "retentionDays",
    "maxRecordsPerIssue",
    "maxRecordBytes",
  ] as const) {
    const item = record[key];
    if (typeof item !== "number" || !Number.isInteger(item) || item < 1)
      throw new Error(`routing evidence保持方針.${key}は1以上の整数が必要です`);
  }
  if (record.rotationCondition !== "oldest_first")
    throw new Error("routing evidence保持方針.rotationConditionが不正です");
  if (record.deletionMethod !== "preview_then_explicit")
    throw new Error("routing evidence保持方針.deletionMethodが不正です");
  return record as unknown as RoutingEvidenceRetentionChoice;
}

function storage(input: Record<string, unknown>): {
  repositoryRoot: string;
  storeRoot: string;
  retention: RoutingEvidenceRetentionChoice;
  storePath: string;
} {
  if (typeof input.repositoryRoot !== "string" || input.repositoryRoot === "")
    throw new Error("repository rootが必要です");
  if (!fs.existsSync(input.repositoryRoot))
    throw new Error("repository rootが存在しません");
  const repositoryRoot = fs.realpathSync(input.repositoryRoot);
  if (
    typeof input.storeRoot !== "string" ||
    input.storeRoot !== input.storeRoot.normalize("NFC") ||
    !SAFE_STORE_ROOT.test(input.storeRoot)
  )
    throw new Error("evidence store rootはproject choiceの必須値です");
  const retention = requireRetention(input.retention);
  const storePath = resolveContained(repositoryRoot, input.storeRoot, {
    allowMissingLeaf: true,
  });
  return { repositoryRoot, storeRoot: input.storeRoot, retention, storePath };
}

function ensureStore(storePath: string, repositoryRoot: string): void {
  fs.mkdirSync(storePath, { recursive: true, mode: 0o700 });
  const realStore = fs.realpathSync(storePath);
  const relative = path.relative(repositoryRoot, realStore);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("evidence store rootの実体がrepository外を指しています");
}

function durableSyncDirectory(directory: string): void {
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function containedRecordPath(storePath: string, relative: string): string {
  return resolveContained(storePath, relative, { allowMissingLeaf: true });
}

function verifyContainedParent(storePath: string, destination: string): void {
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const relative = path.relative(
    fs.realpathSync(storePath),
    fs.realpathSync(parent),
  );
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("evidence record directoryがstore外を指しています");
}

function createAtomicExclusive(
  storePath: string,
  destination: string,
  contents: string,
): void {
  const parent = path.dirname(destination);
  verifyContainedParent(storePath, destination);
  const lock = `${destination}.lock`;
  const lockDescriptor = fs.openSync(lock, "wx", 0o600);
  fs.closeSync(lockDescriptor);
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    if (fs.existsSync(destination))
      throw new Error("同一識別子のrecordが既に存在します");
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, contents, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, destination);
    durableSyncDirectory(parent);
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.rmSync(lock, { force: true });
  }
}

function lockKey(domain: string, value: unknown): string {
  return `${domain}-${crypto.createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function withExclusiveRecordLock<T>(
  storePath: string,
  key: string,
  action: () => T,
): T {
  const lock = containedRecordPath(storePath, `.locks/${key}.lock`);
  verifyContainedParent(storePath, lock);
  const descriptor = fs.openSync(lock, "wx", 0o600);
  try {
    return action();
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lock, { force: true });
  }
}

function json(record: unknown, maxBytes: number): string {
  const source = `${JSON.stringify(record, null, 2)}\n`;
  if (Buffer.byteLength(source) > maxBytes)
    throw new Error("routing evidence recordが容量上限を超えています");
  return source;
}

function timestampSlug(timestamp: string): string {
  return timestamp.replace(/[^0-9]/gu, "");
}

function evidencePath(storePath: string, id: string): string {
  return resolveContained(
    storePath,
    `routing/${safeIdentifier(id, "routing evidence id")}.json`,
    {
      allowMissingLeaf: true,
    },
  );
}

function readJsonFile(file: string, label: string): unknown {
  return parseJsonStrict(fs.readFileSync(file, "utf8"), label);
}

function isRoutingRole(value: unknown): value is RoutingRole {
  return (
    value === "coordinator" || value === "implementer" || value === "reviewer"
  );
}

function readRoutingEvidenceFile(file: string): RoutingEvidence {
  const record = requireRecord(
    readJsonFile(file, "routing evidence"),
    EVIDENCE_KEYS,
    "routing evidence",
  );
  if (
    !isRoutingRole(record.role) ||
    record.reasoningEffort !== "high" ||
    record.serviceTier !== "default" ||
    record.startState !== "issued" ||
    typeof record.issue !== "number" ||
    !Number.isInteger(record.issue) ||
    record.issue < 1 ||
    typeof record.baseSha !== "string" ||
    !SHA.test(record.baseSha)
  )
    throw new Error("routing evidenceの拘束値が不正です");
  for (const key of [
    "id",
    "provider",
    "model",
    "mappingVersion",
    "identity",
    "scope",
    "evaluatorRef",
  ] as const)
    safeIdentifier(record[key], `routing evidence.${key}`);
  isoTimestamp(record.issuedAt, "routing evidence.issuedAt");
  return record as unknown as RoutingEvidence;
}

function listJson(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  if (fs.lstatSync(directory).isSymbolicLink())
    throw new Error("evidence record directoryにsymlinkは使えません");
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.name.endsWith(".json"),
    )
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function listRoutingEvidence(storePath: string): RoutingEvidence[] {
  return listJson(containedRecordPath(storePath, "routing")).map(
    readRoutingEvidenceFile,
  );
}

function validateIssueInput(value: unknown): {
  input: RoutingEvidenceIssueInput;
  storage: ReturnType<typeof storage>;
} {
  const record = requireRecord(
    value,
    ISSUE_INPUT_KEYS,
    "routing evidence発行入力",
  );
  const validatedStorage = storage(record);
  if (
    typeof record.issue !== "number" ||
    !Number.isInteger(record.issue) ||
    record.issue < 1 ||
    !isRoutingRole(record.role) ||
    record.reasoningEffort !== "high" ||
    record.serviceTier !== "default" ||
    typeof record.baseSha !== "string" ||
    !SHA.test(record.baseSha)
  )
    throw new Error("routing evidence発行入力の拘束値が不正です");
  for (const key of [
    "scope",
    "provider",
    "model",
    "mappingVersion",
    "identity",
    "evaluatorRef",
  ] as const)
    safeIdentifier(record[key], `routing evidence発行入力.${key}`);
  return {
    input: record as unknown as RoutingEvidenceIssueInput,
    storage: validatedStorage,
  };
}

export function issueRoutingEvidence(
  value: unknown,
  now: () => Date = () => new Date(),
): RoutingEvidence {
  const { input, storage: validatedStorage } = validateIssueInput(value);
  const issuedAt = now().toISOString();
  isoTimestamp(issuedAt, "routing evidence issuedAt");
  const id = safeIdentifier(
    `routing-${input.issue}-${input.scope}-${input.baseSha.slice(0, 12)}-${timestampSlug(issuedAt)}`,
    "routing evidence id",
  );
  const evidence: RoutingEvidence = {
    id,
    provider: input.provider,
    model: input.model,
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
  withExclusiveRecordLock(
    validatedStorage.storePath,
    lockKey("binding", [evidence.issue, evidence.scope, evidence.baseSha]),
    () => {
      const issueRecords = listRoutingEvidence(
        validatedStorage.storePath,
      ).filter((record) => record.issue === evidence.issue);
      const activeDuplicate = issueRecords.some(
        (record) =>
          record.scope === evidence.scope &&
          record.baseSha === evidence.baseSha &&
          (stateRecords(validatedStorage.storePath, record.id).at(-1)?.state ??
            "issued") === "issued",
      );
      if (activeDuplicate)
        throw new Error(
          "同じIssue、scope、base SHAの有効なrouting evidenceが既に存在します",
        );
      if (issueRecords.length >= validatedStorage.retention.maxRecordsPerIssue)
        throw new Error("routing evidenceのIssue単位件数上限に達しています");
      createAtomicExclusive(
        validatedStorage.storePath,
        evidencePath(validatedStorage.storePath, id),
        source,
      );
    },
  );
  return evidence;
}

export function assertRoutingEvidenceBinding(
  evidence: RoutingEvidence,
  issue: number,
  scope: string,
): void {
  safeIdentifier(scope, "scope");
  if (evidence.issue !== issue || evidence.scope !== scope)
    throw new Error("routing evidenceを別Issueまたは別scopeへ再利用できません");
}

function requireExistingEvidence(
  storePath: string,
  id: string,
): RoutingEvidence {
  const file = evidencePath(storePath, id);
  if (!fs.existsSync(file)) throw new Error("routing evidenceが存在しません");
  return readRoutingEvidenceFile(file);
}

function readCompletionRecord(file: string): CompletionRecord {
  const record = requireRecord(
    readJsonFile(file, "completion record"),
    COMPLETION_KEYS,
    "completion record",
  );
  if (
    (record.endState !== "completed" && record.endState !== "interrupted") ||
    typeof record.implementationHead !== "string" ||
    !SHA.test(record.implementationHead)
  )
    throw new Error("completion recordの終了状態またはheadが不正です");
  safeIdentifier(record.id, "completion record id");
  safeIdentifier(record.routingEvidenceId, "completion routing evidence id");
  isoTimestamp(record.recordedAt, "completion recordedAt");
  return record as unknown as CompletionRecord;
}

function completionRecords(
  storePath: string,
  evidenceId: string,
): CompletionRecord[] {
  return listJson(containedRecordPath(storePath, "completion"))
    .map(readCompletionRecord)
    .filter((record) => record.routingEvidenceId === evidenceId)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}

export function appendCompletionRecord(
  value: unknown,
  now: () => Date = () => new Date(),
): CompletionRecord {
  const record = requireRecord(
    value,
    COMPLETION_INPUT_KEYS,
    "completion record入力",
  );
  const validatedStorage = storage(record);
  const evidenceId = safeIdentifier(
    record.routingEvidenceId,
    "routing evidence id",
  );
  if (
    (record.endState !== "completed" && record.endState !== "interrupted") ||
    typeof record.implementationHead !== "string" ||
    !SHA.test(record.implementationHead)
  )
    throw new Error(
      "completion recordの終了状態またはimplementation headが不正です",
    );
  const recordedAt = now().toISOString();
  const completion: CompletionRecord = {
    id: safeIdentifier(
      `completion-${evidenceId}-${timestampSlug(recordedAt)}`,
      "completion record id",
    ),
    routingEvidenceId: evidenceId,
    endState: record.endState,
    implementationHead: record.implementationHead.toLowerCase(),
    recordedAt,
  };
  withExclusiveRecordLock(
    validatedStorage.storePath,
    lockKey("evidence", evidenceId),
    () => {
      requireExistingEvidence(validatedStorage.storePath, evidenceId);
      if (completionRecords(validatedStorage.storePath, evidenceId).length > 0)
        throw new Error(
          "同一routing evidenceのcompletion recordは1件だけ追記できます",
        );
      createAtomicExclusive(
        validatedStorage.storePath,
        containedRecordPath(
          validatedStorage.storePath,
          `completion/${completion.id}.json`,
        ),
        json(completion, validatedStorage.retention.maxRecordBytes),
      );
    },
  );
  return completion;
}

function readStateRecord(file: string): EvidenceStateRecord {
  const record = requireRecord(
    readJsonFile(file, "evidence state record"),
    STATE_KEYS,
    "evidence state record",
  );
  if (record.state !== "superseded" && record.state !== "invalidated")
    throw new Error("evidence state recordのstateが不正です");
  safeIdentifier(record.id, "evidence state record id");
  safeIdentifier(record.routingEvidenceId, "state routing evidence id");
  safeReason(record.reason);
  isoTimestamp(record.recordedAt, "state recordedAt");
  return record as unknown as EvidenceStateRecord;
}

function stateRecords(
  storePath: string,
  evidenceId: string,
): EvidenceStateRecord[] {
  return listJson(containedRecordPath(storePath, "states"))
    .map(readStateRecord)
    .filter((record) => record.routingEvidenceId === evidenceId)
    .sort((left, right) =>
      left.recordedAt === right.recordedAt
        ? left.id.localeCompare(right.id)
        : left.recordedAt.localeCompare(right.recordedAt),
    );
}

export function appendEvidenceStateRecord(
  value: unknown,
  now: () => Date = () => new Date(),
): EvidenceStateRecord {
  const record = requireRecord(
    value,
    STATE_INPUT_KEYS,
    "evidence state record入力",
  );
  const validatedStorage = storage(record);
  const evidenceId = safeIdentifier(
    record.routingEvidenceId,
    "routing evidence id",
  );
  if (record.state !== "superseded" && record.state !== "invalidated")
    throw new Error(
      "evidence stateはsupersededまたはinvalidatedだけを追記できます",
    );
  const reason = safeReason(record.reason);
  const recordedAt = now().toISOString();
  const stateRecord: EvidenceStateRecord = {
    id: safeIdentifier(
      `state-${evidenceId}-${timestampSlug(recordedAt)}-${record.state}`,
      "evidence state record id",
    ),
    routingEvidenceId: evidenceId,
    state: record.state,
    reason,
    recordedAt,
  };
  withExclusiveRecordLock(
    validatedStorage.storePath,
    lockKey("evidence", evidenceId),
    () => {
      requireExistingEvidence(validatedStorage.storePath, evidenceId);
      createAtomicExclusive(
        validatedStorage.storePath,
        containedRecordPath(
          validatedStorage.storePath,
          `states/${stateRecord.id}.json`,
        ),
        json(stateRecord, validatedStorage.retention.maxRecordBytes),
      );
    },
  );
  return stateRecord;
}

export function getEffectiveEvidenceState(
  value: EvidenceStorageInput,
  evidenceId: string,
): EvidenceState {
  const validatedStorage = storage(value as unknown as Record<string, unknown>);
  requireExistingEvidence(validatedStorage.storePath, evidenceId);
  return (
    stateRecords(validatedStorage.storePath, evidenceId).at(-1)?.state ??
    "issued"
  );
}

export function evaluateRoutingEvidenceHead(
  value: EvidenceStorageInput,
  evidenceId: string,
  currentHead: string,
): {
  routingEvidenceValid: boolean;
  effectiveState: EvidenceState;
  completionRecords: Array<{
    endState: CompletionState;
    implementationHead: string;
    validForCurrentHead: boolean;
  }>;
} {
  if (!SHA.test(currentHead))
    throw new Error("current headが40桁SHAではありません");
  const validatedStorage = storage(value as unknown as Record<string, unknown>);
  requireExistingEvidence(validatedStorage.storePath, evidenceId);
  const effectiveState = getEffectiveEvidenceState(value, evidenceId);
  return {
    routingEvidenceValid: effectiveState === "issued",
    effectiveState,
    completionRecords: completionRecords(
      validatedStorage.storePath,
      evidenceId,
    ).map((record) => ({
      endState: record.endState,
      implementationHead: record.implementationHead,
      validForCurrentHead:
        record.implementationHead.toLowerCase() === currentHead.toLowerCase(),
    })),
  };
}

function previewDigest(
  targetIds: string[],
  retention: RoutingEvidenceRetentionChoice,
): string {
  return crypto
    .createHash("sha256")
    .update(
      stableJson({
        domain: "agent-skill-chain/routing-evidence-prune/v1",
        retention,
        targetIds,
      }),
    )
    .digest("hex");
}

export function previewEvidencePrune(
  value: EvidenceStorageInput,
  now: () => Date = () => new Date(),
): EvidencePrunePreview {
  const validatedStorage = storage(value as unknown as Record<string, unknown>);
  if (!fs.existsSync(validatedStorage.storePath)) {
    const targetIds: string[] = [];
    return {
      targetIds,
      digest: previewDigest(targetIds, validatedStorage.retention),
    };
  }
  const records = listRoutingEvidence(validatedStorage.storePath);
  const cutoff =
    now().getTime() - validatedStorage.retention.retentionDays * 86_400_000;
  const targets = new Set(
    records
      .filter((record) => Date.parse(record.issuedAt) < cutoff)
      .map((record) => record.id),
  );
  const byIssue = new Map<number, RoutingEvidence[]>();
  for (const record of records) {
    const issueRecords = byIssue.get(record.issue) ?? [];
    issueRecords.push(record);
    byIssue.set(record.issue, issueRecords);
    const file = evidencePath(validatedStorage.storePath, record.id);
    if (fs.statSync(file).size > validatedStorage.retention.maxRecordBytes)
      targets.add(record.id);
  }
  for (const issueRecords of byIssue.values()) {
    const ordered = issueRecords.sort((left, right) =>
      left.issuedAt.localeCompare(right.issuedAt),
    );
    for (const record of ordered.slice(
      0,
      Math.max(
        0,
        ordered.length - validatedStorage.retention.maxRecordsPerIssue + 1,
      ),
    ))
      targets.add(record.id);
  }
  const targetIds = [...targets].sort();
  return {
    targetIds,
    digest: previewDigest(targetIds, validatedStorage.retention),
  };
}

function auditStartFile(storePath: string, digest: string): string {
  if (!/^[a-f0-9]{64}$/u.test(digest))
    throw new Error("承認済みprune digestが不正です");
  return containedRecordPath(
    storePath,
    `prune-audits/prune-${digest}/start.json`,
  );
}

function readAuditStart(file: string): PruneAuditStart {
  const record = requireRecord(
    readJsonFile(file, "prune audit start"),
    ["id", "approvedDigest", "targetIds", "startedAt"],
    "prune audit start",
  );
  if (
    typeof record.approvedDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.approvedDigest) ||
    !Array.isArray(record.targetIds) ||
    record.targetIds.some(
      (id) => typeof id !== "string" || !SAFE_IDENTIFIER.test(id),
    ) ||
    new Set(record.targetIds).size !== record.targetIds.length
  )
    throw new Error("prune audit startの承認情報が不正です");
  safeIdentifier(record.id, "prune audit id");
  isoTimestamp(record.startedAt, "prune audit startedAt");
  return record as unknown as PruneAuditStart;
}

function readTombstone(file: string): Tombstone {
  const record = requireRecord(
    readJsonFile(file, "routing evidence tombstone"),
    ["routingEvidenceId", "pruneAuditId", "deletedAt"],
    "routing evidence tombstone",
  );
  safeIdentifier(record.routingEvidenceId, "tombstone routing evidence id");
  safeIdentifier(record.pruneAuditId, "tombstone prune audit id");
  isoTimestamp(record.deletedAt, "tombstone deletedAt");
  return record as unknown as Tombstone;
}

function readPruneOutcome(file: string): PruneOutcome {
  const record = requireRecord(
    readJsonFile(file, "prune outcome"),
    ["routingEvidenceId", "outcome", "recordedAt"],
    "prune outcome",
  );
  safeIdentifier(record.routingEvidenceId, "prune outcome routing evidence id");
  if (record.outcome !== "succeeded" && record.outcome !== "failed")
    throw new Error("prune outcomeの結果が不正です");
  isoTimestamp(record.recordedAt, "prune outcome recordedAt");
  return record as unknown as PruneOutcome;
}

function relatedRecordFiles(
  storePath: string,
  directory: "completion" | "states",
  evidenceId: string,
): string[] {
  return listJson(containedRecordPath(storePath, directory)).filter((file) => {
    const record =
      directory === "completion"
        ? readCompletionRecord(file)
        : readStateRecord(file);
    return record.routingEvidenceId === evidenceId;
  });
}

function latestOutcome(
  storePath: string,
  auditId: string,
  evidenceId: string,
): PruneOutcome | undefined {
  const directory = containedRecordPath(
    storePath,
    `prune-audits/${safeIdentifier(auditId, "prune audit id")}/outcomes`,
  );
  const outcomes = listJson(directory)
    .map(readPruneOutcome)
    .filter((value) => value.routingEvidenceId === evidenceId)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  return outcomes.at(-1);
}

function appendPruneOutcome(
  storePath: string,
  auditId: string,
  evidenceId: string,
  outcome: PruneOutcome["outcome"],
  recordedAt: string,
  maxBytes: number,
): void {
  const record: PruneOutcome = {
    routingEvidenceId: evidenceId,
    outcome,
    recordedAt,
  };
  const id = safeIdentifier(
    `outcome-${evidenceId}-${timestampSlug(recordedAt)}-${outcome}`,
    "prune outcome id",
  );
  createAtomicExclusive(
    storePath,
    containedRecordPath(
      storePath,
      `prune-audits/${safeIdentifier(auditId, "prune audit id")}/outcomes/${id}.json`,
    ),
    json(record, maxBytes),
  );
}

export function applyEvidencePrune(
  value: unknown,
  now: () => Date = () => new Date(),
  dependencies: { remove?: (file: string) => void } = {},
): { auditId: string; completed: string[]; failed: string[] } {
  const record = requireRecord(
    value,
    [
      "repositoryRoot",
      "storeRoot",
      "retention",
      "approvedDigest",
      "targetIds",
      "authorize",
    ],
    "evidence prune apply入力",
  );
  const validatedStorage = storage(record);
  if (record.authorize !== "approved")
    throw new Error("evidence prune applyにはauthorize=approvedが必要です");
  if (
    typeof record.approvedDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.approvedDigest) ||
    !Array.isArray(record.targetIds)
  )
    throw new Error("evidence pruneのdigestまたは対象id一覧が不正です");
  const approvedDigest = record.approvedDigest;
  const targetIds = record.targetIds.map((id) =>
    safeIdentifier(id, "evidence prune対象id"),
  );
  if (
    new Set(targetIds).size !== targetIds.length ||
    stableJson(targetIds) !== stableJson([...targetIds].sort())
  )
    throw new Error("evidence pruneの対象id一覧は字句順でなければなりません");
  ensureStore(validatedStorage.storePath, validatedStorage.repositoryRoot);
  const startFile = auditStartFile(validatedStorage.storePath, approvedDigest);
  let audit: PruneAuditStart;
  if (fs.existsSync(startFile)) {
    audit = readAuditStart(startFile);
    if (
      audit.approvedDigest !== approvedDigest ||
      stableJson(audit.targetIds) !== stableJson(targetIds)
    )
      throw new Error("既存PruneAuditRecordと承認済み対象が一致しません");
  } else {
    const current = previewEvidencePrune(
      record as unknown as EvidenceStorageInput,
      now,
    );
    if (
      current.digest !== approvedDigest ||
      stableJson(current.targetIds) !== stableJson(targetIds)
    )
      throw new Error("承認済みpreviewと現在の削除対象が一致しません");
    audit = {
      id: safeIdentifier(`prune-${approvedDigest}`, "prune audit id"),
      approvedDigest,
      targetIds,
      startedAt: now().toISOString(),
    };
    createAtomicExclusive(
      validatedStorage.storePath,
      startFile,
      json(audit, validatedStorage.retention.maxRecordBytes),
    );
    const confirmed = readAuditStart(startFile);
    if (stableJson(confirmed) !== stableJson(audit))
      throw new Error("PruneAuditRecordの書き込み確認に失敗しました");
  }

  const remove =
    dependencies.remove ?? ((file: string) => fs.rmSync(file, { force: true }));
  const completed: string[] = [];
  const failed: string[] = [];
  for (const evidenceId of audit.targetIds) {
    withExclusiveRecordLock(
      validatedStorage.storePath,
      lockKey("evidence", evidenceId),
      () => {
        const previous = latestOutcome(
          validatedStorage.storePath,
          audit.id,
          evidenceId,
        );
        if (previous?.outcome === "succeeded") {
          completed.push(evidenceId);
          return;
        }
        const tombstoneFile = containedRecordPath(
          validatedStorage.storePath,
          `tombstones/${evidenceId}.json`,
        );
        if (!fs.existsSync(tombstoneFile)) {
          const tombstone: Tombstone = {
            routingEvidenceId: evidenceId,
            pruneAuditId: audit.id,
            deletedAt: now().toISOString(),
          };
          createAtomicExclusive(
            validatedStorage.storePath,
            tombstoneFile,
            json(tombstone, validatedStorage.retention.maxRecordBytes),
          );
          const confirmed = readJsonFile(
            tombstoneFile,
            "routing evidence tombstone",
          );
          if (stableJson(confirmed) !== stableJson(tombstone))
            throw new Error("tombstoneの書き込み確認に失敗しました");
        } else {
          const existingTombstone = readTombstone(tombstoneFile);
          if (
            existingTombstone.routingEvidenceId !== evidenceId ||
            existingTombstone.pruneAuditId !== audit.id
          )
            throw new Error("既存tombstoneがPruneAuditRecordと一致しません");
        }
        try {
          const files = [
            evidencePath(validatedStorage.storePath, evidenceId),
            ...relatedRecordFiles(
              validatedStorage.storePath,
              "completion",
              evidenceId,
            ),
            ...relatedRecordFiles(
              validatedStorage.storePath,
              "states",
              evidenceId,
            ),
          ];
          for (const file of files) if (fs.existsSync(file)) remove(file);
          appendPruneOutcome(
            validatedStorage.storePath,
            audit.id,
            evidenceId,
            "succeeded",
            now().toISOString(),
            validatedStorage.retention.maxRecordBytes,
          );
          completed.push(evidenceId);
        } catch (error) {
          appendPruneOutcome(
            validatedStorage.storePath,
            audit.id,
            evidenceId,
            "failed",
            now().toISOString(),
            validatedStorage.retention.maxRecordBytes,
          );
          failed.push(evidenceId);
          throw error;
        }
      },
    );
  }
  return { auditId: audit.id, completed, failed };
}
