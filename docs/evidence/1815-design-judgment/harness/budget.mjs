// Ledger records of the ranking rounds (#1815, reviews M-3 and M-d). Uses the #1814 ledger file (append-only, lock).
// Both evaluators run through `asc host-session` (Fable: host claude, model fable; Codex: host codex), each with a new
// output directory <ranks-root>/<evaluator>-<round>[-retry] (outside the round directory the evaluator can read).
//   reserve  rank-<fable|codex>-<round>: Fable at budget.rankingReserveUsd (refused above capUsd - safetyMarginUsd),
//            Codex at 0 marked "unreported" (Codex reports no Host cost, as #1807). One round per evaluator per round
//            number; exactly one retry, rank-<e>-<round>-retry, only after the first was settled as a launch failure.
//   settle   reads the host-session output directory itself: status.json must be this evaluator's Host (and model for
//            Fable), cwd and targetDirectory = the round directory, a session id, startedAt after the reservation and
//            finishedAt before the settle. A completed run records the sha256 of result.txt and of status.json and the
//            session id; Fable's cost is taken from events.jsonl (total_cost_usd) when present. A launch failure is
//            accepted only when status.json is absent or not "completed".
//   settle also records the length and sha256 of the rank-guard record, and seals the output directory (mode 000).
//   reserve refuses while another ranking round is reserved and not settled (one evaluator at a time).
//   reserve and settle refuse unless the fixation checks pass and rank-guard.mjs guardProblems is empty (including the
//   already-settled outputs at mode 000) (runs, keys,
//   render and the other round's blind directory at mode 000; the round directory a separate tree), so the round runs
//   and is settled before any key can be opened.
// decide.mjs (rankRounds) then refuses ranks whose files differ from the recorded hashes, and missing or extra rounds.
// Usage: node budget.mjs reserve <ledger> <fable|codex> <round> <guard options>
//        node budget.mjs settle  <ledger> <name> --host-output <dir> --guard-record <rank-guard.jsonl> [--launch-failed] <guard options>
//        node budget.mjs total   <ledger>
// guard options: --runs-root <r> --keys-root <k> --render-root <x> --blind-root <b> --ranks-root <o> --round <1|2>
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import * as ledgerOps from '../../1814-skill-invocation/harness/ledger.mjs';
import {loadJson} from './pairing.mjs';
import {paidStepProblems} from './fixation.mjs';
import {guardProblems} from './rank-guard.mjs';

export const EVALUATORS = ['fable', 'codex'];
export const ROUNDS = [1, 2];
export const HOSTS = {fable: {host: 'claude', model: 'fable'}, codex: {host: 'codex', model: null}};
export const canReserve = (spent, amount, budget) => spent + amount <= budget.capUsd - budget.safetyMarginUsd;
const lines = (ledger) => fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const outputDirName = (name) => name.replace(/^rank-/, '');

export function rankEntries(ledger) {
  const out = {};
  for (const e of lines(ledger)) {
    if (!String(e.trial ?? '').startsWith('rank-')) continue;
    const x = (out[e.trial] ??= {reservation: null, settle: null});
    if (typeof e.reservedUsd === 'number') x.reservation = e; else if ('costUsd' in e) x.settle = e;
  }
  return out;
}

export function nextRankName(entries, evaluator, round) {
  if (!EVALUATORS.includes(evaluator) || !ROUNDS.includes(Number(round))) return {error: 'evaluator must be fable|codex and round 1|2'};
  const base = `rank-${evaluator}-${round}`, retry = `${base}-retry`;
  if (!entries[base]) return {name: base};
  if (!entries[base].settle) return {error: `${base} is reserved but not settled`};
  if (!entries[base].settle.launchFailed) return {error: `${base} already ran (one round per evaluator per round number)`};
  if (entries[retry]) return {error: `${retry} already used (one retry only)`};
  return {name: retry};
}

// One evaluator at a time: no reservation while another ranking round is reserved and not settled.
export function reserveName(entries, evaluator, round) {
  const open = Object.entries(entries).filter(([, x]) => x.reservation && !x.settle).map(([n]) => n);
  if (open.length) return {error: `settle ${open.join(', ')} before the next round starts`};
  return nextRankName(entries, evaluator, round);
}

export function extractRanking(text) {
  const fenced = [...String(text).matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const c of fenced.reverse()) { try { return JSON.parse(c); } catch { /* next */ } }
  const i = String(text).lastIndexOf('{"ui03');
  if (i >= 0) { try { return JSON.parse(String(text).slice(i, String(text).lastIndexOf('}') + 1)); } catch { /* none */ } }
  return null;
}

