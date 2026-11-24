// Host side: builds targets for all trials of a case and runs the renderer in a disposable container.
// Usage: node run-render.mjs <worktree-label> <runs-root> <case-id> <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [label, runsArg, caseId, outArg] = process.argv.slice(2);
const runs = path.resolve(runsArg); const out = path.resolve(outArg);
fs.mkdirSync(out, {recursive: true});
const short = caseId.slice(0, 4);
const rel = {ui02: 'fixture/out/index.html', ui03: 'fixture/out/index.html', ui08: 'fixture/app/billing.html'}[short];
const targets = fs.readdirSync(path.join(runs, caseId)).sort().map((id) => ({id, case: short, file: `/runs/${caseId}/${id}/${rel}`}));
if (short === 'ui08') targets.push({id: 'reference-members', case: short, file: `/ref/members.html`});
fs.writeFileSync(path.join(out, 'targets.json'), JSON.stringify(targets, null, 1));
const r = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=512m', '--shm-size', '512m',
  '--memory', '2g', '--cpus', '2', '--pids-limit', '512', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', 'pwuser',
  '--label', `asc.worktree=${label}`, '--label', 'asc.issue=1804',
  '-v', `${runs}:/runs:ro`, '-v', `${here}:/harness:ro`, '-v', `${out}:/out`,
  ...(short === 'ui08' ? ['-v', `${path.resolve(here, '../cases/ui08-existing-ds/app')}:/ref:ro`] : []),
  '-e', 'HOME=/tmp', 'asc-1804-render:1', 'node', '/harness/render-in-container.mjs', '/out/targets.json', '/out'], {stdio: 'inherit'});
process.exit(r.status ?? 1);
