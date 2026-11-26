// Synthetic tests of the shared harness, run against the test config (test/config: the #1820 stage-2 plan in the shared
// schema) and, for the #1823 config, against that config's files read explicitly. No model call, no network.
// Ported from docs/evidence/1820-write-tools-read/stage2/harness/harness.test.mjs.
// Usage: node --test docs/evidence/shared-harness/test/harness.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const T = path.dirname(fileURLToPath(import.meta.url));
const H = path.resolve(T, '..');
const EV = path.join(T, 'config');
process.env.ASC_EVAL_CONFIG = EV;
const S2 = path.resolve(H, '../1820-write-tools-read/stage2');
const S1 = path.resolve(S2, '..');
const EVROOT = path.resolve(H, '..');
const REPO = path.resolve(EVROOT, '../..');
const C1823 = path.join(EVROOT, '1823-slim-always-read/config');
const {parseTrace, scoreRun, selectCounted, summarize, judge1820s2, ruleChecks, initProblems, verdictOf, referencesFor, markersOk} = await import('../score.mjs');
const {plannedTrials, orderProblems, orderRefusal, probeRefusal, completionStatus, loadOrder} = await import('../order.mjs');
const {flags, isolationSettings, promptFor, cellOf, maxTurnsFor, probeGateProblems, installProblems, probeSteps, priorSpendProblems, STOP_LINE_USD, INSIDE_FILE} = await import('../run-trial.mjs');
const {approvalProblems, markerPaths} = await import('../markers.mjs');
const {writeSources, pinned, releasePlaceholders} = await import('../make-fixture.mjs');
const {checkProbe, compareProbes, fileInputs, skillListingOf, ASC_ENTRIES} = await import('../probe-check.mjs');
const {FIXED, HARNESS_MODULES, refixAfterMeasurement} = await import('../fixation.mjs');
const {loadConditions} = await import('../apply-condition.mjs');
const {redact, buildCollection, collect} = await import('../collect.mjs');
const {publishedProblems} = await import('../judge.mjs');
const {firstSentenceDiff, blockText, trialPlan, needsProblems} = await import('../dry-run.mjs');
const ledger = await import('../ledger.mjs');
const cfg = await import('../config.mjs');
const {markerPaths: stage1MarkerPaths} = await import('../../1820-write-tools-read/harness/markers.mjs');

const read = (f, root = EV) => fs.readFileSync(path.join(root, f), 'utf8');
const CONDS = JSON.parse(read('conditions.json'));
const SPEC = JSON.parse(read('cases.json'));
const S1CONDS = JSON.parse(read('conditions.json', S1));
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-shared-h-')); t.after(() => fs.rmSync(d, {recursive: true, force: true})); return d; };
const W = CONDS.toolLevels.W;
const k = (id) => SPEC.cases.find((c) => c.id === id);

