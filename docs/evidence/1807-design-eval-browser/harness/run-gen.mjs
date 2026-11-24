// One generation trial (#1807).
// Usage: node run-gen.mjs <runs-root> <case-id> <A|D|E> <rep> --worktree <abs> --ext <ext-checkout-root>
//          [--model sonnet] [--budget 1.5] [--prompt <file>] [--print]
// Layout (README「生成環境」):
//   - The generator CLI (Claude Code, `claude -p`) runs on the host with cwd = a fresh fixture, built-in tools limited to
//     Read,Write,Edit,Glob,Grep,Skill (no Bash/Web), project settings only, hooks off. Its credential stays in the host's
//     own store and never enters a container. Out-of-fixture reads/writes are refused by the CLI (checked before the run).
//   - Its only other tools are the MCP server `browser` (fetch_page / view_page / screenshot), started by the CLI as a
//     disposable container (`docker run -i --rm`, read-only root, cap-drop ALL, fixture mounted read-only) attached only to
//     an --internal network. The only route out of that network is the allowlist proxy (a second container), which logs
//     every decision.
// Guards: env ASC1807_ALLOW_PAID=1, env/allowlist.json browse.hosts non-empty, executed total (meta.json costUsd under
// <runs-root>) not above the stop line. --print prints the docker commands and the MCP config only.
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
const model = opt('--model', 'sonnet');
const budget = opt('--budget', '1.5');
const promptFile = opt('--prompt', path.join(ev, 'env', 'gen-prompt.txt'));
const STOP_USD = 36; // EVAL_PLAN.md: no new run once the executed total exceeds this (cap 40)
const IMAGE = 'asc-1807-tools:1';
const PROXY_IMAGE = 'node:22-alpine';

const conds = JSON.parse(fs.readFileSync(path.join(ev, 'conditions.json'), 'utf8'));
const c = conds.conditions[cond]; const k = conds.cases[caseId];
const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
if (!c || !k || !rep || !worktree || !ext) fail('usage: <runs-root> <case> <A|D|E> <rep> --worktree <abs> --ext <dir>');
const allowPath = path.join(ev, 'env', 'allowlist.json');
const allow = JSON.parse(fs.readFileSync(allowPath, 'utf8'));
if (!(allow.browse?.hosts?.length > 0)) fail('env/allowlist.json browse.hosts is empty');
export function spentUsd(root) {
  let spent = 0;
  if (!fs.existsSync(root)) return 0;
  for (const cs of fs.readdirSync(root)) {
    const cdir = path.join(root, cs);
    if (!fs.statSync(cdir).isDirectory()) continue;
    for (const t of fs.readdirSync(cdir)) {
      const m = path.join(cdir, t, 'meta.json');
      if (fs.existsSync(m)) { const x = JSON.parse(fs.readFileSync(m, 'utf8')); spent += x.costUsd ?? x.budget ?? 0; }
    }
  }
  return spent;
}
if (!printOnly) {
  if (process.env.ASC1807_ALLOW_PAID !== '1') fail('ASC1807_ALLOW_PAID is not 1 (run phase not authorised)');
  const spent = spentUsd(runsRoot) + Number(process.env.ASC1807_OTHER_SPENT ?? 0);
  if (spent > STOP_USD) fail(`executed total ${spent.toFixed(2)} USD exceeds the stop line ${STOP_USD}`);
}

const dir = path.resolve(runsRoot, caseId, `${cond}-r${rep}`);
const fixture = path.join(dir, 'fixture'); const logDir = path.join(dir, 'log');
const p = `asc1807-${caseId.split('-')[0]}-${cond.toLowerCase()}-r${rep}`;
const label = `asc.worktree=${worktree}`;
const hard = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--label', label];
const setup = [
  ['network', 'create', '--internal', '--label', label, `${p}-gen`],
  ['network', 'create', '--label', label, `${p}-egress`],
  ['run', '-d', '--name', `${p}-proxy`, ...hard, '--pids-limit', '128', '--memory', '256m', '--cpus', '0.5', '--user', 'node', '--network', `${p}-egress`,
    '-v', `${path.join(ev, 'env')}:/opt/env:ro`, PROXY_IMAGE, 'node', '/opt/env/proxy.mjs', '/opt/env/allowlist.json'],
  ['network', 'connect', '--alias', 'proxy', `${p}-gen`, `${p}-proxy`],
];
const mcpArgs = ['run', '-i', '--rm', '--name', `${p}-mcp`, ...hard, '--pids-limit', '512', '--memory', '3g', '--cpus', '2', '--shm-size', '1g',
  '--tmpfs', '/tmp:rw,size=512m', '--user', 'pwuser', '--network', `${p}-gen`,
  '-v', `${fixture}:/work:ro`, '-v', `${path.join(ev, 'env')}:/opt/env:ro`, '-v', `${allowPath}:/config/allowlist.json:ro`, '-v', `${logDir}:/log`,
  '-e', 'HOME=/tmp', '-e', 'BROWSE_PROXY=http://proxy:3129', '-e', 'ALLOWLIST=/config/allowlist.json', '-e', 'WORK_DIR=/work',
  '-e', 'TOOL_LOG=/log/tools.jsonl', '-e', 'SHOT_DIR=/log/shots', IMAGE, 'node', '/opt/env/mcp-server.mjs'];
