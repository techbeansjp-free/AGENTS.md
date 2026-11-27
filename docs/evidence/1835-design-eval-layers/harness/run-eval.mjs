// Run the evaluators on the blind packets (EVAL_PLAN.md sections 3 and 5). One independent call per unit:
//   D  one per case packet          P  one per pair packet          Fc  F critique, one per screen packet
//   Fs F score of that critique (text only, no screenshots)          Neg F score of one sentence of negation-pairs.json
// Usage:
//   node harness/run-eval.mjs run --packets <out>/packets --runs <dir> --evaluator fable|codex
//        [--methods D,P,Fc,Fs,Neg] [--rounds 1,2] [--only <packet,...>] [--skip-packets <file>] [--retries 0|1]
//        [--prior-ledger <ledger.jsonl>] [--lock <path>]... [--dry-run [--dry-invalid-every N] [--cap-usd N]]
//   node harness/run-eval.mjs plan --packets <out>/packets --key <out>/key/key.json --per-call D=..,P=..,Fc=..,Fs=..,Neg=..
//        [--prior-ledger <ledger.jsonl>] [--skip-out <file>]       (budget projection and the reduction of plan 5.2)
// A paid run (no --dry-run) is refused unless ASC1835_ALLOW_PAID=1. --dry-run never starts a model: it builds the same
// command lines, writes outputs in the CLI's format with a fixed fake answer, and goes through parsing, the ledger and the
// budget stop. --cap-usd is accepted only with --dry-run (the paid cap is config budget.capUsd).
// Records: <runs>/<evaluator>/round<r>/<method>/<call>/{prompt.txt, argv.json, attempt-<n>.stdout, attempt-<n>.stderr, status.json}
// and <runs>/ledger.jsonl (one line per attempt, header line first). A call with status.json is not run again (resume).
// Retries: none by default; at most 1 (config retries.max), counted in status.json. Invalid answers are recorded as missing.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, loadConfig, readJson, writeJson, extractJson, makeRng, shuffle, sha256} from './eval-common.mjs';

const ORDER = ['D', 'P', 'Fc', 'Fs', 'Neg'];
const PROMPT = {D: 'D.txt', P: 'P.txt', Fc: 'F-critique.txt', Fs: 'F-score.txt', Neg: 'F-score.txt'};
const PACKET_METHOD = {D: 'D', P: 'P', Fc: 'F'};

export function anchorsText(anchors) {
  return [1, 2, 3, 4, 5].map((r) => `${r}：\n` + anchors.sets.map((s) => `  - ${s.levels[r - 1]}`).join('\n')).join('\n');
}
export function buildPrompt(method, cfg, {critique} = {}) {
  const t = fs.readFileSync(path.join(ROOT, 'prompts', PROMPT[method]), 'utf8');
  return t.replaceAll('{{HEAD}}', fs.readFileSync(path.join(ROOT, 'prompts/common-head.txt'), 'utf8').trim())
    .replaceAll('{{REASON_MAX}}', String(cfg.limits.reasonMaxChars)).replaceAll('{{CRITIQUE_MAX}}', String(cfg.limits.critiqueMaxChars))
    .replaceAll('{{ANCHORS}}', anchorsText(readJson(path.join(ROOT, 'anchors.json')))).replaceAll('{{CRITIQUE}}', critique ?? '');
}

// The planned calls of one evaluator, in execution order (round, then D, P, Fc, Fs, Neg).
export function planCalls({index, methods = ORDER, rounds, only = null, skip = new Set(), negPairs}) {
  const calls = [];
  for (const round of rounds) for (const m of ORDER.filter((x) => methods.includes(x))) {
    if (m === 'Neg') {
      if (!only) for (const p of negPairs.pairs) for (const side of ['positive', 'negative']) calls.push({id: `neg-${p.id}-${side}`, round, method: m, text: p[side]});
      continue;
    }
    const pm = m === 'Fs' ? 'F' : PACKET_METHOD[m];
    for (const e of index.filter((x) => x.round === round && x.method === pm && !skip.has(x.packet) && (!only || only.has(x.packet)))) {
      calls.push(m === 'Fs' ? {id: `fs-${e.packet}`, round, method: m, packet: e.packet} : {id: e.packet, round, method: m, packet: e.packet});
    }
  }
  return calls;
}

