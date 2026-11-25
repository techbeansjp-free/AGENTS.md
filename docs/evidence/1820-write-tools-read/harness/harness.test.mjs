// Synthetic tests for the #1820 stage-1 harness (the parts that differ from #1817). No model call, no network.
// The files copied byte for byte from #1817 (guard, ledger, install-asc, condition-i) are checked for identity here and
// are covered by the #1817 tests (docs/evidence/1817-skill-application/harness/*.test.mjs).
// Usage: node --test docs/evidence/1820-write-tools-read/harness/harness.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseTrace, scoreRun, selectCounted, mainEffects, summarizeCell, initProblems} from './score.mjs';
import {plannedTrials, orderProblems, orderRefusal, probeRefusal, completionStatus, replacementPlan, loadOrder} from './order.mjs';
import {flags, isolationSettings, promptFor, cellOf, probePrompt, probeGateProblems, installProblems, sentinelPaths, INSIDE_FILE, NETWORK_URL} from './run-trial.mjs';
import {approvalProblems} from './markers.mjs';
import {writeSources, pinned} from './make-fixture.mjs';
import {checkProbe, compareProbes, writeAndBashChecks} from './probe-check.mjs';
import {FIXED} from './fixation.mjs';
import {collectTrial, buildCollection} from './collect.mjs';
import * as ledger from './ledger.mjs';

const H = path.dirname(fileURLToPath(import.meta.url));
const EV = path.resolve(H, '..');
const EVROOT = path.resolve(EV, '..');
const read = (f) => fs.readFileSync(path.join(EV, f), 'utf8');
const CONDS = JSON.parse(read('conditions.json'));
const SPEC = JSON.parse(read('cases.json'));
const ORDER = loadOrder();
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'h1820-')); t.after(() => fs.rmSync(d, {recursive: true, force: true})); return d; };

test('files copied from #1817 are byte-identical; the fixed list names every plan file and harness module', () => {
  for (const f of ['guard', 'ledger', 'install-asc', 'condition-i']) {
    assert.ok(fs.readFileSync(path.join(H, `${f}.mjs`)).equals(fs.readFileSync(path.join(EVROOT, '1817-skill-application/harness', `${f}.mjs`))), f);
  }
  for (const f of FIXED) assert.ok(fs.existsSync(path.join(EV, f)), f);
  const modules = fs.readdirSync(H).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'dry-run.mjs').map((f) => `harness/${f}`);
  assert.deepEqual(modules.sort(), FIXED.filter((f) => f.startsWith('harness/')).sort());
});

test('prompts: the short form is #1817 asc-3 and the #1815 form is the first paragraph of gen-prompt.txt, each adapted only in the BRIEF path', () => {
  const brief = SPEC.cases.find((c) => c.id === 'brief');
  const asc3 = JSON.parse(fs.readFileSync(path.join(EVROOT, '1817-skill-application/cases.json'), 'utf8')).cases.find((c) => c.id === 'asc-3').prompt;
  const gen = fs.readFileSync(path.join(EVROOT, '1807-design-eval-browser/env/gen-prompt.txt'), 'utf8').split('\n\n')[0].trim();
  assert.equal(brief.prompts.SA, asc3);
  assert.equal(brief.prompts.SD, asc3.replace('docs/BRIEF.md', 'BRIEF.md'));
  assert.equal(brief.prompts.GD, gen);
  assert.equal(brief.prompts.GA, gen.replace('BRIEF.md', 'docs/BRIEF.md'));
  for (const p of Object.values(brief.prompts)) assert.doesNotMatch(p, /fetch_page|screenshot|browser/);
  // The negative cases are the #1814 ones, unchanged.
  const neg1814 = JSON.parse(fs.readFileSync(path.join(EVROOT, '1814-skill-invocation/cases.json'), 'utf8')).cases.filter((c) => c.kind === 'negative');
  assert.deepEqual(SPEC.cases.filter((c) => c.kind === 'negative'), neg1814);
});

