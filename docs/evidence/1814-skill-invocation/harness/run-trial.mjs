// One #1814 trial: a fresh copy of the sample project (make-fixture.mjs: ASC installed from the release tarball), one
// condition, one prompt, `claude -p` with the project as cwd. Case id `probe` runs the isolation probe (probe-check.mjs).
// Default is a dry run that prepares nothing and prints the plan. A model call happens only with --run AND env
// ASC1814_ALLOW_PAID=1 AND a credential in the environment AND the executed total + this trial's budget under --stop-usd.
//
// Isolation (EVAL_PLAN.md「実行環境」):
// - The trial directory must be outside this repository and the real HOME, with no ancestor CLAUDE.md/AGENTS.md/.claude/
//   .git (guard.mjs), so Claude Code's upward CLAUDE.md discovery finds only the sample project's own file.
// - HOME and CLAUDE_CONFIG_DIR are new empty directories per trial: no user settings, CLAUDE.md, memory, Skills, plugins
//   or hooks; only Claude Code's bundled Skills remain. Default setting sources (as a user has); user/local are empty.
// - The credential comes only from CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in the parent environment and is passed
//   to the child process environment only. It is never written to a file; meta.json records only which kind was used.
// - Built-in tools Read, Glob, Grep, Skill only (no Bash, Write, Edit, Web, Agent), no MCP servers.
//
// Usage: node run-trial.mjs <runs-root> <condition> <case-id|probe> <rep> --fixture <sample-project> --model <id>
//          [--budget 0.6] [--stop-usd <n>] [--home-marker <file>] [--repo-marker <file>] [--run]
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyCondition, loadConditions} from './apply-condition.mjs';
import {assertPlacement} from './guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
const repoRoot = path.resolve(ev, '../../..');
export const TOOLS = 'Read,Glob,Grep,Skill';
export const DISALLOWED = 'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Agent,Task';

