// Synthetic-transcript tests for score.mjs, collect.mjs and apply-condition.mjs (#1817, copied from #1814). No model call.
// Usage: node --test docs/evidence/1817-skill-application/harness/score.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTrace, scoreRun, scoreDir, summarize, judge, judge1817, shortfall, markersOk, projectRelative, selectCounted} from './score.mjs';
import {redact, scrubSensitive, collect} from './collect.mjs';
import {pointerText, hookScript, loadConditions} from './apply-condition.mjs';
import {plannedTrials, orderProblems, orderRefusal, replacementPlan, loadOrder} from './order.mjs';
import {trialsToStart} from './run-all.mjs';
import * as ledgerOps from './ledger.mjs';

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
  const runs = scoreDir(spec, dir, ['PH'], {PH: 'usage'}, 2); // #1814 hook condition, given explicitly (not in #1817 conditions.json)
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

test('#1817: redacted public traces (<trial>/work) are scored like the unredacted ones', () => {
  assert.equal(projectRelative('<trial>/work/.agent-skill-chain/skills/asc/SKILL.md', '<trial>/work'), '.agent-skill-chain/skills/asc/SKILL.md');
  assert.equal(projectRelative('<scratch>/run/runs/P-asc-1-1/work/.claude/skills/asc/SKILL.md', '<scratch>/run/runs/P-asc-1-1/work'), '.claude/skills/asc/SKILL.md');
  assert.equal(projectRelative('<trial>/work/../x/SKILL.md', '<trial>/work'), null);
  assert.equal(projectRelative('<trial>/work', '<trial>/work'), null);
  assert.equal(projectRelative('.agent-skill-chain/skills/asc/SKILL.md', '<trial>/work'), '.agent-skill-chain/skills/asc/SKILL.md'); // relative to cwd
  const r = scoreRun(spec, kase('asc-1'), parseTrace(trace([read('<trial>/work/.agent-skill-chain/skills/asc/SKILL.md'), read('<trial>/work/.agent-skill-chain/skills/asc/references/workspace.md')], {text: 'worktree-create worktree'}, '<trial>/work')));
  assert.equal(r.applied, true);
});

test('#1817 relaxed markers: spelling variants pass, the procedure is still required', () => {
  const ri = kase('ri-1');
  assert.equal(markersOk(ri, '決定1 受入: 登録できる。未決: 対応端末'), true);
  assert.equal(markersOk(ri, '受け入れの確認と未決事項'), true);
  assert.equal(markersOk(ri, '受入条件と未決'), true);
  assert.equal(markersOk(ri, '決定1 受入: 登録できる'), false); // 未決 still required
  assert.equal(markersOk(ri, '未決: 対応端末'), false); // acceptance still required
  const a2 = kase('asc-2');
  assert.equal(markersOk(a2, 'worktreeの未コミットの変更を確かめる'), true);
  assert.equal(markersOk(a2, 'worktreeで続ける'), false);
  const ui = kase('ui-1');
  assert.equal(markersOk(ui, '一覧が空になること、通信失敗、再読込み'), true);
  assert.equal(markersOk(ui, '空のときの案内、エラー、リロード'), true);
  assert.equal(markersOk(ui, '空白を入れる、エラー、リロード'), false); // 空白 is not the empty state
  assert.equal(markersOk(ui, '空きポートで起動、エラー、リロード'), false);
  const es = kase('es-1');
  assert.equal(markersOk(es, '仮置き：3人日。調査が必要な部分は保存期間。未決：閲覧者'), true);
  assert.equal(markersOk(es, '前提：既存のログ基盤。確認が必要：保存期間。未決：閲覧者'), false); // 調査 is not relaxed
  assert.equal(markersOk(es, '調査：保存期間。未決：閲覧者'), false); // an assumption is still required
});