test('cells are the full 3 x 2 x 2 design; negative prompts only in the negative cells', () => {
  const ids = Object.entries(CONDS.cells).map(([id, c]) => { assert.equal(id, `${c.tools}${c.prompt}${c.fixture}`); return id; });
  assert.equal(new Set(ids).size, 12);
  for (const t of ['R', 'W', 'X']) for (const p of ['S', 'G']) for (const f of ['A', 'D']) assert.ok(CONDS.cells[`${t}${p}${f}`]);
  const neg = SPEC.cases.find((c) => c.id === 'neg-1');
  assert.equal(promptFor(cellOf('WSA'), neg), neg.prompt);
  assert.throws(() => promptFor(cellOf('XSA'), neg), /runs only in/);
  assert.equal(promptFor(cellOf('XGD'), SPEC.cases[0]), SPEC.cases[0].prompts.GD);
  assert.throws(() => cellOf('ZZZ'), /unknown cell/);
});

test('launch flags per tools level: tools, disallowed tools, permission mode, --settings and --max-turns', () => {
  const f = (lv, mt = 2) => flags({level: CONDS.toolLevels[lv], model: 'sonnet', budget: 0.3, maxTurns: mt, settingsFile: 's.json'}).join(' ');
  assert.match(f('R'), /--tools Read,Glob,Grep,Skill --disallowedTools Bash,Write,Edit,/); assert.doesNotMatch(f('R'), /--permission-mode/);
  assert.match(f('W'), /--tools Read,Write,Edit,Glob,Grep,Skill --disallowedTools Bash,NotebookEdit/); assert.match(f('W'), /--permission-mode acceptEdits/);
  assert.match(f('X'), /--tools Read,Write,Edit,Glob,Grep,Skill,Bash --disallowedTools NotebookEdit/); assert.match(f('X'), /--permission-mode acceptEdits/);
  for (const lv of ['R', 'W', 'X']) { assert.match(f(lv), /--settings s\.json --max-turns 2 /); assert.match(f(lv), /--strict-mcp-config/); }
  assert.equal(CONDS.maxTurns, 2);
});

test('isolation settings: sandbox required, no escape, no network, reads and writes outside work/ denied', () => {
  const s = isolationSettings({work: '/x/runs/T/work', runsRoot: '/x/runs', fixture: '/x/fixture-A', ledger: '/y/ledger/l.jsonl'});
  assert.equal(s.permissions.blockReadsOutsideWorkingDirectories, true);
  assert.deepEqual({e: s.sandbox.enabled, f: s.sandbox.failIfUnavailable, u: s.sandbox.allowUnsandboxedCommands, a: s.sandbox.autoAllowBashIfSandboxed}, {e: true, f: true, u: false, a: true});
  assert.deepEqual(s.sandbox.network.allowedDomains, []);
  assert.deepEqual(s.sandbox.filesystem.denyRead, ['/Users', '/x/runs', '/x/fixture-A', '/y/ledger']);
  assert.deepEqual(s.sandbox.filesystem.allowRead, ['/x/runs/T/work']);
  assert.deepEqual(s.sandbox.filesystem.denyWrite, ['/x/fixture-A', '/y/ledger']);
  assert.equal(JSON.stringify(s).includes(os.homedir()), false, 'the real HOME path is not written (covered by /Users)');
});

test('probe prompts: W adds the outside Write, X adds the sandbox steps', () => {
  const o = {homeMarker: '/h/m', repoMarker: '/r/m', sentinels: {trial: '/t/o.txt', repo: '/r/s.txt'}};
  assert.doesNotMatch(probePrompt('R', o), /Write|Bash/);
  assert.match(probePrompt('W', o), /Writeで \/t\/o\.txt/); assert.doesNotMatch(probePrompt('W', o), /Bash/);
  const x = probePrompt('X', o);
  for (const s of [`echo probe > ${INSIDE_FILE}`, 'cat /h/m', 'cat /r/m', 'touch /t/o.txt', 'touch /r/s.txt', NETWORK_URL]) assert.ok(x.includes(s), s);
  assert.deepEqual(sentinelPaths({dir: '/t', repo: '/r'}), {trial: '/t/outside-write-probe.txt', repo: '/r/.agent-skill-chain/local/asc1820-write-probe.txt'});
});

