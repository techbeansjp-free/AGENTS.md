// Synthetic-transcript tests for score.mjs, collect.mjs and apply-condition.mjs (#1814). No model call.
// Usage: node --test docs/evidence/1814-skill-invocation/harness/score.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTrace, scoreRun, scoreDir, summarize, judge, shortfall, markersOk, projectRelative, selectCounted} from './score.mjs';
import {redact, scrubSensitive, collect} from './collect.mjs';
import {pointerText, hookScript} from './apply-condition.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.join(here, '../cases.json'), 'utf8'));
const kase = (id) => spec.cases.find((c) => c.id === id);

// Builds a stream-json transcript. steps: [{tool, input, error}] or {text}; result: {text, subtype, is_error, cost}.
let seq = 0;
function trace(steps, result = {}, cwd = '/w') {
  const lines = [{type: 'system', subtype: 'init', cwd, model: 'test-model', tools: ['Read', 'Glob', 'Grep', 'Skill']}];
  for (const s of steps) {
    if (s.text) { lines.push({type: 'assistant', message: {content: [{type: 'text', text: s.text}]}}); continue; }
    if (s.hook) { lines.push({type: 'system', subtype: 'hook_response', hook_event: 'SessionStart'}); continue; }
    const id = `toolu_${++seq}`;
    lines.push({type: 'assistant', message: {content: [{type: 'tool_use', id, name: s.tool, input: s.input}]}});
    if (!s.noResult) lines.push({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: id, is_error: Boolean(s.error), content: s.error ? 'denied' : 'ok'}]}});
  }
  if (result !== null) lines.push({type: 'result', subtype: result.subtype ?? 'success', is_error: result.is_error ?? false, result: result.text ?? '', total_cost_usd: result.cost ?? 0.2, num_turns: 3, duration_ms: 1000});
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}
const read = (p, error = false) => ({tool: 'Read', input: {file_path: p}, error});
const body = (s) => `/w/.agent-skill-chain/skills/${s}/SKILL.md`;
const ref = (s, r) => `/w/.agent-skill-chain/skills/${s}/references/${r}`;

test('asc case: body + reference + markers => applied', () => {
  const t = parseTrace(trace([{tool: 'Skill', input: {skill: 'asc'}}, read(body('asc')), read(ref('asc', 'workspace.md'))], {text: 'worktree-create で .worktrees に作る。worktree'}));
  const r = scoreRun(spec, kase('asc-1'), t);
  assert.equal(r.reach, true); assert.equal(r.bodyRead, true); assert.equal(r.referenceRead, true); assert.equal(r.markers, true); assert.equal(r.applied, true);
});

test('Skill tool alone is the first hop only', () => {
  const r = scoreRun(spec, kase('asc-1'), parseTrace(trace([{tool: 'Skill', input: {skill: 'project:asc'}}], {text: 'worktree-create worktree'})));
  assert.equal(r.entryHop, true); assert.equal(r.reach, true); assert.equal(r.bodyRead, false); assert.equal(r.applied, false);
});

test('two hops: thin entry Read, then body by a relative path resolved against the project root', () => {
  const t = parseTrace(trace([read('.claude/skills/asc/SKILL.md'), read('.claude/skills/asc/../../../.agent-skill-chain/skills/asc/SKILL.md'), read('.agent-skill-chain/skills/asc/references/workspace.md')], {text: 'worktree-create worktree'}));
  const r = scoreRun(spec, kase('asc-1'), t);
  assert.deepEqual([r.entryHop, r.bodyRead, r.referenceRead, r.applied], [true, true, true, true]);
  assert.deepEqual(r.ascEntries, ['asc']);
});

test('paths outside the project root never match; /private/tmp equals /tmp', () => {
  assert.equal(projectRelative('/other/.agent-skill-chain/skills/asc/SKILL.md', '/w'), null);
  assert.equal(projectRelative('../x/.agent-skill-chain/skills/asc/SKILL.md', '/w'), null);
  assert.equal(projectRelative('/tmp/r/work/.claude/skills/asc/SKILL.md', '/private/tmp/r/work'), '.claude/skills/asc/SKILL.md');
  const r = scoreRun(spec, kase('asc-1'), parseTrace(trace([read('/repo/.agent-skill-chain/skills/asc/SKILL.md')], {text: 'worktree'})));
  assert.equal(r.bodyRead, false); assert.equal(r.unselected, true);
});

