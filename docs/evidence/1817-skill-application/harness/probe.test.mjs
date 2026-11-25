// Synthetic tests for probe-check.mjs, guard.mjs, ledger.mjs, fixation.mjs and the neutral commit of apply-condition.mjs
// (#1817, copied from #1814). No model call. The #1814 probe tests of conditions R/P/H run against those condition
// definitions (LEGACY below, passed as conditionsOverride) so the unchanged probe-check paths stay covered; the #1817
// conditions B and S are tested for the probe, the neutral commit and the release/candidate pairing.
// Usage: node --test docs/evidence/1817-skill-application/harness/probe.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {checkProbe, compareProbes, description, installDirProblems, ownerCanaries, gitSubjects, isMarkerPermissionSuggestion} from './probe-check.mjs';
import {placementProblems} from './guard.mjs';
import * as ledger from './ledger.mjs';
import {differences, digests, FIXED, stage3Violations, invariantDigests, refixViolations, refixAfterMeasurement, conditionIProblems, moduleShape} from './fixation.mjs';
import {fileURLToPath} from 'node:url';
import {installProblems, fixationFileProblems, filesContaining} from './run-trial.mjs';
import {applyCondition, NEUTRAL_SUBJECT} from './apply-condition.mjs';
import {gitEnv, pinnedFor, makeFixture} from './make-fixture.mjs';

const EV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONDS = JSON.parse(fs.readFileSync(path.join(EV, 'conditions.json'), 'utf8'));
// #1814 conditions.json definitions of R, P, H (for the unchanged probe-check paths only; not measured in #1817).
const LEGACY = {...CONDS, conditions: {...CONDS.conditions, R: {label: 'R', pointer: false, hook: null, core: true}, P: {label: 'P', pointer: true, hook: null, core: true}, H: {label: 'H', pointer: false, hook: 'usage', core: true}}};

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
const goodText = (extra = '') => `1. ${work}/CLAUDE.md 最初の行: ユーザー管理API / 最後の行: TypeScript/Expressのユーザー管理API。${extra}\nDESC asc: ascの説明。\nDESC user-journey-acceptance: user-journey-acceptanceの説明。\n4 拒否 5 拒否\nGIT: ${NEUTRAL_SUBJECT} | Install ASC | initial`;
const base = (o) => ({trace: trace({text: goodText()}), debug: `Loading ${trial}/work/CLAUDE.md\nskills from ${trial}/work/.claude/skills/asc`, stderr: '', hookLog: null, work, trialDir: trial,
  condition: 'R', ascSkills, baseFirstLine: '# ユーザー管理API', pointerHead: 'このプロジェクトでASCを使う', forbiddenTexts: ['agent-skill-chain 利用案内（Claude Code）'],
  ownerLines: ['owner memory index first line'], ownerSkills: ['my-private-skill'], markerPaths: [HOME_M, REPO_M], tokens: ['TOKEN-H', 'TOKEN-R'],
  realHome: '/h', repoRoot: '/r', hostInstallDir: '/opt/claude/versions', installProblems: [], conditionsOverride: LEGACY, ...o});

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

test('stage-0 refix: bundled plugins allowed and named; any other plugin fails', () => {
  const bundled = ['cc-plugin-agents-md', 'cc-plugin-privacy', 'cc-plugin-plugin-authoring'].map((name) => ({name, path: 'builtin', source: `${name}@builtin`}));
  const ok = checkProbe(base({trace: trace({text: goodText(), plugins: bundled})}));
  assert.equal(ok.pass, true, JSON.stringify(ok.checks)); assert.deepEqual(ok.checks.noPlugins.detail.builtin, bundled.map((p) => p.name));
  for (const bad of [{name: 'x', path: '/h/.claude/plugins/x', source: 'x@market'}, {name: 'y', path: 'builtin', source: 'y@market'}, {name: 'z', path: 'builtin', source: 'other@builtin'}]) {
    const r = checkProbe(base({trace: trace({text: goodText(), plugins: [...bundled, bad]})}));
    assert.equal(r.checks.noPlugins.pass, false, JSON.stringify(bad));
  }
});