test('run order: 60 planned trials, negatives only in reps 1-2, counterexamples refused', () => {
  const planned = plannedTrials();
  assert.equal(planned.length, 60);
  assert.equal(planned.filter((t) => t.case === 'brief').length, 48);
  assert.equal(planned.filter((t) => t.rep > 2 && t.case !== 'brief').length, 0);
  assert.deepEqual(orderProblems(ORDER, SPEC, CONDS), []);
  const bad = (perRep) => orderProblems({perRep}, SPEC, CONDS);
  assert.ok(bad([...ORDER.perRep, 'RSA:brief']).some((p) => /repeated/.test(p)));
  assert.ok(bad(ORDER.perRep.filter((e) => e !== 'XGA:brief')).some((p) => /XGA has not exactly one brief/.test(p)));
  assert.ok(bad([...ORDER.perRep, 'XSD:neg-1']).some((p) => /outside the negative cells/.test(p)));
  assert.ok(bad(['RSA:neg-1', 'WSA:neg-1', ...ORDER.perRep.filter((e) => !['RSA:neg-1', 'WSA:neg-1'].includes(e))]).some((p) => /adjacent/.test(p)));
  assert.ok(bad([...ORDER.perRep.filter((e) => e !== 'WSA:neg-3'), 'WSA:neg-3']).some((p) => /ends with a negative/.test(p)));
});

test('order gate: only the next planned trial; probes only in probe cells and before the measurement', () => {
  const none = new Set();
  assert.equal(orderRefusal({condition: 'RSA', caseId: 'brief', rep: '1', reserved: none}), null);
  assert.match(orderRefusal({condition: 'WSA', caseId: 'brief', rep: '1', reserved: none}), /out of order/);
  assert.equal(orderRefusal({condition: 'WSA', caseId: 'brief', rep: '1', reserved: new Set(['RSA-brief-1'])}), null);
  assert.match(orderRefusal({condition: 'RSA', caseId: 'neg-1', rep: '3', reserved: none}), /replacement RSA-neg-1-3 before every planned trial/);
  assert.equal(probeRefusal({condition: 'XSA', rep: '1', reserved: none}), null);
  assert.match(probeRefusal({condition: 'XGD', rep: '1', reserved: none}), /not a probe cell/);
  assert.match(probeRefusal({condition: 'XSA', rep: '2', reserved: none}), /needs XSA-probe-1 first/);
  assert.match(probeRefusal({condition: 'XSA', rep: '1', reserved: new Set(['RSA-brief-1'])}), /measurement has started/);
});

