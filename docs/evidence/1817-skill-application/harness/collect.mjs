// #1817: copied from docs/evidence/1814-skill-invocation/harness/collect.mjs; trials.json also records installSource and
// installCondition (release/candidate pairing), and (review Medium-A) the raw sha256 of each trial's trace.jsonl and
// meta.json (rawTraceSha256, rawMetaSha256, null when absent). With a ledger (required on the command line) a settled
// trial whose files are missing or differ from the settlement is refused before anything is written.
// Fifth review: the output is built by buildCollection/collectTrial only from the raw runs root, so judge.mjs can rebuild
// it and compare byte for byte (Medium-1); a reserved trial without a settlement is published as "not settled" (Low-1);
// a hand-edited ledger or a directory without a reservation is refused, and the ledger is published with the results
// (--publish-ledger, Low-2). #1817 collects once into an empty directory (no appending across stages).
// Copies each finished trial's record out of the runs root into <traces-dir> under the names score.mjs reads, with local
// absolute paths replaced (public repository: no local user names or paths). No model call.
// <cond>-<case>-<n>.jsonl, <same>.hook.jsonl (hook conditions: empty when the hook log is absent = hook did not fire),
// <same>.jsonl.missing when the trial left no trace. meta.json is reduced to the fields the README reports.
// Usage: node collect.mjs <runs-root> <traces-dir> --ledger <file> --publish-ledger <results/ledger.jsonl>
import fs from 'node:fs';
import path from 'node:path';
import {loadConditions} from './apply-condition.mjs';
import {ledgerConsistency, settlements, settledFilesProblem, fileSha256, ledgerProblems, reservedNames} from './ledger.mjs';

