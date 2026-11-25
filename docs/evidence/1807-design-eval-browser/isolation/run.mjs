// Isolation counterexamples (#1807): internal-only Docker networks, local dummy site, no model, no internet.
// Usage: node isolation/run.mjs <worktree-abs-path> <scratch-dir> <out-dir> [--image asc-1807-tools:1 --skip-build]
//   <scratch-dir> must be a directory outside the repository; unless --skip-build, it must hold pkg/playwright-core-1.49.1.tgz,
//   and the `browser` stage of env/Dockerfile is built with --network none.
// Every resource gets the label asc.worktree=<worktree>; containers and networks are removed at the end.
// Ported from the earlier shell version (isolation/run.sh) with the same steps; Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const args = process.argv.slice(2);
const [W, S, OUT] = args;
if (!W || !S || !OUT) { console.error('usage: node run.mjs <worktree> <scratch-dir> <out-dir> [--image <img>] [--skip-build]'); process.exit(2); }
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const IMG = opt('--image', 'asc-1807-browser:1');
const skipBuild = args.includes('--skip-build');
const E = path.join(W, 'docs/evidence/1807-design-eval-browser');
const L = `asc.worktree=${W}`;
const docker = (a, o = {}) => spawnSync('docker', a, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...o});
const must = (a) => { const r = docker(a); if (r.status !== 0) throw new Error(`docker ${a.slice(0, 2).join(' ')} failed: ${r.stderr}`); return r; };

for (const d of ['ctx', 'work', 'log', 'home-sim']) fs.mkdirSync(path.join(S, d), {recursive: true});
fs.mkdirSync(OUT, {recursive: true});
if (!skipBuild) {
  fs.copyFileSync(path.join(E, 'env/Dockerfile'), path.join(S, 'ctx/Dockerfile'));
  fs.copyFileSync(path.join(S, 'pkg/playwright-core-1.49.1.tgz'), path.join(S, 'ctx/playwright-core-1.49.1.tgz'));
  const b = docker(['build', '--network', 'none', '--target', 'browser', '--label', L, '-t', IMG, path.join(S, 'ctx')]);
  fs.writeFileSync(path.join(S, 'build.log'), (b.stdout ?? '') + (b.stderr ?? ''));
  if (b.status !== 0) throw new Error('image build failed (see build.log)');
}
const MARK = `marker-${crypto.randomBytes(8).toString('hex')}`;
fs.writeFileSync(path.join(S, 'home-sim', MARK), `${MARK}-token\n`);

