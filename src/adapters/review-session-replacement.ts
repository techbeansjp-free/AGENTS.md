import fs from "node:fs";
import path from "node:path";
import {
  countedRounds,
  type ReviewSessionState,
} from "../domain/review-convergence.js";
import type { DeliveryState } from "../domain/delivery-state.js";
import { deriveEffectiveHead } from "../domain/evidence-reanchor.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  readStoredStagingRecord,
  refreshStoredStagingDigest,
  withStagingMutationLock,
} from "../domain/staging.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { stableJson } from "../lib/security.js";
import { observeStoredDeliveryState } from "./delivery-state.js";
import { readEvidenceReanchorChain } from "./evidence-reanchor.js";
import {
  preserveReviewProgressJournal,
  reviewProgressJournalPresent,
} from "./review-progress.js";
import { evidenceOnlySuffix } from "./review-diff.js";
import {
  REVIEW_SESSION_FILE,
  readStoredReviewSession,
} from "./review-session-store.js";
import {
  REVIEW_SESSION_REPLACEMENTS_FILE,
  readReplacementLines,
  readReviewSessionReplacements,
  replacedProgressPath,
  replacedSessionPath,
  sha256,
  type ReviewSessionReplacementRecord,
} from "./review-session-replacement-store.js";
import {
  assertWorkflowStaging,
  readWorkflowJournal,
} from "./workflow-journal.js";

/**
 * review session置換の前提（BR-01、02 §3.1）。1つでも欠ければ名指しして拒否する。
 *
 * **current H_implは呼出し側から受け取らない。** sessionのlatest candidateが固定済みPRの
 * 実効headそのもの、またはその証跡だけのsuffixの起点である場合に限り、そのcandidateを
 * current H_implとする。未reviewのcommitを含むsessionや未収束sessionは置換できない。
 */
export function replacementPreconditionErrors(input: {
  session: ReviewSessionState | null;
  delivery: DeliveryState | undefined;
  journalHasStep11: boolean;
  candidateIsCurrentImplementation: boolean;
}): string[] {
  const errors: string[] = [];
  if (input.session === null) errors.push("review sessionが存在しません");
  else if (input.session.status !== "converged")
    errors.push("review sessionがconvergedではありません");
  else if (!input.candidateIsCurrentImplementation)
    errors.push(
      "latest roundのcandidate HEADがcurrent H_impl（PR実効head、またはその証跡だけのsuffixの起点）と一致しません",
    );
  if (input.delivery?.state !== "pr-bound")
    errors.push("delivery stateがpr-boundではありません");
  if (input.delivery?.merge) errors.push("merge intentがあります");
  if (input.delivery?.step11 || input.journalHasStep11)
    errors.push("Step 11が記録されています");
  return errors;
}

interface ReplacementPlan {
  record: ReviewSessionReplacementRecord;
  line: string;
}

function stagingDigestMatches(staging: string): boolean {
  const stored = readStoredStagingRecord(staging);
  const artifacts = listStagingArtifacts(staging);
  return (
    stableJson(stored.artifacts) === stableJson(artifacts) &&
    stored.digest === calculateStagingDigest(staging, artifacts)
  );
}

