// Synthetic tests for probe-check.mjs, guard.mjs, ledger.mjs, fixation.mjs and the neutral commit of apply-condition.mjs
// (#1814). No model call.
// Usage: node --test docs/evidence/1814-skill-invocation/harness/probe.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkProbe, compareProbes, description, installDirProblems, ownerCanaries} from './probe-check.mjs';
import {placementProblems} from './guard.mjs';
import * as ledger from './ledger.mjs';
import {differences, digests, FIXED} from './fixation.mjs';
import {applyCondition, NEUTRAL_SUBJECT} from './apply-condition.mjs';
import {gitEnv} from './make-fixture.mjs';

const ASC = ['asc', 'contract-enforcement', 'decision-ownership', 'engineering-judgment', 'estimate-and-scope', 'execution-recovery', 'migration-assurance', 'project-foundation', 'research-to-implementation', 'review-and-remediation', 'security-evidence', 'subagent-model-selection', 'tracker-issue-writing', 'user-journey-acceptance', 'verification-optimization', 'work-coordination'];
const ascSkills = Object.fromEntries(ASC.map((s) => [s, `${s}の説明。`]));
const trial = '/t/R-probe-1', work = '/t/R-probe-1/work';
const HOME_M = '/h/asc1814-home-marker.txt', REPO_M = '/r/.agent-skill-chain/local/asc1814-repo-marker.txt';
let seq = 0;
function trace({skills = [...ASC, 'dataviz'], tools = ['Read', 'Glob', 'Grep', 'Skill'], text, reads = [[HOME_M, true], [REPO_M, true]], cwd = work, plugins = [], extra = [], hooks = []}) {
  const lines = [{type: 'system', subtype: 'init', cwd, tools, mcp_servers: [], plugins, skills, model: 'm'}, ...hooks];
  for (const [p, err, tool = 'Read'] of [...reads, ...extra]) {
    const id = `t${++seq}`;
    lines.push({type: 'assistant', message: {content: [{type: 'tool_use', id, name: tool, input: tool === 'Read' ? {file_path: p} : {pattern: 'description', path: p}}]}});
    lines.push({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: id, is_error: err, content: err ? 'denied' : 'x'}]}});
  }
  lines.push({type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.05});
  return lines.map((l) => JSON.stringify(l)).join('\n');
}
const goodText = (extra = '') => `1. ${work}/CLAUDE.md: ユーザー管理API${extra}\nDESC asc: ascの説明。\nDESC user-journey-acceptance: user-journey-acceptanceの説明。\n4 拒否 5 拒否\nGIT: ${NEUTRAL_SUBJECT} | Install ASC | initial`;
const base = (o) => ({trace: trace({text: goodText()}), debug: `Loading ${trial}/work/CLAUDE.md\nskills from ${trial}/work/.claude/skills/asc`, stderr: '', hookLog: null, work, trialDir: trial,
  condition: 'R', ascSkills, baseFirstLine: '# ユーザー管理API', pointerHead: 'このプロジェクトでASCを使う', forbiddenTexts: ['agent-skill-chain 利用案内（Claude Code）'],
  ownerLines: ['owner memory index first line'], ownerSkills: ['my-private-skill'], markerPaths: [HOME_M, REPO_M], tokens: ['TOKEN-H', 'TOKEN-R'],
  realHome: '/h', repoRoot: '/r', hostInstallDir: '/opt/claude/versions', installProblems: [], ...o});

test('clean R probe passes; heading mark omitted in the answer is accepted (L3)', () => {
  const r = checkProbe(base({}));
  assert.equal(r.pass, true, JSON.stringify(r.checks)); assert.deepEqual(r.nonAscSkills, ['dataviz']);
});