const cleanup = () => {
  for (const c of ['asc1807-probe', 'asc1807-proxy', 'asc1807-proxy2', 'asc1807-site']) docker(['rm', '-f', '-v', c]);
  for (const n of ['asc1807-gen', 'asc1807-up']) docker(['network', 'rm', n]);
};
cleanup();
try {
  must(['network', 'create', '--internal', '--label', L, 'asc1807-gen']);
  must(['network', 'create', '--internal', '--label', L, 'asc1807-up']);
  const HARD = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '512m', '--cpus', '1', '--label', L];
  must(['run', '-d', '--name', 'asc1807-site', ...HARD, '--network', 'asc1807-up',
    '--network-alias', 'allowed.test', '--network-alias', 'blocked.test', '--network-alias', 'allowed.test.blocked.test', '--network-alias', 'model-api.test',
    '-v', `${path.join(E, 'isolation')}:/opt/iso:ro`, 'node:22-alpine', 'node', '/opt/iso/dummy-site.mjs']);
  for (const p of ['proxy', 'proxy2']) {
    const cfg = p === 'proxy2' ? 'allowlist.test-private.json' : 'allowlist.test.json';
    must(['run', '-d', '--name', `asc1807-${p}`, ...HARD, '--user', 'node', '--network', 'asc1807-up',
      '-v', `${path.join(E, 'env')}:/opt/env:ro`, '-v', `${path.join(E, 'isolation')}:/opt/iso:ro`, 'node:22-alpine', 'node', '/opt/env/proxy.mjs', `/opt/iso/${cfg}`]);
    must(['network', 'connect', '--alias', p, 'asc1807-gen', `asc1807-${p}`]);
  }
  const SITE_IP = must(['inspect', '-f', '{{(index .NetworkSettings.Networks "asc1807-up").IPAddress}}', 'asc1807-site']).stdout.trim();
  spawnSync('node', ['-e', 'setTimeout(()=>{},2000)']);
  const probe = docker(['run', '--name', 'asc1807-probe', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '512',
    '--memory', '2g', '--cpus', '2', '--shm-size', '512m', '--tmpfs', '/tmp:rw,size=256m', '--user', 'pwuser', '--label', L, '--network', 'asc1807-gen',
    '-v', `${path.join(S, 'work')}:/work`, '-v', `${path.join(E, 'env')}:/opt/env:ro`, '-v', `${path.join(E, 'isolation')}:/opt/iso:ro`,
    '-v', `${path.join(E, 'isolation')}:/config:ro`, '-v', `${path.join(S, 'log')}:/log`,
    '-e', 'HOME=/tmp', '-e', 'PROXY_HOST=proxy', '-e', 'PROXY2_HOST=proxy2', '-e', `SITE_IP=${SITE_IP}`, '-e', `MARKER_NAME=${MARK}`,
    '-e', 'BROWSE_PROXY=http://proxy:3129', '-e', 'ALLOWLIST=/config/allowlist.test.json', '-e', 'ALLOWLIST_CATALOG=/config/allowlist-catalog.test.json',
    '-e', 'WORK_DIR=/work', '-e', 'TOOL_LOG=/log/tools.jsonl', IMG, 'node', '/opt/iso/probe.mjs'], {timeout: 10 * 60 * 1000});
  fs.writeFileSync(path.join(OUT, 'probe.json'), probe.stdout ?? '');
  fs.writeFileSync(path.join(S, 'probe.stderr'), probe.stderr ?? '');
  console.log(`probe exit=${probe.status}`);
  const h = JSON.parse(must(['inspect', 'asc1807-probe', '--format', '{{json .HostConfig}}']).stdout);
  const keys = ['ReadonlyRootfs', 'CapDrop', 'CapAdd', 'SecurityOpt', 'Privileged', 'PidsLimit', 'Memory', 'NanoCpus', 'ShmSize', 'NetworkMode', 'Tmpfs'];
  fs.writeFileSync(path.join(OUT, 'probe-hostconfig.json'), JSON.stringify({...Object.fromEntries(keys.map((k) => [k, h[k] ?? null])),
    bindTargets: (h.Binds ?? []).map((b) => b.split(':')[1])}, null, 1));
  fs.writeFileSync(path.join(OUT, 'networks.txt'), must(['network', 'inspect', 'asc1807-gen', 'asc1807-up', '--format', '{{.Name}} internal={{.Internal}}']).stdout);
  const logs = (c) => { const r = docker(['logs', c]); return (r.stdout ?? '') + (r.stderr ?? ''); };
  const noEvents = (t) => t.split('\n').filter((l) => l && !l.includes('"event"')).map((l) => `${l}\n`).join('');
  fs.writeFileSync(path.join(OUT, 'proxy.jsonl'), noEvents(logs('asc1807-proxy')));
  fs.writeFileSync(path.join(OUT, 'proxy2.jsonl'), noEvents(logs('asc1807-proxy2')));
  fs.writeFileSync(path.join(OUT, 'site.jsonl'), logs('asc1807-site'));
  if (fs.existsSync(path.join(S, 'log/tools.jsonl'))) fs.copyFileSync(path.join(S, 'log/tools.jsonl'), path.join(OUT, 'tools.jsonl'));
  const d = JSON.parse(probe.stdout);
  console.log(`${d.pass ? 'pass' : 'FAIL'} ${d.results.filter((r) => r.pass).length} / ${d.results.length}`);
} finally {
  cleanup();
}
