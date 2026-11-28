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
  const modules = fs.readdirSync(H).filter((f) => f.endsWith('.mjs') && f !== 'dry-run.mjs' && f !== 'calibrate.mjs' && f !== 'sandbox-check.mjs' && f !== 'claude-sandbox-bash.mjs').map((f) => f.replace(/\.mjs$/, '')).sort();
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
  assert.throws(() => probeSteps('Y', {}), /only tools levels W and X/);
  assert.throws(() => probeSteps('X', {}), /needs the probe context of a confined level/, '#1844: level X only with the confined layout');
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
  // #1844 probe 1: a probe of conditions.json priorProbes (run under the prior ledger) counts as reserved: rep 2 is the one re-run.
  const pc = {...loadConditions(), priorProbes: ['B-probe-1']};
  assert.equal(probeRefusal({condition: 'B', rep: '2', reserved: none, conds: pc}), null);
  assert.match(probeRefusal({condition: 'B', rep: '1', reserved: none, conds: pc}), /ran under the prior ledger/);
  assert.match(probeRefusal({condition: 'B', rep: '3', reserved: none, conds: pc}), /rep must be 1, or 2/);
  assert.match(probeRefusal({condition: 'B', rep: '1', reserved: new Set(['B-asc-1-1'])}), /measurement has started/);
});

// --- synthetic traces ---
let n = 0;
const ev = (o) => JSON.stringify(o);
function trace({messages, tools = W.tools.split(','), mode = 'acceptEdits', subtype = 'success', isError = false, cwd = '/tmp/w', text = 'ok', mcp = []}) {
  const lines = [ev({type: 'system', subtype: 'init', cwd, tools, permissionMode: mode, mcp_servers: mcp, model: 'm'})];
  messages.forEach((uses, mi) => {
    const id = `msg${mi}`;
    for (const [name, input, err, content] of uses) {
      const tid = `t${++n}`;
      lines.push(ev({type: 'assistant', message: {id, content: [{type: 'tool_use', id: tid, name, input}]}}));
      if (err !== 'missing') lines.push(ev({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: tid, is_error: Boolean(err), content: content ?? (err ? 'denied' : 'x')}]}}));
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

// #1840: the user-environment config (fixed levels, the user's own rule and Skills, the written files).
const C40DIR = path.join(EVROOT, '1840-user-environment/config');
const C40 = JSON.parse(read('conditions.json', C40DIR));
const SPEC40 = JSON.parse(read('cases.json', C40DIR));
const k40 = (id) => SPEC40.cases.find((c) => c.id === id);
// #1840 re-review High: a fixture without template files (cases.json markerBase needs the files before the trial).
const NOBASE = {priorFiles: () => [], priorTexts: (rels) => rels.map(() => null)};
const {ascSkillsOf, levelsVerdict, writtenFiles, caseChecks} = await import('../score.mjs');
const {ascEntriesOf} = await import('../probe-check.mjs');

test('#1840 config: 19 cases (10 goal 1, 9 goal 2), natural prompts without Skill names or paths, order valid, 114 trials, 17 ASC Skills', () => {
  assert.equal(SPEC40.cases.length, 19);
  assert.equal(SPEC40.cases.filter((c) => c.goal === 1).length, 10);
  assert.equal(SPEC40.cases.filter((c) => c.goal === 2).length, 9);
  const names = [...C40.ascSkills, 'invoice-format', 'quote-format'];
  for (const c of SPEC40.cases) {
    for (const n of names) assert.ok(!c.prompt.includes(n), `${c.id} names ${n}`);
    assert.doesNotMatch(c.prompt, /[\w.-]+\/[\w.-]+|\.(md|ts|json)\b/, `${c.id} names a path`);
  }
  assert.deepEqual(orderProblems(JSON.parse(read('run-order.json', C40DIR)), SPEC40, C40), []);
  assert.equal(plannedTrials(JSON.parse(read('run-order.json', C40DIR)), C40.runs).length, 114);
  assert.equal(ascSkillsOf(C40).length, 17);
  assert.ok(ascSkillsOf(C40).includes('warranty-scope'));
  assert.equal(ascEntriesOf(C40), 17);
  assert.equal(ascEntriesOf(CONDS), ASC_ENTRIES, 'a config without ascSkills keeps the 16');
  const rel = JSON.parse(read('release.json', C40DIR));
  assert.equal(pinned('R', rel, C40).assetSha256, 'ecc7afd0d6595824bb6362618af973e7b66e8a3aa64fee1c3fbdb4043bf61c13');
  assert.equal(pinned('C', rel, C40).kind, 'candidate');
  for (const l of C40.rule.levels) for (const id of l.cases) assert.ok(k40(id), `level ${l.id} names unknown case ${id}`);
});

test('#1840 fixtures: appFiles false writes only the fixture\'s own files; the user files come after the install', (t) => {
  const d = tmp(t);
  const written = writeSources(d, 'U', C40);
  assert.ok(!written.includes('src/users.ts'), 'no fixture A file');
  assert.ok(written.includes('src/billing/invoice.ts'));
  assert.ok(!fs.existsSync(path.join(d, '.agent-skill-chain/project/context.json')), 'context.json is an afterInstallFiles file');
  assert.match(C40.fixtures.U.afterInstallFiles['.agent-skill-chain/project/context.json'], /"appliesTo": \[\s*"src\/billing"\s*\]/);
});

test('#1840 markers: answers following the earlier viewpoints pass; a missing viewpoint or a deduction fails', () => {
  const good = {
    'w-1': '対応ブラウザ・OS・端末の版と画面サイズを具体化し、値は未決として顧客と合意する。「快適に動作」は応答時間を測定条件（同時利用者数・回線）付きで決める。決済代行APIの仕様変更・障害は保証の対象外とし、責任分界を明記する。保証は検収時のリリースと環境を基準にする。',
    'w-3': '無期限かどうかは契約・法務の判断で、ここでは断定しない。責任の期間と、保証する範囲・条件は分けて決める。保証する環境を列挙し、対象外の環境は互換性対応として別途見積とする。用語は契約不適合責任を使う。',
    'm-r1': '根拠は品質保証範囲のWAR-002（合意の版1.0）。まずBR-012の切捨てとAC-021に照らして差異があるかを確かめる。差異があった場合に無償で直すかは契約担当（ACT-03）が判断する。',
    'm-r2': 'WAR-001（版1.0）で保証する環境はREQ-NF-010で、iPadのSafariはCON-003で対象外。合意に基づき互換性対応として見積のうえ対応する。',
    'm-r7': 'WAR-005は未決（OPEN-007）で、扱いは未合意。判断者は契約担当（ACT-03とACT-04）で、移行元データの内容と件数の確認が必要。',
  };
  for (const [id, text] of Object.entries(good)) assert.equal(markersOk(k40(id), text), true, id);
  assert.equal(markersOk(k40('w-1'), good['w-1'].replace('保証は検収時のリリースと環境を基準にする。', '')), false, 'T1-1 and T1-4 are both counted (answerQuota.min 2); T1-2 and T1-3 are report-only');
  assert.equal(markersOk(k40('w-1'), '保証の基準時点、応答時間の閾値と測定、決済代行の障害、対応環境（ブラウザ・OS・端末・runtimeと版）を決める。'), false, 'the template\'s own words are no markers (re-review High b)');
  assert.equal(markersOk(k40('w-3'), '法務・契約が判断する。対応環境・版を明記し、対象外は互換性対応として見積する。'), false, 'T4-1 without 法務・契約, T4-3 report-only');
  assert.equal(markersOk(k40('w-3'), `${good['w-3']}無期限は無効です。`), false, 'a legal assertion fails');
  assert.equal(markersOk(k40('m-r1'), `${good['m-r1']}無償で修正いたします。`), false, 'a promise before the check fails');
  assert.equal(markersOk(k40('m-r1'), good['m-r1'].replace('（合意の版1.0）', '')), false, 'the version is required');
  assert.equal(markersOk(k40('m-r7'), `${good['m-r7']}無償で対応します。`), false);
});

test('#1840 scoring: the user\'s Skill by its call, the rule read and obeyed in the written files, forbidden reads and Skills', () => {
  const work = {'src/billing/invoice.ts': 'export const discount = (a: bigint, p: bigint) => a * p / 100n;\n'};
  const fileText = (rel) => work[rel] ?? null;
  const RULE = '.agent-skill-chain/project/rules/money.md';
  const bill = scoreRun(SPEC40, k40('u-bill-1'), trace({messages: [[['Read', {file_path: BODY}]], [['Read', {file_path: RULE}]], [['Edit', {file_path: 'src/billing/invoice.ts', old_string: 'x', new_string: 'y'}]], []]}), {level: W, condition: 'R', fileText, ...NOBASE, skills: C40.ascSkills});
  assert.deepEqual([bill.bodyRead, bill.expectReadsAll, bill.writeOk, bill.applied], [true, true, true, true], JSON.stringify(bill));
  work['src/billing/invoice.ts'] = 'export const discount = (a: bigint, r: number) => BigInt(Math.floor(Number(a) * r * 0.9));\n';
  const bad = scoreRun(SPEC40, k40('u-bill-1'), trace({messages: [[['Read', {file_path: BODY}]], [['Edit', {file_path: 'src/billing/invoice.ts'}]], []]}), {level: W, condition: 'R', fileText, ...NOBASE, skills: C40.ascSkills});
  assert.deepEqual([bad.expectReadsAll, bad.writeOk, bad.applied], [false, false, false]);
  assert.deepEqual(bad.writeViolations, ['decimal-literal', 'float-function', 'number-conversion']);
  const noWrite = scoreRun(SPEC40, k40('u-bill-1'), trace({messages: [[['Read', {file_path: BODY}]], [['Read', {file_path: RULE}]], []]}), {level: W, condition: 'R', fileText, ...NOBASE, skills: C40.ascSkills});
  assert.equal(noWrite.writeOk, false, 'mustWrite');
  const users = scoreRun(SPEC40, k40('u-users'), trace({messages: [[['Read', {file_path: BODY}]], [['Read', {file_path: RULE}]], []]}), {level: W, condition: 'R', fileText, ...NOBASE, skills: C40.ascSkills});
  assert.deepEqual(users.forbiddenReads, ['money-rule']);
  work['docs/invoices/INV-202611-001.md'] = '請求番号 INV-202611-001\nみなと商事 御中\n合計 187,000円\n振込先 さくら銀行 本店営業部\n';
  const inv = scoreRun(SPEC40, k40('u-skill-1'), trace({messages: [[['Skill', {skill: 'invoice-format'}]], [['Write', {file_path: 'docs/invoices/INV-202611-001.md', content: 'x'}]], []]}), {level: W, condition: 'C', fileText, ...NOBASE, skills: C40.ascSkills});
  assert.deepEqual([inv.entryHop, inv.bodyRead, inv.writeOk, inv.forbidSkillsOk, inv.applied], [true, true, true, true, true]);
  assert.equal(inv.ascFilesRead, 0, 'the user\'s Skill is not an ASC file');
  const mix = scoreRun(SPEC40, k40('u-skill-1'), trace({messages: [[['Read', {file_path: '.claude/skills/quote-format/SKILL.md'}]], []]}), {level: W, condition: 'C', fileText, ...NOBASE, skills: C40.ascSkills});
  assert.deepEqual([mix.bodyRead, mix.forbiddenSkills], [false, ['quote-format']]);
  const est = scoreRun(SPEC40, k40('n-1'), trace({messages: [[['Read', {file_path: '.agent-skill-chain/skills/estimate-and-scope/SKILL.md'}]], [['Read', {file_path: '.agent-skill-chain/skills/warranty-scope/SKILL.md'}]], []], text: '前提と調査'}), {level: W, condition: 'C', skills: C40.ascSkills});
  assert.deepEqual([est.bodyRead, est.forbiddenSkills, est.applied], [true, ['warranty-scope'], false]);
  const neg = scoreRun(SPEC40, k40('u-neg'), trace({messages: [[]], text: 'The invoice has been sent.'}), {level: W, condition: 'R', skills: C40.ascSkills});
  assert.deepEqual([neg.overapplication, neg.negativeOk], [false, true]);
  const neg2 = scoreRun(SPEC40, k40('u-neg'), trace({messages: [[['Skill', {skill: 'invoice-format'}]], []], text: 'invoice'}), {level: W, condition: 'R', skills: C40.ascSkills});
  assert.deepEqual([neg2.overapplication, neg2.negativeOk], [false, false], 'the user\'s Skill is not ASC overapplication but fails negativeOk');
  assert.deepEqual(writtenFiles(trace({messages: [[['Write', {file_path: 'a.md'}, true], ['Write', {file_path: 'b.md'}]]]})), ['b.md'], 'a refused Write is not a written file');
  assert.deepEqual(caseChecks({id: 'x'}, [], trace({messages: [[]]})), {}, 'a case without the #1840 fields gets no field');
});

test('#1840 rule: fixed levels per condition; meets-levels only when every level passes; not judged before completion', () => {
  const rows = (cond, id, oks) => oks.map((ok, i) => ({condition: cond, case: id, run: i + 1, counted: true, expect: 'asc', reach: ok, bodyRead: ok, markers: ok, writeOk: ok}));
  const rule = {mode: 'levels', levels: [{id: 'sel', cases: ['a', 'b'], metric: 'reach', min: 0.8}, {id: 'w', cases: ['b'], metric: 'writeOk', min: 1}]};
  const runs = [...rows('R', 'a', [true, true, true]), ...rows('R', 'b', [true, true, false]), ...rows('C', 'a', [true, true, true]), ...rows('C', 'b', [true, true, true])];
  const s = (c) => ({condition: c, runs: 6, positives: 6, failures: 0, negatives: 1, casesWithoutValidTrial: [], replacementsMissing: 0, bodyRead: 6, applied: 6, overapplication: 0});
  const v = levelsVerdict({R: s('R'), C: s('C')}, runs, {completion: done, rule});
  assert.equal(v.verdict, 'levels');
  assert.equal(v.perCondition.R.verdict, 'below-levels', '5/6 >= 0.8 but writeOk 2/3 < 1');
  assert.equal(v.perCondition.R.checks.sel.pass, true);
  assert.equal(v.perCondition.C.verdict, 'meets-levels');
  assert.equal(levelsVerdict({R: s('R'), C: s('C')}, runs, {completion: {basis: null, missingPlanned: 3, missingReplacements: [], spentUsd: 1, perTrialUsd: 0.5, stopLineUsd: 29}, rule}).verdict, 'not-judged');
  assert.throws(() => levelsVerdict({R: s('R'), C: s('C')}, runs, {completion: done, rule: {levels: [{id: 'x', cases: ['a'], metric: 'nope', min: 1}]}}), /unknown level metric/);
});

test('#1840 written files: the spec without history and with the 7 facts passes; history, the old status or a copied value fails', () => {
  const FN = 'docs/specs/details/04_機能/FN-003_会員登録.md';
  const good = '# FN-003 会員登録\n\n状態: 提案（確認者: 未確認、根拠: 打合せ 2026-11-20）\n\n- 登録手段：メールアドレスまたは電話番号（E.164形式）。名前は任意。\n- 確認コード：6桁の数字、有効期限15分。\n- 5回続けて間違えると30分ロックする。\n- 画面：登録手段をタブで切り替える。期限切れのとき「確認コードの有効期限が切れました。もう一度送信してください」と表示し、再送信ボタンを出す。\n';
  const run = (text, id = 's-1', file = FN) => scoreRun(SPEC40, k40(id), trace({messages: [[['Write', {file_path: file, content: 'x'}]], []]}), {level: W, condition: 'C', fileText: (r) => (r === file ? text : null), ...NOBASE, skills: C40.ascSkills});
  assert.deepEqual([run(good).writeOk, run(good).writeViolations], [true, []]);
  assert.deepEqual(run(good.replace('有効期限15分。', '有効期限15分（以前は10分）。')).writeViolations, ['history-old-value', 'history-before']);
  assert.deepEqual(run(good.replace('状態: 提案', '状態：承認済み')).writeViolations, ['status-approved']);
  assert.deepEqual(run(good.replace('E.164形式', '国際形式')).writeRequireMissing, ['F5']);
  const W2 = 'docs/specs/details/02_要件/03_品質保証範囲.md';
  const war = '# 品質保証範囲\n\n状態: 提案（確認者: 未確認）\n\n| 版 | 合意日 | 合意者 |\n|---|---|---|\n\n| ID | 正本の参照 | 対象外 | 状態 |\n|---|---|---|---|\n| WAR-001 | REQ-PERF-001 | CON-003 | 未決 |\n\n| 未決 | 判断者 |\n|---|---|\n| OPEN-001 | 顧客の業務責任者 |\n';
  assert.equal(run(war, 'w-2', W2).writeOk, true);
  assert.deepEqual(run(war.replace('REQ-PERF-001', 'REQ-PERF-001（3秒以内）'), 'w-2', W2).writeViolations, ['copy-3s']);
  assert.deepEqual(run(war.replace('| 未決 |', '| 合意済み |'), 'w-2', W2).writeViolations, ['fabricated-row']);
});

// #1840 review (pre-measurement): calibration, the k-of-n markers, the written-file groups and reports, the trial
// reports, the report-only levels, the written-file digests, the user's Skills in the probe, the dry-run references.
const {groupOk, markerGroupsOf, writeChecks, reportOf, levelChecks} = await import('../score.mjs');
const {calibrate, markdown, sectionOf, evaluate} = await import('../calibrate.mjs');
const {workChanges} = await import('../make-fixture.mjs');
const {workFilesProblem} = await import('../collect.mjs');
const {fixtureReferences} = await import('../dry-run.mjs');

test('#1840 calibration (H2): the committed table is the one calibrate.mjs builds; earlier scoring and markers agree', () => {
  const cal = JSON.parse(read('calibration.json', C40DIR));
  const out = calibrate(cal, SPEC40);
  assert.equal(read('calibration-table.md', C40DIR), markdown(out), 'calibration-table.md is regenerated, not edited by hand');
  for (const [id, c] of Object.entries(out.byCase)) assert.ok(c.agree / c.judged >= 0.9, `${id}: ${c.agree}/${c.judged}`);
  assert.equal(out.byCase['s-1'].agree, 6);
  // re-review High (c), Medium-1: every answer that must fail fails (a copied template, headings and tables, the guide
  // only, one row filled in; R's and C's templates), also on answer + written files; the counted markers of w-1 and w-3
  // hit no template line and no answer without the Skill; the written form agrees with the answer form.
  const mf = out.rows.filter((r) => r.form === 'mustFail');
  assert.ok(mf.length >= 20 && mf.every((r) => r.markerPass === false), mf.filter((r) => r.markerPass).map((r) => `${r.case} ${r.condition}`).join(', '));
  for (const id of ['w-1', 'w-3']) {
    assert.deepEqual([...new Set(mf.filter((r) => r.case === id).map((r) => r.condition.replace(/（雛形[RC]）$/, '')))].length, 4, `${id}: four kinds of answers that must fail`);
    for (const v of out.viewpointRates[id].filter((x) => x.counted)) {
      assert.deepEqual(Object.values(v.templateLines), [0, 0], `${id} ${v.id} hits a template line`);
      assert.equal(v.noSkillMarker.hit, 0, `${id} ${v.id} hits an answer without the Skill`);
    }
    assert.deepEqual([out.byCaseWritten[id].agree, out.byCaseWritten[id].skillMarkerPass], [out.byCase[id].agree, out.byCase[id].skillMarkerPass], `${id}: answer and written forms agree`);
  }
  assert.ok(mf.filter((r) => r.case === 'w-2' && r.passWithoutBase === true).length >= 1, 'w-2 requireWithoutBase: an ID-only template passes only with the template lines');
  // re-review Low: s-1 cut into FN-003 and SCR-005 files (with and without a change log) agrees with the recorded results.
  const s1 = out.rows.filter((r) => r.case === 's-1' && r.form === 'written');
  assert.equal(s1.length, 12);
  assert.ok(s1.every((r) => r.agree === true), 'split files agree with the recorded results');
  for (let i = 0; i < s1.length; i += 2) assert.equal(s1[i].markerPass, s1[i + 1].markerPass, 'the change log is not scored');
  assert.ok(s1.filter((r) => r.report?.violations.length).length === 6, 'the change log history is reported');
  assert.match(markdown(out), /#1828の「これまでの採点」の合否は、#1828の判定ではない/);
  assert.ok(out.rows.filter((r) => r.case === 'w-3').every((r) => r.groups['T4-5'] === undefined || typeof r.groups['T4-5'] === 'boolean'));
  assert.equal(sectionOf('## T1\na\n## T2\nb\n', 'T2'), 'b\n');
  assert.equal(sectionOf('x', null), 'x');
});

test('#1840 markers (H2, L2): k of n groups, unless, report-only groups; the version marker ignores v1.0.0', () => {
  assert.equal(groupOk({all: ['a', 'b']}, 'ab'), true);
  assert.equal(groupOk({all: ['a', 'b']}, 'a'), false);
  assert.equal(groupOk({pattern: '法務', unless: 'どちらも受けません'}, '法務が確認します。どちらも受けません'), false);
  const w3 = '期間とは別に範囲を決める。法務が確認する。対応ブラウザと版を明記し、それ以外は互換性対応として見積する。'; // T4-2, T4-1
  assert.equal(markersOk(k40('w-3'), w3), true, 'T4-5 (契約不適合) is report-only');
  assert.equal(markerGroupsOf(k40('w-3'), w3)['T4-5'], false);
  const r2 = 'WAR-001の対象外。互換性対応として見積のうえ対応します。';
  assert.equal(markersOk(k40('m-r2'), `${r2}v1.0.0で納品しました。`), false, 'v1.0.0 is not the agreed version');
  for (const v of ['合意版1.0', '版1.0', '合意の版 1.0', '1.0版', '版: 1.0']) assert.equal(markersOk(k40('m-r2'), `${r2}${v}`), true, v);
  assert.equal(markersOk(k40('m-r1'), 'WAR-002（合意版1.0）。BR-012に照らして確認する。差異があれば無償修補の方向で検討します。'), false, 'a promise of the direction is a deduction');
});

test('#1840 written files (H1, H3, L3, M1): body only for s-1, groups of failures, change-log report, worktree prefix, markers on written text', () => {
  const FN = 'docs/specs/details/04_機能/FN-003_会員登録.md', LOG = 'docs/specs/details/15_要件追跡/01_変更履歴.md';
  const body = '状態: 提案\n電話番号（E.164形式）。確認コードは6桁、有効期限15分。5回で30分ロック。タブで切り替える。「確認コードの有効期限が切れました。もう一度送信してください」と再送信ボタン。\n';
  const files = {[FN]: body, [LOG]: '2026-11-20：有効期限を10分から15分に延ばした（問い合わせが多かったため）。\n'};
  const fileText = (r) => files[r] ?? null;
  const tr = (paths, text = 'ok') => trace({messages: [paths.map((f) => ['Write', {file_path: f, content: 'x'}]), []], text});
  const s1 = scoreRun(SPEC40, k40('s-1'), tr([FN, LOG]), {level: W, condition: 'C', fileText, ...NOBASE, skills: C40.ascSkills});
  assert.deepEqual([s1.writeOk, s1.written], [true, [FN]], 'the change log is not scored');
  assert.deepEqual(s1.writesReport.violations.sort(), ['history-change', 'history-old-value', 'history-reason']);
  files[FN] = body.replace('状態: 提案', '状態：承認済み').replace('E.164形式', '国際形式') + '以前は10分だった。\n';
  const bad = scoreRun(SPEC40, k40('s-1'), tr([FN]), {level: W, condition: 'C', fileText, ...NOBASE, skills: C40.ascSkills});
  assert.deepEqual(bad.writeFailedGroups.sort(), ['facts', 'history', 'status']);
  const wt = '.worktrees/20261127_000000-1-x/src/billing/invoice.ts';
  files[wt] = 'export const d = (a: bigint, p: bigint) => a * p / 100n;\n';
  assert.deepEqual(scoreRun(SPEC40, k40('u-bill-1'), tr([wt]), {level: W, condition: 'R', fileText, ...NOBASE, skills: C40.ascSkills}).written, [wt], 'the .worktrees/<name>/ prefix is accepted');
  const none = scoreRun(SPEC40, k40('u-skill-1'), tr([], '請求番号 INV-202611-001、みなと商事 御中、合計 187,000円'), {level: W, condition: 'R', fileText, ...NOBASE, skills: C40.ascSkills});
  assert.deepEqual([none.writeOk, none.writeRequireInAnswer], [false, ['number', 'onchu', 'total']], 'no file written: the answer text is reported');
  files['docs/invoices/INV-202611-001.md'] = 'x';
  files['out/INV-202611-001.md'] = 'INV-202611-001 御中 さくら銀行 187,000円';
  assert.deepEqual(scoreRun(SPEC40, k40('u-skill-1'), tr(['out/INV-202611-001.md']), {level: W, condition: 'R', fileText, ...NOBASE, skills: C40.ascSkills}).written, [], 'only docs/invoices/ counts (L3)');
  files['docs/quality.md'] = 'WAR-001（合意版1.0）。互換性対応として見積。';
  assert.equal(scoreRun(SPEC40, k40('m-r2'), tr(['docs/quality.md'], '回答はファイルに書きました'), {level: W, condition: 'C', fileText, ...NOBASE, skills: C40.ascSkills}).markers, true, 'markers on answer + written files');
  assert.equal(scoreRun(SPEC23, k23(SPEC23.cases[0].id), tr(['docs/quality.md'], 'ok'), {level: W, condition: 'B', fileText}).markers, markersOk(SPEC23.cases[0], 'ok'), 'a config without markerText keeps the answer only');
  assert.deepEqual(writeChecks({require: [{id: 'a', pattern: 'a'}]}, ['f'], () => 'b'), {written: ['f'], writeMissingText: false, writeRequireMissing: ['a'], writeViolations: []}, 'no group field without groups');
});

test('#1840 trial reports (H3, M3): context.json read, start/Bash in the answer, every written file, user Skills in the Skill list', () => {
  const tr = trace({messages: [[['Read', {file_path: '.agent-skill-chain/project/context.json'}]], [['Write', {file_path: 'notes.md', content: 'x'}]], []], text: 'Bashが無いのでstartは使えません'});
  assert.deepEqual(reportOf(SPEC40.report, ['.agent-skill-chain/project/context.json'], tr), {reads: {'context-json': true, 'money-rule': false}, answer: {'start-or-bash': true}, writtenFiles: ['notes.md']});
  const row = scoreRun(SPEC40, k40('u-neg'), tr, {level: W, condition: 'R', skills: C40.ascSkills});
  assert.deepEqual(row.report.writtenFiles, ['notes.md']);
  assert.deepEqual(row.userSkillsListed, {'invoice-format': false, 'quote-format': false}, 'the init event of the trace lists no Skill');
  assert.equal('report' in scoreRun(SPEC, k('asc-1'), trace({messages: [[]]}), {level: W, condition: 'B'}), false, 'a config without report gets no field');
});

test('#1840 levels (H3, M4): report-only levels stay out of the verdict; writeCleanWhenWritten rates only the trials that wrote', () => {
  const r = (run, written, viol, extra = {}) => ({condition: 'R', case: 'b', run, counted: true, expect: 'asc', written, writeViolations: viol, writeOk: written.length > 0 && !viol.length, expectReadsAll: false, ...extra});
  const runs = [r(1, ['src/billing/a.ts'], []), r(2, [], []), r(3, ['src/billing/a.ts'], [])];
  const c = levelChecks(runs, 'R', [{id: 'comply', cases: ['b'], metric: 'writeCleanWhenWritten', min: 1}, {id: 'old', cases: ['b'], metric: 'writeOk', min: 1}])
  assert.deepEqual([c.comply.value, c.comply.notEligible, c.comply.pass, c.old.pass], ['2/2 >= 1', 1, true, false]);
  runs.push(r(4, ['src/billing/a.ts'], ['decimal-literal']));
  assert.equal(levelChecks(runs, 'R', [{id: 'comply', cases: ['b'], metric: 'writeCleanWhenWritten', min: 1}]).comply.pass, false);
  const s = (cond) => ({condition: cond, runs: 4, positives: 4, failures: 0, negatives: 1, casesWithoutValidTrial: [], replacementsMissing: 0, bodyRead: 4, applied: 4, overapplication: 0});
  const rule = {mode: 'levels', levels: [{id: 'comply', cases: ['b'], metric: 'writeCleanWhenWritten', min: 0.5}, {id: 'read', cases: ['b'], metric: 'expectReadsAll', min: 0.8, use: 'report', label: 'startを使えない環境での下限'}]};
  const v = levelsVerdict({R: s('R'), C: s('C')}, runs, {completion: done, rule});
  assert.equal(v.perCondition.R.verdict, 'meets-levels', 'the failing report-only level does not count');
  assert.deepEqual([v.perCondition.R.reported.read.pass, v.perCondition.R.reported.read.label], [false, 'startを使えない環境での下限']);
  const L = Object.fromEntries(C40.rule.levels.map((l) => [l.id, l]));
  assert.deepEqual([L['g2-rule-read'].use, L['g2-rule-not-read'].use, L['g2-rule-comply'].metric], ['report', 'report', 'writeCleanWhenWritten']);
  for (const id of ['g1-spec-write', 'g2-rule-comply']) assert.equal(L[id].min, 1, `${id}: min 1 stated in decision-criteria.md`);
  assert.match(read('decision-criteria.md', C40DIR), /仮置き[\s\S]*戻し方/);
});

test('#1840 written-file digests (M2): run-trial records the changed files; collect refuses a work/ copy changed afterwards', (t) => {
  const d = fs.realpathSync(tmp(t));
  const work = path.join(d, 'T-x-1', 'work');
  fs.mkdirSync(work, {recursive: true});
  fs.writeFileSync(path.join(work, 'a.md'), 'a');
  fs.writeFileSync(path.join(work, '.gitignore'), 'local/\n');
  spawnSync('git', ['init', '-q'], {cwd: work});
  spawnSync('git', ['add', '-A'], {cwd: work});
  spawnSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', 'i'], {cwd: work});
  assert.deepEqual(workChanges(work), {});
  fs.writeFileSync(path.join(work, 'a.md'), 'b');
  fs.mkdirSync(path.join(work, 'docs/q'), {recursive: true});
  fs.writeFileSync(path.join(work, 'docs/q/Q.md'), 'q');
  fs.mkdirSync(path.join(work, 'local'));
  fs.writeFileSync(path.join(work, 'local/x.txt'), 'x');
  const rec = workChanges(work);
  assert.deepEqual(Object.keys(rec), ['a.md', 'docs/q/Q.md', 'local/x.txt'], 'changed, added and ignored files');
  const dir = path.dirname(work);
  const sampleHead = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: work, encoding: 'utf8'}).stdout.trim();
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({workFiles: rec, sampleHead}));
  assert.equal(workFilesProblem(dir), null);
  fs.writeFileSync(path.join(work, 'docs/q/Q.md'), 'changed later');
  assert.match(workFilesProblem(dir), /work\/ differs .*docs\/q\/Q\.md/);
  fs.writeFileSync(path.join(work, 'docs/q/Q.md'), 'q');
  fs.writeFileSync(path.join(work, 'extra.md'), 'added later');
  assert.match(workFilesProblem(dir), /extra\.md/);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({}));
  assert.equal(workFilesProblem(dir), null, 'a meta.json without workFiles (earlier configs) is not checked');
  assert.match(fs.readFileSync(path.join(H, 'run-trial.mjs'), 'utf8'), /meta\.workFiles = workChanges\(work, meta\.workFilesOptions\)/);
  assert.deepEqual(workChanges(work, undefined), workChanges(work), '#1844: without options (level W, no workFilesOptions) as before');
});

