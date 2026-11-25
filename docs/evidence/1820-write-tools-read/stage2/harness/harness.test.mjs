// Synthetic tests for the #1820 stage-2 harness (the parts that differ from stage 1 and #1817). No model call, no network.
// The files copied byte for byte (guard, ledger, install-asc, condition-i from #1817 via stage 1; probe-check from stage 1)
// are checked for identity here and are covered by the stage-1 and #1817 tests.
// Usage: node --test docs/evidence/1820-write-tools-read/stage2/harness/harness.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTrace, scoreRun, selectCounted, summarize, judge1820s2, ruleChecks, initProblems} from './score.mjs';
import {plannedTrials, orderProblems, orderRefusal, probeRefusal, completionStatus, loadOrder} from './order.mjs';
import {flags, isolationSettings, promptFor, cellOf, maxTurnsFor, probeGateProblems, installProblems, probeSteps, stage1Problems, STOP_LINE_USD, INSIDE_FILE} from './run-trial.mjs';
import {approvalProblems, markerPaths} from './markers.mjs';
import {writeSources, pinned} from './make-fixture.mjs';
import {checkProbe, compareProbes, fileInputs} from './probe-check.mjs';
import {FIXED, refixAfterMeasurement} from './fixation.mjs';
import {loadConditions} from './apply-condition.mjs';
import {redact} from './collect.mjs';
import {firstSentenceDiff, blockText, INSTALLED_DIFF_EXPECTED, trialPlan} from './dry-run.mjs';
import * as ledger from './ledger.mjs';
import {markerPaths as stage1MarkerPaths} from '../../harness/markers.mjs';

const H = path.dirname(fileURLToPath(import.meta.url));
const EV = path.resolve(H, '..');
const S1 = path.resolve(EV, '..');
const EVROOT = path.resolve(S1, '..');
const REPO = path.resolve(EVROOT, '../..');
const read = (f, root = EV) => fs.readFileSync(path.join(root, f), 'utf8');
const CONDS = JSON.parse(read('conditions.json'));
const SPEC = JSON.parse(read('cases.json'));
const S1CONDS = JSON.parse(read('conditions.json', S1));
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'h1820s2-')); t.after(() => fs.rmSync(d, {recursive: true, force: true})); return d; };
const W = CONDS.toolLevels.W;
const k = (id) => SPEC.cases.find((c) => c.id === id);

test('copied files are byte-identical; the fixed list names every plan file and harness module', () => {
  for (const f of ['guard', 'ledger', 'install-asc', 'condition-i']) {
    assert.ok(fs.readFileSync(path.join(H, `${f}.mjs`)).equals(fs.readFileSync(path.join(EVROOT, '1817-skill-application/harness', `${f}.mjs`))), f);
  }
  assert.ok(fs.readFileSync(path.join(H, 'probe-check.mjs')).equals(fs.readFileSync(path.join(S1, 'harness/probe-check.mjs'))), 'probe-check');
  for (const f of FIXED) assert.ok(fs.existsSync(path.join(EV, f)), f);
  const modules = fs.readdirSync(H).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'dry-run.mjs').map((f) => `harness/${f}`);
  assert.deepEqual(modules.sort(), FIXED.filter((f) => f.startsWith('harness/')).sort());
});

test('cases: the 14 #1817 cases unchanged on fixture A, and three design cases with the stage-1 prompt G for a design folder', () => {
  const c17 = JSON.parse(fs.readFileSync(path.join(EVROOT, '1817-skill-application/cases.json'), 'utf8')).cases;
  assert.deepEqual(SPEC.cases.filter((c) => c.kind !== 'design').map(({fixture, ...rest}) => { assert.equal(fixture, 'A'); return rest; }), c17);
  const design = SPEC.cases.filter((c) => c.kind === 'design');
  assert.deepEqual(design.map((c) => [c.id, c.fixture]), [['d-ui03', 'D3'], ['d-ui04', 'D4'], ['d-ui07', 'D7']]);
  const gd = JSON.parse(read('cases.json', S1)).cases.find((c) => c.id === 'brief').prompts.GD;
  for (const c of design) {
    assert.equal(c.prompt, gd); assert.equal(c.expect, 'asc'); assert.deepEqual(c.references, ['implementation.md', 'workspace.md']);
    for (const r of c.references) assert.ok(fs.existsSync(path.join(REPO, 'skills/asc/references', r)), r);
  }
  assert.equal(SPEC.cases.filter((c) => c.expect).length, 14);
  assert.equal(SPEC.cases.filter((c) => !c.expect).length, 3);
});

