// Everything that is specific to condition I (after the improvement) lives in this one file (review M-1), so that stage 3
// may adapt it to the product interface that is actually released without touching scoring, gold, criteria or the R/P/H
// paths. fixation.mjs stage3 allows this file to differ from the first record only with a recorded reason and an
// independent review reference; every other fixed file must stay byte-identical. The exported names, the import lines
// and the absence of top-level statements are checked mechanically (review L-1); the review checks that the meaning of
// rule 5 (a trial whose hook did not fire is a failure) is kept. No model call.
//
// Assumed product interface (IMPROVEMENT_DESIGN.md, a draft): the project-assets plan has
// readTrigger: {default, options: [{id, path, action, beforeSha256, blockSha256, diff}]}, and apply accepts
// --adopt-read-trigger <id>@<beforeSha256>:<blockSha256> (the released interface after the product review; changed at
// stage 3 under the STAGE3_ALLOWED rule with a recorded reason and review).
import crypto from 'node:crypto';

// Extra arguments for `project-assets ... --apply` and the record of what was adopted, from the plan shown to the user.
export function adoptFromPlan(plan, id) {
  const option = (plan.readTrigger?.options ?? []).find((o) => o.id === id);
  if (!option) throw new Error(`the release's project-assets plan offers no read-trigger option ${id}`);
  return {args: ['--adopt-read-trigger', `${option.id}@${option.beforeSha256}:${option.blockSha256}`],
    adopted: {id: option.id, path: option.path, action: option.action, beforeSha256: option.beforeSha256, blockSha256: option.blockSha256, diffSha256: crypto.createHash('sha256').update(String(option.diff ?? '')).digest('hex'), default: plan.readTrigger.default ?? null}};
}

// Probe expectation for condition I: the pointer head appears anywhere in the answer (the adopted CLAUDE.md block may end
// with a closing delimiter, so it need not be the last line). The head text is here so a released wording change can be
// followed at stage 3 (review L-2).
export const pointerExpectedI = (cond) => cond.pointerDelivered === true;
export const pointerHeadI = 'このプロジェクトでASCを使う';

// Hook evidence for the product hook (it does not write the fixture hook log): SessionStart responses in the trace.
export const productHookFiredInProbe = (hookLogLines, sessionStartResponses) => hookLogLines === 0 && sessionStartResponses >= 1;
export const productHookFiredInTrial = (hookEventCount) => hookEventCount > 0;
