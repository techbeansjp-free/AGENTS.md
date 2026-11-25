// Copies each finished trial's record out of the runs root into <traces-dir> under the names score.mjs reads, with local
// absolute paths replaced (public repository: no local user names or paths). No model call.
// <cond>-<case>-<n>.jsonl, <same>.hook.jsonl (hook conditions: empty when the hook log is absent = hook did not fire),
// <same>.jsonl.missing when the trial left no trace. meta.json is reduced to the fields the README reports.
// Usage: node collect.mjs <runs-root> <traces-dir>
import fs from 'node:fs';
import path from 'node:path';
import {loadConditions} from './apply-condition.mjs';

export function redact(text, trialDir) {
  return text.split(trialDir).join('<trial>').replace(/\/(Users|home|private\/var\/folders)\/[^/"\s\\]+/g, '/<local>').replace(/-Users-[A-Za-z0-9_.-]+/g, '-<local>');
}

export function collect(runsRoot, out) {
  const conds = loadConditions().conditions;
  fs.mkdirSync(out, {recursive: true});
  const rows = [];
  for (const name of fs.readdirSync(runsRoot).sort()) {
    const dir = path.join(runsRoot, name);
    const m = /^([A-Z]+)-(.+)-(\d+)$/.exec(name);
    if (!m || !fs.statSync(dir).isDirectory() || m[2] === 'iso') continue;
    const trace = path.join(dir, 'trace.jsonl');
    const has = fs.existsSync(trace) && fs.statSync(trace).size > 0;
    if (!has) { fs.writeFileSync(path.join(out, `${name}.jsonl.missing`), 'no trace\n'); rows.push({trial: name, missing: true}); continue; }
    fs.writeFileSync(path.join(out, `${name}.jsonl`), redact(fs.readFileSync(trace, 'utf8'), dir));
    if (conds[m[1]]?.hook) {
      const log = path.join(dir, 'hook.jsonl');
      fs.writeFileSync(path.join(out, `${name}.hook.jsonl`), fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
    }
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    rows.push({trial: name, model: meta.model, exit: meta.exit, costUsd: meta.costUsd, wallMs: meta.wallMs, applied: meta.applied, markerInTrace: meta.markerInTrace});
  }
  fs.writeFileSync(path.join(out, 'trials.json'), JSON.stringify(rows, null, 1));
  return rows.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [root, out] = process.argv.slice(2).map((p) => path.resolve(p));
  console.log(JSON.stringify({collected: collect(root, out)}));
}
