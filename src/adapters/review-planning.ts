import type { ReviewSessionState } from "../domain/review-convergence.js";
import { assertPlanFrozenForEntries } from "./plan-seal.js";
import { readWorkflowJournal } from "./workflow-journal.js";

/** Bind review to the sealed request and append-only AMD generation, not only Git HEAD. */
export function currentPlanningDigest(
  staging: string,
  headSha: string,
): string | undefined {
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length > 0) throw new Error(journal.errors.join("; "));
  return assertPlanFrozenForEntries(staging, journal.entries, headSha)?.digest;
}

export function assertReviewPlanningBinding(
  staging: string,
  session: ReviewSessionState,
  headSha: string,
): void {
  const current = currentPlanningDigest(staging, headSha);
  if (session.rounds.at(-1)?.planningDigest !== current)
    throw new Error(
      "reviewの計画digestが現在のPlanning Seal・AMDと一致しません。現在の計画を独立reviewしてから再利用してください",
    );
}