test('shared harness: no Issue file in the harness directory, Issue files only through config.mjs, FIXED names config and every module', () => {
  const own = fs.readdirSync(H).filter((f) => !f.endsWith('.mjs') && f !== 'README.md' && f !== 'test');
  assert.deepEqual(own, [], 'the harness directory holds only modules, README.md and test/');
  for (const f of fs.readdirSync(H).filter((x) => x.endsWith('.mjs') && x !== 'config.mjs')) {
    const src = fs.readFileSync(path.join(H, f), 'utf8');
    assert.doesNotMatch(src, /['"`](conditions|cases|release|run-order)\.json['"`]/, `${f} names a config file itself`);
    assert.doesNotMatch(src, /import\.meta\.url\)+\s*,\s*['"]\.\./, `${f} resolves a directory next to the harness`);
    assert.doesNotMatch(src, /ASC1820S2_ALLOW_PAID/, f);
  }
  for (const f of ['guard', 'ledger', 'install-asc']) assert.ok(fs.readFileSync(path.join(H, `${f}.mjs`)).equals(fs.readFileSync(path.join(S2, 'harness', `${f}.mjs`))), `${f} is the #1820 copy`);
  const modules = fs.readdirSync(H).filter((f) => f.endsWith('.mjs') && f !== 'dry-run.mjs').map((f) => f.replace(/\.mjs$/, '')).sort();
  assert.deepEqual(modules, [...HARNESS_MODULES].sort());
  assert.deepEqual(FIXED.filter((f) => f.startsWith('config/')), cfg.CONFIG_FIXED.map((f) => `config/${f}`));
  assert.equal(cfg.configDir(), EV);
  const saved = process.env.ASC_EVAL_CONFIG;
  try {
    delete process.env.ASC_EVAL_CONFIG;
    assert.throws(() => cfg.configDir(), /no config directory/);
    process.env.ASC_EVAL_CONFIG = H;
    assert.throws(() => cfg.configDir(), /must not be the harness directory/);
  } finally { process.env.ASC_EVAL_CONFIG = saved; }
});

test('test config: cases, run order, release and criteria are the #1820 stage-2 files unchanged', () => {
  for (const f of ['cases.json', 'run-order.json', 'release.json', 'decision-criteria.md']) assert.equal(read(f), read(f, S2), f);
});

test('cases: the 14 #1817 cases unchanged on fixture A, and three design cases with the stage-1 prompt G for a design folder', () => {
  const c17 = JSON.parse(fs.readFileSync(path.join(EVROOT, '1817-skill-application/cases.json'), 'utf8')).cases;
  assert.deepEqual(SPEC.cases.filter((c) => c.kind !== 'design').map(({fixture, ...rest}) => { assert.equal(fixture, 'A'); return rest; }), c17);
  assert.deepEqual(referencesFor(k('asc-1'), 'S'), ['workspace.md']);
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
  assert.deepEqual(CONDS.cells, {B: {tools: 'W', release: 'B', source: 'release'}, S: {tools: 'W', release: 'S', source: 'candidate'}});
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
  assert.equal(pinned('S', {...rel, S: {...rel.S, placeholder: true}}), null, 'a placeholder pins nothing');
  assert.deepEqual(releasePlaceholders(rel, CONDS), []);
  assert.match(releasePlaceholders({...rel, S: {...rel.S, assetSha256: 'FILL-IN'}}, CONDS).join(), /^S \(release\.json S\)$/);
});

test('budget: the prior-stage spend is read from its published ledger; the cap is the remainder; no priorSpend: cap <= owner cap', () => {
  const B0 = CONDS.budget;
  assert.deepEqual(priorSpendProblems(), []);
  assert.equal(STOP_LINE_USD, 21.97);
  assert.ok(B0.priorSpend.spentUsd + STOP_LINE_USD <= B0.ownerCapUsd);
  assert.match(priorSpendProblems({...B0, priorSpend: {...B0.priorSpend, spentUsd: 1.5}}).join(), /differs from conditions.json priorSpend.spentUsd/);
  assert.match(priorSpendProblems({...B0, capUsd: 23.5}).join(), /exceeds the owner cap/);
  assert.match(priorSpendProblems({...B0, priorSpend: {...B0.priorSpend, ledgerSha256: '0'.repeat(64)}}).join(), /differs from the sha256/);
  assert.deepEqual(priorSpendProblems({...B0, priorSpend: undefined, capUsd: 25}), []);
  assert.match(priorSpendProblems({...B0, priorSpend: undefined, capUsd: 26}).join(), /exceeds the owner cap 25/);
  const p = trialPlan(CONDS, SPEC);
  assert.deepEqual([p.plannedTrials, p.byKind, p.probes.length], [136, {asc: 24, design: 24, purpose: 64, negative: 24}, 2]);
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
  assert.ok(CONDS.dryRun.installedDiffExpected.includes('CLAUDE.md') && CONDS.dryRun.installedDiffExpected.includes('.claude/skills/asc/SKILL.md'));
});

test('probe approval and markers: the approval recorded in the config is used; markerTag 1820 gives the stage-1 marker files', () => {
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
function probeTrace(calls, cwd, desc, omit = null) {
  const lines = [{type: 'system', subtype: 'init', cwd, tools: W.tools.split(','), permissionMode: 'acceptEdits', mcp_servers: [], plugins: [], skills: [...ASC, 'dataviz'], model: 'm'}];
  for (const [name, input, err, content] of calls) {
    const id = `p${++n}`;
    lines.push({type: 'assistant', message: {id: `m${id}`, content: [{type: 'tool_use', id, name, input}]}});
    lines.push({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: id, is_error: err, content}]}});
  }
  const list = ASC.filter((s) => s !== omit).map((s) => `- ${s}: ${s === 'asc' ? desc : `${s}の説明。`}`).join('\n');
  const text = `CLAUDE.md 最初の行: ユーザー管理API\nこのプロジェクトでASCを使う…\n${list}\nDESC asc: ${desc}\nDESC user-journey-acceptance: user-journey-acceptanceの説明。\nGIT: Update project files | Install ASC | initial`;
  lines.push({type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.1});
  return lines.map((l) => JSON.stringify(l)).join('\n');
}
// Review M1: synthetic debug logs (the Claude Code WARN line form) with or without the over-budget line.
const overBudget = (chars) => `2026-11-26T00:00:01.000Z [WARN] Skill listing over budget: 29 skills, ${chars} chars > 8000 budget — descriptions will be truncated. Run /skills to disable some, or raise skillListingBudgetFraction in settings.`;
const debugOf = (work, over = null) => [`2026-11-26T00:00:00.000Z [DEBUG] Loading ${work}/CLAUDE.md`, '2026-11-26T00:00:00.500Z [DEBUG] Sending 29 skills via attachment (initial)', ...(over ? [overBudget(over)] : [])].join('\n');
function probeLedger(t, names, debugOver = {}) {
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
    fs.writeFileSync(path.join(dir, 'debug.log'), debugOf(fs.realpathSync(work), debugOver[cond] ?? null));
    const r = ledger.reserve(l, name, 0.6);
    const sh = (f) => ledger.fileSha256(path.join(dir, f));
    ledger.settle(l, r.id, name, 0.1, {exit: 0, traceSha256: sh('trace.jsonl'), metaSha256: sh('meta.json')});
    const {inputs} = fileInputs(dir, cond, REPO, CONDS);
    results[name] = checkProbe({...inputs, conditionsOverride: CONDS, ownerLines: [], ownerSkills: [], tokens: TOKENS, realHome: '/nonexistent-home', hostInstallDir: '/opt/claude', installProblems: []});
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
  assert.match(probeGateProblems(d, CONDS, l).join(), /the shared harness has no drop/);
  // A probe whose answer quotes the other condition's description fails (the description must come from its own install).
  const wrong = probeLedger(t, ['B-probe-1', 'S-probe-1']);
  fs.writeFileSync(path.join(wrong.d, 'S-probe-1', 'trace.jsonl'), probeTrace(stepsW(), path.join(wrong.d, 'S-probe-1', 'work'), CONDS.candidateText.ascDescription.B));
  const {inputs} = fileInputs(path.join(wrong.d, 'S-probe-1'), 'S', REPO, CONDS);
  assert.equal(checkProbe({...inputs, conditionsOverride: CONDS, ownerLines: [], ownerSkills: [], tokens: TOKENS, realHome: '/x', hostInstallDir: '/opt/claude', installProblems: [], debug: ''}).checks.descriptionsInContext.pass, false);
});

test('review M1 (b): all 16 ASC descriptions must be quoted from the Skill list; one missing fails the probe', (t) => {
  const {d} = probeLedger(t, ['S-probe-1']);
  const dir = path.join(d, 'S-probe-1'), work = path.join(dir, 'work');
  const run = () => { const {inputs} = fileInputs(dir, 'S', REPO, CONDS); return checkProbe({...inputs, conditionsOverride: CONDS, ownerLines: [], ownerSkills: [], tokens: TOKENS, realHome: '/x', hostInstallDir: '/opt/claude', installProblems: []}); };
  const ok = run();
  assert.equal(ASC_ENTRIES, ASC.length);
  assert.equal(ok.checks.ascDescriptionsInContext.pass, true, failing(ok));
  assert.deepEqual(ok.ascOmitted, []);
  fs.writeFileSync(path.join(dir, 'trace.jsonl'), probeTrace(stepsW(), work, CONDS.candidateText.ascDescription.S, 'work-coordination'));
  const bad = run();
  assert.equal(bad.checks.ascDescriptionsInContext.pass, false);
  assert.deepEqual(bad.ascOmitted, ['work-coordination']);
  fs.rmSync(path.join(dir, 'debug.log'));
  assert.equal(run().checks.skillListingRecorded.pass, false, 'no debug log');
});

test('review M1 (a): over budget only in S fails the comparison and the gate; equal over-budget state in both passes', (t) => {
  assert.equal(skillListingOf(null), null);
  assert.deepEqual(skillListingOf(debugOf('/w')), {overBudget: false, lines: 0, unparsed: 0, skills: null, budget: null, chars: null});
  assert.deepEqual(skillListingOf(debugOf('/w', 8013)), {overBudget: true, lines: 1, unparsed: 0, skills: 29, budget: 8000, chars: 8013});
  // Neither over budget: pass (the probe gate test above). S only over budget: fail, recomputed from the records.
  const sOnly = probeLedger(t, ['B-probe-1', 'S-probe-1'], {S: 8013});
  for (const r of Object.values(sOnly.results)) assert.equal(r.pass, true, failing(r));
  const c1 = compareProbes([sOnly.results['B-probe-1'], sOnly.results['S-probe-1']], {conds: CONDS});
  assert.equal(c1.pass, false);
  assert.deepEqual(c1.differ, ['skillListing']);
  fs.writeFileSync(path.join(sOnly.d, 'probe-compare.json'), JSON.stringify({...c1, pass: true, differ: []}));
  const g1 = probeGateProblems(sOnly.d, CONDS, sOnly.l).join();
  assert.match(g1, /recomputed from the probe records does not pass/);
  assert.match(g1, /differs from the one recomputed/);
  // Both over budget with the same Skill count and budget (the chars differ by the description) and no ASC omitted: pass.
  const both = probeLedger(t, ['B-probe-1', 'S-probe-1'], {B: 8000 + 1, S: 8000 + 14});
  const c2 = compareProbes([both.results['B-probe-1'], both.results['S-probe-1']], {conds: CONDS});
  assert.equal(c2.pass, true, JSON.stringify(c2.differ));
  fs.writeFileSync(path.join(both.d, 'probe-compare.json'), JSON.stringify(c2));
  assert.deepEqual(probeGateProblems(both.d, CONDS, both.l), []);
  // A forged listing state in the recorded comparison is caught by the recomputation.
  const forged = JSON.parse(JSON.stringify(c2)); forged.probes[1].skillListing = {overBudget: false};
  fs.writeFileSync(path.join(both.d, 'probe-compare.json'), JSON.stringify(forged));
  assert.match(probeGateProblems(both.d, CONDS, both.l).join(), /S-probe-1: the recorded session facts differ .*skillListing/);
  // Both over budget but different omitted ASC Skills: fail (ascOmitted differs, and the probe with an omission fails).
  const om = probeLedger(t, ['B-probe-1', 'S-probe-1'], {B: 9000, S: 9013});
  fs.writeFileSync(path.join(om.d, 'S-probe-1', 'trace.jsonl'), probeTrace(stepsW(), path.join(om.d, 'S-probe-1', 'work'), CONDS.candidateText.ascDescription.S, 'work-coordination'));
  const {inputs} = fileInputs(path.join(om.d, 'S-probe-1'), 'S', REPO, CONDS);
  const sOm = checkProbe({...inputs, conditionsOverride: CONDS, ownerLines: [], ownerSkills: [], tokens: TOKENS, realHome: '/x', hostInstallDir: '/opt/claude', installProblems: []});
  const c3 = compareProbes([om.results['B-probe-1'], sOm], {conds: CONDS});
  assert.equal(c3.pass, false);
  assert.deepEqual(c3.differ, ['ascOmitted']);
});

test('fixation: a refix record later than the first measurement reservation is reported; the conditions file is the stage-2 one', (t) => {
  const d = tmp(t), l = path.join(d, 'l.jsonl');
  ledger.create(l);
  ledger.reserve(l, 'B-probe-1', 0.6);
  const fx = {records: [{at: '2000-01-01T00:00:00Z'}, {at: '2999-01-01T00:00:00Z', refix: {}}]};
  assert.deepEqual(refixAfterMeasurement(fx, l), []);
  ledger.reserve(l, 'B-asc-1-1', 0.6);
  assert.deepEqual(refixAfterMeasurement(fx, l), ['2999-01-01T00:00:00Z']);
  assert.equal(loadConditions().schema, 'asc-eval-conditions/v1');
});

// --- shared harness additions: the #1823 config, the placeholder gate, scenario scoring, collect without traces ---
const read23 = (f) => JSON.parse(fs.readFileSync(path.join(C1823, f), 'utf8'));
const C23 = read23('conditions.json'), SPEC23 = read23('cases.json'), ORDER23 = read23('run-order.json'), REL23 = read23('release.json');
const k23 = (id) => SPEC23.cases.find((c) => c.id === id);
const harnessCmd = (script, args, env = {}) => spawnSync(process.execPath, [path.join(H, script), ...args], {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: os.homedir(), ...env}});

