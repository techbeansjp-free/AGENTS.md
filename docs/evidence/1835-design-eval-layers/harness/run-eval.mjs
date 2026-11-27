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
    '--settings', '{"disableAllHooks":true}', '--no-session-persistence', '--output-format', 'json', '--max-turns', String(lim.maxTurns),
    '--max-budget-usd', budgetUsd.toFixed(4)];
}
export function codexArgs({prompt, cfg, cwd}) {
  return ['exec', '--ephemeral', '-s', 'read-only', '-C', cwd, '--skip-git-repo-check', '--json', '-m', cfg.evaluators.codex.model, '-c', 'project_doc_max_bytes=0', prompt];
}

// Parse the CLI output into {text, usd, tokens, error}.
export function parseFable(stdout) {
  let j; try { j = JSON.parse(stdout.trim()); } catch { return {text: null, usd: null, tokens: null, error: 'stdout is not JSON'}; }
  const u = j.usage ?? {};
  return {text: typeof j.result === 'string' ? j.result : null, usd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null, numTurns: j.num_turns ?? null,
    tokens: {input: u.input_tokens ?? null, cacheCreation: u.cache_creation_input_tokens ?? null, cacheRead: u.cache_read_input_tokens ?? null, output: u.output_tokens ?? null},
    error: j.is_error ? `is_error (${j.subtype ?? '?'})` : (j.subtype && j.subtype !== 'success' ? j.subtype : null)};
}
export function parseCodex(stdout) {
  let text = null, tokens = null, error = null;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'item.completed' && e.item?.type === 'agent_message') text = e.item.text;
    if (e.type === 'turn.completed' && e.usage) tokens = {input: e.usage.input_tokens ?? null, cacheRead: e.usage.cached_input_tokens ?? null, output: e.usage.output_tokens ?? null};
    if (e.type === 'turn.failed' || e.type === 'error') error = e.error?.message ?? e.message ?? e.type;
  }
  return {text, usd: null, tokens, error};
}

// A fixed fake answer for --dry-run (same output format as the CLI).
export function fakeOutput({evaluator, method, task, callId, attempt, cfg, invalid, budgetUsd = null}) {
  const rnd = makeRng('dry-run', `${evaluator}:${callId}:${attempt}`);
  let ans;
  if (method === 'P') ans = {choice: ['A', 'B', '同等'][Math.floor(rnd() * 3)], reason: '偽の回答（dry-run）'};
  else if (method === 'D') ans = {groups: Object.fromEntries(task.groups.map((g) => [g.name, shuffle(g.order, rnd)]))};
  else if (method === 'Fc') { const a = readJson(path.join(ROOT, 'anchors.json')); ans = {critique: a.sets[0].levels[Math.floor(rnd() * 5)]}; }
  else ans = {score: 1 + Math.floor(rnd() * 5)};
  const text = invalid ? '画像を見られませんでした（dry-runの不正な回答）' : '偽の回答です。\n```json\n' + JSON.stringify(ans) + '\n```';
  const usd = budgetUsd === null ? cfg.dryRun.usdPerCall[method] : Math.min(cfg.dryRun.usdPerCall[method], budgetUsd); // --max-budget-usd caps a real call
  if (evaluator === 'fable') return JSON.stringify({type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: usd, num_turns: 1, duration_ms: 1, usage: {input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50}});
  return [{type: 'thread.started', thread_id: 'dry'}, {type: 'turn.started'}, {type: 'item.completed', item: {id: 'i0', type: 'agent_message', text}}, {type: 'turn.completed', usage: {input_tokens: 100, cached_input_tokens: 0, output_tokens: 50}}].map((x) => JSON.stringify(x)).join('\n') + '\n';
}

// Ledger: header line {type:"header", dryRun}, then one line per attempt; a dry-run ledger and a paid ledger never mix.
export function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
export const spentUsd = (lines, evaluator = 'fable') => lines.filter((l) => l.type === 'call' && l.evaluator === evaluator).reduce((s, l) => s + (l.chargedUsd ?? 0), 0);

export function runEvaluator(o) {
  const {cfg, packetsRoot, runs, evaluator, dryRun, methods = ORDER, rounds = cfg.rounds, only = null, skip = new Set(), retries = cfg.retries.default,
    dryInvalidEvery = 0, capUsd = cfg.budget.capUsd, priorLedger = null, spawn = spawnSync, log = () => {}} = o;
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
  const summary = {evaluator, dryRun: !!dryRun, planned: calls.length, skippedDone: 0, valid: 0, invalid: 0, failed: 0, missingInput: 0, retried: 0, stopped: null};
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
        stdout = fakeOutput({evaluator, method: call.method, task, callId: call.id, attempt, cfg, budgetUsd, invalid: dryInvalidEvery > 0 && n % dryInvalidEvery === 0});
      } else {
        const env = {...process.env};
        if (evaluator === 'fable') env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(lim.maxOutputTokens);
        const r = spawn(cmd, args, {cwd, env, input: '', encoding: 'utf8', timeout: lim.timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024});
        stdout = r.stdout ?? ''; stderr = r.stderr ?? ''; exit = r.status; timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
      }
      const durationMs = Date.now() - t0;
      fs.writeFileSync(path.join(dir, `attempt-${attempt}.stdout`), stdout);
      if (stderr) fs.writeFileSync(path.join(dir, `attempt-${attempt}.stderr`), stderr);
      const p = evaluator === 'fable' ? parseFable(stdout) : parseCodex(stdout);
      // Fable: a missing cost is charged at the call's budget (conservative), and flagged
      const chargedUsd = evaluator === 'fable' ? (p.usd ?? budgetUsd) : 0;
      const parsed = extractJson(p.text);
      const problem = timedOut ? 'timeout' : exit !== 0 ? `exit ${exit}` : p.error ? p.error : validate(call.method, parsed, task, cfg);
      const a = {attempt, exit, timedOut, durationMs, usd: p.usd, chargedUsd, costMissing: evaluator === 'fable' && p.usd === null, tokens: p.tokens, numTurns: p.numTurns ?? null, problem};
      if (call.method === 'Fc' && !problem && parsed.critique.length > cfg.limits.critiqueMaxChars) a.overLength = parsed.critique.length;
      attempts.push(a);
      append({type: 'call', evaluator, round: call.round, method: call.method, callId: call.id, ...a, dryRun: !!dryRun, at: new Date().toISOString()});
      if (!problem) { answer = parsed; status = 'valid'; break; }
      status = (exit === 0 && !timedOut && !p.error) ? 'invalid' : 'failed';
    }
    if (summary.stopped && !attempts.length) { append({type: 'stop', reason: summary.stopped, at: new Date().toISOString()}); log(summary.stopped); break; }
    if (attempts.length > 1) summary.retried++;
    writeJson(path.join(dir, 'status.json'), {callId: call.id, evaluator, round: call.round, method: call.method, packet: call.packet ?? null, text: call.text ?? null, status, answer, attempts});
    summary[status]++;
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
