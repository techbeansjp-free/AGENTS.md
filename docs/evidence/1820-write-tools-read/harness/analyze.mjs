// #1820: copied from docs/evidence/1817-skill-application/harness/judge.mjs as the analysis entry point of stage 1 (no
// adoption decision). Every refusal below is unchanged; after them it scores the 12 cells (score.mjs scoreDir), summarises
// each cell and the negative trials, and computes the main effects of analysis-plan.md (mainEffects) only when the run is
// complete or stopped at the cap (order.mjs completionStatus) and no cell exceeds the failure limit.
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
// - (fifth review, Medium-1) the published output differs from what collect.mjs builds again from the raw runs root:
//   every file of the traces directory and trials.json must be byte-identical to the rebuild (buildCollection, which
//   also refuses a hand-edited ledger, a touched settled trial and a directory without a reservation);
// - (fifth review, Low-2) the published ledger (results/ledger.jsonl) differs from the ledger read.
// The runs root must be given with the same path as at collect time (the redaction replaces that path).
// Then (#1820) it scores the cells and analyses them, passing the completion status of the ledger
// (order.mjs completionStatus): a run that is neither complete nor stopped at the cap is not analysed.
// Usage: node analyze.mjs <traces-dir> --runs-root <dir> --ledger <file> [--published-ledger <file>] [--runs-json <out>] [--out <json>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {scoreDir, summarizeCell, mainEffects} from './score.mjs';
import {completionStatus} from './order.mjs';
import {differences, lastRecord} from './fixation.mjs';
import {fixationFileProblems} from './run-trial.mjs';
import * as ledgerOps from './ledger.mjs';
import {loadConditions} from './apply-condition.mjs';
import {buildCollection, trialsJsonText} from './collect.mjs';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Medium-1 / Low-2 (fifth review): the published traces directory and ledger against a rebuild from the raw runs root.
export function publishedProblems({runsRoot, dir, ledger, publishedLedger}) {
  const p = [];
  let built;
  try { built = buildCollection(runsRoot, {ledger}); } catch (e) { return [`rebuild from the runs root refused: ${e.message}`]; }
  const want = new Map([...built.files, ['trials.json', trialsJsonText(built.rows)]]);
  const have = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  for (const f of have) if (!want.has(f)) p.push(`published file not produced by collect: ${f}`);
  for (const [f, text] of want) {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) p.push(`published file missing: ${f}`);
    else if (!fs.readFileSync(file).equals(Buffer.from(text))) p.push(`published file differs from the rebuild: ${f}`);
  }
  if (!publishedLedger || !fs.existsSync(publishedLedger)) p.push('the published ledger is missing');
  else if (!fs.readFileSync(publishedLedger).equals(fs.readFileSync(ledger))) p.push('the published ledger differs from the ledger read');
  return p;
}

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

// analysis-plan.md: analysed only when complete or cap-reached, every required replacement is present, and no cell has
// more than maxFailuresPerCell failures among its counted brief trials after replacement (review L3: with 4 trials per
// cell one failed replacement is 1/4 = 25% of the cell; it is allowed and the cell's rate is taken over its 3 valid
// trials; two are not). The negative trials do not count toward this rule: their failures are reported per cell
// (negatives.failures) and the overapplication is counted over their valid trials only.
export function cellRuleReasons(sums, maxFailuresPerCell = 1) {
  const reasons = [];
  for (const s of Object.values(sums)) {
    if (s.replacementsMissing) reasons.push(`${s.cell}: ${s.replacementsMissing} failed trial(s) without the mandatory replacement`);
    if (s.failures > maxFailuresPerCell) reasons.push(`${s.cell}: ${s.failures} of ${s.runs} counted brief trials failed after replacement (more than ${maxFailuresPerCell})`);
  }
  return reasons;
}

export function analyzeRun({spec, dir, ledger, conds = loadConditions(), maxFailuresPerCell = 1}) {
  const runs = scoreDir(spec, dir, conds);
  const sums = Object.fromEntries(Object.keys(conds.cells).map((c) => [c, summarizeCell(runs, c)]));
  const completion = completionStatus({runs, reserved: ledgerOps.reservedNames(ledger), reservations: ledgerOps.reservations(ledger), spentUsd: ledgerOps.spent(ledger), budget: conds.budget});
  const reasons = [];
  if (!completion.basis) reasons.push(`run neither complete nor stopped at the cap (${completion.missingPlanned} planned and ${completion.missingReplacements.length} required replacement(s) not reserved)`);
  reasons.push(...cellRuleReasons(sums, maxFailuresPerCell));
  const negatives = Object.fromEntries(conds.negativeCells.map((c) => [c, sums[c].negatives]));
  const analysis = reasons.length ? {analysed: false, reason: reasons.join('; ')} : mainEffects(sums, conds);
  return {runs, sums, negatives, completion, basis: completion.basis, analysis};
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const dir = path.resolve(args[0] ?? '');
  const ledger = opt('--ledger'), runsRoot = opt('--runs-root');
  if (!args[0] || !ledger || !runsRoot) { console.error('usage: node analyze.mjs <traces-dir> --runs-root <dir> --ledger <file> [--published-ledger <file>] [--runs-json <out>] [--out <json>]'); process.exit(2); }
  const publishedLedger = path.resolve(opt('--published-ledger') ?? path.join(dir, '..', 'ledger.jsonl'));
  const fxFile = path.join(ev, 'results/fixation.json');
  const fx = JSON.parse(fs.readFileSync(fxFile, 'utf8'));
  const trialsFile = path.join(dir, 'trials.json');
  if (!fs.existsSync(trialsFile)) { console.error('refused: trials.json (from collect.mjs) is missing'); process.exit(3); }
  const problems = scoringProblems({rows: JSON.parse(fs.readFileSync(trialsFile, 'utf8')), fx, fxSha: sha(fs.readFileSync(fxFile)), ledgerIdNow: ledgerOps.ledgerId(path.resolve(ledger)),
    reservations: ledgerOps.reservations(path.resolve(ledger)), traceNames: traceNamesOf(dir), settled: ledgerOps.settlements(path.resolve(ledger))});
  problems.push(...publishedProblems({runsRoot: path.resolve(runsRoot), dir, ledger: path.resolve(ledger), publishedLedger}));
  if (problems.length) { console.error(`refused: ${problems.join('; ')}`); process.exit(3); }
  const spec = JSON.parse(fs.readFileSync(path.join(ev, 'cases.json'), 'utf8'));
  const {runs, sums, negatives, completion, basis, analysis} = analyzeRun({spec, dir, ledger: path.resolve(ledger)});
  if (opt('--runs-json')) fs.writeFileSync(opt('--runs-json'), JSON.stringify(runs, null, 1));
  const out = {cells: sums, negatives, completion, basis, analysis};
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(out, null, 1) + '\n');
  for (const s of Object.values(sums)) console.log(JSON.stringify(s));
  console.log(JSON.stringify({negatives, basis, analysis}));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