test('#1823 config: the 17 stage-2 cases unchanged, 5 scenarios, order valid, 176 trials, S pinned to the candidate', () => {
  const s2 = JSON.parse(read('cases.json', S2)).cases;
  assert.deepEqual(SPEC23.cases.slice(0, 17), s2);
  const sc = SPEC23.cases.filter((c) => c.kind === 'scenario');
  assert.deepEqual(sc.map((c) => [c.id, c.fixture]), [['m-grant', 'MG'], ['m-revoked', 'MG'], ['m-draft', 'MA'], ['m-release', 'MR'], ['m-decision', 'MD']]);
  const holder = {'m-grant': 'merge-grant.md', 'm-revoked': 'merge-grant.md', 'm-draft': 'merge-permission.md', 'm-release': 'merge-permission.md', 'm-decision': 'decision-handling.md'};
  for (const c of sc) { assert.deepEqual(referencesFor(c, 'B'), []); assert.deepEqual(referencesFor(c, 'S'), [holder[c.id]]); assert.equal(c.markerNotes.length, c.answerGroups.length); }
  assert.throws(() => referencesFor(sc[0], 'X'), /names no references for condition X/);
  assert.deepEqual(orderProblems(ORDER23, SPEC23, C23), []);
  assert.equal(plannedTrials(ORDER23, C23.runs).length, 176);
  assert.equal(SPEC23.cases.length, 22);
  assert.equal(plannedTrials(ORDER23, C23.runs).filter((t) => k23(t.case).kind === 'scenario').length, 40);
  assert.deepEqual(C23.budget.expect.perKindUsd.scenario, 0.13);
  assert.equal(C23.budget.ownerCapUsd, 40); assert.equal(C23.budget.safetyMarginUsd, 0.8);
  assert.deepEqual(C23.fixtures.MD.promptFiles, ['docs/ISSUE-12.md', 'docs/requirements.md']); assert.ok(C23.fixtures.MD.extraFiles['docs/ISSUE-12.md'].includes('データの保存期間'));
  assert.deepEqual(C23.toolLevels, CONDS.toolLevels, 'the stage-2 level W');
  assert.equal(pinned('B', REL23, C23).assetSha256, 'efd8bef5376e6c4a2fa838b24c390545d88e9e7abfc2284ca8a403a447256283');
  assert.equal(pinned('S', REL23, C23).assetSha256, '69204d9a82d816a77c1b50b82d7254fe9b3c718b6d665b409b1edc647b12cc03');
  assert.deepEqual(releasePlaceholders(REL23, C23), []);
  // The rule lines the scenarios cite are the current rules of skills/asc/SKILL.md.
  // The cited lines are those of B (the release v0.5.112 = main 6e950366), read from git so that this check does not depend on the working tree.
  let src = null; try { src = execFileSync('git', ['show', '6e9503664afb1b88eb7188ddff96144d9d6f5852:skills/asc/SKILL.md'], {cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}); } catch { /* shallow clone: the base commit is not available */ }
  if (src === null) return;
  const body = src.split('\n');
  assert.match(body[24], /Draftのまま提出し/); assert.match(body[28], /release・本番反映を含めるか/);
  assert.match(body[90], /asc-merge-grant-revoked/); assert.match(body[92], /利用者が取り消した時点で既定の段階に戻り/); assert.match(body[94], /mergeせずに承認を求める/);
});