test('each leak or mismatch fails the probe', () => {
  const fails = (o, key) => { const r = checkProbe(base(o)); assert.equal(r.pass, false, key); assert.equal(r.checks[key].pass, false, key); };
  fails({trace: trace({text: goodText(), skills: ASC.slice(1)})}, 'ascListed');
  fails({trace: trace({text: goodText(), tools: ['Read', 'Bash']})}, 'tools');
  fails({trace: trace({text: goodText(), plugins: [{name: 'p'}]})}, 'noPlugins');
  fails({trace: trace({text: goodText(), reads: [[HOME_M, false], [REPO_M, true]]})}, 'markersRefused');
  fails({trace: trace({text: goodText() + ' TOKEN-H'})}, 'markerTokensAbsent');
  fails({tokens: ['TOKEN-H']}, 'markerTokensAbsent'); // L2: an unreadable marker does not pass silently
  fails({trace: trace({text: goodText(), reads: [[HOME_M, true], [HOME_M, true]]})}, 'markersAttempted'); // L1: full path, each marker
  fails({trace: trace({text: goodText('\n# agent-skill-chain 利用案内（Claude Code）')})}, 'noRepoInstructions');
  fails({trace: trace({text: goodText('\nmemory: owner memory index first line')})}, 'noOwnerInstructionsOrMemory'); // M3
  fails({debug: 'note owner memory index first line'}, 'noOwnerInstructionsOrMemory');
  fails({trace: trace({text: goodText(), skills: [...ASC, 'my-private-skill']})}, 'noOwnerSkills'); // M3
  fails({trace: trace({text: goodText('\nこのプロジェクトでASCを使う開発の…')})}, 'pointerMatchesCondition');
  fails({condition: 'P'}, 'pointerMatchesCondition');
  fails({condition: 'H', trace: trace({text: goodText('\nこのプロジェクトでASCを使う開発の…')})}, 'hookMatchesCondition');
  fails({debug: 'Loading /h/.claude/CLAUDE.md'}, 'debugPathsInsideTrial');
  fails({debug: null}, 'debugPathsInsideTrial');
  fails({trace: trace({text: goodText().replace('DESC asc: ascの説明。', 'DESC asc: 別の文')})}, 'descriptionsInContext');
  fails({trace: trace({text: goodText(), extra: [[`${work}/.claude/skills/asc/SKILL.md`, false]]})}, 'descriptionsInContext');
  fails({trace: trace({text: goodText(), extra: [[`${work}/.claude/skills`, false, 'Grep']]})}, 'descriptionsInContext'); // L4
  fails({trace: trace({text: goodText(), cwd: '/elsewhere'})}, 'cwd');
  fails({trace: trace({text: goodText().replace(`GIT: ${NEUTRAL_SUBJECT}`, 'GIT: Adopt ASC read trigger (P)')})}, 'gitContextNeutral'); // M1
  fails({trace: trace({text: goodText(), hooks: [{type: 'system', subtype: 'hook_started', hook_name: 'SessionStart:startup', command: 'node user-hook.mjs'}]})}, 'noForeignHooks'); // M3
  fails({installProblems: ['program directory lies in a user config directory']}, 'programDirectory'); // M2
});

test('the program directory is excluded only when it is a safe directory (M2)', () => {
  const debug = 'loading bundled skills from /opt/claude/versions/9/skills/x\nexec /opt/claude/versions/9';
  assert.equal(checkProbe(base({debug})).pass, true);
  assert.equal(checkProbe(base({debug, hostInstallDir: null})).pass, false);
  const homeInstall = 'loading bundled skills from /h/.local/share/claude/versions/9/skills/x';
  assert.equal(checkProbe(base({debug: homeInstall, hostInstallDir: '/h/.local/share/claude/versions'})).pass, true);
  assert.equal(checkProbe(base({debug: homeInstall + '\nread /h/.claude/settings.json', hostInstallDir: '/h/.local/share/claude/versions'})).pass, false);
  const opts = {realHome: '/h', userConfigDirs: ['/h/.claude', '/h/.claude-x'], repoRoot: '/r'};
  assert.deepEqual(installDirProblems('/h/.local/share/claude/versions', opts), []);
  assert.match(installDirProblems('/h/.claude/local', opts).join(), /lies in a user config directory/);
  assert.match(installDirProblems('/h', opts).join(), /contains the real HOME/);
  assert.match(installDirProblems('/', opts).join(), /contains the real HOME/);
  assert.match(installDirProblems('/r/node_modules/.bin', opts).join(), /lies in the repository/);
  assert.match(installDirProblems(null, opts).join(), /no Claude Code executable/);
});