// --- synthetic traces ---
let n = 0;
const ev = (o) => JSON.stringify(o);
function trace({messages, tools = ['Read', 'Glob', 'Grep', 'Skill'], mode = 'default', subtype = 'error_max_turns', isError = true, cwd = '/tmp/w', text = 'ok'}) {
  const lines = [ev({type: 'system', subtype: 'init', cwd, tools, permissionMode: mode, mcp_servers: [], model: 'm'})];
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
const brief = SPEC.cases.find((c) => c.id === 'brief');
const BODY = '.agent-skill-chain/skills/asc/SKILL.md';
const R = CONDS.toolLevels.R, W = CONDS.toolLevels.W;

test('score: body read in message 1, or only in message 2; first tools recorded; max-turns stop is not a failure', () => {
  const a = scoreRun(SPEC, brief, trace({messages: [[['Read', {file_path: 'docs/BRIEF.md'}], ['Read', {file_path: `/tmp/w/${BODY}`}]], [['Read', {file_path: '/tmp/w/src/users.ts'}]]]}), {level: R});
  assert.equal(a.failure, undefined); assert.equal(a.bodyRead1, true); assert.equal(a.bodyRead2, true); assert.equal(a.stopped, 'error_max_turns');
  assert.deepEqual(a.firstTools, [{name: 'Read', target: 'docs/BRIEF.md'}, {name: 'Read', target: BODY}]);
  const b = scoreRun(SPEC, brief, trace({messages: [[['Glob', {pattern: '**/*'}]], [['Read', {file_path: BODY}]]]}), {level: R});
  assert.deepEqual([b.bodyRead1, b.bodyRead2, b.reach2], [false, true, true]);
  assert.deepEqual(b.firstTools, [{name: 'Glob', target: '**/*'}]);
});

test('score: several stream events of one message are one message; a third message is not observed', () => {
  const t = trace({messages: [[['Read', {file_path: 'BRIEF.md'}], ['Glob', {pattern: '**/*'}]], [['Read', {file_path: 'data.json'}]], [['Read', {file_path: BODY}]]]});
  assert.equal(t.messages.length, 3);
  const s = scoreRun(SPEC, brief, t, {level: R});
  assert.equal(s.firstTools.length, 2); assert.equal(s.bodyRead2, false);
});

test('score: a refused Read does not count; a Read without result (stopped) counts and is flagged; Skill(asc), entry and README in message 1', () => {
  const refused = scoreRun(SPEC, brief, trace({messages: [[['Read', {file_path: BODY}, true]]]}), {level: R});
  assert.equal(refused.bodyRead2, false);
  const missing = scoreRun(SPEC, brief, trace({messages: [[['Read', {file_path: 'BRIEF.md'}]], [['Read', {file_path: BODY}, 'missing']]]}), {level: R});
  assert.equal(missing.bodyRead2, true); assert.equal(missing.resultMissing, true);
  const s = scoreRun(SPEC, brief, trace({messages: [[['Skill', {skill: 'asc'}], ['Read', {file_path: '.claude/skills/asc/SKILL.md'}], ['Read', {file_path: '.agent-skill-chain/skills/README.md'}]]]}), {level: R});
  assert.deepEqual([s.skillAsc1, s.entryRead1, s.readmeRead1, s.bodyRead2, s.reach2], [true, true, true, false, true]);
  const red = scoreRun(SPEC, brief, trace({cwd: '<trial>/work', messages: [[['Read', {file_path: `<trial>/work/${BODY}`}]]]}), {level: R});
  assert.equal(red.bodyRead1, true, 'redacted public traces are scored like the raw ones');
});

test('score: other tools or permission mode than the cell is a failure; an API error is a failure', () => {
  const t = trace({messages: [[['Read', {file_path: BODY}]]], tools: ['Read', 'Glob', 'Grep', 'Skill']});
  assert.match(scoreRun(SPEC, brief, t, {level: W}).failure, /condition not received: tools/);
  assert.deepEqual(initProblems(trace({messages: [[]], tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'ToolSearch'], mode: 'acceptEdits'}).init, W), []);
  assert.match(initProblems(trace({messages: [[]], tools: W.tools.split(','), mode: 'default'}).init, W).join(), /permission mode/);
  assert.match(scoreRun(SPEC, brief, trace({messages: [[]], subtype: 'error_during_execution'}), {level: R}).failure, /result error/);
});

test('score: negative case overapplication counts any ASC Skill, entry or body in the first two messages', () => {
  const neg = SPEC.cases.find((c) => c.id === 'neg-2');
  assert.equal(scoreRun(SPEC, neg, trace({messages: [[]], subtype: 'success', isError: false, text: 'PATCH'}), {level: R}).overapplication, false);
  assert.equal(scoreRun(SPEC, neg, trace({messages: [[['Skill', {skill: 'review-and-remediation'}]]]}), {level: R}).overapplication, true);
  assert.equal(scoreRun(SPEC, neg, trace({messages: [[]], subtype: 'success', isError: false, text: 'PATCH'}), {level: R}).markers, true);
});