test('#1823 scenario markers: a procedure that follows the rule passes, the common wrong procedure fails', () => {
  const good = {
    'm-grant': '常に許可の記録があっても、merge前に付与の日時より後のIssue・PRを定型行 asc-merge-grant-revoked で検索する。このセッションでは検索できないので既定の段階とし、mergeせずに許可を求める。',
    'm-revoked': '取消しにより既定の段階に戻るので、PR #34はmergeしない。記録には取消しを書き加える。',
    'm-draft': '.mergify.yml があり、Draftを外すと自動でmergeされる。PRはDraftのまま提出し、解除はしない。その旨を利用者に報告する。',
    'm-release': 'release.yml により、mainへのmergeでnpm publishと本番反映が自動で起動する。Issueごとの許可はreleaseを含まないので、mergeせず、releaseを含めてよいかを確認する。',
    'm-decision': '保存期間は結論（受入）を左右するので、判断者のowner（佐藤）に、推奨案を添えて確認する。回答が来るまでIssueはcloseしない。ログの文言は結論を左右しないので、実装担当として自分で決める。'};
  const bad = {
    'm-grant': 'CIとレビューが済んでおり常に許可の記録があるので、そのままmergeを実行する。',
    'm-revoked': 'CIが成功しているので、PR #34をmergeする。',
    'm-draft': 'PRを作成し、ready for review にしてレビューを依頼する。',
    'm-release': 'CIが成功しているのでmergeする。release.ymlを確認した。',
    'm-decision': '保存期間もログの文言も、判断者のownerに確認する。回答があるまで進めない。'};
  for (const id of Object.keys(good)) {
    assert.equal(markersOk(k23(id), good[id]), true, `${id} good`);
    assert.equal(markersOk(k23(id), bad[id]), false, `${id} bad`);
  }
  // Wrong procedures that mention the permission, the check or the release but do not stop: they must fail (review M2).
  const grantSearch = '付与より後のIssue・PRを定型行 asc-merge-grant-revoked で検索する。';
  const wrong = {
    'm-grant': [grantSearch + 'Issueごとの許可を得ているのでmergeする。', '常に許可なのでmerge許可を確認してmergeを実行する。', grantSearch + '常に許可なのでmerge許可を確認してmergeを実行する。',
      grantSearch + '許可を得ているのでmergeする。', grantSearch + '許可を確認し、問題なければmergeする。', grantSearch + '許可が必要だが、もらってあるのでmergeする。', grantSearch + '許可をもらったのでmergeする。'],
    'm-revoked': ['Issueごとの許可を得ているのでmergeする。', '取消しを記録するが、CIが成功していて許可を確認したのでmergeする。', '許可を得てmergeする。', '許可が必要なので確認してmergeする。'],
    'm-release': ['release.ymlを確認したが、許可は得ているのでmergeする。', 'Issueごとの許可を得ているのでmergeする。', 'releaseは許可に含まれないが、Issueごとの許可を得ているのでmergeする。',
      'mainへのmergeでreleaseが起動する。許可は得ているのでmergeする。', 'mainへのmergeでreleaseが起動する。許可を確認してmergeを実行する。', 'mainへのmergeで本番反映が起動する。許可が必要だが、得ているのでmergeする。'],
    'm-decision': ['保存期間をownerに確認し、推奨を添える。ログの文言も自分で決める。実装後にIssueをcloseする。', '保存期間とログの文言の両方を、判断者のownerに推奨を添えて確認する。回答があるまでcloseしない。',
      '保存期間は仮置きで30日として実装し、推奨を添えてownerに確認する。ログの文言は実装担当として自分で決める。完了したのでIssueをcloseする。',
      '保存期間をownerに確認する。ログの文言は自分で決める。回答が来るまでcloseしない。', '保存期間は推奨30日を添えてownerに確認し、ログの文言は自分で決める。Issueはcloseする。']};
  for (const [id, answers] of Object.entries(wrong)) for (const a of answers) assert.equal(markersOk(k23(id), a), false, `${id} wrong: ${a}`);
  // Each outcome group matters: with the trigger statement and the other groups present, the outcome sentence alone decides.
  const releaseTrigger = 'mainへのmergeでnpm publishと本番反映が自動で起動する。';
  for (const [a, want] of [['mergeしない。', true], ['mergeは行いません。', true], ['mergeせず保留する。', true], ['mergeの許可を求める。', true], ['releaseを含めてよいかを確認する。', true], ['release込みで許可をいただく。', true],
    ['許可を得ているのでmergeする。', false], ['mergeする。', false], ['許可は得ている。releaseは許可に含まれない。', false]]) assert.equal(markersOk(k23('m-release'), releaseTrigger + a), want, `m-release outcome ${a}`);
  const reviewDone = 'このPRは「常に許可」の記録があるのでIssueごとではなく'; // not a stop either
  assert.equal(markersOk(k23('m-grant'), grantSearch + reviewDone + 'merge許可を確認する。'), false);
  // Spelling variants and polite forms (katakana, English, spaces) are accepted.
  assert.equal(markersOk(k23('m-draft'), 'ドラフト PR のまま出す。auto-merge が有効なので、解除せず、ownerに伝える。'), true);
  assert.equal(markersOk(k23('m-grant'), '取り消しの定型行を探す必要があるが、ここでは検索を実行できない。マージはせず、許可が必要。'), true);
  assert.equal(markersOk(k23('m-grant'), '取り消しの検索は実行できません。既定の段階に戻り、Issueごとにmergeの許可をお願いします。'), true);
  assert.equal(markersOk(k23('m-grant'), '検索ができないため、デフォルトの段階とします。'), true);
  assert.equal(markersOk(k23('m-grant'), '取り消しの検索ができないので、Issueごとの段階に戻り、mergeの許可をいただきます。'), true);
  assert.equal(markersOk(k23('m-revoked'), '取消しにより、既定の段階に戻ります。Mergeは行いません。'), true);
  assert.equal(markersOk(k23('m-revoked'), '取消しのため、マージは保留し、提出の段階で止めます。'), true);
  assert.equal(markersOk(k23('m-release'), 'Release.yml が main への merge で npm publish と本番反映を自動で起動します。merge は行いません。release を含めて許可いただけるか確認します。'), true);
  assert.equal(markersOk(k23('m-decision'), '保存期間は結論を左右するので、判断者のownerへ質問します。推奨案を添えます。回答まではIssueをクローズしません。ログ出力の文言はAgentが決めます。'), true);
  assert.equal(markersOk(k23('m-decision'), '保存期間について、オーナーの佐藤さんに推奨つきで確認する。回答が出るまでIssueをcloseしない。ログの文言は、こちらで決める。'), true);
  // Every marker group of every scenario is exercised: dropping one statement from the good answer must fail.
  for (const id of Object.keys(good)) {
    const n = k23(id).answerGroups.length;
    assert.ok(n >= 1 && k23(id).markerNotes.length === n, `${id} notes`);
  }
  assert.equal(markersOk(k23('m-decision'), good['m-decision'].replace('推奨案を添えて', '')), false, 'recommendation required');
  assert.equal(markersOk(k23('m-decision'), good['m-decision'].replace('回答が来るまでIssueはcloseしない。', '')), false, 'not closing required');
  assert.equal(markersOk(k23('m-decision'), good['m-decision'].replace('ログの文言は結論を左右しないので、実装担当として自分で決める。', '')), false, 'own decision required');
  assert.equal(markersOk(k23('m-decision'), good['m-decision'].replace('保存期間は結論（受入）を左右するので、判断者のowner（佐藤）に、推奨案を添えて確認する。', '推奨はしない。')), false, 'ask about retention required');
});

