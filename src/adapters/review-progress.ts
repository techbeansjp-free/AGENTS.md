import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  latestReviewProgressDigest,
  makeReviewProgressEntry,
  makeReviewProgressSeal,
  parseReviewProgressRecords,
  projectReviewProgressTarget,
  reviewProgressTargets,
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
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { readStoredReviewSession } from "./review-session-store.js";

function context(stagingInput: string) {
  const staging = assertWorkflowStaging(stagingInput);
  const session = readStoredReviewSession(staging);
  if (!session?.anchor.progressInventory)
    throw new Error(
      "review sessionにparallel progress inventoryがありません。従来の直列経路を使用してください",
    );
  const root = stagingRepositoryRoot(staging);
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
  const targets = reviewProgressTargets(session.anchor.progressInventory).map(
    (inventory) => {
      const target = path.join(staging, inventory.targetPath);
      const targetStat = fs.lstatSync(target);
      if (
        targetStat.isSymbolicLink() ||
        !targetStat.isFile() ||
        targetStat.nlink !== 1 ||
        (targetStat.mode & 0o777) !== inventory.fileMode ||
        fs.realpathSync(target) !== target
      )
        throw new Error(
          `parallel progress targetのidentityまたはmodeが不正です: ${inventory.targetPath}`,
        );
      const targetDigest = crypto
        .createHash("sha256")
        .update(fs.readFileSync(target))
        .digest("hex");
      if (targetDigest !== inventory.baselineDigest)
        throw new Error(
          `parallel progress targetがreview開始時点から変化しました: ${inventory.targetPath}`,
        );
      return { inventory, target };
    },
  );
  return {
    staging,
    session,
    head,
    journal,
    records,
    inventory: session.anchor.progressInventory,
    targets,
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
  if (
    !reviewProgressTargets(observed.inventory).some(({ allowedTaskIds }) =>
      allowedTaskIds.includes(input.taskId),
    )
  )
    throw new Error(
      `progress taskIdは宣言済みprogress targetに存在しなければなりません: ${reviewProgressTargets(
        observed.inventory,
      )
        .map(({ targetPath }) => targetPath)
        .join("、")}`,
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
  const targets = observed.targets.map(({ inventory, target }) => {
    const source = fs.readFileSync(target, "utf8");
    return {
      targetPath: inventory.targetPath,
      targetDigest: crypto.createHash("sha256").update(source).digest("hex"),
      projected: projectReviewProgressTarget({
        inventory,
        source,
        records: observed.records,
      }),
    };
  });
  return {
    applied: false,
    targets,
    targetDigest: targets[0]!.targetDigest,
    projected: targets[0]!.projected,
  };
}

export function verifyStoredReviewProgress(staging: string) {
  const observed = context(staging);
  const targets = observed.targets.map(({ inventory, target }) => {
    const source = fs.readFileSync(target, "utf8");
    return {
      targetPath: inventory.targetPath,
      targetDigest: crypto.createHash("sha256").update(source).digest("hex"),
      projected: projectReviewProgressTarget({
        inventory,
        source,
        records: observed.records,
      }),
    };
  });
  return {
    verified: true,
    sessionId: observed.session.sessionId,
    implementationHeadSha: observed.head,
    journalDigest: latestReviewProgressDigest(observed.records),
    targets,
    targetDigest: targets[0]!.targetDigest,
    projected: targets[0]!.projected,
  };
}