// Checks one host-session output directory against the reservation (review M-d item 1).
export function hostOutputProblems({dir, evaluator, roundDir, reservedAt, settleAt = new Date().toISOString(), launchFailed = false}) {
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f)) : null);
  const statusRaw = read('status.json');
  const st = statusRaw ? JSON.parse(statusRaw.toString()) : null;
  if (launchFailed) return st?.status === 'completed' ? ['status.json says completed; not a launch failure'] : [];
  const p = [];
  if (!st) return ['status.json missing'];
  const want = HOSTS[evaluator];
  const real = (x) => { try { return fs.realpathSync(x); } catch { return x; } };
  if (st.host !== want.host) p.push(`host ${st.host} is not ${want.host}`);
  if (want.model && st.model !== want.model) p.push(`model ${st.model} is not ${want.model}`);
  if (st.status !== 'completed') p.push(`status ${st.status}`);
  if (real(st.cwd ?? '') !== real(roundDir) || real(st.targetDirectory ?? '') !== real(roundDir)) p.push('cwd/targetDirectory is not the round directory');
  if (!st.sessionId) p.push('no session id');
  if (!(st.startedAt >= reservedAt)) p.push('started before the reservation');
  if (!(st.finishedAt && st.finishedAt <= settleAt)) p.push('not finished before the settle');
  if (!read('result.txt')?.toString().trim()) p.push('result.txt empty');
  return p;
}

export function fableCost(dir) {
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8')); return typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null; } catch { return null; }
}

// decide.mjs, before it reads any output (review M-1 of the third review): every round settled exactly once, nothing
// reserved and unsettled; then the settled output directories are unsealed (mode 700) and the unseal is appended to the
// rank-guard record.
export function unsealOutputs({ledger, ranksRoot, guardRecord}) {
  const entries = rankEntries(ledger);
  const p = [];
  for (const [n, x] of Object.entries(entries)) if (x.reservation && !x.settle) p.push(`${n} is reserved but not settled`);
  for (const e of EVALUATORS) for (const r of ROUNDS) {
    const done = [`rank-${e}-${r}`, `rank-${e}-${r}-retry`].filter((n) => entries[n]?.settle && !entries[n].settle.launchFailed);
    if (done.length !== 1) p.push(`${e} round ${r}: ${done.length} completed round(s) in the ledger, expected 1`);
  }
  if (p.length) return p;
  const dirs = Object.keys(entries).map((n) => path.join(ranksRoot, outputDirName(n))).filter((d) => fs.existsSync(d));
  for (const d of dirs) fs.chmodSync(d, 0o700);
  fs.appendFileSync(guardRecord, JSON.stringify({action: 'unseal', at: new Date().toISOString(), dirs: dirs.map((d) => path.basename(d)).sort()}) + '\n');
  return [];
}

// review L-2 (third review): each settle recorded the length and sha256 of the rank-guard record at that moment; the
// record is append-only, so each recorded prefix must still be the same.
export function guardChainProblems(ledger, guardRecord) {
  const rec = fs.existsSync(guardRecord) ? fs.readFileSync(guardRecord) : Buffer.alloc(0);
  const p = [];
  for (const [n, x] of Object.entries(rankEntries(ledger))) {
    const s = x.settle;
    if (!s) continue;
    if (typeof s.guardRecordBytes !== 'number' || !s.guardRecordSha256) { p.push(`${n}: no rank-guard record hash in the settle`); continue; }
    if (rec.length < s.guardRecordBytes || sha(rec.subarray(0, s.guardRecordBytes)) !== s.guardRecordSha256) p.push(`${n}: the rank-guard record changed after the settle`);
  }
  return p;
}

