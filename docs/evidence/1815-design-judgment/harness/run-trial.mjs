// One #1815 trial: #1807's generation environment with #1814's user-equivalent installation and isolation.
// Default is a dry run that prepares nothing and prints the plan (docker and claude commands). A model call happens only
// with --run AND env ASC1815_ALLOW_PAID=1 AND CLAUDE_CODE_OAUTH_TOKEN in the environment AND the fixed files equal the
// last record of results/fixation.json (committed, named in README.md) AND the ledger recorded there AND the two Docker
// images have the ids pinned in conditions.json AND ledger total + the trial's budget <= capUsd - safetyMarginUsd
// (conditions.json; no --budget/--model/--stop-usd arguments) AND the order rule below.
//
// Order (run-order.json, order.mjs): first one isolation probe per condition (case `probe`; only after the owner's
// confirmation is committed in results/probe-approval.json, only while no measurement trial is reserved, one per
// condition plus at most one retry after a judged failure: probe.mjs probeRefusal). A planned trial
// runs only when every condition has a passing probe and their comparison passed, and only if it is the next unreserved
// planned trial. After all planned trials, only the next required replacement may run.
//
// Pairing (release.json): the sha256 of --tarball must be the one pinned for the condition; a tarball pinned for the
// other condition or not pinned at all is refused, also in a dry run. After the install the two reference files must
// have the condition's pinned hashes and CLAUDE.md must carry the adopted read-trigger block (pairing.mjs).
//
// Per trial (layout <runs-root>/<case>/<cond>-r<rep>/, the names #1807 run-render.mjs reads; probes <runs-root>/probe/):
//   fixture/      the sample project, built new for this trial (make-sample.mjs). The CLI's cwd. Outside this repository
//                 and the real HOME, with no ancestor CLAUDE.md/AGENTS.md/.claude/.agents/.codex/.git (#1814 guard.mjs).
//   home/ config/ new empty HOME and CLAUDE_CONFIG_DIR (#1814); deleted after the trial, searched for the credential first.
//   env/          copies of the #1807 env files the containers mount (byte-checked against the fixed files), so no
//                 repository path appears in the MCP configuration or the CLI's debug log.
//   log/          the MCP tool log and screenshots (#1807 mcp-server.mjs), outside the fixture.
//   install.json, mcp.json, trace.jsonl, stderr.txt, proxy.jsonl, core-steps.json, reads.json, meta.json (+ debug.log for probes).
// Generator (#1807): `claude -p` on the host, built-in tools Read,Write,Edit,Glob,Grep,Skill, permission mode
// acceptEdits, the MCP server `browser` started by the CLI as a disposable container on an --internal network whose only
// route out is the allowlist proxy container. Same prompt (#1807 env/gen-prompt.txt) in both conditions. Default setting
// sources as a user has them (#1814; user/local are empty), hooks not disabled.
// Credential: only CLAUDE_CODE_OAUTH_TOKEN from the parent environment (CLAUDE_CODE_OAUTH_TOKEN="$(cat <owner file>)").
// The harness never reads a token file, never prints the value, passes it to the CLI's environment only and replaces it
// in trace/stderr/debug/proxy logs. The CLI's environment has no other parent variable except PATH and a DOCKER_HOST
// resolved from the parent's docker context (the empty HOME has no docker context).
// Usage: node run-trial.mjs <runs-root> <case-id|probe> <B|S> <rep> --tarball <tgz> [--ledger <file>]
//          [--home-marker <f> --repo-marker <f>] [--run]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {analyseTrial} from '../../1807-design-eval-browser/harness/core-steps.mjs';
import {assertPlacement} from '../../1814-skill-invocation/harness/guard.mjs';
import * as ledgerOps from '../../1814-skill-invocation/harness/ledger.mjs';
import {makeSample} from './make-sample.mjs';
import {ev, evidenceRoot, loadJson, fileSha256, tarballProblems, installedProblems} from './pairing.mjs';
import {readRecord} from './reads.mjs';
import {paidStepProblems, lastRecord} from './fixation.mjs';
import {loadOrder, trialName, probeName, orderRefusal} from './order.mjs';
import {approvalProblems, probePrompt, probeProblems, probeRefusal} from './probe.mjs';

const repoRoot = path.resolve(ev, '../../..');
const e1807env = path.join(evidenceRoot, '1807-design-eval-browser', 'env');
export const ENV_FILES = ['mcp-server.mjs', 'proxy.mjs', 'allowlist.json', 'allowlist-catalog.json'];
export const LABEL = 'asc.evidence=1815';
export const TOOLS = 'Read,Write,Edit,Glob,Grep,Skill';
export const DISALLOWED = 'Bash,NotebookEdit,WebFetch,WebSearch,Agent,Task';
export const MCP_TOOLS = ['mcp__browser__fetch_page', 'mcp__browser__view_page', 'mcp__browser__screenshot'];
export const EXPECTED_INIT_TOOLS = [...TOOLS.split(','), ...MCP_TOOLS].sort();
export const TIMEOUT_MS = 25 * 60 * 1000;
export const images = () => loadJson('conditions.json').images;
export const IMAGE = 'asc-1807-tools:1';
export const PROXY_IMAGE = 'node:22-alpine';