test('stage-0 refix: only permission-suggestion lines for the two markers are excluded from the debug checks', () => {
  const perm = (rule) => `2026 [DEBUG] "Permission suggestions for Read: [\\n  {\\n    \\"type\\": \\"addRules\\",\\n    \\"rules\\": [\\n      {\\n        \\"toolName\\": \\"Read\\",\\n        \\"ruleContent\\": \\"${rule}\\"\\n      }\\n    ],\\n    \\"behavior\\": \\"allow\\",\\n    \\"destination\\": \\"session\\"\\n  }\\n]"`;
  const homeDir = perm('//h/**'), repoDir = perm('//r/.agent-skill-chain/local/**');
  assert.equal(isMarkerPermissionSuggestion(homeDir, [HOME_M, REPO_M]), true);
  assert.equal(isMarkerPermissionSuggestion(repoDir, [HOME_M, REPO_M]), true);
  const debug = `Loading ${trial}/work/CLAUDE.md\n${homeDir}\n${repoDir}`;
  assert.equal(checkProbe(base({debug})).pass, true, JSON.stringify(checkProbe(base({debug})).checks));
  // counterexamples: another directory in a suggestion, a real-HOME path outside a suggestion block, a suggestion with an extra path
  assert.equal(isMarkerPermissionSuggestion(perm('//h/.claude/**'), [HOME_M, REPO_M]), false);
  assert.equal(checkProbe(base({debug: `${homeDir}\n${perm('//h/.claude/**')} memory`})).checks.noRealHomeOrRepoInDebug.pass, false);
  assert.equal(checkProbe(base({debug: `${homeDir}\nread /h/.claude/settings.json`})).pass, false);
  assert.equal(isMarkerPermissionSuggestion(`${homeDir} /h/.claude/CLAUDE.md`, [HOME_M, REPO_M]), false);
  assert.equal(isMarkerPermissionSuggestion('Read /h/asc1814-home-marker.txt', [HOME_M, REPO_M]), false);
});

test('review L1-L4: builtin plugin names compared across conditions; tighter marker and managed-policy exclusions', () => {
  const mk = (name) => ({name, path: 'builtin', source: `${name}@builtin`});
  const r1 = checkProbe(base({trace: trace({text: goodText(), plugins: [mk('a'), mk('b')]})}));
  const r2 = checkProbe(base({trace: trace({text: goodText(), plugins: [mk('a'), mk('b'), mk('c')]})}));
  assert.deepEqual(r1.builtinPlugins, ['a', 'b']);
  assert.deepEqual(compareProbes([r1, r2]).differ, ['builtinPlugins']);
  // L3: a marker line with another absolute path is not excluded
  assert.equal(checkProbe(base({debug: 'Read /h/asc1814-home-marker.txt /h/.claude/CLAUDE.md'})).pass, false);
  assert.equal(checkProbe(base({debug: 'Read /h/asc1814-home-marker.txt denied'})).pass, true);
  // L4: a suggestion mixing a marker directory and another directory
  const perm2 = `"Permission suggestions for Read: [{\\"rules\\": [{\\"toolName\\": \\"Read\\", \\"ruleContent\\": \\"//h/**\\"}, {\\"toolName\\": \\"Read\\", \\"ruleContent\\": \\"//h/.claude/**\\"}]}]"`;
  assert.equal(isMarkerPermissionSuggestion(perm2, [HOME_M, REPO_M]), false);
  assert.equal(checkProbe(base({debug: perm2})).checks.noRealHomeOrRepoInDebug.pass, false);
  // L2: a loaded managed-policy file (not a missing-file line) is an outside path
  assert.equal(checkProbe(base({debug: 'Loading CLAUDE.md from /Library/Application Support/ClaudeCode/CLAUDE.md'})).checks.debugPathsInsideTrial.pass, false);
  assert.equal(checkProbe(base({debug: 'loading skills/ from /Library/Application Support/ClaudeCode/skills/x'})).checks.debugPathsInsideTrial.pass, false);
  // L4: removing a project-relative .claude/ path keeps a real-HOME path on the same line visible
  assert.equal(checkProbe(base({debug: 'memory: .claude/skills/asc/SKILL.md and /h/notes/memory.md'})).checks.noRealHomeOrRepoInDebug.pass, false);
  assert.equal(checkProbe(base({managedPolicyPresent: ['managed-settings.json']})).managedPolicyPresent[0], 'managed-settings.json');
});