test('replacements: planned reps per case (brief 4, negatives 2); the k-th failure is replaced by planned+k', () => {
  const runs = selectCounted([
    {condition: 'RSA', case: 'neg-1', run: 1, failure: 'x'}, {condition: 'RSA', case: 'neg-1', run: 2}, {condition: 'RSA', case: 'neg-1', run: 3},
    {condition: 'RSA', case: 'brief', run: 2, failure: 'x'}, {condition: 'RSA', case: 'brief', run: 5}, {condition: 'RSA', case: 'brief', run: 3},
  ], (c) => (c === 'brief' ? 4 : 2));
  const by = (c, r) => runs.find((x) => x.case === c && x.run === r);
  assert.equal(by('neg-1', 1).replacedBy, 3); assert.equal(by('neg-1', 3).counted, true);
  assert.equal(by('brief', 2).replacedBy, 5); assert.equal(by('brief', 5).replaces, 2);
});

test('main effects are differences of unweighted means of cell rates; a cell without a valid trial is not analysed', () => {
  const sums = {};
  for (const [id, c] of Object.entries(CONDS.cells)) {
    const k = c.tools === 'R' ? 4 : c.tools === 'W' ? 1 : 0;
    sums[id] = {cell: id, valid: 4, bodyRead2: c.fixture === 'D' ? Math.max(0, k - 1) : k};
  }
  const m = mainEffects(sums, CONDS);
  assert.equal(m.analysed, true);
  assert.equal(m.levels.tools.R.meanOfCellRates, 0.875); assert.equal(m.levels.tools.W.meanOfCellRates, 0.125); assert.equal(m.levels.tools.X.meanOfCellRates, 0);
  assert.equal(m.effects['tools W-R'], -0.75); assert.equal(m.effects['fixture D-A'], -0.1667); assert.equal(m.effects['prompt G-S'], 0);
  assert.equal(m.levels.tools.R.pooled, '14/16');
  assert.equal(m.twoWay['tools x fixture'].R.D, 0.75);
  sums.XGD.valid = 0;
  assert.equal(mainEffects(sums, CONDS).analysed, false);
});

test('summary per cell and completion: complete only with every planned trial; cap-reached needs no late probe', () => {
  const runs = [{condition: 'RSA', case: 'brief', run: 1, expect: 'asc', bodyRead2: true, bodyRead1: true, reach2: true, counted: true},
    {condition: 'RSA', case: 'brief', run: 2, expect: 'asc', bodyRead2: false, reach2: true, counted: true}, {condition: 'RSA', case: 'neg-1', run: 1, expect: null, overapplication: true, counted: true}];
  const s = summarizeCell(runs, 'RSA');
  assert.deepEqual([s.valid, s.bodyRead2, s.perRun, s.negatives.overapplication], [2, 1, '1E', 1]);
  const all = new Set(plannedTrials().map((t) => t.name));
  assert.equal(completionStatus({runs: [], reserved: all, reservations: [], spentUsd: 3, budget: CONDS.budget}).basis, 'complete');
  const some = new Set([...all].slice(0, 10));
  const res = [...some].map((trial, seq) => ({trial, seq}));
  assert.equal(completionStatus({runs: [], reserved: some, reservations: res, spentUsd: 3, budget: CONDS.budget}).basis, null);
  assert.equal(completionStatus({runs: [], reserved: some, reservations: res, spentUsd: 5.8, budget: CONDS.budget}).basis, 'cap-reached');
  assert.equal(completionStatus({runs: [], reserved: some, reservations: [...res, {trial: 'XSA-probe-1', seq: 10}], spentUsd: 5.8, budget: CONDS.budget}).basis, null);
});

test('probe approval: the committed placeholder refuses; a filled but uncommitted record refuses', (t) => {
  assert.match(approvalProblems().join(), /does not record the owner approval/);
  const d = tmp(t);
  fs.mkdirSync(path.join(d, 'results'));
  spawnSync('git', ['init', '-q'], {cwd: d});
  fs.writeFileSync(path.join(d, 'results/probe-approval.json'), JSON.stringify({ownerConfirmed: true, at: '2026-11-26', reference: 'https://example.invalid/x'}));
  assert.deepEqual(approvalProblems(d), ['results/probe-approval.json is not committed']);
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], {cwd: d});
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'a'], {cwd: d});
  assert.deepEqual(approvalProblems(d), []);
});

