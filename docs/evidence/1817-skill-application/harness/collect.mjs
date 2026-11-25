// #1817: copied from docs/evidence/1814-skill-invocation/harness/collect.mjs; trials.json also records installSource and
// installCondition (release/candidate pairing).
// Copies each finished trial's record out of the runs root into <traces-dir> under the names score.mjs reads, with local
// absolute paths replaced (public repository: no local user names or paths). No model call.
// <cond>-<case>-<n>.jsonl, <same>.hook.jsonl (hook conditions: empty when the hook log is absent = hook did not fire),
// <same>.jsonl.missing when the trial left no trace. meta.json is reduced to the fields the README reports.
// Usage: node collect.mjs <runs-root> <traces-dir>
import fs from 'node:fs';
import path from 'node:path';
import {loadConditions} from './apply-condition.mjs';
import {ledgerConsistency} from './ledger.mjs';

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

export function collect(runsRoot, out) {
  const conds = loadConditions().conditions;
  fs.mkdirSync(out, {recursive: true});
  const rows = [];
  const priorFile = path.join(out, 'trials.json');
  const priorNames = new Set(fs.existsSync(priorFile) ? JSON.parse(fs.readFileSync(priorFile, 'utf8')).map((r) => r.trial) : []);
  const clash = fs.readdirSync(runsRoot).filter((n) => priorNames.has(n));
  if (clash.length) throw new Error(`trials already collected: ${clash.join(', ')}`); // before any file is written
  // All checks run before any file is written (pending writes are applied at the end).
  const writes = [];
  const put = (f, text) => writes.push([path.join(out, f), text]);
  for (const name of fs.readdirSync(runsRoot).sort()) {
    const dir = path.join(runsRoot, name);
    const m = /^([A-Z]+)-(.+)-(\d+)$/.exec(name);
    if (!m || !fs.statSync(dir).isDirectory() || m[2] === 'probe') continue;
    const trace = path.join(dir, 'trace.jsonl');
    const has = fs.existsSync(trace) && fs.statSync(trace).size > 0;
    if (!has) { put(`${name}.jsonl.missing`, 'no trace\n'); rows.push({trial: name, missing: true}); continue; }
    // review L-6: a trace without meta.json (killed after the trace was written) is a failure row, not a crash.
    if (!fs.existsSync(path.join(dir, 'meta.json'))) { put(`${name}.jsonl.missing`, 'no meta.json\n'); rows.push({trial: name, missing: 'meta.json'}); continue; }
    const clean = scrubSensitive(redact(fs.readFileSync(trace, 'utf8'), dir));
    put(`${name}.jsonl`, clean.text);
    if (conds[m[1]]?.hook) {
      const log = path.join(dir, 'hook.jsonl');
      put(`${name}.hook.jsonl`, fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
    }
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    rows.push({trial: name, model: meta.model, resolvedModel: meta.resolvedModel, claudeVersion: meta.claudeVersion, ascRuntimeVersion: meta.ascRuntimeVersion,
      tarballSha256: meta.tarballSha256, released: meta.released, installSource: meta.installSource ?? null, installCondition: meta.installCondition ?? null, adopted: meta.adopted, sampleHead: meta.sampleHead, applied: meta.applied, expectHook: meta.expectHook,
      ledgerId: meta.ledgerId ?? null, ledgerSeq: meta.ledgerSeq ?? null, fixationSha256: meta.fixationSha256, fixedAtCommit: meta.fixedAtCommit, fixationStage: meta.fixationStage,
      exit: meta.exit, costUsd: meta.costUsd, wallMs: meta.wallMs, redactedSensitive: clean.hits});
  }
  // review L-e: stages are collected into the same directory; trials.json is extended, never overwritten.
  const file = path.join(out, 'trials.json');
  const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  // review N-1 (d): one ledger for all stages, each reservation seq once.
  const lc = ledgerConsistency([...prior, ...rows].filter((r) => !r.missing));
  if (lc.length) throw new Error(`ledger check failed: ${lc.join('; ')}`);
  for (const [f, text] of writes) fs.writeFileSync(f, text);
  fs.writeFileSync(file, JSON.stringify([...prior, ...rows], null, 1));
  return rows.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [root, out] = process.argv.slice(2).map((p) => path.resolve(p));
  console.log(JSON.stringify({collected: collect(root, out)}));
}
