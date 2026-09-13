import crypto from "node:crypto";
import { stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";

export const PROGRESS_START = "<!-- asc:parallel-progress:start -->";
export const PROGRESS_END = "<!-- asc:parallel-progress:end -->";
const SHA256 = /^[a-f0-9]{64}$/u;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const TASK_ID = /^[A-Z][A-Z0-9._-]{1,63}$/u;
const STATES = ["planned", "started", "completed", "blocked"] as const;

export type ReviewProgressState = (typeof STATES)[number];

export interface ReviewProgressInventory {
  targetPath: "03_実装計画.md";
  baselineDigest: string;
  prefixDigest: string;
  suffixDigest: string;
  fileMode: 420;
  allowedTaskIds: readonly string[];
}

export interface ReviewProgressEntry {
  schemaVersion: "agent-skill-chain/review-progress-entry/v1";
  sequence: number;
  entryId: string;
  sessionId: string;
  implementationHeadSha: string;
  taskId: string;
  state: ReviewProgressState;
  recordedAt: string;
  previousDigest: string | null;
  entryDigest: string;
}

export interface ReviewProgressSeal {
  schemaVersion: "agent-skill-chain/review-progress-seal/v1";
  sessionId: string;
  implementationHeadSha: string;
  previousDigest: string | null;
  sealedAt: string;
  sealDigest: string;
}

export type ReviewProgressRecord = ReviewProgressEntry | ReviewProgressSeal;

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function splitTarget(source: string): {
  prefix: string;
  body: string;
  suffix: string;
} {
  const start = source.indexOf(PROGRESS_START);
  const end = source.indexOf(PROGRESS_END);
  if (
    start < 0 ||
    end < 0 ||
    source.indexOf(PROGRESS_START, start + 1) >= 0 ||
    source.indexOf(PROGRESS_END, end + 1) >= 0 ||
    end <= start
  )
    throw new Error("parallel progress markerは正確に1組必要です");
  const bodyStart = start + PROGRESS_START.length;
  return {
    prefix: source.slice(0, bodyStart),
    body: source.slice(bodyStart, end),
    suffix: source.slice(end),
  };
}

export function buildReviewProgressInventory(
  targetPath: string,
  source: string,
  fileMode: number,
): ReviewProgressInventory {
  if (targetPath !== "03_実装計画.md")
    throw new Error("parallel progress targetは03_実装計画.mdだけを許可します");
  if (fileMode !== 0o644)
    throw new Error("parallel progress targetはmode 100644が必要です");
  const { prefix, suffix } = splitTarget(source);
  const allowedTaskIds = [
    ...new Set(
      [...source.matchAll(/^\|\s*([A-Z][A-Z0-9._-]{1,63})\s*\|/gmu)].map(
        (match) => match[1]!,
      ),
    ),
  ].sort();
  if (allowedTaskIds.length === 0)
    throw new Error("parallel progress targetにtask IDが必要です");
  return Object.freeze({
    targetPath,
    baselineDigest: sha256(source),
    prefixDigest: sha256(prefix),
    suffixDigest: sha256(suffix),
    fileMode: 0o644,
    allowedTaskIds: Object.freeze(allowedTaskIds),
  });
}

export function parseReviewProgressInventory(
  value: unknown,
): ReviewProgressInventory {
  if (!isRecord(value)) throw new Error("progress inventoryはobjectが必要です");
  const fields = [
    "targetPath",
    "baselineDigest",
    "prefixDigest",
    "suffixDigest",
    "fileMode",
    "allowedTaskIds",
  ];
  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
  const missing = fields.filter((field) => !(field in value));
  if (unknown.length || missing.length)
    throw new Error("progress inventoryのfieldが不正です");
  if (
    value.targetPath !== "03_実装計画.md" ||
    !SHA256.test(String(value.baselineDigest ?? "")) ||
    !SHA256.test(String(value.prefixDigest ?? "")) ||
    !SHA256.test(String(value.suffixDigest ?? "")) ||
    value.fileMode !== 0o644 ||
    !Array.isArray(value.allowedTaskIds) ||
    value.allowedTaskIds.length === 0 ||
    value.allowedTaskIds.some(
      (task) => typeof task !== "string" || !TASK_ID.test(task),
    ) ||
    stableJson(value.allowedTaskIds) !==
      stableJson([...new Set(value.allowedTaskIds as string[])].sort())
  )
    throw new Error("progress inventoryの値が不正です");
  return Object.freeze({
    targetPath: value.targetPath,
    baselineDigest: String(value.baselineDigest),
    prefixDigest: String(value.prefixDigest),
    suffixDigest: String(value.suffixDigest),
    fileMode: 0o644,
    allowedTaskIds: Object.freeze([...(value.allowedTaskIds as string[])]),
  });
}

function exactInstant(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}が不正です`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new Error(`${label}はISO 8601 UTC日時が必要です`);
  return value;
}

function digestRecord(value: Record<string, unknown>): string {
  return sha256(stableJson(value));
}

export function makeReviewProgressEntry(input: {
  previous: readonly ReviewProgressRecord[];
  sessionId: string;
  implementationHeadSha: string;
  taskId: string;
  state: ReviewProgressState;
  recordedAt: string;
}): ReviewProgressEntry {
  if (input.previous.length >= 256)
    throw new Error("progress journalは256 entry以下が必要です");
  const previousDigest = latestReviewProgressDigest(input.previous);
  if (!SHA256.test(input.sessionId) || !OID.test(input.implementationHeadSha))
    throw new Error("progress entryのreview bindingが不正です");
  if (!TASK_ID.test(input.taskId)) throw new Error("progress taskIdが不正です");
  if (!STATES.includes(input.state))
    throw new Error("progress stateが不正です");
  exactInstant(input.recordedAt, "progress recordedAt");
  if (input.previous.some((record) => "sealDigest" in record))
    throw new Error("sealed progress journalへ追記できません");
  const sequence = input.previous.length + 1;
  const identity = {
    sessionId: input.sessionId,
    implementationHeadSha: input.implementationHeadSha,
    taskId: input.taskId,
    state: input.state,
    recordedAt: input.recordedAt,
    sequence,
  };
  const entryId = digestRecord(identity);
  const withoutDigest = {
    schemaVersion: "agent-skill-chain/review-progress-entry/v1" as const,
    entryId,
    ...identity,
    previousDigest,
  };
  return Object.freeze({
    ...withoutDigest,
    entryDigest: digestRecord(withoutDigest),
  });
}

export function makeReviewProgressSeal(input: {
  previous: readonly ReviewProgressRecord[];
  sessionId: string;
  implementationHeadSha: string;
  sealedAt: string;
}): ReviewProgressSeal {
  if (input.previous.length > 256)
    throw new Error("progress journalの上限を超えました");
  if (input.previous.some((record) => "sealDigest" in record))
    throw new Error("progress journalは既にsealedです");
  if (!SHA256.test(input.sessionId) || !OID.test(input.implementationHeadSha))
    throw new Error("progress sealのreview bindingが不正です");
  exactInstant(input.sealedAt, "progress sealedAt");
  const withoutDigest = {
    schemaVersion: "agent-skill-chain/review-progress-seal/v1" as const,
    sessionId: input.sessionId,
    implementationHeadSha: input.implementationHeadSha,
    previousDigest: latestReviewProgressDigest(input.previous),
    sealedAt: input.sealedAt,
  };
  return Object.freeze({
    ...withoutDigest,
    sealDigest: digestRecord(withoutDigest),
  });
}

export function latestReviewProgressDigest(
  records: readonly ReviewProgressRecord[],
): string | null {
  const latest = records.at(-1);
  return latest
    ? "entryDigest" in latest
      ? latest.entryDigest
      : latest.sealDigest
    : null;
}

export function parseReviewProgressRecords(
  source: string,
): readonly ReviewProgressRecord[] {
  if (Buffer.byteLength(source, "utf8") > 256 * 1024)
    throw new Error("progress journalは256 KiB以下が必要です");
  const lines = source === "" ? [] : source.trimEnd().split("\n");
  if (lines.length > 257) throw new Error("progress journalの上限を超えました");
  const records: ReviewProgressRecord[] = [];
  for (const [index, line] of lines.entries()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`progress journal ${index + 1}行目がJSONではありません`);
    }
    if (!isRecord(value)) throw new Error("progress recordはobjectが必要です");
    const isSeal =
      value.schemaVersion === "agent-skill-chain/review-progress-seal/v1";
    const expectedFields = isSeal
      ? [
          "schemaVersion",
          "sessionId",
          "implementationHeadSha",
          "previousDigest",
          "sealedAt",
          "sealDigest",
        ]
      : [
          "schemaVersion",
          "sequence",
          "entryId",
          "sessionId",
          "implementationHeadSha",
          "taskId",
          "state",
          "recordedAt",
          "previousDigest",
          "entryDigest",
        ];
    if (
      Object.keys(value).some((field) => !expectedFields.includes(field)) ||
      expectedFields.some((field) => !(field in value))
    )
      throw new Error("progress recordのfieldが不正です");
    if (value.previousDigest !== latestReviewProgressDigest(records))
      throw new Error("progress journalのdigest chainが不正です");
    const digestField = isSeal ? "sealDigest" : "entryDigest";
    const claimed = String(value[digestField] ?? "");
    const withoutDigest = Object.fromEntries(
      Object.entries(value).filter(([field]) => field !== digestField),
    );
    if (!SHA256.test(claimed) || digestRecord(withoutDigest) !== claimed)
      throw new Error("progress record digestが不正です");
    if (isSeal) {
      if (
        !SHA256.test(String(value.sessionId ?? "")) ||
        !OID.test(String(value.implementationHeadSha ?? ""))
      )
        throw new Error("progress sealのreview bindingが不正です");
      exactInstant(value.sealedAt, "progress sealedAt");
      if (index !== lines.length - 1)
        throw new Error("seal後のrecordを拒否しました");
      records.push(value as unknown as ReviewProgressSeal);
    } else {
      if (value.schemaVersion !== "agent-skill-chain/review-progress-entry/v1")
        throw new Error("progress entry schemaVersionが不正です");
      if (
        value.sequence !== index + 1 ||
        !TASK_ID.test(String(value.taskId ?? "")) ||
        !SHA256.test(String(value.entryId ?? "")) ||
        !SHA256.test(String(value.sessionId ?? "")) ||
        !OID.test(String(value.implementationHeadSha ?? ""))
      )
        throw new Error("progress entry identityが不正です");
      if (!STATES.includes(value.state as ReviewProgressState))
        throw new Error("progress entry stateが不正です");
      exactInstant(value.recordedAt, "progress recordedAt");
      const expectedEntryId = digestRecord({
        sessionId: value.sessionId,
        implementationHeadSha: value.implementationHeadSha,
        taskId: value.taskId,
        state: value.state,
        recordedAt: value.recordedAt,
        sequence: value.sequence,
      });
      if (value.entryId !== expectedEntryId)
        throw new Error("progress entryIdがidentityと一致しません");
      records.push(value as unknown as ReviewProgressEntry);
    }
  }
  return Object.freeze(records);
}

export function renderReviewProgress(
  records: readonly ReviewProgressRecord[],
  taskIds?: readonly string[],
): string {
  const latest = new Map<string, ReviewProgressState>();
  for (const taskId of taskIds ?? []) latest.set(taskId, "planned");
  for (const record of records)
    if ("taskId" in record) latest.set(record.taskId, record.state);
  const rows = [...latest]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([task, state]) => `| ${task} | ${state} |`);
  return `\n\n| タスク | 並行進捗 |\n|---|---|\n${rows.join("\n")}\n\n`;
}

export function verifyReviewProgressTarget(input: {
  inventory: ReviewProgressInventory;
  source: string;
  records: readonly ReviewProgressRecord[];
}): void {
  const { prefix, body, suffix } = splitTarget(input.source);
  if (
    sha256(prefix) !== input.inventory.prefixDigest ||
    sha256(suffix) !== input.inventory.suffixDigest
  )
    throw new Error("parallel progress marker外のbyteがbaselineと一致しません");
  if (
    sha256(input.source) !== input.inventory.baselineDigest &&
    body !== renderReviewProgress(input.records, input.inventory.allowedTaskIds)
  )
    throw new Error(
      "parallel progress sectionがjournalの純粋projectionと一致しません",
    );
}

export function projectReviewProgressTarget(input: {
  inventory: ReviewProgressInventory;
  source: string;
  records: readonly ReviewProgressRecord[];
}): string {
  verifyReviewProgressTarget(input);
  const { prefix, suffix } = splitTarget(input.source);
  return `${prefix}${renderReviewProgress(input.records, input.inventory.allowedTaskIds)}${suffix}`;
}

export function parallelCriticalPath(
  reviewDuration: number,
  progressDuration: number,
): number {
  if (reviewDuration < 0 || progressDuration < 0)
    throw new Error("durationは0以上が必要です");
  return Math.max(reviewDuration, progressDuration);
}
