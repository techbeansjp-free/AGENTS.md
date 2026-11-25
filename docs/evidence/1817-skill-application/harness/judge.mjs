// #1817 judgement entry point (reviews M-1, L-6). No model call. Refuses to score when:
// - the fixed files differ from the last record of results/fixation.json, or that file is not committed/clean, or its
//   first commit is not named in README.md (same checks as run-trial.mjs);
// - any collected trial's fixationSha256 differs from the current results/fixation.json, or its ledgerId differs from
//   the recorded ledger, or ledger ids/seqs are inconsistent (trials.json from collect.mjs);
// - the ledger is not the one recorded at fixation;
// - (review Low-1) the non-probe reservation names of the ledger, the trials.json names and the trace files
//   (<name>.jsonl or <name>.jsonl.missing) are not the same set, the ledger's reservation seqs are not 0..n-1, or a
//   collected trial's ledgerSeq differs from its reservation (a reserved trial deleted before collect, or a copied ledger);
// - (review Medium-A) a settled trial's collected row has no raw trace/meta or their sha256 (recorded by collect.mjs)
//   differs from the ledger settlement (deleted or edited after the run, e.g. to have it redone).
// Then it scores B and S (score.mjs) and judges with judge1817, passing the completion status of the ledger
// (order.mjs completionStatus): a run that is neither complete nor stopped at the cap is not judged.
// Usage: node judge.mjs <traces-dir> --ledger <file> [--runs-json <out.json>] [--out <judge.json>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {scoreDir, summarize, judge1817} from './score.mjs';
import {completionStatus} from './order.mjs';
import {differences, lastRecord} from './fixation.mjs';
import {fixationFileProblems} from './run-trial.mjs';
import * as ledgerOps from './ledger.mjs';
import {loadConditions} from './apply-condition.mjs';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Problems that forbid scoring. rows: trials.json rows; fx: parsed fixation.json; fxSha: its sha256.
export const traceNamesOf = (dir) => fs.readdirSync(dir).flatMap((f) => (/\.hook\.jsonl$/.test(f) ? [] : (/^(.+)\.jsonl(?:\.missing)?$/.exec(f)?.[1] ?? [])));