// decide.mjs: exactly one completed round per evaluator and round number, nothing unsettled, no unexpected name or
// directory, and result.txt / status.json equal to the recorded sha256.
export function rankRounds(ledger, ranksRoot) {
  const entries = rankEntries(ledger);
  const p = [];
  const allowed = new Set(EVALUATORS.flatMap((e) => ROUNDS.flatMap((r) => [`rank-${e}-${r}`, `rank-${e}-${r}-retry`])));
  for (const [n, x] of Object.entries(entries)) {
    if (!allowed.has(n)) p.push(`unexpected ranking entry ${n}`);
    if (x.reservation && !x.settle) p.push(`${n} is reserved but not settled`);
  }
  const rankings = {}, settles = {};
  for (const e of EVALUATORS) for (const r of ROUNDS) {
    const done = [`rank-${e}-${r}`, `rank-${e}-${r}-retry`].filter((n) => entries[n]?.settle && !entries[n].settle.launchFailed);
    if (done.length !== 1) { p.push(`${e} round ${r}: ${done.length} completed round(s) in the ledger, expected 1`); continue; }
    const s = entries[done[0]].settle;
    const dir = path.join(ranksRoot, outputDirName(done[0]));
    const f = (n) => (fs.existsSync(path.join(dir, n)) ? fs.readFileSync(path.join(dir, n)) : null);
    if (!f('result.txt') || sha(f('result.txt')) !== s.resultSha256) { p.push(`${e} round ${r}: result.txt differs from the ledger sha256`); continue; }
    if (!f('status.json') || sha(f('status.json')) !== s.statusSha256) { p.push(`${e} round ${r}: status.json differs from the ledger sha256`); continue; }
    const ranking = extractRanking(f('result.txt').toString());
    if (!ranking) { p.push(`${e} round ${r}: no ranking JSON in result.txt`); continue; }
    (rankings[e] ??= {})[r] = ranking;
    (settles[e] ??= {})[r] = {name: done[0], reservedAt: entries[done[0]].reservation.at, settledAt: s.at};
  }
  const known = new Set(Object.keys(entries).map(outputDirName));
  for (const d of fs.existsSync(ranksRoot) ? fs.readdirSync(ranksRoot) : []) if (!known.has(d)) p.push(`unexpected entry in the ranks root: ${d}`);
  return {problems: p, rankings, settles};
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const [action, ledger, a3, a4] = args;
  let unlock = () => {};
  const fail = (m) => { unlock(); console.error(`refused: ${m}`); process.exit(3); };
  const budget = loadJson('conditions.json').budget;
  if (!ledger || !fs.existsSync(ledger)) fail('ledger does not exist');
  if (action === 'total') { console.log(JSON.stringify({spentUsd: ledgerOps.spent(ledger), capUsd: budget.capUsd, stopAboveUsd: budget.capUsd - budget.safetyMarginUsd})); return; }
  const abs = (k) => (opt(k) ? path.resolve(opt(k)) : null);
  const guard = {runsRoot: abs('--runs-root'), keysRoot: abs('--keys-root'), renderRoot: abs('--render-root'), blindRoot: abs('--blind-root'), round: Number(opt('--round')), ranksRoot: abs('--ranks-root')};
  if (!guard.ranksRoot) fail('--ranks-root is required');
  guard.sealedDirs = Object.entries(rankEntries(ledger)).filter(([, x]) => x.settle).map(([n]) => path.join(guard.ranksRoot, outputDirName(n)));
  const gp = guardProblems(guard);
  if (gp.length) fail(gp.join('; '));
  const roundDir = path.join(guard.blindRoot, `round${guard.round}`);
  const fp = paidStepProblems(ledger);
  if (fp.length) fail(fp.join('; '));
  try { unlock = ledgerOps.lock(ledger); } catch (e) { fail(e.message); }
  try {
    const entries = rankEntries(ledger);
    if (action === 'reserve') {
      if (Number(a4) !== guard.round) fail('--round must equal the reserved round');
      const n = reserveName(entries, a3, a4);
      if (n.error) fail(n.error);
      const amount = a3 === 'fable' ? budget.rankingReserveUsd : 0;
      const spent = ledgerOps.spent(ledger);
      if (!canReserve(spent, amount, budget)) fail(`ledger total ${spent.toFixed(2)} + ${amount} would exceed ${budget.capUsd} - ${budget.safetyMarginUsd}`);
      const id = crypto.randomUUID(), seq = ledgerOps.reservations(ledger).length;
      fs.appendFileSync(ledger, JSON.stringify({id, seq, trial: n.name, reservedUsd: amount, unreported: a3 === 'codex', at: new Date().toISOString()}) + '\n');
      console.log(JSON.stringify({reserved: n.name, reservedUsd: amount, hostOutputDir: outputDirName(n.name)}));
    } else if (action === 'settle') {
      const name = a3, x = entries[name];
      if (!x?.reservation) fail(`${name} has no reservation`);
      if (x.settle) fail(`${name} is already settled`);
      const m = /^rank-(fable|codex)-([12])(-retry)?$/.exec(name);
      if (Number(m[2]) !== guard.round) fail('--round must equal the settled round');
      const dir = abs('--host-output');
      if (!dir || dir !== path.join(guard.ranksRoot, outputDirName(name))) fail(`--host-output must be <ranks-root>/${outputDirName(name)}`);
      const launchFailed = args.includes('--launch-failed');
      const at = new Date().toISOString();
      const hp = hostOutputProblems({dir, evaluator: m[1], roundDir, reservedAt: x.reservation.at, settleAt: at, launchFailed});
      if (hp.length) fail(hp.join('; '));
      const f = (n) => (fs.existsSync(path.join(dir, n)) ? sha(fs.readFileSync(path.join(dir, n))) : null);
      const status = fs.existsSync(path.join(dir, 'status.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')) : null;
      const costUsd = !launchFailed && m[1] === 'fable' ? fableCost(dir) : null;
      const record = abs('--guard-record');
      if (!record || !fs.existsSync(record)) fail('--guard-record <rank-guard.jsonl> is required');
      const rec = fs.readFileSync(record);
      fs.appendFileSync(ledger, JSON.stringify({id: x.reservation.id, trial: name, costUsd, resultSha256: launchFailed ? null : f('result.txt'), statusSha256: f('status.json'),
        guardRecordBytes: rec.length, guardRecordSha256: sha(rec),
        sessionId: status?.sessionId ?? null, launchFailed, unreported: m[1] === 'codex' || (m[1] === 'fable' && costUsd === null && !launchFailed), at}) + '\n');
      // review M-1 (third review): the settled output is sealed at once, before any later round can be reserved.
      if (fs.existsSync(dir)) fs.chmodSync(dir, 0);
      console.log(JSON.stringify({settled: name, launchFailed, costUsd, sealed: fs.existsSync(dir)}));
    } else fail('usage: reserve|settle|total');
  } finally { unlock(); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
