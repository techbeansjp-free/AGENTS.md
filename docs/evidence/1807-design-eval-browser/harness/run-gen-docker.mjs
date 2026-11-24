// One generation trial in the disposable generator container (#1807). NOT RUN in the preparation phase.
// Usage: node run-gen-docker.mjs <runs-root> <case-id> <A|D|E> <rep> --worktree <abs> --ext <ext-checkout-root>
//          --auth-env-file <file outside the repo> [--model sonnet] [--budget 1.5] [--print]
// Guards (all must hold, otherwise it refuses before creating anything):
//   env ASC1807_ALLOW_PAID=1 (set only after the owner authorises the run phase), env/allowlist.json browse.hosts non-empty,
//   the cumulative Host-computed cost under <runs-root> below the stop line (EVAL_PLAN.md), the auth env file exists.
// --print: print the docker commands instead of running them (no guard on ASC1807_ALLOW_PAID / auth file / cost).
// Layout per trial: networks <p>-gen (--internal: generator + proxy) and <p>-egress (proxy only; the only route out).
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {analyseTrial} from './core-steps.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [runsRoot, caseId, cond, rep] = args;
const printOnly = args.includes('--print');
const worktree = opt('--worktree', null);
const ext = opt('--ext', null);
const auth = opt('--auth-env-file', null);
const model = opt('--model', 'sonnet');
const budget = opt('--budget', '1.5');
const STOP_USD = 36; // EVAL_PLAN.md: no new run once the executed total exceeds this (cap 40)
const IMAGE = 'asc-1807-generator:1';
const PROXY_IMAGE = 'node:22-alpine';

const conds = JSON.parse(fs.readFileSync(path.join(ev, 'conditions.json'), 'utf8'));
const c = conds.conditions[cond]; const k = conds.cases[caseId];
const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
if (!c || !k || !rep || !worktree || !ext) fail('usage: <runs-root> <case> <A|D|E> <rep> --worktree <abs> --ext <dir> --auth-env-file <file>');
const allow = JSON.parse(fs.readFileSync(path.join(ev, 'env', 'allowlist.json'), 'utf8'));
if (!(allow.browse?.hosts?.length > 0)) fail('env/allowlist.json browse.hosts is empty (owner review of env/allowlist.proposed.json pending)');
if (!printOnly) {
  if (process.env.ASC1807_ALLOW_PAID !== '1') fail('ASC1807_ALLOW_PAID is not 1 (run phase not authorised)');
  if (!auth || !fs.existsSync(auth)) fail('--auth-env-file missing');
  let spent = 0;
  if (fs.existsSync(runsRoot)) {
    for (const cs of fs.readdirSync(runsRoot)) for (const t of fs.readdirSync(path.join(runsRoot, cs))) {
      const m = path.join(runsRoot, cs, t, 'meta.json');
      if (fs.existsSync(m)) spent += JSON.parse(fs.readFileSync(m, 'utf8')).costUsd ?? Number(budget);
    }
  }
  if (spent > STOP_USD) fail(`executed total ${spent.toFixed(2)} USD exceeds the stop line ${STOP_USD}`);
}