export function nameSetProblems({rows, reservations, traceNames}) {
  const p = [];
  const ledgerNames = new Set(reservations.filter((e) => !ledgerOps.isProbe(e.trial)).map((e) => e.trial));
  const sets = {ledger: ledgerNames, 'trials.json': new Set(rows.map((r) => r.trial)), traces: new Set(traceNames)};
  const all = new Set(Object.values(sets).flatMap((x) => [...x]));
  for (const [name, set] of Object.entries(sets)) {
    const missing = [...all].filter((n) => !set.has(n)).sort();
    if (missing.length) p.push(`not in ${name}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
  }
  const seqs = reservations.map((e) => e.seq).sort((a, b) => a - b);
  if (seqs.some((q, i) => q !== i)) p.push('ledger reservation seqs are not 0..n-1 (a gap or a repeat)');
  const seqOf = new Map(reservations.map((e) => [e.trial, e.seq]));
  const wrong = rows.filter((r) => !r.missing && typeof r.ledgerSeq === 'number' && seqOf.get(r.trial) !== r.ledgerSeq).map((r) => r.trial);
  if (wrong.length) p.push(`ledgerSeq differs from the ledger reservation: ${wrong.slice(0, 5).join(', ')}`);
  return p;
}

// review Medium-A: rows (trials.json) against the ledger settlements (Map name -> settlement).
export function settlementProblems({rows, settled}) {
  const p = [];
  const byName = new Map(rows.map((r) => [r.trial, r]));
  for (const [name, s] of settled) {
    if (/-probe-\d+$/.test(name)) continue;
    const r = byName.get(name);
    if (!r) continue; // reported by nameSetProblems
    if (r.rawTraceSha256 !== s.traceSha256 || r.rawMetaSha256 !== s.metaSha256) p.push(`settled trial ${name}: trace.jsonl or meta.json is missing or differs from the ledger settlement`);
  }
  return p;
}

export function scoringProblems({rows, fx, fxSha, ledgerIdNow, root = ev, fileProblems = null, reservations = null, traceNames = null, settled = null}) {
  const p = [];
  if (settled) p.push(...settlementProblems({rows, settled}));
  else p.push('the ledger settlements are required');
  if (reservations && traceNames) p.push(...nameSetProblems({rows, reservations, traceNames}));
  else p.push('the ledger reservations and the trace names are required');
  const diff = differences(lastRecord(fx), root);
  if (diff.length) p.push(`fixed files differ from results/fixation.json: ${diff.join(', ')}`);
  p.push(...(fileProblems ?? fixationFileProblems(fx, root)));
  const ledgerId = fx.records[0].ledgerId;
  if (ledgerIdNow !== ledgerId) p.push('the ledger is not the one recorded in results/fixation.json');
  const present = rows.filter((r) => !r.missing);
  const wrongFx = present.filter((r) => r.fixationSha256 !== fxSha).map((r) => r.trial);
  if (wrongFx.length) p.push(`trials run under another fixation record: ${wrongFx.slice(0, 5).join(', ')}${wrongFx.length > 5 ? ', …' : ''}`);
  const wrongLedger = present.filter((r) => r.ledgerId !== ledgerId).map((r) => r.trial);
  if (wrongLedger.length) p.push(`trials from another ledger: ${wrongLedger.slice(0, 5).join(', ')}`);
  p.push(...ledgerOps.ledgerConsistency(present));
  return p;
}

export function judgeRun({spec, dir, ledger, conds = loadConditions()}) {
  const runs = scoreDir(spec, dir, ['B', 'S']);
  const sums = {B: summarize(spec, runs, 'B'), S: summarize(spec, runs, 'S')};
  const completion = completionStatus({runs, reserved: ledgerOps.reservedNames(ledger), reservations: ledgerOps.reservations(ledger), spentUsd: ledgerOps.spent(ledger), budget: conds.budget});
  return {runs, sums, judgement: judge1817(sums.B, sums.S, {completion})};
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const dir = path.resolve(args[0] ?? '');
  const ledger = opt('--ledger');
  if (!args[0] || !ledger) { console.error('usage: node judge.mjs <traces-dir> --ledger <file> [--runs-json <out>] [--out <json>]'); process.exit(2); }
  const fxFile = path.join(ev, 'results/fixation.json');
  const fx = JSON.parse(fs.readFileSync(fxFile, 'utf8'));
  const trialsFile = path.join(dir, 'trials.json');
  if (!fs.existsSync(trialsFile)) { console.error('refused: trials.json (from collect.mjs) is missing'); process.exit(3); }
  const problems = scoringProblems({rows: JSON.parse(fs.readFileSync(trialsFile, 'utf8')), fx, fxSha: sha(fs.readFileSync(fxFile)), ledgerIdNow: ledgerOps.ledgerId(path.resolve(ledger)),
    reservations: ledgerOps.reservations(path.resolve(ledger)), traceNames: traceNamesOf(dir), settled: ledgerOps.settlements(path.resolve(ledger))});
  if (problems.length) { console.error(`refused: ${problems.join('; ')}`); process.exit(3); }
  const spec = JSON.parse(fs.readFileSync(path.join(ev, 'cases.json'), 'utf8'));
  const {runs, sums, judgement} = judgeRun({spec, dir, ledger: path.resolve(ledger)});
  if (opt('--runs-json')) fs.writeFileSync(opt('--runs-json'), JSON.stringify(runs, null, 1));
  const out = {summaries: sums, judge: ['B', 'S'], ...judgement};
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(out, null, 1) + '\n');
  for (const s of Object.values(sums)) console.log(JSON.stringify(s));
  console.log(JSON.stringify({judge: ['B', 'S'], ...judgement}));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
