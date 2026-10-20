/** Classify only the provider's terminal protocol record, never tool output. */
export function providerFailure(output) {
  let terminal;
  for (const line of String(output).split('\n')) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record?.type === 'turn.failed' || record?.type === 'turn.completed') terminal = record;
  }
  if (terminal?.type !== 'turn.failed') return undefined;
  // Exact observed provider response. Unknown failures are not retry authority.
  if (terminal.error?.message !== 'Selected model is at capacity. Please try a different model.') return undefined;
  return {code:'ASC_PROVIDER_CAPACITY', retryable:true};
}
