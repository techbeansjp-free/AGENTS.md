// Host side (#1807): renders every trial of a case offline in a disposable container and runs the gold check.
// Usage: node run-render.mjs <worktree-abs> <runs-root> <case-id> <out-dir>
// Output: <out-dir>/render.json, <out-dir>/<trial>/{desktop,mobile|tablet}.png, desktop-gray.png, *.txt, gold.json
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
const [worktree, runsArg, caseId, outArg] = process.argv.slice(2);
const runs = path.resolve(runsArg); const out = path.resolve(outArg);
fs.mkdirSync(out, {recursive: true});
const short = caseId.slice(0, 4);
const trials = fs.readdirSync(path.join(runs, caseId)).filter((t) => fs.statSync(path.join(runs, caseId, t)).isDirectory()).sort();
const targets = trials.map((id) => ({id, case: short, file: `/runs/${caseId}/${id}/fixture/out/index.html`}));
fs.writeFileSync(path.join(out, 'targets.json'), JSON.stringify(targets, null, 1));
const gold = trials.map((id) => `[ -f /runs/${caseId}/${id}/fixture/out/index.html ] && mkdir -p /out/${id} && node /opt/h/gold-check.mjs /opt/e/gold.json ${caseId} /runs/${caseId}/${id}/fixture/out/index.html > /out/${id}/gold.json`).join('; ');
const r = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=512m', '--shm-size', '1g',
  '--memory', '3g', '--cpus', '2', '--pids-limit', '512', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', 'pwuser',
  '--label', `asc.worktree=${worktree}`, '-v', `${runs}:/runs:ro`, '-v', `${here}:/opt/h:ro`, '-v', `${ev}:/opt/e:ro`, '-v', `${out}:/out`, '-e', 'HOME=/tmp',
  'asc-1807-tools:1', 'sh', '-c', `node /opt/h/render.mjs /out/targets.json /out && ${gold}; true`], {stdio: 'inherit'});
process.exit(r.status ?? 1);