test('stage-0 refix: the managed-policy path with a space and relative paths in hook text are not outside paths', () => {
  const managed = 'Broken symlink or missing file encountered for settings.json at path: /Library/Application Support/ClaudeCode/managed-settings.json';
  const hookText = 'Hooks: {"additionalContext":"…では、.agent-skill-chain/skills/asc/SKILL.mdを読み…"}';
  assert.equal(checkProbe(base({debug: `${managed}\n${hookText}`})).checks.debugPathsInsideTrial.pass, true);
  assert.equal(checkProbe(base({debug: `${managed}\nloading /etc/other/skills/x`})).checks.debugPathsInsideTrial.pass, false);
  assert.equal(checkProbe(base({debug: 'settings.json at /Library/Application Support/Other/settings.json'})).checks.debugPathsInsideTrial.pass, false);
  assert.equal(checkProbe(base({debug: 'reading ~/.claude/settings.json'})).checks.debugPathsInsideTrial.pass, false);
  assert.equal(checkProbe(base({debug: 'reading /h/.claude/CLAUDE.md'})).checks.debugPathsInsideTrial.pass, false);
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

test('P: the pointer is the last line of CLAUDE.md, so the first/last-line answer shows it (N3)', () => {
  const pText = `1. ${work}/CLAUDE.md 最初の行: # ユーザー管理API / 最後の行: このプロジェクトでASCを使う開発の開始・再開・PR提出…\nDESC asc: ascの説明。\nDESC user-journey-acceptance: user-journey-acceptanceの説明。\n4 拒否 5 拒否\nGIT: ${NEUTRAL_SUBJECT} | Install ASC | initial`;
  assert.equal(checkProbe(base({condition: 'P', trace: trace({text: pText})})).pass, true);
  assert.equal(checkProbe(base({condition: 'P'})).checks.pointerMatchesCondition.pass, false); // last line without pointer
});

test('hook events: shapes by event name, counts against the log (L-1)', () => {
  const ev = (o) => ({type: 'system', subtype: 'hook_response', ...o});
  const log = '{"event":"SessionStart","source":"startup"}\n';
  const hText = goodText('\nSessionStart: このプロジェクトでASCを使う開発の…');
  // name-only events (no command field) are accepted for the fixture hook
  assert.equal(checkProbe(base({condition: 'H', trace: trace({text: hText, hooks: [ev({hook_name: 'SessionStart:startup'})]}), hookLog: log})).pass, true);
  // more SessionStart responses than the fixture hook logged: another hook ran
  const two = checkProbe(base({condition: 'H', trace: trace({text: hText, hooks: [ev({hook_name: 'SessionStart:startup'}), ev({hook_name: 'SessionStart:startup'})]}), hookLog: log}));
  assert.equal(two.checks.noForeignHooks.pass, false);
  // a non-SessionStart hook event is foreign in any condition
  assert.equal(checkProbe(base({trace: trace({text: goodText(), hooks: [ev({hook_event_name: 'UserPromptSubmit'})]})})).checks.noForeignHooks.pass, false);
  // without a hook, any SessionStart response fails
  assert.equal(checkProbe(base({trace: trace({text: goodText(), hooks: [ev({hook_name: 'SessionStart:startup'})]})})).pass, false);
});

test('compare: conditions may differ only by CLAUDE.md / hook output (M1); git subjects compared as a set (L-7)', () => {
  const r = checkProbe(base({}));
  const pText = goodText().replace('最後の行: TypeScript/Expressのユーザー管理API。', '最後の行: このプロジェクトでASCを使う開発の…').replace(`GIT: ${NEUTRAL_SUBJECT} | Install ASC | initial`, `GIT: initial |  ${NEUTRAL_SUBJECT}|Install ASC`);
  const p = checkProbe(base({condition: 'P', trace: trace({text: pText})}));
  assert.equal(p.pass, true, JSON.stringify(p.checks));
  assert.equal(compareProbes([r, p]).pass, true);
  const other = checkProbe(base({condition: 'P', trace: trace({text: pText, skills: [...ASC, 'dataviz', 'extra']})}));
  assert.deepEqual(compareProbes([r, other]).differ, ['nonAscSkills']);
  assert.deepEqual(gitSubjects(' b | a|b '), ['a', 'b']);
  assert.deepEqual(gitSubjects('55c4bad Update project files | 8372d40 Install ASC | edf4f07 initial'), gitSubjects('Update project files | Install ASC | initial'));
  assert.deepEqual(gitSubjects('55c4bad Adopt ASC read trigger | Install ASC'), ['Adopt ASC read trigger', 'Install ASC']);
  assert.deepEqual(gitSubjects('abcdef X'), ['abcdef X']);
  assert.deepEqual(gitSubjects('55c4bad: X'), ['55c4bad: X']);
  assert.deepEqual(gitSubjects('deadbeef'), ['deadbeef']);
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

test('ledger: cumulative by unique id, reserved at budget until settled, duplicate names refused, sequential (M4, N1)', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-ledger-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  const f = path.join(d, 'ledger.jsonl');
  assert.equal(ledger.spent(f), 0);
  const a = ledger.reserve(f, 'R-asc-1-1', 0.6).id; ledger.settle(f, a, 'R-asc-1-1', 0.21);
  ledger.reserve(f, 'R-asc-1-2', 0.6); // parent killed: never settled
  const c = ledger.reserve(f, 'P-asc-1-1', 0.6).id; ledger.settle(f, c, 'P-asc-1-1', null); // no cost reported
  assert.equal(Number(ledger.spent(f).toFixed(2)), 1.41);
  assert.throws(() => ledger.reserve(f, 'R-asc-1-1', 0.6), /already in the ledger/); // rerun under the same name
  // even if a duplicate name got in (hand-edited ledger), both reservations count by id
  fs.appendFileSync(f, JSON.stringify({id: 'x1', trial: 'R-probe-1', reservedUsd: 0.6}) + '\n' + JSON.stringify({id: 'x1', trial: 'R-probe-1', costUsd: 0.3}) + '\n');
  fs.appendFileSync(f, JSON.stringify({id: 'x2', trial: 'R-probe-1', reservedUsd: 0.6}) + '\n');
  assert.equal(Number(ledger.spent(f).toFixed(2)), 2.31);
  const unlock = ledger.lock(f);
  assert.throws(() => ledger.lock(f), /locked/);
  unlock();
  ledger.lock(f)();
});

test('fixation: a change to a fixed file is detected; stage 3 may only add conditions.I and fill phase3 (N2)', (t) => {
  const now = digests();
  assert.deepEqual(differences({files: now}), []);
  assert.deepEqual(differences({files: {...now, 'cases.json': 'x'}}), ['cases.json']);
  assert.ok(FIXED.includes('decision-criteria.md') && FIXED.includes('harness/score.mjs'));
  const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-fix-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const f of FIXED) { fs.mkdirSync(path.dirname(path.join(root, f)), {recursive: true}); fs.copyFileSync(path.join(ev, f), path.join(root, f)); }
  const first = {files: digests(root), invariants: invariantDigests(root)};
  assert.deepEqual(stage3Violations(first, root).sort(), ['conditions.I is not defined', 'release.json phase3 is not filled']);
  const cj = JSON.parse(fs.readFileSync(path.join(root, 'conditions.json'), 'utf8'));
  cj.conditions.I = {label: 'I', pointer: false, hook: 'product', pointerDelivered: true, adopt: 'claude-hook', core: true};
  fs.writeFileSync(path.join(root, 'conditions.json'), JSON.stringify(cj, null, 1));
  const rj = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
  rj.phase3 = {tag: 'v0.5.200', assetSha256: 'a'.repeat(64)};
  fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify(rj, null, 1));
  assert.deepEqual(stage3Violations(first, root), []);
  cj.runs = 3; fs.writeFileSync(path.join(root, 'conditions.json'), JSON.stringify(cj));
  assert.deepEqual(stage3Violations(first, root), ['conditions.json changed beyond adding conditions.I']);
  cj.runs = CONDS.runs; fs.writeFileSync(path.join(root, 'conditions.json'), JSON.stringify(cj));
  fs.appendFileSync(path.join(root, 'harness/score.mjs'), '\n');
  assert.deepEqual(stage3Violations(first, root), ['harness/score.mjs changed']);
  rj.B.assetSha256 = 'b'.repeat(64); fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify(rj));
  assert.ok(stage3Violations(first, root).includes('release.json changed beyond filling phase3'));
});