export function flags({model, budget, debugFile = null}) {
  return ['--model', model, '--tools', TOOLS, '--disallowedTools', DISALLOWED, '--strict-mcp-config', '--no-session-persistence',
    '--max-budget-usd', String(budget), '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    ...(debugFile ? ['--debug-file', debugFile] : [])];
}

// Sum of the Host-computed cost (total_cost_usd) of every trial under the runs root; a trial without a result counts
// its budget, so an unknown spend is never counted as zero.
export function spentUsd(root) {
  let spent = 0;
  if (!fs.existsSync(root)) return 0;
  for (const name of fs.readdirSync(root)) {
    const m = path.join(root, name, 'meta.json');
    if (fs.existsSync(m)) { const x = JSON.parse(fs.readFileSync(m, 'utf8')); spent += x.costUsd ?? x.budget ?? 0; }
  }
  return spent;
}

// The probe asks for what only the session context can tell, and tries reads that must be refused. probe-check.mjs
// judges it from the tool records, the init event, the debug log and the known texts, not from the model's claims alone.
export function probePrompt(homeMarker, repoMarker) {
  return ['これは評価環境の確認です。作業はしないでください。toolは下の4と5だけを使い、次の順に答えてください。',
    '1. このsessionのContextに含まれている指示ファイル・memory（CLAUDE.md、AGENTS.md、memoryの索引、SessionStart等で追加された文脈を含む）をすべて挙げ、それぞれの出所と最初の1行を原文のまま書いてください。無ければ「なし」と書いてください。',
    '2. 使えるSkillの一覧を、名前とdescriptionの原文のまま、すべて書いてください（fileを読まずに、Contextにある一覧から）。',
    '3. 2のうち、名前が asc と user-journey-acceptance のSkillのdescriptionを、それぞれ「DESC asc: <原文>」「DESC user-journey-acceptance: <原文>」の形で1行ずつ書いてください。',
    `4. Readで ${homeMarker} を読む。`, `5. Readで ${repoMarker} を読む。`,
    '6. 4と5の結果（読めたか、拒否されたか）を1行ずつ書いてください。'].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const [runsRootArg, cond, caseId, rep] = args;
  const fixtureArg = opt('--fixture', null), model = opt('--model', null), budget = Number(opt('--budget', '0.6'));
  const stopUsd = opt('--stop-usd', null), wantRun = args.includes('--run');
  const homeMarker = opt('--home-marker', null), repoMarker = opt('--repo-marker', null);
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
  if (!runsRootArg || !cond || !caseId || !rep || !fixtureArg || !model) fail('usage: <runs-root> <cond> <case|probe> <rep> --fixture <dir> --model <id> [--budget n] [--stop-usd n] [--run]');
  if (!loadConditions().conditions[cond]) fail(`unknown condition ${cond}`);
  const spec = JSON.parse(fs.readFileSync(path.join(ev, 'cases.json'), 'utf8'));
  const probe = caseId === 'probe';
  const k = probe ? {id: 'probe'} : spec.cases.find((c) => c.id === caseId);
  if (!k) fail(`unknown case ${caseId}`);
  if (probe && (!homeMarker || !repoMarker)) fail('probe needs --home-marker and --repo-marker');
  const runsRoot = path.resolve(runsRootArg), fixture = path.resolve(fixtureArg);
  const name = `${cond}-${caseId}-${rep}`, dir = path.join(runsRoot, name);
  const work = path.join(dir, 'work'), home = path.join(dir, 'home'), config = path.join(dir, 'config');
  const debugFile = probe ? path.join(dir, 'debug.log') : null;
  const prompt = probe ? probePrompt(homeMarker, repoMarker) : k.prompt;
  const plan = {trial: name, condition: cond, case: caseId, model, budgetUsd: budget, cwd: 'work/', home: 'home/', configDir: 'config/',
    command: ['claude', '-p', '<prompt>', ...flags({model, budget, debugFile: debugFile && 'debug.log'})].join(' ')};
  try { assertPlacement(work, {repoRoot}); } catch (e) { fail(e.message); }
  if (!wantRun) { console.log(JSON.stringify({dryRun: true, ...plan})); return; }

  if (process.env.ASC1814_ALLOW_PAID !== '1') fail('ASC1814_ALLOW_PAID is not 1 (measurement not authorised)');
  if (!stopUsd) fail('--stop-usd is required for a run');
  const credential = process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'CLAUDE_CODE_OAUTH_TOKEN' : process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : null;
  if (!credential) fail('no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in the environment');
  const spent = spentUsd(runsRoot);
  if (spent + budget > Number(stopUsd)) fail(`executed total ${spent.toFixed(2)} + this trial's budget ${budget} would exceed the stop line ${stopUsd}`);
  if (fs.existsSync(dir)) fail(`exists: ${dir}`);

  fs.mkdirSync(home, {recursive: true}); fs.mkdirSync(config, {recursive: true});
  fs.cpSync(fixture, work, {recursive: true});
  const applied = applyCondition(work, cond);
  // Onboarding done and the sample project trusted, in the disposable config only.
  const global = JSON.stringify({hasCompletedOnboarding: true, numStartups: 5, projects: {[fs.realpathSync(work)]: {hasTrustDialogAccepted: true}}});
  fs.writeFileSync(path.join(config, '.claude.json'), global); fs.writeFileSync(path.join(home, '.claude.json'), global);
  const hookLog = path.join(dir, 'hook.jsonl');
  // Only what the CLI needs; nothing else from the parent environment (no base URL, proxy or Claude Code settings).
  const env = {PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: config, LANG: 'C.UTF-8', [credential]: process.env[credential],
    ASC1814_HOOK_LOG: hookLog, DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'};
  const version = spawnSync('claude', ['--version'], {env, encoding: 'utf8'}).stdout?.trim() ?? null;
  const t0 = Date.now();
  const r = spawnSync('claude', ['-p', prompt, ...flags({model, budget, debugFile})], {cwd: work, env, input: '', encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 256 * 1024 * 1024});
  const secret = process.env[credential];
  const scrub = (s) => (s ?? '').split(secret).join('<credential>');
  const stream = scrub(r.stdout);
  fs.writeFileSync(path.join(dir, 'trace.jsonl'), stream);
  fs.writeFileSync(path.join(dir, 'stderr.txt'), scrub(r.stderr));
  if (debugFile && fs.existsSync(debugFile)) fs.writeFileSync(debugFile, scrub(fs.readFileSync(debugFile, 'utf8')));
  const last = stream.trim().split('\n').reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.type === 'result') ?? null;
  const meta = {...plan, claudeVersion: version, applied, credentialKind: credential, exit: r.status, signal: r.signal, error: r.error ? String(r.error) : null,
    wallMs: Date.now() - t0, costUsd: last?.total_cost_usd ?? null, budget};
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(JSON.stringify({trial: name, exit: r.status, costUsd: meta.costUsd}));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
