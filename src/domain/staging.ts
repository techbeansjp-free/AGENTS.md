import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../lib/process.js";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { isRecord } from "../types.js";

export type StagingState =
  | "local-active"
  | "promotion-active"
  | "sync-verified"
  | "deletion-ready"
  | "retained"
  | "deleted";

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
  state: "local-active" | "promotion-active" | "sync-verified";
  tracker: string | null;
  checkpoint: 4 | 8 | null;
  syncedAt: string | null;
  syncDigest: string | null;
  readBackDigest: string | null;
}

export const STAGING_RECORD_FILE = "staging-record.json";
export const STAGING_PROMOTION_TRANSACTION_FILE =
  ".full-promotion-transaction.json";
const ISSUE_STAGING_PREFIX = ".agent-skill-chain/tmp/issues";
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
const CURRENT_TRACKER =
  /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/[1-9]\d*$/u;
const LEGACY_TRACKER = /^#?([1-9]\d*)$/u;
const heldMutationLocks = new Set<string>();

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

/**
 * staging単位のwriter lock。lock自体は成果物digestへ混ぜないようissues直下へ置く。
 * 同一process内は再入可能とし、process停止で残ったlockだけをPID確認後に回収する。
 */
export function withStagingMutationLock<Result>(
  directory: string,
  mutate: () => Result,
): Result {
  const staging = path.resolve(directory);
  const stat = fs.lstatSync(staging);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("staging writer lockには通常directoryが必要です");
  if (fs.realpathSync(staging) !== staging)
    throw new Error("staging writer lockにsymlink祖先を使用できません");
  const lockPath = path.join(
    path.dirname(staging),
    `.${path.basename(staging)}.mutation.lock`,
  );
  if (heldMutationLocks.has(lockPath)) return mutate();

  const nonce = crypto.randomBytes(16).toString("hex");
  const source = `${stableJson({
    schemaVersion: "agent-skill-chain/staging-mutation-lock/v1",
    pid: process.pid,
    nonce,
  })}\n`;
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
    const temporary = path.join(
      path.dirname(staging),
      `.${path.basename(staging)}.mutation-${process.pid}-${nonce}.tmp`,
    );
    fs.writeFileSync(temporary, source, { flag: "wx", mode: 0o600 });
    try {
      const descriptor = fs.openSync(temporary, "r");
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      try {
        fs.linkSync(temporary, lockPath);
        acquired = true;
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ))
          throw error;
      }
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    if (acquired) break;
    const lockStat = fs.lstatSync(lockPath);
    if (lockStat.isSymbolicLink() || !lockStat.isFile())
      throw new Error("staging writer lockが通常fileではありません");
    const value = parseJsonStrict(
      fs.readFileSync(lockPath, "utf8"),
      "staging writer lock",
    );
    if (
      !isRecord(value) ||
      value.schemaVersion !== "agent-skill-chain/staging-mutation-lock/v1" ||
      !Number.isInteger(value.pid) ||
      (value.pid as number) <= 0 ||
      typeof value.nonce !== "string" ||
      !/^[a-f0-9]{32}$/u.test(value.nonce)
    )
      throw new Error("staging writer lockの内容が不正です");
    if (processIsAlive(value.pid as number))
      throw new Error(
        `別process（pid=${String(value.pid)}）がstagingを更新中です`,
      );
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
  if (!acquired) throw new Error("staging writer lockを取得できませんでした");

  heldMutationLocks.add(lockPath);
  let result: Result | undefined;
  let mutationError: unknown;
  let mutationFailed = false;
  try {
    result = mutate();
  } catch (error) {
    mutationFailed = true;
    mutationError = error;
  }
  heldMutationLocks.delete(lockPath);
  if (fs.existsSync(lockPath)) {
    const current = fs.readFileSync(lockPath, "utf8");
    if (current !== source)
      throw new Error("staging writer lockの所有権が実行中に変化しました", {
        ...(!mutationFailed
          ? {}
          : {
              cause:
                mutationError instanceof Error
                  ? mutationError
                  : new Error(String(mutationError)),
            }),
      });
    fs.unlinkSync(lockPath);
  }
  if (mutationFailed) throw mutationError;
  return result as Result;
}

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
  if (
    parsed.state !== "local-active" &&
    parsed.state !== "promotion-active" &&
    parsed.state !== "sync-verified"
  )
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
  if (
    parsed.tracker !== null &&
    !CURRENT_TRACKER.test(parsed.tracker) &&
    !LEGACY_TRACKER.test(parsed.tracker)
  )
    throw new Error(
      "trackerはabsolute GitHub Issue URLまたはlegacy Issue番号が必要です",
    );
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
  if (
    parsed.state === "promotion-active" &&
    (parsed.mode !== "full" ||
      syncValues.some((value) => value === null) ||
      parsed.checkpoint !== 4 ||
      parsed.syncDigest !== parsed.readBackDigest)
  )
    throw new Error(
      "promotion-activeには昇格前Step 4の完全な再読取証拠とmode=fullが必要です",
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

/**
 * v0.3.1以前に保存された`#123`/`123` trackerを、trustedなrepository・Issue入力へ
 * 一致する場合だけ現行のabsolute URLへ一度だけ移行する。新規writeの入力契約は
 * `recordStagingSync`が引き続きabsolute URLだけに制限する。
 */
export function migrateLegacyStagingTracker(
  directory: string,
  input: Readonly<{ repository: string; issue: number }>,
): StoredStagingRecord {
  if (
    !/^[^/\s]+\/[^/\s]+$/u.test(input.repository) ||
    !Number.isSafeInteger(input.issue) ||
    input.issue <= 0
  )
    throw new Error("legacy tracker移行対象のrepositoryまたはIssueが不正です");
  const resolved = path.resolve(directory);
  return withStagingMutationLock(resolved, () => {
    const current = readStoredStagingRecord(resolved);
    const expected = `https://github.com/${input.repository}/issues/${input.issue}`;
    if (current.tracker?.toLowerCase() === expected.toLowerCase())
      return current;
    const legacy =
      typeof current.tracker === "string"
        ? LEGACY_TRACKER.exec(current.tracker)
        : null;
    if (!legacy || Number(legacy[1]) !== input.issue)
      throw new Error(
        "legacy trackerが移行対象のrepository・Issueと一致しません",
      );
    writeFileAtomic(
      path.join(resolved, STAGING_RECORD_FILE),
      `${stableJson({ ...current, tracker: expected })}\n`,
    );
    const reread = readStoredStagingRecord(resolved);
    if (reread.tracker !== expected)
      throw new Error("legacy trackerの移行後read-backが一致しません");
    return reread;
  });
}

export function refreshStoredStagingDigest(
  directory: string,
): StoredStagingRecord {
  return withStagingMutationLock(directory, () => {
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
  });
}

/**
 * quick / poc stagingを、同じIssueと同期証拠を維持したままfullへ単調昇格する。
 *
 * 既にStep 4まで同期済みの場合、その証拠は過去の観測として保持する。ただしfullの
 * 最終同期Step 8をまだ満たさないため、PR-readyな`sync-verified`ではなく
 * `promotion-active`へ遷移する。未同期なら`local-active`のまま進める。
 */
export function promoteStoredStagingModeToFull(
  directory: string,
): StoredStagingRecord {
  return withStagingMutationLock(directory, () => {
    if (
      !fs.existsSync(path.join(directory, STAGING_PROMOTION_TRANSACTION_FILE))
    )
      throw new Error("full昇格には永続transaction markerが必要です");
    const current = readStoredStagingRecord(directory);
    if (current.mode === "full")
      throw new Error("stagingは既にfullであり、再昇格できません");
    const artifacts = listStagingArtifacts(directory);
    const updated: StoredStagingRecord = {
      ...current,
      mode: "full",
      artifacts,
      digest: calculateStagingDigest(directory, artifacts),
      state:
        current.state === "sync-verified" ? "promotion-active" : "local-active",
    };
    writeFileAtomic(
      path.join(directory, STAGING_RECORD_FILE),
      `${JSON.stringify(updated, null, 2)}\n`,
    );
    const reread = readStoredStagingRecord(directory);
    if (JSON.stringify(reread) !== JSON.stringify(updated))
      throw new Error("full昇格記録の書き込み後読み取り確認に失敗しました");
    return reread;
  });
}

/**
 * transaction markerを残したまま、markerを除く最終成果物集合とdigestをrecordへ固定する。
 * 呼び出し側はこのrecordと全成果物をfsyncした後にだけmarkerを削除する。
 */
export function finalizeStoredStagingPromotion(
  directory: string,
): StoredStagingRecord {
  return withStagingMutationLock(directory, () => {
    const marker = path.join(directory, STAGING_PROMOTION_TRANSACTION_FILE);
    if (!fs.existsSync(marker))
      throw new Error("full昇格の最終確定にはtransaction markerが必要です");
    const current = readStoredStagingRecord(directory);
    if (current.mode !== "full")
      throw new Error("full昇格の最終確定にはmode=fullが必要です");
    const artifacts = listStagingArtifacts(directory).filter(
      (artifact) => artifact !== STAGING_PROMOTION_TRANSACTION_FILE,
    );
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
      throw new Error("full昇格最終記録の書き込み後読み取り確認に失敗しました");
    return reread;
  });
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
      baseRecord(boundary.path, ISSUE_STAGING_PREFIX, {
        reasons: [
          `staging rootを読み取れないため保持します: ${error instanceof Error ? error.message : String(error)}`,
        ],
      }),
    ];
  }
  return entries.map((entry) => {
    const absolute = path.join(boundary.path, entry.name);
    const relative = `${ISSUE_STAGING_PREFIX}/${entry.name}`;
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
    retained: [{ relative: ISSUE_STAGING_PREFIX, reason }],
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

/**
 * Issue一時ステージング配下のrepository相対pathかを判定する。
 * 区切りを正規化したうえで、空・`.`・`..`のsegmentを含むpathは判定不能として
 * 偽を返す。除外側へ倒さないことでfail-closedにする。
 */
export function isIssueStagingPath(relative: string): boolean {
  if (typeof relative !== "string" || relative === "") return false;
  const segments = relative.replaceAll("\\", "/").split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    return false;
  const prefix = ISSUE_STAGING_PREFIX.split("/");
  if (segments.length <= prefix.length) return false;
  return prefix.every((segment, index) => segments[index] === segment);
}

/**
 * 一時ライフサイクル領域のrepository相対prefix。**この一覧が分類の唯一の正本である。**
 *
 * `.gitignore`、配布物検査の除外一覧、領域判定はいずれもこの一覧から導出または照合する。
 * 一覧を持たずに判定だけを書くと、宣言が箇所ごとに分岐して黙ってずれる。
 * `readonly`は型検査だけの制約なので、runtimeでも変更できないよう凍結する。
 */
export const STAGING_LIFECYCLE_AREAS: readonly string[] = Object.freeze([
  ".agent-skill-chain/tmp",
  ".agent-skill-chain/role-log",
  ".agent-skill-chain/metrics",
]);

export function isStagingLifecyclePath(relative: string): boolean {
  const normalized = slash(relative);
  return STAGING_LIFECYCLE_AREAS.some(
    (area) => normalized === area || normalized.startsWith(`${area}/`),
  );
}