test('stage 3: only condition-i.mjs may change, with a reason and a review; the conditionISchema is enforced (M-1, L-d)', (t) => {
  const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-fix3-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const f of FIXED) { fs.mkdirSync(path.dirname(path.join(root, f)), {recursive: true}); fs.copyFileSync(path.join(ev, f), path.join(root, f)); }
  const first = {files: digests(root), invariants: invariantDigests(root)};
  const cj = JSON.parse(fs.readFileSync(path.join(root, 'conditions.json'), 'utf8'));
  cj.conditions.I = {label: 'I', pointer: false, hook: 'product', pointerDelivered: true, adopt: 'claude-hook', core: true};
  fs.writeFileSync(path.join(root, 'conditions.json'), JSON.stringify(cj, null, 1));
  const rj = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
  rj.phase3 = {tag: 'v0.5.200', assetSha256: 'a'.repeat(64)}; fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify(rj, null, 1));
  fs.appendFileSync(path.join(root, 'harness/condition-i.mjs'), '// adapted to the released flag name\n');
  assert.deepEqual(stage3Violations(first, root), ['harness/condition-i.mjs changed without --reason and --review']);
  assert.deepEqual(stage3Violations(first, root, {'harness/condition-i.mjs': {reason: 'flag renamed', review: 'review #3'}}), []);
  const shaped = {...first, conditionIShape: moduleShape(fs.readFileSync(path.join(ev, 'harness/condition-i.mjs'), 'utf8'))};
  assert.deepEqual(stage3Violations(shaped, root, {'harness/condition-i.mjs': {reason: 'r', review: 'v'}}), []);
  const ci = fs.readFileSync(path.join(root, 'harness/condition-i.mjs'));
  fs.appendFileSync(path.join(root, 'harness/condition-i.mjs'), "export const productHookFiredInTrial2 = () => true;\nprocess.env.X = '1';\n");
  const v = stage3Violations(shaped, root, {'harness/condition-i.mjs': {reason: 'r', review: 'v'}});
  assert.ok(v.includes('condition-i.mjs exports changed') && v.includes('condition-i.mjs has top-level statements'), v.join());
  fs.writeFileSync(path.join(root, 'harness/condition-i.mjs'), ci);
  assert.deepEqual(stage3Violations(first, root, {'harness/score.mjs': {reason: 'x', review: 'y'}}), ['harness/condition-i.mjs changed without --reason and --review', 'harness/score.mjs is not changeable at stage 3']);
  fs.appendFileSync(path.join(root, 'harness/probe-check.mjs'), '\n');
  assert.ok(stage3Violations(first, root, {'harness/condition-i.mjs': {reason: 'r', review: 'v'}}).includes('harness/probe-check.mjs changed'));
  assert.deepEqual(conditionIProblems({label: 'I', pointer: false, hook: 'product', pointerDelivered: true, adopt: 'claude-hook', core: true}), []);
  assert.ok(conditionIProblems({label: 'I', pointer: true, hook: 'usage', pointerDelivered: false, adopt: '', extra: 1}).length >= 5);
  assert.deepEqual(conditionIProblems(undefined), ['conditions.I is not defined']);
});

