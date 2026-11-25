// One #1815 generation trial: #1807's generation environment with #1814's user-equivalent installation and isolation.
// Default is a dry run that prepares nothing and prints the plan (docker and claude commands). A model call happens only
// with --run AND env ASC1815_ALLOW_PAID=1 AND CLAUDE_CODE_OAUTH_TOKEN in the environment AND the fixed files equal the
// last record of results/fixation.json (committed, named in README.md) AND the ledger recorded there AND ledger total +
// perTrialUsd <= capUsd - safetyMarginUsd (conditions.json; no --budget/--model/--stop-usd arguments).
//
// Pairing (release.json): the sha256 of --tarball must be the one pinned for the condition; a tarball pinned for the
// other condition or not pinned at all is refused, also in a dry run. After the install the two reference files must
// have the condition's pinned hashes and CLAUDE.md must carry the adopted read-trigger block (pairing.mjs).
//
// Per trial (layout <runs-root>/<case>/<cond>-r<rep>/, the names #1807 run-render.mjs reads):
//   fixture/      the sample project, built new for this trial (make-sample.mjs: case files + FONTS.md + Git + ASC from
//                 the tarball with the read trigger adopted). It is the CLI's cwd. Outside this repository and the real
//                 HOME, with no ancestor CLAUDE.md/AGENTS.md/.claude/.agents/.codex/.git (#1814 guard.mjs).
//   home/ config/ new empty HOME and CLAUDE_CONFIG_DIR (#1814): no user settings, CLAUDE.md, memory, Skills, plugins or
//                 hooks; deleted after the trial and searched for the credential first (count only).
//   log/          the MCP tool log and screenshots (#1807 mcp-server.mjs), outside the fixture.
//   install.json, mcp.json, trace.jsonl, stderr.txt, proxy.jsonl, core-steps.json, reads.json, meta.json.
// Generator (#1807): `claude -p` on the host, built-in tools Read,Write,Edit,Glob,Grep,Skill, permission mode
// acceptEdits, the MCP server `browser` (fetch_page / view_page / screenshot) started by the CLI as a disposable container
// on an --internal network whose only route out is the allowlist proxy container. Same prompt (#1807 env/gen-prompt.txt)
// in both conditions. Default setting sources as a user has them (#1814; user/local are empty), hooks not disabled.
// Credential: only CLAUDE_CODE_OAUTH_TOKEN from the parent environment (CLAUDE_CODE_OAUTH_TOKEN="$(cat <owner file>)").
// The harness never reads a token file, never prints the value, passes it to the CLI's environment only and replaces it
// in trace/stderr. The CLI's environment has no other variable from the parent except PATH and a DOCKER_HOST resolved
// from the parent's docker context (the empty HOME has no docker context).
// Usage: node run-trial.mjs <runs-root> <case-id> <B|S> <rep> --tarball <tgz> [--ledger <file>] [--run]
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {analyseTrial} from '../../1807-design-eval-browser/harness/core-steps.mjs';
import {assertPlacement} from '../../1814-skill-invocation/harness/guard.mjs';
import * as ledgerOps from '../../1814-skill-invocation/harness/ledger.mjs';
import {makeSample} from './make-sample.mjs';
import {ev, evidenceRoot, loadJson, fileSha256, tarballProblems, installedProblems} from './pairing.mjs';
import {readRecord} from './reads.mjs';
import {paidStepProblems, lastRecord} from './fixation.mjs';

const repoRoot = path.resolve(ev, '../../..');
const e1807 = path.join(evidenceRoot, '1807-design-eval-browser');
export const IMAGE = 'asc-1807-tools:1';
export const PROXY_IMAGE = 'node:22-alpine';
export const LABEL = 'asc.evidence=1815';
export const TOOLS = 'Read,Write,Edit,Glob,Grep,Skill';
export const DISALLOWED = 'Bash,NotebookEdit,WebFetch,WebSearch,Agent,Task';
export const MCP_TOOLS = ['mcp__browser__fetch_page', 'mcp__browser__view_page', 'mcp__browser__screenshot'];
export const EXPECTED_INIT_TOOLS = [...TOOLS.split(','), ...MCP_TOOLS].sort();
export const TIMEOUT_MS = 25 * 60 * 1000;

