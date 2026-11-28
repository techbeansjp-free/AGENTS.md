// Shared harness: builds what a measurement publishes from the raw runs root, without publishing any raw trace (owner
// decision B of #1823: raw per-trial traces stay in scratch). From docs/evidence/1820-write-tools-read/stage2/harness/collect.mjs
// (kept: the ledger checks before anything is written, a hand-edited ledger refused, a settled trial whose trace.jsonl or
// meta.json is missing or differs from the settlement refused, a directory without a reservation refused, a reserved
// trial without a settlement published as "not settled", the redaction of local paths and the sensitive scrub, collected
// once into an empty directory, the ledger published with the results).
// Published (all deterministic from the raw runs root and the ledger, so judge.mjs rebuilds them and compares byte for
// byte): trials.json (a small per-trial summary: condition, case, install source, model, cost, turns, time, the raw
// sha256 of trace.jsonl and meta.json, ...), runs.json (the per-trial scoring of score.mjs scoreTrials, redacted),
// ledger.jsonl (the ledger), published.json (the sha256 of those three files and rawRunsSha256, the sha256 of the list of
// trial names with their raw trace/meta sha256: the identifier of the raw records kept in scratch). judge.mjs adds
// judge.json; the probes are published by probe-check.mjs publish. No model call.
// Usage: node collect.mjs <runs-root> <results-dir> --ledger <file> --config <dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {loadConditions} from './apply-condition.mjs';
import {ledgerConsistency, settlements, settledFilesProblem, fileSha256, ledgerProblems, reservedNames} from './ledger.mjs';
import {scoreTrials} from './score.mjs';
import {loadSpec} from './config.mjs';
import {workChanges, headReader, gitEnv} from './make-fixture.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const PUBLISHED = ['trials.json', 'runs.json', 'ledger.jsonl'];

