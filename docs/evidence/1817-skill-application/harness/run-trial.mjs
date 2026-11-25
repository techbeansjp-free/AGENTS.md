// #1817: copied from docs/evidence/1814-skill-invocation/harness/run-trial.mjs. Changes: the gate variable is
// ASC1817_ALLOW_PAID; installProblems requires the condition/tarball pairing of release.json (B: the release, S: the
// candidate, each by its pinned sha256) instead of "a digest in release.json"; conditions are B and S only.
// One #1814 trial: a fresh copy of the sample project (make-fixture.mjs: ASC installed from the release tarball), one
// condition, one prompt, `claude -p` with the project as cwd. Case id `probe` runs the isolation probe (probe-check.mjs).
// Default is a dry run that prepares nothing and prints the plan. A model call happens only with --run AND env
// ASC1817_ALLOW_PAID=1 AND a credential in the environment AND the fixed files equal results/fixation.json AND the
// cumulative ledger (all stages) + this trial's budget stays within conditions.json budget (cap - safety margin). Trials run strictly one at a time
// (ledger lock); a trial is reserved at its budget before it starts, so a killed run never counts as zero (review M4).
//
// Isolation (#1814 EVAL_PLAN.md「実行環境」):
// - The trial directory must be outside this repository and the real HOME, with no ancestor CLAUDE.md/AGENTS.md/.claude/
//   .git (guard.mjs), so Claude Code's upward CLAUDE.md discovery finds only the sample project's own file.
// - HOME and CLAUDE_CONFIG_DIR are new empty directories per trial: no user settings, CLAUDE.md, memory, Skills, plugins
//   or hooks; only Claude Code's bundled Skills remain. Default setting sources (as a user has); user/local are empty.
//   Both directories are deleted after the trial (they may hold account data written by the CLI; review L9).
// - The credential comes only from CLAUDE_CODE_OAUTH_TOKEN (owner decision; ANTHROPIC_API_KEY only as a fallback) in the
//   parent environment, e.g. CLAUDE_CODE_OAUTH_TOKEN="$(cat <owner file>)" node run-trial.mjs ... The harness never reads a
//   token file, never prints the value, and passes it to the child process environment only. It is replaced in the
//   trace/stderr/debug log, the child HOME/config are searched for it (count recorded) and deleted after the trial.
// - Built-in tools Read, Glob, Grep, Skill only (no Bash, Write, Edit, Web, Agent), no MCP servers. This is an intentional
//   deviation from a user's environment (#1814 EVAL_PLAN.md「利用者の環境との意図した違い」).
// - Model: conditions.json `model` (the `sonnet` alias, fixed before any run); the resolved id is recorded per trial.
//
// Usage: node run-trial.mjs <runs-root> <condition> <case-id|probe> <rep> --fixture <sample-project>
//          [--ledger <file>] [--home-marker <file> --repo-marker <file>] [--run]
// The cap, safety margin and per-trial budget come only from conditions.json `budget` (review L-a).
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyCondition, loadConditions} from './apply-condition.mjs';
import {assertPlacement} from './guard.mjs';
import * as ledgerOps from './ledger.mjs';
import {differences, lastRecord, refixAfterMeasurement} from './fixation.mjs';
import {pinnedFor, gitEnv} from './make-fixture.mjs';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
const repoRoot = path.resolve(ev, '../../..');
export const TOOLS = 'Read,Glob,Grep,Skill';
export const DISALLOWED = 'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Agent,Task';
// review L-5, L-a: the last trial's actual cost can exceed its --max-budget-usd; stop below the cap by the fixed margin.
export const BUDGET = loadConditions().budget;
export const SAFETY_MARGIN_USD = BUDGET.safetyMarginUsd;
const fileSha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// review L-2: a paid trial runs only on a sample project installed from a release in release.json, and its copy must
// still carry exactly the entries and distribution record the install verified; for condition I, the adopted option.
// review L-c: results/fixation.json itself must be committed and clean, every record's commit must be in HEAD's history,
// and the first record's commit must be named in README.md (where reviewers and the PR see it).
export function fixationFileProblems(fx, root = ev) {
  const g = (a) => spawnSync('git', a, {cwd: root, encoding: 'utf8'});
  const p = [];
  const st = g(['status', '--porcelain', '--', 'results/fixation.json']);
  if (st.status !== 0 || st.stdout.trim()) p.push('results/fixation.json is not committed or has local changes');
  for (const r of fx.records) if (g(['merge-base', '--is-ancestor', r.fixedAtCommit, 'HEAD']).status !== 0) p.push(`fixation record commit ${r.fixedAtCommit} is not in HEAD's history`);
  const readme = fs.existsSync(path.join(root, 'README.md')) ? fs.readFileSync(path.join(root, 'README.md'), 'utf8') : '';
  if (!readme.includes(fx.records[0].fixedAtCommit)) p.push('README.md does not name the first fixation commit');
  return p;
}