test('#1817 judge: applied above B, bodyRead not lower than B - 1, overapplication at most B + 1; targeted cases reported', () => {
  const S2 = (o) => ({condition: 'X', runs: 56, failures: 0, positives: 44, negatives: 12, bodyRead: 40, applied: 30, overapplication: 0, perCase: {'asc-3': 'BBBB', 'es-1': 'BBAB'}, ...o});
  const b = S2({condition: 'B'});
  const pass = judge1817(b, S2({condition: 'S', applied: 31, bodyRead: 39, overapplication: 1, perCase: {'asc-3': 'AABA', 'es-1': 'AAAA'}}));
  assert.equal(pass.verdict, 'adoption-candidate', JSON.stringify(pass.checks));
  assert.deepEqual(pass.targeted['asc-3'], {B: 'BBBB', S: 'AABA', applied: {B: 0, S: 3}});
  assert.equal(pass.targeted['es-1'].applied.B, 1);
  assert.equal(judge1817(b, S2({condition: 'S', applied: 30})).verdict, 'not-a-candidate'); // equal is not above
  assert.equal(judge1817(b, S2({condition: 'S', applied: 31, bodyRead: 38})).verdict, 'not-a-candidate'); // B - 2
  assert.equal(judge1817(b, S2({condition: 'S', applied: 31, overapplication: 2})).verdict, 'not-a-candidate'); // B + 2
  assert.equal(judge1817(b, S2({condition: 'S', applied: 40, failures: 6})).verdict, 'not-judged'); // 6/56 > 10%
  // rates when the valid positives differ (one failure not replaced): 30/43 > 30/44
  assert.equal(judge1817(b, S2({condition: 'S', positives: 43, applied: 30, bodyRead: 39})).verdict, 'adoption-candidate');
});

test('#1817 M1: the fixed order is reps outermost, negatives interleaved, B then S; counterexamples fail', () => {
  const order = loadOrder();
  assert.deepEqual(orderProblems(order, spec, loadConditions()), []);
  const p = plannedTrials();
  assert.equal(p.length, 112);
  assert.deepEqual(p.slice(0, 6).map((t) => t.name), ['B-asc-1-1', 'S-asc-1-1', 'B-rr-1-1', 'S-rr-1-1', 'B-neg-1-1', 'S-neg-1-1']);
  assert.equal(p[27].name, 'S-do-1-1'); assert.equal(p[28].name, 'B-asc-1-2'); assert.equal(p.at(-1).name, 'S-do-1-4');
  const withCases = (caseOrder) => orderProblems({...order, caseOrder}, spec, loadConditions());
  const pos = order.caseOrder.filter((id) => !id.startsWith('neg-')), neg = order.caseOrder.filter((id) => id.startsWith('neg-'));
  assert.match(withCases([...pos, ...neg]).join(), /ends with a negative case/);
  assert.match(withCases([neg[0], neg[1], ...pos, neg[2]]).join(), /adjacent/);
  assert.match(withCases(order.caseOrder.slice(1)).join(), /not a permutation/);
  assert.match(orderProblems({...order, conditionOrder: ['S', 'B']}, spec, loadConditions()).join(), /conditionOrder/);
});

test('#1817 M1: run-trial accepts only the next planned trial, replacements only after all planned; probes are free', () => {
  const names = plannedTrials().map((t) => t.name);
  const r = (condition, caseId, rep, reserved) => orderRefusal({condition, caseId, rep: String(rep), reserved: new Set(reserved)});
  assert.equal(r('B', 'asc-1', 1, []), null);
  assert.match(r('S', 'asc-1', 1, []), /next planned trial is B-asc-1-1/);
  assert.match(r('B', 'rr-1', 1, ['B-asc-1-1']), /next planned trial is S-asc-1-1/);
  assert.equal(r('S', 'asc-1', 1, ['B-asc-1-1']), null);
  assert.match(r('B', 'asc-1', 2, ['B-asc-1-1']), /out of order/); // rep 2 before rep 1 of the other cases
  assert.equal(r('B', 'probe', 1, []), null);
  assert.match(r('B', 'asc-1', 5, names.slice(0, -1)), /before every planned trial is reserved/);
  assert.equal(r('B', 'asc-1', 5, names), null);
  assert.match(r('B', 'asc-1', 4, names), /all planned trials are reserved/); // a planned name cannot be rerun
});

