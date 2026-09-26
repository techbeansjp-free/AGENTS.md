import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { stableJson } from "../lib/security.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  readStoredStagingRecord,
  refreshStoredStagingDigest,
  withStagingMutationLock,
} from "../domain/staging.js";
import {
  readStagingLayout,
  stagingExcludePathspec,
  stagingRepositoryRoot,
} from "../domain/staging-layout.js";
import {
  DELIVERY_STATE_FILE,
  parseDeliveryState,
} from "../domain/delivery-state.js";
import { loadTrustedVerificationPolicy } from "../domain/policy.js";
import {
  parseVerificationRuns,
  renderVerificationRuns,
  sealVerificationRun,
  validateVerificationArgv,
  verificationCommandViolation,
  VERIFICATION_RUN_FILE,
  VERIFICATION_RUN_SCHEMA_VERSION,
  type VerificationRunRecord,
  type VerificationScope,
} from "../domain/verification-run.js";
import type { ImpactSet } from "../domain/impact-set.js";
import { computeImpactSet } from "./impact-set.js";
import { GIT_ENV } from "./review-diff.js";
import { readStoredReviewSession } from "./review-session-store.js";
import {
  assertWorkflowStaging,
  readWorkflowJournal,
} from "./workflow-journal.js";

/** 記録fileの上限。超えたら読まずに拒否する（fail closed）。 */
const MAX_RECORD_FILE_BYTES = 8 * 1024 * 1024;

/**
 * stagingの検証記録を厳密に読む。**fileが無ければ空である。** symlink・hardlink・
 * 通常file以外・上限超過・1行でも読めない記録は全体を拒否する。
 */
export function readVerificationRuns(
  stagingInput: string,
): readonly VerificationRunRecord[] {
  const staging = assertWorkflowStaging(stagingInput);
  const file = path.join(staging, ...VERIFICATION_RUN_FILE.split("/"));
  const directory = path.dirname(file);
  const directoryStat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (directoryStat === undefined) return Object.freeze([]);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
    throw new Error("検証記録directoryはsymlinkでない通常directoryが必要です");
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat === undefined) return Object.freeze([]);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
    throw new Error("検証記録はsymlink・hardlinkでない通常fileが必要です");
  if (stat.size > MAX_RECORD_FILE_BYTES)
    throw new Error(
      `検証記録fileが上限${MAX_RECORD_FILE_BYTES} byteを超えています`,
    );
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino)
      throw new Error("検証記録が読取直前に変化しました");
    return parseVerificationRuns(fs.readFileSync(descriptor, "utf8"));
  } finally {
    fs.closeSync(descriptor);
  }
}

function stagingDigestConsistent(staging: string): boolean {
  try {
    const stored = readStoredStagingRecord(staging);
    const artifacts = listStagingArtifacts(staging);
    return (
      stableJson(stored.artifacts) === stableJson(artifacts) &&
      stored.digest === calculateStagingDigest(staging, artifacts)
    );
  } catch {
    return false;
  }
}

/**
 * delivery段階から`verify run`の可否を判定する（REQ-WF-040）。
 *
 * - **merge段階以降（`merge-prepared`・`merge-observed`・`reconciliation-required`、
 *   merge済みまたは再配送中の`step11-recorded`）は拒否する。** mergeへ渡した証跡の
 *   検証欄は確定済みであり、後から記録を足してstagingを動かさない
 * - PR停止のStep 11記録後（post-terminal intakeの窓）は記録だけを許し、
 *   **staging digestを再固定しない。** Step 11後のdigestを更新できるのは
 *   `workflow record`のpost-terminal intakeだけである
 *
 * 読めないjournal・delivery stateは拒否する（fail closed）。
 */
