// Runs each UI-10 trial's own tests and the hidden oracle in a disposable container (no network, read-only).
// Usage: node run-ui10-tests.mjs <worktree-label> <runs-root> <out-json>
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [label, runsArg, outJson] = process.argv.slice(2);
const root = path.resolve(runsArg, 'ui10-cli');
const res = {};
for (const trial of fs.readdirSync(root).sort()) {
  const fx = path.join(root, trial, 'fixture');
  const run = (cmd) => spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=64m', '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--label', `asc.worktree=${label}`, '--label', 'asc.issue=1804',
    '-v', `${fx}:/fx:ro`, '-v', `${here}:/h:ro`, '-w', '/fx', '-e', 'TARGET=/fx/src/summarize.mjs', 'node:22-alpine', 'sh', '-c', cmd], {encoding: 'utf8', timeout: 120000});
  const own = run('node --test "test/**/*.test.mjs" 2>&1 | tail -12');
  const oracle = run('node --test /h/ui10-oracle.test.mjs 2>&1 | tail -12');
  const n = (s, k) => Number((s.match(new RegExp(`# ${k} (\\d+)`)) ?? [])[1] ?? NaN);
  res[trial] = {ownTests: {pass: n(own.stdout, 'pass'), fail: n(own.stdout, 'fail')}, oracle: {pass: n(oracle.stdout, 'pass'), fail: n(oracle.stdout, 'fail')}};
}
fs.writeFileSync(outJson, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