export function validate(method, answer, task, cfg) {
  if (!answer || typeof answer !== 'object') return 'no JSON object in the final text';
  if (method === 'P') return ['A', 'B', '同等'].includes(answer.choice) ? null : `choice ${JSON.stringify(answer.choice)}`;
  if (method === 'Fc') return typeof answer.critique === 'string' && answer.critique.trim() ? null : 'critique missing';
  if (method === 'Fs' || method === 'Neg') return Number.isInteger(answer.score) && answer.score >= 1 && answer.score <= 5 ? null : `score ${JSON.stringify(answer.score)}`;
  if (method === 'D') {
    const g = answer.groups;
    if (!g || typeof g !== 'object') return 'groups missing';
    for (const grp of task.groups) {
      const r = g[grp.name];
      if (!Array.isArray(r) || r.length !== grp.order.length || new Set(r).size !== r.length || !r.every((x) => grp.order.includes(x))) return `group ${grp.name} is not a ranking of its ids`;
    }
    if (Object.keys(g).length !== task.groups.length) return 'extra groups';
    return null;
  }
  return `unknown method ${method}`;
}

export function fableArgs({prompt, cfg, method, budgetUsd}) {
  const ev = cfg.evaluators.fable, lim = cfg.limits.fable[method];
  // #1807/#1815 isolation (asc host-session --restricted): file tools Read/Glob/Grep only, closed to the cwd; no MCP, no hooks.
  return ['-p', prompt, '--model', ev.model, '--restricted', '--tools', ev.tools, '--permission-mode', 'dontAsk', '--strict-mcp-config',
    '--settings', '{"disableAllHooks":true}', '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--max-turns', String(lim.maxTurns),
    '--max-budget-usd', budgetUsd.toFixed(4)];
}
export function codexArgs({prompt, cfg, cwd}) {
  return ['exec', '--ephemeral', '-s', 'read-only', '-C', cwd, '--skip-git-repo-check', '--json', '-m', cfg.evaluators.codex.model, '-c', 'project_doc_max_bytes=0', prompt];
}

// ---- path helpers for the isolation / images-read checks ----
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const within = (p, dir) => { const d = real(dir), r = real(p); return r === d || r.startsWith(d + path.sep); };
export const listPngs = (dir) => (dir && fs.existsSync(dir) ? (function walkPng(d) { return fs.readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walkPng(path.join(d, e.name)) : e.name.endsWith('.png') ? [path.join(d, e.name)] : [])); })(dir) : []);

// Parse the Fable CLI output (--output-format stream-json --verbose: one JSON event per line) into
// {text, usd, tokens, error, toolCalls:[{name, path}], hasResult}. Tool calls are the tool_use blocks of assistant events;
// the final result event carries result / total_cost_usd / usage / duration_ms. A plain single JSON object (the old
// --output-format json shape) is still read as a result event with no tool calls.
export function parseFable(stdout) {
  const events = [];
  for (const line of stdout.split('\n')) { if (!line.trim()) continue; try { events.push(JSON.parse(line)); } catch { /* not an event line */ } }
  if (!events.length) return {text: null, usd: null, tokens: null, toolCalls: [], hasResult: false, error: 'stdout has no JSON event'};
  const toolCalls = [];
  for (const e of events) if (e.type === 'assistant' && Array.isArray(e.message?.content)) for (const c of e.message.content) {
    if (c?.type === 'tool_use') toolCalls.push({name: c.name, path: c.input?.file_path ?? c.input?.path ?? null, pattern: c.input?.pattern ?? null});
  }
  const j = [...events].reverse().find((e) => e.type === 'result');
  if (!j) return {text: null, usd: null, tokens: null, toolCalls, hasResult: false, error: 'no final result event'};
  const u = j.usage ?? {};
  return {text: typeof j.result === 'string' ? j.result : null, usd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null, numTurns: j.num_turns ?? null, durationMs: j.duration_ms ?? null,
    tokens: {input: u.input_tokens ?? null, cacheCreation: u.cache_creation_input_tokens ?? null, cacheRead: u.cache_read_input_tokens ?? null, output: u.output_tokens ?? null},
    toolCalls, hasResult: true,
    error: j.is_error ? `is_error (${j.subtype ?? '?'})` : (j.subtype && j.subtype !== 'success' ? j.subtype : null)};
}
// Missing reason images-not-read: any PNG handed over (in the call's packet) that no Read tool call targeted.
export function checkImagesRead({toolCalls, images, cwd}) {
  const read = new Set(toolCalls.filter((t) => t.name === 'Read' && typeof t.path === 'string').map((t) => real(path.resolve(cwd, t.path))));
  const unread = images.filter((f) => !read.has(real(f)));
  return {imagesExpected: images.length, imagesRead: images.length - unread.length, unread: unread.map((f) => path.relative(cwd, f)), reason: unread.length ? 'images-not-read' : null};
}