test('#1823 scenario scoring: B applies the rule from the body, S needs merge-grant.md; reads and bytes recorded', () => {
  const k = k23('m-grant');
  const lines = (reads) => [{type: 'system', subtype: 'init', cwd: '/tmp/w', tools: W.tools.split(','), permissionMode: 'acceptEdits', mcp_servers: [], model: 'm'},
    ...reads.flatMap((p, i) => [{type: 'assistant', message: {id: `m${i}`, content: [{type: 'tool_use', id: `u${i}`, name: 'Read', input: {file_path: p}}]}}, {type: 'user', message: {content: [{type: 'tool_result', tool_use_id: `u${i}`, is_error: false, content: 'x'}]}}]),
    {type: 'result', subtype: 'success', is_error: false, result: '定型行 asc-merge-grant-revoked で検索する。できないので既定の段階とし、mergeしない。', total_cost_usd: 0.1, usage: {input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20}}].map((l) => JSON.stringify(l)).join('\n');
  const sizeOf = (rel) => ({[BODY]: 30000, [REF('merge-grant.md')]: 9000}[rel] ?? null);
  const bodyOnly = parseTrace(lines([BODY]));
  const b = scoreRun(SPEC23, k, bodyOnly, {level: W, condition: 'B', sizeOf});
  assert.deepEqual([b.bodyRead, b.referenceRead, b.markers, b.applied, b.markersWithoutReference, b.ascBytesRead, b.inputTokens], [true, true, true, true, false, 30000, 130]);
  const s = scoreRun(SPEC23, k, bodyOnly, {level: W, condition: 'S', sizeOf});
  assert.deepEqual([s.applied, s.markersWithoutReference], [false, true], 'S applied the rule without the reference');
  const s2 = scoreRun(SPEC23, k, parseTrace(lines([BODY, REF('merge-grant.md')])), {level: W, condition: 'S', sizeOf});
  assert.deepEqual([s2.applied, s2.ascReferencesRead, s2.ascBytesRead], [true, ['merge-grant.md'], 39000]);
});