test('conditions: only level W (the stage-1 W), B and S differ only in the release, D fixtures pinned like stage 1', (t) => {
  assert.deepEqual(Object.keys(CONDS.toolLevels), ['W']);
  assert.deepEqual(CONDS.toolLevels.W, S1CONDS.toolLevels.W);
  assert.deepEqual(CONDS.cells, {B: {tools: 'W', release: 'B'}, S: {tools: 'W', release: 'S'}});
  assert.deepEqual(CONDS.fixtures.D3.files, S1CONDS.fixtures.D.files);
  assert.equal(CONDS.fixtures.A.baseClaudeMd, S1CONDS.fixtures.A.baseClaudeMd);
  for (const f of ['D3', 'D4', 'D7']) { const d = tmp(t); assert.deepEqual(writeSources(d, f, CONDS), ['BRIEF.md', 'FONTS.md', 'data.json']); }
  const bad = structuredClone(CONDS); bad.fixtures.D4.files['BRIEF.md'].sha256 = '0'.repeat(64);
  assert.throws(() => writeSources(tmp(t), 'D4', bad), /differs from the sha256/);
  assert.equal(pinned('B').kind, 'release'); assert.equal(pinned('S').kind, 'candidate'); assert.equal(pinned('X'), null);
  assert.notEqual(pinned('B').assetSha256, pinned('S').assetSha256);
  const rel = JSON.parse(read('release.json'));
  assert.equal(rel.B.assetSha256, JSON.parse(read('release.json', S1)).release.assetSha256, 'B is the stage-1 release');
  assert.equal(pinned('S', {...rel, S: {...rel.S, kind: 'release'}}), null, 'S only from a candidate entry');
});

test('budget: the stage-1 spend is read from its published ledger; the stage-2 cap is the remainder; both stages stay under 25 USD', () => {
  assert.deepEqual(stage1Problems(), []);
  assert.equal(STOP_LINE_USD, 21.97);
  assert.ok(CONDS.budget.stage1SpentUsd + STOP_LINE_USD <= CONDS.budget.ownerCapUsd);
  assert.match(stage1Problems({...CONDS.budget, stage1SpentUsd: 1.5}).join(), /differs from conditions.json stage1SpentUsd/);
  assert.match(stage1Problems({...CONDS.budget, capUsd: 23.5}).join(), /exceeds the owner cap/);
  assert.match(stage1Problems({...CONDS.budget, stage1LedgerSha256: '0'.repeat(64)}).join(), /differs from the sha256/);
  const p = trialPlan(CONDS, SPEC);
  assert.deepEqual([p.plannedTrials, p.positivesA, p.design, p.negatives, p.probes.length], [136, 88, 24, 24, 2]);
  assert.ok(p.planningUsd < p.stopLineUsd);
});

test('launch: level W flags for every trial; no --max-turns on fixture A, 3 on the design folders, 30 for the probe', () => {
  const f = (kk) => flags({level: W, model: 'sonnet', budget: 0.6, maxTurns: maxTurnsFor(kk), settingsFile: 's.json'}).join(' ');
  assert.match(f(k('asc-3')), /--tools Read,Write,Edit,Glob,Grep,Skill --disallowedTools Bash,NotebookEdit,WebFetch,WebSearch,Agent,Task --permission-mode acceptEdits --settings s\.json --strict-mcp-config/);
  assert.doesNotMatch(f(k('neg-1')), /--max-turns/);
  assert.match(f(k('d-ui04')), /--settings s\.json --max-turns 3 --strict/);
  assert.match(f({id: 'probe'}), /--max-turns 30 /);
  assert.equal(promptFor(k('d-ui07')), k('d-ui07').prompt);
  assert.throws(() => cellOf('X'), /unknown condition/);
  assert.deepEqual(cellOf('S').level, W);
  const s = isolationSettings({work: '/t/r/S-d-ui03-1/work', runsRoot: '/t/r', fixture: '/t/f/fixture-S-D3', ledger: '/t/l/ledger.jsonl'});
  assert.deepEqual(s.sandbox.filesystem, {denyRead: ['/Users', '/t/r', '/t/f/fixture-S-D3', '/t/l'], allowRead: ['/t/r/S-d-ui03-1/work'], denyWrite: ['/t/f/fixture-S-D3', '/t/l']});
  assert.equal(probeSteps('W', {homeMarker: '/h', repoMarker: '/r/x', sentinels: {trial: '/t', repo: '/r/y'}}).length, CONDS.probeSteps.W);
  assert.throws(() => probeSteps('X', {}), /only tools level W/);
});