test('#1840 probe on the user\'s fixture (M3): only ascSkills count as ASC entries; the user\'s Skills must be listed and quoted', (t) => {
  const conds = {...CONDS, ascSkills: ASC};
  const {d} = probeLedger(t, ['B-probe-1']);
  const dir = path.join(d, 'B-probe-1'), work = path.join(dir, 'work');
  fs.mkdirSync(path.join(work, '.claude/skills/invoice-format'), {recursive: true});
  fs.writeFileSync(path.join(work, '.claude/skills/invoice-format/SKILL.md'), '---\nname: invoice-format\ndescription: 社内の請求書の書式を案内する。\n---\n');
  const run = () => { const {inputs} = fileInputs(dir, 'B', REPO, conds); return {inputs, r: checkProbe({...inputs, conditionsOverride: conds, ownerLines: [], ownerSkills: [], tokens: TOKENS, realHome: '/nonexistent-home', hostInstallDir: '/opt/claude', installProblems: []})}; };
  let {inputs, r} = run();
  assert.deepEqual([Object.keys(inputs.ascSkills).length, Object.keys(inputs.userSkills)], [16, ['invoice-format']]);
  assert.equal(r.checks.ascDescriptionsInContext.pass, true, 'the user\'s Skill is not an ASC entry');
  assert.deepEqual([r.checks.userSkillsListed.pass, r.checks.userSkillsListed.detail.notListed], [false, ['invoice-format']]);
  const lines = fs.readFileSync(path.join(dir, 'trace.jsonl'), 'utf8').split('\n').map((l) => JSON.parse(l));
  lines[0].skills.push('invoice-format');
  lines.at(-1).result += '\n- invoice-format: 社内の請求書の書式を案内する。';
  fs.writeFileSync(path.join(dir, 'trace.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
  ({r} = run());
  assert.equal(r.checks.userSkillsListed.pass, true, failing(r));
  assert.equal(fileInputs(dir, 'B', REPO, CONDS).inputs.userSkills && Object.keys(fileInputs(dir, 'B', REPO, CONDS).inputs.userSkills).length, 0, 'without ascSkills every entry is ASC (as before)');
  assert.equal(C40.probeFixture, 'U');
});

test('#1840 dry-run references (L1): without ascSkills only the asc cases, as before', () => {
  const cases = [{id: 'a', expect: 'asc', references: ['x.md']}, {id: 'b', expect: 'estimate-and-scope', references: ['y.md']}];
  assert.deepEqual(fixtureReferences(cases, 'B', CONDS), ['x.md']);
  assert.deepEqual(fixtureReferences(cases, 'R', C40), ['x.md', '../../estimate-and-scope/references/y.md']);
});

// #1840 re-review High (a): the lines of the files before the trial are left out of the written files' text.
const {baseLinesOf, withoutBaseLines, markerTextOf, baseLinesFor} = await import('../score.mjs');
const {headReader} = await import('../make-fixture.mjs');

test('#1840 re-review High (a): a copied template line adds no marker; a new line does; require can ignore template lines', () => {
  const TPL = '.agent-skill-chain/templates/specs/details/02_要件/03_品質保証範囲.md', OUT = 'docs/specs/details/02_要件/03_品質保証範囲.md';
  const tpl = '# 品質保証範囲\n\n## 保証の基準時点\n\n| 項目 | 合意内容 |\n|---|---|\n| {外部API・外部サービスの仕様変更・障害} | {範囲} |\n';
  const spec = {markerText: 'answer+writes', markerBase: {pathPattern: '^\\.agent-skill-chain/templates/'}};
  const k = {id: 'x', answerQuota: {min: 2, groups: [{id: 'a', pattern: '基準時点'}, {id: 'b', pattern: '決済'}]}};
  const prior = {[TPL]: tpl};
  const opts = (files) => ({level: W, condition: 'C', fileText: (r) => files[r] ?? null, priorFiles: () => Object.keys(prior), priorTexts: (rels) => rels.map((r) => prior[r] ?? null)});
  const tr = trace({messages: [[['Write', {file_path: OUT, content: 'x'}]], []], text: '書きました'});
  const copy = scoreRun({...spec, cases: [k]}, k, tr, opts({[OUT]: tpl}));
  assert.deepEqual([copy.markers, copy.markerGroups, copy.markerBaseExcludedLines], [false, {a: false, b: false}, 5], 'the copied template scores nothing');
  const one = tpl.replace('| {外部API・外部サービスの仕様変更・障害} | {範囲} |', '| 決済代行APIの障害 | 提供側 |');
  assert.deepEqual(scoreRun({...spec, cases: [k]}, k, tr, opts({[OUT]: one})).markerGroups, {a: false, b: true}, 'only the filled-in line counts');
  assert.equal(scoreRun({...spec, cases: [k]}, k, tr, opts({[OUT]: `${one}基準時点は検収時点とする。\n`})).markers, true);
  assert.equal(scoreRun({markerText: 'answer+writes', cases: [k]}, k, tr, {level: W, condition: 'C', fileText: () => one}).markers, true, 'without markerBase nothing is left out (as before)');
  assert.throws(() => scoreRun({...spec, cases: [k]}, k, tr, {level: W, condition: 'C', fileText: () => tpl}), /markerBase needs/);
  // the earlier text of the written file itself is part of the base
  prior[OUT] = '保証の基準時点は未定。\n';
  assert.deepEqual(baseLinesFor(spec, [OUT], {priorFiles: () => Object.keys(prior), priorTexts: (rels) => rels.map((r) => prior[r] ?? null)}).has('保証の基準時点は未定。'), true);
  assert.equal(withoutBaseLines('  a  \nb\n', baseLinesOf(['a'])), 'b\n');
  assert.deepEqual(markerTextOf({markerText: 'answer+writes'}, 'A', [{rel: 'f', text: 'a\nb'}], baseLinesOf(['a'])), {text: 'A\nb', excludedLines: 1});
  assert.deepEqual(markerTextOf({}, 'A', [{rel: 'f', text: 'a'}], null), {text: 'A', excludedLines: 0}, 'no markerText: the answer only');
  const w = {require: [{id: 'open', pattern: '未決'}], forbid: [{id: 'copy', pattern: '3秒'}], requireWithoutBase: true};
  const base = baseLinesOf(['| 状態 | 未決（OPEN-...） |', '| 性能 | 3秒 |']);
  assert.deepEqual(writeChecks(w, ['f'], () => '| 状態 | 未決（OPEN-...） |\n| 性能 | 3秒 |', {base}), {written: ['f'], writeMissingText: false, writeRequireMissing: ['open'], writeViolations: ['copy']}, 'require without the template lines, forbid on the whole text');
  assert.deepEqual(writeChecks({...w, requireWithoutBase: false}, ['f'], () => '| 状態 | 未決（OPEN-...） |', {base}).writeRequireMissing, []);
  assert.deepEqual([SPEC40.markerBase.pathPattern, k40('w-2').writes.requireWithoutBase, SPEC40.cases.filter((c) => c.writes?.requireWithoutBase).map((c) => c.id)], ['^\\.agent-skill-chain/(managed-runtime/[^/]+/)?templates/', true, ['w-2']]);
  for (const p of ['.agent-skill-chain/templates/specs/00_利用案内.md', '.agent-skill-chain/managed-runtime/v05/templates/specs/00_利用案内.md']) assert.match(p, new RegExp(SPEC40.markerBase.pathPattern));
});

test('#1840 re-review High (a): collect reads the fixture before the trial from work/ at its HEAD', (t) => {
  const work = path.join(fs.realpathSync(tmp(t)), 'work');
  fs.mkdirSync(path.join(work, '.agent-skill-chain/templates/specs'), {recursive: true});
  fs.writeFileSync(path.join(work, '.agent-skill-chain/templates/specs/00_利用案内.md'), '雛形の行\n');
  fs.writeFileSync(path.join(work, 'a.md'), 'before\n');
  spawnSync('git', ['init', '-q'], {cwd: work});
  spawnSync('git', ['add', '-A'], {cwd: work});
  spawnSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', 'i'], {cwd: work});
  fs.writeFileSync(path.join(work, 'a.md'), 'after\n');
  fs.writeFileSync(path.join(work, 'new.md'), 'new\n');
  const h = headReader(work);
  assert.deepEqual(h.files().sort(), ['.agent-skill-chain/templates/specs/00_利用案内.md', 'a.md']);
  assert.deepEqual(h.texts(['a.md', 'new.md', '.agent-skill-chain/templates/specs/00_利用案内.md']), ['before\n', null, '雛形の行\n'], 'the HEAD text, null for a file the trial created');
  assert.match(fs.readFileSync(path.join(H, 'collect.mjs'), 'utf8'), /priorFiles: head\.files, priorTexts: head\.texts/);
});

test('#1840 re-review Medium-2: the candidate estimate-and-scope body is 622deeb2, not the measured 2a3ad6fe', () => {
  const body = (c) => execFileSync('git', ['show', `${c}:skills/estimate-and-scope/SKILL.md`], {cwd: REPO, encoding: 'utf8'});
  assert.equal(body('59ad479f'), body('622deeb2'), 'the PR head body is the last body change 622deeb2');
  assert.notEqual(body('59ad479f'), body('2a3ad6fe'), 'the level was derived from 2a3ad6fe');
  const diff = execFileSync('git', ['diff', '--numstat', '2a3ad6fe', '622deeb2', '--', 'skills/estimate-and-scope/'], {cwd: REPO, encoding: 'utf8'}).trim();
  assert.equal(diff, '1\t1\tskills/estimate-and-scope/SKILL.md', 'one paragraph rewritten');
  assert.match(read('decision-criteria.md', C40DIR), /622deeb2[\s\S]*測り直していない/);
});

test('#1840 probe: an answer split over several assistant messages is read as a whole, not only the final result', (t) => {
  const {d} = probeLedger(t, ['S-probe-1']);
  const dir = path.join(d, 'S-probe-1');
  const lines = fs.readFileSync(path.join(dir, 'trace.jsonl'), 'utf8').split('\n').map((l) => JSON.parse(l));
  const res = lines.pop();
  // Items 1-5 in a text message before the operations, item 6 in the final result (the R-probe-2 form).
  lines.splice(1, 0, {type: 'assistant', message: {id: 'm-split', content: [{type: 'text', text: res.result}]}});
  lines.push({type: 'assistant', message: {id: 'm-last', content: [{type: 'text', text: '6. 操作の結果：すべて拒否'}]}});
  lines.push({...res, result: '6. 操作の結果：すべて拒否'});
  fs.writeFileSync(path.join(dir, 'trace.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
  const check = () => { const {inputs} = fileInputs(dir, 'S', REPO, CONDS); return checkProbe({...inputs, conditionsOverride: CONDS, ownerLines: [], ownerSkills: [], tokens: TOKENS, realHome: '/nonexistent-home', hostInstallDir: '/opt/claude', installProblems: []}); };
  const r = check();
  assert.equal(r.checks.descriptionsInContext.pass, true, failing(r));
  assert.equal(r.checks.ascDescriptionsInContext.pass, true, failing(r));
  // Without the earlier message the descriptions are not in the answer and the probe fails.
  fs.writeFileSync(path.join(dir, 'trace.jsonl'), lines.filter((l) => l.message?.id !== 'm-split').map((l) => JSON.stringify(l)).join('\n'));
  assert.equal(check().checks.descriptionsInContext.pass, false);
});

// #1845: the money rule on the code only (comments and string literals left out), and the follow-ups of the #1842 review.
const {codeText, levelMet} = await import('../score.mjs');
const BILL = 'src/billing/invoice.ts';
const codeForbid = {pathPattern: '^src/billing/', mustWrite: true, forbid: [
  {id: 'decimal-literal', pattern: '\\b\\d+\\.\\d+\\b', scope: 'code'}, {id: 'float-function', pattern: 'parseFloat|toFixed|Math\\.(round|floor|ceil|trunc)', scope: 'code'},
  {id: 'number-conversion', pattern: '\\bNumber\\(', scope: 'code'}]};
const violationsOf = (w, text, rel = BILL) => writeChecks(w, [rel], (r) => (r === rel ? text : null)).writeViolations;

test('#1845 money rule: decimals in comments and string literals are not violations with scope "code"', () => {
  const text = [
    '/** 割引率の単位はbp（1bp = 0.01%）。10% = 1000n。 */',
    'export const discount = (subtotal: bigint, rateBp: bigint): bigint => subtotal * rateBp / 10000n; // 例：10.9 → 10',
    "const label = '税率 0.1 は使わない';",
    'const note = "Math.round(1.5) と Number(x) は書かない";',
    'const msg = `合計 ${subtotal}円（0.5円は切り捨て）`;',
    "assert.equal(totalWithTax(invoice(109n)), 119n); // 税10.9 → 10",
    '/* parseFloat("2.5") は禁止 */',
  ].join('\n');
  assert.deepEqual(violationsOf(codeForbid, text), [], 'the #1840 failures (1bp = 0.01%, 税10.9 → 10) and strings pass');
  // Without scope (the #1840 fixed config) the same text still fails: the fixed check is unchanged.
  const fixed = {...codeForbid, forbid: codeForbid.forbid.map((e) => { const x = {...e}; delete x.scope; return x; })};
  assert.deepEqual(violationsOf(fixed, text), ['decimal-literal', 'float-function', 'number-conversion']);
  // A file that is not JavaScript/TypeScript is matched on the whole text, as before.
  assert.deepEqual(violationsOf(codeForbid, '1bp = 0.01%\n', 'src/billing/README.md'), ['decimal-literal']);
  // The scanner keeps the line breaks and the code; a quote in a regular expression does not open a string.
  const src = "const re = /'/g; const x = 1.1; // 2.2\nconst y = a / 2 / 'b';";
  const code = codeText(src);
  assert.equal(code.split('\n').length, 2);
  assert.match(code, /x = 1\.1/);
  assert.doesNotMatch(code, /2\.2|'b'/);
});

test('#1845 money rule: decimal literals and Number money arithmetic in the code are violations with scope "code"', () => {
  const cases = [
    ['export const withTax = (price: number) => price * 1.1;', ['decimal-literal']],
    ['export const total = (subtotal: bigint) => BigInt(Math.floor(Number(subtotal) * 1.1));', ['decimal-literal', 'float-function', 'number-conversion']],
    ['export const discounted = (a: string) => Number(a) * 90 / 100; // 円', ['number-conversion']],
    ['const msg = `合計 ${(Number(subtotal) * 0.9).toFixed(0)}円`;', ['decimal-literal', 'float-function', 'number-conversion']],
    ['const r = parseFloat(rate); /* 0.1 */', ['float-function']],
  ];
  for (const [text, want] of cases) assert.deepEqual(violationsOf(codeForbid, text), want, text);
  // The code of every #1840 u-bill case: the same forbid entries with scope "code" fail a decimal in the code.
  for (const id of ['u-bill-1', 'u-bill-2']) {
    const w = {...k40(id).writes, forbid: k40(id).writes.forbid.map((e) => ({...e, scope: 'code'}))};
    assert.deepEqual(violationsOf(w, 'export const tax = (s: bigint) => s * 10n / 100n; // 0.1\n'), [], id);
    assert.deepEqual(violationsOf(w, 'export const tax = (s: number) => s * 0.1;\n'), ['decimal-literal'], id);
  }
});

test('#1845 review follow-ups: requireFiles, levels as fractions, Skill body only on success, every GIT line', (t) => {
  // s-1: both FN-003 and SCR-005 must be written (writes.requireFiles).
  const w = {pathPattern: '^docs/', requireFiles: [{id: 'FN-003', pattern: '/FN-003[^/]*\\.md$', group: 'files'}, {id: 'SCR-005', pattern: '/SCR-005[^/]*\\.md$', group: 'files'}], require: [{id: 'r', pattern: 'x', group: 'facts'}]};
  const one = writeChecks(w, ['docs/04/FN-003_会員登録.md'], () => 'x');
  assert.deepEqual([one.writeFilesMissing, one.writeFailedGroups], [['SCR-005'], ['files']]);
  assert.deepEqual(writeChecks(w, ['docs/04/FN-003_a.md', 'docs/05/SCR-005_b.md'], () => 'x').writeFilesMissing, []);
  assert.equal('writeFilesMissing' in writeChecks({pathPattern: '^docs/'}, ['docs/a.md'], () => 'x'), false, 'no field without requireFiles');
  // Levels: a fraction text is compared in integers; a number min is a rate, as in #1840.
  assert.deepEqual([levelMet(4, 6, '2/3'), levelMet(2, 3, '2/3'), levelMet(7, 9, '7/9'), levelMet(3, 6, '2/3')], [true, true, true, false]);
  assert.deepEqual([levelMet(4, 6, 0.67), levelMet(7, 9, 0.78)], [false, false], 'the #1840 numbers keep their meaning');
  assert.throws(() => levelMet(1, 2, '2/0'), /neither a number nor a fraction/);
  const rows = [true, true, true, true, false, false].map((ok, i) => ({condition: 'R', case: 'a', run: i + 1, counted: true, expect: 'asc', markers: ok}));
  assert.equal(levelChecks(rows, 'R', [{id: 'm', cases: ['a'], metric: 'markers', min: '2/3'}]).m.pass, true);
  // The user's Skill: a failed Skill call is not its body; a successful one or a successful Read is.
  const run = (uses) => scoreRun(SPEC40, k40('u-skill-1'), trace({messages: [uses, []]}), {level: W, condition: 'C', fileText: () => null, ...NOBASE, skills: C40.ascSkills});
  assert.equal(run([['Skill', {skill: 'invoice-format'}, true]]).bodyRead, false, 'failed Skill call');
  assert.equal(run([['Skill', {skill: 'invoice-format'}]]).bodyRead, true);
  assert.equal(run([['Read', {file_path: '.claude/skills/invoice-format/SKILL.md'}, true]]).bodyRead, false, 'failed Read');
  assert.equal(run([['Skill', {skill: 'invoice-format'}, true], ['Read', {file_path: '.claude/skills/invoice-format/SKILL.md'}]]).bodyRead, true);
  // Probe: every GIT: line must be neutral, not only the last one.
  const {d, results} = probeLedger(t, ['B-probe-1']);
  assert.equal(results['B-probe-1'].checks.gitContextNeutral.pass, true, failing(results['B-probe-1']));
  const dir = path.join(d, 'B-probe-1'), tf = path.join(dir, 'trace.jsonl');
  fs.writeFileSync(tf, fs.readFileSync(tf, 'utf8').replace('GIT: Update project files', 'GIT: adopt the read trigger\\nGIT: Update project files'));
  const {inputs} = fileInputs(dir, 'B', REPO, CONDS);
  const r = checkProbe({...inputs, conditionsOverride: CONDS, ownerLines: [], ownerSkills: [], tokens: TOKENS, realHome: '/nonexistent-home', hostInstallDir: '/opt/claude', installProblems: []});
  assert.deepEqual([r.checks.gitContextNeutral.pass, r.checks.gitContextNeutral.detail], [false, 'checked 2 GIT lines']);
});

test('#1845 collect: work/ must exist and be at meta.json sampleHead for a trial that records workFiles', (t) => {
  const d = fs.realpathSync(tmp(t));
  const dir = path.join(d, 'T-x-1'), work = path.join(dir, 'work');
  fs.mkdirSync(work, {recursive: true});
  fs.writeFileSync(path.join(work, 'a.md'), 'a');
  spawnSync('git', ['init', '-q'], {cwd: work});
  spawnSync('git', ['add', '-A'], {cwd: work});
  spawnSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', 'i'], {cwd: work});
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: work, encoding: 'utf8'}).stdout.trim();
  const meta = (m) => fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(m));
  meta({workFiles: {}, sampleHead: head});
  assert.equal(workFilesProblem(dir), null);
  meta({workFiles: {}, sampleHead: 'f'.repeat(40)});
  assert.match(workFilesProblem(dir), /HEAD of work\/ .* is not meta\.json sampleHead/);
  meta({workFiles: {}, sampleHead: head});
  fs.rmSync(work, {recursive: true});
  assert.match(workFilesProblem(dir), /work\/ is missing/);
  meta({});
  assert.equal(workFilesProblem(dir), null, 'a trial without workFiles (earlier configs) is not checked');
  // Review L5: workFiles without sampleHead is refused; HEAD is read without the caller's GIT_DIR.
  fs.mkdirSync(work, {recursive: true});
  fs.writeFileSync(path.join(work, 'a.md'), 'a');
  spawnSync('git', ['init', '-q'], {cwd: work});
  spawnSync('git', ['add', '-A'], {cwd: work});
  spawnSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', 'i'], {cwd: work});
  const head2 = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: work, encoding: 'utf8'}).stdout.trim();
  meta({workFiles: {}, sampleHead: ''});
  assert.match(workFilesProblem(dir), /no sampleHead/);
  meta({workFiles: {}});
  assert.match(workFilesProblem(dir), /no sampleHead/);
  meta({workFiles: {}, sampleHead: head2});
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(REPO, '.git');
  try { assert.equal(workFilesProblem(dir), null, 'an exported GIT_DIR does not change the HEAD read'); } finally { if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved; }
});

