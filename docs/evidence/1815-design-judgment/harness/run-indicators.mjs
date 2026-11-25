// Host side (#1815): renders every trial of a case offline in a disposable container and records the indicators.
// 1. #1807 harness/run-render.mjs (unchanged): render.json, screenshots, gold.json (coverage, overflow, axe, ...).
// 2. first-view.mjs in the same image and isolation (--network none, read-only, cap-drop ALL): first-view.json.
// Refuses when the local asc-1807-tools:1 is not the image id pinned in conditions.json.
// Usage: node run-indicators.mjs <runs-root> <case-id> <render-root>
//   -> <render-root>/<case>/{render.json,targets.json,<trial>/{desktop,mobile|tablet}.png,gold.json,first-view.json}
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ev, evidenceRoot} from './pairing.mjs';
import {IMAGE, LABEL, imageProblems} from './run-trial.mjs';

const e1807 = path.join(evidenceRoot, '1807-design-eval-browser');

export function firstViewCommand(runs, caseId, out, trials) {
  const each = trials.map((id) => `[ -f /runs/${caseId}/${id}/fixture/out/index.html ] && mkdir -p /out/${id} && node /opt/h/first-view.mjs /opt/e/cases.json ${caseId} /runs/${caseId}/${id}/fixture/out/index.html /opt/g/gold.json > /out/${id}/first-view.json`).join('; ');
  return ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=512m', '--shm-size', '1g',
    '--memory', '3g', '--cpus', '2', '--pids-limit', '512', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', 'pwuser',
    '--label', LABEL, '-v', `${runs}:/runs:ro`, '-v', `${path.join(ev, 'harness')}:/opt/h:ro`, '-v', `${ev}:/opt/e:ro`, '-v', `${e1807}:/opt/g:ro`, '-v', `${out}:/out`,
    '-e', 'HOME=/tmp', IMAGE, 'sh', '-c', `${each || 'true'}; true`];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [runsArg, caseId, renderArg] = process.argv.slice(2);
  const im = imageProblems().filter((p) => p.includes(IMAGE));
  if (im.length) { console.error(`refused: ${im.join('; ')}`); process.exit(3); }
  const runs = path.resolve(runsArg), out = path.join(path.resolve(renderArg), caseId);
  fs.mkdirSync(out, {recursive: true});
  const r1 = spawnSync(process.execPath, [path.join(e1807, 'harness/run-render.mjs'), ev, runs, caseId, out], {stdio: 'inherit'});
  const trials = fs.readdirSync(path.join(runs, caseId)).filter((t) => /^(B|S)-r\d+$/.test(t)).sort();
  const r2 = spawnSync('docker', firstViewCommand(runs, caseId, out, trials), {stdio: 'inherit'});
  process.exit(r1.status || r2.status || 0);
}
