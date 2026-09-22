export const DEFAULT_LOCAL_REVIEW_PROMPT_CHUNK_BYTES = 24 * 1024;
export const DEFAULT_LOCAL_REVIEW_MAX_OUTPUT_TOKENS = 2048;
export const MIN_LOCAL_REVIEW_PROMPT_CHUNK_BYTES = 16 * 1024;
export const MAX_LOCAL_REVIEW_PROMPT_CHUNK_BYTES = 1024 * 1024;
export const MIN_LOCAL_REVIEW_MAX_OUTPUT_TOKENS = 128;
export const MAX_LOCAL_REVIEW_MAX_OUTPUT_TOKENS = 32 * 1024;

export function isValidLocalReviewPromptChunkBytes(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_LOCAL_REVIEW_PROMPT_CHUNK_BYTES &&
    value <= MAX_LOCAL_REVIEW_PROMPT_CHUNK_BYTES
  );
}

export function isValidLocalReviewMaxOutputTokens(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_LOCAL_REVIEW_MAX_OUTPUT_TOKENS &&
    value <= MAX_LOCAL_REVIEW_MAX_OUTPUT_TOKENS
  );
}
