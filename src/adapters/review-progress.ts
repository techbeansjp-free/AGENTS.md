import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  latestReviewProgressDigest,
  makeReviewProgressEntry,
  makeReviewProgressSeal,
  parseReviewProgressRecords,
  projectReviewProgressTarget,
  type ReviewProgressRecord,
  type ReviewProgressState,
} from "../domain/review-progress.js";
import {
  REVIEW_PROGRESS_JOURNAL_FILE,
  withStagingMutationLock,
} from "../domain/staging.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { stableJson } from "../lib/security.js";
import { assertWorkflowStaging } from "./workflow-journal.js";
import { readStoredReviewSession } from "./review-session-store.js";

function context(stagingInput: string) {
  const staging = assertWorkflowStaging(stagingInput);
  const session = readStoredReviewSession(staging);
  if (!session?.anchor.progressInventory)
    throw new Error(
      "review sessionにparallel progress inventoryがありません。従来の直列経路を使用してください",
    );
  const root = path.resolve(staging, "../../../..");
  const head = git(
    ["rev-parse", "--verify", "HEAD^{commit}"],
    root,
  ).stdout.trim();
  if (head !== session.latestCandidateHeadSha)
    throw new Error("progress bindingのH_implがcurrent HEADと一致しません");
  const journal = path.join(staging, REVIEW_PROGRESS_JOURNAL_FILE);
  const records = fs.existsSync(journal)
    ? readJournal(journal)
    : ([] as readonly ReviewProgressRecord[]);
  for (const record of records)
    if (
      record.sessionId !== session.sessionId ||
      record.implementationHeadSha !== head
    )
      throw new Error(
        "progress journalのreview sessionまたはH_impl bindingが不正です",
      );
  const target = path.join(
    staging,
    session.anchor.progressInventory.targetPath,
  );
  const targetStat = fs.lstatSync(target);
  if (
    targetStat.isSymbolicLink() ||
    !targetStat.isFile() ||
    targetStat.nlink !== 1 ||
    (targetStat.mode & 0o777) !== session.anchor.progressInventory.fileMode ||
    fs.realpathSync(target) !== target
  )
    throw new Error("parallel progress targetのidentityまたはmodeが不正です");
  const targetDigest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(target))
    .digest("hex");
  if (targetDigest !== session.anchor.progressInventory.baselineDigest)
    throw new Error(
      "parallel progress targetがreview開始時点から変化しました。従来の直列経路を使用してください",
    );
  return {
    staging,
    session,
    head,
    journal,
    records,
    inventory: session.anchor.progressInventory,
    target,
  };
}

function readJournal(file: string): readonly ReviewProgressRecord[] {
  const stat = fs.lstatSync(file);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    fs.realpathSync(file) !== file
  )
    throw new Error(
      "progress journalはmode 100600の単一link通常fileが必要です",
    );
  return parseReviewProgressRecords(fs.readFileSync(file, "utf8"));
}

function writeJournal(
  file: string,
  records: readonly ReviewProgressRecord[],
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileAtomic(
    file,
    records.map((record) => stableJson(record)).join("\n") + "\n",
    { temporaryDirectory: path.dirname(path.dirname(file)) },
  );
  const reread = readJournal(file);
  if (stableJson(reread) !== stableJson(records))
    throw new Error("progress journalのwrite後read-backが一致しません");
}

export function appendReviewProgress(input: {
  staging: string;
  taskId: string;
  state: ReviewProgressState;
  recordedAt: string;
  expectedDigest: string | null;
  apply: boolean;
}) {
  const observed = context(input.staging);
  if (latestReviewProgressDigest(observed.records) !== input.expectedDigest)
    throw new Error("progress journal digestがpreview時点から変化しました");
  const duplicate = observed.records.find(
    (record) =>
      "taskId" in record &&
      record.taskId === input.taskId &&
      record.state === input.state &&
      record.recordedAt === input.recordedAt,
  );
  if (duplicate)
    return {
      applied: input.apply,
      idempotent: true,
      entry: duplicate,
      journalDigest: latestReviewProgressDigest(observed.records),
    };
  if (!observed.inventory.allowedTaskIds.includes(input.taskId))
    throw new Error(
      "progress taskIdは03_実装計画.mdに宣言済みでなければなりません",
    );
  const entry = makeReviewProgressEntry({
    previous: observed.records,
    sessionId: observed.session.sessionId,
    implementationHeadSha: observed.head,
    taskId: input.taskId,
    state: input.state,
    recordedAt: input.recordedAt,
  });
  if (!input.apply)
    return { applied: false, entry, journalDigest: entry.entryDigest };
  return withStagingMutationLock(observed.staging, () => {
    const current = context(observed.staging);
    if (latestReviewProgressDigest(current.records) !== input.expectedDigest)
      throw new Error("progress journal digestがapply直前に変化しました");
    writeJournal(current.journal, [...current.records, entry]);
    return { applied: true, entry, journalDigest: entry.entryDigest };
  });
}

export function sealReviewProgress(input: {
  staging: string;
  sealedAt: string;
  expectedDigest: string | null;
  apply: boolean;
}) {
  const observed = context(input.staging);
  if (latestReviewProgressDigest(observed.records) !== input.expectedDigest)
    throw new Error("progress journal digestがpreview時点から変化しました");
  const seal = makeReviewProgressSeal({
    previous: observed.records,
    sessionId: observed.session.sessionId,
    implementationHeadSha: observed.head,
    sealedAt: input.sealedAt,
  });
  if (!input.apply)
    return { applied: false, seal, journalDigest: seal.sealDigest };
  return withStagingMutationLock(observed.staging, () => {
    const current = context(observed.staging);
    if (latestReviewProgressDigest(current.records) !== input.expectedDigest)
      throw new Error("progress journal digestがapply直前に変化しました");
    writeJournal(current.journal, [...current.records, seal]);
    return { applied: true, seal, journalDigest: seal.sealDigest };
  });
}

export function projectReviewProgress(input: {
  staging: string;
  apply: boolean;
}) {
  if (input.apply)
    throw new Error(
      "parallel progress projectionはread-onlyです。review入力treeへ書き込めません",
    );
  const observed = context(input.staging);
  const source = fs.readFileSync(observed.target, "utf8");
  const targetDigest = crypto.createHash("sha256").update(source).digest("hex");
  const projected = projectReviewProgressTarget({
    inventory: observed.inventory,
    source,
    records: observed.records,
  });
  return { applied: false, projected, targetDigest };
}

export function verifyStoredReviewProgress(staging: string) {
  const observed = context(staging);
  const source = fs.readFileSync(observed.target, "utf8");
  const projected = projectReviewProgressTarget({
    inventory: observed.inventory,
    source,
    records: observed.records,
  });
  return {
    verified: true,
    sessionId: observed.session.sessionId,
    implementationHeadSha: observed.head,
    journalDigest: latestReviewProgressDigest(observed.records),
    targetDigest: crypto.createHash("sha256").update(source).digest("hex"),
    projected,
  };
}
