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
import {parseTrace, scoreRun, selectCounted, mainEffects, summarizeCell, initProblems, bashArgs, bashTarget} from './score.mjs';
import {plannedTrials, orderProblems, orderRefusal, probeRefusal, completionStatus, replacementPlan, loadOrder, probeCompareProblems} from './order.mjs';
import {flags, isolationSettings, promptFor, cellOf, probePrompt, probeGateProblems, installProblems, sentinelPaths, probeSteps, probeContext, INSIDE_FILE, NETWORK_URL} from './run-trial.mjs';
import {approvalProblems} from './markers.mjs';
import {writeSources, pinned} from './make-fixture.mjs';
import {checkProbe, compareProbes, probeStepChecks, refusalEvidence, isProbeStepLine, stepPathsOf} from './probe-check.mjs';
import {FIXED, dropViolations, refixAfterMeasurement, digests} from './fixation.mjs';
import {applyDrop, loadConditions} from './apply-condition.mjs';
import {cellRuleReasons} from './analyze.mjs';
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

const CTX = {homeMarker: '/h/m', repoMarker: '/r/l/m', trialDir: '/x/runs/XSA-probe-1', runsRoot: '/x/runs', fixture: '/x/fixture-A', ledgerDir: '/y/ledger',
  sentinels: {trial: '/x/runs/XSA-probe-1/outside-write-probe.txt', repo: '/r/.agent-skill-chain/local/asc1820-write-probe.txt'}};

