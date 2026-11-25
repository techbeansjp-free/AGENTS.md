// Synthetic tests for probe-check.mjs and guard.mjs (#1814). No model call.
// Usage: node --test docs/evidence/1814-skill-invocation/harness/probe.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkProbe, description} from './probe-check.mjs';
import {placementProblems} from './guard.mjs';

const ASC = ['asc', 'contract-enforcement', 'decision-ownership', 'engineering-judgment', 'estimate-and-scope', 'execution-recovery', 'migration-assurance', 'project-foundation', 'research-to-implementation', 'review-and-remediation', 'security-evidence', 'subagent-model-selection', 'tracker-issue-writing', 'user-journey-acceptance', 'verification-optimization', 'work-coordination'];
const ascSkills = Object.fromEntries(ASC.map((s) => [s, `${s}の説明。`]));
const trial = '/t/R-probe-1', work = '/t/R-probe-1/work';
const HOME_M = '/h/home-marker-x.txt', REPO_M = '/r/.agent-skill-chain/local/repo-marker-x.txt';
let seq = 0;
function trace({skills = [...ASC, 'dataviz'], tools = ['Read', 'Glob', 'Grep', 'Skill'], text, reads = [[HOME_M, true], [REPO_M, true]], cwd = work, plugins = []}) {
  const lines = [{type: 'system', subtype: 'init', cwd, tools, mcp_servers: [], plugins, skills, model: 'm'}];
  for (const [p, err] of reads) {
    const id = `t${++seq}`;
    lines.push({type: 'assistant', message: {content: [{type: 'tool_use', id, name: 'Read', input: {file_path: p}}]}});
    lines.push({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: id, is_error: err, content: err ? 'denied' : 'x'}]}});
  }
  lines.push({type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.05});
  return lines.map((l) => JSON.stringify(l)).join('\n');
}
const goodText = (extra = '') => `1. ${work}/CLAUDE.md: # ユーザー管理API${extra}\nDESC asc: ascの説明。\nDESC user-journey-acceptance: user-journey-acceptanceの説明。\n4 拒否 5 拒否`;
const base = (o) => ({trace: trace({text: goodText()}), debug: `Loading ${trial}/work/CLAUDE.md\nskills from ${trial}/work/.claude/skills/asc`, stderr: '', hookLog: null, work, trialDir: trial,
  condition: 'R', ascSkills, baseFirstLine: '# ユーザー管理API', pointerHead: 'このプロジェクトでASCを使う', forbiddenTexts: ['agent-skill-chain 利用案内（Claude Code）'],
  markerPaths: [HOME_M, REPO_M], tokens: ['TOKEN-H', 'TOKEN-R'], realHome: '/h', repoRoot: '/r', ...o});

test('clean R probe passes', () => {
  const r = checkProbe(base({}));
  assert.equal(r.pass, true, JSON.stringify(r.checks)); assert.deepEqual(r.nonAscSkills, ['dataviz']);
});

test('each leak or mismatch fails the probe', () => {
  const fails = (o, key) => { const r = checkProbe(base(o)); assert.equal(r.pass, false); assert.equal(r.checks[key].pass, false, key); };
  fails({trace: trace({text: goodText(), skills: ASC.slice(1)})}, 'ascListed');
  fails({trace: trace({text: goodText(), tools: ['Read', 'Bash']})}, 'tools');
  fails({trace: trace({text: goodText(), plugins: [{name: 'p'}]})}, 'noPlugins');
  fails({trace: trace({text: goodText(), reads: [[HOME_M, false], [REPO_M, true]]})}, 'markersRefused');
  fails({trace: trace({text: goodText() + ' TOKEN-H'})}, 'markerTokensAbsent');
  fails({trace: trace({text: goodText('\n# agent-skill-chain 利用案内（Claude Code）')})}, 'noForeignInstructions');
  fails({trace: trace({text: goodText('\nこのプロジェクトでASCを使う開発の…')})}, 'pointerMatchesCondition');
  fails({condition: 'P'}, 'pointerMatchesCondition');
  fails({condition: 'H', trace: trace({text: goodText('\nこのプロジェクトでASCを使う開発の…')})}, 'hookMatchesCondition');
  fails({debug: 'Loading /h/.claude/CLAUDE.md'}, 'debugPathsInsideTrial');
  fails({debug: null}, 'debugPathsInsideTrial');
  fails({trace: trace({text: goodText().replace('DESC asc: ascの説明。', 'DESC asc: 別の文')})}, 'descriptionsInContext');
  fails({trace: trace({text: goodText(), reads: [[HOME_M, true], [REPO_M, true], [`${work}/.claude/skills/asc/SKILL.md`, false]]})}, 'descriptionsInContext');
  fails({trace: trace({text: goodText(), cwd: '/elsewhere'})}, 'cwd');
});

test('the Claude Code installation under the real HOME is not a leak, user configuration is', () => {
  const debug = 'loading bundled skills from /h/.local/share/claude/versions/9/skills/x\nexec /h/.local/share/claude/versions/9';
  assert.equal(checkProbe(base({debug, hostInstallDir: '/h/.local/share/claude'})).pass, true);
  assert.equal(checkProbe(base({debug, hostInstallDir: null})).pass, false);
  assert.equal(checkProbe(base({debug: debug + '\nread /h/.claude/settings.json', hostInstallDir: '/h/.local/share/claude'})).pass, false);
});

test('hook condition passes with pointer delivered and the hook log', () => {
  const r = checkProbe(base({condition: 'H', trace: trace({text: goodText('\nSessionStart: このプロジェクトでASCを使う開発の…')}), hookLog: '{"event":"SessionStart","source":"startup"}\n'}));
  assert.equal(r.pass, true, JSON.stringify(r.checks));
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