// Owner decision (2026-11-25): the token reaches only the child process environment. After the trial, the child's HOME
// and config directories are searched for the value (count of files only, never the value) before they are deleted.
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

export function installProblems(install, work, cond, condName = null) {
  if (!install) return ['no install record (<fixture>.install.json)'];
  const p = [];
  // #1817: B only from the release, S only from the candidate, each by the sha256 release.json pins (no other way to
  // install an unreleased package for a paid run).
  const pin = pinnedFor(condName);
  if (!pin) p.push(`release.json pins no tarball for condition ${condName}`);
  if (install.condition !== condName) p.push(`sample project was built for condition ${install.condition ?? 'none'}, not ${condName}`);
  if (install.pinned !== true) p.push('sample project was not installed from the pinned tarball (dry-run stand-in)');
  if (pin && install.source !== pin.kind) p.push(`sample project source ${install.source ?? 'none'} is not the ${pin.kind} release.json pins for ${condName}`);
  if (pin && install.released !== (pin.kind === 'release')) p.push('install record released flag does not match the pinned kind');
  // review L-b: the copy must be exactly the installed commit with a clean tree (covers bodies and any added file).
  const g = (a) => spawnSync('git', a, {cwd: work, env: gitEnv(work), encoding: 'utf8'});
  if (g(['rev-parse', 'HEAD']).stdout.trim() !== install.sampleHead) p.push('sample project HEAD differs from the install record');
  const st = g(['status', '--porcelain', '--untracked-files=all']);
  if (st.status !== 0 || st.stdout.trim()) p.push('sample project has uncommitted or untracked changes');
  if (!pin || install.install?.tarballSha256 !== pin.assetSha256) p.push(`tarball digest is not the one release.json pins for condition ${condName}`);
  for (const e of install.install?.entries ?? []) {
    const f = path.join(work, '.claude/skills', e.name, 'SKILL.md');
    if (!fs.existsSync(f) || fileSha(f) !== e.entrySha256) p.push(`entry ${e.name} differs from the install record`);
  }
  const rec = path.join(work, '.agent-skill-chain/distribution.json');
  if (!fs.existsSync(rec) || fileSha(rec) !== install.install?.distributionSha256) p.push('distribution.json differs from the install record');
  const adopted = install.install?.adopted?.id ?? null;
  if ((cond.adopt ?? null) !== adopted) p.push(`adopted read trigger ${adopted} does not match the condition (${cond.adopt ?? 'none'})`);
  return p;
}