test('a refused or unanswered Read does not count as read', () => {
  const t = parseTrace(trace([read(body('asc'), true), {tool: 'Read', input: {file_path: ref('asc', 'workspace.md')}, noResult: true}], {text: 'worktree-create worktree'}));
  const r = scoreRun(spec, kase('asc-1'), t);
  assert.equal(r.bodyRead, false); assert.equal(r.readAttempts, 2); assert.equal(r.unselected, true);
});

test('the registered entry (.claude/skills) is not the body', () => {
  const r = scoreRun(spec, kase('asc-1'), parseTrace(trace([read('/w/.claude/skills/asc/SKILL.md')], {text: 'worktree'})));
  assert.equal(r.bodyRead, false); assert.equal(r.entryHop, true); assert.equal(r.unselected, false);
});

test('managed-runtime body path counts', () => {
  const r = scoreRun(spec, kase('rr-1'), parseTrace(trace([read('/w/.agent-skill-chain/managed-runtime/skills/review-and-remediation/SKILL.md'), read('/w/.agent-skill-chain/managed-runtime/skills/review-and-remediation/references/review-method.md')], {text: '認可の確認が無い'})));
  assert.equal(r.applied, true);
});

test('misselect: another ASC body read instead of the expected one', () => {
  const r = scoreRun(spec, kase('asc-2'), parseTrace(trace([read(body('execution-recovery'))], {text: 'worktree start'})));
  assert.equal(r.reach, false); assert.equal(r.misselect, true); assert.equal(r.unselected, false);
});

test('answerGroups require every group (ui-1)', () => {
  const k = kase('ui-1');
  assert.equal(markersOk(k, '0件のとき、通信失敗のとき、再読込み後を確かめる'), true);
  assert.equal(markersOk(k, '0件のとき、通信失敗のときを確かめる'), false);
});

test('secondary Skill is recorded but not required (asc-3)', () => {
  const r = scoreRun(spec, kase('asc-3'), parseTrace(trace([read(body('asc')), read(ref('asc', 'implementation.md')), read(body('user-journey-acceptance'))], {text: '専用の worktree で進める'})));
  assert.equal(r.applied, true); assert.deepEqual(r.secondaryRead, {'user-journey-acceptance': true});
});

test('negative: an ASC body read or Skill call is overapplication', () => {
  assert.equal(scoreRun(spec, kase('neg-1'), parseTrace(trace([], {text: 'Added search.'}))).overapplication, false);
  assert.equal(scoreRun(spec, kase('neg-1'), parseTrace(trace([read(body('asc'))], {text: 'Added search.'}))).overapplication, true);
  assert.equal(scoreRun(spec, kase('neg-2'), parseTrace(trace([{tool: 'Skill', input: {skill: 'asc'}}], {text: 'PATCH'}))).overapplication, true);
  assert.equal(scoreRun(spec, kase('neg-3'), parseTrace(trace([read('.claude/skills/asc/SKILL.md')], {text: '@'}))).overapplication, true);
  const bundled = scoreRun(spec, kase('neg-2'), parseTrace(trace([{tool: 'Skill', input: {skill: 'dataviz'}}], {text: 'PATCH'})));
  assert.equal(bundled.overapplication, false); assert.deepEqual(bundled.otherSkillCalls, ['dataviz']);
});

test('budget stop is scored with the last text; API error is a failure', () => {
  const stopped = scoreRun(spec, kase('asc-1'), parseTrace(trace([read(body('asc')), {text: 'worktree-create worktree'}], {subtype: 'error_max_budget_usd', is_error: true, text: ''})));
  assert.equal(stopped.failure, undefined); assert.equal(stopped.stopped, 'error_max_budget_usd'); assert.equal(stopped.bodyRead, true);
  const failed = scoreRun(spec, kase('asc-1'), parseTrace(trace([], {subtype: 'error_during_execution', is_error: true, text: 'API Error: 529'})));
  assert.match(failed.failure, /result error/);
  assert.equal(scoreRun(spec, kase('asc-1'), parseTrace(trace([], null))).failure, 'no result event');
});