test('probe gate: planned trials need a passing comparison of all three probe cells', (t) => {
  const d = tmp(t);
  assert.match(probeGateProblems(d).join(), /missing/);
  fs.writeFileSync(path.join(d, 'probe-compare.json'), JSON.stringify({pass: true, conditions: ['RSA', 'WSA']}));
  assert.match(probeGateProblems(d).join(), /covers RSA,WSA/);
  fs.writeFileSync(path.join(d, 'probe-compare.json'), JSON.stringify({pass: false, conditions: ['XSA', 'RSA', 'WSA']}));
  assert.match(probeGateProblems(d).join(), /did not pass/);
  fs.writeFileSync(path.join(d, 'probe-compare.json'), JSON.stringify({pass: true, conditions: ['XSA', 'RSA', 'WSA']}));
  assert.deepEqual(probeGateProblems(d), []);
});

test('fixture D: source files must have the pinned sha256; the install record must be the cell\'s fixture', (t) => {
  const d = tmp(t);
  assert.deepEqual(writeSources(d, 'D'), ['BRIEF.md', 'FONTS.md', 'data.json']);
  assert.equal(fs.existsSync(path.join(d, 'CLAUDE.md')), false, 'D has no CLAUDE.md before the install');
  const changed = JSON.parse(JSON.stringify(CONDS)); changed.fixtures.D.files['BRIEF.md'].sha256 = '0'.repeat(64);
  assert.throws(() => writeSources(tmp(t), 'D', changed), /differs from the sha256/);
  const a = tmp(t);
  assert.ok(writeSources(a, 'A').includes('CLAUDE.md'));
  assert.equal(fs.readFileSync(path.join(a, 'CLAUDE.md'), 'utf8'), CONDS.fixtures.A.baseClaudeMd);
  const p = installProblems({fixture: 'A', pinned: true, source: 'release', released: true, install: {tarballSha256: pinned().assetSha256}}, a, cellOf('WGD'));
  assert.ok(p.some((x) => /fixture A, not D/.test(x)));
});

// --- probe-check per level ---
const ASC = ['asc', 'contract-enforcement', 'decision-ownership', 'engineering-judgment', 'estimate-and-scope', 'execution-recovery', 'migration-assurance', 'project-foundation', 'research-to-implementation', 'review-and-remediation', 'security-evidence', 'subagent-model-selection', 'tracker-issue-writing', 'user-journey-acceptance', 'verification-optimization', 'work-coordination'];
const HM = '/h/asc1820-home-marker.txt', RM = '/r/.agent-skill-chain/local/asc1820-repo-marker.txt';
const SENT = {trial: '/t/X/outside-write-probe.txt', repo: '/r/.agent-skill-chain/local/asc1820-write-probe.txt'};
function probeTrace({tools, mode, extra = []}) {
  const lines = [{type: 'system', subtype: 'init', cwd: '/t/X/work', tools, permissionMode: mode, mcp_servers: [], plugins: [], skills: [...ASC, 'dataviz'], model: 'm'}];
  for (const [name, input, err, content = err ? 'denied' : 'x'] of [['Read', {file_path: HM}, true], ['Read', {file_path: RM}, true], ...extra]) {
    const id = `p${++n}`;
    lines.push({type: 'assistant', message: {id: `m${id}`, content: [{type: 'tool_use', id, name, input}]}});
    lines.push({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: id, is_error: err, content}]}});
  }
  const text = `CLAUDE.md 最初の行: ユーザー管理API\nこのプロジェクトでASCを使う開発の…\nDESC asc: ascの説明。\nDESC user-journey-acceptance: user-journey-acceptanceの説明。\nGIT: Update project files | Install ASC | initial`;
  lines.push({type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.1});
  return lines.map((l) => JSON.stringify(l)).join('\n');
}
const probeBase = (cell, tr, o = {}) => ({trace: tr, debug: 'Loading /t/X/work/CLAUDE.md', stderr: '', hookLog: null, work: '/t/X/work', trialDir: '/t/X', condition: cell,
  ascSkills: Object.fromEntries(ASC.map((s) => [s, `${s}の説明。`])), baseFirstLine: '# ユーザー管理API', forbiddenTexts: [], ownerLines: [], ownerSkills: [], markerPaths: [HM, RM], tokens: ['TH', 'TR'],
  realHome: '/h', repoRoot: '/r', hostInstallDir: '/opt/claude', installProblems: [], sentinels: SENT, sentinelExists: {trial: false, repo: false}, insideExists: true, ...o});
