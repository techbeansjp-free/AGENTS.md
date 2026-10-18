/** Evaluation only: explicit synthetic rollout records; never exports prompts or code. */
export function summarizeNativeUsage(rootId, rollouts) {
  const threads = new Map();
  for (const events of rollouts) {
    const metas = events.filter(e => e.type === 'session_meta');
    if (metas.length !== 1) throw new Error('Expected one session identity');
    const meta = metas[0].payload;
    if (!meta?.id || threads.has(meta.id)) throw new Error('Duplicate or missing session identity');
    const parent = meta.source?.subagent?.thread_spawn?.parent_thread_id ?? null;
    const counts = events.filter(e => e.type === 'event_msg' && e.payload?.type === 'token_count');
    const usage = counts.at(-1)?.payload?.info?.total_token_usage;
    const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
    const valid = usage && fields.every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0)
      && usage.cached_input_tokens <= usage.input_tokens;
    threads.set(meta.id, {id: meta.id, parent, usage: valid ? Object.fromEntries(fields.map(k => [k, usage[k]])) : null});
  }
  if (!threads.has(rootId)) throw new Error('Root session missing');
  const selected = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of threads.values()) if (!selected.has(t.id) && selected.has(t.parent)) { selected.add(t.id); changed = true; }
  }
  if (selected.size !== threads.size) throw new Error('Unrelated or disconnected rollout');
  const calls = [...threads.values()];
  const missing = calls.filter(t => !t.usage).map(t => t.id);
  const measured = calls.filter(t => t.usage).reduce((sum, t) => ({
    inputTokens: sum.inputTokens + t.usage.input_tokens,
    cachedInputTokens: sum.cachedInputTokens + t.usage.cached_input_tokens,
    outputTokens: sum.outputTokens + t.usage.output_tokens,
  }), {inputTokens: 0, cachedInputTokens: 0, outputTokens: 0});
  if (!Object.values(measured).every(Number.isSafeInteger) || !Number.isSafeInteger(measured.inputTokens + measured.outputTokens)) throw new Error('Aggregated usage exceeds safe integer range');
  return {rootId, observedThreads: calls.length, missingUsage: missing, measured,
    observedProcessedTokens: missing.length ? null : measured.inputTokens + measured.outputTokens,
    scope: 'Explicitly supplied rollouts only. Descendant inventory and completed execution must be verified separately; cached input is included in input.', calls};
}