export const trialDir = (runsRoot, caseId, cond, rep) => path.join(path.resolve(runsRoot), caseId, `${cond}-r${rep}`);
export const prefixOf = (caseId, cond, rep) => `asc1815-${caseId.split('-')[0]}-${cond.toLowerCase()}-r${rep}`;

// The docker commands of #1807 run-gen.mjs, with the #1815 label and --pull never (no image is fetched during a trial).
export function dockerPlan({prefix, fixture, logDir}) {
  const env = path.join(e1807, 'env');
  const allowPath = path.join(env, 'allowlist.json');
  const hard = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--label', LABEL, '--pull', 'never'];
  const setup = [
    ['network', 'create', '--internal', '--label', LABEL, `${prefix}-gen`],
    ['network', 'create', '--label', LABEL, `${prefix}-egress`],
    ['run', '-d', '--name', `${prefix}-proxy`, ...hard, '--pids-limit', '128', '--memory', '256m', '--cpus', '0.5', '--user', 'node', '--network', `${prefix}-egress`,
      '-v', `${env}:/opt/env:ro`, PROXY_IMAGE, 'node', '/opt/env/proxy.mjs', '/opt/env/allowlist.json'],
    ['network', 'connect', '--alias', 'proxy', `${prefix}-gen`, `${prefix}-proxy`],
  ];
  const mcpArgs = ['run', '-i', '--rm', '--name', `${prefix}-mcp`, ...hard, '--pids-limit', '512', '--memory', '3g', '--cpus', '2', '--shm-size', '1g',
    '--tmpfs', '/tmp:rw,size=512m', '--user', 'pwuser', '--network', `${prefix}-gen`,
    '-v', `${fixture}:/work:ro`, '-v', `${env}:/opt/env:ro`, '-v', `${allowPath}:/config/allowlist.json:ro`, '-v', `${path.join(env, 'allowlist-catalog.json')}:/config/allowlist-catalog.json:ro`, '-v', `${logDir}:/log`,
    '-e', 'HOME=/tmp', '-e', 'BROWSE_PROXY=http://proxy:3129', '-e', 'ALLOWLIST=/config/allowlist.json', '-e', 'ALLOWLIST_CATALOG=/config/allowlist-catalog.json', '-e', 'WORK_DIR=/work',
    '-e', 'TOOL_LOG=/log/tools.jsonl', '-e', 'SHOT_DIR=/log/shots', IMAGE, 'node', '/opt/env/mcp-server.mjs'];
  const cleanup = [['rm', '-f', '-v', `${prefix}-mcp`, `${prefix}-proxy`], ['network', 'rm', `${prefix}-gen`, `${prefix}-egress`]];
  return {setup, mcpConfig: {mcpServers: {browser: {type: 'stdio', command: 'docker', args: mcpArgs}}}, cleanup};
}

export function claudeArgs({prompt, model, budget, mcpConfigPath}) {
  return ['-p', prompt, '--model', model, '--permission-mode', 'acceptEdits', '--tools', TOOLS, '--disallowedTools', DISALLOWED,
    '--allowedTools', MCP_TOOLS.join(','), '--mcp-config', mcpConfigPath, '--strict-mcp-config', '--no-session-persistence',
    '--max-budget-usd', String(budget), '--output-format', 'stream-json', '--verbose', '--include-hook-events'];
}