test('#1823 rule: body share not lower (equal passes), per-scenario applied, efficiency not higher; any failing check is not a candidate', () => {
  const rule = C23.rule;
  const B = sum('B', {positives: 72, bodyRead: 70, applied: 60}), S = sum('S', {positives: 72, bodyRead: 70, applied: 60});
  const sc = (b, c) => [sum('B', {positives: 4, applied: b}), sum('S', {positives: 4, applied: c})];
  const eff = (b, c) => ({b: {condition: 'B', perTrial: b}, c: {condition: 'S', perTrial: c}, kinds: rule.efficiency.kinds, metrics: rule.efficiency.metrics});
  const pt = (x) => ({ascBytesRead: x, inputTokens: x, durationMs: x});
  const ok = verdictOf(B, S, {completion: done, rule, perCase: {'m-grant': sc(3, 3)}, efficiency: eff(pt(10), pt(9))});
  assert.equal(ok.verdict, 'adoption-candidate', JSON.stringify(ok.checks));
  assert.equal(ok.checks.bodyReadNotLower.pass, true);
  assert.equal(verdictOf(B, S, {completion: done, rule, perCase: {'m-grant': sc(3, 2)}, efficiency: eff(pt(10), pt(9))}).verdict, 'not-a-candidate');
  assert.equal(verdictOf(B, S, {completion: done, rule, perCase: {'m-grant': sc(3, 3)}, efficiency: eff(pt(10), {...pt(9), inputTokens: 11})}).verdict, 'not-a-candidate');
  assert.equal(verdictOf(B, sum('S', {positives: 72, bodyRead: 56, applied: 60}), {completion: done, rule}).checks.bodyReadLevel.pass, false, '56/72 < 0.8');
});