const SAFE_BIN = /^(\/bin|\/usr\/bin|\/usr\/local\/bin|\/opt\/homebrew\/bin|\/usr\/sbin|\/sbin)\/[\w.+-]+$|^\/dev\/(null|stdin|stdout|stderr)$/;
// Paths named in one shell command string (a heuristic tokenizer; no shell is run). unconfirmed: the string uses shell
// features this cannot resolve ($VAR, `...`, $(...), glob '..', 'cd'), so its paths cannot be judged.
export function pathsInCommand(command, cwd) {
  const unconfirmed = /\$|`|\bcd\b|\beval\b/.test(command);
  const paths = [];
  for (const tok of command.split(/[\s"'`;|&<>(){}=,:]+/)) {
    if (!tok || tok.startsWith('-')) continue;
    if (tok === '..' || tok.startsWith('../') || tok.startsWith('/') || tok.startsWith('~') || tok.includes('/../') || tok.endsWith('/..')) {
      if (SAFE_BIN.test(tok)) continue;
      paths.push(tok.startsWith('~') ? path.join(process.env.HOME ?? '/', tok.slice(1)) : path.resolve(cwd, tok));
    }
  }
  return {paths, unconfirmed};
}
// Parse `codex exec --json` (JSONL). Command events are item.started/item.completed with item.type 'command_execution'
// (item.command = the shell string). Other item types are not about files and are ignored, except file_change,
// mcp_tool_call, web_search and unknown ones, which are recorded as shapes this cannot judge.
const CODEX_QUIET = new Set(['agent_message', 'reasoning', 'error', 'todo_list']);
export function parseCodex(stdout, cwd = null) {
  let text = null, tokens = null, error = null;
  const commands = [], other = new Set();
  let events = 0;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    events++;
    if (e.type === 'item.completed' && e.item?.type === 'agent_message') text = e.item.text;
    if (e.type === 'turn.completed' && e.usage) tokens = {input: e.usage.input_tokens ?? null, cacheRead: e.usage.cached_input_tokens ?? null, output: e.usage.output_tokens ?? null};
    if (e.type === 'turn.failed' || e.type === 'error') error = e.error?.message ?? e.message ?? e.type;
    if (e.type === 'item.completed' && e.item) {
      if (e.item.type === 'command_execution') commands.push(typeof e.item.command === 'string' ? e.item.command : null);
      else if (!CODEX_QUIET.has(e.item.type)) other.add(String(e.item.type));
    }
  }
  const out = {text, usd: null, tokens, error};
  if (cwd) out.isolation = checkCodexIsolation({commands, other: [...other], events, cwd});
  return out;
}
// Missing reason isolation-violation: a command touched a path outside the packet directory (-C).
// isolation 'unconfirmed' (recorded, not missing): no event of a known shape, or a command/item that cannot be judged.
export function checkCodexIsolation({commands, other, events, cwd}) {
  const outside = [], why = [];
  let judged = 0;
  for (const c of commands) {
    if (typeof c !== 'string') { why.push('command event without a command string'); continue; }
    const r = pathsInCommand(c, cwd);
    judged++;
    for (const p of r.paths) if (!within(p, cwd)) outside.push({command: c.slice(0, 200), path: p});
    if (r.unconfirmed) why.push(`command uses shell features that cannot be resolved: ${c.slice(0, 80)}`);
  }
  for (const o of other) why.push(`event item type ${o} cannot be judged`);
  if (!events) why.push('no JSON events');
  const reason = outside.length ? 'isolation-violation' : null;
  return {commands: commands.length, judged, outside, state: reason ? 'violation' : why.length ? 'unconfirmed' : 'checked', why, reason};
}