// Only what the CLI (and the docker CLI it starts for the MCP server) needs.
export function childEnv({home, config, token, dockerHost}) {
  const env = {PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: config, LANG: 'C.UTF-8', CLAUDE_CODE_OAUTH_TOKEN: token,
    DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'};
  if (dockerHost) env.DOCKER_HOST = dockerHost;
  return env;
}

export function resolveDockerHost() {
  if (process.env.DOCKER_HOST) return process.env.DOCKER_HOST;
  const r = spawnSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {encoding: 'utf8'});
  return r.status === 0 ? r.stdout.trim() : null;
}

// The session received the condition: the expected tools only and the browser MCP server connected.
export function initProblems(init) {
  if (!init) return ['no init event'];
  const p = [];
  const tools = [...(init.tools ?? [])].sort();
  if (JSON.stringify(tools) !== JSON.stringify(EXPECTED_INIT_TOOLS)) p.push(`tools ${tools.join(',')} != expected`);
  const b = (init.mcp_servers ?? []).find((s) => s.name === 'browser');
  if (b?.status !== 'connected') p.push(`browser MCP server ${b?.status ?? 'missing'}`);
  return p;
}

// Copied from #1814 run-trial.mjs (that module reads #1814's conditions at import).
export function filesContaining(dir, secret) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, {withFileTypes: true}) : []) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile() && fs.statSync(f).size < 16 * 1024 * 1024 && fs.readFileSync(f).includes(secret)) n += 1;
    }
  };
  if (secret) walk(dir);
  return n;
}

export const scrub = (s, secret) => (secret ? String(s ?? '').split(secret).join('<credential>') : String(s ?? ''));