test('run order: 136 planned trials, reps outermost, B then S, design and negative cases interleaved; counterexamples refused', () => {
  const order = loadOrder();
  assert.deepEqual(orderProblems(order, SPEC, CONDS), []);
  const plan = plannedTrials(order, 4);
  assert.equal(plan.length, 136);
  assert.deepEqual(plan.slice(0, 4).map((x) => x.name), ['B-asc-1-1', 'S-asc-1-1', 'B-d-ui03-1', 'S-d-ui03-1']);
  assert.equal(plan.at(-1).name, 'S-do-1-4');
  assert.match(orderProblems({...order, caseOrder: [...order.caseOrder.filter((x) => x !== 'neg-3'), 'neg-3']}, SPEC, CONDS).join(), /ends with a negative case/);
  const adj = order.caseOrder.filter((x) => x !== 'd-ui04'); adj.splice(adj.indexOf('d-ui07') + 1, 0, 'd-ui04');
  assert.match(orderProblems({...order, caseOrder: adj}, SPEC, CONDS).join(), /design cases are adjacent/);
  assert.match(orderProblems({...order, conditionOrder: ['S', 'B']}, SPEC, CONDS).join(), /conditionOrder/);
  const none = new Set();
  assert.equal(orderRefusal({condition: 'B', caseId: 'asc-1', rep: '1', reserved: none}), null);
  assert.match(orderRefusal({condition: 'S', caseId: 'asc-1', rep: '1', reserved: none}), /out of order/);
  assert.equal(orderRefusal({condition: 'S', caseId: 'asc-1', rep: '1', reserved: new Set(['B-asc-1-1'])}), null);
  assert.match(orderRefusal({condition: 'B', caseId: 'asc-1', rep: '5', reserved: none}), /replacement B-asc-1-5 before every planned trial/);
  assert.equal(probeRefusal({condition: 'S', rep: '1', reserved: none}), null);
  assert.match(probeRefusal({condition: 'W', rep: '1', reserved: none}), /not a probe cell/);
  assert.match(probeRefusal({condition: 'B', rep: '2', reserved: none}), /needs B-probe-1 first/);
  assert.match(probeRefusal({condition: 'B', rep: '1', reserved: new Set(['B-asc-1-1'])}), /measurement has started/);
});

// --- synthetic traces ---
let n = 0;
const ev = (o) => JSON.stringify(o);
function trace({messages, tools = W.tools.split(','), mode = 'acceptEdits', subtype = 'success', isError = false, cwd = '/tmp/w', text = 'ok', mcp = []}) {
  const lines = [ev({type: 'system', subtype: 'init', cwd, tools, permissionMode: mode, mcp_servers: mcp, model: 'm'})];
  messages.forEach((uses, mi) => {
    const id = `msg${mi}`;
    for (const [name, input, err] of uses) {
      const tid = `t${++n}`;
      lines.push(ev({type: 'assistant', message: {id, content: [{type: 'tool_use', id: tid, name, input}]}}));
      if (err !== 'missing') lines.push(ev({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: tid, is_error: Boolean(err), content: err ? 'denied' : 'x'}]}}));
    }
    if (!uses.length) lines.push(ev({type: 'assistant', message: {id, content: [{type: 'text', text}]}}));
  });
  lines.push(ev({type: 'result', subtype, is_error: isError, result: text, total_cost_usd: 0.05, num_turns: messages.length}));
  return parseTrace(lines.join('\n'));
}
const BODY = '.agent-skill-chain/skills/asc/SKILL.md';
const REF = (r, s = 'asc') => `.agent-skill-chain/skills/${s}/references/${r}`;
const stop = {subtype: 'error_max_turns', isError: true};