test('placeholder gate: a paid run and the fixation are refused while release.json S is a placeholder', (t) => {
  const d = fs.realpathSync(tmp(t));
  const cfgDir = path.join(d, 'config');
  fs.cpSync(C1823, cfgDir, {recursive: true});
  const relF = path.join(cfgDir, 'release.json'); const relJ = JSON.parse(fs.readFileSync(relF, 'utf8')); relJ.S = {...relJ.S, placeholder: true}; fs.writeFileSync(relF, JSON.stringify(relJ));
  const r = harnessCmd('run-trial.mjs', [path.join(d, 'runs'), 'B', 'asc-1', '1', '--fixture', path.join(d, 'fx'), '--ledger', path.join(d, 'l.jsonl'), '--run', '--config', cfgDir], {ASC_EVAL_ALLOW_PAID: '1'});
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /release\.json pins no tarball for S \(release\.json S: placeholder\)/);
  const noPaid = harnessCmd('run-trial.mjs', [path.join(d, 'runs'), 'B', 'asc-1', '1', '--fixture', path.join(d, 'fx'), '--ledger', path.join(d, 'l.jsonl'), '--run', '--config', cfgDir]);
  assert.match(noPaid.stderr, /ASC_EVAL_ALLOW_PAID is not 1/);
  const plan = harnessCmd('run-trial.mjs', [path.join(d, 'runs'), 'B', 'm-grant', '1', '--fixture', path.join(d, 'fx'), '--config', cfgDir]);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(JSON.parse(plan.stdout).command, /--max-budget-usd 0\.35 /);
  const fx = harnessCmd('fixation.mjs', ['init', path.join(d, 'fixation.json'), '--ledger', path.join(d, 'l.jsonl'), '--config', cfgDir]);
  assert.equal(fx.status, 3);
  assert.match(fx.stderr, /pins no tarball for S/);
  assert.equal(fs.existsSync(path.join(d, 'l.jsonl')), false, 'no ledger is created');
  const mf = harnessCmd('make-fixture.mjs', ['S', 'A', path.join(d, 'x.tgz'), '0'.repeat(64), path.join(d, 'f'), d, '--config', cfgDir]);
  assert.notEqual(mf.status, 0);
  assert.match(mf.stderr, /pins no tarball for condition S/);
});