export function flags({model, budget, debugFile = null}) {
  return ['--model', model, '--tools', TOOLS, '--disallowedTools', DISALLOWED, '--strict-mcp-config', '--no-session-persistence',
    '--max-budget-usd', String(budget), '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    ...(debugFile ? ['--debug-file', debugFile] : [])];
}

// The probe asks for what only the session context can tell, and tries reads that must be refused. probe-check.mjs
// judges it from the tool records, the init event, the debug log and the known texts, not from the model's claims alone.
export function probePrompt(homeMarker, repoMarker) {
  return ['これは評価環境の確認です。作業はしないでください。toolは下の4と5だけを使い、次の順に答えてください。',
    '1. このsessionのContextに含まれている指示ファイル・memory（CLAUDE.md、AGENTS.md、memoryの索引、SessionStart等で追加された文脈を含む）をすべて挙げ、それぞれの出所と、最初の1行と最後の1行（空行を除く）を原文のまま書いてください。無ければ「なし」と書いてください。',
    '2. 使えるSkillの一覧を、名前とdescriptionの原文のまま、すべて書いてください（fileを読まずに、Contextにある一覧から）。',
    '3. 2のうち、名前が asc と user-journey-acceptance のSkillのdescriptionを、それぞれ「DESC asc: <原文>」「DESC user-journey-acceptance: <原文>」の形で1行ずつ書いてください。',
    `4. Readで ${homeMarker} を読む。`, `5. Readで ${repoMarker} を読む。`,
    '6. 4と5の結果（読めたか、拒否されたか）を1行ずつ書いてください。',
    '7. Contextにgitの状態（branch、最近のcommitの件名等）があれば、「GIT: 」で始めて、最近のcommitの件名を原文のまま「 | 」区切りで1行に書いてください。無ければ「GIT: なし」と書いてください。',
    '8. Contextの指示ファイルやSessionStart等で追加された文脈に、.agent-skill-chain/skills/asc/SKILL.md というpathを含む文があれば、その文を原文のまま「READ-TRIGGER: 」で始めて1行で書いてください。無ければ「READ-TRIGGER: なし」と書いてください。'].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const [runsRootArg, cond, caseId, rep] = args;
  const fixtureArg = opt('--fixture', null), budget = BUDGET.perTrialUsd, stopUsd = BUDGET.capUsd;
  const ledgerArg = opt('--ledger', null), wantRun = args.includes('--run');
  const homeMarker = opt('--home-marker', null), repoMarker = opt('--repo-marker', null);
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
  for (const k of ['--model', '--budget', '--stop-usd']) if (args.includes(k)) fail(`${k} is fixed in conditions.json and is not accepted`);
  if (!runsRootArg || !cond || !caseId || !rep || !fixtureArg) fail('usage: <runs-root> <cond> <case|probe> <rep> --fixture <dir> [--ledger f] [--run]');
  const conds = loadConditions();
  if (!conds.conditions[cond]) fail(`unknown condition ${cond}`);
  const model = conds.model;
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

  if (process.env.ASC1817_ALLOW_PAID !== '1') fail('ASC1817_ALLOW_PAID is not 1 (measurement not authorised)');
  if (!ledgerArg) fail('--ledger is required for a run (one ledger for every stage)');
  const ledger = path.resolve(ledgerArg);
  try { assertPlacement(ledger, {repoRoot}); } catch (e) { fail(`ledger: ${e.message}`); }
  const fixationFile = path.join(ev, 'results/fixation.json');
  if (!fs.existsSync(fixationFile)) fail('results/fixation.json is missing (fix the plan before running)');
  const fx = JSON.parse(fs.readFileSync(fixationFile, 'utf8'));
  const fixation = lastRecord(fx);
  const diff = differences(fixation);
  if (diff.length) fail(`fixed files differ from results/fixation.json: ${diff.join(', ')}`);
  for (const p of fixationFileProblems(fx)) fail(p);
  // review N-1: only the ledger recorded at init (a new ledger would reset the cumulative total).
  if (!fs.existsSync(ledger)) fail('the ledger file does not exist (create it with fixation.mjs init --ledger)');
  if (ledgerOps.ledgerId(ledger) !== fx.records[0].ledgerId) fail('the ledger is not the one recorded in results/fixation.json');
  const late = refixAfterMeasurement(fx, ledger);
  if (late.length) fail(`a refix record (${late.join(', ')}) is later than the first stage-1/2 reservation`);
  const credential = process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'CLAUDE_CODE_OAUTH_TOKEN' : process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : null;
  if (!credential) fail('no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in the environment');
  if (fs.existsSync(dir)) fail(`exists: ${dir}`);
  let unlock;
  try { unlock = ledgerOps.lock(ledger); } catch (e) { fail(e.message); }
  try {
    const spent = ledgerOps.spent(ledger);
    if (spent + budget > Number(stopUsd) - SAFETY_MARGIN_USD) { unlock(); fail(`cumulative spend ${spent.toFixed(2)} + this trial's budget ${budget} would exceed ${stopUsd} minus the safety margin ${SAFETY_MARGIN_USD}`); }
    if (ledgerOps.reservedNames(ledger).has(name)) { unlock(); fail(`trial ${name} is already in the ledger; a rerun needs a new rep number`); }
    const installFile = `${fixture}.install.json`;
    const install = fs.existsSync(installFile) ? JSON.parse(fs.readFileSync(installFile, 'utf8')) : null;
    fs.cpSync(fixture, work, {recursive: true});
    const problems = installProblems(install, work, conds.conditions[cond], cond);
    if (problems.length) { fs.rmSync(dir, {recursive: true, force: true}); unlock(); fail(problems.join('; ')); }
    const reservation = ledgerOps.reserve(ledger, name, budget);
    fs.mkdirSync(home, {recursive: true}); fs.mkdirSync(config, {recursive: true});
    const applied = applyCondition(work, cond);
    const sampleHead = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: work, encoding: 'utf8'}).stdout.trim();
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
    const events = stream.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } });
    const last = [...events].reverse().find((e) => e?.type === 'result') ?? null;
    const init = events.find((e) => e?.type === 'system' && e.subtype === 'init') ?? null;
    const meta = {...plan, claudeVersion: version, resolvedModel: init?.model ?? null, sampleHead, ascRuntimeVersion: install?.install?.runtimeVersion ?? null,
      tarballSha256: install?.install?.tarballSha256 ?? null, released: install?.released ?? null, installSource: install?.source ?? null, installCondition: install?.condition ?? null, adopted: install?.install?.adopted ?? null, applied, expectHook: conds.conditions[cond].hook ?? null,
      ledgerId: fx.records[0].ledgerId, ledgerSeq: reservation.seq, fixationSha256: fileSha(fixationFile), fixedAtCommit: fixation.fixedAtCommit, fixationStage: fixation.stage,
      credentialKind: credential, exit: r.status, signal: r.signal, error: r.error ? String(r.error) : null, wallMs: Date.now() - t0, costUsd: last?.total_cost_usd ?? null, budget};
    meta.credentialInChildFiles = filesContaining(home, secret) + filesContaining(config, secret);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
    ledgerOps.settle(ledger, reservation.id, name, meta.costUsd);
    console.log(JSON.stringify({trial: name, exit: r.status, costUsd: meta.costUsd, resolvedModel: meta.resolvedModel}));
  } finally {
    fs.rmSync(home, {recursive: true, force: true}); fs.rmSync(config, {recursive: true, force: true});
    unlock();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