const mcpConfig = {mcpServers: {browser: {type: 'stdio', command: 'docker', args: mcpArgs}}};
const cleanup = [['rm', '-f', '-v', `${p}-mcp`, `${p}-proxy`], ['network', 'rm', `${p}-gen`, `${p}-egress`]];
const flags = ['-p', '--model', model, '--permission-mode', 'acceptEdits', '--setting-sources', 'project',
  '--tools', 'Read,Write,Edit,Glob,Grep,Skill', '--allowedTools', 'mcp__browser__fetch_page,mcp__browser__view_page,mcp__browser__screenshot',
  '--mcp-config', path.join(dir, 'mcp.json'), '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--no-session-persistence',
  '--max-budget-usd', budget, '--output-format', 'stream-json', '--verbose'];
if (printOnly) {
  for (const a of setup) console.log(['docker', ...a].join(' '));
  console.log(JSON.stringify(mcpConfig));
  console.log(['claude', ...flags, '<prompt>'].join(' '));
  for (const a of cleanup) console.log(['docker', ...a].join(' '));
  process.exit(0);
}

if (fs.existsSync(dir)) fail(`exists: ${dir}`);
fs.mkdirSync(path.join(logDir, 'shots'), {recursive: true});
fs.cpSync(path.resolve(ev, k.from), fixture, {recursive: true});
fs.copyFileSync(path.join(ev, 'cases', 'FONTS.md'), path.join(fixture, 'FONTS.md'));
fs.mkdirSync(path.join(fixture, 'out'), {recursive: true});
const skills = path.join(fixture, '.claude', 'skills');
fs.mkdirSync(skills, {recursive: true});
for (const name of fs.readdirSync(path.join(worktree, 'skills'))) {
  const src = path.join(worktree, 'skills', name);
  if (fs.statSync(src).isDirectory()) fs.cpSync(src, path.join(skills, name), {recursive: true});
}
for (const s of c.skills) fs.cpSync(path.join(ext, s.from), path.join(skills, s.name), {recursive: true, filter: (q) => !q.split(path.sep).includes('.git')});
fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify(mcpConfig));

const docker = (a, o = {}) => spawnSync('docker', a, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...o});
const prompt = fs.readFileSync(promptFile, 'utf8');
const t0 = Date.now();
let r = null; let setupError = null;
try {
  for (const a of setup) { const x = docker(a); if (x.status !== 0) throw new Error(`docker ${a.slice(0, 2).join(' ')} failed: ${x.stderr}`); }
  r = spawnSync('claude', [...flags, prompt], {cwd: fixture, input: '', encoding: 'utf8', timeout: 25 * 60 * 1000, maxBuffer: 256 * 1024 * 1024,
    env: {...process.env, ANTHROPIC_API_KEY: undefined}});
} catch (e) {
  setupError = e.message;
} finally {
  const logs = docker(['logs', `${p}-proxy`]);
  fs.writeFileSync(path.join(dir, 'proxy.jsonl'), logs.stdout ?? '');
  for (const a of cleanup) docker(a);
}
const stream = r?.stdout ?? '';
fs.writeFileSync(path.join(dir, 'stream.jsonl'), stream);
fs.writeFileSync(path.join(dir, 'stderr.txt'), (r?.stderr ?? '') + (setupError ? `\nsetup: ${setupError}` : ''));
const events = stream.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? {};
const result = events.findLast((e) => e.type === 'result') ?? {};
const toolUses = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((x) => x.type === 'tool_use'));
const count = {}; for (const t of toolUses) count[t.name] = (count[t.name] ?? 0) + 1;
const core = analyseTrial(stream, {narrow: k.narrow ?? 390, wide: k.wide ?? 1440, proxyLog: fs.readFileSync(path.join(dir, 'proxy.jsonl'), 'utf8')});
fs.writeFileSync(path.join(dir, 'core-steps.json'), JSON.stringify({case: caseId, condition: cond, rep: Number(rep), ...core}, null, 1));
const meta = {schema: 'asc-1807-gen/v1', case: caseId, condition: cond, rep: Number(rep), model, budget: Number(budget), exit: r?.status ?? null,
  signal: r?.signal ?? null, spawnError: r?.error?.message ?? setupError, wallMs: Date.now() - t0,
  initModel: init.model ?? null, initTools: init.tools ?? null, mcpServers: init.mcp_servers ?? null, initSkills: init.skills ?? null,
  resultSubtype: result.subtype ?? null, isError: result.is_error ?? null, costUsd: result.total_cost_usd ?? null, durationMs: result.duration_ms ?? null,
  numTurns: result.num_turns ?? null, usage: result.usage ?? null, permissionDenials: result.permission_denials ?? null, toolCounts: count,
  skillCalls: toolUses.filter((t) => t.name === 'Skill').map((t) => t.input?.skill ?? t.input?.command ?? null),
  skillFileReads: toolUses.filter((t) => t.name === 'Read').map((t) => path.relative(fixture, t.input?.file_path ?? '')).filter((q) => q.startsWith('.claude/skills/')),
  coreSteps: core.coreSteps, finalText: typeof result.result === 'string' ? result.result.slice(0, 2000) : null};
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(JSON.stringify({case: caseId, cond, rep, exit: meta.exit, subtype: meta.resultSubtype, cost: meta.costUsd, core: core.coreSteps,
  fetch: core.toolCalls.fetch_page.ok, view: core.toolCalls.view_page.ok, shots: core.toolCalls.screenshot.ok, files: core.renderedFiles.length, wallMs: meta.wallMs}));