export const trialDir = (runsRoot, caseId, cond, rep) => path.join(path.resolve(runsRoot), caseId, `${cond}-r${rep}`);
export const prefixOf = (caseId, cond, rep) => `asc1815-${caseId.split('-')[0]}-${cond.toLowerCase()}-r${rep}`;

// The docker commands of #1807 run-gen.mjs, with the #1815 label, --pull never and the env files from the trial copy.
export function dockerPlan({prefix, fixture, logDir, envDir}) {
  const allowPath = path.join(envDir, 'allowlist.json');
  const hard = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--label', LABEL, '--pull', 'never'];
  const setup = [
    ['network', 'create', '--internal', '--label', LABEL, `${prefix}-gen`],
    ['network', 'create', '--label', LABEL, `${prefix}-egress`],
    ['run', '-d', '--name', `${prefix}-proxy`, ...hard, '--pids-limit', '128', '--memory', '256m', '--cpus', '0.5', '--user', 'node', '--network', `${prefix}-egress`,
      '-v', `${envDir}:/opt/env:ro`, PROXY_IMAGE, 'node', '/opt/env/proxy.mjs', '/opt/env/allowlist.json'],
    ['network', 'connect', '--alias', 'proxy', `${prefix}-gen`, `${prefix}-proxy`],
  ];
  const mcpArgs = ['run', '-i', '--rm', '--name', `${prefix}-mcp`, ...hard, '--pids-limit', '512', '--memory', '3g', '--cpus', '2', '--shm-size', '1g',
    '--tmpfs', '/tmp:rw,size=512m', '--user', 'pwuser', '--network', `${prefix}-gen`,
    '-v', `${fixture}:/work:ro`, '-v', `${envDir}:/opt/env:ro`, '-v', `${allowPath}:/config/allowlist.json:ro`, '-v', `${path.join(envDir, 'allowlist-catalog.json')}:/config/allowlist-catalog.json:ro`, '-v', `${logDir}:/log`,
    '-e', 'HOME=/tmp', '-e', 'BROWSE_PROXY=http://proxy:3129', '-e', 'ALLOWLIST=/config/allowlist.json', '-e', 'ALLOWLIST_CATALOG=/config/allowlist-catalog.json', '-e', 'WORK_DIR=/work',
    '-e', 'TOOL_LOG=/log/tools.jsonl', '-e', 'SHOT_DIR=/log/shots', IMAGE, 'node', '/opt/env/mcp-server.mjs'];
  const cleanup = [['rm', '-f', '-v', `${prefix}-mcp`, `${prefix}-proxy`], ['network', 'rm', `${prefix}-gen`, `${prefix}-egress`]];
  return {setup, mcpConfig: {mcpServers: {browser: {type: 'stdio', command: 'docker', args: mcpArgs}}}, cleanup};
}

export function copyEnv(envDir) {
  fs.mkdirSync(envDir, {recursive: true});
  for (const f of ENV_FILES) {
    fs.copyFileSync(path.join(e1807env, f), path.join(envDir, f));
    if (fileSha256(path.join(envDir, f)) !== fileSha256(path.join(e1807env, f))) throw new Error(`env copy ${f} differs`);
  }
}