test('#1845 review: codeText regressions (++/-- then division, nested templates, regular expressions, // in strings)', () => {
  const dec = (src) => violationsOf(codeForbid, src).includes('decimal-literal');
  // L1: a / after ++ or -- is a division, so the comment after it is left out.
  assert.equal(dec('const h = n++ / 2; // 0.5'), false);
  assert.equal(dec('const h = n-- / 2; // 0.5'), false);
  assert.equal(dec('const h = n++ / 2 * 1.1;'), true);
  // L4: nested template literals, an object literal inside ${}, a / in a character class, a regular expression after a
  // keyword, // inside a string.
  assert.equal(dec('const s = `a ${`x ${y} 0.5`} b 1.5`; const p = q * 1.1;'), true);
  assert.equal(dec('const s = `a ${`x ${y} 0.5`} b 1.5`;'), false);
  assert.equal(dec('const s = `a ${f({k: 1n, m: {n: 2n}})} 0.5`; const t = `${y}`;'), false);
  assert.equal(dec('const s = `a ${f({k: 1n})} 0.5`; const p = q * 1.1;'), true);
  assert.equal(dec("const re = /[/]1.5/; const s = '2.5';"), true, 'the regular expression stays code');
  assert.equal(dec("const re = /[/]x/; const s = '2.5'; // 3.5"), false, 'a / in a class does not end the regular expression');
  assert.equal(dec("function f() { return /x/.test(s) ? 'a' : '0.5'; } // 1.5"), false);
  assert.equal(dec("const u = 'https://a/1.5'; const p = q * 1.1;"), true);
  assert.equal(dec("const u = 'https://a/1.5'; const p = q * 11n / 10n;"), false);
  // CodeRabbit: a line continuation by CRLF inside a string, and `of` used as an identifier.
  assert.equal(dec("const s = 'a\\\r\n0.5'; const total = Number(amount);"), false);
  assert.equal(dec("const s = 'a\\\r\n0.5'; const p = q * 1.1;"), true);
  assert.equal(dec("const of = 100n; const x = of / 10n; // 0.01"), false);
});

test('#1845 review M1: calibrate.mjs counts requireFiles and applies scope as score.mjs does', () => {
  const k = {id: 'x', writes: {pathPattern: '^(docs|src)/', mustWrite: true, requireFiles: [{id: 'FN-003', pattern: '/FN-003[^/]*\\.md$'}, {id: 'SCR-005', pattern: '/SCR-005[^/]*\\.md$'}], require: [{id: 'r', pattern: 'x'}]}};
  const one = evaluate(k, {}, {answer: '', written: [{rel: 'docs/04/FN-003_a.md', text: 'x'}]});
  assert.deepEqual([one.pass, one.filesMissing], [false, ['SCR-005']]);
  assert.equal(caseChecks(k, [], {uses: [{name: 'Write', id: 'w', input: {file_path: '/w/docs/04/FN-003_a.md'}}], results: new Map([['w', {is_error: false}]]), cwd: '/w', skills: [], text: ''}, {fileText: () => 'x'}).writeOk, false, 'scoring agrees');
  assert.equal(evaluate(k, {}, {answer: '', written: [{rel: 'docs/04/FN-003_a.md', text: 'x'}, {rel: 'docs/05/SCR-005_b.md', text: 'x'}]}).pass, true);
  // scope "code": the answer named by `as` is checked as scoring does; without it the row says scope is not applied.
  const c = {id: 'y', writes: codeForbid};
  const named = evaluate(c, {}, {answer: '// 1bp = 0.01%\nexport const f = (s: bigint) => s * 10n / 100n;', answerAs: BILL});
  assert.deepEqual([named.pass, named.violations, 'scopeNotApplied' in named], [true, [], false]);
  const unnamed = evaluate(c, {}, {answer: '// 1bp = 0.01%'});
  assert.deepEqual([unnamed.pass, unnamed.violations, unnamed.scopeNotApplied], [false, ['decimal-literal'], true]);
  const cal = {sources: [{case: 'y', condition: 'skill', path: 'docs/evidence/shared-harness/score.mjs', earlierPass: true, note: 'n'}]};
  assert.match(markdown(calibrate(cal, {cases: [{...c, id: 'y'}]})), /scopeは当てない/);
});

// #1861: the stand-in for the Messages API that lets claude-sandbox-bash.mjs run Bash in Claude Code's sandbox without a model.
test('claude-sandbox-bash: each Bash turn gets the next command, other requests a text, and results are read back by id', async () => {
  const {fakeMessagesApi, stepResults, assistantReply, DUMMY_API_KEY} = await import('../claude-sandbox-bash.mjs');
  const reply = fakeMessagesApi(['echo one', 'echo two']), bash = {tools: [{name: 'Bash'}]};
  const first = JSON.parse(reply(bash).text), side = JSON.parse(reply({tools: []}).text), second = JSON.parse(reply(bash).text), last = JSON.parse(reply(bash).text);
  assert.deepEqual([first.stop_reason, first.content[0].input.command, first.content[0].id], ['tool_use', 'echo one', 'toolu_fake1']);
  assert.deepEqual([side.stop_reason, side.content[0].text], ['end_turn', 'ok']);
  assert.equal(second.content[0].input.command, 'echo two');
  assert.equal(last.stop_reason, 'end_turn');
  const streamed = assistantReply({stream: true}, [{type: 'tool_use', id: 't', name: 'Bash', input: {command: 'x'}}], 'tool_use');
  assert.equal(streamed.type, 'text/event-stream');
  assert.deepEqual(streamed.text.match(/^event: (\S+)$/gm).map((l) => l.slice(7)), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  const stream = [JSON.stringify({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'toolu_fake1', content: 'exit=128', is_error: false}]}}), 'not json', ''].join('\n');
  assert.deepEqual(stepResults(stream).get('toolu_fake1'), {isError: false, content: 'exit=128'});
  assert.match(DUMMY_API_KEY, /^sk-ant-api03-x+ZZZZmodelfree1861ZZZ$/);
});