test('ledger id and seq: one ledger, each seq once; a copied earlier state is detected (N-1 (d))', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-lid-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  const f = path.join(d, 'l.jsonl');
  const id = ledger.create(f);
  assert.throws(() => ledger.create(f), /exists/);
  assert.equal(ledger.ledgerId(f), id); assert.equal(ledger.spent(f), 0);
  assert.equal(ledger.reserve(f, 'R-probe-1', 0.6).seq, 0); assert.equal(ledger.reserve(f, 'R-asc-1-1', 0.6).seq, 1);
  assert.deepEqual(ledger.ledgerConsistency([{trial: 'a', ledgerId: id, ledgerSeq: 1}, {trial: 'b', ledgerId: id, ledgerSeq: 2}]), []);
  assert.match(ledger.ledgerConsistency([{trial: 'a', ledgerId: id, ledgerSeq: 1}, {trial: 'b', ledgerId: 'other', ledgerSeq: 2}]).join(), /2 ledger id/);
  assert.match(ledger.ledgerConsistency([{trial: 'a', ledgerId: id, ledgerSeq: 1}, {trial: 'b', ledgerId: id, ledgerSeq: 1}]).join(), /seq 1 repeated/);
  assert.match(ledger.ledgerConsistency([{trial: 'a', ledgerSeq: 1}]).join(), /without an id/);
});

test('refix: recorded ledger, probe reservations only, only probe-check.mjs may change (N-1 (b)(c))', (t) => {
  const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-refix-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  const root = path.join(d, 'ev');
  for (const f of FIXED) { fs.mkdirSync(path.dirname(path.join(root, f)), {recursive: true}); fs.copyFileSync(path.join(ev, f), path.join(root, f)); }
  const lf = path.join(d, 'ledger.jsonl');
  const base = {files: digests(root), ledgerId: null};
  assert.deepEqual(refixViolations(base, path.join(d, 'absent.jsonl'), root), ['the ledger file does not exist']);
  base.ledgerId = ledger.create(lf);
  assert.deepEqual(refixViolations(base, lf, root), ['the ledger has no probe reservation']);
  ledger.reserve(lf, 'R-probe-1', 0.6);
  assert.deepEqual(refixViolations(base, lf, root), []);
  fs.appendFileSync(path.join(root, 'harness/probe-check.mjs'), '\n');
  assert.deepEqual(refixViolations(base, lf, root), []);
  for (const f of ['harness/score.mjs', 'cases.json', 'decision-criteria.md']) {
    const orig = fs.readFileSync(path.join(root, f)); fs.appendFileSync(path.join(root, f), ' ');
    assert.ok(refixViolations(base, lf, root).some((x) => x.startsWith(`${f} changed`)), f);
    fs.writeFileSync(path.join(root, f), orig);
  }
  const cj = JSON.parse(fs.readFileSync(path.join(root, 'conditions.json'), 'utf8')); cj.budget.capUsd = 100;
  fs.writeFileSync(path.join(root, 'conditions.json'), JSON.stringify(cj));
  assert.ok(refixViolations(base, lf, root).includes('conditions.json changed (refix may change only harness/probe-check.mjs)'));
  assert.ok(refixViolations({...base, ledgerId: 'other'}, lf, root).includes('the ledger is not the one recorded at init'));
  ledger.reserve(lf, 'R-asc-1-1', 0.6);
  assert.ok(refixViolations(base, lf, root).some((x) => /stage-1\/2 trials exist/.test(x)));
});