test('score fixture A (#1817): applied needs the body, a listed reference and the markers; a refused or unanswered Read does not count', () => {
  const asc1 = k('asc-1');
  const full = scoreRun(SPEC, asc1, trace({messages: [[['Read', {file_path: BODY}]], [['Read', {file_path: REF('workspace.md')}]], []], text: 'worktree-create で作る'}), {level: W});
  assert.deepEqual([full.failure, full.bodyRead, full.referenceRead, full.markers, full.applied, full.markersApplicable], [undefined, true, true, true, true, true]);
  const noMarker = scoreRun(SPEC, asc1, trace({messages: [[['Read', {file_path: BODY}]], [['Read', {file_path: REF('workspace.md')}]], []], text: '段取り'}), {level: W});
  assert.deepEqual([noMarker.bodyRead, noMarker.applied], [true, false]);
  const refused = scoreRun(SPEC, asc1, trace({messages: [[['Read', {file_path: BODY}, true]], []]}), {level: W});
  assert.equal(refused.bodyRead, false);
  const unanswered = scoreRun(SPEC, asc1, trace({messages: [[['Read', {file_path: BODY}, 'missing']]], ...stop}), {level: W});
  assert.deepEqual([unanswered.bodyRead, unanswered.stopped], [false, 'error_max_turns']);
  const purpose = scoreRun(SPEC, k('se-1'), trace({messages: [[['Skill', {skill: 'security-evidence'}], ['Read', {file_path: '.agent-skill-chain/skills/security-evidence/SKILL.md'}]], [['Read', {file_path: REF('findings-and-summary.md', 'security-evidence')}]], []], text: 'lockfile'}), {level: W});
  assert.deepEqual([purpose.entryHop, purpose.bodyRead, purpose.applied], [true, true, true]);
  const red = scoreRun(SPEC, asc1, trace({cwd: '<trial>/work', messages: [[['Read', {file_path: `<trial>/work/${BODY}`}]], []]}), {level: W});
  assert.equal(red.bodyRead, true, 'redacted public traces are scored like the raw ones');
});

test('score design: issued Reads of the three messages count; applied = body + implementation.md or workspace.md; no markers', () => {
  const d = k('d-ui03');
  const a = scoreRun(SPEC, d, trace({messages: [[['Read', {file_path: 'BRIEF.md'}], ['Read', {file_path: BODY}]], [['Read', {file_path: REF('implementation.md')}, 'missing']]], ...stop, text: ''}), {level: W});
  assert.deepEqual([a.failure, a.stopped, a.bodyRead, a.referenceRead, a.markers, a.markersApplicable, a.applied, a.bodyReadMessage, a.writeBeforeBody, a.resultMissing], [undefined, 'error_max_turns', true, true, true, false, true, 1, false, true]);
  const b = scoreRun(SPEC, d, trace({messages: [[['Read', {file_path: 'BRIEF.md'}], ['Glob', {pattern: '**/*'}]], [['Read', {file_path: 'data.json'}]], [['Read', {file_path: BODY}, 'missing']]], ...stop}), {level: W});
  assert.deepEqual([b.bodyRead, b.applied, b.bodyReadMessage], [true, false, 3]);
  const w = scoreRun(SPEC, d, trace({messages: [[['Read', {file_path: 'BRIEF.md'}]], [['Write', {file_path: 'out/index.html', content: 'x'}]], [['Read', {file_path: BODY}, 'missing']]], ...stop}), {level: W});
  assert.equal(w.writeBeforeBody, true);
  const none = scoreRun(SPEC, d, trace({messages: [[['Read', {file_path: 'BRIEF.md'}], ['Glob', {pattern: '**/*'}]], [['Read', {file_path: 'data.json'}]], [['Write', {file_path: 'out/index.html'}, 'missing']]], ...stop}), {level: W});
  assert.deepEqual([none.bodyRead, none.unselected, none.writeBeforeBody, none.firstTools.map((x) => x.name)], [false, true, true, ['Read', 'Glob']]);
  const refused = scoreRun(SPEC, d, trace({messages: [[['Read', {file_path: BODY}, true]]], ...stop}), {level: W});
  assert.equal(refused.bodyRead, false, 'a refused Read never counts');
  const skill = scoreRun(SPEC, d, trace({messages: [[['Skill', {skill: 'asc'}]]], ...stop}), {level: W});
  assert.deepEqual([skill.skillAsc, skill.entryHop, skill.bodyRead], [true, true, false]);
});

test('score: the condition must be level W (tools, acceptEdits, no MCP); an API error is a failure; negatives count overapplication', () => {
  const asc1 = k('asc-1');
  assert.match(scoreRun(SPEC, asc1, trace({messages: [[]], tools: ['Read', 'Glob', 'Grep', 'Skill']}), {level: W}).failure, /condition not received: tools/);
  assert.match(scoreRun(SPEC, asc1, trace({messages: [[]], mode: 'default'}), {level: W}).failure, /permission mode/);
  assert.match(scoreRun(SPEC, asc1, trace({messages: [[]], mcp: [{name: 'x'}]}), {level: W}).failure, /MCP/);
  assert.deepEqual(initProblems({tools: [...W.tools.split(','), 'ToolSearch'], permissionMode: 'acceptEdits', mcp_servers: []}, W), []);
  assert.match(scoreRun(SPEC, asc1, trace({messages: [[]], subtype: 'error_during_execution', isError: true, text: 'API Error'}), {level: W}).failure, /result error/);
  assert.equal(scoreRun(SPEC, asc1, trace({messages: [[]], subtype: 'error_max_budget_usd', isError: true}), {level: W}).failure, undefined);
  const neg = scoreRun(SPEC, k('neg-2'), trace({messages: [[['Read', {file_path: '.claude/skills/asc/SKILL.md'}]], []], text: 'PATCH'}), {level: W});
  assert.deepEqual([neg.overapplication, neg.markers], [true, true]);
  assert.equal(scoreRun(SPEC, k('neg-1'), trace({messages: [[]], text: 'search'}), {level: W}).overapplication, false);
});