function verificationDeliveryPhase(staging: string): "open" | "post-terminal" {
  const file = path.join(staging, ...DELIVERY_STATE_FILE.split("/"));
  const delivery = fs.existsSync(file)
    ? parseDeliveryState(fs.readFileSync(file, "utf8"))
    : undefined;
  if (
    delivery !== undefined &&
    (delivery.state === "merge-prepared" ||
      delivery.state === "merge-observed" ||
      delivery.state === "reconciliation-required" ||
      (delivery.state === "step11-recorded" &&
        (delivery.step11?.outcome !== "pull-request" ||
          delivery.redelivery !== undefined)))
  )
    throw new Error(
      `delivery stateが${delivery.state}（merge段階以降）のためverify runを記録できません。merge済み・merge準備済みの証跡へ後から検証記録を足してstagingを動かすことはできません`,
    );
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length > 0)
    throw new Error(
      `workflow journalを読めないためverify runを記録できません: ${journal.errors.join("; ")}`,
    );
  return journal.entries.some(({ step }) => step === 11) ||
    delivery?.state === "step11-recorded"
    ? "post-terminal"
    : "open";
}

/**
 * 検証記録を1件追記する。既存記録を厳密に読み直してから、全体をatomicに書き換える。
 *
 * **staging digestは、追記前に記録と一致していた場合だけ再固定する。** 追記前から
 * 不一致なら無関係な変更を正当化しないためそのままにする（review roundとStep記録が
 * 従来どおり再固定する）。**Step 11記録後は再固定しない**（`verificationDeliveryPhase`）。
 */
export function appendVerificationRun(
  stagingInput: string,
  record: VerificationRunRecord,
): readonly VerificationRunRecord[] {
  const staging = assertWorkflowStaging(stagingInput);
  return withStagingMutationLock(staging, () => {
    const existing = readVerificationRuns(staging);
    if (existing.some((item) => item.recordDigest === record.recordDigest))
      throw new Error("同じrecordDigestの検証記録が既にあります");
    const phase = verificationDeliveryPhase(staging);
    const consistent = phase === "open" && stagingDigestConsistent(staging);
    const next = [...existing, record];
    const file = path.join(staging, ...VERIFICATION_RUN_FILE.split("/"));
    const directory = path.dirname(file);
    const directoryStat = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (directoryStat === undefined) fs.mkdirSync(directory, { mode: 0o700 });
    writeFileAtomic(file, renderVerificationRuns(next), {
      temporaryDirectory: path.dirname(staging),
    });
    if (consistent) refreshStoredStagingDigest(staging);
    const reread = readVerificationRuns(staging);
    if (stableJson(reread) !== stableJson(next))
      throw new Error("検証記録の書き込み後read-backが一致しません");
    return reread;
  });
}

function resolveCommit(root: string, label: string, value: string): string {
  const observed = git(["rev-parse", "--verify", `${value}^{commit}`], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  if (observed.status !== 0)
    throw new Error(`${label}をexact commitへ解決できません: ${value}`);
  return observed.stdout.trim();
}

/**
 * 追跡fileと未追跡fileが現在HEADと完全一致するかを観測する。stagingの配置rootは
 * 除く（Step 9の候補worktree検査と同じ形）。
 */
function worktreeDifferences(root: string): string {
  return git(
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      stagingExcludePathspec(readStagingLayout(root)),
    ],
    root,
    { env: GIT_ENV },
  ).stdout;
}

/**
 * 検証の比較基点と影響集合を解決する。**比較基点は`--base`、無ければreview sessionの
 * 比較基点である。** どちらも無ければ拒否する。
 */
export function resolveVerificationTarget(input: {
  staging: string;
  headSha: string;
  base?: string;
}): { baseSha: string; impact: ImpactSet } {
  const staging = assertWorkflowStaging(input.staging);
  const root = stagingRepositoryRoot(staging);
  let baseSha: string;
  if (input.base !== undefined)
    baseSha = resolveCommit(root, "--base", input.base);
  else {
    const session = readStoredReviewSession(staging);
    if (session === null)
      throw new Error(
        "verify runにはreview sessionの比較基点か--base=<commit>が必要です",
      );
    baseSha = session.anchor.diffBaseSha;
  }
  return {
    baseSha,
    impact: computeImpactSet({ root, baseSha, headSha: input.headSha }),
  };
}

export interface VerificationRunResult {
  readonly record: VerificationRunRecord;
  readonly impact: ImpactSet;
}