const W_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'];
const writeOut = ['Write', {file_path: SENT.trial, content: 'probe'}, true];
const bashSteps = (curl = ['000', true]) => [['Bash', {command: `echo probe > ${INSIDE_FILE}`}, false], ['Bash', {command: `cat ${HM}`}, true], ['Bash', {command: `cat ${RM}`}, true],
  ['Bash', {command: `touch ${SENT.trial}`}, true], ['Bash', {command: `touch ${SENT.repo}`}, true], ['Bash', {command: `curl -sS -m 10 -o /dev/null -w '%{http_code}' ${NETWORK_URL}`}, curl[1], curl[0]]];

test('probe-check R: the level\'s tools and permission mode pass; any other set fails', () => {
  const ok = checkProbe(probeBase('RSA', probeTrace({tools: ['Read', 'Glob', 'Grep', 'Skill'], mode: 'default'})));
  assert.equal(ok.pass, true, JSON.stringify(Object.entries(ok.checks).filter(([, c]) => !c.pass)));
  assert.equal(checkProbe(probeBase('RSA', probeTrace({tools: W_TOOLS, mode: 'default'}))).checks.tools.pass, false);
  assert.equal(checkProbe(probeBase('RSA', probeTrace({tools: ['Read', 'Glob', 'Grep', 'Skill'], mode: 'acceptEdits'}))).checks.permissionMode.pass, false);
});

test('probe-check W: the outside Write must be attempted and refused, and no sentinel file may exist', () => {
  const ok = checkProbe(probeBase('WSA', probeTrace({tools: W_TOOLS, mode: 'acceptEdits', extra: [writeOut]})));
  assert.equal(ok.pass, true, JSON.stringify(Object.entries(ok.checks).filter(([, c]) => !c.pass)));
  assert.equal(checkProbe(probeBase('WSA', probeTrace({tools: W_TOOLS, mode: 'acceptEdits'}))).checks.outsideWriteAttempted.pass, false);
  assert.equal(checkProbe(probeBase('WSA', probeTrace({tools: W_TOOLS, mode: 'acceptEdits', extra: [['Write', {file_path: SENT.trial}, false, 'File created']]}))).checks.outsideWriteRefused.pass, false);
  assert.equal(checkProbe(probeBase('WSA', probeTrace({tools: W_TOOLS, mode: 'acceptEdits', extra: [writeOut]}), {sentinelExists: {trial: true, repo: false}})).checks.sentinelsAbsent.pass, false);
});