// Summaries for the rule: counts per condition.
const sum = (condition, o) => ({condition, runs: 68, failures: 0, positives: 56, bodyRead: 0, applied: 0, negatives: 12, overapplication: 0, replacementsMissing: 0, casesWithoutValidTrial: [], ...o});
const done = {basis: 'complete', missingPlanned: 0, missingReplacements: []};

test('rule (owner): body >= 80% and above B, applied not lower, overapplication at most B + 1; otherwise not a candidate or not judged', () => {
  const B = sum('B', {bodyRead: 40, applied: 30, overapplication: 0});
  assert.equal(judge1820s2(B, sum('S', {bodyRead: 45, applied: 30, overapplication: 1}), {completion: done}).verdict, 'adoption-candidate');
  assert.equal(judge1820s2(B, sum('S', {bodyRead: 44, applied: 40}), {completion: done}).verdict, 'not-a-candidate', '44/56 < 0.8');
  assert.equal(ruleChecks(B, sum('S', {bodyRead: 45, applied: 40})).bodyReadLevel.pass, true, '45/56 >= 0.8');
  const high = sum('B', {bodyRead: 50, applied: 30});
  assert.equal(judge1820s2(high, sum('S', {bodyRead: 50, applied: 40}), {completion: done}).checks.bodyReadAboveBaseline.pass, false, 'equal is not above');
  assert.equal(judge1820s2(B, sum('S', {bodyRead: 50, applied: 29}), {completion: done}).checks.appliedNotLower.pass, false);
  assert.equal(judge1820s2(B, sum('S', {bodyRead: 50, applied: 30}), {completion: done}).checks.appliedNotLower.pass, true, 'equal applied is enough');
  assert.equal(judge1820s2(B, sum('S', {bodyRead: 50, applied: 40, overapplication: 2}), {completion: done}).checks.overapplication.pass, false);
  // Rates, not counts, when a condition has fewer valid trials.
  assert.equal(ruleChecks(sum('B', {positives: 56, bodyRead: 44}), sum('S', {positives: 55, bodyRead: 44})).bodyReadAboveBaseline.pass, true);
  // Not judged.
  assert.equal(judge1820s2(B, sum('S', {bodyRead: 50}), {completion: {basis: null, missingPlanned: 3, missingReplacements: [], spentUsd: 1, perTrialUsd: 0.6, stopLineUsd: 21.97}}).verdict, 'not-judged');
  assert.match(judge1820s2(B, sum('S', {bodyRead: 50, replacementsMissing: 1}), {completion: done}).reason, /without the mandatory replacement/);
  assert.match(judge1820s2(B, sum('S', {bodyRead: 50, failures: 7}), {completion: done}).reason, /failures above 10%/);
  assert.match(judge1820s2(B, sum('S', {bodyRead: 50, negatives: 0}), {completion: done}).reason, /no valid negative trial/);
  assert.match(judge1820s2(B, sum('S', {bodyRead: 50, casesWithoutValidTrial: ['d-ui04']}), {completion: done}).reason, /no valid trial for d-ui04/);
  // The subsets are reported, not used.
  const r = judge1820s2(B, sum('S', {bodyRead: 45, applied: 30}), {completion: done, subsets: {design: [sum('B', {positives: 12, negatives: 0, bodyRead: 0}), sum('S', {positives: 12, negatives: 0, bodyRead: 5})]}});
  assert.equal(r.verdict, 'adoption-candidate');
  assert.equal(r.separate.design.checks.bodyReadLevel.pass, false);
  assert.equal('overapplication' in r.separate.design.checks, false);
});