export function redact(text, trialDir) {
  return text.split(trialDir).join('<trial>').replace(/\/(Users|home|private\/var\/folders)\/[^/"\s\\]+/g, '/<local>').replace(/-Users-[A-Za-z0-9_.-]+/g, '-<local>');
}

// Account data, tokens or mail addresses must never reach the public record (review L9). Replaced and counted.
const SENSITIVE = [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, /sk-ant-[A-Za-z0-9_-]{8,}/g, /\b(?:gh[pousr]_[A-Za-z0-9]{20,})\b/g, /"(?:oauthAccount|accessToken|refreshToken|apiKey)"\s*:\s*"[^"]*"/g];
export function scrubSensitive(text) {
  let hits = 0;
  let out = text;
  for (const re of SENSITIVE) out = out.replace(re, () => { hits += 1; return '<redacted>'; });
  return {text: out, hits};
}

// The published output of one trial, built only from its raw directory (deterministic: judge.mjs rebuilds it and
// compares byte for byte, review Medium-1 of the fifth review). Returns null for a directory that is not a measured trial.
// With settlements (a ledger), a trial without a settlement is published as a failure ("not settled", review Low-1).
export function collectTrial(runsRoot, name, {conds, settled = null}) {
  const dir = path.join(runsRoot, name);
  const m = /^([A-Z]+)-(.+)-(\d+)$/.exec(name);
  if (!m || !fs.statSync(dir).isDirectory() || m[2] === 'probe') return null;
  const trace = path.join(dir, 'trace.jsonl');
  const raw = {rawTraceSha256: fileSha256(trace), rawMetaSha256: fileSha256(path.join(dir, 'meta.json'))};
  if (settled && !settled.has(name)) return {files: [[`${name}.jsonl.missing`, 'not settled\n']], row: {trial: name, missing: 'not settled', ...raw}};
  const has = fs.existsSync(trace) && fs.statSync(trace).size > 0;
  if (!has) return {files: [[`${name}.jsonl.missing`, 'no trace\n']], row: {trial: name, missing: true, ...raw}};
  // review L-6: a trace without meta.json (killed after the trace was written) is a failure row, not a crash.
  if (!fs.existsSync(path.join(dir, 'meta.json'))) return {files: [[`${name}.jsonl.missing`, 'no meta.json\n']], row: {trial: name, missing: 'meta.json', ...raw}};
  const clean = scrubSensitive(redact(fs.readFileSync(trace, 'utf8'), dir));
  const files = [[`${name}.jsonl`, clean.text]];
  if (conds[m[1]]?.hook) {
    const log = path.join(dir, 'hook.jsonl');
    files.push([`${name}.hook.jsonl`, fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '']);
  }
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const row = {trial: name, model: meta.model, resolvedModel: meta.resolvedModel, claudeVersion: meta.claudeVersion, ascRuntimeVersion: meta.ascRuntimeVersion,
    tarballSha256: meta.tarballSha256, released: meta.released, installSource: meta.installSource ?? null, installCondition: meta.installCondition ?? null, adopted: meta.adopted, sampleHead: meta.sampleHead, applied: meta.applied, expectHook: meta.expectHook,
    ledgerId: meta.ledgerId ?? null, ledgerSeq: meta.ledgerSeq ?? null, fixationSha256: meta.fixationSha256, fixedAtCommit: meta.fixedAtCommit, fixationStage: meta.fixationStage,
    exit: meta.exit, costUsd: meta.costUsd, wallMs: meta.wallMs, redactedSensitive: clean.hits, ...raw};
  return {files, row};
}

// Everything collect publishes for a runs root, without writing (collect and judge.mjs use the same function).
// With a ledger: the ledger must not be hand-edited, settled trials must be untouched, and every directory must be reserved.
export function buildCollection(runsRoot, {ledger = null} = {}) {
  const conds = loadConditions().conditions;
  const settled = ledger ? settlements(ledger) : null;
  if (ledger) {
    const lp = ledgerProblems(ledger);
    if (lp.length) throw new Error(`ledger refused: ${lp.join('; ')}`);
    const reserved = reservedNames(ledger);
    const stray = fs.readdirSync(runsRoot).filter((n) => /^[A-Z]+-.+-\d+$/.test(n) && !reserved.has(n));
    if (stray.length) throw new Error(`trial directories without a reservation (README resume, case 2): ${stray.join(', ')}`);
    const tampered = fs.readdirSync(runsRoot).filter((n) => settled.has(n)).map((n) => settledFilesProblem(path.join(runsRoot, n), settled.get(n))).filter(Boolean);
    if (tampered.length) throw new Error(tampered.join('; '));
  }
  const files = [], rows = [];
  for (const name of fs.readdirSync(runsRoot).sort()) {
    const t = collectTrial(runsRoot, name, {conds, settled});
    if (!t) continue;
    files.push(...t.files); rows.push(t.row);
  }
  return {files, rows};
}

export const trialsJsonText = (rows) => JSON.stringify(rows, null, 1);

export function collect(runsRoot, out, {ledger = null, publishLedger = null} = {}) {
  // All checks run before any file is written.
  const {files, rows} = buildCollection(runsRoot, {ledger});
  if (fs.existsSync(path.join(out, 'trials.json'))) throw new Error('trials.json exists: #1817 is collected once, into an empty directory');
  const lc = ledgerConsistency(rows.filter((r) => !r.missing));
  if (lc.length) throw new Error(`ledger check failed: ${lc.join('; ')}`);
  fs.mkdirSync(out, {recursive: true});
  for (const [f, text] of files) fs.writeFileSync(path.join(out, f), text);
  fs.writeFileSync(path.join(out, 'trials.json'), trialsJsonText(rows));
  // review Low-2: the ledger (ids, trial names, costs, sha256, times; no secrets) is published with the results.
  if (ledger && publishLedger) fs.copyFileSync(ledger, publishLedger);
  return rows.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--ledger');
  const k = args.indexOf('--publish-ledger');
  if (i < 0 || !args[i + 1] || k < 0 || !args[k + 1]) { console.error('usage: node collect.mjs <runs-root> <traces-dir> --ledger <file> --publish-ledger <results/ledger.jsonl>'); process.exit(2); }
  const [root, out] = args.slice(0, 2).map((p) => path.resolve(p));
  console.log(JSON.stringify({collected: collect(root, out, {ledger: path.resolve(args[i + 1]), publishLedger: path.resolve(args[k + 1])})}));
}
