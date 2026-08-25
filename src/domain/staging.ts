import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../lib/process.js";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { isRecord } from "../types.js";

export type StagingState =
  "local-active" | "sync-verified" | "deletion-ready" | "retained" | "deleted";

export interface StagingRecord {
  path: string;
  relative: string;
  mode: string;
  artifacts: string[];
  digest: string;
  tracker: string | undefined;
  syncedAt: string | undefined;
  state: StagingState;
  reasons: string[];
  kind: "directory" | "file" | "unknown";
  owner: string;
  createdAt: string | undefined;
  checkpoint: number | undefined;
  fingerprint: string;
}

export interface StagingCleanupPlan {
  version: 1;
  root: string;
  candidates: StagingRecord[];
  excluded: Array<{ relative: string; reason: string }>;
  hash: string;
}

export interface StoredStagingRecord {
  schemaVersion: "agent-skill-chain/staging-record/v1";
  mode: "quick" | "full" | "poc";
  artifacts: string[];
  digest: string;
  owner: "runtime・project owner";
  createdAt: string;
  state: "local-active" | "sync-verified";
  tracker: string | null;
  checkpoint: 4 | 8 | null;
  syncedAt: string | null;
  syncDigest: string | null;
  readBackDigest: string | null;
}

export const STAGING_RECORD_FILE = "staging-record.json";
const STAGING_PREFIX = ".agent-skill-chain/tmp/issues";
const STORED_FIELDS = new Set([
  "schemaVersion",
  "mode",
  "artifacts",
  "digest",
  "owner",
  "createdAt",
  "state",
  "tracker",
  "checkpoint",
  "syncedAt",
  "syncDigest",
  "readBackDigest",
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const ROOT_META = /[\0\p{Cc}\p{Cf}%$*?{}~]/u;
const TRACKER =
  /^(?:https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/[1-9]\d*|#?[1-9]\d*)$/u;

interface InventoryEntry {
  relative: string;
  kind: "directory" | "file";
  mode: number;
  size: number;
  mtimeMs: number;
  digest?: string;
}

interface StagingInventory {
  artifacts: string[];
  entries: InventoryEntry[];
  unsafe: string[];
  fingerprint: string;
}

interface InspectionContext {
  root: string;
  nowMs: number;
  retentionDays: number;
}

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function slash(value: string): string {
  return value.split(path.sep).join("/");
}

function hasParentReference(value: string): boolean {
  return value.split(/[\\/]+/u).includes("..");
}

function hasUnsafeMeta(value: string): boolean {
  return ROOT_META.test(value) || value.includes("[") || value.includes("]");
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function parseInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new Error(`${label}はISO 8601 UTC日時でなければなりません`);
  return parsed;
}

function canonicalRepositoryRoot(inputRoot: string): string {
  if (
    typeof inputRoot !== "string" ||
    inputRoot.trim() === "" ||
    hasUnsafeMeta(inputRoot) ||
    hasParentReference(inputRoot)
  )
    throw new Error(
      "rootにはglob、制御文字、tilde、親参照を含まない明示pathが必要です",
    );
  const resolved = path.resolve(inputRoot);
  if (path.dirname(resolved) === resolved)
    throw new Error("filesystem rootをstaging cleanupのrootにできません");
  if (!fs.existsSync(resolved)) throw new Error("rootが存在しません");
  if (fs.lstatSync(resolved).isSymbolicLink())
    throw new Error("symlinkをstaging cleanupのrootにできません");
  const realRoot = fs.realpathSync(resolved);
  if (realRoot !== resolved)
    throw new Error("symlink祖先を含むrootをstaging cleanupに使用できません");
  const home = fs.existsSync(os.homedir())
    ? fs.realpathSync(os.homedir())
    : path.resolve(os.homedir());
  if (realRoot === home)
    throw new Error("home directoryをstaging cleanupのrootにできません");
  const topLevel = git(
    ["rev-parse", "--show-toplevel"],
    realRoot,
  ).stdout.trim();
  if (fs.realpathSync(topLevel) !== realRoot)
    throw new Error("rootはGit repository rootと一致しなければなりません");
  return realRoot;
}

function inspectionContext(input: {
  root: string;
  now: string;
  retentionDays: number;
}): InspectionContext {
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 0)
    throw new Error("retentionDaysは0以上の整数でなければなりません");
  return {
    root: canonicalRepositoryRoot(input.root),
    nowMs: parseInstant(input.now, "now"),
    retentionDays: input.retentionDays,
  };
}

function stagingRootBoundary(root: string): {
  path: string;
  unsafe: string | undefined;
} {
  let current = root;
  for (const component of [".agent-skill-chain", "tmp", "issues"]) {
    current = path.join(current, component);
    if (!fs.existsSync(current)) return { path: current, unsafe: undefined };
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink())
      return {
        path: current,
        unsafe: `${slash(path.relative(root, current))}がsymlinkのためstagingを走査しません`,
      };
    if (!stat.isDirectory())
      return {
        path: current,
        unsafe: `${slash(path.relative(root, current))}がdirectoryではないためstagingを走査しません`,
      };
    const real = fs.realpathSync(current);
    if (!isContained(root, real))
      return {
        path: current,
        unsafe: `${slash(path.relative(root, current))}がrepository root外へ解決されるためstagingを走査しません`,
      };
  }
  return { path: current, unsafe: undefined };
}

function inventory(directory: string): StagingInventory {
  const entries: InventoryEntry[] = [];
  const artifacts: string[] = [];
  const unsafe: string[] = [];
  const visit = (current: string, parentRelative: string): void => {
    let children: fs.Dirent[];
    try {
      children = fs
        .readdirSync(current, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      unsafe.push(
        `${parentRelative || "."}を読み取れません: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    for (const child of children) {
      const relative = slash(
        parentRelative ? path.join(parentRelative, child.name) : child.name,
      );
      const absolute = path.join(current, child.name);
      if (
        child.name.normalize("NFC") !== child.name ||
        hasUnsafeMeta(child.name) ||
        hasParentReference(relative)
      ) {
        unsafe.push(`${relative}は安全なNFC相対pathではありません`);
        continue;
      }
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(absolute);
      } catch (error) {
        unsafe.push(
          `${relative}を検査できません: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (stat.isSymbolicLink()) {
        unsafe.push(`${relative}はsymlinkのため保持します`);
        continue;
      }
      if (child.name === ".git" || relative.startsWith(".git/")) {
        unsafe.push(`${relative}はGit内部領域のため保持します`);
        continue;
      }
      let real: string;
      try {
        real = fs.realpathSync(absolute);
      } catch (error) {
        unsafe.push(
          `${relative}の実体pathを解決できません: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (!isContained(directory, real)) {
        unsafe.push(`${relative}はstaging root外へ解決されるため保持します`);
        continue;
      }
      if (stat.isDirectory()) {
        entries.push({
          relative,
          kind: "directory",
          mode: stat.mode,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
        visit(absolute, relative);
      } else if (stat.isFile()) {
        const digest = sha256(fs.readFileSync(absolute));
        entries.push({
          relative,
          kind: "file",
          mode: stat.mode,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          digest,
        });
        if (relative !== STAGING_RECORD_FILE) artifacts.push(relative);
      } else {
        unsafe.push(
          `${relative}は通常fileまたはdirectoryではないため保持します`,
        );
      }
    }
  };
  visit(directory, "");
  artifacts.sort((left, right) => left.localeCompare(right));
  entries.sort((left, right) => left.relative.localeCompare(right.relative));
  unsafe.sort((left, right) => left.localeCompare(right));
  return {
    artifacts,
    entries,
    unsafe,
    fingerprint: sha256(stableJson({ entries, unsafe })),
  };
}

export function calculateStagingDigest(
  directory: string,
  artifacts: readonly string[],
): string {
  const values = artifacts.map((relative) => {
    if (
      relative === "" ||
      relative === STAGING_RECORD_FILE ||
      path.isAbsolute(relative) ||
      hasParentReference(relative) ||
      slash(relative) !== relative ||
      relative.normalize("NFC") !== relative ||
      relative.startsWith(".git/") ||
      relative === ".git"
    )
      throw new Error(`成果物pathが不正です: ${relative}`);
    const absolute = path.resolve(directory, ...relative.split("/"));
    if (!isContained(directory, absolute))
      throw new Error(`成果物がstaging root外です: ${relative}`);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(`成果物はsymlinkでない通常fileが必要です: ${relative}`);
    if (fs.realpathSync(absolute) !== absolute)
      throw new Error(`成果物のsymlink祖先を拒否しました: ${relative}`);
    return { relative, digest: sha256(fs.readFileSync(absolute)) };
  });
  return sha256(stableJson(values));
}

export function listStagingArtifacts(directory: string): string[] {
  const contents = inventory(directory);
  if (contents.unsafe.length > 0)
    throw new Error(
      `安全にinventoryできないstaging内容があります: ${contents.unsafe.join("; ")}`,
    );
  return contents.artifacts;
}

function requiredArtifacts(mode: string): string[] {
  return mode === "full"
    ? ["00_要求定義.md", "01_要件定義.md", "02_設計.md", "03_実装計画.md"]
    : mode === "quick" || mode === "poc"
      ? ["00_要求定義.md"]
      : [];
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseStoredRecord(source: string): StoredStagingRecord {
  const parsed = parseJsonStrict(source, STAGING_RECORD_FILE);
  if (!isRecord(parsed)) throw new Error("記録はobjectでなければなりません");
  const unknown = Object.keys(parsed).filter(
    (field) => !STORED_FIELDS.has(field),
  );
  const missing = [...STORED_FIELDS].filter((field) => !(field in parsed));
  if (unknown.length > 0)
    throw new Error(`未知fieldを拒否しました: ${unknown.join(", ")}`);
  if (missing.length > 0)
    throw new Error(`必須fieldがありません: ${missing.join(", ")}`);
  if (parsed.schemaVersion !== "agent-skill-chain/staging-record/v1")
    throw new Error("schemaVersionが不正です");
  if (
    parsed.mode !== "quick" &&
    parsed.mode !== "full" &&
    parsed.mode !== "poc"
  )
    throw new Error("modeが不正です");
  if (!Array.isArray(parsed.artifacts))
    throw new Error("artifactsは配列が必要です");
  const artifacts = parsed.artifacts.map((value) => {
    if (typeof value !== "string")
      throw new Error("artifact pathは文字列が必要です");
    return value;
  });
  if (new Set(artifacts).size !== artifacts.length)
    throw new Error("artifact pathの重複を拒否しました");
  if (
    stableJson(artifacts) !==
    stableJson([...artifacts].sort((left, right) => left.localeCompare(right)))
  )
    throw new Error("artifactsは字句順でなければなりません");
  if (typeof parsed.digest !== "string" || !SHA256.test(parsed.digest))
    throw new Error("digestは64桁SHA-256でなければなりません");
  if (parsed.owner !== "runtime・project owner")
    throw new Error("ownerが既知のstaging ownerではありません");
  if (typeof parsed.createdAt !== "string")
    throw new Error("createdAtが不正です");
  parseInstant(parsed.createdAt, "createdAt");
  if (parsed.state !== "local-active" && parsed.state !== "sync-verified")
    throw new Error("stateが不正です");
  if (!isNullableString(parsed.tracker) || !isNullableString(parsed.syncedAt))
    throw new Error("trackerまたはsyncedAtが不正です");
  if (
    !isNullableString(parsed.syncDigest) ||
    !isNullableString(parsed.readBackDigest)
  )
    throw new Error("同期digestが不正です");
  if (
    parsed.checkpoint !== null &&
    parsed.checkpoint !== 4 &&
    parsed.checkpoint !== 8
  )
    throw new Error("checkpointが不正です");
  if (parsed.tracker !== null && !TRACKER.test(parsed.tracker))
    throw new Error("trackerはGitHub Issue URLまたはIssue番号が必要です");
  if (parsed.syncedAt !== null) parseInstant(parsed.syncedAt, "syncedAt");
  for (const digest of [parsed.syncDigest, parsed.readBackDigest])
    if (digest !== null && !SHA256.test(digest))
      throw new Error("同期digestは64桁SHA-256でなければなりません");
  const syncValues = [
    parsed.tracker,
    parsed.checkpoint,
    parsed.syncedAt,
    parsed.syncDigest,
    parsed.readBackDigest,
  ];
  if (
    parsed.state === "local-active" &&
    syncValues.some((value) => value !== null)
  )
    throw new Error("local-activeの同期証拠fieldはすべてnullが必要です");
  if (
    parsed.state === "sync-verified" &&
    (syncValues.some((value) => value === null) ||
      parsed.checkpoint !== (parsed.mode === "full" ? 8 : 4) ||
      parsed.syncDigest !== parsed.readBackDigest)
  )
    throw new Error(
      "sync-verifiedにはmode別最終checkpointと一致する完全な再読取証拠が必要です",
    );
  return {
    schemaVersion: parsed.schemaVersion,
    mode: parsed.mode,
    artifacts,
    digest: parsed.digest,
    owner: parsed.owner,
    createdAt: parsed.createdAt,
    state: parsed.state,
    tracker: parsed.tracker,
    checkpoint: parsed.checkpoint,
    syncedAt: parsed.syncedAt,
    syncDigest: parsed.syncDigest,
    readBackDigest: parsed.readBackDigest,
  };
}

export function readStoredStagingRecord(
  directory: string,
): StoredStagingRecord {
  return parseStoredRecord(
    fs.readFileSync(path.join(directory, STAGING_RECORD_FILE), "utf8"),
  );
}

export function refreshStoredStagingDigest(
  directory: string,
): StoredStagingRecord {
  const current = readStoredStagingRecord(directory);
  const artifacts = listStagingArtifacts(directory);
  const updated: StoredStagingRecord = {
    ...current,
    artifacts,
    digest: calculateStagingDigest(directory, artifacts),
  };
  writeFileAtomic(
    path.join(directory, STAGING_RECORD_FILE),
    `${JSON.stringify(updated, null, 2)}\n`,
  );
  const reread = readStoredStagingRecord(directory);
  if (JSON.stringify(reread) !== JSON.stringify(updated))
    throw new Error("staging digestの書き込み後読み取り確認に失敗しました");
  return reread;
}

function baseRecord(
  absolute: string,
  relative: string,
  input: Partial<StagingRecord>,
): StagingRecord {
  return {
    path: absolute,
    relative,
    mode: input.mode ?? "unknown",
    artifacts: input.artifacts ?? [],
    digest: input.digest ?? "",
    tracker: input.tracker,
    syncedAt: input.syncedAt,
    state: input.state ?? "retained",
    reasons: input.reasons ?? [],
    kind: input.kind ?? "unknown",
    owner: input.owner ?? "unknown",
    createdAt: input.createdAt,
    checkpoint: input.checkpoint,
    fingerprint: input.fingerprint ?? "",
  };
}

function inspectDirectory(
  context: InspectionContext,
  absolute: string,
  relative: string,
): StagingRecord {
  const contents = inventory(absolute);
  if (contents.unsafe.length > 0)
    return baseRecord(absolute, relative, {
      artifacts: contents.artifacts,
      reasons: contents.unsafe,
      kind: "directory",
      fingerprint: contents.fingerprint,
    });
  const recordPath = path.join(absolute, STAGING_RECORD_FILE);
  if (!fs.existsSync(recordPath)) {
    if (contents.artifacts.length === 0)
      return baseRecord(absolute, relative, {
        state: "deletion-ready",
        reasons: [
          "記録fileのないlegacy stagingですが、通常fileの成果物が1件もないため限定削除候補です",
        ],
        kind: "directory",
        owner: "runtime・project owner",
        fingerprint: contents.fingerprint,
      });
    return baseRecord(absolute, relative, {
      artifacts: contents.artifacts,
      reasons: [
        "記録fileのないlegacy stagingは成果物を再照合できないため保持します。staging-record.jsonへ移行して再previewしてください",
      ],
      kind: "directory",
      fingerprint: contents.fingerprint,
    });
  }
  let stored: StoredStagingRecord;
  try {
    stored = readStoredStagingRecord(absolute);
  } catch (error) {
    return baseRecord(absolute, relative, {
      artifacts: contents.artifacts,
      reasons: [
        `staging記録を検証できないため保持します: ${error instanceof Error ? error.message : String(error)}`,
      ],
      kind: "directory",
      fingerprint: contents.fingerprint,
    });
  }
  const reasons: string[] = [];
  const required = requiredArtifacts(stored.mode);
  const missingRequired = required.filter(
    (artifact) => !contents.artifacts.includes(artifact),
  );
  if (missingRequired.length > 0)
    reasons.push(
      `mode別の必要成果物が不足しています: ${missingRequired.join(", ")}`,
    );
  if (stableJson(stored.artifacts) !== stableJson(contents.artifacts))
    reasons.push("記録済み成果物一覧と現在の内容が一致しません");
  let currentDigest = "";
  try {
    currentDigest = calculateStagingDigest(absolute, contents.artifacts);
  } catch (error) {
    reasons.push(
      `成果物digestを検証できません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (currentDigest !== stored.digest)
    reasons.push("記録済みcontent digestと現在の成果物が一致しません");
  const expectedCheckpoint = stored.mode === "full" ? 8 : 4;
  const evidenceComplete =
    stored.state === "sync-verified" &&
    stored.tracker !== null &&
    stored.syncedAt !== null &&
    stored.checkpoint === expectedCheckpoint &&
    stored.syncDigest !== null &&
    stored.readBackDigest !== null &&
    stored.syncDigest === stored.readBackDigest;
  if (!evidenceComplete)
    reasons.push(
      `mode=${stored.mode}の最終checkpoint Step ${expectedCheckpoint}に対する書き込み後読み取り済み同期証拠がありません`,
    );
  const createdAtMs = parseInstant(stored.createdAt, "createdAt");
  const elapsed = context.nowMs - createdAtMs;
  if (elapsed < 0) reasons.push("createdAtが現在時刻より後のため保持します");
  const expired = elapsed >= context.retentionDays * 86_400_000;
  const state: StagingState =
    reasons.length > 0
      ? "retained"
      : expired
        ? "deletion-ready"
        : "sync-verified";
  if (state === "sync-verified")
    reasons.push(
      `同期確認済みですが保持期限${context.retentionDays}日を経過していないため保持します`,
    );
  if (state === "deletion-ready")
    reasons.push(
      `同期証拠、成果物digest、fingerprintを確認し保持期限${context.retentionDays}日を経過しています`,
    );
  return baseRecord(absolute, relative, {
    mode: stored.mode,
    artifacts: contents.artifacts,
    digest: currentDigest,
    tracker: stored.tracker ?? undefined,
    syncedAt: stored.syncedAt ?? undefined,
    state,
    reasons,
    kind: "directory",
    owner: stored.owner,
    createdAt: stored.createdAt,
    checkpoint: stored.checkpoint ?? undefined,
    fingerprint: contents.fingerprint,
  });
}

export function inspectStaging(input: {
  root: string;
  now: string;
  retentionDays: number;
}): StagingRecord[] {
  const context = inspectionContext(input);
  const boundary = stagingRootBoundary(context.root);
  const boundaryRelative = slash(path.relative(context.root, boundary.path));
  if (boundary.unsafe)
    return [
      baseRecord(boundary.path, boundaryRelative, {
        reasons: [boundary.unsafe],
        fingerprint: sha256(boundary.unsafe),
      }),
    ];
  if (!fs.existsSync(boundary.path)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs
      .readdirSync(boundary.path, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    return [
      baseRecord(boundary.path, STAGING_PREFIX, {
        reasons: [
          `staging rootを読み取れないため保持します: ${error instanceof Error ? error.message : String(error)}`,
        ],
      }),
    ];
  }
  return entries.map((entry) => {
    const absolute = path.join(boundary.path, entry.name);
    const relative = `${STAGING_PREFIX}/${entry.name}`;
    if (
      entry.name === "role-log" ||
      entry.name === "metrics" ||
      entry.name === ".git"
    )
      return baseRecord(absolute, relative, {
        reasons: [`${entry.name}/はstaging cleanupの対象外領域です`],
        kind: entry.isDirectory() ? "directory" : "unknown",
      });
    if (
      entry.name.normalize("NFC") !== entry.name ||
      hasUnsafeMeta(entry.name) ||
      hasParentReference(entry.name)
    )
      return baseRecord(absolute, relative, {
        reasons: ["安全でないstaging path表現のため保持します"],
      });
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      return baseRecord(absolute, relative, {
        reasons: [
          `staging pathを検査できないため保持します: ${error instanceof Error ? error.message : String(error)}`,
        ],
      });
    }
    if (stat.isSymbolicLink())
      return baseRecord(absolute, relative, {
        reasons: ["symlinkのstagingは削除対象外です"],
      });
    if (!stat.isDirectory())
      return baseRecord(absolute, relative, {
        reasons: ["issues直下の通常directoryではないため保持します"],
        kind: stat.isFile() ? "file" : "unknown",
        fingerprint: sha256(
          stableJson({
            mode: stat.mode,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          }),
        ),
      });
    const real = fs.realpathSync(absolute);
    if (
      path.dirname(real) !== boundary.path ||
      !isContained(boundary.path, real)
    )
      return baseRecord(absolute, relative, {
        reasons: [
          "staging pathがissues直下のroot内へ完全一致しないため保持します",
        ],
        kind: "directory",
      });
    return inspectDirectory(context, absolute, relative);
  });
}

function planHash(input: {
  root: string;
  candidates: StagingRecord[];
  excluded: Array<{ relative: string; reason: string }>;
}): string {
  return sha256(stableJson(input));
}

export function planStagingCleanup(input: {
  root: string;
  now: string;
  retentionDays: number;
}): StagingCleanupPlan {
  const records = inspectStaging(input);
  const root = canonicalRepositoryRoot(input.root);
  const candidates = records
    .filter((record) => record.state === "deletion-ready")
    .sort((left, right) => left.relative.localeCompare(right.relative));
  const excluded = records
    .filter((record) => record.state !== "deletion-ready")
    .flatMap((record) =>
      record.reasons.length > 0
        ? record.reasons.map((reason) => ({
            relative: record.relative,
            reason,
          }))
        : [
            {
              relative: record.relative,
              reason: "削除可能性を証明できないため保持します",
            },
          ],
    )
    .sort(
      (left, right) =>
        left.relative.localeCompare(right.relative) ||
        left.reason.localeCompare(right.reason),
    );
  return {
    version: 1,
    root,
    candidates,
    excluded,
    hash: planHash({ root, candidates, excluded }),
  };
}

function rejected(reason: string): ReturnType<typeof applyStagingCleanup> {
  return {
    state: "rejected",
    removed: [],
    retained: [{ relative: STAGING_PREFIX, reason }],
    recovery: [
      "対象を変更せず、root・保持期間・同期証拠を確認して新しいpreview hashを取得してください",
    ],
  };
}

function targetExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return false;
    throw error;
  }
}

export function applyStagingCleanup(
  input: {
    plan: StagingCleanupPlan;
    approvedHash: string;
    root: string;
    now: string;
    retentionDays: number;
  },
  remove: (target: { path: string; relative: string }) => void,
): {
  state: "completed" | "partially-completed" | "rejected";
  removed: string[];
  retained: Array<{ relative: string; reason: string }>;
  recovery: string[];
} {
  if (!SHA256.test(input.approvedHash))
    return rejected("approvedHashは64桁SHA-256でなければなりません");
  if (input.plan.version !== 1)
    return rejected("未対応のstaging cleanup plan versionです");
  let canonicalRoot: string;
  let current: StagingCleanupPlan;
  try {
    canonicalRoot = canonicalRepositoryRoot(input.root);
    current = planStagingCleanup({
      root: canonicalRoot,
      now: input.now,
      retentionDays: input.retentionDays,
    });
  } catch (error) {
    return rejected(
      `apply直前のstaging再検証に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const suppliedPlanHash = planHash({
    root: input.plan.root,
    candidates: input.plan.candidates,
    excluded: input.plan.excluded,
  });
  if (
    input.plan.root !== canonicalRoot ||
    input.plan.hash !== suppliedPlanHash ||
    input.approvedHash !== input.plan.hash ||
    current.hash !== input.plan.hash
  )
    return rejected(
      "root、承認済みreport hash、preview内容、またはapply直前の再planが一致しません",
    );
  const removed: string[] = [];
  const context = inspectionContext({
    root: canonicalRoot,
    now: input.now,
    retentionDays: input.retentionDays,
  });
  for (let index = 0; index < current.candidates.length; index += 1) {
    const target = current.candidates[index];
    let refreshed: StagingRecord | undefined;
    try {
      const stat = fs.lstatSync(target.path);
      if (!stat.isSymbolicLink() && stat.isDirectory())
        refreshed = inspectDirectory(context, target.path, target.relative);
    } catch {
      refreshed = undefined;
    }
    if (
      refreshed === undefined ||
      refreshed.state !== "deletion-ready" ||
      stableJson(refreshed) !== stableJson(target)
    ) {
      const pending = current.candidates.slice(index);
      const retained = [
        ...current.excluded,
        ...pending.map((record, pendingIndex) => ({
          relative: record.relative,
          reason:
            pendingIndex === 0
              ? "削除直前のfingerprint、content digest、同期証拠、またはfile種別がpreviewから変化しました"
              : "先行対象の状態が変化したため未処理のまま保持します",
        })),
      ];
      return {
        state: removed.length === 0 ? "rejected" : "partially-completed",
        removed,
        retained,
        recovery: [
          "状態が変化した対象を保持し、現在内容から新しいpreview hashを取得してください",
        ],
      };
    }
    try {
      remove({ path: target.path, relative: target.relative });
      if (targetExists(target.path))
        throw new Error("remove後も対象pathが存在します");
      removed.push(target.relative);
    } catch (error) {
      const pending = current.candidates.slice(index);
      return {
        state: "partially-completed",
        removed,
        retained: [
          ...current.excluded,
          ...pending.map((record, pendingIndex) => ({
            relative: record.relative,
            reason:
              pendingIndex === 0
                ? `削除に失敗したため保持します: ${error instanceof Error ? error.message : String(error)}`
                : "先行する削除が失敗したため未処理のまま保持します",
          })),
        ],
        recovery: [
          `削除済み対象を確認してください: ${removed.length > 0 ? removed.join(", ") : "なし"}`,
          `未処理対象を保持したまま原因を解消し、新しいpreviewから再実行してください: ${pending.map((record) => record.relative).join(", ")}`,
        ],
      };
    }
  }
  return {
    state: "completed",
    removed,
    retained: current.excluded,
    recovery: [],
  };
}

export function isStagingLifecyclePath(relative: string): boolean {
  const normalized = slash(relative);
  return (
    normalized === ".agent-skill-chain/tmp" ||
    normalized.startsWith(".agent-skill-chain/tmp/") ||
    normalized === ".agent-skill-chain/role-log" ||
    normalized.startsWith(".agent-skill-chain/role-log/") ||
    normalized === ".agent-skill-chain/metrics" ||
    normalized.startsWith(".agent-skill-chain/metrics/")
  );
}