test('#1817 L1: replacements are one per failed planned trial (rep 5, 6, ...), and a failed replacement is not replaced', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1817-repl-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const mk = (name, text, ok = true) => {
    fs.mkdirSync(path.join(root, name), {recursive: true});
    if (text !== null) fs.writeFileSync(path.join(root, name, 'trace.jsonl'), ok ? trace([], {text}) : trace([], {subtype: 'error_during_execution', is_error: true, text: 'API Error: 529'}));
    if (text !== null) fs.writeFileSync(path.join(root, name, 'meta.json'), '{}');
  };
  mk('B-asc-1-1', null); mk('B-asc-1-2', 'x'); mk('B-asc-1-3', 'x', false); mk('B-asc-1-4', 'x'); mk('S-asc-1-1', 'x');
  const exists = (n) => fs.existsSync(path.join(root, n));
  assert.deepEqual(replacementPlan({runsRoot: root, spec, exists}).map((x) => x.name), ['B-asc-1-5', 'B-asc-1-6']);
  mk('B-asc-1-5', 'x', false); // the replacement failed: it is not replaced again
  assert.deepEqual(replacementPlan({runsRoot: root, spec, exists}).map((x) => x.name), ['B-asc-1-6']);
  mk('B-asc-1-6', 'x');
  assert.deepEqual(replacementPlan({runsRoot: root, spec, exists}), []);
  // scoring matches: 1 -> 5 (a failure), 3 -> 6; a rep 7 is not counted
  const row = (run, failure) => ({condition: 'B', case: 'asc-1', run, ...(failure ? {failure: 'x'} : {})});
  const rows = selectCounted([row(1, true), row(2), row(3, true), row(4), row(5, true), row(6), row(7)], 4);
  assert.deepEqual(rows.map((x) => [x.run, x.counted]), [[1, false], [2, true], [3, false], [4, true], [5, true], [6, true], [7, false]]);
  assert.deepEqual([rows[0].replacedBy, rows[2].replacedBy, rows[4].replaces], [5, 6, 1]);
  // a rep 6 without a second failure does not count; a missing replacement is flagged
  const gap = selectCounted([row(1, true), row(2), row(3), row(4), row(6)], 4);
  assert.deepEqual(gap.map((x) => x.counted), [true, true, true, true, false]);
  assert.equal(gap[0].replacementMissing, true);
  assert.equal(summarize(spec, gap, 'B').replacementsMissing, 1);
});

test('#1817 run-all: planned trials skip the reserved ones; replacements wait for every planned trial', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1817-runall-'));
  t.after(() => fs.rmSync(d, {recursive: true, force: true}));
  const lf = path.join(d, 'l.jsonl'); ledgerOps.create(lf);
  ledgerOps.reserve(lf, 'B-probe-1', 0.6); ledgerOps.reserve(lf, 'B-asc-1-1', 0.6);
  const todo = trialsToStart('planned', {runsRoot: path.join(d, 'runs'), ledger: lf, spec});
  assert.equal(todo.length, 111); assert.equal(todo[0].name, 'S-asc-1-1');
  assert.throws(() => trialsToStart('replacements', {runsRoot: path.join(d, 'runs'), ledger: lf, spec}), /after every planned trial/);
});

test('#1817 M1: judge1817 is not-judged without valid negative trials, with an unmeasured case, or a missing replacement', () => {
  const S3 = (o) => ({condition: 'X', runs: 56, failures: 0, positives: 44, negatives: 12, bodyRead: 40, applied: 30, overapplication: 0, casesWithoutValidTrial: [], replacementsMissing: 0, perCase: {}, ...o});
  const b = S3({condition: 'B'});
  assert.equal(judge1817(b, S3({condition: 'S', applied: 31})).verdict, 'adoption-candidate');
  const noNeg = judge1817(b, S3({condition: 'S', applied: 31, negatives: 0}));
  assert.equal(noNeg.verdict, 'not-judged'); assert.match(noNeg.reason, /S: no valid negative trial/);
  assert.match(judge1817(S3({condition: 'B', negatives: 0}), S3({condition: 'S', applied: 31})).reason, /B: no valid negative trial/);
  assert.match(judge1817(b, S3({condition: 'S', applied: 31, casesWithoutValidTrial: ['do-1']})).reason, /no valid trial for do-1/);
  assert.match(judge1817(b, S3({condition: 'S', applied: 31, replacementsMissing: 1})).reason, /without the mandatory replacement/);
  // summarize reports the cases without a valid trial (a cap stop before a case, or only failures)
  const rows = selectCounted([{condition: 'S', case: 'asc-1', run: 1, kind: 'asc', expect: 'asc', bodyRead: true, applied: true}, {condition: 'S', case: 'neg-1', run: 1, kind: 'negative', expect: null, failure: 'x'}], 4);
  const s = summarize(spec, rows, 'S');
  assert.ok(s.casesWithoutValidTrial.includes('neg-1') && s.casesWithoutValidTrial.includes('do-1') && !s.casesWithoutValidTrial.includes('asc-1'));
  assert.equal(judge1817(b, s).verdict, 'not-judged');
});