test('probe steps (review M2/L4): counts match conditions.json probeSteps and fit probeMaxTurns; X covers every isolation boundary', () => {
  for (const lv of ['R', 'W', 'X']) {
    assert.equal(probeSteps(lv, CTX).length, CONDS.probeSteps[lv], lv);
    assert.ok(CONDS.probeSteps[lv] + 2 <= CONDS.probeMaxTurns, `${lv} fits probeMaxTurns`);
  }
  const ids = (lv) => probeSteps(lv, CTX).map((st) => st.id);
  assert.deepEqual(ids('R'), ['readHomeMarker', 'readRepoMarker', 'globRepoMarkerDir', 'grepHomeMarker']);
  assert.deepEqual(ids('W').slice(4), ['writeTrialDir', 'writeRepo']);
  const x = probeSteps('X', CTX);
  const cmd = Object.fromEntries(x.filter((st) => st.tool === 'Bash').map((st) => [st.id, `${st.command} [${st.expect}]`]));
  assert.deepEqual(cmd, {insideWrite: `echo probe > ${INSIDE_FILE} [ok]`, insideCatClaudeMd: 'cat CLAUDE.md [ok]', insideGitStatus: 'git status --short --branch [info]',
    catHomeMarker: 'cat /h/m [refused]', catRepoMarker: 'cat /r/l/m [refused]', lsRunsRoot: 'ls /x/runs [refused]', catTrialSettings: 'cat /x/runs/XSA-probe-1/settings.json [refused]',
    lsFixture: 'ls /x/fixture-A [refused]', catFixtureClaudeMd: 'cat /x/fixture-A/CLAUDE.md [refused]', lsLedgerDir: 'ls /y/ledger [refused]',
    touchTrialDir: `touch ${CTX.sentinels.trial} [refused]`, touchRepo: `touch ${CTX.sentinels.repo} [refused]`, network: `curl -sS -m 10 -o /dev/null -w '%{http_code}' ${NETWORK_URL} [refused]`});
  // The prompt lists every step of the level, numbered, and nothing of a higher level.
  assert.doesNotMatch(probePrompt('R', CTX), /Write|Bash/);
  assert.match(probePrompt('W', CTX), /\(6\) Writeで \/r\/\.agent-skill-chain\/local\/asc1820-write-probe\.txt/); assert.doesNotMatch(probePrompt('W', CTX), /Bash/);
  const px = probePrompt('X', CTX);
  for (const st of x) assert.ok(px.includes(st.command ?? st.path), st.id);
  assert.match(px, /次の19個の操作/);
  assert.deepEqual(sentinelPaths({dir: '/t', repo: '/r'}), {trial: '/t/outside-write-probe.txt', repo: '/r/.agent-skill-chain/local/asc1820-write-probe.txt'});
  const c = probeContext({dir: '/x/runs/XSA-probe-1', runsRoot: '/x/runs', fixture: '/x/fixture-A', ledger: '/y/ledger/l.jsonl', homeMarker: '/h/m', repoMarker: '/r/l/m', repo: '/r'});
  assert.deepEqual(c, CTX);
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

test('score (review M1): a Bash read of the body counts in bodyRead2 and in bodyReadBash2; a failed Bash does not; first tools keep the Bash path', () => {
  const X = CONDS.toolLevels.X;
  const xt = (msgs) => trace({messages: msgs, tools: X.tools.split(','), mode: 'acceptEdits'});
  const a = scoreRun(SPEC, brief, xt([[['Read', {file_path: 'docs/BRIEF.md'}], ['Bash', {command: `cat ${BODY}`}]]]), {level: X});
  assert.deepEqual([a.failure, a.bodyRead1, a.bodyRead2, a.bodyReadBash1, a.bodyReadBash2], [undefined, true, true, true, true]);
  assert.deepEqual(a.firstTools, [{name: 'Read', target: 'docs/BRIEF.md'}, {name: 'Bash', target: `cat ${BODY}`}]);
  const abs = scoreRun(SPEC, brief, xt([[['Glob', {pattern: '**/*'}]], [['Bash', {command: `sed -n '1,80p' "/tmp/w/${BODY}" && head -5 docs/BRIEF.md`}]]]), {level: X});
  assert.deepEqual([abs.bodyRead1, abs.bodyRead2, abs.bodyReadBash2], [false, true, true]);
  assert.equal(abs.secondTools[0].target, `sed -n '1,80p' ${BODY} && head -5 docs/BRIEF.md`);
  const failed = scoreRun(SPEC, brief, xt([[['Bash', {command: `cat ${BODY}`}, true]]]), {level: X});
  assert.deepEqual([failed.bodyRead2, failed.bodyReadBash2], [false, false]);
  const viaRead = scoreRun(SPEC, brief, xt([[['Read', {file_path: BODY}]]]), {level: X});
  assert.deepEqual([viaRead.bodyRead2, viaRead.bodyReadBash2], [true, false]);
  const other = scoreRun(SPEC, brief, xt([[['Bash', {command: 'ls .agent-skill-chain/skills/asc'}], ['Bash', {command: 'cat /etc/hosts'}]]]), {level: X});
  assert.equal(other.bodyRead2, false);
  assert.deepEqual(other.firstTools.map((x) => x.target), ['ls .agent-skill-chain/skills/asc', 'cat <outside>']);
  assert.deepEqual(bashArgs(`cat "${BODY}" | head -n 3; echo ok`), ['cat', BODY, 'head', '3', 'echo', 'ok']);
  assert.equal(bashTarget('curl https://example.com/x', '/tmp/w'), 'curl https://example.com/x');
  const s = summarizeCell([{condition: 'XSA', case: 'brief', run: 1, expect: 'asc', ...a, counted: true}, {condition: 'XSA', case: 'brief', run: 2, expect: 'asc', ...viaRead, counted: true}], 'XSA');
  assert.deepEqual([s.bodyRead2, s.bodyReadBash2], [2, 1]);
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

// A ledger with settled probes whose trace/meta files are in the runs root (as run-trial writes them).
function probeLedger(t, names) {
  const d = tmp(t);
  const l = path.join(d, 'ledger.jsonl');
  ledger.create(l);
  const probes = {};
  for (const name of names) {
    fs.mkdirSync(path.join(d, name));
    fs.writeFileSync(path.join(d, name, 'trace.jsonl'), `{"trial":"${name}"}\n`);
    fs.writeFileSync(path.join(d, name, 'meta.json'), JSON.stringify({costUsd: 0.1}));
    const r = ledger.reserve(l, name, 0.6);
    const sh = (f) => ledger.fileSha256(path.join(d, name, f));
    ledger.settle(l, r.id, name, 0.1, {exit: 0, traceSha256: sh('trace.jsonl'), metaSha256: sh('meta.json')});
    probes[name] = {trial: name, traceSha256: sh('trace.jsonl'), metaSha256: sh('meta.json')};
  }
  return {d, l, probes};
}

test('probe gate (review L2): the comparison must pass, cover every probe cell and be bound to the latest settled probes in the ledger', (t) => {
  const {d, l, probes} = probeLedger(t, ['RSA-probe-1', 'WSA-probe-1', 'XSA-probe-1']);
  assert.match(probeGateProblems(d, CONDS, l).join(), /missing/);
  const write = (o) => fs.writeFileSync(path.join(d, 'probe-compare.json'), JSON.stringify(o));
  const entry = (cell, o = {}) => ({condition: cell, pass: true, ...probes[`${cell}-probe-1`], ...o});
  write({pass: true, dropped: null, probes: [entry('RSA'), entry('WSA'), entry('XSA')]});
  assert.deepEqual(probeGateProblems(d, CONDS, l), []);
  // A hand-written comparison without the ledger binding, or with another sha256, is refused.
  write({pass: true, conditions: ['RSA', 'WSA', 'XSA']});
  assert.match(probeGateProblems(d, CONDS, l).join(), /covers nothing/);
  write({pass: true, dropped: null, probes: [entry('RSA'), entry('WSA'), entry('XSA', {traceSha256: '0'.repeat(64)})]});
  assert.match(probeGateProblems(d, CONDS, l).join(), /XSA-probe-1: the compared result is not bound/);
  write({pass: true, dropped: null, probes: [entry('RSA'), entry('WSA')]});
  assert.match(probeGateProblems(d, CONDS, l).join(), /covers RSA,WSA, not RSA,WSA,XSA/);
  write({pass: false, dropped: null, probes: [entry('RSA'), entry('WSA'), entry('XSA', {pass: false})]});
  assert.match(probeGateProblems(d, CONDS, l).join(), /did not pass.*XSA probe did not pass/);
  // A trace changed after the settlement is refused.
  write({pass: true, dropped: null, probes: [entry('RSA'), entry('WSA'), entry('XSA')]});
  fs.appendFileSync(path.join(d, 'XSA-probe-1', 'trace.jsonl'), 'x');
  assert.match(probeGateProblems(d, CONDS, l).join(), /settled trial XSA-probe-1: trace\.jsonl .*differs/);
  // An older probe of a cell is refused once a re-run exists.
  const two = probeLedger(t, ['RSA-probe-1', 'WSA-probe-1', 'XSA-probe-1', 'XSA-probe-2']);
  assert.match(probeCompareProblems({pass: true, dropped: null, probes: ['RSA', 'WSA', 'XSA'].map((c) => ({condition: c, pass: true, ...two.probes[`${c}-probe-1`]}))}, {ledgerFile: two.l, runsRoot: two.d, conds: CONDS}).join(), /XSA-probe-1 is not the latest probe/);
});

test('drop of X (review L1): pre-written 8-cell plan, only after XSA-probe-2 failed, bound comparison, before any planned trial', (t) => {
  const dropped = applyDrop(CONDS, 'X');
  assert.deepEqual(Object.keys(dropped.cells).sort(), ['RGA', 'RGD', 'RSA', 'RSD', 'WGA', 'WGD', 'WSA', 'WSD']);
  assert.deepEqual([dropped.probeCells, dropped.rawProbeCells, dropped.droppedCells.sort()], [['RSA', 'WSA'], ['RSA', 'WSA', 'XSA'], ['XGA', 'XGD', 'XSA', 'XSD']]);
  assert.throws(() => applyDrop(CONDS, 'W'), /may not be dropped/);
  assert.equal(applyDrop(CONDS, null), CONDS);
  assert.deepEqual(loadConditions(), CONDS, 'no drop is recorded in results/fixation.json');
  const planned = plannedTrials(ORDER, dropped, SPEC);
  assert.equal(planned.length, 44); assert.equal(planned.filter((x) => x.case === 'brief').length, 32);
  assert.ok(planned.every((x) => !x.condition.startsWith('X')));
  assert.deepEqual(orderProblems(ORDER, SPEC, dropped), []);
  assert.match(probeRefusal({condition: 'XSA', rep: '1', reserved: new Set(), conds: dropped}), /not a probe cell/);
  // Main effects over the 8 cells: only W-R for the tools.
  const sums = Object.fromEntries(Object.keys(dropped.cells).map((id) => [id, {cell: id, valid: 4, bodyRead2: id.startsWith('R') ? 4 : 2}]));
  const m = mainEffects(sums, dropped);
  assert.deepEqual(Object.keys(m.effects), ['tools W-R', 'prompt G-S', 'fixture D-A']);
  assert.equal(m.effects['tools W-R'], -0.5); assert.equal(m.droppedLevel, 'X');
  assert.deepEqual(Object.keys(m.twoWay['tools x prompt']), ['R', 'W']);
  // The comparison for the drop: X failed, R and W passed, bound to the ledger.
  const {d, l, probes} = probeLedger(t, ['RSA-probe-1', 'WSA-probe-1', 'XSA-probe-1', 'XSA-probe-2']);
  const res = (cell, rep, pass) => ({condition: cell, pass, ...probes[`${cell}-probe-${rep}`], nonAscSkills: [], builtinPlugins: [], gitLine: 'a', model: 'm'});
  const cmp = compareProbes([res('RSA', 1, true), res('WSA', 1, true), res('XSA', 2, false)], {drop: 'X', conds: CONDS});
  assert.equal(cmp.pass, true); assert.equal(cmp.dropped, 'X');
  assert.equal(compareProbes([res('RSA', 1, true), res('WSA', 1, true), res('XSA', 2, true)], {drop: 'X', conds: CONDS}).pass, false, 'a passing X is not dropped');
  assert.equal(compareProbes([res('RSA', 1, true), res('WSA', 1, false), res('XSA', 2, false)], {drop: 'X', conds: CONDS}).pass, false, 'a failing W stops the measurement');
  assert.throws(() => compareProbes([], {drop: 'R', conds: CONDS}), /may not be dropped/);
  fs.writeFileSync(path.join(d, 'probe-compare.json'), JSON.stringify(cmp));
  assert.deepEqual(probeGateProblems(d, dropped, l), []);
  assert.match(probeGateProblems(d, CONDS, l).join(), /drops X, the fixation drops no level/);
  // drop-level: refused without the re-run, after a planned trial, or with a changed file; allowed otherwise.
  const fxHere = {records: [{stage: 'stage 1', fixedAtCommit: 'c', at: '2026-01-01T00:00:00.000Z', files: digests(), ledgerId: ledger.ledgerId(l)}]};
  assert.deepEqual(dropViolations(fxHere, l, 'X', {runsRoot: d}), []);
  assert.match(dropViolations(fxHere, l, 'W', {runsRoot: d}).join(), /may not be dropped/);
  assert.match(dropViolations({...fxHere, records: [...fxHere.records, {dropLevel: 'X'}]}, l, 'X', {runsRoot: d}).join(), /already dropped/);
  const changed = {...fxHere, records: [{...fxHere.records[0], files: {...fxHere.records[0].files, 'cases.json': '0'}}]};
  assert.match(dropViolations(changed, l, 'X', {runsRoot: d}).join(), /fixed files changed \(cases\.json\)/);
  const one = probeLedger(t, ['RSA-probe-1', 'WSA-probe-1', 'XSA-probe-1']);
  fs.writeFileSync(path.join(one.d, 'probe-compare.json'), JSON.stringify(compareProbes([res('RSA', 1, true), res('WSA', 1, true), {...res('XSA', 1, false), ...one.probes['XSA-probe-1']}].map((r) => ({...r, ...(one.probes[r.trial] ?? {})})), {drop: 'X', conds: CONDS})));
  assert.match(dropViolations({...fxHere, records: [{...fxHere.records[0], ledgerId: ledger.ledgerId(one.l)}]}, one.l, 'X', {runsRoot: one.d}).join(), /XSA-probe-2 is not settled/);
  ledger.reserve(l, 'RSA-brief-1', 0.3);
  assert.match(dropViolations(fxHere, l, 'X', {runsRoot: d}).join(), /measurement trials exist/);
  // A drop record later than the first planned reservation is refused by run-trial (as a refix).
  assert.equal(refixAfterMeasurement({records: [{dropLevel: 'X', at: '9999-01-01T00:00:00.000Z'}]}, l).length, 1);
});

test('failure rule (review L3): one failed replacement in a cell (1/4 = 25%) is analysed, two are not; negatives do not count', () => {
  const cell = (failures, neg = 0) => ({cell: 'RSA', runs: 4, failures, replacementsMissing: 0, negatives: {failures: neg}});
  assert.deepEqual(cellRuleReasons({RSA: cell(1, 2)}), []);
  assert.match(cellRuleReasons({RSA: cell(2)}).join(), /RSA: 2 of 4 counted brief trials failed after replacement \(more than 1\)/);
  assert.match(cellRuleReasons({RSA: {...cell(0), replacementsMissing: 1}}).join(), /without the mandatory replacement/);
  // A failed replacement stays counted as a failure (the cell's rate is over its valid trials).
  const runs = selectCounted([{condition: 'RSA', case: 'brief', run: 1, expect: 'asc', failure: 'x'}, ...[2, 3, 4].map((run) => ({condition: 'RSA', case: 'brief', run, expect: 'asc', bodyRead2: true})),
    {condition: 'RSA', case: 'brief', run: 5, expect: 'asc', failure: 'y'}], () => 4);
  const s = summarizeCell(runs, 'RSA');
  assert.deepEqual([s.runs, s.failures, s.valid, s.bodyRead2], [4, 1, 3, 3]);
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
const PCTX = {homeMarker: '/h/asc1820-home-marker.txt', repoMarker: '/r/.agent-skill-chain/local/asc1820-repo-marker.txt', trialDir: '/t/X', runsRoot: '/t', fixture: '/f/fixture-A', ledgerDir: '/y/ledger',
  sentinels: {trial: '/t/X/outside-write-probe.txt', repo: '/r/.agent-skill-chain/local/asc1820-write-probe.txt'}};
const HM = PCTX.homeMarker, RM = PCTX.repoMarker;
const SENT = PCTX.sentinels;
// The tool call of a probe step and the result the isolation should give it.
const stepCall = (st) => (st.tool === 'Bash' ? {command: st.command} : st.tool === 'Glob' || st.tool === 'Grep' ? {pattern: st.pattern, path: st.path} : {file_path: st.path, ...(st.tool === 'Write' ? {content: 'probe'} : {})});
const goodResult = (st) => (st.id === 'insideCatClaudeMd' ? [false, '# ユーザー管理API\n\nTypeScript'] : st.id === 'insideGitStatus' ? [false, '## master'] : st.id === 'network' ? [true, 'Exit code 56\n000']
  : st.expect === 'ok' ? [false, ''] : st.tool === 'Bash' ? [true, `Exit code 1\n${st.command.split(' ')[0]}: Operation not permitted`] : [true, 'Claude requested permissions to read, but you have not granted it yet.']);
const stepsFor = (lv) => probeSteps(lv, PCTX).map((st) => [st.tool, stepCall(st), ...goodResult(st)]);
function probeTrace({tools, mode, calls}) {
  const lines = [{type: 'system', subtype: 'init', cwd: '/t/X/work', tools, permissionMode: mode, mcp_servers: [], plugins: [], skills: [...ASC, 'dataviz'], model: 'm'}];
  for (const [name, input, err, content] of calls) {
    const id = `p${++n}`;
    lines.push({type: 'assistant', message: {id: `m${id}`, content: [{type: 'tool_use', id, name, input}]}});
    if (err !== 'missing') lines.push({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: id, is_error: err, content}]}});
  }
  const text = `CLAUDE.md 最初の行: ユーザー管理API\nこのプロジェクトでASCを使う開発の…\nDESC asc: ascの説明。\nDESC user-journey-acceptance: user-journey-acceptanceの説明。\nGIT: Update project files | Install ASC | initial`;
  lines.push({type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.1});
  return lines.map((l) => JSON.stringify(l)).join('\n');
}
const LEVEL_TOOLS = {R: ['Read', 'Glob', 'Grep', 'Skill'], W: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'], X: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'Bash']};
const W_TOOLS = LEVEL_TOOLS.W;
const cellLevel = {RSA: 'R', WSA: 'W', XSA: 'X'};
const ptrace = (cell, calls = stepsFor(cellLevel[cell]), o = {}) => probeTrace({tools: LEVEL_TOOLS[cellLevel[cell]], mode: cellLevel[cell] === 'R' ? 'default' : 'acceptEdits', calls, ...o});
const probeBase = (cell, tr, o = {}) => ({trace: tr, debug: 'Loading /t/X/work/CLAUDE.md', stderr: '', hookLog: null, work: '/t/X/work', trialDir: '/t/X', condition: cell,
  ascSkills: Object.fromEntries(ASC.map((s) => [s, `${s}の説明。`])), baseFirstLine: '# ユーザー管理API', forbiddenTexts: [], ownerLines: [], ownerSkills: [], markerPaths: [HM, RM], tokens: ['TH', 'TR'],
  realHome: '/h', repoRoot: '/r', hostInstallDir: '/opt/claude', installProblems: [], sentinels: SENT, sentinelExists: {trial: false, repo: false}, insideExists: true,
  steps: probeSteps(cellLevel[cell], PCTX), expectedSteps: CONDS.probeSteps[cellLevel[cell]], workClaudeMdFirstLine: '# ユーザー管理API', trialName: `${cell}-probe-1`, traceSha256: 'a', metaSha256: 'b', ...o});
const failing = (r) => JSON.stringify(Object.entries(r.checks).filter(([, c]) => !c.pass));
const without = (calls, i) => calls.filter((_, k) => k !== i);
const replaced = (calls, i, err, content) => calls.map((c, k) => (k === i ? [c[0], c[1], err, content] : c));

test('probe-check R: the level\'s tools and permission mode pass; any other set fails; Glob and Grep outside must be refused', () => {
  const ok = checkProbe(probeBase('RSA', ptrace('RSA')));
  assert.equal(ok.pass, true, failing(ok));
  assert.deepEqual([ok.trial, ok.traceSha256, ok.steps], ['RSA-probe-1', 'a', 4]);
  assert.equal(checkProbe(probeBase('RSA', probeTrace({tools: W_TOOLS, mode: 'default', calls: stepsFor('R')}))).checks.tools.pass, false);
  assert.equal(checkProbe(probeBase('RSA', probeTrace({tools: LEVEL_TOOLS.R, mode: 'acceptEdits', calls: stepsFor('R')}))).checks.permissionMode.pass, false);
  const globAllowed = checkProbe(probeBase('RSA', ptrace('RSA', replaced(stepsFor('R'), 2, false, 'asc1820-repo-marker.txt'))));
  assert.deepEqual(globAllowed.checks.probeStepsRefused.detail.withoutRefusalEvidence, ['globRepoMarkerDir']);
});

test('probe-check W: the Writes into the trial directory and the repository must be attempted and refused, and no sentinel file may exist', () => {
  const ok = checkProbe(probeBase('WSA', ptrace('WSA')));
  assert.equal(ok.pass, true, failing(ok));
  assert.deepEqual(checkProbe(probeBase('WSA', ptrace('WSA', without(stepsFor('W'), 5)))).checks.probeStepsAttempted.detail.missing, ['writeRepo']);
  assert.equal(checkProbe(probeBase('WSA', ptrace('WSA', replaced(stepsFor('W'), 4, false, 'File created')))).checks.probeStepsRefused.pass, false);
  assert.equal(checkProbe(probeBase('WSA', ptrace('WSA'), {sentinelExists: {trial: true, repo: false}})).checks.sentinelsAbsent.pass, false);
});

test('probe-check X: every step attempted with a result; refusals need positive evidence; work/ readable, git recorded', () => {
  const good = ptrace('XSA');
  const ok = checkProbe(probeBase('XSA', good));
  assert.equal(ok.pass, true, failing(ok));
  assert.deepEqual(ok.info.insideGitStatus, {attempted: 1, resultPresent: 1, ok: true, firstLine: '## master'});
  const calls = stepsFor('X');
  const at = (id) => probeSteps('X', PCTX).findIndex((st) => st.id === id);
  assert.equal(checkProbe(probeBase('XSA', good, {insideExists: false})).checks.sandboxInsideWrite.pass, false, 'settings not applied');
  // review M3: a missing result is a failure, never a pass.
  for (const id of ['catHomeMarker', 'lsLedgerDir', 'network', 'insideGitStatus']) {
    const r = checkProbe(probeBase('XSA', ptrace('XSA', replaced(calls, at(id), 'missing'))));
    assert.deepEqual(r.checks.probeStepResults.detail.withoutResult, [id], id); assert.equal(r.pass, false, id);
  }
  // A refusal needs evidence: a successful ls of the runs root, the fixture or the ledger directory fails.
  for (const id of ['lsRunsRoot', 'catTrialSettings', 'lsFixture', 'catFixtureClaudeMd', 'lsLedgerDir', 'touchRepo']) {
    assert.deepEqual(checkProbe(probeBase('XSA', ptrace('XSA', replaced(calls, at(id), false, 'a.txt')))).checks.probeStepsRefused.detail.withoutRefusalEvidence, [id], id);
  }
  assert.equal(checkProbe(probeBase('XSA', ptrace('XSA', replaced(calls, at('network'), false, '200')))).checks.networkBlocked.pass, false);
  assert.equal(checkProbe(probeBase('XSA', ptrace('XSA', replaced(calls, at('network'), false, '000')))).pass, true, 'curl printing 000 is refusal evidence');
  // allowRead of work/: cat CLAUDE.md must succeed and print the first line of work/CLAUDE.md.
  assert.equal(checkProbe(probeBase('XSA', ptrace('XSA', replaced(calls, at('insideCatClaudeMd'), true, 'cat: CLAUDE.md: Operation not permitted')))).checks.allowReadWork.pass, false);
  assert.equal(checkProbe(probeBase('XSA', ptrace('XSA', replaced(calls, at('insideCatClaudeMd'), false, 'something else')))).checks.allowReadWork.pass, false);
  // git status failing in the sandbox is recorded, not judged.
  const noGit = checkProbe(probeBase('XSA', ptrace('XSA', replaced(calls, at('insideGitStatus'), true, 'Exit code 128\nfatal: x'))));
  assert.equal(noGit.pass, true, failing(noGit)); assert.equal(noGit.info.insideGitStatus.ok, false);
  assert.equal(checkProbe(probeBase('XSA', ptrace('XSA', calls.slice(0, 9)))).checks.probeStepsAttempted.pass, false);
  const leaked = ptrace('XSA', [...calls, ['Bash', {command: `cat ${HM}`}, false, 'TH']]);
  assert.equal(checkProbe(probeBase('XSA', leaked)).checks.markerTokensAbsent.pass, false);
  assert.equal(checkProbe(probeBase('XSA', good, {sentinelExists: {trial: false, repo: true}})).checks.sentinelsAbsent.pass, false);
  assert.equal(checkProbe(probeBase('XSA', good, {expectedSteps: 18})).checks.probeStepsDefined.pass, false);
  assert.deepEqual(probeStepChecks(probeBase('RSA', good), parseTrace(good), 'R').checks.sandboxInsideWrite, undefined);
  // A Bash look-up of the Skill files is a look-up (the descriptions must come from the context).
  assert.equal(checkProbe(probeBase('XSA', ptrace('XSA', [['Bash', {command: 'cat .claude/skills/asc/SKILL.md'}, false, 'x'], ...calls]))).checks.descriptionsInContext.pass, false);
  // The debug log may name the repository, the fixture or the ledger directory only on the probe's own step lines.
  assert.equal(checkProbe(probeBase('XSA', good, {debug: `Bash: touch ${SENT.repo}`})).checks.noRealHomeOrRepoInDebug.pass, true);
  assert.equal(checkProbe(probeBase('XSA', good, {debug: 'Bash: cat /f/fixture-A/CLAUDE.md'})).checks.debugPathsInsideTrial.pass, true);
  assert.equal(checkProbe(probeBase('XSA', good, {debug: 'read /f/fixture-A/CLAUDE.md and /t/RSA-probe-1/home/.claude/CLAUDE.md'})).checks.debugPathsInsideTrial.pass, false);
  assert.equal(checkProbe(probeBase('XSA', good, {debug: 'read /r/CLAUDE.md'})).checks.noRealHomeOrRepoInDebug.pass, false);
  assert.equal(isProbeStepLine('ls /t', stepPathsOf(probeSteps('X', PCTX))), true);
  assert.equal(isProbeStepLine('ls /t/RSA-probe-1', stepPathsOf(probeSteps('X', PCTX))), false);
  assert.equal(refusalEvidence({id: 'x'}, null), false);
});

test('probe compare: tools may differ between the levels, every other session fact must not', () => {
  const r = (condition, o = {}) => ({condition, trial: `${condition}-probe-1`, traceSha256: 't', metaSha256: 'm', pass: true, nonAscSkills: ['dataviz'], builtinPlugins: [], gitLine: 'Update project files | Install ASC | initial', model: 'm', tools: [condition], ...o});
  const c = compareProbes([r('RSA'), r('WSA'), r('XSA')]);
  assert.deepEqual([c.pass, c.conditions, c.differ, c.dropped], [true, ['RSA', 'WSA', 'XSA'], [], null]);
  assert.deepEqual(c.probes[2], {condition: 'XSA', trial: 'XSA-probe-1', pass: true, traceSha256: 't', metaSha256: 'm'});
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