test('a refix record later than the first stage-1/2 reservation is refused at run time (N-1 (a))', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-late-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  const lf = path.join(d, 'l.jsonl'); ledger.create(lf);
  ledger.reserve(lf, 'R-probe-1', 0.6);
  assert.deepEqual(refixAfterMeasurement({records: [{at: '2099-01-01T00:00:00Z', refix: {}}]}, lf), []);
  ledger.reserve(lf, 'R-asc-1-1', 0.6);
  assert.deepEqual(refixAfterMeasurement({records: [{at: '2000-01-01T00:00:00Z', refix: {}}]}, lf), []);
  assert.deepEqual(refixAfterMeasurement({records: [{at: '2099-01-01T00:00:00Z', refix: {}}]}, lf), ['2099-01-01T00:00:00Z']);
});

test('condition-i.mjs shape: exports, imports and no top-level statements are checked at stage 3 (L-1)', () => {
  const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const shape = moduleShape(fs.readFileSync(path.join(ev, 'harness/condition-i.mjs'), 'utf8'));
  assert.deepEqual(shape.exports, ['adoptFromPlan', 'pointerExpectedI', 'pointerHeadI', 'productHookFiredInProbe', 'productHookFiredInTrial']);
  assert.deepEqual(shape.sideEffects, []);
  assert.deepEqual(moduleShape("import x from 'y';\nglobalThis.z = 1;\nexport const a = 1;\n").sideEffects, ['globalThis.z = 1;']);
});

test('fixation file must be committed, its commits in history, and the first commit named in README (L-c)', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-fxfile-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  const git = (a) => spawnSync('git', a, {cwd: d, env: gitEnv(d), encoding: 'utf8'});
  git(['init', '-q', '-b', 'main']); fs.mkdirSync(path.join(d, 'results'));
  fs.writeFileSync(path.join(d, 'README.md'), 'x'); git(['add', '-A']); git(['commit', '-q', '-m', 'a']);
  const c1 = git(['rev-parse', 'HEAD']).stdout.trim();
  const fx = {records: [{fixedAtCommit: c1}]};
  fs.writeFileSync(path.join(d, 'results/fixation.json'), JSON.stringify(fx));
  assert.match(fixationFileProblems(fx, d).join(), /not committed/);
  assert.match(fixationFileProblems(fx, d).join(), /README.md does not name/);
  fs.writeFileSync(path.join(d, 'README.md'), `fixed at ${c1}`); git(['add', '-A']); git(['commit', '-q', '-m', 'b']);
  assert.deepEqual(fixationFileProblems(fx, d), []);
  assert.match(fixationFileProblems({records: [{fixedAtCommit: c1}, {fixedAtCommit: 'f'.repeat(40)}]}, d).join(), /not in HEAD's history/);
});

test('the token value is found in child files by count only', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-secret-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  fs.mkdirSync(path.join(d, 'a/b'), {recursive: true});
  fs.writeFileSync(path.join(d, 'a/b/c.json'), '{"t":"SECRET-123"}'); fs.writeFileSync(path.join(d, 'x'), 'none');
  assert.equal(filesContaining(d, 'SECRET-123'), 1); assert.equal(filesContaining(d, ''), 0);
});

