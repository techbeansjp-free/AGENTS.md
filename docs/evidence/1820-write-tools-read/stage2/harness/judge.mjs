// #1820 stage 2: the decision entry point, from ../../harness/analyze.mjs (stage 1) and
// ../../../1817-skill-application/harness/judge.mjs. Every refusal is unchanged (fixation, trial fixation digests, ledger
// id/seq consistency, name sets of ledger/trials.json/traces, settlements, rebuild of the published traces and ledger).
// After them it scores both conditions (score.mjs scoreDir) and applies the owner rule of decision-criteria.md
// (score.mjs judge1820s2) with the completion status of the ledger (order.mjs completionStatus); fixture A and the design
// cases are reported separately (not used for the verdict). No model call.
// The runs root must be given with the same path as at collect time (the redaction replaces that path).
// Usage: node judge.mjs <traces-dir> --runs-root <dir> --ledger <file> [--published-ledger <file>] [--runs-json <out>] [--out <json>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {scoreDir, summarize, judge1820s2} from './score.mjs';
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

export function judgeRun({spec, dir, ledger, conds = loadConditions()}) {
  const runs = scoreDir(spec, dir, conds);
  const [b, c] = Object.keys(conds.cells);
  const sums = Object.fromEntries([b, c].map((x) => [x, summarize(spec, runs, x)]));
  const isA = (k) => (k.fixture ?? 'A') === 'A', isD = (k) => k.kind === 'design';
  const subsets = {fixtureA: [summarize(spec, runs, b, {only: isA}), summarize(spec, runs, c, {only: isA})], design: [summarize(spec, runs, b, {only: isD}), summarize(spec, runs, c, {only: isD})]};
  const completion = completionStatus({runs, reserved: ledgerOps.reservedNames(ledger), reservations: ledgerOps.reservations(ledger), spentUsd: ledgerOps.spent(ledger), budget: conds.budget});
  return {runs, sums, completion, judgement: judge1820s2(sums[b], sums[c], {completion, subsets})};
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const dir = path.resolve(args[0] ?? '');
  const ledger = opt('--ledger'), runsRoot = opt('--runs-root');
  if (!args[0] || !ledger || !runsRoot) { console.error('usage: node judge.mjs <traces-dir> --runs-root <dir> --ledger <file> [--published-ledger <file>] [--runs-json <out>] [--out <json>]'); process.exit(2); }
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
  const {runs, sums, completion, judgement} = judgeRun({spec, dir, ledger: path.resolve(ledger)});
  if (opt('--runs-json')) fs.writeFileSync(opt('--runs-json'), JSON.stringify(runs, null, 1));
  const out = {conditions: sums, completion, judgement};
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(out, null, 1) + '\n');
  for (const s of Object.values(sums)) console.log(JSON.stringify(s));
  console.log(JSON.stringify(judgement));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
