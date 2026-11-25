// Ledger records of the ranking rounds (#1815, review M-3). Uses the #1814 ledger file (append-only, lock).
// Every ranking round is reserved before it starts and settled after it, so a rerun always leaves a record:
//   reserve  rank-<fable|codex>-<round>: Fable at conditions.json budget.rankingReserveUsd (refused above capUsd -
//            safetyMarginUsd), Codex at 0 marked "unreported" (Codex reports no Host cost, as #1807).
//            One round per evaluator per round number. Exactly one retry, rank-<e>-<round>-retry, only when the first was
//            settled with --launch-failed. Refused unless the fixation checks pass and rank-guard.mjs guardProblems is
//            empty (runs and keys roots mode 000, the round directory a separate tree).
//   settle   with the raw evaluator output file: its sha256 and the session id are written into the settle line, while
//            the guard is still in place (before any key is opened). --launch-failed when the evaluator never produced a
//            ranking (no output needed).
// decide.mjs (rankRounds) then refuses ranks whose raw output does not match the recorded sha256, and missing or extra
// rounds.
// Usage: node budget.mjs reserve <ledger> <fable|codex> <round> --runs-root <r> --keys-root <k> --round-dir <d>
//        node budget.mjs settle  <ledger> <name> --runs-root <r> --keys-root <k> --round-dir <d>
//                                (--output <raw file> --session <id> --cost <usd|unreported> | --launch-failed)
//        node budget.mjs total   <ledger>
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import * as ledgerOps from '../../1814-skill-invocation/harness/ledger.mjs';
import {loadJson} from './pairing.mjs';
import {paidStepProblems} from './fixation.mjs';
import {guardProblems} from './rank-guard.mjs';

export const EVALUATORS = ['fable', 'codex'];
export const ROUNDS = [1, 2];
export const canReserve = (spent, amount, budget) => spent + amount <= budget.capUsd - budget.safetyMarginUsd;
const lines = (ledger) => fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// The ranking entries of the ledger: {name: {reservation, settle}}.
export function rankEntries(ledger) {
  const out = {};
  for (const e of lines(ledger)) {
    if (!String(e.trial ?? '').startsWith('rank-')) continue;
    const x = (out[e.trial] ??= {reservation: null, settle: null});
    if (typeof e.reservedUsd === 'number') x.reservation = e; else if ('costUsd' in e) x.settle = e;
  }
  return out;
}

// Which name the next reservation of (evaluator, round) gets, or why none.
export function nextRankName(entries, evaluator, round) {
  if (!EVALUATORS.includes(evaluator) || !ROUNDS.includes(Number(round))) return {error: 'evaluator must be fable|codex and round 1|2'};
  const base = `rank-${evaluator}-${round}`, retry = `${base}-retry`;
  if (!entries[base]) return {name: base};
  if (!entries[base].settle) return {error: `${base} is reserved but not settled`};
  if (!entries[base].settle.launchFailed) return {error: `${base} already ran (one round per evaluator per round number)`};
  if (entries[retry]) return {error: `${retry} already used (one retry only)`};
  return {name: retry};
}

// The ranking JSON in an evaluator's raw output: the last ```json fenced block, else the last {...} block.
export function extractRanking(text) {
  const fenced = [...String(text).matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const c of fenced.reverse()) { try { return JSON.parse(c); } catch { /* next */ } }
  const i = String(text).lastIndexOf('{"ui03');
  if (i >= 0) { try { return JSON.parse(String(text).slice(i, String(text).lastIndexOf('}') + 1)); } catch { /* none */ } }
  return null;
}