test('scoreDir: names, multi-letter conditions, hook log, missing trace', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-score-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'PH-asc-1-1.jsonl'), trace([{hook: true}, read(body('asc')), read(ref('asc', 'workspace.md'))], {text: 'worktree-create worktree', cost: 0.3}));
  fs.writeFileSync(path.join(dir, 'PH-asc-1-1.hook.jsonl'), '{"event":"SessionStart","source":"startup"}\n');
  fs.writeFileSync(path.join(dir, 'PH-neg-1-1.jsonl'), trace([], {text: 'search', cost: 0.1}));
  fs.writeFileSync(path.join(dir, 'PH-neg-1-1.hook.jsonl'), '{"source":"startup"}\n');
  fs.writeFileSync(path.join(dir, 'PH-rr-1-1.jsonl.missing'), 'no trace\n');
  fs.writeFileSync(path.join(dir, 'R-asc-1-1.jsonl'), trace([], {text: 'plan'}));
  fs.writeFileSync(path.join(dir, 'PH-neg-2-1.jsonl'), trace([], {text: 'PATCH', cost: 0.1}));
  fs.writeFileSync(path.join(dir, 'PH-neg-2-1.hook.jsonl'), '');
  const runs = scoreDir(spec, dir, ['PH']);
  assert.equal(runs.length, 4);
  const s = summarize(spec, runs, 'PH');
  assert.deepEqual([s.runs, s.failures, s.positives, s.applied, s.negatives, s.overapplication, s.hookFired], [4, 2, 1, 1, 1, 0, 2]);
  assert.equal(runs.find((r) => r.case === 'neg-2').failure, 'hook did not fire');
  assert.equal(s.perCase['asc-1'], 'A'); assert.equal(s.perCase['neg-1'], '-'); assert.equal(s.costUsd, 0.5);
});

const S = (o) => ({condition: 'X', runs: 28, failures: 0, positives: 22, negatives: 6, bodyRead: 0, applied: 0, overapplication: 0, ...o});
test('judge: owner pass level', () => {
  const base = S({condition: 'R', bodyRead: 10, applied: 5, overapplication: 0});
  assert.equal(judge(base, S({bodyRead: 18, applied: 6, overapplication: 1})).verdict, 'pass'); // 18/22 = 81.8%
  assert.equal(judge(base, S({bodyRead: 17, applied: 9})).verdict, 'fail'); // 77.3% < 80%
  assert.equal(judge(base, S({bodyRead: 22, applied: 5})).verdict, 'fail'); // application not above current
  assert.equal(judge(base, S({bodyRead: 22, applied: 9, overapplication: 2})).verdict, 'fail'); // current + 2
  assert.equal(judge(base, S({runs: 28, failures: 3, bodyRead: 22, applied: 9})).verdict, 'not-judged'); // 3/28 > 10%
  // rates, not counts, when valid trials differ
  assert.equal(judge(S({condition: 'R', positives: 22, applied: 11}), S({positives: 20, bodyRead: 20, applied: 11})).verdict, 'pass');
  assert.equal(shortfall(base), true); assert.equal(shortfall(S({bodyRead: 18})), false);
});

test('missing init event and an unfired hook in a hook condition are failures (L5, L6)', () => {
  const noInit = trace([read(body('asc'))], {text: 'worktree-create worktree'}).split('\n').slice(1).join('\n');
  assert.equal(scoreRun(spec, kase('asc-1'), parseTrace(noInit)).failure, 'no init event');
  const t = parseTrace(trace([read(body('asc'))], {text: 'worktree-create worktree'}));
  assert.equal(scoreRun(spec, kase('asc-1'), t, [], {expectHook: true}).failure, 'hook did not fire');
  assert.equal(scoreRun(spec, kase('asc-1'), t, null, {expectHook: true}).failure, 'hook did not fire');
  assert.equal(scoreRun(spec, kase('asc-1'), t, ['{"source":"startup"}'], {expectHook: true}).failure, undefined);
  assert.equal(scoreRun(spec, kase('asc-1'), t, null, {expectHook: false}).failure, undefined);
});

test('only planned reps count; a later rep only replaces a failed planned trial once (L-3)', () => {
  const r = (run, failure) => ({condition: 'R', case: 'asc-1', run, ...(failure ? {failure: 'x'} : {})});
  const rows = selectCounted([r(1), r(2, true), r(3), r(4)], 2);
  assert.deepEqual(rows.map((x) => [x.run, x.counted]), [[1, true], [2, false], [3, true], [4, false]]);
  assert.equal(rows[2].replaces, 2);
  const extraOnly = selectCounted([r(1), r(2), r(3)], 2);
  assert.deepEqual(extraOnly.map((x) => x.counted), [true, true, false]);
  const s = summarize(spec, [{...r(1), expect: 'asc', bodyRead: true, costUsd: 0.2, counted: true}, {...r(3), expect: 'asc', costUsd: 0.2, counted: false}], 'R');
  assert.deepEqual([s.runs, s.notCounted, s.costUsd], [1, 1, 0.4]);
});