// A fixed fake answer for --dry-run (same output format as the CLI).
// trace (dry-run only): 'all' reads every image; 'skip-one' leaves the first image unread; 'outside' also touches a path outside cwd;
// 'no-result' drops the final result event (Fable); 'odd' makes Codex emit only an item shape that cannot be judged.
export function fakeOutput({evaluator, method, task, callId, attempt, cfg, invalid, budgetUsd = null, images = [], cwd = '/', trace = 'all'}) {
  const rnd = makeRng('dry-run', `${evaluator}:${callId}:${attempt}`);
  let ans;
  if (method === 'P') ans = {choice: ['A', 'B', '同等'][Math.floor(rnd() * 3)], reason: '偽の回答（dry-run）'};
  else if (method === 'D') ans = {groups: Object.fromEntries(task.groups.map((g) => [g.name, shuffle(g.order, rnd)]))};
  else if (method === 'Fc') { const a = readJson(path.join(ROOT, 'anchors.json')); ans = {critique: a.sets[0].levels[Math.floor(rnd() * 5)]}; }
  else ans = {score: 1 + Math.floor(rnd() * 5)};
  const text = invalid ? '画像を見られませんでした（dry-runの不正な回答）' : '偽の回答です。\n```json\n' + JSON.stringify(ans) + '\n```';
  const usd = budgetUsd === null ? cfg.dryRun.usdPerCall[method] : Math.min(cfg.dryRun.usdPerCall[method], budgetUsd); // --max-budget-usd caps a real call
  const lines = [];
  if (evaluator === 'fable') {
    lines.push({type: 'system', subtype: 'init', cwd, tools: ['Read', 'Glob', 'Grep']});
    const reads = trace === 'skip-one' ? images.slice(1) : images;
    reads.forEach((f, i) => {
      lines.push({type: 'assistant', message: {role: 'assistant', content: [{type: 'tool_use', id: `toolu_${i}`, name: 'Read', input: {file_path: f}}]}});
      lines.push({type: 'user', message: {role: 'user', content: [{type: 'tool_result', tool_use_id: `toolu_${i}`, content: [{type: 'image'}]}]}});
    });
    if (trace === 'outside') lines.push({type: 'assistant', message: {role: 'assistant', content: [{type: 'tool_use', id: 'toolu_x', name: 'Read', input: {file_path: path.join(cwd, '..', 'TASK.json')}}]}});
    lines.push({type: 'assistant', message: {role: 'assistant', content: [{type: 'text', text}]}});
    if (trace !== 'no-result') lines.push({type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: usd, num_turns: 1 + reads.length, duration_ms: 1, duration_api_ms: 1, usage: {input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50}});
    return lines.map((x) => JSON.stringify(x)).join('\n') + '\n';
  }
  lines.push({type: 'thread.started', thread_id: 'dry'}, {type: 'turn.started'});
  if (trace === 'odd') lines.push({type: 'item.completed', item: {id: 'i1', type: 'tool_call_of_unknown_shape'}});
  else {
    const reads = trace === 'skip-one' ? images.slice(1) : images;
    reads.forEach((f, i) => lines.push({type: 'item.completed', item: {id: `c${i}`, type: 'command_execution', command: `/bin/zsh -lc "ls ${path.relative(cwd, f)}"`, aggregated_output: '', exit_code: 0, status: 'completed'}}));
    if (trace === 'outside') lines.push({type: 'item.completed', item: {id: 'cx', type: 'command_execution', command: `/bin/zsh -lc "cat ${path.join(cwd, '..', 'TASK.json')}"`, aggregated_output: '', exit_code: 0, status: 'completed'}});
  }
  lines.push({type: 'item.completed', item: {id: 'i0', type: 'agent_message', text}}, {type: 'turn.completed', usage: {input_tokens: 100, cached_input_tokens: 0, output_tokens: 50}});
  return lines.map((x) => JSON.stringify(x)).join('\n') + '\n';
}

// Ledger: header line {type:"header", dryRun}, then one line per attempt; a dry-run ledger and a paid ledger never mix.
export function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
export const spentUsd = (lines, evaluator = 'fable') => lines.filter((l) => l.type === 'call' && l.evaluator === evaluator).reduce((s, l) => s + (l.chargedUsd ?? 0), 0);