/**
 * 検証commandを**shellを通さず**argvのまま実行し、結果を機械記録へ追記する
 * （`verify run`、REQ-WF-040）。
 *
 * 0. merge段階以降のdelivery stateと、trusted policyに検証command宣言が無い場合は拒否する
 * 1. 候補worktreeが現在HEADと完全一致することを要求し、HEADのexact SHAを記録する
 * 2. 比較基点..HEADの影響集合を導出する。影響集合がfullなら`scope=targeted`を拒否する。
 *    argvは既定branchのtrusted policyの宣言に一致しなければならない。`scope=full`は
 *    `verification.fullCommand`と完全一致、`scope=targeted`は`verification.targetedRunner`
 *    で始まり影響集合の選んだfeatureを全部含む
 * 3. commandを実行する。出力は標準エラーへ中継し、記録にはdigestだけを残す
 * 4. 実行後もHEADとworktreeが変わっていないことを確かめてから記録する
 */
export async function runVerification(input: {
  staging: string;
  argv: readonly string[];
  scope: VerificationScope;
  base?: string;
  now?: () => Date;
  output?: NodeJS.WritableStream;
}): Promise<VerificationRunResult> {
  const staging = assertWorkflowStaging(input.staging);
  const root = stagingRepositoryRoot(staging);
  const argv = validateVerificationArgv([...input.argv], "verify runのcommand");
  const now = input.now ?? (() => new Date());
  const output = input.output ?? process.stderr;
  if (input.scope !== "targeted" && input.scope !== "full")
    throw new Error("verify runの--scopeはtargetedまたはfullが必要です");
  verificationDeliveryPhase(staging);
  /**
   * **commandはtrusted policyの宣言に束縛する。** 既定branchのtrusted commitから
   * 読み、candidateのworktreeは読まない。宣言が無ければ実行前に拒否する。
   */
  const policy = loadTrustedVerificationPolicy(root);
  if (worktreeDifferences(root) !== "")
    throw new Error(
      "verify runは追跡fileと未追跡fileが現在HEADと完全一致するworktreeでだけ実行できます。変更をcommitしてから再実行してください",
    );
  const headSha = resolveCommit(root, "current HEAD", "HEAD");
  const { baseSha, impact } = resolveVerificationTarget({
    staging,
    headSha,
    ...(input.base === undefined ? {} : { base: input.base }),
  });
  if (input.scope === "targeted" && impact.mode === "full")
    throw new Error(
      `影響集合がfullのためscope=targetedの検証は記録できません: ${impact.reasons.slice(0, 3).join("; ")}`,
    );
  const violation = verificationCommandViolation(
    argv,
    input.scope,
    policy,
    impact.features,
  );
  if (violation !== undefined)
    throw new Error(`verify runを拒否しました: ${violation}`);
  const [file, ...args] = argv as [string, ...string[]];
  const startedAt = now().toISOString();
  const stdout = crypto.createHash("sha256");
  const stderr = crypto.createHash("sha256");
  const outcome = await new Promise<{
    exitCode: number | null;
    signal: string | null;
  }>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: root,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.update(chunk);
      output.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.update(chunk);
      output.write(chunk);
    });
    child.once("error", (error) =>
      reject(
        new Error(
          `verify runのcommandを起動できません: ${file}（${(error as NodeJS.ErrnoException).code ?? error.name}）`,
        ),
      ),
    );
    child.once("close", (code, signal) =>
      resolve({ exitCode: signal === null ? code : null, signal }),
    );
  });
  const finishedAt = now().toISOString();
  if (resolveCommit(root, "current HEAD", "HEAD") !== headSha)
    throw new Error(
      "verify runの実行中にHEADが変わりました。観測を記録しません",
    );
  if (worktreeDifferences(root) !== "")
    throw new Error(
      "verify runの実行後に追跡fileまたは未追跡fileが変わりました。観測を記録しません。commandが生成するfileを.gitignoreへ入れるか、commitと一致する状態で再実行してください",
    );
  const record = sealVerificationRun({
    schemaVersion: VERIFICATION_RUN_SCHEMA_VERSION,
    baseSha,
    headSha,
    command: argv,
    scope: input.scope,
    impactDigest: impact.digest,
    impactMode: impact.mode,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    startedAt,
    finishedAt,
    stdoutDigest: stdout.digest("hex"),
    stderrDigest: stderr.digest("hex"),
  });
  appendVerificationRun(staging, record);
  return { record, impact };
}