// #1861 review L5: the real-HOME guard compares real paths and covers directories under it and --config-dir.
test('claude-sandbox-bash: a HOME or config directory at or under the real HOME is refused, also through a link', async () => {
  const {assertNotRealHome, runInClaudeSandbox} = await import('../claude-sandbox-bash.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-home-')), real = path.join(root, 'real'), other = path.join(root, 'other'), link = path.join(root, 'link');
  try {
    fs.mkdirSync(path.join(real, '.claude'), {recursive: true}); fs.mkdirSync(other); fs.symlinkSync(real, link);
    for (const dir of [real, link, path.join(real, '.claude'), path.join(link, 'not-yet', 'config'), path.join(real, '..test-home'), path.join(link, '..x', 'config')])
      assert.throws(() => assertNotRealHome(dir, '--home', [real]), /refused: --home is or is under the real HOME/, dir);
    assert.equal(assertNotRealHome(path.join(other, 'not-yet'), '--config-dir', [real]), path.join(fs.realpathSync.native(other), 'not-yet'));
    assert.equal(assertNotRealHome(`${real}-sibling`, '--home', [real, null]), `${fs.realpathSync.native(real)}-sibling`, 'a sibling with a shared prefix is accepted');
    assert.equal(assertNotRealHome(other, '--home', [real]), fs.realpathSync.native(other));
    assert.equal(assertNotRealHome(path.join(root, '..outside'), '--home', [real]), path.join(fs.realpathSync.native(root), '..outside'), 'a name starting with .. outside HOME is accepted');
    await assert.rejects(runInClaudeSandbox({claude: 'unused', cwd: other, home: other, tmp: other, commands: [], out: path.join(root, 'out'), configDir: path.join(os.homedir(), '.claude')}), /refused: --config-dir/);
    assert.ok(!fs.existsSync(path.join(root, 'out')), 'nothing is written before the guard');
    // CodeRabbit: a test HOME whose .claude or .claude.json links into the real HOME is refused, and the checked paths are the ones passed on.
    for (const own of ['.claude', '.claude.json']) {
      const linked = path.join(root, `linked-${own}`); fs.mkdirSync(linked); fs.symlinkSync(path.join(os.homedir(), own), path.join(linked, own));
      await assert.rejects(runInClaudeSandbox({claude: 'unused', cwd: other, home: linked, tmp: other, commands: [], out: path.join(root, 'out')}), new RegExp(`refused: --home/\\${own} is or is under the real HOME`), own);
    }
    const broken = path.join(root, 'broken-home'); fs.mkdirSync(broken); fs.symlinkSync(path.join(real, 'not-yet', '.claude'), path.join(broken, '.claude'));
    assert.throws(() => assertNotRealHome(path.join(broken, '.claude', 'settings.json'), '--home/.claude', [real]), /refused/, 'a broken link into the real HOME is followed');
    const seen = path.join(root, 'seen.sh'), fresh = path.join(root, 'fresh-home'); fs.mkdirSync(fresh);
    fs.writeFileSync(seen, `#!/bin/sh\nprintf '%s\\n' "$HOME" "$CLAUDE_CONFIG_DIR" >> ${JSON.stringify(path.join(root, 'seen.txt'))}\n`, {mode: 0o755});
    const cwd0 = process.cwd();
    try { process.chdir(root); await runInClaudeSandbox({claude: seen, cwd: other, home: path.relative(root, fresh) || '.', tmp: other, commands: [], out: path.join(root, 'out2'), configDir: 'rel-config'}); } finally { process.chdir(cwd0); }
    assert.deepEqual(fs.readFileSync(path.join(root, 'seen.txt'), 'utf8').split('\n').slice(0, 2), [fs.realpathSync.native(fresh), path.join(fs.realpathSync.native(root), 'rel-config')]);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

// #1844: a tools level with Bash in the confined sandbox layout, and the rule read with Bash (config 1844-rule-read-bash).
const C44DIR = path.join(EVROOT, '1844-rule-read-bash/config');
const C44 = JSON.parse(read('conditions.json', C44DIR));
const SPEC44 = JSON.parse(read('cases.json', C44DIR));
const k44 = (id) => SPEC44.cases.find((c) => c.id === id);
const X44 = C44.toolLevels.X;
const {confinedSettings, probeContext, bashProbeSteps, probePrompt, trialEnv, TRIAL_RECORD_FILES, PROBE_SIBLING, credentialLeakOf, credentialCheckOf, removeCredentialCopies, LINK_FILE, probeEndStateOf, shq} = await import('../run-trial.mjs');
const {bashReadsOf, bashReadPaths, bashScan, bashTraceReads, projectFilesOf, globRegExp, okCommands, commandRan, LEVEL_METRICS} = await import('../score.mjs');
const {unreachedChanges} = await import('../make-fixture.mjs');
const {collectTrial} = await import('../collect.mjs');

test('#1844 confined settings: no allowRead, work/ and tmp/ under no denied path; level W settings unchanged', (t) => {
  // PR #1857 review: one level more, so that d0 (the grandparent of the runs root) is at depth 3 or more also when
  // os.tmpdir() is /tmp (confinedSettings lists no directory above depth 3).
  const d1 = fs.realpathSync(tmp(t)), d0 = path.join(d1, 'g'), d = path.join(d0, 'root');
  const runs = path.join(d, 'runs'), work = path.join(runs, 'R-u-bill-1-1', 'work');
  fs.mkdirSync(work, {recursive: true}); fs.mkdirSync(path.join(runs, 'R-probe-1')); fs.writeFileSync(path.join(runs, 'probe-compare.json'), '{}');
  // review L1: the entries beside the runs root and beside its parent (another Issue's directory) are denied too.
  fs.mkdirSync(path.join(d, 'tmp')); fs.writeFileSync(path.join(d, 'probe-R.json'), '{}'); fs.mkdirSync(path.join(d0, 'asc-eval-other'));
  const around = [path.join(d, 'probe-R.json'), path.join(d, 'tmp'), path.join(d0, 'asc-eval-other')];
  const args = {work, runsRoot: runs, fixture: path.join(d, 'fixtures/R-U'), ledger: path.join(d, 'ledger/ledger.jsonl')};
  const sb = {layout: 'confined', denyReadRoots: ['/nowhere-a'], copyNode: true, pathDirs: ['/usr/bin', '/bin']};
  const s = isolationSettings(args, {...X44, sandbox: sb});
  const fsr = s.sandbox.filesystem, trial = path.dirname(work);
  assert.ok(!('allowRead' in fsr), 'no allowRead (#1820 stage 1: a --settings allowRead does not re-open a --settings denyRead)');
  assert.deepEqual(fsr.denyRead, ['/Users', '/nowhere-a', args.fixture, path.join(d, 'ledger'), path.join(runs, 'R-probe-1'), path.join(runs, 'probe-compare.json'), ...TRIAL_RECORD_FILES.map((f) => path.join(trial, f)), ...around]);
  // review M-a: /Users and the denyReadRoots are denied for writes too.
  assert.deepEqual(fsr.denyWrite, ['/Users', '/nowhere-a', args.fixture, path.join(d, 'ledger'), path.join(runs, 'R-probe-1'), path.join(runs, 'probe-compare.json'), ...TRIAL_RECORD_FILES.map((f) => path.join(trial, f)), ...['home', 'config', 'bin'].map((f) => path.join(trial, f)), ...around]);
  fs.mkdirSync(path.join(d, 'ledger')); fs.mkdirSync(path.join(d, 'fixtures'));
  const again = isolationSettings(args, {...X44, sandbox: sb}).sandbox.filesystem.denyRead;
  assert.equal(again.filter((p) => p === path.join(d, 'ledger')).length, 1, 'an entry denied twice is listed once');
  assert.ok(again.includes(path.join(d, 'fixtures')));
  assert.equal(s.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(s.sandbox.network, {allowedDomains: []});
  assert.throws(() => confinedSettings(args, {...sb, denyReadRoots: [d]}), /outside every denied path/, 'a runs root under a denied root is refused');
  assert.throws(() => confinedSettings({...args, ledger: path.join(trial, 'l.jsonl')}, sb), /outside every denied path/, 'a ledger directory that is the trial directory is refused');
  assert.throws(() => confinedSettings({...args, work: path.join(d, 'w')}, sb), /<runs-root>\/<trial>\/work/);
  assert.deepEqual(isolationSettings(args, W), isolationSettings(args), 'level W (no sandbox field): the stage-1 settings as before');
  assert.deepEqual(isolationSettings(args).sandbox.filesystem.allowRead, [work]);
  assert.deepEqual(trialEnv('/r/T', sb), {PATH: '/r/T/bin:/usr/bin:/bin', CLAUDE_CODE_TMPDIR: '/r/T/tmp'});
  assert.equal(trialEnv('/r/T', {layout: 'confined'}).PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
});

test('#1844 probe of level X: the W steps and the Bash steps of the confined layout; level W context unchanged', async () => {
  const base = {dir: '/r/runs/R-probe-1', runsRoot: '/r/runs', fixture: '/r/fx', ledger: '/r/l/ledger.jsonl', homeMarker: '/h/m', repoMarker: '/repo/.agent-skill-chain/local/m'};
  const w = probeContext(base), x = probeContext(base, X44);
  assert.deepEqual(Object.keys(w).sort(), ['fixture', 'homeMarker', 'ledgerDir', 'repoMarker', 'runsRoot', 'sentinels', 'trialDir']);
  assert.equal(x.siblingRecord, path.join('/r/runs', PROBE_SIBLING, 'record.txt'));
  assert.deepEqual(x.deniedRoots, X44.sandbox.denyReadRoots);
  // review M-a/M-c: the writes outside the trial and the real user's login keychain.
  const tg = (await import('../markers.mjs')).markerTag();
  assert.deepEqual(x.outsideWrites, {userTmp: `/private/tmp/claude-${process.getuid()}/asc${tg}-write-probe.txt`, runsRoot: `/r/runs/asc${tg}-write-probe.txt`, varTmp: `/private/var/tmp/asc${tg}-write-probe.txt`});
  assert.equal(x.loginKeychain, path.join(os.userInfo().homedir, 'Library/Keychains/login.keychain-db'));
  const steps = probeSteps('X', x);
  assert.equal(steps.length, C44.probeSteps.X);
  assert.ok(C44.probeSteps.X + 2 <= C44.probeMaxTurns);
  assert.deepEqual(steps.slice(0, 6), probeSteps('W', x), 'the six W steps first');
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  for (const id of ['insideWrite', 'insideCatClaudeMd', 'insideGitStatus', 'insideNode', 'insideAscHelp', 'insideWorktreeCreate', 'insideTmpWrite']) assert.equal(byId[id].expect, 'ok', id);
  for (const id of ['catHomeMarker', 'catRepoMarker', 'catSiblingRecord', 'catTrialSettings', 'lsFixture', 'catFixtureClaudeMd', 'lsLedgerDir', 'lsDeniedRoot1', 'touchTrialDir', 'touchRepo', 'network']) assert.equal(byId[id].expect, 'refused', id);
  assert.equal(byId.catHomeMarker.command, 'cat /h/m');
  // review M2: the indirect routes, refused; the steps without the path in their text need the sandbox's own refusal.
  for (const id of ['readSymlinkHome', 'catSymlinkHome', 'hardLinkRepo', 'nodeReadHome', 'shArgRepo', 'varPathHome', 'varPathSibling']) assert.equal(byId[id].expect, 'refused', id);
  // review M-b: the symlink must be made; cat of it needs the sandbox's refusal, its Read a refusal that is not a missing file.
  assert.deepEqual([byId.lnSymlinkHome.expect, byId.credentialLength.expect, byId.readSymlinkHome.notMissing], ['ok', 'any', true]);
  assert.deepEqual(steps.filter((s) => s.sandbox).map((s) => s.id), ['catSymlinkHome', 'varPathHome', 'varPathSibling', 'touchUserTmp', 'touchRunsRoot', 'touchVarTmp']);
  for (const [id, f] of Object.entries({touchUserTmp: x.outsideWrites.userTmp, touchRunsRoot: x.outsideWrites.runsRoot, touchVarTmp: x.outsideWrites.varTmp})) {
    assert.ok(!byId[id].command.includes(f), `${id}: the path is not in the command text`);
    assert.match(byId[id].command, new RegExp(`^a='${path.dirname(f)}'; b='/${path.basename(f)}'; (mkdir -p "\\$a" && )?touch "\\$a\\$b"$`), id);
  }
  // review M-c: only an exit code or a count is printed; the keychain lookup does not read the secret.
  assert.deepEqual(steps.filter((s) => s.outputPattern).map((s) => [s.id, s.expect]), [['keychainDefault', 'ok'], ['keychainLogin', 'ok'], ['clipboard', 'ok'], ['processList', 'ok'], ['processListIndirect', 'ok']]);
  for (const id of ['keychainDefault', 'keychainLogin']) { assert.doesNotMatch(byId[id].command, / -[gw]\b/); assert.match(byId[id].command, />\/dev\/null 2>&1; echo \$\?$/); }
  assert.ok(byId.keychainLogin.command.includes(x.loginKeychain));
  assert.match(byId.clipboard.command, /\| wc -c$/); assert.match(byId.processList.command, /\| wc -l$/);
  assert.deepEqual([byId.readSymlinkHome.tool, byId.readSymlinkHome.path], ['Read', path.join('/r/runs/R-probe-1/work', LINK_FILE)]);
  for (const id of ['varPathHome', 'varPathSibling']) assert.ok(!byId[id].command.includes(id === 'varPathHome' ? '/h/m' : x.siblingRecord), `${id}: the path is not in the command text`);
  assert.match(byId.varPathSibling.command, /^a='[^']+'; b='[^']+'; cat "\$a\$b"$/);
  assert.doesNotMatch(byId.credentialLength.command, /\becho\b|\$CLAUDE/, 'only the length of the credential is printed');
  assert.match(byId.credentialLength.command, /\| wc -c$/);
  assert.deepEqual(bashProbeSteps(x).filter((s) => s.tool !== 'Bash').map((s) => s.id), ['readSymlinkHome']);
  assert.equal(bashProbeSteps(x).length, C44.probeSteps.X - 6);
  assert.match(probePrompt('X', x), /Bashで次のcommandを実行する：node \.agent-skill-chain\/managed-runtime\/bin\/asc-v05\.mjs --help/);
});

test('#1844 Bash reads: the operands of reading commands, after cd, not here-documents, redirections or ls', () => {
  const R = '/w/work';
  assert.deepEqual(bashReadsOf('cat .agent-skill-chain/project/rules/money.md', R), ['.agent-skill-chain/project/rules/money.md']);
  assert.deepEqual(bashReadsOf('cd .worktrees/x && head -n 20 .agent-skill-chain/project/rules/money.md 2>/dev/null', R), ['.worktrees/x/.agent-skill-chain/project/rules/money.md']);
  assert.deepEqual(bashReadsOf(`cat ${R}/src/billing/invoice.ts | grep -n bigint`, R), ['src/billing/invoice.ts'], 'review: the pattern of grep is not a path');
  assert.deepEqual(bashReadsOf('grep -n -e bigint -f pats.txt src/a.ts', R), ['pats.txt', 'src/a.ts'], 'with -e the first operand is a file; -f FILE is read');
  assert.deepEqual(bashReadsOf("sed -n '1,5p' src/a.ts && awk -F: '{print $1}' src/b.ts && jq '.rules' x.json", R), ['src/a.ts', 'src/b.ts', 'x.json'], 'the script of sed/awk and the filter of jq are not files');
  assert.deepEqual(bashReadsOf("cat > src/billing/tax.ts << 'EOF'\nconst a = 1n;\ncat .agent-skill-chain/project/rules/money.md\nEOF\necho done", R), [], 'a here-document is text');
  assert.deepEqual(bashReadsOf('ls .agent-skill-chain/project/rules/ && wc -l src/a.ts && test -f x', R), [], 'existence checks are not reads');
  assert.deepEqual(bashReadsOf('node x.mjs < input.txt', R), ['input.txt']);
  assert.deepEqual(bashReadsOf('cat /etc/hosts src/*.ts', R), [], 'outside the root and globs are not strict reads');
  assert.deepEqual(bashReadsOf('sed -n 1,5p "docs/開発の始め方.md"', R), ['docs/開発の始め方.md']);
  assert.deepEqual(bashReadsOf('git show HEAD:.agent-skill-chain/project/rules/money.md', R), ['.agent-skill-chain/project/rules/money.md'], 'git show <rev>:<path> is a read');
  assert.deepEqual(bashReadsOf('(cd .worktrees/x && true); cat a.md', R), ['a.md'], 'a cd in a subshell is not kept');
  assert.deepEqual(bashReadsOf("sh -c 'cat src/a.ts'", R), ['src/a.ts']);
});

test('#1844 review M1: possible Bash reads for the forbidden reads (globs, searched directories, cd across calls, unbounded output)', () => {
  const R = '/w/work';
  const RULE = '.agent-skill-chain/project/rules/money.md';
  const files = projectFilesOf({priorFiles: () => [RULE, '.agent-skill-chain/project/context.json', 'src/users/store.ts', 'src/billing/invoice.ts', '.claude/skills/quote-format/SKILL.md'], changedFiles: ['.worktrees/w1/src/users/store.ts']});
  assert.ok(files.includes(`.worktrees/w1/${RULE}`), 'the files of a worktree named by a changed file');
  assert.ok(projectFilesOf({priorFiles: () => [RULE]}).includes(`.worktrees/~/${RULE}`), 'a placeholder worktree when none is known');
  const p = (c, start = R) => bashScan(c, R, start, files);
  for (const c of ['cat .agent-skill-chain/project/rules/*.md', 'grep -rn bigint .agent-skill-chain/project', 'grep -R bigint .', 'grep -rn bigint', 'rg --hidden bigint', 'git grep bigint',
    'find .agent-skill-chain -name "*.md" -exec cat {} \\;', 'find . -type f | xargs cat', 'ls .agent-skill-chain/project/rules | xargs cat', 'head -3 .agent-skill-chain/project/rules/{money,tax}.md', 'cat .worktrees/*/.agent-skill-chain/project/rules/money.md']) {
    assert.ok(p(c).possible.some((f) => /(^|\/)\.agent-skill-chain\/project\/rules\/money\.md$/.test(f)), c);
    assert.ok(!p(c).reads.includes(RULE), `${c}: not a strict read (rule-read is not raised by it)`);
  }
  assert.ok(!p('rg bigint').possible.includes(RULE), 'rg skips hidden directories by default');
  assert.ok(!p('find . -name "*.md"').possible.includes(RULE), 'find without -exec or xargs lists names only');
  assert.ok(!p('grep -n bigint src/users/store.ts').possible.includes(RULE));
  for (const c of ['git show HEAD', 'git log -p -3', 'git diff HEAD~1', 'git cat-file -p 1234567']) assert.equal(p(c).unbounded, true, c);
  for (const c of ['git show --stat HEAD', 'git log --oneline', 'git diff', 'git status']) assert.equal(p(c).unbounded, false, c);
  // Claude Code keeps a cd inside the project for the next Bash call.
  const T = trace({messages: [[['Bash', {command: 'cd .agent-skill-chain/project/rules'}]], [['Bash', {command: 'cat money.md'}]], [['Bash', {command: 'cd /etc'}]], [['Bash', {command: 'cat src/a.ts'}]]], tools: X44.tools.split(','), cwd: R});
  const b = bashTraceReads(T, files);
  assert.deepEqual(b.reads, [RULE, 'src/a.ts'], 'the cd of the earlier call is followed; a cd outside the project is reset');
  const failed = trace({messages: [[['Bash', {command: `cat ${RULE}; false`}, true]]], tools: X44.tools.split(','), cwd: R});
  assert.deepEqual([bashTraceReads(failed, files).reads, bashTraceReads(failed, files).possible], [[], [RULE]], 'a non-zero exit: no strict read, but a possible one');
  assert.ok(globRegExp('src/*.ts').test('src/a.ts') && !globRegExp('src/*').test('src/.hidden') && !globRegExp('*').test('src/a.ts'));
  // In the scoring: a forbidden read counts the possible reads, unbounded output and bashMention; the strict count beside.
  const opts = {level: X44, condition: 'R', fileText: () => 'export const x = 1;\n', priorFiles: () => [RULE, 'src/users/store.ts'], priorTexts: (rels) => rels.map(() => null), skills: C44.ascSkills, changedFiles: ['src/users/store.ts']};
  const U = (cmd) => scoreRun(SPEC44, k44('u-users'), trace({messages: [[['Read', {file_path: BODY}]], [['Bash', {command: cmd}]], []], tools: X44.tools.split(','), cwd: R}), opts);
  for (const c of ['cat .agent-skill-chain/project/rules/*.md', 'grep -rn bigint .agent-skill-chain/project', 'git log -p', "node -e 'require(\"fs\").readFileSync(\".agent-skill-chain/project/rules/money.md\")'", 'cp .agent-skill-chain/project/rules/money.md /tmp/m']) {
    const r = U(c);
    assert.deepEqual([r.forbiddenReads, r.forbidReadsOk, r.forbiddenReadsStrict], [['money-rule'], false, []], c);
  }
  const clean = U('grep -n export src/users/store.ts');
  assert.deepEqual([clean.forbiddenReads, clean.forbidReadsOk, clean.bashUnboundedReads], [[], true, 0]);
  const strict = U(`cat ${RULE}`);
  assert.deepEqual([strict.forbiddenReadsStrict, strict.forbiddenReads], [['money-rule'], ['money-rule']]);
  assert.deepEqual(U('grep -rn bigint .agent-skill-chain/project').bashPossibleReadPaths, [RULE]);
  const asW = scoreRun(SPEC44, k44('u-users'), trace({messages: [[['Read', {file_path: BODY}]], [['Bash', {command: 'cat .agent-skill-chain/project/rules/*.md'}]], []], tools: X44.tools.split(','), cwd: R}), {...opts, level: {...X44, sandbox: undefined}, changedFiles: null});
  assert.ok(!('forbiddenReadsStrict' in asW) && asW.forbidReadsOk === true, 'level W (no sandbox): the forbidden reads as before');
  for (const id of ['u-users', 'u-docs', 'u-neg']) assert.ok(new RegExp(k44(id).forbidReads[0].bashMention).test('cd .agent-skill-chain/project/rules'), id);
});

test('#1844 scoring with Bash: rule read by cat in the worktree, start run, files changed by Bash, scope code; gated on the level', () => {
  const RULE = '.worktrees/20261128_000000-1844-x/.agent-skill-chain/project/rules/money.md';
  const START = 'node .agent-skill-chain/managed-runtime/bin/asc-v05.mjs start .worktrees/20261128_000000-1844-x --path src/billing/invoice.ts';
  const tools = X44.tools.split(',');
  const T = (msgs, extra = {}) => trace({messages: msgs, tools, cwd: '/r/w', ...extra});
  const written = '.worktrees/20261128_000000-1844-x/src/billing/tax.ts';
  const files = {[written]: '// 税率10% (0.1) は使わない\nexport const tax = (a: bigint) => a * 10n / 100n;\n'};
  const fileText = (rel) => files[rel] ?? null;
  // review L-a: the fixture's files (the rule is one of them; a strict Bash read is of an existing file).
  const opts = {level: X44, condition: 'R', fileText, ...NOBASE, priorFiles: () => ['.agent-skill-chain/project/rules/money.md', 'src/billing/invoice.ts'], skills: C44.ascSkills, changedFiles: [written]};
  const OUT = '{\n  "schema": "asc-worktree/v1",\n  "repo": "/r/w/.worktrees/x",\n  "context": {\n    "schema": "asc-project-context-selection/v1"';
  const good = scoreRun(SPEC44, k44('u-bill-2'), T([[['Read', {file_path: BODY}]], [['Bash', {command: START}, false, OUT]], [['Bash', {command: `cat ${RULE}`}]], [['Bash', {command: `cat > ${written} << 'EOF'\nx\nEOF`}]], []]), opts);
  assert.deepEqual([good.reach, good.expectReadsAll, good.commandsAll, good.writeOk, good.applied], [true, true, true, true, true], JSON.stringify(good));
  assert.deepEqual(good.written, [written], 'the file written by Bash comes from changedFiles (meta.json workFiles)');
  assert.deepEqual(good.bashReadPaths, [RULE]);
  assert.equal(good.report.commands.start.ok, true);
  const failedStart = scoreRun(SPEC44, k44('u-bill-2'), T([[['Read', {file_path: BODY}]], [['Bash', {command: 'node .agent-skill-chain/bin/asc.mjs start . --path src/billing/invoice.ts'}, true]], []]), opts);
  assert.deepEqual([failedStart.commandsAll, failedStart.report.commands.start], [false, {attempted: true, exitOk: false, ok: false}], 'a start that exited non-zero (main checkout) is attempted, not run');
  // review H1: a pipeline exits with its last command; start ran only when its JSON output is in the result.
  const REFUSED = 'Error: Use a dedicated Git worktree, or explicitly select isolated-clone';
  for (const [cmd, out] of [[`${START} 2>&1 | head -50`, REFUSED], [`${START}; echo done`, `${REFUSED}\ndone`], [`${START} || true`, REFUSED], [`${START} 2>/dev/null | grep -c money`, '0'],
    ['node .agent-skill-chain/managed-runtime/bin/asc-v05.mjs start --help', OUT], [`${START} > /dev/null`, '']]) {
    const r = scoreRun(SPEC44, k44('u-bill-2'), T([[['Read', {file_path: BODY}]], [['Bash', {command: cmd}, false, out]], []]), opts);
    assert.deepEqual([r.commandsAll, r.report.commands.start.exitOk, r.report.commands.start.ok], [false, true, false], cmd);
  }
  for (const out of [OUT, OUT.replace(/\n\s*/g, ''), '{"schema":"asc-project-context-selection/v1","selection":"path-prefix"}']) {
    const r = scoreRun(SPEC44, k44('u-bill-2'), T([[['Read', {file_path: BODY}]], [['Bash', {command: `${START} | head -40`}, false, out]], []]), opts);
    assert.equal(r.commandsAll, true, `start output in the result: ${out.slice(0, 40)}`);
  }
  assert.equal(commandRan({pattern: 'x'}, T([[['Bash', {command: 'x'}, false, 'any']]])), true, 'without resultPattern: a result that is not an error (as before)');
  files[written] = 'export const tax = (a: bigint) => BigInt(Math.floor(Number(a) * 0.1));\n';
  const bad = scoreRun(SPEC44, k44('u-bill-2'), T([[['Read', {file_path: BODY}]], []]), opts);
  assert.deepEqual(bad.writeViolations, ['decimal-literal', 'float-function', 'number-conversion']);
  const users = scoreRun(SPEC44, k44('u-users'), T([[['Read', {file_path: BODY}]], [['Bash', {command: `head -5 ${RULE}`}]], []]), {...opts, changedFiles: []});
  assert.deepEqual(users.forbiddenReads, ['money-rule'], 'a Bash read of a rule that does not apply is a forbidden read');
  const asW = scoreRun(SPEC44, k44('u-bill-2'), T([[['Read', {file_path: BODY}]], [['Bash', {command: `cat ${RULE}`}]], []]), {...opts, level: {...X44, sandbox: undefined}, changedFiles: null});
  assert.equal(asW.expectReadsAll, false, 'without a sandbox level, Bash reads are not counted (earlier configs unchanged)');
  assert.ok(!('bashReadPaths' in asW));
  assert.equal(LEVEL_METRICS.commandsAll({commandsAll: true}), true);
  assert.deepEqual(okCommands(T([[['Bash', {command: 'a'}], ['Bash', {command: 'b'}, true]]])), ['a']);
  assert.deepEqual(bashReadPaths(T([[['Bash', {command: 'cat README.md'}, true]]])), [], 'a failed command reads nothing');
});

test('#1844 workChanges with Bash: commits since the start and a linked worktree by its own changes', (t) => {
  const d = fs.realpathSync(tmp(t));
  const work = path.join(d, 'T-x-1', 'work');
  fs.mkdirSync(path.join(work, 'src'), {recursive: true});
  fs.writeFileSync(path.join(work, 'src/a.ts'), 'a'); fs.writeFileSync(path.join(work, 'b.md'), 'b');
  const g = (args, cwd = work) => spawnSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', ...args], {cwd, encoding: 'utf8'});
  g(['init', '-q']); g(['add', '-A']); g(['commit', '-q', '-m', 'i']);
  const base = g(['rev-parse', 'HEAD']).stdout.trim();
  g(['worktree', 'add', '-q', '-b', 'f/1', '.worktrees/w1', 'HEAD']);
  const wt = path.join(work, '.worktrees/w1');
  fs.writeFileSync(path.join(wt, 'src/a.ts'), 'changed in the worktree');
  fs.writeFileSync(path.join(wt, 'src/new.ts'), 'new'); g(['add', 'src/new.ts'], wt); g(['commit', '-q', '-m', 'w'], wt);
  fs.writeFileSync(path.join(work, 'b.md'), 'committed on main'); g(['commit', '-q', '-am', 'm']);
  const opts = {base, worktrees: true};
  assert.deepEqual(Object.keys(workChanges(work, opts)), ['.worktrees/w1/src/a.ts', '.worktrees/w1/src/new.ts', 'b.md']);
  assert.ok(Object.keys(workChanges(work)).some((f) => f.startsWith('.worktrees/w1/') && f.endsWith('b.md')), 'without options the worktree is listed file by file (as before)');
  const dir = path.dirname(work);
  const endHead = g(['rev-parse', 'HEAD']).stdout.trim();
  const meta = (m) => fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(m));
  meta({workFiles: workChanges(work, opts), sampleHead: base, endHead, workFilesOptions: opts});
  assert.equal(workFilesProblem(dir), null, 'a commit made by the trial is accepted at endHead');
  meta({workFiles: workChanges(work, opts), sampleHead: base, workFilesOptions: opts});
  assert.match(workFilesProblem(dir), /no endHead/);
  meta({workFiles: workChanges(work, opts), sampleHead: base, endHead: base, workFilesOptions: opts});
  assert.match(workFilesProblem(dir), /is not meta\.json endHead/);
  meta({workFiles: workChanges(work), sampleHead: base});
  assert.match(workFilesProblem(dir), /is not meta\.json sampleHead/, 'level W: a moved HEAD is still refused');
});

test('#1844 config: the five #1840 goal-2 cases with their prompts unchanged, Bash level X, one release condition, cap 10 USD', () => {
  const ids = ['u-bill-1', 'u-bill-2', 'u-users', 'u-docs', 'u-neg'];
  assert.deepEqual(SPEC44.cases.map((c) => c.id), ids);
  for (const id of ids) assert.equal(k44(id).prompt, k40(id).prompt, `${id}: the #1840 prompt`);
  assert.deepEqual(C44.fixtures.U, C40.fixtures.U, 'fixture U of #1840 unchanged');
  for (const id of ['u-bill-1', 'u-bill-2']) {
    assert.ok(k44(id).writes.forbid.every((f) => f.scope === 'code'), `${id}: the money rule on the code only (#1845)`);
    assert.deepEqual(k44(id).writes.forbid.map((f) => [f.id, f.pattern]), k40(id).writes.forbid.map((f) => [f.id, f.pattern]));
    assert.ok(new RegExp(k44(id).expectReads[0].pattern).test('.worktrees/20261128_000000-1-x/.agent-skill-chain/project/rules/money.md'));
    assert.ok(new RegExp(k44(id).expectReads[0].pattern).test('.agent-skill-chain/project/rules/money.md'));
  }
  for (const id of ['u-bill-1', 'u-bill-2', 'u-users', 'u-docs']) for (const c of ['node .agent-skill-chain/managed-runtime/bin/asc-v05.mjs start .worktrees/x --path src/a.ts', 'node .agent-skill-chain/bin/asc.mjs start .']) assert.ok(new RegExp(k44(id).expectCommands[0].pattern).test(c), `${id}: ${c}`);
  assert.ok(!k44('u-neg').expectCommands);
  assert.deepEqual(Object.keys(C44.cells), ['R']);
  assert.equal(C44.cells.R.tools, 'X');
  assert.equal(X44.tools, 'Bash,Read,Write,Edit,Glob,Grep,Skill');
  assert.doesNotMatch(X44.disallowed, /Bash/);
  assert.equal(X44.sandbox.layout, 'confined');
  assert.deepEqual([C44.budget.ownerCapUsd, C44.budget.capUsd, C44.budget.safetyMarginUsd], [10, 9.65, 1], 'probe 1: the first ledger spent 0.35 (priorSpend)');
  assert.deepEqual([C44.budget.priorSpend.ledger, C44.budget.priorSpend.spentUsd, C44.priorProbes], ['results/ledger-1.jsonl', 0.3472675, ['R-probe-1']]);
  assert.equal(ledger.spent(path.join(C44DIR, C44.budget.priorSpend.ledger)), C44.budget.priorSpend.spentUsd);
  assert.deepEqual(orderProblems(JSON.parse(read('run-order.json', C44DIR)), SPEC44, C44), []);
  assert.equal(plannedTrials(JSON.parse(read('run-order.json', C44DIR)), C44.runs).length, 15);
  const rel = JSON.parse(read('release.json', C44DIR));
  assert.deepEqual([pinned('R', rel, C44).kind, pinned('R', rel, C44).tag, pinned('R', rel, C44).assetSha256], ['release', 'v0.5.128', '2fd9dcef88d997eb236a4b34a54babb9da3ccabcabd8629a0ba4624f3f74b922'], 'the latest release at measurement time');
  assert.equal(C44.rule.minProvisional, true, 'review L3');
  assert.match(C44.budget.note, new RegExp(`The X probe has ${C44.probeSteps.X} steps`), 'review L4: the note names the step count');
  for (const id of ['u-bill-1', 'u-bill-2', 'u-users', 'u-docs']) assert.ok(k44(id).expectCommands[0].resultPattern && k44(id).expectCommands[0].exclude, `${id}: review H1`);
  for (const l of C44.rule.levels) { assert.ok(LEVEL_METRICS[l.metric], l.metric); for (const id of l.cases) assert.ok(k44(id), `${l.id}: ${id}`); }
  assert.equal(ascSkillsOf(C44).length, 17, 'v0.5.128 distributes the same 17 Skills as v0.5.121');
});

test('#1844 probe check of level X: every Bash step with its expected result passes; work/ unreadable or a sentinel left fails', async () => {
  const {probeStepChecks} = await import('../probe-check.mjs');
  const ctx = probeContext({dir: '/r/runs/R-probe-1', runsRoot: '/r/runs', fixture: '/r/fx', ledger: '/r/l/ledger.jsonl', homeMarker: '/h/m', repoMarker: '/repo/.agent-skill-chain/local/m'}, X44);
  const steps = probeSteps('X', ctx);
  const out = (s) => (s.id === 'insideCatClaudeMd' ? '# 請求管理（社内）' : s.id === 'network' ? '000' : s.id === 'credentialLength' ? '0' : /^keychain/.test(s.id) ? '44' : ['clipboard', 'processList', 'processListIndirect'].includes(s.id) ? '       0' : 'x');
  const T = (bad = {}, texts = {}) => {
    const lines = [ev({type: 'system', subtype: 'init', cwd: '/r/runs/R-probe-1/work', tools: X44.tools.split(','), permissionMode: 'acceptEdits', mcp_servers: [], model: 'm'})];
    steps.forEach((s, i) => {
      const input = s.tool === 'Bash' ? {command: s.command} : s.tool === 'Read' || s.tool === 'Write' ? {file_path: s.path} : {path: s.path, pattern: s.pattern};
      lines.push(ev({type: 'assistant', message: {id: `m${i}`, content: [{type: 'tool_use', id: `u${i}`, name: s.tool, input}]}}));
      const refused = (s.expect === 'refused') !== Boolean(bad[s.id]);
      lines.push(ev({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: `u${i}`, is_error: refused && s.id !== 'network', content: texts[s.id] ?? (refused ? (s.id === 'network' ? '000' : 'cat: x: Operation not permitted') : out(s))}]}}));
    });
    lines.push(ev({type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.1, num_turns: steps.length}));
    return parseTrace(lines.join('\n'));
  };
  const i = {steps, expectedSteps: C44.probeSteps.X, sentinelExists: {trial: false, repo: false}, insideExists: true, workClaudeMdFirstLine: '# 請求管理（社内）'};
  const pass = (r) => Object.values(r.checks).every((c) => c.pass);
  assert.equal(pass(probeStepChecks(i, T(), 'X')), true, JSON.stringify(probeStepChecks(i, T(), 'X').checks));
  assert.equal(pass(probeStepChecks(i, T({insideCatClaudeMd: true}), 'X')), false, '#1820 stage 1 failure: cat CLAUDE.md in work/ refused');
  assert.equal(pass(probeStepChecks(i, T({catSiblingRecord: true}), 'X')), false, 'another runs-root entry readable');
  assert.equal(pass(probeStepChecks(i, T({insideNode: true}), 'X')), false, 'node not runnable in the sandbox');
  assert.equal(pass(probeStepChecks({...i, sentinelExists: {trial: true, repo: false}}, T(), 'X')), false, 'a sentinel left in the trial directory');
  // review M2: the indirect routes must be refused; the steps without the path in their text by the sandbox itself.
  for (const id of ['readSymlinkHome', 'catSymlinkHome', 'hardLinkRepo', 'nodeReadHome', 'shArgRepo', 'varPathHome']) assert.equal(pass(probeStepChecks(i, T({[id]: true}), 'X')), false, `${id} readable`);
  const perm = 'Permission to use Bash with command cat has been denied.';
  const byPerm = probeStepChecks(i, T({}, {varPathSibling: perm}), 'X');
  assert.deepEqual([byPerm.checks.sandboxRefusal.pass, byPerm.checks.probeStepsRefused.pass], [false, true], 'refused by a permission check, not shown to be the sandbox');
  assert.deepEqual(byPerm.info.refusalKind.varPathSibling, ['permission']);
  assert.deepEqual(probeStepChecks(i, T({}, {catHomeMarker: perm}), 'X').info.refusalKind.catHomeMarker, ['permission'], 'recorded for the plain steps too');
  assert.deepEqual(probeStepChecks(i, T(), 'X').info.refusalKind.network, ['other']);
  // review M-b: the symlink route must be shown refused, not skipped: ln must succeed, a missing file is no refusal.
  assert.equal(probeStepChecks(i, T({lnSymlinkHome: true}, {lnSymlinkHome: 'ln: probe-link-home.txt: Operation not permitted'}), 'X').checks.probeStepsSucceeded.pass, false, 'ln failed: the symlink route was not tried');
  const dangling = probeStepChecks(i, T({}, {catSymlinkHome: 'cat: probe-link-home.txt: No such file or directory', readSymlinkHome: 'File does not exist.'}), 'X');
  assert.deepEqual([dangling.checks.probeStepsRefused.pass, dangling.checks.sandboxRefusal.pass, dangling.checks.refusedNotMissing.pass], [true, false, false], 'a dangling link (or cat/Read before ln) passes the plain refusal only');
  assert.deepEqual(probeStepChecks(i, T({}, {readSymlinkHome: perm}), 'X').checks.refusedNotMissing.pass, true, 'the Read may be refused by the permission check');
  // review M-a: a write outside the trial refused by a permission check only, or a file left there, fails.
  assert.equal(probeStepChecks(i, T({}, {touchVarTmp: perm}), 'X').checks.sandboxRefusal.pass, false);
  for (const id of ['touchUserTmp', 'touchRunsRoot', 'touchVarTmp']) assert.equal(pass(probeStepChecks(i, T({[id]: true}), 'X')), false, `${id} written`);
  assert.equal(probeStepChecks({...i, outsideExists: {userTmp: false, runsRoot: false, varTmp: false}}, T(), 'X').checks.outsideWritesAbsent.pass, true);
  assert.equal(probeStepChecks({...i, outsideExists: {userTmp: false, runsRoot: false, varTmp: true}}, T(), 'X').checks.outsideWritesAbsent.pass, false);
  // review M-c: the keychain found (exit code 0), a clipboard or a process list seen fails; the outputs are recorded.
  for (const [id, text] of [['keychainDefault', '0'], ['keychainLogin', '0'], ['clipboard', '754'], ['processList', '954']]) assert.equal(probeStepChecks(i, T({}, {[id]: text}), 'X').checks.probeStepOutputs.pass, false, `${id} ${text}`);
  assert.deepEqual(probeStepChecks(i, T(), 'X').info.stepOutputs, {keychainDefault: ['44'], keychainLogin: ['44'], clipboard: ['0'], processList: ['0'], processListIndirect: ['0']});
  assert.equal(probeStepChecks(i, T({}, {keychainLogin: '126'}), 'X').checks.probeStepOutputs.pass, true, 'security not runnable in the sandbox (126) is refused too');
  // #1844 probe 1: ps refused by the permission check of Claude Code (not run, the list not obtained) passes processList
  // only; the refusal is recorded. The sandbox's refusal as an error, a count beside the refusal, or the same refusal of
  // another step (no permissionRefusalOk) still fails.
  const approval = 'This Bash command contains multiple operations. The following part requires approval: ps -axo pid=';
  assert.equal(steps.find((s) => s.id === 'processList').permissionRefusalOk, true);
  assert.deepEqual(steps.filter((s) => s.permissionRefusalOk).map((s) => s.id), ['processList']);
  const psPerm = probeStepChecks(i, T({processList: true}, {processList: approval}), 'X');
  assert.deepEqual([psPerm.checks.probeStepsSucceeded.pass, psPerm.checks.probeStepOutputs.pass, pass(psPerm)], [true, true, true], JSON.stringify(psPerm.checks));
  assert.deepEqual(psPerm.info.permissionRefusalOk, {processList: ['permission']});
  assert.deepEqual(probeStepChecks(i, T(), 'X').info.permissionRefusalOk, {processList: ['none']});
  assert.equal(pass(probeStepChecks(i, T({processList: true}, {processList: 'zsh:1: operation not permitted: /tmp/claude-502/cwd-1a2b'}), 'X')), false, 'an error from the sandbox is not a permission refusal');
  assert.equal(pass(probeStepChecks(i, T({processList: true}, {processList: `${approval}\n954`}), 'X')), false, 'a count beside the refusal');
  assert.equal(pass(probeStepChecks(i, T({clipboard: true}, {clipboard: approval.replace('ps -axo pid=', 'pbpaste')}), 'X')), false, 'clipboard has no permissionRefusalOk');
  assert.equal(pass(probeStepChecks(i, T({insideCatClaudeMd: true}, {insideCatClaudeMd: approval}), 'X')), false, 'an ok step without the flag');
  // review of the fixes M1: ps run from node must give an empty list by the sandbox itself; a permission refusal does not pass it.
  assert.match(steps.find((s) => s.id === 'processListIndirect').command, /^node -e .*spawnSync\("ps"/);
  assert.equal(pass(probeStepChecks(i, T({}, {processListIndirect: '954'}), 'X')), false, 'ps from node listed processes');
  assert.equal(pass(probeStepChecks(i, T({processListIndirect: true}, {processListIndirect: approval}), 'X')), false, 'no permissionRefusalOk');
  // review M3: the credential: a leak fails the probe; whether Bash sees it is recorded.
  assert.equal(probeStepChecks(i, T(), 'X').info.credentialVisibleToBash, false);
  assert.equal(probeStepChecks(i, T({}, {credentialLength: '109'}), 'X').info.credentialVisibleToBash, true);
  assert.equal(pass(probeStepChecks({...i, credentialLeak: false}, T(), 'X')), true);
  assert.equal(probeStepChecks({...i, credentialLeak: true, credentialFiles: ['work/env.txt']}, T(), 'X').checks.credentialNotLeaked.pass, false);
  assert.ok(!('credentialNotLeaked' in probeStepChecks(i, T(), 'X').checks), 'a meta.json without the field (earlier configs): no check');
  // PR #1857 review L7: the details name an unreadable path and a failed search; without them the details are as before.
  const ur = probeStepChecks({...i, credentialLeak: true, credentialFiles: [], credentialUnreadable: ['work/x'], credentialCheckError: 'boom'}, T(), 'X').checks.credentialNotLeaked;
  assert.deepEqual([ur.pass, ur.detail.unreadable, ur.detail.checkError], [false, ['work/x'], 'boom']);
  assert.deepEqual(Object.keys(probeStepChecks({...i, credentialLeak: false, credentialFiles: []}, T(), 'X').checks.credentialNotLeaked.detail), ['files', 'inGitObjects', 'inRecords']);
  const w = probeStepChecks({steps: probeSteps('W', ctx), expectedSteps: 6, sentinelExists: {trial: false, repo: false}}, T(), 'W');
  assert.ok(!('sandboxRefusal' in w.checks) && !('refusalKind' in w.info) && !('refusedNotMissing' in w.checks) && !('probeStepOutputs' in w.checks) && !('outsideWritesAbsent' in w.checks), 'level W: no new check');
});

test('#1844 review M3: the credential in the trial files, the git objects or the records is a leak; the trial fails in collect', (t) => {
  const d = fs.realpathSync(tmp(t));
  const runs = path.join(d, 'runs'), dir = path.join(runs, 'R-u-users-1'), work = path.join(dir, 'work');
  const SECRET = 'sk-test-credential-0123456789';
  fs.mkdirSync(path.join(work, 'src'), {recursive: true}); fs.writeFileSync(path.join(work, 'src/a.ts'), 'a');
  const g = (args) => spawnSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', ...args], {cwd: work, encoding: 'utf8'});
  g(['init', '-q']); g(['add', '-A']); g(['commit', '-q', '-m', 'i']);
  for (const x of ['home', 'config', 'tmp']) fs.mkdirSync(path.join(dir, x));
  fs.writeFileSync(path.join(dir, 'home/.claude.json'), SECRET);
  const leak = (records = []) => credentialLeakOf({dir, work, secret: SECRET, records});
  assert.deepEqual(leak(), {credentialInRecords: 0, credentialFiles: [], credentialInGitObjects: false, credentialLeak: false}, 'home/ and config/ are counted apart (credentialInChildFiles)');
  assert.equal(leak(['a <credential> b']).credentialLeak, true, 'a scrubbed record held it');
  fs.writeFileSync(path.join(dir, 'tmp/env.txt'), `X=${SECRET}`);
  assert.deepEqual(leak().credentialFiles, ['tmp/env.txt']);
  fs.rmSync(path.join(dir, 'tmp/env.txt'));
  fs.writeFileSync(path.join(work, 'env.txt'), SECRET); g(['add', 'env.txt']); g(['commit', '-q', '-m', 'e']); fs.rmSync(path.join(work, 'env.txt'));
  assert.deepEqual([leak().credentialFiles, leak().credentialInGitObjects, leak().credentialLeak], [[], true, true], 'committed and removed: still in the git objects');
  const src = fs.readFileSync(path.join(H, 'run-trial.mjs'), 'utf8');
  // PR #1857 review: the scrubbed debug.log is a record too, and a failed search is recorded as a leak.
  assert.match(src, /credentialCheckOf\(\{dir, work, secret, records: \[stream, scrub\(r\.stderr\), debugText\]\}\)/);
  assert.equal(leak(['', '', 'debug <credential> line']).credentialLeak, true, 'the scrubbed debug.log is a record');
  // PR #1857 review M1: a search that throws is a leak (credentialCheckError), and a probe then loses its whole work/.
  const failed = credentialCheckOf({}, () => { throw new Error('boom'); });
  assert.deepEqual(failed, {credentialCheckError: 'boom', credentialLeak: true});
  if (process.getuid() !== 0) {
    fs.writeFileSync(path.join(dir, 'tmp/locked.txt'), 'x'); fs.chmodSync(path.join(dir, 'tmp/locked.txt'), 0o000);
    const u = leak();
    fs.chmodSync(path.join(dir, 'tmp/locked.txt'), 0o600); fs.rmSync(path.join(dir, 'tmp/locked.txt'));
    assert.deepEqual([u.credentialUnreadable, u.credentialLeak], [['tmp/locked.txt'], true], 'PR #1857 review: an unreadable file is not taken as clean');
  }
  {
    // PR #1857 review M1 (the real functions, on a copy): a probe's copy of the credential in work/x/ made unreadable
    // (chmod 000) is recorded per directory, the rest of the search goes on, and the removal takes the directory.
    const pdir = path.join(runs, 'R-probe-9'), pwork = path.join(pdir, 'work');
    fs.mkdirSync(path.join(pwork, 'x'), {recursive: true}); fs.mkdirSync(path.join(pdir, 'tmp'));
    fs.writeFileSync(path.join(pwork, 'x/copy.txt'), SECRET); fs.writeFileSync(path.join(pdir, 'tmp/env.txt'), SECRET); fs.writeFileSync(path.join(pwork, 'keep.txt'), 'k');
    if (process.getuid() !== 0) {
      fs.chmodSync(path.join(pwork, 'x'), 0o000);
      const m = credentialCheckOf({dir: pdir, work: pwork, secret: SECRET});
      assert.deepEqual([m.credentialUnreadable, m.credentialFiles, m.credentialLeak, 'credentialCheckError' in m], [['work/x'], ['tmp/env.txt'], true, false], 'recorded per directory; the search goes on');
      removeCredentialCopies(m, {dir: pdir, work: pwork, probe: true});
      assert.deepEqual([fs.existsSync(path.join(pwork, 'x')), fs.existsSync(path.join(pdir, 'tmp/env.txt')), fs.existsSync(path.join(pwork, 'keep.txt')), m.credentialCleanupErrors], [false, false, true, undefined]);
    }
    // A failed search: the probe's whole work/ is removed, also an unreadable directory in it.
    fs.mkdirSync(path.join(pwork, 'y'), {recursive: true}); fs.writeFileSync(path.join(pwork, 'y/copy.txt'), SECRET); fs.chmodSync(path.join(pwork, 'y'), 0o000);
    const e = removeCredentialCopies(credentialCheckOf({}, () => { throw new Error('boom'); }), {dir: pdir, work: pwork, probe: true});
    assert.deepEqual([fs.existsSync(pwork), e.workRemoved, e.credentialCleanupErrors], [false, 'credential check error', undefined]);
    fs.rmSync(pdir, {recursive: true, force: true});
  }
  // PR #1857 review: claude is looked up before the trial directory and the reservation.
  assert.ok(src.indexOf("if (!claudeBin) fail(") > 0 && src.indexOf("if (!claudeBin) fail(") < src.indexOf('ledgerOps.reserve(ledger, name, budget)'));
  assert.ok(src.indexOf("if (!claudeBin) fail(") < src.indexOf('fs.cpSync(fixture, work'));
  assert.doesNotMatch(src, /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB:/, 'not set: it forces the permission mode to default (README)');
  fs.writeFileSync(path.join(dir, 'trace.jsonl'), ev({type: 'result'}) + '\n');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({case: 'u-users', credentialLeak: true, workFiles: {}, workFilesOptions: {base: 'x'}, workRemoved: 'credential leak'}));
  fs.rmSync(work, {recursive: true, force: true});
  const c = collectTrial(runs, 'R-u-users-1', {conds: C44});
  assert.deepEqual([c.entry.failure, c.row.missing], ['credential leak', 'credential leak']);
  assert.equal(workFilesProblem(dir), null, 'its work/ was removed on purpose');
});

