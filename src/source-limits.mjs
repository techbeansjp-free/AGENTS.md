/* Git batch size is an I/O chunk, not a repository or individual file limit. */
export const SOURCE_BATCH_BYTES=12_000_000;
/* One wall-clock guard for local Git children that cannot prompt, fetch or run
   hooks. It detects a stalled child, not slow work (#1669). */
export const LOCAL_GIT_TIMEOUT_MILLISECONDS=120_000;
