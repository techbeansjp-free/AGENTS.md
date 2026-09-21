import {
  MAX_SUGGESTION_BYTES,
  verifyReviewSuggestion,
} from "./review-suggestion.js";

export interface CommittableSuggestion {
  headSha: string;
  patch: string;
}

interface FindingWithFile {
  file: string;
}

const MAX_CANDIDATES = 8;
const MAX_TOTAL_PATCH_BYTES = 256 * 1024;
const MAX_VALIDATION_MS = 5_000;

/** Keep raw model patches outside all finding arrays and the second LLM pass. */
export function attachVerifiedReviewSuggestions<
  T extends FindingWithFile,
>(input: {
  root: string;
  headSha: string;
  findings: T[];
  candidates: ReadonlyMap<T, string>;
  afterCandidateValidation?: () => void;
}): Array<T & { committableSuggestion?: CommittableSuggestion }> {
  const deadline = Date.now() + MAX_VALIDATION_MS;
  let checked = 0;
  let totalBytes = 0;
  return input.findings.map((finding) => {
    const patch = input.candidates.get(finding);
    if (patch === undefined) return finding;
    const bytes = Buffer.byteLength(patch, "utf8");
    if (bytes > MAX_SUGGESTION_BYTES) return finding;
    if (
      checked >= MAX_CANDIDATES ||
      totalBytes + bytes > MAX_TOTAL_PATCH_BYTES ||
      Date.now() >= deadline
    )
      return finding;
    totalBytes += bytes;
    checked += 1;
    try {
      const committableSuggestion = verifyReviewSuggestion({
        root: input.root,
        headSha: input.headSha,
        file: finding.file,
        patch,
        timeoutMs: Math.max(1, deadline - Date.now()),
      });
      input.afterCandidateValidation?.();
      return committableSuggestion
        ? { ...finding, committableSuggestion }
        : finding;
    } catch {
      // A suggestion is optional: a failed check cannot erase the finding.
      return finding;
    }
  });
}