test('run path requires the pinned install of the condition, clean at the recorded HEAD, entries matching, and the adopted option (L-2, L-b, #1817)', (t) => {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-inst-'));
  t.after(() => fs.rmSync(w, {recursive: true, force: true}));
  const git = (a) => spawnSync('git', a, {cwd: w, env: gitEnv(w), encoding: 'utf8'});
  fs.mkdirSync(path.join(w, '.claude/skills/asc'), {recursive: true}); fs.mkdirSync(path.join(w, '.agent-skill-chain/skills/asc'), {recursive: true});
  fs.writeFileSync(path.join(w, '.claude/skills/asc/SKILL.md'), 'entry'); fs.writeFileSync(path.join(w, '.agent-skill-chain/distribution.json'), '{}');
  fs.writeFileSync(path.join(w, '.agent-skill-chain/skills/asc/SKILL.md'), 'body');
  git(['init', '-q', '-b', 'main']); git(['add', '-A']); git(['commit', '-q', '-m', 'Install ASC']);
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const rel = pinnedFor('B').assetSha256, cand = pinnedFor('S').assetSha256;
  const good = {condition: 'B', source: 'release', pinned: true, released: true, sampleHead: head, install: {tarballSha256: rel, entries: [{name: 'asc', entrySha256: h('entry')}], distributionSha256: h('{}'), adopted: null}};
  const goodS = {...good, condition: 'S', source: 'candidate', released: false, install: {...good.install, tarballSha256: cand}};
  assert.deepEqual(installProblems(good, w, {}, 'B'), []);
  assert.deepEqual(installProblems(goodS, w, {}, 'S'), []);
  assert.match(installProblems(null, w, {}, 'B').join(), /no install record/);
  assert.match(installProblems({...good, pinned: false, source: 'unpinned', released: false}, w, {}, 'B').join(), /not installed from the pinned tarball/);
  assert.match(installProblems({...good, install: {...good.install, tarballSha256: 'x'}}, w, {}, 'B').join(), /not the one release.json pins/);
  // #1817 pairing: an S fixture (candidate) is refused for B, a B fixture (release) for S, and any other condition.
  const bForS = installProblems(goodS, w, {}, 'B').join();
  assert.match(bForS, /built for condition S, not B/); assert.match(bForS, /source candidate is not the release/); assert.match(bForS, /not the one release.json pins for condition B/);
  const sForB = installProblems(good, w, {}, 'S').join();
  assert.match(sForB, /built for condition B, not S/); assert.match(sForB, /source release is not the candidate/); assert.match(sForB, /not the one release.json pins for condition S/);
  assert.match(installProblems({...good, condition: 'S', source: 'candidate', released: false}, w, {}, 'S').join(), /not the one release.json pins for condition S/); // relabelled release tarball
  assert.match(installProblems({...good, condition: 'I'}, w, {}, 'I').join(), /pins no tarball for condition I/);
  assert.match(installProblems({...good, sampleHead: 'f'.repeat(40)}, w, {}, 'B').join(), /HEAD differs/);
  fs.writeFileSync(path.join(w, '.agent-skill-chain/skills/asc/SKILL.md'), 'edited body'); // body edit: caught by the clean-tree check
  assert.match(installProblems(good, w, {}, 'B').join(), /uncommitted or untracked/);
  git(['checkout', '-q', '--', '.']);
  fs.writeFileSync(path.join(w, 'AGENTS.md'), 'added later');
  assert.match(installProblems(good, w, {}, 'B').join(), /uncommitted or untracked/);
  fs.rmSync(path.join(w, 'AGENTS.md'));
  fs.writeFileSync(path.join(w, '.claude/skills/asc/SKILL.md'), 'edited');
  assert.match(installProblems(good, w, {}, 'B').join(), /entry asc differs/);
  git(['checkout', '-q', '--', '.']);
  assert.match(installProblems(good, w, {adopt: 'claude-hook'}, 'B').join(), /does not match the condition/);
});

test('condition I: the pointer may appear anywhere in the answer, not only as the last line (M-1)', () => {
  const iText = goodText().replace('最後の行: TypeScript/Expressのユーザー管理API。', '最後の行: <!-- /asc:read-trigger -->') + '\nREAD-TRIGGER: このプロジェクトでASCを使う開発の開始…';
  const own = {type: 'system', subtype: 'hook_response', hook_name: 'SessionStart:startup'};
  const withI = (o) => ({...base(o), condition: 'I'});
  const conds = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../conditions.json'), 'utf8'));
  conds.conditions.I = {label: 'I', pointer: false, hook: 'product', pointerDelivered: true, adopt: 'claude-hook', core: true};
  const r = checkProbe({...withI({trace: trace({text: iText, hooks: [own]})}), conditionsOverride: conds});
  assert.equal(r.checks.pointerMatchesCondition.pass, true, JSON.stringify(r.checks));
  assert.equal(r.checks.hookMatchesCondition.pass, true, JSON.stringify(r.checks));
  const none = checkProbe({...withI({trace: trace({text: goodText(), hooks: [own]})}), conditionsOverride: conds});
  assert.equal(none.checks.pointerMatchesCondition.pass, false);
});