export function claudeArgs({prompt, model, budget, mcpConfigPath, debugFile = null}) {
  return ['-p', prompt, '--model', model, '--permission-mode', 'acceptEdits', '--tools', TOOLS, '--disallowedTools', DISALLOWED,
    '--allowedTools', MCP_TOOLS.join(','), '--mcp-config', mcpConfigPath, '--strict-mcp-config', '--no-session-persistence',
    '--max-budget-usd', String(budget), '--output-format', 'stream-json', '--verbose', '--include-hook-events', ...(debugFile ? ['--debug-file', debugFile] : [])];
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

// The local images must be exactly the pinned ones (conditions.json images).
export function imageProblems(inspect = (n) => { const r = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', n], {encoding: 'utf8'}); return r.status === 0 ? r.stdout.trim() : null; }) {
  const p = [];
  for (const im of Object.values(images())) {
    const id = inspect(im.name);
    if (id !== im.id) p.push(`docker image ${im.name} is ${id ?? 'absent'}, pinned ${im.id}`);
  }
  return p;
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

export function plan(runsRoot, caseId, cond, rep, {homeMarker = '<home-marker>', repoMarker = '<repo-marker>'} = {}) {
  const conds = loadJson('conditions.json');
  const probe = caseId === 'probe';
  const sampleCase = probe ? loadOrder().probeCase : caseId;
  const dir = trialDir(runsRoot, caseId, cond, rep);
  const fixture = path.join(dir, 'fixture'), logDir = path.join(dir, 'log'), envDir = path.join(dir, 'env');
  const prefix = prefixOf(caseId, cond, rep);
  const d = dockerPlan({prefix, fixture, logDir, envDir});
  const prompt = probe ? probePrompt(homeMarker, repoMarker) : fs.readFileSync(path.join(evidenceRoot, conds.prompt), 'utf8');
  const budget = probe ? conds.budget.probeUsd : conds.budget.perTrialUsd;
  const debugFile = probe ? path.join(dir, 'debug.log') : null;
  const name = probe ? probeName(cond, rep) : trialName(caseId, cond, rep);
  return {name, probe, sampleCase, dir, fixture, logDir, envDir, prefix, prompt, docker: d, model: conds.model, budget, debugFile,
    claude: claudeArgs({prompt: '<prompt>', model: conds.model, budget, mcpConfigPath: path.join(dir, 'mcp.json'), debugFile})};
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  let unlock = () => {};
  const fail = (m) => { unlock(); console.error(`refused: ${m}`); process.exit(3); };
  for (const k of ['--model', '--budget', '--stop-usd', '--prompt']) if (args.includes(k)) fail(`${k} is fixed in conditions.json and is not accepted`);
  const [runsRoot, caseId, cond, rep] = args;
  const tarballArg = opt('--tarball', null), ledgerArg = opt('--ledger', null), wantRun = args.includes('--run');
  const homeMarker = opt('--home-marker', null), repoMarker = opt('--repo-marker', null);
  if (!runsRoot || !caseId || !cond || !/^[1-9]\d*$/.test(rep ?? '') || !tarballArg) fail('usage: <runs-root> <case|probe> <B|S> <rep> --tarball <tgz> [--ledger f] [--home-marker f --repo-marker f] [--run]');
  const conds = loadJson('conditions.json'), release = loadJson('release.json'), cases = loadJson('cases.json');
  const probe = caseId === 'probe';
  if (!probe && !cases.cases[caseId]) fail(`unknown case ${caseId}`);
  if (!conds.conditions[cond]) fail(`unknown condition ${cond}`);
  if (probe && (!homeMarker || !repoMarker)) fail('a probe needs --home-marker and --repo-marker');
  const tarball = path.resolve(tarballArg);
  if (!fs.existsSync(tarball)) fail('tarball does not exist');
  const digest = fileSha256(tarball);
  const pair = tarballProblems(release, conds, cond, digest);
  if (pair.length) fail(pair.join('; '));
  const p = plan(runsRoot, caseId, cond, rep, {homeMarker: homeMarker ?? undefined, repoMarker: repoMarker ?? undefined});
  const k = cases.cases[p.sampleCase];
  try { assertPlacement(p.fixture, {repoRoot}); } catch (e) { fail(e.message); }
  if (!wantRun) {
    console.log(JSON.stringify({dryRun: true, trial: p.name, tarballSha256: digest, model: p.model, budgetUsd: p.budget,
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
  if (probe) {
    const a = approvalProblems();
    if (a.length) fail(a.join('; '));
    for (const m of [homeMarker, repoMarker]) if (!fs.existsSync(m)) fail('marker file missing (node probe.mjs markers create <repo>)');
  }
  const fixationFile = path.join(ev, 'results/fixation.json');
  const fx = JSON.parse(fs.readFileSync(fixationFile, 'utf8'));
  if (fs.existsSync(p.dir)) fail(`exists: ${p.dir}`);
  const im = imageProblems();
  if (im.length) fail(im.join('; '));
  const dockerHost = resolveDockerHost();
  if (!dockerHost) fail('docker host could not be resolved from the docker context');
  const B = conds.budget;
  try { unlock = ledgerOps.lock(ledger); } catch (e) { fail(e.message); }
  const home = path.join(p.dir, 'home'), config = path.join(p.dir, 'config');
  try {
    const reserved = ledgerOps.reservedNames(ledger);
    if (probe) {
      const pr = probeRefusal({condition: cond, rep: Number(rep), reserved, runsRoot: path.resolve(runsRoot)});
      if (pr) fail(pr);
    } else {
      const pp = probeProblems(path.resolve(runsRoot), loadOrder().probeConditions);
      if (pp.length) fail(pp.join('; '));
      const o = orderRefusal({caseId, condition: cond, rep: Number(rep), reserved, runsRoot: path.resolve(runsRoot)});
      if (o) fail(o);
    }
    const spent = ledgerOps.spent(ledger);
    if (spent + p.budget > B.capUsd - B.safetyMarginUsd) fail(`ledger total ${spent.toFixed(2)} + ${p.budget} would exceed ${B.capUsd} - ${B.safetyMarginUsd}`);
    if (reserved.has(p.name)) fail(`trial ${p.name} is already in the ledger`);
    fs.mkdirSync(path.join(p.logDir, 'shots'), {recursive: true});
    const tmp = path.join(p.dir, 'tmp'); fs.mkdirSync(tmp);
    let sample;
    try { sample = makeSample(p.sampleCase, tarball, digest, p.fixture, tmp, {adopt: conds.adopt}); } catch (e) { fs.rmSync(p.dir, {recursive: true, force: true}); fail(`sample: ${e.message}`); }
    fs.rmSync(tmp, {recursive: true, force: true});
    const inst = installedProblems(release, cond, p.fixture);
    if (sample.status) inst.push('sample project is not clean after the install');
    if (inst.length) { fs.rmSync(p.dir, {recursive: true, force: true}); fail(inst.join('; ')); }
    copyEnv(p.envDir);
    fs.writeFileSync(path.join(p.dir, 'install.json'), JSON.stringify(sample, null, 1));
    const reservation = ledgerOps.reserve(ledger, p.name, p.budget);
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
      r = spawnSync('claude', claudeArgs({prompt: p.prompt, model: p.model, budget: p.budget, mcpConfigPath: path.join(p.dir, 'mcp.json'), debugFile: p.debugFile}),
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
    if (p.debugFile && fs.existsSync(p.debugFile)) fs.writeFileSync(p.debugFile, scrub(fs.readFileSync(p.debugFile, 'utf8'), token));
    const events = stream.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? null;
    const result = events.findLast((e) => e.type === 'result') ?? {};
    const core = analyseTrial(stream, {narrow: k.narrow.width, wide: k.wide.width, proxyLog: fs.readFileSync(path.join(p.dir, 'proxy.jsonl'), 'utf8')});
    fs.writeFileSync(path.join(p.dir, 'core-steps.json'), JSON.stringify({case: caseId, condition: cond, rep: Number(rep), ...core}, null, 1));
    const reads = readRecord(stream, {cwd: init?.cwd ?? fs.realpathSync(p.fixture)});
    fs.writeFileSync(path.join(p.dir, 'reads.json'), JSON.stringify(reads, null, 1));
    const meta = {schema: 'asc-1815-trial/v2', trial: p.name, case: caseId, sampleCase: p.sampleCase, condition: cond, rep: Number(rep), model: p.model, budget: p.budget,
      claudeVersion: version, resolvedModel: init?.model ?? null, initProblems: initProblems(init), initSkills: init?.skills ?? null,
      tarballSha256: digest, release: conds.conditions[cond].release, sampleHead: sample.sampleHead, ascRuntimeVersion: sample.install.runtimeVersion,
      adopted: sample.install.adopted, images: Object.fromEntries(Object.entries(images()).map(([n, x]) => [n, x.id])),
      ledgerId: fx.records[0].ledgerId, ledgerSeq: reservation.seq, fixedAtCommit: lastRecord(fx).fixedAtCommit, fixationSha256: crypto.createHash('sha256').update(fs.readFileSync(fixationFile)).digest('hex'),
      exit: r?.status ?? null, signal: r?.signal ?? null, spawnError: r?.error ? String(r.error) : setupError, wallMs: Date.now() - t0,
      resultSubtype: result.subtype ?? null, isError: result.is_error ?? null, costUsd: result.total_cost_usd ?? null, numTurns: result.num_turns ?? null,
      usage: result.usage ?? null, permissionDenials: result.permission_denials ?? null, toolCounts: reads.toolCounts,
      reads: {ascBody: reads.ascBodyRead, implementation: reads.implementationRead, ujaBody: reads.ujaBodyRead, journeys: reads.journeysRead, skillCalls: reads.skillCalls},
      coreSteps: {alternativesCompared: core.alternativesCompared, narrowChecked: core.narrowChecked, wideChecked: core.wideChecked, finalBothWidths: core.finalBothWidths, exemplarViewed: core.exemplarViewed}};
    meta.credentialInChildFiles = filesContaining(home, token) + filesContaining(config, token);
    fs.writeFileSync(path.join(p.dir, 'meta.json'), JSON.stringify(meta, null, 1));
    ledgerOps.settle(ledger, reservation.id, p.name, meta.costUsd);
    console.log(JSON.stringify({trial: p.name, exit: meta.exit, subtype: meta.resultSubtype, costUsd: meta.costUsd, initProblems: meta.initProblems, reads: meta.reads, coreSteps: meta.coreSteps}));
  } finally {
    fs.rmSync(home, {recursive: true, force: true}); fs.rmSync(config, {recursive: true, force: true});
    unlock();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