test('probe-check X: every Bash step attempted, the write inside work/ done, no HTTP status, no token, no sentinel', () => {
  const tools = [...W_TOOLS, 'Bash'];
  const good = probeTrace({tools, mode: 'acceptEdits', extra: [writeOut, ...bashSteps()]});
  const ok = checkProbe(probeBase('XSA', good));
  assert.equal(ok.pass, true, JSON.stringify(Object.entries(ok.checks).filter(([, c]) => !c.pass)));
  assert.equal(checkProbe(probeBase('XSA', good, {insideExists: false})).checks.sandboxInsideWrite.pass, false, 'settings not applied');
  assert.equal(checkProbe(probeBase('XSA', probeTrace({tools, mode: 'acceptEdits', extra: [writeOut, ...bashSteps(['200', false])]}))).checks.networkBlocked.pass, false);
  assert.equal(checkProbe(probeBase('XSA', probeTrace({tools, mode: 'acceptEdits', extra: [writeOut, ...bashSteps().slice(0, 3)]}))).checks.bashStepsAttempted.pass, false);
  const leaked = probeTrace({tools, mode: 'acceptEdits', extra: [writeOut, ...bashSteps(), ['Bash', {command: `cat ${HM}`}, false, 'TH']]});
  assert.equal(checkProbe(probeBase('XSA', leaked)).checks.markerTokensAbsent.pass, false);
  assert.equal(checkProbe(probeBase('XSA', good, {sentinelExists: {trial: false, repo: true}})).checks.sentinelsAbsent.pass, false);
  assert.deepEqual(writeAndBashChecks(probeBase('RSA', good), parseTrace(good), 'R'), {});
  // The debug log may name the repository only on the probe's own sentinel or marker lines.
  assert.equal(checkProbe(probeBase('XSA', good, {debug: `Bash: touch ${SENT.repo}`})).checks.noRealHomeOrRepoInDebug.pass, true);
  assert.equal(checkProbe(probeBase('XSA', good, {debug: 'read /r/CLAUDE.md'})).checks.noRealHomeOrRepoInDebug.pass, false);
});

test('probe compare: tools may differ between the levels, every other session fact must not', () => {
  const r = (condition, o = {}) => ({condition, pass: true, nonAscSkills: ['dataviz'], builtinPlugins: [], gitLine: 'Update project files | Install ASC | initial', model: 'm', tools: [condition], ...o});
  assert.deepEqual(compareProbes([r('RSA'), r('WSA'), r('XSA')]), {pass: true, conditions: ['RSA', 'WSA', 'XSA'], differ: []});
  assert.deepEqual(compareProbes([r('RSA'), r('WSA', {nonAscSkills: []}), r('XSA')]).differ, ['nonAscSkills']);
  assert.equal(compareProbes([r('RSA'), r('WSA'), r('XSA', {pass: false})]).pass, false);
});

test('collect: a row records the cell, its factors and the init facts; a directory without a reservation is refused', (t) => {
  const root = tmp(t);
  const name = 'WGD-brief-1', dir = path.join(root, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'trace.jsonl'), `${JSON.stringify({type: 'system', subtype: 'init', cwd: `${dir}/work`, tools: W_TOOLS})}\n`);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({costUsd: 0.04, maxTurns: 2, initTools: W_TOOLS, initPermissionMode: 'acceptEdits', resultSubtype: 'error_max_turns', numTurns: 2, settingsSha256: 'a'}));
  const row = collectTrial(root, name, {conds: CONDS.cells}).row;
  assert.deepEqual([row.cell, row.tools, row.prompt, row.fixture, row.maxTurns, row.initPermissionMode, row.resultSubtype], ['WGD', 'W', 'G', 'D', 2, 'acceptEdits', 'error_max_turns']);
  const l = path.join(root, 'ledger.jsonl');
  ledger.create(l);
  assert.throws(() => buildCollection(root, {ledger: l}), /without a reservation/);
});

test('replacement plan: a failed negative trial (rep 1) is replaced by rep 3 after every planned trial', (t) => {
  const root = tmp(t);
  const reserved = new Set(plannedTrials().map((x) => x.name));
  const settled = new Map();
  // Every reserved trial without a settlement is a failure ("not settled"); one settlement-free negative is enough here.
  const plan = replacementPlan({runsRoot: root, reserved: new Set(['RSA-neg-1-1']), settled});
  assert.deepEqual(plan.map((x) => x.name), ['RSA-neg-1-3']);
  assert.match(orderRefusal({condition: 'RSA', caseId: 'neg-1', rep: '3', reserved, settled, runsRoot: root}) ?? '', /not the next required replacement \(next: RSA-brief-5\)/);
});