const dir = path.resolve(runsRoot, caseId, `${cond}-r${rep}`);
const fixture = path.join(dir, 'fixture'); const logDir = path.join(dir, 'log');
const p = `asc1807-${caseId.split('-')[0]}-${cond.toLowerCase()}-r${rep}`;
const label = `asc.worktree=${worktree}`;
const prompt = fs.readFileSync(path.join(ev, 'env', 'gen-prompt.txt'), 'utf8');
const hard = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--label', label];
const cmds = [
  ['network', 'create', '--internal', '--label', label, `${p}-gen`],
  ['network', 'create', '--label', label, `${p}-egress`],
  ['run', '-d', '--name', `${p}-proxy`, ...hard, '--pids-limit', '128', '--memory', '256m', '--cpus', '0.5', '--user', 'node', '--network', `${p}-egress`,
    '-v', `${path.join(ev, 'env')}:/opt/env:ro`, PROXY_IMAGE, 'node', '/opt/env/proxy.mjs', '/opt/env/allowlist.json'],
  ['network', 'connect', '--alias', 'proxy', `${p}-gen`, `${p}-proxy`],
  ['run', '--name', `${p}-gen`, ...hard, '--pids-limit', '512', '--memory', '4g', '--cpus', '2', '--shm-size', '1g', '--tmpfs', '/tmp:rw,size=512m',
    '--user', 'pwuser', '--network', `${p}-gen`, '-w', '/work',
    '-v', `${fixture}:/work`, '-v', `${path.join(ev, 'env')}:/opt/env:ro`, '-v', `${path.join(ev, 'env', 'allowlist.json')}:/config/allowlist.json:ro`, '-v', `${logDir}:/log`,
    '--env-file', auth ?? '<auth-env-file>',
    '-e', 'HOME=/tmp/home', '-e', 'HTTPS_PROXY=http://proxy:3128', '-e', 'HTTP_PROXY=http://proxy:3128', '-e', 'NO_PROXY=',
    '-e', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1', '-e', 'DISABLE_TELEMETRY=1', '-e', 'DISABLE_ERROR_REPORTING=1', '-e', 'DISABLE_AUTOUPDATER=1',
    IMAGE, 'claude', '-p', '--model', model, '--permission-mode', 'acceptEdits', '--setting-sources', 'project',
    '--tools', 'Read,Write,Edit,Glob,Grep,Skill', '--allowedTools', 'mcp__browser__fetch_page,mcp__browser__view_page,mcp__browser__screenshot',
    '--mcp-config', '/opt/env/mcp.json', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--no-session-persistence',
    '--max-budget-usd', budget, '--output-format', 'stream-json', '--verbose', prompt],
];
const cleanup = [['rm', '-f', '-v', `${p}-gen`, `${p}-proxy`], ['network', 'rm', `${p}-gen`, `${p}-egress`]];
if (printOnly) {
  for (const a of [...cmds, ['logs', `${p}-proxy`], ...cleanup]) console.log(['docker', ...a].map((x) => (/[\s"{}]/.test(x) ? JSON.stringify(x) : x)).join(' '));
  process.exit(0);
}

if (fs.existsSync(dir)) fail(`exists: ${dir}`);
fs.mkdirSync(path.join(logDir, 'shots'), {recursive: true});
fs.cpSync(path.resolve(ev, k.from), fixture, {recursive: true});
fs.copyFileSync(path.join(ev, 'cases', 'FONTS.md'), path.join(fixture, 'FONTS.md'));
const skills = path.join(fixture, '.claude', 'skills');
fs.mkdirSync(skills, {recursive: true});
for (const name of fs.readdirSync(path.join(worktree, 'skills'))) {
  const src = path.join(worktree, 'skills', name);
  if (fs.statSync(src).isDirectory()) fs.cpSync(src, path.join(skills, name), {recursive: true});
}
for (const s of c.skills) fs.cpSync(path.join(ext, s.from), path.join(skills, s.name), {recursive: true, filter: (q) => !q.split(path.sep).includes('.git')});

const docker = (a, o = {}) => spawnSync('docker', a, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...o});
const t0 = Date.now();
let r = null;
try {
  for (const a of cmds.slice(0, -1)) { const x = docker(a); if (x.status !== 0) throw new Error(`docker ${a[0]} failed: ${x.stderr}`); }
  r = docker(cmds.at(-1), {timeout: 25 * 60 * 1000, input: ''});
} finally {
  const logs = docker(['logs', `${p}-proxy`]);
  fs.writeFileSync(path.join(dir, 'proxy.jsonl'), logs.stdout ?? '');
  for (const a of cleanup) docker(a);
}
const stream = r?.stdout ?? '';
fs.writeFileSync(path.join(dir, 'stream.jsonl'), stream);
fs.writeFileSync(path.join(dir, 'stderr.txt'), r?.stderr ?? '');
const events = stream.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
const result = events.findLast((e) => e.type === 'result') ?? {};
const core = analyseTrial(stream, {narrow: k.narrow, wide: k.wide, proxyLog: fs.readFileSync(path.join(dir, 'proxy.jsonl'), 'utf8')});
fs.writeFileSync(path.join(dir, 'core-steps.json'), JSON.stringify({case: caseId, condition: cond, rep: Number(rep), ...core}, null, 1));
const meta = {schema: 'asc-1807-gen/v1', case: caseId, condition: cond, rep: Number(rep), model, budget: Number(budget), exit: r?.status ?? null,
  signal: r?.signal ?? null, wallMs: Date.now() - t0, resultSubtype: result.subtype ?? null, isError: result.is_error ?? null,
  costUsd: result.total_cost_usd ?? null, numTurns: result.num_turns ?? null, permissionDenials: result.permission_denials ?? null, coreSteps: core.coreSteps};
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta));