// decide.mjs: exactly one completed (not launch-failed) round per evaluator and round number, nothing unsettled, no
// unexpected name, and <ranks-dir>/<evaluator>-<round>.txt equal to the recorded sha256.
export function rankRounds(ledger, ranksDir) {
  const entries = rankEntries(ledger);
  const p = [];
  const allowed = new Set(EVALUATORS.flatMap((e) => ROUNDS.flatMap((r) => [`rank-${e}-${r}`, `rank-${e}-${r}-retry`])));
  for (const [n, x] of Object.entries(entries)) {
    if (!allowed.has(n)) p.push(`unexpected ranking entry ${n}`);
    if (x.reservation && !x.settle) p.push(`${n} is reserved but not settled`);
  }
  const rankings = {};
  for (const e of EVALUATORS) for (const r of ROUNDS) {
    const done = [`rank-${e}-${r}`, `rank-${e}-${r}-retry`].filter((n) => entries[n]?.settle && !entries[n].settle.launchFailed);
    if (done.length !== 1) { p.push(`${e} round ${r}: ${done.length} completed round(s) in the ledger, expected 1`); continue; }
    const f = path.join(ranksDir, `${e}-${r}.txt`);
    if (!fs.existsSync(f)) { p.push(`${e} round ${r}: raw output ${e}-${r}.txt missing`); continue; }
    if (sha(fs.readFileSync(f)) !== entries[done[0]].settle.outputSha256) { p.push(`${e} round ${r}: raw output differs from the ledger sha256`); continue; }
    const ranking = extractRanking(fs.readFileSync(f, 'utf8'));
    if (!ranking) { p.push(`${e} round ${r}: no ranking JSON in the raw output`); continue; }
    (rankings[e] ??= {})[r] = ranking;
  }
  const expected = new Set(EVALUATORS.flatMap((e) => ROUNDS.map((r) => `${e}-${r}.txt`)));
  for (const f of fs.existsSync(ranksDir) ? fs.readdirSync(ranksDir) : []) if (!expected.has(f)) p.push(`unexpected file in the ranks directory: ${f}`);
  return {problems: p, rankings};
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
  const guard = {runsRoot: opt('--runs-root') && path.resolve(opt('--runs-root')), keysRoot: opt('--keys-root') && path.resolve(opt('--keys-root')), roundDir: opt('--round-dir') && path.resolve(opt('--round-dir'))};
  const gp = guardProblems(guard);
  if (gp.length) fail(gp.join('; '));
  const fp = paidStepProblems(ledger);
  if (fp.length) fail(fp.join('; '));
  try { unlock = ledgerOps.lock(ledger); } catch (e) { fail(e.message); }
  try {
    const entries = rankEntries(ledger);
    if (action === 'reserve') {
      const n = nextRankName(entries, a3, a4);
      if (n.error) fail(n.error);
      const amount = a3 === 'fable' ? budget.rankingReserveUsd : 0;
      const spent = ledgerOps.spent(ledger);
      if (!canReserve(spent, amount, budget)) fail(`ledger total ${spent.toFixed(2)} + ${amount} would exceed ${budget.capUsd} - ${budget.safetyMarginUsd}`);
      const id = crypto.randomUUID(), seq = ledgerOps.reservations(ledger).length;
      fs.appendFileSync(ledger, JSON.stringify({id, seq, trial: n.name, reservedUsd: amount, unreported: a3 === 'codex', at: new Date().toISOString()}) + '\n');
      console.log(JSON.stringify({reserved: n.name, reservedUsd: amount}));
    } else if (action === 'settle') {
      const name = a3, x = entries[name];
      if (!x?.reservation) fail(`${name} has no reservation`);
      if (x.settle) fail(`${name} is already settled`);
      const launchFailed = args.includes('--launch-failed');
      let outputSha256 = null, sessionId = opt('--session'), costUsd = null;
      if (!launchFailed) {
        const out = opt('--output');
        if (!out || !fs.existsSync(out)) fail('--output <raw evaluator output> is required');
        if (!sessionId) fail('--session <id> is required');
        outputSha256 = sha(fs.readFileSync(out));
        const c = opt('--cost');
        if (name.startsWith('rank-fable-')) { if (!c || Number.isNaN(Number(c))) fail('--cost <usd> is required for Fable'); costUsd = Number(c); }
        else if (c !== 'unreported') fail('--cost unreported is required for Codex');
      }
      fs.appendFileSync(ledger, JSON.stringify({id: x.reservation.id, trial: name, costUsd, outputSha256, sessionId, launchFailed, unreported: name.startsWith('rank-codex-'), at: new Date().toISOString()}) + '\n');
      console.log(JSON.stringify({settled: name, outputSha256, launchFailed}));
    } else fail('usage: reserve|settle|total');
  } finally { unlock(); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
