// Shared harness: the decision entry point, from docs/evidence/1820-write-tools-read/stage2/harness/judge.mjs. Every
// refusal is kept (fixation, trial fixation digests, ledger id/seq consistency, name sets of ledger/trials.json/trial
// directories, settlements). The rebuild check runs against the raw runs root: collect.mjs buildCollection is run again
// on it, and the published trials.json, runs.json, ledger.jsonl and published.json must be byte-identical to the rebuild
// (no raw trace is published, owner decision B of #1823). Then it applies the rule of the config (conditions.json rule,
// score.mjs verdictOf) with the completion status of the ledger (order.mjs completionStatus); the subsets of
// conditions.json subsets are reported separately, the per-case checks (rule.perCaseKinds) and the efficiency checks
// (rule.efficiency) enter the verdict when the rule names them. judge.json records the sha256 of the published files it
// verified. No model call.
// Usage: node judge.mjs <results-dir> --runs-root <dir> --ledger <file> [--out <json>] --config <dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {summarize, verdictOf, subsetFilter} from './score.mjs';
import {completionStatus} from './order.mjs';
import {differences, lastRecord} from './fixation.mjs';
import {fixationFileProblems} from './run-trial.mjs';
import * as ledgerOps from './ledger.mjs';
import {loadConditions} from './apply-condition.mjs';
import {buildCollection, manifestText} from './collect.mjs';
import {configDir, loadSpec} from './config.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// The published results against a rebuild from the raw runs root (#1817 fifth review Medium-1 / Low-2, now without
// published traces): trials.json and runs.json byte-identical, the published ledger equal to the ledger read, and
// published.json equal to the manifest of the rebuild. Returns {problems, built}.
export function publishedProblems({runsRoot, dir, ledger}) {
  const p = [];
  let built;
  try { built = buildCollection(runsRoot, {ledger}); } catch (e) { return {problems: [`rebuild from the runs root refused: ${e.message}`], built: null}; }
  for (const [f, text] of built.files) {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) p.push(`published file missing: ${f}`);
    else if (!fs.readFileSync(file).equals(Buffer.from(text))) p.push(`published file differs from the rebuild: ${f}`);
  }
  const pl = path.join(dir, 'ledger.jsonl');
  if (!fs.existsSync(pl)) p.push('the published ledger is missing');
  else if (!fs.readFileSync(pl).equals(fs.readFileSync(ledger))) p.push('the published ledger differs from the ledger read');
  const man = path.join(dir, 'published.json');
  if (!fs.existsSync(man)) p.push('published.json is missing');
  else if (fs.readFileSync(man, 'utf8') !== manifestText(built.files, built.rawRunsSha256, fs.readFileSync(ledger))) p.push('published.json differs from the manifest of the rebuild');
  const stray = fs.readdirSync(dir).filter((f) => /\.jsonl(\.missing)?$/.test(f) && f !== 'ledger.jsonl');
  if (stray.length) p.push(`raw trace files must not be published: ${stray.slice(0, 3).join(', ')}`);
  return {problems: p, built};
}

// Problems that forbid scoring. rows: trials.json rows; fx: parsed fixation.json; fxSha: its sha256.

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

export function scoringProblems({rows, fx, fxSha, ledgerIdNow, root = configDir(), fileProblems = null, reservations = null, traceNames = null, settled = null}) {
  const p = [];
  if (settled) p.push(...settlementProblems({rows, settled}));
  else p.push('the ledger settlements are required');
  if (reservations && traceNames) p.push(...nameSetProblems({rows, reservations, traceNames}));
  else p.push('the ledger reservations and the trial names are required');
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

export function judgeRun({spec, runs, ledger, conds = loadConditions()}) {
  const [b, c] = Object.keys(conds.cells);
  const rule = conds.rule ?? {};
  const pos = (k) => !rule.positiveKinds || !k.expect || rule.positiveKinds.includes(k.kind);
  const sums = Object.fromEntries([b, c].map((x) => [x, summarize(spec, runs, x, {only: pos})]));
  const subsets = Object.fromEntries(Object.entries(conds.subsets ?? {}).map(([name, def]) => [name, [b, c].map((x) => summarize(spec, runs, x, {only: subsetFilter(def)}))]));
  const perCase = rule.perCaseKinds ? Object.fromEntries(spec.cases.filter((k) => rule.perCaseKinds.includes(k.kind)).map((k) => [k.id, [b, c].map((x) => summarize(spec, runs, x, {only: (q) => q.id === k.id}))])) : null;
  const eff = rule.efficiency ? (() => { const [eb, ec] = [b, c].map((x) => summarize(spec, runs, x, {only: (k) => rule.efficiency.kinds.includes(k.kind)})); return {b: eb, c: ec, kinds: rule.efficiency.kinds, metrics: rule.efficiency.metrics}; })() : null;
  const completion = completionStatus({runs, reserved: ledgerOps.reservedNames(ledger), reservations: ledgerOps.reservations(ledger), spentUsd: ledgerOps.spent(ledger), budget: conds.budget});
  return {sums, completion, judgement: verdictOf(sums[b], sums[c], {completion, subsets, perCase, efficiency: eff, rule})};
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const dir = path.resolve(args[0] ?? '');
  const ledger = opt('--ledger'), runsRoot = opt('--runs-root');
  if (!args[0] || !ledger || !runsRoot) { console.error('usage: node judge.mjs <results-dir> --runs-root <dir> --ledger <file> [--out <json>] --config <dir>'); process.exit(2); }
  const fxFile = path.join(configDir(), 'results/fixation.json');
  const fx = JSON.parse(fs.readFileSync(fxFile, 'utf8'));
  const trialsFile = path.join(dir, 'trials.json');
  if (!fs.existsSync(trialsFile)) { console.error('refused: trials.json (from collect.mjs) is missing'); process.exit(3); }
  const rows = JSON.parse(fs.readFileSync(trialsFile, 'utf8'));
  const {problems: pub, built} = publishedProblems({runsRoot: path.resolve(runsRoot), dir, ledger: path.resolve(ledger)});
  const problems = scoringProblems({rows, fx, fxSha: sha(fs.readFileSync(fxFile)), ledgerIdNow: ledgerOps.ledgerId(path.resolve(ledger)),
    reservations: ledgerOps.reservations(path.resolve(ledger)), traceNames: fs.readdirSync(path.resolve(runsRoot)).filter((n) => /^[A-Z]+-.+-\d+$/.test(n) && !ledgerOps.isProbe(n)), settled: ledgerOps.settlements(path.resolve(ledger))});
  problems.push(...pub);
  if (problems.length) { console.error(`refused: ${problems.join('; ')}`); process.exit(3); }
  const {sums, completion, judgement} = judgeRun({spec: loadSpec(), runs: built.runs, ledger: path.resolve(ledger)});
  const published = Object.fromEntries(['trials.json', 'runs.json', 'ledger.jsonl', 'published.json'].map((f) => [f, sha(fs.readFileSync(path.join(dir, f)))]));
  const out = {conditions: sums, completion, judgement, published, rawRunsSha256: built.rawRunsSha256};
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(out, null, 1) + '\n');
  for (const s of Object.values(sums)) console.log(JSON.stringify(s));
  console.log(JSON.stringify(judgement));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