test('product hook (condition I) is fired by SessionStart hook events in the trace', () => {
  const t = parseTrace(trace([{hook: true}, read(body('asc'))], {text: 'worktree-create worktree'}));
  assert.equal(scoreRun(spec, kase('asc-1'), t, [], {expectHook: 'product'}).failure, undefined);
  const none = parseTrace(trace([read(body('asc'))], {text: 'worktree-create worktree'}));
  assert.equal(scoreRun(spec, kase('asc-1'), none, [], {expectHook: 'product'}).failure, 'hook did not fire');
});

test('collect: a trace without meta.json becomes a failure row instead of a crash (L-6)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-collect-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'runs/R-asc-1-1'), {recursive: true});
  fs.writeFileSync(path.join(root, 'runs/R-asc-1-1/trace.jsonl'), trace([], {text: 'x'}));
  assert.equal(collect(path.join(root, 'runs'), path.join(root, 'out')), 1);
  assert.equal(fs.existsSync(path.join(root, 'out/R-asc-1-1.jsonl.missing')), true);
  assert.equal(fs.existsSync(path.join(root, 'out/R-asc-1-1.jsonl')), false);
});

test('collect extends trials.json across stages and refuses a trial already collected (L-e)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1814-collect2-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const mk = (runs, name) => { fs.mkdirSync(path.join(root, runs, name), {recursive: true}); fs.writeFileSync(path.join(root, runs, name, 'trace.jsonl'), trace([], {text: 'x'})); fs.writeFileSync(path.join(root, runs, name, 'meta.json'), JSON.stringify({costUsd: 0.1, ledgerId: 'L1', ledgerSeq: seq++})); };
  let seq = 0;
  mk('s1', 'R-asc-1-1'); mk('s3', 'I-asc-1-1'); mk('s3b', 'R-asc-1-1');
  collect(path.join(root, 's1'), path.join(root, 'out')); collect(path.join(root, 's3'), path.join(root, 'out'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'out/trials.json'), 'utf8')).map((r) => r.trial), ['R-asc-1-1', 'I-asc-1-1']);
  assert.throws(() => collect(path.join(root, 's3b'), path.join(root, 'out')), /already collected/);
  // a stage collected with another ledger (reset) or a repeated seq is refused
  mk('s4', 'H-asc-1-1'); fs.writeFileSync(path.join(root, 's4/H-asc-1-1/meta.json'), JSON.stringify({ledgerId: 'L2', ledgerSeq: 9}));
  assert.throws(() => collect(path.join(root, 's4'), path.join(root, 'out')), /ledger check failed/);
  mk('s5', 'P-asc-1-1'); fs.writeFileSync(path.join(root, 's5/P-asc-1-1/meta.json'), JSON.stringify({ledgerId: 'L1', ledgerSeq: 0}));
  assert.throws(() => collect(path.join(root, 's5'), path.join(root, 'out')), /seq 0 repeated/);
});

test('product hook: hookFired reflects the trace evidence in the summary (L-3)', () => {
  const t = parseTrace(trace([{hook: true}, read(body('asc'))], {text: 'worktree-create worktree'}));
  assert.equal(scoreRun(spec, kase('asc-1'), t, [], {expectHook: 'product'}).hookFired, true);
});

test('scrubSensitive replaces mail addresses, keys and account fields (L9)', () => {
  const r = scrubSensitive('a someone@example.org b sk-ant-api03-abcdefgh123 "oauthAccount":"x" ok');
  assert.equal(r.hits, 3); assert.equal(/@example|sk-ant|oauthAccount":"x/.test(r.text), false);
});

test('redact removes local paths and user-specific names', () => {
  const trial = '/private/tmp/x-1/-Users-someone-proj/runs/R-asc-1-1';
  const out = redact(`{"cwd":"${trial}/work","p":"/Users/someone/a","q":"/home/other/b","r":"/tmp/-Users-someone-x"}`, trial);
  assert.equal(out.includes('someone'), false); assert.equal(out.includes('other'), false); assert.match(out, /<trial>\/work/);
});

test('pointer text is extracted from v05/USAGE.md and the hook emits it as SessionStart context', (t) => {
  const usage = fs.readFileSync(path.join(here, '../../../../v05/USAGE.md'), 'utf8');
  const p = pointerText(usage);
  assert.match(p, /\.agent-skill-chain\/skills\/asc\/SKILL\.md/);
  assert.throws(() => pointerText('no section'));
  const script = hookScript();
  assert.match(script, /hookEventName: 'SessionStart'/); assert.match(script, /additionalContext/);
  t.diagnostic(`pointer chars=${p.length}`);
});