test('every condition gets one commit with the same neutral subject (M1)', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-commit-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  const subjects = {};
  for (const c of ['B', 'S']) {
    const w = path.join(d, c);
    fs.mkdirSync(path.join(w, '.agent-skill-chain/v05'), {recursive: true});
    fs.writeFileSync(path.join(w, 'CLAUDE.md'), '# x\n\n<!-- asc:read-trigger v1 -->\nこのプロジェクトでASCを使う。\n<!-- /asc:read-trigger -->\n');
    fs.writeFileSync(path.join(w, '.agent-skill-chain/v05/USAGE.md'), '### ASCを読む契機を利用先へ採用する（任意）\n\n```text\nこのプロジェクトでASCを使う。\n```\n');
    const git = (a) => spawnSync('git', a, {cwd: w, env: gitEnv(w), encoding: 'utf8'});
    git(['init', '-q', '-b', 'main']); git(['add', '-A']); git(['commit', '-q', '-m', 'initial']);
    const md = fs.readFileSync(path.join(w, 'CLAUDE.md'), 'utf8');
    const a = applyCondition(w, c);
    assert.deepEqual(a.changedFiles, []); assert.equal(fs.readFileSync(path.join(w, 'CLAUDE.md'), 'utf8'), md); // adopted CLAUDE.md kept
    subjects[c] = git(['log', '--format=%s']).stdout.trim().split('\n');
  }
  assert.deepEqual(subjects.B, [NEUTRAL_SUBJECT, 'initial']);
  assert.deepEqual(subjects.S, subjects.B);
});

test('#1817 probe: B and S expect the adopted pointer anywhere in the answer and no hook', () => {
  const iText = goodText().replace('最後の行: TypeScript/Expressのユーザー管理API。', '最後の行: <!-- /asc:read-trigger -->') + '\nREAD-TRIGGER: このプロジェクトでASCを使う開発の開始…';
  for (const c of ['B', 'S']) {
    const r = checkProbe(base({condition: c, conditionsOverride: CONDS, trace: trace({text: iText})}));
    assert.equal(r.pass, true, JSON.stringify(r.checks));
    assert.equal(checkProbe(base({condition: c, conditionsOverride: CONDS})).checks.pointerMatchesCondition.pass, false);
    const hooked = checkProbe(base({condition: c, conditionsOverride: CONDS, trace: trace({text: iText, hooks: [{type: 'system', subtype: 'hook_response', hook_name: 'SessionStart:startup'}]})}));
    assert.equal(hooked.pass, false);
  }
});

test('#1817 release.json pins B to the release and S to the candidate; make-fixture refuses the wrong pairing', (t) => {
  const rel = JSON.parse(fs.readFileSync(path.join(EV, 'release.json'), 'utf8'));
  assert.deepEqual(pinnedFor('B'), {condition: 'B', kind: 'release', assetSha256: rel.B.assetSha256});
  assert.deepEqual(pinnedFor('S'), {condition: 'S', kind: 'candidate', assetSha256: rel.S.assetSha256});
  assert.equal(pinnedFor('I'), null); assert.equal(pinnedFor('R'), null);
  assert.equal(pinnedFor('B', {B: {...rel.B, kind: 'candidate'}}), null); // B only from a release
  assert.equal(pinnedFor('S', {S: {...rel.S, kind: 'release'}}), null); // S only from a candidate
  assert.deepEqual(Object.keys(CONDS.conditions), ['B', 'S']);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1817-pair-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  // The digest check runs before anything is built: the candidate digest for B, the release digest for S, unknown condition.
  assert.throws(() => makeFixture('B', path.join(d, 'x.tgz'), rel.S.assetSha256, path.join(d, 'fb'), d), /not the release digest release.json pins for condition B/);
  assert.throws(() => makeFixture('S', path.join(d, 'x.tgz'), rel.B.assetSha256, path.join(d, 'fs'), d), /not the candidate digest release.json pins for condition S/);
  assert.throws(() => makeFixture('I', path.join(d, 'x.tgz'), rel.B.assetSha256, path.join(d, 'fi'), d), /unknown condition I/);
  assert.equal(fs.existsSync(path.join(d, 'fb')) || fs.existsSync(path.join(d, 'fs')), false);
});