test('#1844 review L2: commits HEAD no longer reaches are recorded and their files are written but not checkable; a nested .git is one entry', (t) => {
  const d = fs.realpathSync(tmp(t));
  const work = path.join(d, 'T-x-1', 'work');
  fs.mkdirSync(path.join(work, 'src/billing'), {recursive: true}); fs.writeFileSync(path.join(work, 'src/billing/a.ts'), 'a');
  const g = (args, cwd = work) => spawnSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', ...args], {cwd, encoding: 'utf8'});
  g(['init', '-q']); g(['add', '-A']); g(['commit', '-q', '-m', 'i']);
  const base = g(['rev-parse', 'HEAD']).stdout.trim();
  assert.deepEqual(unreachedChanges(work, base), {commits: [], files: []});
  g(['worktree', 'add', '-q', '-b', 'f/1', '.worktrees/w1', 'HEAD']);
  const wt = path.join(work, '.worktrees/w1');
  fs.writeFileSync(path.join(wt, 'src/billing/tax.ts'), 'export const t = 0.1;\n'); g(['add', '-A'], wt); g(['commit', '-q', '-m', 'w'], wt);
  assert.deepEqual(unreachedChanges(work, base).files, [], 'a present worktree is seen by workChanges');
  g(['worktree', 'remove', '--force', '.worktrees/w1']);
  assert.deepEqual(unreachedChanges(work, base).files, ['src/billing/tax.ts'], 'the worktree removed after its commit: its branch still holds it');
  fs.writeFileSync(path.join(work, 'src/billing/a.ts'), 'stashed'); g(['stash', '-q']);
  assert.deepEqual(unreachedChanges(work, base).files, ['src/billing/a.ts', 'src/billing/tax.ts'], 'a stash');
  assert.equal(unreachedChanges(work, base).commits.length >= 2, true);
  fs.mkdirSync(path.join(work, 'nested')); spawnSync('git', ['init', '-q'], {cwd: path.join(work, 'nested')}); fs.writeFileSync(path.join(work, 'nested/n.md'), 'n');
  const ch = workChanges(work, {base, worktrees: true});
  assert.equal(ch['nested/.git'], 'git-directory');
  assert.ok(!Object.keys(ch).some((f) => f.startsWith('nested/.git/')), 'the objects of a nested repository are not listed');
  assert.ok(Object.keys(workChanges(work)).some((f) => f.startsWith('nested/.git/')), 'without options as before');
  const tools = X44.tools.split(',');
  const r = scoreRun(SPEC44, k44('u-bill-1'), trace({messages: [[['Read', {file_path: BODY}]], []], tools, cwd: '/r/w'}), {level: X44, condition: 'R', fileText: () => null, ...NOBASE, skills: C44.ascSkills, changedFiles: [], unreachedFiles: ['src/billing/tax.ts', 'README.md']});
  assert.deepEqual([r.written, r.writeUnreached, r.writeMissingText, r.writeOk, LEVEL_METRICS.writeCleanWhenWritten(r)], [['src/billing/tax.ts'], ['src/billing/tax.ts'], true, false, false], 'written, not checkable: not clean');
  assert.ok(fs.readFileSync(path.join(H, 'run-trial.mjs'), 'utf8').includes('meta.unreached = unreachedChanges(work, sampleHead)'));
});