test('summaries and replacements: the k-th failure of a condition/case is replaced by rep 4+k; subsets by fixture; perCase letters', () => {
  const rows = [
    {condition: 'B', case: 'd-ui03', run: 1, expect: 'asc', failure: 'result error: x'},
    {condition: 'B', case: 'd-ui03', run: 2, expect: 'asc', bodyRead: true, applied: true, reach: true, referenceRead: true},
    {condition: 'B', case: 'd-ui03', run: 5, expect: 'asc', bodyRead: true, applied: false, reach: true},
    {condition: 'B', case: 'd-ui03', run: 6, expect: 'asc', bodyRead: false},
    {condition: 'B', case: 'neg-1', run: 1, expect: null, overapplication: true},
    {condition: 'B', case: 'asc-1', run: 1, expect: 'asc', bodyRead: false, entryHop: true, reach: true},
  ];
  selectCounted(rows, 4);
  assert.deepEqual(rows.map((r) => r.counted), [false, true, true, false, true, true]);
  const all = summarize(SPEC, rows, 'B');
  assert.deepEqual([all.positives, all.bodyRead, all.applied, all.negatives, all.overapplication, all.notCounted], [3, 2, 1, 1, 1, 2]);
  assert.equal(all.perCase['d-ui03'], 'AB'); assert.equal(all.perCase['asc-1'], 'E'); assert.equal(all.perCase['neg-1'], 'O');
  const d = summarize(SPEC, rows, 'B', {only: (c) => c.kind === 'design'});
  assert.deepEqual([d.positives, d.negatives, Object.keys(d.perCase)], [2, 0, ['d-ui03', 'd-ui04', 'd-ui07']]);
  assert.deepEqual(d.casesWithoutValidTrial, ['d-ui04', 'd-ui07']);
});

test('completion: complete with every planned trial; cap-reached at the stage-2 stop line without a late probe', () => {
  const plan = plannedTrials(loadOrder(), 4);
  const all = new Set(plan.map((x) => x.name));
  const budget = CONDS.budget;
  assert.equal(completionStatus({runs: [], reserved: all, reservations: [], spentUsd: 10, budget}).basis, 'complete');
  const some = new Set(plan.slice(0, 100).map((x) => x.name));
  const res = [{trial: 'B-probe-1', seq: 0}, ...plan.slice(0, 100).map((x, i) => ({trial: x.name, seq: i + 1}))];
  assert.equal(completionStatus({runs: [], reserved: some, reservations: res, spentUsd: 21.0, budget}).basis, null, '21.0 + 0.6 <= 21.97');
  assert.equal(completionStatus({runs: [], reserved: some, reservations: res, spentUsd: 21.4, budget}).basis, 'cap-reached');
  assert.equal(completionStatus({runs: [], reserved: some, reservations: [...res, {trial: 'S-probe-2', seq: 101}], spentUsd: 21.4, budget}).basis, null, 'a probe after the first planned trial');
  const failed = [{condition: 'S', case: 'es-1', run: 2, failure: 'x'}];
  const c = completionStatus({runs: failed, reserved: all, reservations: [], spentUsd: 10, budget});
  assert.deepEqual([c.basis, c.missingReplacements], [null, ['S-es-1-5']]);
});

test('install record: built for the trial\'s condition and fixture from the pinned tarball, unchanged since', (t) => {
  const work = tmp(t);
  const base = {condition: 'S', fixture: 'D4', pinned: true, source: 'candidate', install: {tarballSha256: pinned('S').assetSha256, entries: [], adopted: {id: 'claude-md'}}};
  const p = installProblems(base, work, cellOf('S'), 'D4');
  assert.ok(!p.some((x) => /condition|fixture D|pinned for the condition|stand-in/.test(x)), p.join());
  assert.match(installProblems({...base, condition: 'B'}, work, cellOf('S'), 'D4').join(), /built for condition B, not S/);
  assert.match(installProblems(base, work, cellOf('S'), 'D7').join(), /fixture D4, not D7/);
  assert.match(installProblems({...base, source: 'release'}, work, cellOf('S'), 'D4').join(), /not installed from the tarball pinned/);
  assert.match(installProblems({...base, install: {...base.install, tarballSha256: pinned('B').assetSha256}}, work, cellOf('S'), 'D4').join(), /tarball digest is not the one/);
  assert.match(installProblems(null, work, cellOf('S'), 'D4').join(), /no install record/);
});