export function redact(text, trialDir) {
  return text.split(trialDir).join('<trial>').replace(/\/(Users|home|private\/var\/folders)\/[^/"\s\\]+/g, '/<local>').replace(/-Users-[A-Za-z0-9_.-]+/g, '-<local>')
    .replace(/\/tmp\/claude-\d+(?![0-9])/g, '/tmp/<tmp-user>').replace(/-tmp-claude-\d+(?=-)/g, '-tmp-<tmp-user>');
}

// Account data, tokens or mail addresses must never reach the public record (review L9). Replaced and counted.
const SENSITIVE = [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, /sk-ant-[A-Za-z0-9_-]{8,}/g, /\b(?:gh[pousr]_[A-Za-z0-9]{20,})\b/g, /"(?:oauthAccount|accessToken|refreshToken|apiKey)"\s*:\s*"[^"]*"/g];
export function scrubSensitive(text) {
  let hits = 0;
  let out = text;
  for (const re of SENSITIVE) out = out.replace(re, () => { hits += 1; return '<redacted>'; });
  return {text: out, hits};
}

// One trial from its raw directory: the summary row and the scoring entry (raw trace text, a collect-level failure, and
// the size of a project-relative file in the trial's work/ copy). Returns null for a directory that is not a measured
// trial. With settlements (a ledger), a trial without a settlement is a failure ("not settled", #1817 review Low-1).
export function collectTrial(runsRoot, name, {conds, settled = null}) {
  const dir = path.join(runsRoot, name);
  const m = /^([A-Z]+)-(.+)-(\d+)$/.exec(name);
  if (!m || !fs.statSync(dir).isDirectory() || m[2] === 'probe') return null;
  const trace = path.join(dir, 'trace.jsonl');
  const raw = {rawTraceSha256: fileSha256(trace), rawMetaSha256: fileSha256(path.join(dir, 'meta.json'))};
  const failed = (missing, failure) => ({row: {trial: name, missing, ...raw}, entry: {name, text: null, failure}});
  if (settled && !settled.has(name)) return failed('not settled', 'not settled');
  if (!fs.existsSync(trace) || fs.statSync(trace).size === 0) return failed(true, 'missing trace');
  // #1817 review L-6: a trace without meta.json (killed after the trace was written) is a failure row, not a crash.
  if (!fs.existsSync(path.join(dir, 'meta.json'))) return failed('meta.json', 'missing trace');
  const text = fs.readFileSync(trace, 'utf8');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  // #1844 review M3: a trial whose files or records held the credential is a failure (its work/ was removed).
  if (meta.credentialLeak) return failed('credential leak', 'credential leak');
  const cell = conds.cells[m[1]] ?? {};
  const work = path.join(dir, 'work');
  const sizeOf = (rel) => { const f = path.join(work, rel); try { return fs.statSync(f).isFile() ? fs.statSync(f).size : null; } catch { return null; } };
  // #1840: the text of a file in the trial's work/ copy at the end (cases.json writes), or null.
  const fileText = (rel) => { const p = path.join(work, rel); try { return fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null; } catch { return null; } };
  const row = {trial: name, condition: m[1], tools: cell.tools ?? null, case: meta.case ?? null, kind: meta.kind ?? null, fixture: meta.fixture ?? null, model: meta.model, resolvedModel: meta.resolvedModel, claudeVersion: meta.claudeVersion, ascRuntimeVersion: meta.ascRuntimeVersion,
    tarballSha256: meta.tarballSha256, installSource: meta.installSource ?? null, released: meta.released, installCondition: meta.installCondition ?? null, installFixture: meta.installFixture ?? null, adopted: meta.adopted, claudeMdSha256: meta.claudeMdSha256 ?? null, sampleHead: meta.sampleHead, applied: meta.applied,
    maxTurns: meta.maxTurns ?? null, initTools: meta.initTools ?? null, initPermissionMode: meta.initPermissionMode ?? null, settingsSha256: meta.settingsSha256 ?? null, resultSubtype: meta.resultSubtype ?? null, numTurns: meta.numTurns ?? null,
    ledgerId: meta.ledgerId ?? null, ledgerSeq: meta.ledgerSeq ?? null, fixationSha256: meta.fixationSha256, fixedAtCommit: meta.fixedAtCommit, fixationStage: meta.fixationStage,
    exit: meta.exit, costUsd: meta.costUsd, wallMs: meta.wallMs, redactedSensitive: scrubSensitive(redact(text, dir)).hits, ...raw,
    ...(meta.sandboxLayout ? {sandboxLayout: meta.sandboxLayout, nodeVersion: meta.nodeVersion ?? null, endHead: meta.endHead ?? null, unreachedCommits: meta.unreached?.commits?.length ?? null, credentialLeak: meta.credentialLeak ?? null} : {})};
  // #1840 re-review High: the fixture's files before the trial (work/ at its HEAD), for the lines the markers leave out.
  // #1844 review L-c: a trial with Bash may have committed; its files before the trial are those of meta.json sampleHead.
  const head = headReader(work, meta.workFilesOptions && meta.sampleHead ? meta.sampleHead : 'HEAD');
  // #1844: with a level that has Bash, every file the trial changed or created (meta.json workFiles, by any tool) counts as
  // written (score.mjs writtenFiles); a deleted file (null) does not.
  const changedFiles = meta.workFilesOptions && meta.workFiles ? Object.keys(meta.workFiles).filter((f) => meta.workFiles[f] !== null) : null;
  // #1844 review M1/L2: the worktrees under .worktrees/ (the possible Bash reads are expanded against their files) and the
  // files of the commits HEAD no longer reaches (meta.json unreached).
  const wtDir = path.join(work, '.worktrees');
  const worktrees = meta.workFilesOptions ? (fs.existsSync(wtDir) ? fs.readdirSync(wtDir).filter((n) => fs.statSync(path.join(wtDir, n)).isDirectory()).sort() : []) : null;
  return {row, entry: {name, text, failure: null, sizeOf, fileText, priorFiles: head.files, priorTexts: head.texts, ...(changedFiles ? {changedFiles} : {}),
    ...(worktrees ? {worktrees} : {}), ...(meta.unreached?.files?.length ? {unreachedFiles: meta.unreached.files} : {})}, dir};
}

// #1840 review M2: a trial whose meta.json records workFiles (run-trial.mjs, the changed and created files with their
// sha256) against its work/ copy now: the same paths and digests, or a problem text. A trial without the field (earlier
// configs) or without meta.json gives none (reported elsewhere).
// #1845: a trial that records workFiles (or workFilesError) must still have its work/ copy, and the HEAD of work/ must be
// the meta.json sampleHead (the fixture the trial started from), checked before anything is collected; a trial with
// workFiles and no sampleHead is refused.
export function workFilesProblem(dir) {
  const mf = path.join(dir, 'meta.json');
  if (!fs.existsSync(mf)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { return null; }
  const work = path.join(dir, 'work');
  // #1844 review M3: a leaking trial's work/ was removed on purpose; the trial is a failure (collectTrial).
  if (meta.credentialLeak) return null;
  if (meta.unreachedError) return `trial ${path.basename(dir)}: the commits outside HEAD were not recorded (${meta.unreachedError})`;
  if (!meta.workFiles && !meta.workFilesError) return null;
  if (!fs.existsSync(work)) return `trial ${path.basename(dir)}: work/ is missing although meta.json records the changed files`;
  if (meta.workFilesError) return `trial ${path.basename(dir)}: the changed files were not recorded (${meta.workFilesError})`;
  // #1845 review L5: an empty sampleHead (rev-parse failed at the trial) is refused, not skipped; HEAD is read with the
  // same git environment as workChanges and headReader (an exported GIT_DIR does not point it at another repository).
  if (!meta.sampleHead) return `trial ${path.basename(dir)}: meta.json records the changed files but no sampleHead`;
  // #1844: a level with Bash can commit, so its trial records the HEAD at the end (endHead) and work/ must be there; the
  // changed files are taken with the options recorded (workFilesOptions: since sampleHead, worktrees by their changes).
  if (meta.workFilesOptions && !meta.endHead) return `trial ${path.basename(dir)}: meta.json records workFilesOptions but no endHead`;
  const want = meta.workFilesOptions ? meta.endHead : meta.sampleHead;
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: work, env: gitEnv(work), encoding: 'utf8'});
  if (head.status !== 0 || head.stdout.trim() !== want) return `trial ${path.basename(dir)}: the HEAD of work/ (${head.stdout.trim() || 'none'}) is not meta.json ${meta.workFilesOptions ? 'endHead' : 'sampleHead'} ${want}`;
  let now;
  try { now = workChanges(path.join(dir, 'work'), meta.workFilesOptions); } catch (e) { return `trial ${path.basename(dir)}: ${e.message}`; }
  const keys = [...new Set([...Object.keys(meta.workFiles), ...Object.keys(now)])].sort();
  const differ = keys.filter((k) => meta.workFiles[k] !== now[k]);
  return differ.length ? `trial ${path.basename(dir)}: work/ differs from the files recorded at the end of the trial (${differ.slice(0, 3).join(', ')}${differ.length > 3 ? ', …' : ''})` : null;
}

// A JSON text with the trial directory and local paths redacted and sensitive strings scrubbed.
const publicJson = (value, dir) => scrubSensitive(dir ? redact(JSON.stringify(value), dir) : redact(JSON.stringify(value), '\u0000')).text;

// Everything collect publishes for a runs root, without writing (collect and judge.mjs use the same function).
// With a ledger: the ledger must not be hand-edited, settled trials must be untouched, and every directory must be reserved.
export function buildCollection(runsRoot, {ledger = null, conds = loadConditions(), spec = loadSpec()} = {}) {
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
  // #1840 review M2: the work/ copy of every trial whose meta.json records workFiles must still hold exactly those files.
  const workChanged = fs.readdirSync(runsRoot).filter((n) => /^[A-Z]+-.+-\d+$/.test(n) && !/-probe-\d+$/.test(n)).map((n) => workFilesProblem(path.join(runsRoot, n))).filter(Boolean);
  if (workChanged.length) throw new Error(workChanged.join('; '));
  const rows = [], entries = [], dirs = new Map();
  for (const name of fs.readdirSync(runsRoot).sort()) {
    const t = collectTrial(runsRoot, name, {conds, settled});
    if (!t) continue;
    rows.push(t.row); entries.push(t.entry); if (t.dir) dirs.set(name, t.dir);
  }
  const runs = scoreTrials(spec, entries, conds);
  const trialsText = JSON.stringify(rows.map((r) => JSON.parse(publicJson(r, dirs.get(r.trial)))), null, 1) + '\n';
  const runsText = JSON.stringify(runs.map((r) => JSON.parse(publicJson(r, dirs.get(`${r.condition}-${r.case}-${r.run}`)))), null, 1) + '\n';
  const rawRunsSha256 = sha(rows.map((r) => `${r.trial} ${r.rawTraceSha256} ${r.rawMetaSha256}\n`).join(''));
  return {rows, runs, files: [['trials.json', trialsText], ['runs.json', runsText]], rawRunsSha256};
}

// The manifest of the published files (published.json).
export function manifestText(files, rawRunsSha256, ledgerBytes) {
  const m = {files: Object.fromEntries([...files.map(([f, text]) => [f, sha(Buffer.from(text))]), ['ledger.jsonl', ledgerBytes ? sha(ledgerBytes) : null]]), rawRunsSha256,
    note: 'sha256 of the published files; rawRunsSha256 identifies the raw records kept outside the repository (sha256 of "<trial> <raw trace sha256> <raw meta sha256>\\n" over the trials in name order).'};
  return JSON.stringify(m, null, 1) + '\n';
}

export function collect(runsRoot, out, {ledger}) {
  // All checks run before any file is written.
  if (!ledger) throw new Error('--ledger is required');
  const {files, rows, rawRunsSha256} = buildCollection(runsRoot, {ledger});
  if (fs.existsSync(path.join(out, 'trials.json'))) throw new Error('trials.json exists: a measurement is collected once, into an empty directory');
  const lc = ledgerConsistency(rows.filter((r) => !r.missing));
  if (lc.length) throw new Error(`ledger check failed: ${lc.join('; ')}`);
  fs.mkdirSync(out, {recursive: true});
  for (const [f, text] of files) fs.writeFileSync(path.join(out, f), text);
  const ledgerBytes = fs.readFileSync(ledger);
  fs.writeFileSync(path.join(out, 'ledger.jsonl'), ledgerBytes);
  fs.writeFileSync(path.join(out, 'published.json'), manifestText(files, rawRunsSha256, ledgerBytes));
  return rows.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--ledger');
  if (i < 0 || !args[i + 1] || !args[1]) { console.error('usage: node collect.mjs <runs-root> <results-dir> --ledger <file> --config <dir>'); process.exit(2); }
  const [root, out] = args.slice(0, 2).map((p) => path.resolve(p));
  console.log(JSON.stringify({collected: collect(root, out, {ledger: path.resolve(args[i + 1])})}));
}