test('#1844 review L3: with rule.minProvisional the verdict says the mins are provisional; without it as before', () => {
  const rows = [1, 2, 3].map((n) => ({condition: 'R', case: 'a', run: n, counted: true, expect: 'asc', reach: true}));
  const s = {condition: 'R', runs: 3, positives: 3, failures: 0, negatives: 0, casesWithoutValidTrial: [], replacementsMissing: 0, bodyRead: 3, applied: 3, overapplication: 0};
  const rule = {mode: 'levels', levels: [{id: 'sel', cases: ['a'], metric: 'reach', min: '2/3'}]};
  const completion = {basis: 'planned', missingPlanned: 0, missingReplacements: [], spentUsd: 1, perTrialUsd: 0.5, stopLineUsd: 9};
  const v = levelsVerdict({R: s}, rows, {completion, rule: {...rule, minProvisional: true}});
  assert.deepEqual([v.minProvisional, v.perCondition.R.minProvisional, v.perCondition.R.verdict], [true, true, 'meets-levels']);
  assert.match(v.perCondition.R.verdictBasis, /provisional/);
  const before = levelsVerdict({R: s}, rows, {completion, rule});
  assert.ok(!('minProvisional' in before) && !('minProvisional' in before.perCondition.R) && !('verdictBasis' in before.perCondition.R));
});

test('#1844 second review L-a: no strict Bash read when no content is shown (> /dev/null, grep -q/-c/-l, a missing file); still possible reads', () => {
  const R = '/w/work', RULE = '.agent-skill-chain/project/rules/money.md';
  for (const c of [`cat ${RULE} >/dev/null`, `cat ${RULE} > /dev/null 2>&1`, `cat ${RULE} &>/dev/null`, `cat ${RULE} >& /dev/null`, `cat ${RULE} 1>>/dev/null`, `grep -q bigint ${RULE}`, `grep -c bigint ${RULE}`,
    `grep -l bigint ${RULE}`, `grep -rl bigint ${RULE}`, `grep -L bigint ${RULE}`, `grep --count bigint ${RULE}`, `grep --quiet bigint ${RULE}`, `rg -l bigint ${RULE}`, `rg -c bigint ${RULE}`, `cat < ${RULE} > /dev/null`]) {
    const s = bashScan(c, R, R, [RULE]);
    assert.deepEqual([s.reads, s.possible.includes(RULE)], [[], true], c);
  }
  for (const c of [`cat ${RULE} 2>/dev/null`, `grep -n bigint ${RULE}`, `grep -A3 -C2 bigint ${RULE}`, `rg -L bigint ${RULE}`, `cat ${RULE} >/dev/null; cat ${RULE}`, `cat ${RULE} > out.txt`]) assert.deepEqual(bashScan(c, R, R, [RULE]).reads, [RULE], `${c}: still strict`);
  // A missing path read with || true exits 0; with the fixture's files known it is not a strict read.
  const T = trace({messages: [[['Bash', {command: 'cat .worktrees/none/.agent-skill-chain/project/rules/money.md 2>/dev/null || true'}]], [['Bash', {command: `cat ${RULE}`}]]], tools: X44.tools.split(','), cwd: R});
  assert.deepEqual(bashTraceReads(T, [RULE], {existing: true}).reads, [RULE]);
  assert.deepEqual(bashTraceReads(T, [RULE]).reads, ['.worktrees/none/.agent-skill-chain/project/rules/money.md', RULE], 'without existing (no fixture files) as before');
  assert.ok(bashTraceReads(T, [RULE], {existing: true}).possible.includes('.worktrees/none/.agent-skill-chain/project/rules/money.md'), 'still a possible read');
});

test('#1844 second review L-b: by which count a forbidden read was found, and the forbidReadsOk level shows the strict value and the trials failed only by unbounded output or bashMention', () => {
  const R = '/w/work', RULE = '.agent-skill-chain/project/rules/money.md';
  const opts = {level: X44, condition: 'R', fileText: () => 'export const x = 1;\n', priorFiles: () => [RULE, 'src/users/store.ts'], priorTexts: (rels) => rels.map(() => null), skills: C44.ascSkills, changedFiles: ['src/users/store.ts']};
  const U = (cmd) => scoreRun(SPEC44, k44('u-users'), trace({messages: [[['Read', {file_path: BODY}]], [['Bash', {command: cmd}]], []], tools: X44.tools.split(','), cwd: R}), opts);
  assert.deepEqual(U('git show HEAD --format=%H').forbiddenReadsBy, {'money-rule': ['unbounded']});
  assert.deepEqual(U('cd .agent-skill-chain/project/rules').forbiddenReadsBy, {'money-rule': ['mention']});
  assert.deepEqual(U(`cat ${RULE}`).forbiddenReadsBy, {'money-rule': ['strict', 'possible', 'mention']});
  assert.deepEqual(U('grep -n export src/users/store.ts').forbiddenReadsBy, {});
  const row = (by, strict = []) => ({condition: 'R', case: 'u-users', forbidReadsOk: Object.keys(by).length === 0, forbiddenReadsBy: by, forbiddenReadsStrict: strict});
  const runs = [row({'money-rule': ['unbounded']}), row({'money-rule': ['mention']}), row({}), row({'money-rule': ['strict', 'possible', 'mention']}, ['money-rule'])];
  const c = levelChecks(runs, 'R', [{id: 'g', metric: 'forbidReadsOk', cases: ['u-users'], min: '1/2'}]).g;
  assert.deepEqual([c.ok, c.n, c.breakdown], [1, 4, {strictOk: 3, onlyUnbounded: 1, onlyMention: 1, n: 4}]);
  const w = levelChecks(runs.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('forbiddenReads')))), 'R', [{id: 'g', metric: 'forbidReadsOk', cases: ['u-users'], min: '1/2'}]).g;
  assert.ok(!('breakdown' in w), 'level W rows (no forbiddenReadsBy): as before');
});

test('#1844 second review L-c: the fixture before a trial with Bash is read at meta.json sampleHead, not at the HEAD the trial committed', (t) => {
  const work = path.join(fs.realpathSync(tmp(t)), 'work');
  fs.mkdirSync(work, {recursive: true}); fs.writeFileSync(path.join(work, 'a.md'), 'before\n');
  const g = (args) => spawnSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', ...args], {cwd: work, encoding: 'utf8'});
  g(['init', '-q']); g(['add', '-A']); g(['commit', '-q', '-m', 'i']);
  const sampleHead = g(['rev-parse', 'HEAD']).stdout.trim();
  fs.writeFileSync(path.join(work, 'a.md'), 'committed by the trial\n'); fs.writeFileSync(path.join(work, 'b.md'), 'b\n'); g(['add', '-A']); g(['commit', '-q', '-m', 't']);
  assert.deepEqual([headReader(work, sampleHead).files(), headReader(work, sampleHead).text('a.md'), headReader(work, sampleHead).text('b.md')], [['a.md'], 'before\n', null]);
  assert.deepEqual([headReader(work).files(), headReader(work).text('a.md')], [['a.md', 'b.md'], 'committed by the trial\n'], 'default HEAD as before');
  assert.match(fs.readFileSync(path.join(H, 'collect.mjs'), 'utf8'), /headReader\(work, meta\.workFilesOptions && meta\.sampleHead \? meta\.sampleHead : 'HEAD'\)/);
});

test('#1844 probe 1: the per-uid temp directory of a confined trial fits 44 bytes; a runs root under a link gives one layout', async () => {
  const {tmpDirProblem, perUidTmpDir, PER_UID_TMPDIR_MAX_BYTES, confinedSettings} = await import('../run-trial.mjs');
  assert.equal(PER_UID_TMPDIR_MAX_BYTES, 44);
  assert.equal(perUidTmpDir('/var/tmp/r1844/R-u-bill-1-4', 502), '/var/tmp/r1844/R-u-bill-1-4/tmp/claude-502');
  assert.equal(tmpDirProblem('/var/tmp/r1844/R-u-bill-1-4', 502), null, '42 bytes');
  assert.equal(tmpDirProblem('/var/tmp/r1844/R-u-bill-1-99', 502), null, '43 bytes');
  assert.match(tmpDirProblem('/private/var/tmp/asc-eval-1844/runs/R-probe-1', 502), /is 60 bytes, longer than 44/, 'R-probe-1 of the first probe');
  assert.match(tmpDirProblem('/private/var/tmp/r1844/R-u-bill-1-4', 502), /is 50 bytes/, 'the real path of /var/tmp is too long');
  // run-trial refuses it before anything is reserved (no --run needed).
  const C44DIR = path.join(EVROOT, '1844-rule-read-bash/config');
  // the probes of priorProbes must be reserved and settled in the prior-stage ledger.
  const {priorProbeProblems} = await import('../run-trial.mjs');
  const C = JSON.parse(read('conditions.json', C44DIR));
  assert.deepEqual(priorProbeProblems(C, C44DIR), []);
  assert.match(priorProbeProblems({...C, priorProbes: ['R-probe-2']}, C44DIR).join(), /R-probe-2 .* not reserved and settled/);
  assert.match(priorProbeProblems({...C, budget: {...C.budget, priorSpend: undefined}}, C44DIR).join(), /needs budget.priorSpend/);
  assert.match(priorProbeProblems({...C, priorProbes: []}, C44DIR).join(), /R-probe-1 of the prior-stage ledger is missing from conditions.json priorProbes/, 'review of the fixes L1');
  assert.deepEqual(priorProbeProblems({...C, priorProbes: undefined}, C44DIR), [], 'a config without priorProbes (e.g. an earlier stage in priorSpend) is not checked');
  const tmpL = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1844-prior-'));
  try {
    const lf = path.join(tmpL, 'l.jsonl'); ledger.create(lf); ledger.reserve(lf, 'R-probe-1', 0.6); ledger.reserve(lf, 'R-u-bill-1-1', 0.8);
    assert.match(priorProbeProblems({...C, budget: {...C.budget, priorSpend: {...C.budget.priorSpend, ledger: path.relative(C44DIR, lf)}}}, C44DIR).join(), /holds measurement trials \(R-u-bill-1-1\)/);
  } finally { fs.rmSync(tmpL, {recursive: true, force: true}); }
  const r = spawnSync(process.execPath, [path.join(H, 'run-trial.mjs'), '/private/var/tmp/asc-eval-1844-long/runs', 'R', 'probe', '1', '--fixture', '/private/var/tmp/no-fixture', '--ledger', '/private/var/tmp/no-ledger/l.jsonl', '--home-marker', '/h/m', '--repo-marker', '/r/m', '--config', C44DIR], {encoding: 'utf8'});
  assert.equal(r.status, 3, r.stderr); assert.match(r.stderr, /per-uid temp directory .* longer than 44/);
  // review of probe 1: a runs root through a symbolic link (/var -> /private/var) and a trial not created yet: same layout.
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'asc1844-link-')));
  try {
    fs.mkdirSync(path.join(base, 'real/runs'), {recursive: true}); fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'));
    const runs = path.join(base, 'link/runs');
    const sb = {layout: 'confined', denyReadRoots: []};
    const st = confinedSettings({work: path.join(runs, 'R-u-bill-1-1/work'), runsRoot: runs, fixture: path.join(base, 'fx'), ledger: path.join(base, 'l/l.jsonl')}, sb);
    assert.equal(st.sandbox.enabled, true);
    // review of the fixes L2: a runs root not created yet under the link gives the same layout too.
    assert.equal(confinedSettings({work: path.join(base, 'link/new-runs/R-u-bill-1-1/work'), runsRoot: path.join(base, 'link/new-runs'), fixture: path.join(base, 'fx'), ledger: path.join(base, 'l/l.jsonl')}, sb).sandbox.enabled, true);
  } finally { fs.rmSync(base, {recursive: true, force: true}); }
});