export function plan(runsRoot, caseId, cond, rep) {
  const conds = loadJson('conditions.json');
  const dir = trialDir(runsRoot, caseId, cond, rep);
  const fixture = path.join(dir, 'fixture'), logDir = path.join(dir, 'log');
  const prefix = prefixOf(caseId, cond, rep);
  const d = dockerPlan({prefix, fixture, logDir});
  const prompt = fs.readFileSync(path.join(evidenceRoot, conds.prompt), 'utf8');
  return {dir, fixture, logDir, prefix, prompt, docker: d, model: conds.model, budget: conds.budget.perTrialUsd,
    claude: claudeArgs({prompt: '<prompt>', model: conds.model, budget: conds.budget.perTrialUsd, mcpConfigPath: path.join(dir, 'mcp.json')})};
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
  for (const k of ['--model', '--budget', '--stop-usd', '--prompt']) if (args.includes(k)) fail(`${k} is fixed in conditions.json and is not accepted`);
  const [runsRoot, caseId, cond, rep] = args;
  const tarballArg = opt('--tarball', null), ledgerArg = opt('--ledger', null), wantRun = args.includes('--run');
  if (!runsRoot || !caseId || !cond || !/^[1-9]\d*$/.test(rep ?? '') || !tarballArg) fail('usage: <runs-root> <case> <B|S> <rep> --tarball <tgz> [--ledger f] [--run]');
  const conds = loadJson('conditions.json'), release = loadJson('release.json'), cases = loadJson('cases.json');
  const k = cases.cases[caseId];
  if (!k) fail(`unknown case ${caseId}`);
  if (!conds.conditions[cond]) fail(`unknown condition ${cond}`);
  const tarball = path.resolve(tarballArg);
  if (!fs.existsSync(tarball)) fail('tarball does not exist');
  const digest = fileSha256(tarball);
  const pair = tarballProblems(release, conds, cond, digest);
  if (pair.length) fail(pair.join('; '));
  const p = plan(runsRoot, caseId, cond, rep);
  try { assertPlacement(p.fixture, {repoRoot}); } catch (e) { fail(e.message); }
  const name = `${caseId}/${cond}-r${rep}`;
  if (!wantRun) {
    console.log(JSON.stringify({dryRun: true, trial: name, tarballSha256: digest, model: p.model, budgetUsd: p.budget,
      docker: p.docker.setup.map((a) => ['docker', ...a].join(' ')), mcpConfig: p.docker.mcpConfig, claude: ['claude', ...p.claude].join(' '),
      cleanup: p.docker.cleanup.map((a) => ['docker', ...a].join(' '))}, null, 1));
    return;
  }

  if (process.env.ASC1815_ALLOW_PAID !== '1') fail('ASC1815_ALLOW_PAID is not 1 (measurement not authorised)');
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) fail('no CLAUDE_CODE_OAUTH_TOKEN in the environment');
  if (!ledgerArg) fail('--ledger is required for a run');
  const ledger = path.resolve(ledgerArg);
  try { assertPlacement(ledger, {repoRoot}); } catch (e) { fail(`ledger: ${e.message}`); }
  const fixProblems = paidStepProblems(ledger);
  if (fixProblems.length) fail(fixProblems.join('; '));
  const fx = JSON.parse(fs.readFileSync(path.join(ev, 'results/fixation.json'), 'utf8'));
  if (fs.existsSync(p.dir)) fail(`exists: ${p.dir}`);
  for (const img of [IMAGE, PROXY_IMAGE]) if (spawnSync('docker', ['image', 'inspect', img], {encoding: 'utf8'}).status !== 0) fail(`docker image ${img} is not present locally`);
  const dockerHost = resolveDockerHost();
  if (!dockerHost) fail('docker host could not be resolved from the docker context');
  const {budget: B} = conds;
  let unlock;
  try { unlock = ledgerOps.lock(ledger); } catch (e) { fail(e.message); }
  const home = path.join(p.dir, 'home'), config = path.join(p.dir, 'config');
  try {
    const spent = ledgerOps.spent(ledger);
    if (spent + B.perTrialUsd > B.capUsd - B.safetyMarginUsd) { unlock(); fail(`ledger total ${spent.toFixed(2)} + ${B.perTrialUsd} would exceed ${B.capUsd} - ${B.safetyMarginUsd}`); }
    if (ledgerOps.reservedNames(ledger).has(name)) { unlock(); fail(`trial ${name} is already in the ledger; a rerun needs a new rep number`); }
    fs.mkdirSync(path.join(p.logDir, 'shots'), {recursive: true});
    const tmp = path.join(p.dir, 'tmp'); fs.mkdirSync(tmp);
    let sample;
    try { sample = makeSample(caseId, tarball, digest, p.fixture, tmp, {adopt: conds.adopt}); } catch (e) { fs.rmSync(p.dir, {recursive: true, force: true}); unlock(); fail(`sample: ${e.message}`); }
    fs.rmSync(tmp, {recursive: true, force: true});
    const inst = installedProblems(release, cond, p.fixture);
    if (sample.status) inst.push('sample project is not clean after the install');
    if (inst.length) { fs.rmSync(p.dir, {recursive: true, force: true}); unlock(); fail(inst.join('; ')); }
    fs.writeFileSync(path.join(p.dir, 'install.json'), JSON.stringify(sample, null, 1));
    const reservation = ledgerOps.reserve(ledger, name, B.perTrialUsd);
    fs.mkdirSync(home); fs.mkdirSync(config);
    const global = JSON.stringify({hasCompletedOnboarding: true, numStartups: 5, projects: {[fs.realpathSync(p.fixture)]: {hasTrustDialogAccepted: true}}});
    fs.writeFileSync(path.join(config, '.claude.json'), global); fs.writeFileSync(path.join(home, '.claude.json'), global);
    fs.writeFileSync(path.join(p.dir, 'mcp.json'), JSON.stringify(p.docker.mcpConfig));
    const env = childEnv({home, config, token, dockerHost});
    const docker = (a) => spawnSync('docker', a, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
    const version = spawnSync('claude', ['--version'], {env, encoding: 'utf8'}).stdout?.trim() ?? null;
    const t0 = Date.now();
    let r = null, setupError = null;
    try {
      for (const a of p.docker.setup) { const x = docker(a); if (x.status !== 0) throw new Error(`docker ${a.slice(0, 2).join(' ')} failed: ${x.stderr}`); }
      r = spawnSync('claude', claudeArgs({prompt: p.prompt, model: p.model, budget: p.budget, mcpConfigPath: path.join(p.dir, 'mcp.json')}),
        {cwd: p.fixture, env, input: '', encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024});
    } catch (e) {
      setupError = e.message;
    } finally {
      fs.writeFileSync(path.join(p.dir, 'proxy.jsonl'), scrub(docker(['logs', `${p.prefix}-proxy`]).stdout, token));
      for (const a of p.docker.cleanup) docker(a);
    }
    const stream = scrub(r?.stdout, token);
    fs.writeFileSync(path.join(p.dir, 'trace.jsonl'), stream);
    fs.writeFileSync(path.join(p.dir, 'stderr.txt'), scrub(r?.stderr, token) + (setupError ? `\nsetup: ${scrub(setupError, token)}` : ''));
    const events = stream.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? null;
    const result = events.findLast((e) => e.type === 'result') ?? {};
    const core = analyseTrial(stream, {narrow: k.narrow.width, wide: k.wide.width, proxyLog: fs.readFileSync(path.join(p.dir, 'proxy.jsonl'), 'utf8')});
    fs.writeFileSync(path.join(p.dir, 'core-steps.json'), JSON.stringify({case: caseId, condition: cond, rep: Number(rep), ...core}, null, 1));
    const reads = readRecord(stream, {cwd: init?.cwd ?? fs.realpathSync(p.fixture)});
    fs.writeFileSync(path.join(p.dir, 'reads.json'), JSON.stringify(reads, null, 1));
    const meta = {schema: 'asc-1815-trial/v1', trial: name, case: caseId, condition: cond, rep: Number(rep), model: p.model, budget: p.budget,
      claudeVersion: version, resolvedModel: init?.model ?? null, initProblems: initProblems(init), initSkills: init?.skills ?? null,
      tarballSha256: digest, release: conds.conditions[cond].release, sampleHead: sample.sampleHead, ascRuntimeVersion: sample.install.runtimeVersion,
      adopted: sample.install.adopted, ledgerId: fx.records[0].ledgerId, ledgerSeq: reservation.seq, fixedAtCommit: lastRecord(fx).fixedAtCommit,
      exit: r?.status ?? null, signal: r?.signal ?? null, spawnError: r?.error ? String(r.error) : setupError, wallMs: Date.now() - t0,
      resultSubtype: result.subtype ?? null, isError: result.is_error ?? null, costUsd: result.total_cost_usd ?? null, numTurns: result.num_turns ?? null,
      usage: result.usage ?? null, permissionDenials: result.permission_denials ?? null, toolCounts: reads.toolCounts,
      reads: {ascBody: reads.ascBodyRead, implementation: reads.implementationRead, ujaBody: reads.ujaBodyRead, journeys: reads.journeysRead, skillCalls: reads.skillCalls},
      coreSteps: {alternativesCompared: core.alternativesCompared, narrowChecked: core.narrowChecked, wideChecked: core.wideChecked, finalBothWidths: core.finalBothWidths, exemplarViewed: core.exemplarViewed}};
    meta.credentialInChildFiles = filesContaining(home, token) + filesContaining(config, token);
    fs.writeFileSync(path.join(p.dir, 'meta.json'), JSON.stringify(meta, null, 1));
    ledgerOps.settle(ledger, reservation.id, name, meta.costUsd);
    console.log(JSON.stringify({trial: name, exit: meta.exit, subtype: meta.resultSubtype, costUsd: meta.costUsd, initProblems: meta.initProblems, reads: meta.reads, coreSteps: meta.coreSteps}));
  } finally {
    fs.rmSync(home, {recursive: true, force: true}); fs.rmSync(config, {recursive: true, force: true});
    unlock();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
