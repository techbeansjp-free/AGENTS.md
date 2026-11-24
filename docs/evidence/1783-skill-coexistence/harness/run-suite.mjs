// Runs one generated suite with `claude plugin eval` (isolated temporary HOME/config per run, read-only tools),
// copies every run's trace out of the kept sandbox, then deletes the kept sandboxes.
// Usage: node run-suite.mjs <suites-root> <suite: A|B|C|F|diag|iso> <out-dir> <max-cost-usd>   (absolute paths)
// Exits with the status of `claude plugin eval`. If no result JSON is written, <out-dir>/traces/<suite>.missing-json
// is created so the failure is counted. The cleanup matches the macOS temporary path form seen (/private/tmp/e-*).
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const [rootArg, suite, outArg, cap] = process.argv.slice(2);
const [root, out] = [rootArg, outArg].map((p) => path.resolve(p));
fs.mkdirSync(path.join(out, 'traces'), {recursive: true});
const json = path.join(out, `${suite}.json`);
const r = spawnSync('claude', ['plugin', 'eval', '.', '--eval-dir', `evals-${suite}`, '--ablation', 'none', '--no-publish', '--trust-plugin', '--scaffold', '--keep-temp',
  '--disallow-tools', 'Task', 'Agent', 'TaskStop', '-j', '4', '--max-cost-usd', cap, '--json', json, '--output-dir', path.join(out, `${suite}-report`)], {cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
fs.writeFileSync(path.join(out, `${suite}.stdout`), r.stdout ?? '');
fs.writeFileSync(path.join(out, `${suite}.stderr`), r.stderr ?? '');
const rc = r.status ?? 1;
fs.writeFileSync(path.join(out, `${suite}.exit`), `exit=${rc}${r.signal ? ` signal=${r.signal}` : ''}${r.error ? ` error=${r.error.message}` : ''}\n`);
let j = null;
try { j = JSON.parse(fs.readFileSync(json, 'utf8')); } catch (e) { fs.writeFileSync(path.join(out, 'traces', `${suite}.missing-json`), `no readable result json (exit ${rc}): ${e.message}\n`); }
for (const c of j?.cases ?? []) (c.arms?.with ?? []).forEach((run, i) => {
  const dst = path.join(out, 'traces', `${c.name}-${i + 1}.jsonl`);
  try { fs.copyFileSync(run.tracePath, dst); } catch (e) { fs.writeFileSync(`${dst}.missing`, String(e)); }
});
for (const k of new Set((r.stderr ?? '').match(/kept \/private\/tmp\/e-[A-Za-z0-9]+/g)?.map((m) => m.slice(5)) ?? [])) {
  try { fs.chmodSync(k, 0o700); fs.chmodSync(path.join(k, 'sealed'), 0o700); } catch { /* already open */ }
  spawnSync('chmod', ['-R', 'u+rwx', k]);
  fs.rmSync(k, {recursive: true, force: true});
}
process.exit(rc);