function plan(
  staging: string,
  replacedAt: string,
): {
  errors: string[];
  plan?: ReplacementPlan;
} {
  const errors: string[] = [];
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length > 0)
    errors.push(`workflow journalが不正です: ${journal.errors.join("; ")}`);
  if (!stagingDigestMatches(staging))
    errors.push("staging成果物一覧またはcontent digestが保存値と一致しません");
  let records: ReviewSessionReplacementRecord[] = [];
  try {
    records = readReviewSessionReplacements(staging);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const session = readStoredReviewSession(staging);
  const delivery = observeStoredDeliveryState(staging);
  const pullRequestHeadSha = delivery
    ? deriveEffectiveHead({
        records: readEvidenceReanchorChain(staging),
        anchoredHeadSha: delivery.create.headSha,
      }).effectiveHeadSha
    : undefined;
  const candidate = session?.latestCandidateHeadSha;
  const candidateIsCurrentImplementation =
    candidate !== undefined &&
    pullRequestHeadSha !== undefined &&
    (candidate === pullRequestHeadSha ||
      evidenceOnlySuffix(
        stagingRepositoryRoot(staging),
        candidate,
        pullRequestHeadSha,
      ) !== undefined);
  errors.push(
    ...replacementPreconditionErrors({
      session,
      delivery,
      journalHasStep11: journal.entries.some((entry) => entry.step === 11),
      candidateIsCurrentImplementation,
    }),
  );
  if (errors.length > 0 || !session || !pullRequestHeadSha) return { errors };
  const sequence = records.length + 1;
  const file = path.join(staging, REVIEW_SESSION_FILE);
  const previousLine = readReplacementLines(staging).at(-1);
  const record: ReviewSessionReplacementRecord = {
    schemaVersion: "agent-skill-chain/review-session-replacement/v1",
    sequence,
    previousRecordDigest:
      previousLine === undefined ? null : sha256(previousLine),
    previousSession: {
      sessionId: session.sessionId,
      digest: sha256(fs.readFileSync(file)),
      status: "converged",
      rounds: session.rounds.length,
      countedRounds: countedRounds(session),
      initialHeadSha: session.anchor.initialHeadSha,
      latestCandidateHeadSha: session.latestCandidateHeadSha,
    },
    implementationHeadSha: session.latestCandidateHeadSha,
    pullRequestHeadSha,
    savedPath: replacedSessionPath(sequence),
    savedProgressPath: reviewProgressJournalPresent(staging)
      ? replacedProgressPath(sequence)
      : null,
    replacedAt,
  };
  for (const target of [record.savedPath, record.savedProgressPath])
    if (
      target !== null &&
      fs.existsSync(path.join(staging, ...target.split("/")))
    )
      return {
        errors: [`置換済みsessionの保存先 ${target} が既に存在します`],
      };
  return { errors: [], plan: { record, line: stableJson(record) } };
}

/**
 * 中断した置換を完了できるか確かめる（02 §6）。最終記録の置換前状態を現在のfileから
 * 再構成し、そのdigestが保存済みstaging digestと一致する場合だけ残りの段を行う。
 */
