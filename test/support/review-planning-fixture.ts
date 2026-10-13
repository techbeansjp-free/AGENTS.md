import { assertPlanFrozenForEntries } from "../../src/adapters/plan-seal.js";
import { readWorkflowJournal } from "../../src/adapters/workflow-journal.js";

/** Supply the same observed planning identity as review round --init in hand-written fixtures. */
export function fixturePlanningDigest(
  staging: string | undefined,
): string | undefined {
  if (!staging) return undefined;
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length > 0) throw new Error(journal.errors.join("; "));
  return assertPlanFrozenForEntries(staging, journal.entries)?.digest;
}