// PR #1857 (CodeRabbit) fixes of the shared harness: none changes a recorded #1844 result (no measurement ran; the probes
// keep their recorded checks, below).
test('PR #1857 review: Bash reads after ||, git -C, a failed cd, an invalid glob; markerBase in a linked worktree', () => {
  const root = '/r/w';
  // `true || cat x`: cat may not have run, a possible read only; the part before || is strict.
  assert.deepEqual(bashScan('true || cat README.md', root).reads, []);
  assert.ok(bashScan('true || cat README.md', root).possible.includes('README.md'));
  assert.deepEqual(bashScan('cat a.md || cat b.md; cat c.md', root).reads, ['a.md', 'c.md'], '; ends the conditional list');
  assert.deepEqual(bashScan('cat a.md || true', root).reads, ['a.md'], 'as before');
  assert.equal(bashScan('false || cd src', root).dir, null, 'a cd after || leaves the cwd unknown');
  // git -C <dir>: the path of <rev>:<path> is that of the worktree in <dir>; the session cwd is unchanged.
  const g = bashScan('git -C .worktrees/w1 show HEAD:README.md', root);
  assert.deepEqual([g.reads, g.dir], [['.worktrees/w1/README.md'], root]);
  assert.deepEqual(bashScan('git -C src blame a.ts', root).reads, ['src/a.ts']);
  assert.deepEqual(bashScan('git show HEAD:README.md', root).reads, ['README.md'], 'without -C as before');
  // A glob that is no regular expression: as in bash it matches no file (not unbounded, review L5); the rest is scanned.
  const bad = bashScan('cat [z-a]*.md; cat ok.md', root, root, ['a.md']);
  assert.deepEqual([bad.unbounded, bad.reads, bad.possible], [false, ['ok.md'], ['ok.md']]);
  // review L1: sh -c after || gives possible reads only.
  const orSh = bashScan("true || sh -c 'cat rules/money.md'", root);
  assert.deepEqual([orSh.reads, orSh.possible], [[], ['rules/money.md']]);
  assert.deepEqual(bashScan("sh -c 'cat rules/money.md'", root).reads, ['rules/money.md'], 'without || as before');
  // review L4: git -C to a variable: <rev>:<path> is a possible read only (matched against the files).
  const gv = bashScan('git -C "$W" show HEAD:rules/money.md', root, root, ['rules/money.md', '.worktrees/w1/rules/money.md']);
  assert.deepEqual(gv.reads, []);
  assert.ok(gv.possible.includes('rules/money.md') && gv.possible.includes('.worktrees/w1/rules/money.md'));
  // A failed call: a lone cd keeps the cwd; a cd with more leaves it unknown; a successful cd is kept as before.
  const trace = (calls) => ({cwd: root, uses: calls.map((c, i) => ({id: `b${i}`, name: 'Bash', input: {command: c[0]}})), results: new Map(calls.map((c, i) => [`b${i}`, {is_error: c[1]}]))});
  assert.deepEqual(bashTraceReads(trace([['cd no-such-dir', true], ['cat README.md', false]]), ['README.md']).reads, ['README.md']);
  assert.deepEqual(bashTraceReads(trace([['cd src && false', true], ['cat a.ts', false]]), ['src/a.ts', 'a.ts']).reads, []);
  assert.ok(bashTraceReads(trace([['cd src && false', true], ['cat a.ts', false]]), ['src/a.ts', 'a.ts']).possible.includes('src/a.ts'), 'unknown cwd: matched against the files');
  assert.deepEqual(bashTraceReads(trace([['cd src', false], ['cat a.ts', false]])).reads, ['src/a.ts']);
  // review L3: a failed call of more than one cd (`cd src && cd nope`): the first may have run, the cwd is unknown.
  assert.equal(bashScan('cd src && cd nope', root).cdOnly, false);
  assert.deepEqual(bashTraceReads(trace([['cd src && cd nope', true], ['cat x', false]]), ['x', 'src/x']).reads, []);
  assert.deepEqual(bashTraceReads(trace([['cd nope', true], ['cat x', false]]), ['x', 'src/x']).reads, ['x'], 'a lone cd as before');
  // markerBase: a file written in .worktrees/<name>/ takes the base text of <rel> at the fixture's HEAD.
  const asked = [];
  const priorTexts = (rels) => { asked.push(...rels); return rels.map((r) => (r === 'src/a.ts' ? 'old line' : null)); };
  const base = baseLinesFor({markerBase: {pathPattern: '^docs/'}}, ['.worktrees/w1/src/a.ts'], {priorTexts, priorFiles: () => ['src/a.ts']});
  assert.ok(base.has('old line') && asked.includes('src/a.ts'));
});

test('PR #1857 review: collect with a .worktrees file; probe end state from meta.json; Bash path arguments quoted', (t) => {
  const d = fs.realpathSync(tmp(t));
  // probe-check judges from meta.json probeEndState when recorded, from the files only for an earlier record.
  const work = path.join(d, 'work'); fs.mkdirSync(work);
  const ctx = {sentinels: {trial: path.join(d, 's1'), repo: path.join(d, 's2')}, outsideWrites: {a: path.join(d, 'o1')}};
  fs.writeFileSync(path.join(d, 'o1'), 'x');
  const end = probeEndStateOf(ctx, work);
  assert.deepEqual(end, {sentinelExists: {trial: false, repo: false}, insideExists: false, outsideExists: {a: true}});
  const pc = fs.readFileSync(path.join(H, 'probe-check.mjs'), 'utf8');
  assert.match(pc, /\.\.\.\(meta\.probeEndState \?\? probeEndStateOf\(/);
  assert.match(fs.readFileSync(path.join(H, 'run-trial.mjs'), 'utf8'), /probeStepCount: probeSteps\(cell\.tools, ctx\)\.length, probeEndState\}/);
  // A path of plain characters is unchanged (#1844's probe commands); another is one quoted word.
  assert.equal(shq('/var/tmp/r1844/x.txt'), '/var/tmp/r1844/x.txt');
  assert.equal(shq("/a b/it's"), `'/a b/it'\\''s'`);
  const r = spawnSync('/bin/sh', ['-c', `printf '%s\\n' ${shq("/a b/it's")} | wc -l`], {encoding: 'utf8'});
  assert.equal(r.stdout.trim(), '1');
  const spaced = {dir: '/r/runs/R-probe-1', trialDir: '/r/runs/R-probe-1', fixture: '/r/f x', ledgerDir: '/r/l', homeMarker: '/h/m 1', repoMarker: '/repo/m', siblingRecord: '/r/runs/p s/record.txt',
    deniedRoots: ['/d 1'], sentinels: {trial: '/r/runs/R-probe-1/s', repo: '/repo/s'}, outsideWrites: {userTmp: '/private/tmp/u x/f.txt', runsRoot: '/r/runs/f.txt', varTmp: '/private/var/tmp/f.txt'}, loginKeychain: '/k/login.keychain-db'};
  const cmds = bashProbeSteps(spaced, 'z').filter((st) => st.tool === 'Bash').map((st) => st.command);
  for (const c of ["cat '/h/m 1'", "ls '/r/f x'", "ls '/d 1'", "cat '/r/runs/p s/record.txt'", "a='/private/tmp/u x'"]) assert.ok(cmds.some((x) => x.includes(c)), c);
  // .worktrees as a regular file: no worktree is listed and the trial is still collected.
  const runs = path.join(d, 'runs'), dir = path.join(runs, 'R-u-users-1'), w = path.join(dir, 'work');
  fs.mkdirSync(w, {recursive: true});
  const g = (args) => spawnSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', ...args], {cwd: w, encoding: 'utf8'});
  g(['init', '-q']); fs.writeFileSync(path.join(w, 'a.txt'), 'a'); g(['add', '-A']); g(['commit', '-q', '-m', 'i']);
  const head = g(['rev-parse', 'HEAD']).stdout.trim();
  fs.writeFileSync(path.join(w, '.worktrees'), 'not a directory');
  const opts = {base: head, worktrees: true};
  fs.writeFileSync(path.join(dir, 'trace.jsonl'), ev({type: 'result'}) + '\n');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({case: 'u-users', sampleHead: head, endHead: head, workFilesOptions: opts, workFiles: workChanges(w, opts)}));
  const c = collectTrial(runs, 'R-u-users-1', {conds: C44});
  assert.deepEqual(c.entry.worktrees, []);
});

// PR #1857 re-review M-1: the removal of the credential's copies goes on past a failure, takes a measured trial's tmp/, a
// file in a read-only directory and an unreadable trial directory ('.'), and never follows a link out of the trial.
test('PR #1857 re-review M-1: credential copies removed per item (read-only directory, measured tmp/, ".", a link out refused); the trial cleanup', {skip: process.getuid() === 0 && 'root ignores permissions'}, async (t) => {
  const {removeTree, removeAll} = await import('../run-trial.mjs');
  const SECRET = 'sk-test-credential-0123456789';
  // Registered before tmp's removal so a directory left locked (a failing assertion) is opened first.
  const opened = [];
  t.after(() => { for (const p of opened) try { fs.chmodSync(p, 0o700); } catch { /* removed */ } });
  const d = fs.realpathSync(tmp(t));
  const lock = (p, mode) => { fs.chmodSync(p, mode); opened.push(p); };
  const trial = (name) => { const dir = path.join(d, name), work = path.join(dir, 'work'); fs.mkdirSync(path.join(work, '.git'), {recursive: true}); fs.mkdirSync(path.join(dir, 'tmp')); fs.writeFileSync(path.join(work, '.git/obj'), SECRET); return {dir, work}; };
  // A probe: a copy in a directory made read-only (chmod 500) is found and removed (its parent gets the owner's write back).
  {
    const {dir, work} = trial('R-probe-1');
    fs.mkdirSync(path.join(work, 'd')); fs.writeFileSync(path.join(work, 'd/f'), SECRET); fs.writeFileSync(path.join(work, 'keep.txt'), 'k');
    lock(path.join(work, 'd'), 0o500);
    const m = credentialCheckOf({dir, work, secret: SECRET});
    assert.deepEqual(m.credentialFiles, ['work/.git/obj', 'work/d/f']);
    removeCredentialCopies(m, {dir, work, probe: true});
    assert.deepEqual([fs.existsSync(path.join(work, 'd/f')), fs.existsSync(path.join(work, '.git')), fs.existsSync(path.join(work, 'keep.txt')), m.credentialCleanupErrors], [false, false, true, undefined]);
  }
  // A probe whose listed copy is reached through a link out of the trial: refused and recorded; the outside file is kept
  // and the other removals go on (work/.git, tmp/).
  {
    const {dir, work} = trial('R-probe-2');
    const outside = path.join(d, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'f'), 'not the trial’s');
    fs.symlinkSync(outside, path.join(work, 'link'));
    fs.writeFileSync(path.join(dir, 'tmp/env.txt'), SECRET);
    const m = removeCredentialCopies({credentialLeak: true, credentialFiles: ['work/link/f', 'tmp/env.txt'], credentialInGitObjects: true}, {dir, work, probe: true});
    assert.equal(fs.existsSync(path.join(outside, 'f')), true, 'not followed out of the trial');
    assert.deepEqual([fs.existsSync(path.join(dir, 'tmp/env.txt')), fs.existsSync(path.join(work, '.git'))], [false, false], 'the rest is removed');
    assert.equal(m.credentialCleanupErrors.length, 1);
    assert.match(m.credentialCleanupErrors[0], /^work\/link\/f: a symbolic link on the way: work\/link$/);
    assert.throws(() => removeTree(path.join(outside, 'f'), dir), /not under the trial directory/);
    assert.equal(fs.existsSync(path.join(outside, 'f')), true);
  }
  // A measured trial: its work/ and its tmp/ (an unreadable directory and a read-only one with copies) are removed.
  {
    const {dir, work} = trial('R-u-users-1');
    fs.mkdirSync(path.join(dir, 'tmp/x')); fs.writeFileSync(path.join(dir, 'tmp/x/out'), SECRET); lock(path.join(dir, 'tmp/x'), 0o000);
    fs.mkdirSync(path.join(dir, 'tmp/ro')); fs.writeFileSync(path.join(dir, 'tmp/ro/out'), SECRET); lock(path.join(dir, 'tmp/ro'), 0o500);
    const m = credentialCheckOf({dir, work, secret: SECRET});
    assert.deepEqual([m.credentialUnreadable, m.credentialFiles.includes('tmp/ro/out')], [['tmp/x'], true]);
    removeCredentialCopies(m, {dir, work, probe: false});
    assert.deepEqual([fs.existsSync(work), fs.existsSync(path.join(dir, 'tmp')), m.workRemoved, m.credentialCleanupErrors], [false, false, 'credential leak', undefined]);
  }
  // review L-1: the trial directory itself unreadable ('.'): the whole work/ and tmp/ of the probe are removed and recorded.
  {
    const {dir, work} = trial('R-probe-3');
    fs.writeFileSync(path.join(dir, 'tmp/env.txt'), SECRET);
    lock(dir, 0o000);
    const m = credentialCheckOf({dir, work, secret: SECRET});
    assert.deepEqual(m.credentialUnreadable, ['.']);
    removeCredentialCopies(m, {dir, work, probe: true});
    assert.deepEqual([fs.existsSync(work), fs.existsSync(path.join(dir, 'tmp')), m.workRemoved, m.credentialCleanupErrors], [false, false, 'trial directory unreadable', undefined]);
  }
  // The cleanup at the end of every trial (main's finally): unreadable and read-only directories are removed, a failure is
  // returned (not thrown), and the ledger is unlocked after it in any case.
  {
    const dir = path.join(d, 'R-u-users-2');
    for (const s of ['home/a', 'config', 'bin', 'tmp/ro']) fs.mkdirSync(path.join(dir, s), {recursive: true});
    fs.writeFileSync(path.join(dir, 'tmp/ro/f'), 'x'); lock(path.join(dir, 'tmp/ro'), 0o500); lock(path.join(dir, 'home/a'), 0o000);
    fs.symlinkSync(path.join(d, 'outside'), path.join(dir, 'bin/link'));
    const left = removeAll(['home', 'config', 'bin', 'tmp', '../outside'].map((s) => path.join(dir, s)), dir);
    assert.deepEqual(['home', 'config', 'bin', 'tmp'].map((s) => fs.existsSync(path.join(dir, s))), [false, false, false, false]);
    assert.deepEqual([left.length, fs.existsSync(path.join(d, 'outside/f'))], [1, true], 'a link is removed, not followed; a path outside is refused and returned');
    const src = fs.readFileSync(path.join(H, 'run-trial.mjs'), 'utf8');
    assert.match(src, /try \{ left = removeAll\(\[home, config, path\.join\(dir, 'bin'\), path\.join\(dir, 'tmp'\)\], dir\); \} finally \{ unlock\(\); \}/);
  }
});

// PR #1857 re-review M-2: with the cwd unknown (a failed call with a cd, a cd after ||, git -C to a variable), a directory
// searched in depth or a path going up (..) is unbounded output, so a forbidden read is not missed.
test('PR #1857 re-review M-2: unknown cwd: a searched directory and a path with .. are unbounded; a known cwd as before', () => {
  const root = '/r/w', files = ['project/rules/money.md', 'rules/money.md', 'src/a.ts'];
  const trace = (calls) => ({cwd: root, uses: calls.map((c, i) => ({id: `b${i}`, name: 'Bash', input: {command: c[0]}})), results: new Map(calls.map((c, i) => [`b${i}`, {is_error: c[1]}]))});
  assert.equal(bashTraceReads(trace([['cd project/rules && false', true], ['grep -r money .', false]]), files).unbounded, 1, 'example 1 of the review');
  assert.equal(bashTraceReads(trace([['cd src && false', true], ['cat ../rules/money.md', false]]), files).unbounded, 1, 'example 2 of the review');
  assert.equal(bashTraceReads(trace([['false || cd src', false], ['rg money', false]]), files).unbounded, 1);
  for (const c of ['grep -r money .', 'grep -r money rules', 'rg money', 'find rules -exec cat {} +', 'cat ./../x.md', 'cat ..', 'cat .']) assert.equal(bashScan(c, root, null, files).unbounded, true, c);
  assert.equal(bashScan('git -C "$W" grep money', root, root, files).unbounded, true, 'review: git -C to a variable, grep');
  // A forbidden read is then counted (caseChecks with the Bash counts).
  const bash = bashTraceReads(trace([['cd src && false', true], ['cat ../rules/money.md', false]]), files);
  const k = {id: 'x', forbidReads: [{id: 'money', pattern: '^rules/money\\.md$'}]};
  assert.deepEqual(caseChecks(k, [], {uses: [], results: new Map(), cwd: root, skills: [], text: ''}, {bash}).forbiddenReads, ['money']);
  // As before: a known cwd expands the directory against the files; an unknown cwd still matches a plain path by its end.
  const known = bashScan('grep -r money rules', root, root, files);
  assert.deepEqual([known.unbounded, known.possible.includes('rules/money.md')], [false, true]);
  const plain = bashScan('cat a.ts', root, null, files);
  assert.deepEqual([plain.unbounded, plain.possible], [false, ['src/a.ts']]);
  assert.equal(bashScan('cat ../x.md', root, root, files).unbounded, false, 'a known cwd: .. is resolved');
});

// PR #1857 re-review L-4: a probe whose work/ was removed entirely is still read and fails credentialNotLeaked, with the
// removal and its failures in the details.
test('PR #1857 re-review L-4: a probe without work/ is read and fails; cleanup failures in the details', async (t) => {
  const {d} = probeLedger(t, ['S-probe-1']);
  const dir = path.join(d, 'S-probe-1');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({...meta, credentialLeak: true, credentialFiles: [], credentialInGitObjects: null, credentialInRecords: 0, credentialCheckError: 'boom', workRemoved: 'credential check error', credentialCleanupErrors: ['tmp: EACCES']}));
  fs.rmSync(path.join(dir, 'work'), {recursive: true, force: true});
  const {inputs} = fileInputs(dir, 'S', REPO, CONDS);
  const r = checkProbe({...inputs, conditionsOverride: CONDS, ownerLines: [], ownerSkills: [], tokens: TOKENS, realHome: '/nonexistent-home', hostInstallDir: '/opt/claude', installProblems: []});
  assert.deepEqual([inputs.workRemoved, inputs.credentialCleanupErrors, inputs.credentialLeak, r.pass], ['credential check error', ['tmp: EACCES'], true, false]);
  // Level X (credentialNotLeaked): the removal and its failures are in the details.
  const {probeStepChecks} = await import('../probe-check.mjs');
  const ctx = probeContext({dir: '/r/runs/R-probe-1', runsRoot: '/r/runs', fixture: '/r/fx', ledger: '/r/l/ledger.jsonl', homeMarker: '/h/m', repoMarker: '/repo/m'}, X44);
  const c = probeStepChecks({...inputs, steps: probeSteps('X', ctx), expectedSteps: C44.probeSteps.X}, parseTrace(''), 'X').checks.credentialNotLeaked;
  assert.deepEqual([c.pass, c.detail.checkError, c.detail.workRemoved, c.detail.cleanupErrors], [false, 'boom', 'credential check error', ['tmp: EACCES']]);
});

// #1858: deductions matched sentence by sentence (opt-in fields), and a config with one condition.
const {sentencesOf, entryMatches, markerDeductionsOf, conditionCountProblems, sentenceFieldProblems} = await import('../score.mjs');
const {templateHits} = await import('../calibrate.mjs');
const {judgeScored} = await import('../judge.mjs');
const C1846 = path.join(EVROOT, '1846-warranty-version/config');
const C1843 = path.join(EVROOT, '1843-spec-rule-path/config');
const NOT_PROMISED = '今は『無償で直します』とも『有償です』とも答えません。まず原因を調べます。';
const FREE = '無償で(修補|修正|対応|直)(いた)?します|無償(修補|対応)の対象です';
const NEGATED = '(答え|お答えし|約束し|お約束し|言い|申し上げ|お伝えし)ません';

