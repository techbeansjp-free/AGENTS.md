import fs from "node:fs";
import path from "node:path";

import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { PLAN_AMENDMENT_FILE } from "../domain/plan-seal.js";
import { parseReviewSessionState } from "../domain/review-convergence.js";
import {
  deriveWorkflowResume,
  type ResumeObservation,
  type WorkflowResume,
} from "../domain/workflow-resume.js";
import { git } from "../lib/process.js";
import { parseJsonStrict } from "../lib/security.js";
import { observeStoredDeliveryState } from "./delivery-state.js";
import { GIT_ENV } from "./review-diff.js";
import { REVIEW_SESSION_FILE } from "./review-session-store.js";
import { readVerificationRuns } from "./verification-run.js";
import { readWorkflowJournal } from "./workflow-journal.js";

const MAX_OBSERVED_FILE_BYTES = 2 * 1024 * 1024;

function attempt<T>(read: () => T): ResumeObservation<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** symlink・通常file以外・上限超過を拒否して読む。fileが無ければ`undefined`。 */
function readRegularFile(file: string): string | undefined {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat === undefined) return undefined;
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`${path.basename(file)}はsymlinkでない通常fileが必要です`);
  if (stat.size > MAX_OBSERVED_FILE_BYTES)
    throw new Error(`${path.basename(file)}が上限を超えています`);
  return fs.readFileSync(file, "utf8");
}

/**
 * previewへ加える再開状態を観測する（REQ-WF-046）。
 *
 * **書込・lock・recoveryを伴うreaderを呼ばない。** review sessionは
 * `readStoredReviewSession`がGitの再検証を伴うため使わず、fileの読取とJSONの
 * 形式検査だけを行う。Gitとの照合は各gateが独自に行う。readerごとの失敗は
 * `errors`へ入り、previewの既存判定を変えない。
 */
export function observeWorkflowResume(staging: string): WorkflowResume {
  return deriveWorkflowResume({
    staging,
    headSha: attempt(() =>
      git(
        ["rev-parse", "--verify", "HEAD^{commit}"],
        stagingRepositoryRoot(staging),
        { env: GIT_ENV },
      ).stdout.trim(),
    ),
    journal: attempt(() => readWorkflowJournal(staging).entries),
    amendments: attempt(() =>
      readRegularFile(path.join(staging, PLAN_AMENDMENT_FILE)),
    ),
    verificationRuns: attempt(() => readVerificationRuns(staging)),
    reviewSession: attempt(() => {
      const source = readRegularFile(path.join(staging, REVIEW_SESSION_FILE));
      return source === undefined
        ? null
        : parseReviewSessionState(parseJsonStrict(source, "review session"));
    }),
    delivery: attempt(() => observeStoredDeliveryState(staging)),
  });
}