export function runEvaluator(o) {
  const {cfg, packetsRoot, runs, evaluator, dryRun, methods = ORDER, rounds = cfg.rounds, only = null, skip = new Set(), retries = cfg.retries.default,
    dryInvalidEvery = 0, dryTrace = 'all', capUsd = cfg.budget.capUsd, priorLedger = null, spawn = spawnSync, log = () => {}} = o;
  if (!['fable', 'codex'].includes(evaluator)) throw new Error('evaluator must be fable or codex');
  if (!dryRun && process.env.ASC1835_ALLOW_PAID !== '1') throw new Error('paid run refused: set ASC1835_ALLOW_PAID=1 (or use --dry-run)');
  if (!dryRun && capUsd !== cfg.budget.capUsd) throw new Error('--cap-usd is only for --dry-run');
  if (retries > cfg.retries.max || retries < 0) throw new Error(`retries must be 0..${cfg.retries.max}`);
  const ledgerFile = path.join(runs, 'ledger.jsonl');
  fs.mkdirSync(runs, {recursive: true});
  const ledger = readLedger(ledgerFile);
  const header = ledger.find((l) => l.type === 'header');
  if (header && header.dryRun !== !!dryRun) throw new Error(`ledger ${ledgerFile} is ${header.dryRun ? 'a dry-run' : 'a paid'} ledger; use another --runs`);
  const prior = priorLedger ? readLedger(priorLedger) : [];
  if (prior.some((l) => l.type === 'header' && l.dryRun !== !!dryRun)) throw new Error('--prior-ledger mixes dry-run and paid');
  const append = (x) => { fs.appendFileSync(ledgerFile, JSON.stringify(x) + '\n'); ledger.push(x); };
  if (!header) append({type: 'header', dryRun: !!dryRun, capUsd, at: new Date().toISOString()});
  const spent = () => spentUsd(ledger, 'fable') + spentUsd(prior, 'fable');
  const index = readJson(path.join(packetsRoot, 'index.json'));
  const calls = planCalls({index, methods, rounds, only, skip, negPairs: readJson(path.join(ROOT, 'negation-pairs.json'))});
  const summary = {evaluator, dryRun: !!dryRun, planned: calls.length, skippedDone: 0, valid: 0, invalid: 0, failed: 0, missingInput: 0, retried: 0, stopped: null, missingByReason: {}, isolationUnconfirmed: 0};
  let n = 0;
  for (const call of calls) {
    const dir = path.join(runs, evaluator, `round${call.round}`, call.method, call.id);
    if (fs.existsSync(path.join(dir, 'status.json'))) { summary.skippedDone++; continue; }
    fs.mkdirSync(dir, {recursive: true});
    let task = null, cwd, prompt;
    if (call.packet) cwd = path.join(packetsRoot, `round${call.round}`, call.packet);
    if (call.method === 'Fs') {
      const fc = path.join(runs, evaluator, `round${call.round}`, 'Fc', call.packet, 'status.json');
      const st = fs.existsSync(fc) ? readJson(fc) : null;
      if (st?.status !== 'valid') { writeJson(path.join(dir, 'status.json'), {callId: call.id, evaluator, round: call.round, method: call.method, packet: call.packet, status: 'missing-input', why: 'critique missing or invalid'}); summary.missingInput++; continue; }
      prompt = buildPrompt('Fs', cfg, {critique: st.answer.critique});
    } else if (call.method === 'Neg') prompt = buildPrompt('Neg', cfg, {critique: call.text});
    else { task = readJson(path.join(cwd, 'TASK.json')); prompt = buildPrompt(call.method, cfg); }
    if (call.method === 'Fs' || call.method === 'Neg') { cwd = path.join(runs, evaluator, '_cwd', `round${call.round}`, call.id); fs.mkdirSync(cwd, {recursive: true}); }
    fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
    const attempts = []; let answer = null, status = 'failed';
    for (let attempt = 1; attempt <= 1 + retries; attempt++) {
      let budgetUsd = null;
      if (evaluator === 'fable') {
        const left = capUsd - spent();
        if (left <= 0.01) { summary.stopped = `budget: spent ${spent().toFixed(4)} of ${capUsd}`; break; }
        budgetUsd = Math.min(cfg.limits.fable[call.method].maxBudgetUsd, left);
      }
      const args = evaluator === 'fable' ? fableArgs({prompt, cfg, method: call.method, budgetUsd}) : codexArgs({prompt, cfg, cwd});
      const cmd = cfg.evaluators[evaluator].command;
      writeJson(path.join(dir, 'argv.json'), {command: cmd, cwd, args: args.map((x) => (x === prompt ? '<prompt.txt>' : x)), promptSha256: sha256(prompt)});
      const lim = cfg.limits[evaluator][call.method];
      const t0 = Date.now();
      let stdout, stderr = '', exit = 0, timedOut = false;
      if (dryRun) {
        n++;
        stdout = fakeOutput({evaluator, method: call.method, task, callId: call.id, attempt, cfg, budgetUsd, invalid: dryInvalidEvery > 0 && n % dryInvalidEvery === 0, images: listPngs(call.packet ? cwd : null), cwd, trace: dryTrace});
      } else {
        const env = {...process.env};
        if (evaluator === 'fable') env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(lim.maxOutputTokens);
        const r = spawn(cmd, args, {cwd, env, input: '', encoding: 'utf8', timeout: lim.timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024});
        stdout = r.stdout ?? ''; stderr = r.stderr ?? ''; exit = r.status; timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
      }
      const durationMs = Date.now() - t0;
      fs.writeFileSync(path.join(dir, `attempt-${attempt}.stdout`), stdout);
      if (stderr) fs.writeFileSync(path.join(dir, `attempt-${attempt}.stderr`), stderr);
      const p = evaluator === 'fable' ? parseFable(stdout) : parseCodex(stdout, cwd);
      // Fable: a missing cost is charged at the call's budget (conservative), and flagged
      const chargedUsd = evaluator === 'fable' ? (p.usd ?? budgetUsd) : 0;
      const parsed = extractJson(p.text);
      // Trace checks: Fable must have Read every PNG of its packet; Codex must not have touched a path outside its packet (-C).
      let trace = null, reason = null;
      if (evaluator === 'fable' && p.hasResult) { trace = checkImagesRead({toolCalls: p.toolCalls, images: listPngs(call.packet ? cwd : null), cwd}); reason = trace.reason; }
      if (evaluator === 'codex' && p.isolation) { trace = p.isolation; reason = trace.reason; }
      const base = timedOut ? 'timeout' : exit !== 0 ? `exit ${exit}` : p.error ? p.error : null;
      const problem = base ?? (reason ? reason : validate(call.method, parsed, task, cfg));
      const a = {attempt, exit, timedOut, durationMs, usd: p.usd, chargedUsd, costMissing: evaluator === 'fable' && p.usd === null, tokens: p.tokens, numTurns: p.numTurns ?? null, problem, reason: base ? null : reason, trace,
        ...(evaluator === 'fable' ? {toolCalls: p.toolCalls.length, resultEvent: p.hasResult} : {})};
      if (call.method === 'Fc' && !problem && parsed.critique.length > cfg.limits.critiqueMaxChars) a.overLength = parsed.critique.length;
      attempts.push(a);
      append({type: 'call', evaluator, round: call.round, method: call.method, callId: call.id, ...a, dryRun: !!dryRun, at: new Date().toISOString()});
      if (!problem) { answer = parsed; status = 'valid'; break; }
      status = (exit === 0 && !timedOut && !p.error) ? 'invalid' : 'failed';
    }
    if (summary.stopped && !attempts.length) { append({type: 'stop', reason: summary.stopped, at: new Date().toISOString()}); log(summary.stopped); break; }
    if (attempts.length > 1) summary.retried++;
    const last = attempts[attempts.length - 1];
    const missingReason = status === 'valid' ? null : (last?.reason ?? (status === 'invalid' ? 'invalid-answer' : (last?.problem === 'no final result event' ? 'no-result-event' : 'failed')));
    const isolation = evaluator === 'codex' ? (last?.trace?.state ?? 'unconfirmed') : null;
    writeJson(path.join(dir, 'status.json'), {callId: call.id, evaluator, round: call.round, method: call.method, packet: call.packet ?? null, text: call.text ?? null, status, missingReason, isolation, answer, attempts});
    summary[status]++;
    if (missingReason) summary.missingByReason[missingReason] = (summary.missingByReason[missingReason] ?? 0) + 1;
    if (isolation === 'unconfirmed') summary.isolationUnconfirmed++;
    log(`${call.method} r${call.round} ${call.id} ${status}`);
    if (summary.stopped) { append({type: 'stop', reason: summary.stopped, at: new Date().toISOString()}); break; }
  }
  summary.fableSpentUsd = Number(spent().toFixed(6));
  return summary;
}