test('hook condition passes with pointer delivered, the hook log and only its own hook events', () => {
  const own = {type: 'system', subtype: 'hook_response', hook_name: 'SessionStart:startup', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/asc-read-trigger.mjs"'};
  const r = checkProbe(base({condition: 'H', trace: trace({text: goodText('\nSessionStart: このプロジェクトでASCを使う開発の…'), hooks: [own]}), hookLog: '{"event":"SessionStart","source":"startup"}\n'}));
  assert.equal(r.pass, true, JSON.stringify(r.checks));
});

test('compare: conditions may differ only by CLAUDE.md / hook output (M1)', () => {
  const r = checkProbe(base({}));
  const p = checkProbe(base({condition: 'P', trace: trace({text: goodText('\nこのプロジェクトでASCを使う開発の…')})}));
  assert.equal(compareProbes([r, p]).pass, true);
  const other = checkProbe(base({condition: 'P', trace: trace({text: goodText('\nこのプロジェクトでASCを使う開発の…'), skills: [...ASC, 'dataviz', 'extra']})}));
  assert.deepEqual(compareProbes([r, other]).differ, ['nonAscSkills']);
});

test('ownerCanaries reads first lines and Skill names, never content beyond them', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-owner-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# Personal rules for everything\nsecond line\n');
  fs.mkdirSync(path.join(d, 'projects/p1/memory'), {recursive: true});
  fs.writeFileSync(path.join(d, 'projects/p1/memory/MEMORY.md'), '\n- [Some memory](a.md) — hook\n');
  fs.mkdirSync(path.join(d, 'skills/mine'), {recursive: true});
  const c = ownerCanaries([d, path.join(d, 'absent')]);
  assert.deepEqual(c.lines, ['Personal rules for everything', '- [Some memory](a.md) — hook']); assert.deepEqual(c.skills, ['mine']);
});

test('description() reads the single-line frontmatter description', () => {
  assert.equal(description('---\nname: asc\ndescription: 開発で使う。\n---\n\nbody'), '開発で使う。');
});

test('guard refuses ancestors with instruction files or git, and the real HOME', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-guard-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const clean = path.join(root, 'a', 'work');
  fs.mkdirSync(clean, {recursive: true});
  assert.deepEqual(placementProblems(clean, {home: null}), []);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'x');
  assert.match(placementProblems(clean, {home: null}).join(), /ancestor CLAUDE\.md/);
  fs.rmSync(path.join(root, 'CLAUDE.md'));
  fs.mkdirSync(path.join(root, 'a', '.git'));
  assert.match(placementProblems(clean, {home: null}).join(), /ancestor \.git/);
  assert.match(placementProblems(path.join(os.homedir(), 'x-asc1814-not-created')).join(), /real HOME/);
  assert.match(placementProblems(path.join(root, 'a', 'b'), {home: null, repoRoot: root}).join(), /ASC repository/);
});

test('ledger: cumulative, reserved at budget until settled, strictly sequential (M4)', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-ledger-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  const f = path.join(d, 'ledger.jsonl');
  assert.equal(ledger.spent(f), 0);
  ledger.reserve(f, 'R-asc-1-1', 0.6); ledger.settle(f, 'R-asc-1-1', 0.21);
  ledger.reserve(f, 'R-asc-1-2', 0.6); // parent killed: never settled
  ledger.reserve(f, 'P-asc-1-1', 0.6); ledger.settle(f, 'P-asc-1-1', null); // no cost reported
  assert.equal(Number(ledger.spent(f).toFixed(2)), 1.41);
  const unlock = ledger.lock(f);
  assert.throws(() => ledger.lock(f), /locked/);
  unlock();
  ledger.lock(f)();
});

test('fixation: a change to a fixed file is detected', () => {
  const now = digests();
  assert.deepEqual(differences({files: now}), []);
  assert.deepEqual(differences({files: {...now, 'cases.json': 'x'}}), ['cases.json']);
  assert.ok(FIXED.includes('decision-criteria.md') && FIXED.includes('harness/score.mjs'));
});

test('every condition gets one commit with the same neutral subject (M1)', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-commit-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  const subjects = {};
  for (const c of ['R', 'P', 'H']) {
    const w = path.join(d, c);
    fs.mkdirSync(path.join(w, '.agent-skill-chain/v05'), {recursive: true});
    fs.writeFileSync(path.join(w, '.agent-skill-chain/v05/USAGE.md'), '### ASCを読む契機を利用先へ採用する（任意）\n\n```text\nこのプロジェクトでASCを使う。\n```\n');
    const git = (a) => spawnSync('git', a, {cwd: w, env: gitEnv(w), encoding: 'utf8'});
    git(['init', '-q', '-b', 'main']); git(['add', '-A']); git(['commit', '-q', '-m', 'initial']);
    applyCondition(w, c);
    subjects[c] = git(['log', '--format=%s']).stdout.trim().split('\n');
  }
  assert.deepEqual(subjects.R, [NEUTRAL_SUBJECT, 'initial']);
  assert.deepEqual(subjects.P, subjects.R); assert.deepEqual(subjects.H, subjects.R);
});