test('dry-run comparison: only the first sentence of the block may differ, and the rest must be byte-identical', () => {
  const T = CONDS.candidateText.readTriggerFirstSentence;
  const rest = '変更のレビュー・指摘の是正…を選んで読む。Skillの読取りから外部操作の許可を推定しない。';
  const md = (first, base = '# P\n\n') => `${base}<!-- asc:read-trigger v1 -->\n${first}${rest}\n<!-- /asc:read-trigger -->\n`;
  assert.equal(blockText(md(T.B)), `${T.B}${rest}`);
  assert.equal(firstSentenceDiff(md(T.B), md(T.S), T).pass, true);
  assert.match(firstSentenceDiff(md(T.B), md(T.S).replace('推定しない', '推定する'), T).problems.join(), /differ after the first sentence/);
  assert.match(firstSentenceDiff(md(T.B), md(T.S, '# Q\n\n'), T).problems.join(), /outside the block/);
  assert.match(firstSentenceDiff(md(T.S), md(T.S), T).problems.join(), /B block does not start/);
  assert.ok(T.S.startsWith('このプロジェクトでASCを使う。') && T.B.startsWith('このプロジェクトでASCを使う'));
  // The candidate text is the shipped text of this repository (v05/USAGE.md, skills/asc/SKILL.md).
  assert.ok(fs.readFileSync(path.join(REPO, 'v05/USAGE.md'), 'utf8').includes(T.S));
  assert.match(fs.readFileSync(path.join(REPO, 'skills/asc/SKILL.md'), 'utf8'), new RegExp(`^description: ${CONDS.candidateText.ascDescription.S}$`, 'm'));
  assert.ok(INSTALLED_DIFF_EXPECTED.includes('CLAUDE.md') && INSTALLED_DIFF_EXPECTED.includes('.claude/skills/asc/SKILL.md'));
});

test('probe approval and markers: the committed stage-1 approval of #1820 is used; the marker files are the stage-1 ones', () => {
  assert.equal(JSON.parse(read('results/probe-approval.json', S1)).ownerConfirmed, true);
  assert.deepEqual(approvalProblems(), []);
  assert.deepEqual(markerPaths(REPO), stage1MarkerPaths(REPO));
});

test('collect: the per-user temporary directory name is redacted with the other local paths', () => {
  const s = redact('{"p":"/private/tmp/claude-999/x/work/a","q":"/config/projects/-private-tmp-claude-999--Users-someone-x/memory/","r":"/Users/someone/y"}', '/private/tmp/claude-999/x');
  assert.doesNotMatch(s, /claude-999|someone/);
  assert.match(s, /<trial>\/work\/a/); assert.match(s, /-private-tmp-<tmp-user>--<local>/);
});

// --- probe gate (stage-1 helpers, level W for both conditions) ---
const ASC = ['asc', 'contract-enforcement', 'decision-ownership', 'engineering-judgment', 'estimate-and-scope', 'execution-recovery', 'migration-assurance', 'project-foundation', 'research-to-implementation', 'review-and-remediation', 'security-evidence', 'subagent-model-selection', 'tracker-issue-writing', 'user-journey-acceptance', 'verification-optimization', 'work-coordination'];
const PCTX = {homeMarker: '/h/asc1820-home-marker.txt', repoMarker: '/r/.agent-skill-chain/local/asc1820-repo-marker.txt', trialDir: '/t/X', runsRoot: '/t', fixture: '/f/fixture-B-A', ledgerDir: '/y/ledger',
  sentinels: {trial: '/t/X/outside-write-probe.txt', repo: '/r/.agent-skill-chain/local/asc1820-write-probe.txt'}};