// Budget projection (plan 5.2): remaining calls x per-call cost, and the reduction order D -> contrast-strong -> stop.
export function budgetPlan({index, key, perCall, cfg, priorUsd = 0, negPairs}) {
  const count = (excludeD, excludeContrast) => {
    const skip = new Set();
    if (excludeContrast) for (const [pk, p] of Object.entries(key.packets)) {
      const screens = Object.values(p.ids);
      if ((p.method === 'P' || p.method === 'F') && screens.some((s) => s.endsWith('/contrast-strong'))) skip.add(pk);
    }
    const methods = ORDER.filter((m) => !(excludeD && m === 'D'));
    const calls = planCalls({index, methods, rounds: cfg.rounds, skip, negPairs});
    const by = {}; for (const c of calls) by[c.method] = (by[c.method] ?? 0) + 1;
    const usd = Object.entries(by).reduce((s, [m, k]) => s + k * (perCall[m] ?? NaN), 0);
    return {calls: by, projectedUsd: Number((priorUsd + usd).toFixed(4)), skip: [...skip]};
  };
  const steps = [['all', false, false], ['without D', true, false], ['without D and contrast-strong', true, true]].map(([name, d, c]) => ({name, ...count(d, c)}));
  const chosen = steps.find((s) => s.projectedUsd <= cfg.budget.projectionLimitUsd);
  return {limitUsd: cfg.budget.projectionLimitUsd, priorUsd, perCall, steps: steps.map(({skip, ...s}) => s), decision: chosen ? chosen.name : 'stop: 予算の見込みで未判定', skip: chosen?.skip ?? null, dropD: chosen ? chosen.name !== 'all' : null};
}