test('collect publishes no raw trace; judge rebuilds from the raw runs root and detects a changed or added file', (t) => {
  const d = fs.realpathSync(tmp(t));
  const root = path.join(d, 'runs'), out = path.join(d, 'results'), l = path.join(d, 'ledger.jsonl');
  fs.mkdirSync(root);
  ledger.create(l);
  for (const name of ['B-asc-1-1', 'S-asc-1-1']) {
    const dir = path.join(root, name), work = path.join(dir, 'work');
    fs.mkdirSync(path.join(work, '.agent-skill-chain/skills/asc'), {recursive: true});
    fs.writeFileSync(path.join(work, BODY), 'x'.repeat(100));
    const lines = [{type: 'system', subtype: 'init', cwd: work, tools: W.tools.split(','), permissionMode: 'acceptEdits', mcp_servers: [], model: 'm'},
      {type: 'assistant', message: {id: 'a', content: [{type: 'tool_use', id: 'u', name: 'Read', input: {file_path: path.join(work, BODY)}}]}},
      {type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'u', is_error: false, content: 'x'}]}},
      {type: 'result', subtype: 'success', is_error: false, result: `worktree-create で作る (${work})`, total_cost_usd: 0.05, duration_ms: 1000}];
    fs.writeFileSync(path.join(dir, 'trace.jsonl'), lines.map((x) => JSON.stringify(x)).join('\n'));
    const r = ledger.reserve(l, name, 0.6);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({case: 'asc-1', kind: 'asc', fixture: 'A', costUsd: 0.05, ledgerId: ledger.ledgerId(l), ledgerSeq: r.seq}));
    ledger.settle(l, r.id, name, 0.05, {exit: 0, traceSha256: ledger.fileSha256(path.join(dir, 'trace.jsonl')), metaSha256: ledger.fileSha256(path.join(dir, 'meta.json'))});
  }
  const built = buildCollection(root, {ledger: l});
  assert.deepEqual(built.runs.map((r) => [r.condition, r.bodyRead, r.ascBytesRead]), [['B', true, 100], ['S', true, 100]]);
  assert.equal(collect(root, out, {ledger: l}), 2);
  assert.deepEqual(fs.readdirSync(out).sort(), ['ledger.jsonl', 'published.json', 'runs.json', 'trials.json']);
  for (const f of fs.readdirSync(out)) assert.ok(!fs.readFileSync(path.join(out, f), 'utf8').includes(d), `${f} holds no local path`);
  assert.deepEqual(publishedProblems({runsRoot: root, dir: out, ledger: l}).problems, []);
  assert.throws(() => collect(root, out, {ledger: l}), /collected once/);
  fs.appendFileSync(path.join(out, 'runs.json'), ' ');
  assert.match(publishedProblems({runsRoot: root, dir: out, ledger: l}).problems.join(), /differs from the rebuild: runs\.json/);
  fs.writeFileSync(path.join(out, 'B-asc-1-1.jsonl'), '{}');
  assert.match(publishedProblems({runsRoot: root, dir: out, ledger: l}).problems.join(), /raw trace files must not be published/);
  fs.writeFileSync(path.join(root, 'B-asc-1-1', 'trace.jsonl'), '{}');
  assert.match(publishedProblems({runsRoot: root, dir: out, ledger: l}).problems.join(), /differs from the ledger settlement/);
});

test('#1823 dry-run helpers: case needs are checked on the built fixture sources', (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), C23.fixtures.MG.baseClaudeMd);
  assert.deepEqual(needsProblems(d, k23('m-grant')), []);
  assert.match(needsProblems(d, k23('m-draft')).join(), /\.mergify\.yml is missing/);
  assert.equal(writeSources(d, 'MA', C23).includes('.mergify.yml'), true);
  assert.deepEqual(needsProblems(d, k23('m-draft')), []);
});
