/** Evaluation only: explicit synthetic rollout records; never exports prompts or code. */
// Codex paginated forks retain ancestor metadata before an explicit own-thread boundary.
// Only the observed, unambiguous form is supported; unknown layouts remain errors.
export function ownNativeEvents(events){
 const metas=events.filter(e=>e.type==='session_meta');
 if(metas.length===1){
  const m=metas[0].payload;
  if(m?.forked_from_id||m?.subagent_history_start_ordinal!==undefined)throw new Error('Ambiguous inherited session identity');
  return events;
 }
 const meta=events[0]?.type==='session_meta'?events[0].payload:null;
 const index=meta?.subagent_history_start_ordinal,boundary=events[index]?.payload;
 if(metas.length!==2||!meta?.id||!meta.forked_from_id||meta.history_mode!=='paginated'
  ||meta.source?.subagent?.thread_spawn?.parent_thread_id!==meta.forked_from_id
  ||metas[1].payload?.id!==meta.forked_from_id||meta.id===meta.forked_from_id
  ||!Number.isSafeInteger(index)||index<2||index>=events.length
  ||events[index]?.type!=='event_msg'||boundary?.type!=='thread_settings_applied'||boundary.thread_id!==meta.id
  ||events.slice(index).some(e=>e.type==='session_meta'))throw new Error('Ambiguous inherited session identity');
 const own=events.slice(index),usage=own.filter(e=>e.type==='token_usage_record');
 if(!usage.length||usage.some(e=>e.payload?.thread_id!==meta.id))throw new Error('Missing own-thread usage identity');
 const cumulative=own.filter(e=>e.type==='event_msg'&&e.payload?.type==='token_count').at(-1)?.payload?.info?.total_token_usage;
 const bound=usage.at(-1).payload;
 if(!cumulative||![bound.turn_token_usage,bound.thread_token_usage].some(counter=>counter&&['input_tokens','cached_input_tokens','output_tokens','cache_write_input_tokens'].every(k=>cumulative[k]===counter[k])))throw new Error('Own-thread usage mismatch');
 return [events[0],...own];
}
export function summarizeNativeUsage(rootId, rollouts) {
  const threads = new Map(), cacheWrites = [];
  for (const raw of rollouts) {
    const events=ownNativeEvents(raw);
    const metas = events.filter(e => e.type === 'session_meta');
    if (metas.length !== 1) throw new Error('Expected one session identity');
    const meta = metas[0].payload;
    if (!meta?.id || threads.has(meta.id)) throw new Error('Duplicate or missing session identity');
    const parent = meta.source?.subagent?.thread_spawn?.parent_thread_id ?? null;
    const counts = events.filter(e => e.type === 'event_msg' && e.payload?.type === 'token_count');
    const latest = counts.at(-1)?.payload?.info?.total_token_usage;
    const records=events.filter(e=>e.type==='token_usage_record');
    if(records.some(e=>e.payload?.thread_id!==meta.id))throw Error('Foreign usage identity');
    const seen={};
    for(const record of records){
     const counters=record.payload.thread_token_usage;
     for(const k of ['input_tokens','cached_input_tokens','output_tokens','cache_write_input_tokens']){
      const value=counters?.[k];
      if(seen[k]!==undefined&&(value===undefined||!Number.isSafeInteger(value)||value<seen[k]))throw Error('Non-monotonic thread usage');
      if(Number.isSafeInteger(value)&&value>=0)seen[k]=value;
     }
    }
    const bound=records.at(-1)?.payload;
    const turn=bound?.turn_token_usage??bound?.thread_token_usage;
    if(bound&&(!latest||![turn,bound.thread_token_usage].some(counter=>counter&&['input_tokens','cached_input_tokens','output_tokens','cache_write_input_tokens'].every(k=>latest[k]===counter[k]))))throw Error('Usage counter mismatch');
    // token_count resets on resume; the provider-bound thread counter spans turns.
    const usage = bound?bound.thread_token_usage:latest;
    if(bound&&(!usage||['input_tokens','cached_input_tokens','output_tokens'].some(k=>!Number.isSafeInteger(turn[k])||turn[k]<0||usage[k]<turn[k])))throw Error('Invalid thread usage');
    const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
    const valid = usage && fields.every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0)
      && usage.cached_input_tokens <= usage.input_tokens;
    const writes=usage?.cache_write_input_tokens;
    cacheWrites.push({id:meta.id,tokens:valid&&Number.isSafeInteger(writes)&&writes>=0?writes:null});
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
  const missingCacheWrites=cacheWrites.filter(t=>t.tokens===null).map(t=>t.id);
  const observedCacheWrites=cacheWrites.reduce((sum,t)=>sum+(t.tokens??0),0);
  if(!Number.isSafeInteger(observedCacheWrites))throw new Error('Aggregated cache writes exceed safe integer range');
  return {cacheWriteInput:{observedTokens:observedCacheWrites,totalTokens:missingCacheWrites.length?null:observedCacheWrites,missingThreads:missingCacheWrites,threads:cacheWrites,scope:'Provider-reported cache write input, recorded separately; not added to processed tokens or converted to cost.'},rootId, observedThreads: calls.length, missingUsage: missing, measured,
    observedProcessedTokens: missing.length ? null : measured.inputTokens + measured.outputTokens,
    scope: 'Explicitly supplied rollouts only. Descendant inventory and completed execution must be verified separately; cached input is included in input.', calls};
}