test('#1858 sentences: split at 。！？ and line breaks, not inside 「」『』（）; an unclosed bracket ends at the line', () => {
  assert.deepEqual(sentencesOf(NOT_PROMISED), ['今は『無償で直します』とも『有償です』とも答えません。', 'まず原因を調べます。']);
  assert.deepEqual(sentencesOf('「無償で直します。」とお返事します。次に調べます！本当？'), ['「無償で直します。」とお返事します。', '次に調べます！', '本当？']);
  assert.deepEqual(sentencesOf('（注：以前は10分。）今は15分。'), ['（注：以前は10分。）今は15分。']);
  assert.deepEqual(sentencesOf('「閉じない\n次の行。'), ['「閉じない', '次の行。']);
  assert.deepEqual(sentencesOf(''), []);
});

test('#1858 answerNone sentenceUnless: a quoted promise in a sentence that withholds it is not counted; real promises, quoted or not, are', () => {
  const k = {answerNone: [{id: 'free-before-check', pattern: FREE, sentenceUnless: NEGATED}]};
  assert.deepEqual(markerDeductionsOf(k, NOT_PROMISED), [], 'C-m-r1-3 of #1846');
  assert.deepEqual(markerDeductionsOf(k, NOT_PROMISED.replace(/。/g, '。\n')), [], 'with line breaks');
  assert.deepEqual(markerDeductionsOf(k, '今は「無償で直します。」とはお約束しません。'), [], 'a 。 inside the quote stays in the sentence');
  for (const t of ['無償で直します。', '無償修補の対象です。', '『無償で直します』とお返事します。', '「無償で直します。」とお返事します。', '原因を調べます。無償で対応いたします。',
    `${NOT_PROMISED}ただし、無償で直します。`]) assert.deepEqual(markerDeductionsOf(k, t), ['free-before-check'], t);
  // Without the new fields the whole text is matched, as before #1858: the fixed #1846 config still counts C-m-r1-3.
  const fixed = JSON.parse(read('cases.json', C1846)).cases.find((c) => c.id === 'm-r1');
  assert.ok(!fixed.answerNone.some((g) => typeof g === 'object' && ('sentenceWith' in g || 'sentenceUnless' in g)), 'the #1846 config is not rewritten');
  assert.ok(markerDeductionsOf(fixed, NOT_PROMISED).includes('free-before-check'), 'the #1846 record (fail by the fixed rule) is reproduced');
  assert.deepEqual(markerDeductionsOf({answerNone: [FREE, {id: 'x', pattern: FREE}]}, NOT_PROMISED), [FREE, 'x'], 'a string or an entry without the fields: whole text');
  assert.deepEqual(markerDeductionsOf(k, '『有償です』とは言いませんが、無償で直します。'), [], 'known limit (README): one sentence that withholds and promises is left out');
  assert.equal(markersOk(k, NOT_PROMISED), true);
  assert.equal(markersOk(k, '無償で直します。'), false);
});

test('#1858 writes.forbid sentenceWith: a history marker counts in a sentence about the earlier state, not in a current fact', () => {
  const FN = 'docs/specs/FN-003.md';
  const w = {forbid: [{id: 'history-only', pattern: '入力欄だけ|メールアドレスだけ', group: 'history', sentenceWith: '以前|変更前|これまで|だった|でした|していた|から変更|に変更'}]};
  const check = (text) => writeChecks(w, [FN], () => text).writeViolations;
  for (const t of ['選択中のタブの入力欄だけを表示する。', '- 登録手段：選択中の手段の入力欄だけが必須である。', '| 画面 | 選択中のタブの入力欄だけを表示する |']) assert.deepEqual(check(t), [], t);
  for (const t of ['以前はメールアドレスだけだった。', '登録手段はメールアドレスだけでしたが、電話番号を追加した。', '- メールアドレスだけから変更した']) assert.deepEqual(check(t), ['history-only'], t);
  assert.deepEqual(check('選択中のタブの入力欄だけを表示する。以前は入力欄だけだった。'), ['history-only'], 'one history sentence is enough');
  assert.deepEqual(writeChecks(w, [FN], () => '選択中のタブの入力欄だけを表示する。').writeFailedGroups, []);
  // The fixed #1843 entry (no sentenceWith) still matches the current-fact sentence, as recorded for C-s-1-1 / C-s-1-4.
  const k43 = JSON.parse(read('cases.json', C1843)).cases.find((c) => c.id === 's-1');
  const fixed = k43.writes.forbid.find((e) => e.id === 'history-only');
  assert.ok(!('sentenceWith' in fixed) && !('sentenceUnless' in fixed), 'the #1843 config is not rewritten');
  assert.equal(entryMatches(fixed, '選択中のタブの入力欄だけを表示する。'), true);
  // scope "code" and sentence matching combine: the code is taken first, then split.
  const dec = {forbid: [{id: 'decimal', pattern: '\\d\\.\\d', scope: 'code', sentenceUnless: 'BigInt'}]};
  assert.deepEqual(writeChecks(dec, ['a.ts'], () => '// 1bp = 0.01%\nconst x = 1n;\n').writeViolations, [], 'the comment is not code');
  assert.deepEqual(writeChecks(dec, ['a.ts'], () => 'const x = price * 1.1;\n').writeViolations, ['decimal']);
  assert.deepEqual(writeChecks(dec, ['a.ts'], () => 'const x = BigInt(price * 1.1);\n').writeViolations, [], 'sentenceUnless on the code line');
});

test('#1858 condition count: a comparison needs two conditions, the levels one or two; the existing configs pass; dry-run checks it', () => {
  for (const dir of [EV, C1823, path.join(EVROOT, '1840-user-environment/config'), C1843, path.join(EVROOT, '1844-rule-read-bash/config'), C1846]) assert.deepEqual(conditionCountProblems(JSON.parse(read('conditions.json', dir))), [], dir);
  assert.match(conditionCountProblems({cells: {C: {}}})[0], /needs exactly two/);
  assert.match(conditionCountProblems({cells: {}, rule: {mode: 'levels'}})[0], /0 condition/);
  assert.match(conditionCountProblems({cells: {A: {}, B: {}, C: {}}, rule: {mode: 'levels'}})[0], /3 condition/);
  const src = fs.readFileSync(path.join(H, 'dry-run.mjs'), 'utf8');
  assert.ok(src.includes("add('conditionCount', conditionCountProblems(conds).length === 0, conditionCountProblems(conds));"));
  assert.ok(fs.readFileSync(path.join(H, 'judge.mjs'), 'utf8').includes('const count = conditionCountProblems(loadConditions());'));
});

test('#1858 one condition (the shape of #1846): judged from that condition alone, no second condition; two conditions as before', () => {
  const spec = {cases: [{id: 'm-r1', kind: 'maintenance', expect: 'estimate-and-scope'}, {id: 'n-2', kind: 'negative', expect: null}]};
  const rule = {mode: 'levels', maxFailureRate: 0.1, levels: [{id: 'sel', cases: ['m-r1'], metric: 'reach', min: 0.8}, {id: 'ans', cases: ['m-r1'], metric: 'markers', min: '2/3'}, {id: 'neg', cases: ['n-2'], metric: 'negativeOk', min: 0.8}]};
  const row = (c, id, run, ok) => (id === 'n-2' ? {condition: c, case: id, run, kind: 'negative', expect: null, counted: true, overapplication: false, negativeOk: ok} : {condition: c, case: id, run, kind: 'maintenance', expect: 'estimate-and-scope', counted: true, reach: true, bodyRead: true, applied: true, markers: ok});
  const rows = (c, marks) => [...marks.map((ok, i) => row(c, 'm-r1', i + 1, ok)), ...[1, 2, 3].map((n) => row(c, 'n-2', n, true))];
  const completion = {basis: 'complete', complete: true, missingPlanned: 0, missingReplacements: []};
  const one = {cells: {C: {tools: 'W'}}, rule};
  const r = judgeScored({spec, runs: rows('C', [true, true, false]), completion, conds: one});
  assert.deepEqual(Object.keys(r.sums), ['C']);
  assert.deepEqual(Object.keys(r.judgement.perCondition), ['C'], 'no undefined condition');
  assert.deepEqual([r.judgement.verdict, r.judgement.perCondition.C.verdict], ['levels', 'meets-levels'], 'judged, and as the condition alone');
  const low = judgeScored({spec, runs: rows('C', [true, false, false]), completion, conds: one});
  assert.deepEqual([low.judgement.verdict, low.judgement.perCondition.C.verdict], ['levels', 'below-levels']);
  const none = judgeScored({spec, runs: rows('C', [true, true, true]).filter((x) => x.case !== 'n-2'), completion, conds: one});
  assert.equal(none.judgement.verdict, 'not-judged');
  assert.equal(none.judgement.reason, 'C: no valid negative trial; C: no valid trial for n-2', 'the reasons of the one condition, once, none of a missing condition');
  assert.throws(() => judgeScored({spec, runs: [], completion, conds: {cells: {C: {}}}}), /needs exactly two/, 'a comparison with one condition is refused');
  // Two conditions: the same result as the pre-#1858 path (levelsVerdict / verdictOf on the two summaries).
  const two = {cells: {R: {}, C: {}}, rule};
  const runs2 = [...rows('R', [true, false, false]), ...rows('C', [true, true, true])];
  const sums2 = {R: summarize(spec, runs2, 'R'), C: summarize(spec, runs2, 'C')};
  assert.deepEqual(judgeScored({spec, runs: runs2, completion, conds: two}), {sums: sums2, completion, judgement: levelsVerdict(sums2, runs2, {completion, rule, subsets: {}})});
  const cmp = {cells: {B: {}, S: {}}, rule: {}};
  const runs3 = [...rows('B', [true, true, true]), ...rows('S', [true, true, true])];
  const sums3 = {B: summarize(spec, runs3, 'B'), S: summarize(spec, runs3, 'S')};
  assert.deepEqual(judgeScored({spec, runs: runs3, completion, conds: cmp}).judgement, verdictOf(sums3.B, sums3.S, {completion, subsets: {}, perCase: null, efficiency: null, rule: {}}));
});

test('#1858 review L1/L4: sentence ends (．!? and an English "." before a space), nested and mixed brackets, !? inside brackets', () => {
  assert.deepEqual(sentencesOf('原因は申し上げません!無償で直します!'), ['原因は申し上げません!', '無償で直します!']);
  assert.deepEqual(sentencesOf('本当?はい．次です。'), ['本当?', 'はい．', '次です。']);
  assert.deepEqual(sentencesOf('We will not say. We fix it for free.'), ['We will not say.', 'We fix it for free.']);
  assert.deepEqual(sentencesOf('price * 1.1 in a.ts is kept'), ['price * 1.1 in a.ts is kept'], 'a "." not before a space does not end a sentence');
  assert.deepEqual(sentencesOf('「『無償です。』と言う！」と書く。次。'), ['「『無償です。』と言う！」と書く。', '次。'], 'nested brackets');
  assert.deepEqual(sentencesOf('「本当？いいえ!」と答える。次。'), ['「本当？いいえ!」と答える。', '次。'], '!? inside brackets');
  assert.deepEqual(sentencesOf('「閉じる）ここで。次。'), ['「閉じる）ここで。', '次。'], 'mixed kinds: the depth only');
  const k = {answerNone: [{id: 'free', pattern: FREE, sentenceUnless: NEGATED}]};
  assert.deepEqual(markerDeductionsOf(k, '原因は申し上げません!無償で直します!'), ['free'], 'the half-width ! ends the withholding sentence');
  assert.deepEqual(markerDeductionsOf(k, '『お答えしません』とは言わず、無償で直します。'), ['free'], 're-review M-1: a negation only inside a quote does not leave out the promise outside it');
});

test('#1858 review L2: sentenceWith / sentenceUnless must be non-empty regular expressions; dry-run checks them; the existing configs pass', () => {
  const spec = (e) => ({cases: [{id: 'm', answerNone: [e]}]});
  assert.deepEqual(sentenceFieldProblems(spec({id: 'a', pattern: 'x', sentenceUnless: 'ません'})), []);
  assert.deepEqual(sentenceFieldProblems(spec('x')), [], 'a string entry has no fields');
  assert.match(sentenceFieldProblems(spec({id: 'a', pattern: 'x', sentenceUnless: ''}))[0], /^m a: sentenceUnless must be a non-empty string/);
  assert.match(sentenceFieldProblems(spec({id: 'a', pattern: 'x', sentenceWith: 3}))[0], /sentenceWith must be a non-empty string/);
  assert.match(sentenceFieldProblems(spec({id: 'a', pattern: 'x', sentenceWith: null}))[0], /sentenceWith must be a non-empty string/);
  assert.match(sentenceFieldProblems({cases: [{id: 's', writes: {forbid: [{id: 'f', pattern: 'x', sentenceWith: '('}]}}]})[0], /^s f: sentenceWith is not a regular expression/);
  for (const dir of [EV, C1823, path.join(EVROOT, '1840-user-environment/config'), C1843, path.join(EVROOT, '1844-rule-read-bash/config'), C1846]) assert.deepEqual(sentenceFieldProblems(JSON.parse(read('cases.json', dir))), [], dir);
  assert.ok(fs.readFileSync(path.join(H, 'dry-run.mjs'), 'utf8').includes("add('sentenceFields', sentenceFieldProblems(spec).length === 0, sentenceFieldProblems(spec));"));
});

test('#1858 review L3: templateHits matches a writes entry with sentenceWith sentence by sentence, as the scoring does', () => {
  // The #1843 config at 345c8f4e has three lines with 入力欄だけ (cases.json); fewer are in a sentence that also says 以前.
  const base = {commit: '345c8f4e', dir: 'docs/evidence/1843-spec-rule-path/config', as: 'c'};
  const lines = execFileSync('git', ['show', '345c8f4e:docs/evidence/1843-spec-rule-path/config/cases.json'], {cwd: REPO, encoding: 'utf8'}).split('\n');
  const sentenceEntry = {id: 'history-only', pattern: '入力欄だけ', sentenceWith: '以前'};
  const k = {writes: {forbid: [sentenceEntry, {id: 'plain', pattern: '入力欄だけ'}]}};
  const hits = templateHits(k, {t: base});
  assert.equal(hits.plain.t, 3);
  const expected = lines.filter((l) => entryMatches(sentenceEntry, l)).length;
  assert.ok(expected < 3);
  assert.equal(hits['history-only'].t, expected);
});

test('#1858 review M1: one condition with subsets is judged (each subset reports the one condition, no comparison)', () => {
  const spec = {cases: [{id: 'm-r1', kind: 'maintenance', expect: 'estimate-and-scope'}, {id: 'c-1', kind: 'change', expect: 'estimate-and-scope'}, {id: 'n-2', kind: 'negative', expect: null}]};
  const rule = {mode: 'levels', levels: [{id: 'sel', cases: ['m-r1', 'c-1'], metric: 'reach', min: 0.8}, {id: 'neg', cases: ['n-2'], metric: 'negativeOk', min: 0.8}]};
  const row = (id, run) => (id === 'n-2' ? {condition: 'C', case: id, run, kind: 'negative', expect: null, counted: true, overapplication: false, negativeOk: true}
    : {condition: 'C', case: id, run, kind: spec.cases.find((k) => k.id === id).kind, expect: 'estimate-and-scope', counted: true, reach: true, bodyRead: true, applied: true, markers: true});
  const runs = ['m-r1', 'c-1', 'n-2'].flatMap((id) => [1, 2, 3].map((n) => row(id, n)));
  const completion = {basis: 'complete', complete: true, missingPlanned: 0, missingReplacements: []};
  const conds = {cells: {C: {}}, rule, subsets: {change: {kinds: ['change']}, maint: {kinds: ['maintenance']}}};
  const r = judgeScored({spec, runs, completion, conds});
  assert.equal(r.judgement.verdict, 'levels');
  assert.deepEqual(Object.keys(r.judgement.separate), ['change', 'maint']);
  for (const x of Object.values(r.judgement.separate)) { assert.deepEqual(Object.keys(x), ['C']); assert.equal(x.C.positives, 3); }
  const none = judgeScored({spec, runs: runs.filter((x) => x.case !== 'n-2'), completion, conds});
  assert.equal(none.judgement.verdict, 'not-judged');
  assert.deepEqual(Object.keys(none.judgement.separate.change), ['C']);
});

test('#1858 review L4 / re-review L-3: the published two-condition judgements of #1823 (comparison), #1840 and #1843 (levels) are reproduced from their runs.json', () => {
  assert.equal(JSON.parse(read('conditions.json', C1823)).rule.mode, undefined, '#1823 is a comparison (no rule.mode)');
  assert.equal(JSON.parse(read('results/judge.json', C1823)).judgement.verdict, 'not-a-candidate');
  for (const dir of [C1823, path.join(EVROOT, '1840-user-environment/config'), C1843]) {
    const rd = (f) => JSON.parse(read(f, dir));
    const j = rd('results/judge.json');
    const r = judgeScored({spec: rd('cases.json'), runs: rd('results/runs.json'), completion: j.completion, conds: rd('conditions.json')});
    assert.ok(Object.keys(rd('conditions.json').subsets ?? {}).length > 0, `${dir}: has subsets`);
    assert.deepEqual(r.sums, j.conditions, dir);
    assert.deepEqual(r.judgement, j.judgement, dir);
  }
});

test('#1858 re-review M-1: in a quote of several sentences, a negation in one sentence does not leave out a promise in another', () => {
  const k = {answerNone: [{id: 'free', pattern: FREE, sentenceUnless: NEGATED}]};
  const counted = (t) => markerDeductionsOf(k, t);
  for (const t of ['返信案：「原因はまだお答えしません。無償で直します。」', '返信案：「原因はまだお答えしません！無償で直します！」', '「今は答えません。無償で直します。',
    '返信案：「原因は申し上げません。『無償修補の対象です』とお伝えください。」', '返信案：（原因はお答えしません。無償で対応いたします。）']) assert.deepEqual(counted(t), ['free'], t);
  // The negation of the sentence that holds the quote, or of the innermost sentence around the promise, still leaves it out.
  for (const t of [NOT_PROMISED, '今は「無償で直します。」とはお約束しません。', '返信案：「『無償で直します』とはお約束しません。原因を調べます。」',
    '返信案：「無償で直しますとはお答えしません。」', '「原因を調べます。」と書き、『無償で直します』とは申し上げません。']) assert.deepEqual(counted(t), [], t);
  assert.deepEqual(markerDeductionsOf(k, '『有償です』とは言いませんが、無償で直します。'), [], 'known limit (README): one sentence that withholds and promises is left out');
});

test('#1858 re-review L-1: scope "code" on a code file takes each line as one sentence (!, ?, . do not split the code)', () => {
  const dec = {forbid: [{id: 'decimal', pattern: '\\d\\.\\d', scope: 'code', sentenceUnless: 'BigInt'}]};
  const v = (src, file = 'a.ts') => writeChecks(dec, [file], () => src).writeViolations;
  assert.deepEqual(v('const x = price * 1.1 !== BigInt(y);\n'), []);
  assert.deepEqual(v('const x = a ? 1.1 : BigInt(b);\n'), []);
  assert.deepEqual(v('const x = a?.b ?? BigInt(1.1);\n'), []);
  assert.deepEqual(v('const x = BigInt(a);\nconst y = 1.1;\n'), ['decimal'], 'another line is another sentence');
  assert.deepEqual(v('rate 1.1 is fixed! BigInt is not used.', 'a.md'), ['decimal'], 'not a code file: the sentences of the text');
});

test('#1858 re-review L-2: the sentence fields are checked in writesReport.forbid and refused in require entries', () => {
  assert.match(sentenceFieldProblems({cases: [{id: 's', writesReport: {forbid: [{id: 'f', pattern: 'x', sentenceUnless: ''}]}}]})[0], /^s f: sentenceUnless must be a non-empty string/);
  assert.deepEqual(sentenceFieldProblems({cases: [{id: 's', writesReport: {forbid: [{id: 'f', pattern: 'x', sentenceUnless: 'ません'}]}}]}), []);
  assert.match(sentenceFieldProblems({cases: [{id: 's', writes: {require: [{id: 'r', pattern: 'x', sentenceWith: '以前'}]}}]})[0], /^s r: sentenceWith is not used in a require entry/);
  assert.match(sentenceFieldProblems({cases: [{id: 's', writesReport: {require: [{id: 'r', pattern: 'x', sentenceUnless: 'ません'}]}}]})[0], /^s r: sentenceUnless is not used in a require entry/);
  assert.deepEqual(writeChecks({forbid: [{id: 'f', pattern: '無償', sentenceUnless: NEGATED}]}, ['CHANGELOG.md'], () => '無償とは言いません。').writeViolations, [], 'writesReport uses the same writeChecks');
});