const TOKENS = [`ASC1820-MARKER-${'a1'.repeat(12)}`, `ASC1820-MARKER-${'b2'.repeat(12)}`];
const stepCall = (st) => (st.tool === 'Glob' || st.tool === 'Grep' ? {pattern: st.pattern, path: st.path} : {file_path: st.path, ...(st.tool === 'Write' ? {content: 'probe'} : {})});
const stepsW = () => probeSteps('W', PCTX).map((st) => [st.tool, stepCall(st), true, 'Claude requested permissions to read, but you have not granted it yet.']);
function probeTrace(calls, cwd, desc) {
  const lines = [{type: 'system', subtype: 'init', cwd, tools: W.tools.split(','), permissionMode: 'acceptEdits', mcp_servers: [], plugins: [], skills: [...ASC, 'dataviz'], model: 'm'}];
  for (const [name, input, err, content] of calls) {
    const id = `p${++n}`;
    lines.push({type: 'assistant', message: {id: `m${id}`, content: [{type: 'tool_use', id, name, input}]}});
    lines.push({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: id, is_error: err, content}]}});
  }
  const text = `CLAUDE.md 最初の行: ユーザー管理API\nこのプロジェクトでASCを使う…\nDESC asc: ${desc}\nDESC user-journey-acceptance: user-journey-acceptanceの説明。\nGIT: Update project files | Install ASC | initial`;
  lines.push({type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.1});
  return lines.map((l) => JSON.stringify(l)).join('\n');
}
function probeLedger(t, names) {
  const d = fs.realpathSync(tmp(t));
  const l = path.join(d, 'ledger.jsonl');
  ledger.create(l);
  const results = {};
  for (const name of names) {
    const cond = name.split('-')[0], dir = path.join(d, name), work = path.join(dir, 'work');
    const desc = CONDS.candidateText.ascDescription[cond];
    for (const s of ASC) { fs.mkdirSync(path.join(work, '.claude/skills', s), {recursive: true}); fs.writeFileSync(path.join(work, '.claude/skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: ${s === 'asc' ? desc : `${s}の説明。`}\n---\n`); }
    fs.writeFileSync(path.join(work, 'CLAUDE.md'), CONDS.fixtures.A.baseClaudeMd);
    fs.writeFileSync(path.join(dir, 'trace.jsonl'), probeTrace(stepsW(), work, desc));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({costUsd: 0.1, probeContext: PCTX, probeSentinels: PCTX.sentinels, probeInsideFile: INSIDE_FILE}));
    const r = ledger.reserve(l, name, 0.6);
    const sh = (f) => ledger.fileSha256(path.join(dir, f));
    ledger.settle(l, r.id, name, 0.1, {exit: 0, traceSha256: sh('trace.jsonl'), metaSha256: sh('meta.json')});
    const {inputs} = fileInputs(dir, cond, REPO, CONDS);
    results[name] = checkProbe({...inputs, conditionsOverride: CONDS, ownerLines: [], ownerSkills: [], tokens: TOKENS, realHome: '/nonexistent-home', hostInstallDir: '/opt/claude', installProblems: [], debug: `Loading ${inputs.work}/CLAUDE.md`});
  }
  return {d, l, results};
}
const failing = (r) => JSON.stringify(Object.entries(r.checks).filter(([, c]) => !c.pass));

test('probe gate: one W probe per condition, each with its own asc description, bound to the ledger and recomputed', (t) => {
  const {d, l, results} = probeLedger(t, ['B-probe-1', 'S-probe-1']);
  for (const r of Object.values(results)) assert.equal(r.pass, true, failing(r));
  const write = (o) => fs.writeFileSync(path.join(d, 'probe-compare.json'), JSON.stringify(o));
  assert.match(probeGateProblems(d, CONDS, l).join(), /missing/);
  const good = compareProbes([results['B-probe-1'], results['S-probe-1']], {conds: CONDS});
  assert.equal(good.pass, true);
  write(good);
  assert.deepEqual(probeGateProblems(d, CONDS, l), []);
  const edit = (f) => { const o = JSON.parse(JSON.stringify(good)); f(o); return o; };
  write(edit((o) => { o.probes.pop(); }));
  assert.match(probeGateProblems(d, CONDS, l).join(), /covers B, not B,S/);
  write(edit((o) => { o.probes[1].traceSha256 = '0'.repeat(64); }));
  assert.match(probeGateProblems(d, CONDS, l).join(), /S-probe-1: the compared result is not bound/);
  write(edit((o) => { o.dropped = 'X'; }));
  assert.match(probeGateProblems(d, CONDS, l).join(), /stage 2 has no drop/);
  // A probe whose answer quotes the other condition's description fails (the description must come from its own install).
  const wrong = probeLedger(t, ['B-probe-1', 'S-probe-1']);
  fs.writeFileSync(path.join(wrong.d, 'S-probe-1', 'trace.jsonl'), probeTrace(stepsW(), path.join(wrong.d, 'S-probe-1', 'work'), CONDS.candidateText.ascDescription.B));
  const {inputs} = fileInputs(path.join(wrong.d, 'S-probe-1'), 'S', REPO, CONDS);
  assert.equal(checkProbe({...inputs, conditionsOverride: CONDS, ownerLines: [], ownerSkills: [], tokens: TOKENS, realHome: '/x', hostInstallDir: '/opt/claude', installProblems: [], debug: ''}).checks.descriptionsInContext.pass, false);
});

test('fixation: a refix record later than the first measurement reservation is reported; the conditions file is the stage-2 one', (t) => {
  const d = tmp(t), l = path.join(d, 'l.jsonl');
  ledger.create(l);
  ledger.reserve(l, 'B-probe-1', 0.6);
  const fx = {records: [{at: '2000-01-01T00:00:00Z'}, {at: '2999-01-01T00:00:00Z', refix: {}}]};
  assert.deepEqual(refixAfterMeasurement(fx, l), []);
  ledger.reserve(l, 'B-asc-1-1', 0.6);
  assert.deepEqual(refixAfterMeasurement(fx, l), ['2999-01-01T00:00:00Z']);
  assert.equal(loadConditions().schema, 'asc-1820s2-conditions/v1');
});