function main() {
  const a = process.argv.slice(2), cmd = a[0];
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  const all = (n) => a.flatMap((x, i) => (x === n ? [a[i + 1]] : []));
  const cfg = opt('--config') ? loadConfig(path.resolve(opt('--config'))) : loadConfig();
  const packetsRoot = path.resolve(opt('--packets') ?? '');
  if (cmd === 'plan') {
    const perCall = Object.fromEntries((opt('--per-call') ?? '').split(',').filter(Boolean).map((x) => { const [k, v] = x.split('='); return [k, Number(v)]; }));
    const prior = opt('--prior-ledger') ? spentUsd(readLedger(path.resolve(opt('--prior-ledger')))) : 0;
    const r = budgetPlan({index: readJson(path.join(packetsRoot, 'index.json')), key: readJson(path.resolve(opt('--key'))), perCall, cfg, priorUsd: prior, negPairs: readJson(path.join(ROOT, 'negation-pairs.json'))});
    if (opt('--skip-out') && r.skip) fs.writeFileSync(path.resolve(opt('--skip-out')), r.skip.join('\n') + (r.skip.length ? '\n' : ''));
    const {skip, ...shown} = r; console.log(JSON.stringify(shown, null, 1));
    if (r.decision.startsWith('stop')) process.exitCode = 4;
    return;
  }
  if (cmd !== 'run') { console.error('usage: run-eval.mjs run|plan ... (see the header of this file)'); process.exit(2); }
  const dryRun = a.includes('--dry-run');
  const locks = all('--lock').map((p) => path.resolve(p));
  const modes = locks.map((p) => [p, fs.statSync(p).mode & 0o777]);
  const restore = () => { for (const [p, m] of modes) fs.chmodSync(p, m); };
  try {
    for (const [p] of modes) fs.chmodSync(p, 0);
    const summary = runEvaluator({cfg, packetsRoot, runs: path.resolve(opt('--runs') ?? ''), evaluator: opt('--evaluator'), dryRun,
      methods: opt('--methods') ? opt('--methods').split(',') : ORDER, rounds: opt('--rounds') ? opt('--rounds').split(',').map(Number) : cfg.rounds,
      only: opt('--only') ? new Set(opt('--only').split(',')) : null,
      skip: opt('--skip-packets') ? new Set(fs.readFileSync(path.resolve(opt('--skip-packets')), 'utf8').split('\n').filter(Boolean)) : new Set(),
      retries: opt('--retries') !== null ? Number(opt('--retries')) : cfg.retries.default, dryInvalidEvery: Number(opt('--dry-invalid-every') ?? 0),
      capUsd: opt('--cap-usd') !== null ? Number(opt('--cap-usd')) : cfg.budget.capUsd, priorLedger: opt('--prior-ledger') ? path.resolve(opt('--prior-ledger')) : null,
      log: (s) => console.error(s)});
    console.log(JSON.stringify(summary, null, 1));
    if (summary.stopped) process.exitCode = 5;
  } catch (e) { console.error(e.message); process.exitCode = 3; } finally { restore(); }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