function interruptedReplacement(
  staging: string,
): ReviewSessionReplacementRecord | undefined {
  const records = readReviewSessionReplacements(staging, { pendingLast: true });
  const last = records.at(-1);
  if (!last) return undefined;
  const sessionFile = path.join(staging, REVIEW_SESSION_FILE);
  const savedFile = path.join(staging, last.savedPath);
  const sessionSource = fs.existsSync(sessionFile)
    ? fs.readFileSync(sessionFile)
    : fs.existsSync(savedFile)
      ? fs.readFileSync(savedFile)
      : undefined;
  if (
    sessionSource === undefined ||
    sha256(sessionSource) !== last.previousSession.digest ||
    (fs.existsSync(sessionFile) && fs.existsSync(savedFile))
  )
    return undefined;
  const earlier = readReplacementLines(staging).slice(0, -1);
  const excluded = new Set([
    last.savedPath,
    ...(last.savedProgressPath ? [last.savedProgressPath] : []),
    REVIEW_SESSION_FILE,
    REVIEW_SESSION_REPLACEMENTS_FILE,
  ]);
  const virtual = new Map<string, string>(
    listStagingArtifacts(staging)
      .filter((relative) => !excluded.has(relative))
      .map((relative) => [
        relative,
        sha256(fs.readFileSync(path.join(staging, ...relative.split("/")))),
      ]),
  );
  virtual.set(REVIEW_SESSION_FILE, sha256(sessionSource));
  if (earlier.length > 0)
    virtual.set(
      REVIEW_SESSION_REPLACEMENTS_FILE,
      sha256(`${earlier.join("\n")}\n`),
    );
  const artifacts = [...virtual.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  const stored = readStoredStagingRecord(staging);
  const digest = sha256(
    stableJson(
      artifacts.map((relative) => ({
        relative,
        digest: virtual.get(relative),
      })),
    ),
  );
  return stableJson(stored.artifacts) === stableJson(artifacts) &&
    stored.digest === digest
    ? last
    : undefined;
}

function moveReplacedFiles(
  staging: string,
  record: ReviewSessionReplacementRecord,
): void {
  const source = path.join(staging, REVIEW_SESSION_FILE);
  const target = path.join(staging, record.savedPath);
  if (fs.existsSync(source)) {
    if (fs.existsSync(target))
      throw new Error(
        `置換済みsessionの保存先 ${record.savedPath} が既に存在します`,
      );
    fs.renameSync(source, target);
  }
  if (record.savedProgressPath)
    preserveReviewProgressJournal(staging, record.savedProgressPath);
}

export interface ReviewSessionReplacementResult {
  state: "preview" | "replaced";
  record: ReviewSessionReplacementRecord;
  recovered: boolean;
  stagingDigest?: string;
  next: string;
}

function nextStep(record: ReviewSessionReplacementRecord): string {
  return `git switch --detach ${record.implementationHeadSha}でH_implへdetachし、review round --init --head=${record.implementationHeadSha} --base=<既定branch tipまたはmerge-base>でround 1（full-scope）を収束させてください。その後branchへ戻り、workflow record --step=10 --post-pr-intake、review export、push、pr reanchorの順に進めます`;
}

/**
 * `review replace`（review session置換、TERM-1569-01、REQ-WF-052）。
 *
 * applyは置換記録1行の追記 → `review-session.json`（とreview progress journal）の
 * 保存名へのrename → staging digest再固定の順に行う。旧sessionはrenameで移すため
 * byte一致で残る。前提違反ではstagingを1byteも変更しない（INV-08）。
 */
export function replaceReviewSession(input: {
  staging: string;
  apply: boolean;
  now?: string;
}): ReviewSessionReplacementResult {
  const staging = assertWorkflowStaging(input.staging);
  const replacedAt = input.now ?? new Date().toISOString();
  if (!input.apply) {
    const observed = plan(staging, replacedAt);
    if (!observed.plan)
      throw new ReviewSessionReplacementError(observed.errors);
    return {
      state: "preview",
      record: observed.plan.record,
      recovered: false,
      next: nextStep(observed.plan.record),
    };
  }
  return withStagingMutationLock(staging, () => {
    if (!stagingDigestMatches(staging)) {
      const interrupted = interruptedReplacement(staging);
      if (interrupted) {
        moveReplacedFiles(staging, interrupted);
        const stagingDigest = refreshStoredStagingDigest(staging).digest;
        readReviewSessionReplacements(staging);
        return {
          state: "replaced",
          record: interrupted,
          recovered: true,
          stagingDigest,
          next: nextStep(interrupted),
        };
      }
    }
    const observed = plan(staging, replacedAt);
    if (!observed.plan)
      throw new ReviewSessionReplacementError(observed.errors);
    writeFileAtomic(
      path.join(staging, ...REVIEW_SESSION_REPLACEMENTS_FILE.split("/")),
      `${[...readReplacementLines(staging), observed.plan.line].join("\n")}\n`,
      { temporaryDirectory: path.dirname(staging) },
    );
    moveReplacedFiles(staging, observed.plan.record);
    const stagingDigest = refreshStoredStagingDigest(staging).digest;
    const reread = readReviewSessionReplacements(staging).at(-1);
    if (!reread || stableJson(reread) !== stableJson(observed.plan.record))
      throw new Error("置換記録の書き込み後read-backが一致しません");
    return {
      state: "replaced",
      record: reread,
      recovered: false,
      stagingDigest,
      next: nextStep(reread),
    };
  });
}

export class ReviewSessionReplacementError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`review session置換の前提を満たしません: ${reasons.join("; ")}`);
  }
}