/** A continued coordinator retains cumulative counters; subtract each retained thread once. */
export function nativePhaseUsage(rootId, beforeRollouts, afterRollouts) {
 const before=summarizeNativeUsage(rootId,beforeRollouts),after=summarizeNativeUsage(rootId,afterRollouts);
 const previous=new Map(before.calls.map(t=>[t.id,t])),current=new Map(after.calls.map(t=>[t.id,t]));
 for(const [id,t] of previous)if(!current.has(id)||current.get(id).parent!==t.parent)throw Error('Phase thread inventory changed');
 const fields=['input_tokens','cached_input_tokens','output_tokens'];
 const differences=after.calls.map(t=>{
  const old=previous.get(t.id);
  if(old?.usage&&!t.usage)throw Error('Phase usage counter disappeared');
  if(!t.usage||(old&&!old.usage))return {id:t.id,usage:null};
  const usage=Object.fromEntries(fields.map(k=>[k,t.usage[k]-(old?.usage[k]??0)]));
  if(Object.values(usage).some(n=>!Number.isSafeInteger(n)||n<0)||usage.cached_input_tokens>usage.input_tokens)throw Error('Non-monotonic phase usage');
  return {id:t.id,usage};
 });
 const missing=differences.filter(t=>!t.usage).map(t=>t.id);
 const measured=differences.reduce((sum,t)=>Object.fromEntries(fields.map(k=>[k,sum[k]+(t.usage?.[k]??0)])),Object.fromEntries(fields.map(k=>[k,0])));
 const total=measured.input_tokens+measured.output_tokens;
 if(!Object.values(measured).every(Number.isSafeInteger)||!Number.isSafeInteger(total))throw Error('Unsafe phase usage total');
 const writes=new Map(before.cacheWriteInput.threads.map(t=>[t.id,t.tokens]));
 const cache=after.cacheWriteInput.threads.map(t=>{
  const old=writes.get(t.id);
  if(old!==undefined&&old!==null&&t.tokens===null)throw Error('Phase cache write counter disappeared');
  const tokens=t.tokens===null||(writes.has(t.id)&&old===null)?null:t.tokens-(old??0);
  if(tokens!==null&&(!Number.isSafeInteger(tokens)||tokens<0))throw Error('Non-monotonic phase cache writes');
  return {id:t.id,tokens};
 });
 const observed=cache.reduce((n,t)=>n+(t.tokens??0),0);
 if(!Number.isSafeInteger(observed))throw Error('Unsafe phase cache writes');
 return {rootId,measured,observedProcessedTokens:missing.length?null:total,missingUsage:missing,threads:differences,
  cacheWriteInput:{observedTokens:observed,totalTokens:cache.some(t=>t.tokens===null)?null:observed,threads:cache},
  scope:'Difference of Host cumulative observations for the same coordinator; includes new and resumed descendants. Missing/reset counters are not zero. Full trial totals use final cumulative usage, not sum of phase totals.'};
}
