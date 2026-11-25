// Tests for the #1815 harness parts that are new or changed relative to #1807/#1814. No model call, no docker.
// Run: node --test docs/evidence/1815-design-judgment/harness/harness.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tarballProblems, installedProblems, packageDiff, loadJson, sha256, READ_TRIGGER_MARK, ev} from './pairing.mjs';
import {readRecord} from './reads.mjs';
import {claudeArgs, dockerPlan, childEnv, initProblems, scrub, EXPECTED_INIT_TOOLS, LABEL, imageProblems} from './run-trial.mjs';
import {positions, meanPositions, pairsSAboveB, spearman, direction, evaluatorCase, indicatorCase, caseDecision, overall, selectCounted, completeness, fixationProblemsForScoring, ledgerFacts, nameSetProblems, runConsistency, decide, thresholds} from './decide.mjs';
import {plannedTrials, orderRefusal, replacementPlan, countedTrials, generationFailure, orderProblems, loadOrder} from './order.mjs';
import {checkProbe, compareProbes, probeProblems, approvalProblems, probePrompt, probeRefusal} from './probe.mjs';
import {refixViolations} from './fixation.mjs';
import * as ledgerOps from '../../1814-skill-invocation/harness/ledger.mjs';
import {blindIds, makeRound, referencedAssets, copyDeliverable, blindPlacementProblems} from './make-blind.mjs';
import {guardProblems} from './rank-guard.mjs';
import {nextRankName, rankEntries, rankRounds, extractRanking} from './budget.mjs';
import {publishTrial, toolCalls} from './collect.mjs';
import {canReserve} from './budget.mjs';
import {FIXED, differences, digests} from './fixation.mjs';
import {clean} from './collect.mjs';
import {firstViewCommand} from './run-indicators.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'asc1815-test-'));
const release = loadJson('release.json'), conds = loadJson('conditions.json');

test('pairing: each condition accepts only its pinned tarball', () => {
  assert.deepEqual(tarballProblems(release, conds, 'B', release.B.assetSha256), []);
  assert.deepEqual(tarballProblems(release, conds, 'S', release.S.assetSha256), []);
  assert.match(tarballProblems(release, conds, 'B', release.S.assetSha256)[0], /pinned for condition S, not B/);
  assert.match(tarballProblems(release, conds, 'S', release.B.assetSha256)[0], /pinned for condition B, not S/);
  assert.match(tarballProblems(release, conds, 'S', 'f'.repeat(64))[0], /not pinned/);
  assert.match(tarballProblems(release, conds, 'X', release.B.assetSha256)[0], /unknown condition/);
});

test('pairing: the definitions pin a candidate packed from a commit and different references', () => {
  assert.equal(release.S.kind, 'candidate');
  assert.match(release.S.packedFromCommit, /^[0-9a-f]{40}$/);
  assert.notEqual(release.B.assetSha256, release.S.assetSha256);
  for (const rel of Object.keys(release.installedReferences.B)) assert.notEqual(release.installedReferences.B[rel], release.installedReferences.S[rel]);
  assert.deepEqual(Object.keys(conds.conditions).sort(), ['B', 'S']);
  assert.equal(conds.conditions.B.release, 'B');
  assert.equal(conds.conditions.S.release, 'S');
});

test('pairing: installed references and the CLAUDE.md block are checked', () => {
  const d = tmp();
  const fake = {installedReferences: {S: {'a/ref.md': sha256('S text')}}};
  fs.mkdirSync(path.join(d, 'a'));
  fs.writeFileSync(path.join(d, 'a/ref.md'), 'S text');
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), `${READ_TRIGGER_MARK}\ntext\n`);
  assert.deepEqual(installedProblems(fake, 'S', d), []);
  fs.writeFileSync(path.join(d, 'a/ref.md'), 'B text');
  assert.match(installedProblems(fake, 'S', d)[0], /differs/);
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), 'no block\n');
  assert.ok(installedProblems(fake, 'S', d).some((p) => /read-trigger/.test(p)));
  assert.match(installedProblems(fake, 'B', d)[0], /no installedReferences/);
});

test('pairing: packageDiff lists added, removed and changed files and skips prefixes', () => {
  const a = tmp(), b = tmp();
  for (const [r, t] of [['same.txt', 'x'], ['dir/changed.txt', 'a'], ['only-a.txt', 'a'], ['.git/x', '1']]) { fs.mkdirSync(path.dirname(path.join(a, r)), {recursive: true}); fs.writeFileSync(path.join(a, r), t); }
  for (const [r, t] of [['same.txt', 'x'], ['dir/changed.txt', 'b'], ['only-b.txt', 'b'], ['.git/x', '2']]) { fs.mkdirSync(path.dirname(path.join(b, r)), {recursive: true}); fs.writeFileSync(path.join(b, r), t); }
  assert.deepEqual(packageDiff(a, b, {skip: ['.git']}), ['dir/changed.txt', 'only-a.txt', 'only-b.txt']);
});

const ev2 = (uses, results, cwd = '/private/tmp/x/fixture') => [
  {type: 'system', subtype: 'init', cwd, tools: EXPECTED_INIT_TOOLS, mcp_servers: [{name: 'browser', status: 'connected'}]},
  {type: 'assistant', message: {content: uses.map(([id, name, input]) => ({type: 'tool_use', id, name, input}))}},
  {type: 'user', message: {content: results.map(([id, isError]) => ({type: 'tool_result', tool_use_id: id, is_error: isError, content: 'x'}))}},
].map((e) => JSON.stringify(e)).join('\n');

test('reads: successful Reads of the body and either copy of a reference count; errors, Grep and Skill do not', () => {
  const s = ev2([
    ['1', 'Skill', {skill: 'asc'}],
    ['2', 'Read', {file_path: '/tmp/x/fixture/.agent-skill-chain/skills/asc/SKILL.md'}],
    ['3', 'Read', {file_path: '.agent-skill-chain/managed-runtime/skills/asc/references/implementation.md'}],
    ['4', 'Read', {file_path: '/private/tmp/x/fixture/.agent-skill-chain/skills/user-journey-acceptance/references/journeys.md'}],
    ['5', 'Grep', {pattern: 'x', path: '.agent-skill-chain/skills/user-journey-acceptance/SKILL.md'}],
    ['6', 'Read', {file_path: '/etc/hosts'}],
  ], [['1', false], ['2', false], ['3', false], ['4', true], ['5', false], ['6', true]]);
  const r = readRecord(s);
  assert.equal(r.ascBodyRead, true);
  assert.equal(r.implementationRead, true);
  assert.equal(r.journeysRead, false);
  assert.equal(r.ujaBodyRead, false);
  assert.equal(r.relevantReferenceRead, true);
  assert.deepEqual(r.skillCalls, ['asc']);
  assert.deepEqual(r.firstReadOrder, ['ascBody', 'implementation']);
  assert.equal(r.readAttempts, 4);
});

test('reads: no reads at all', () => {
  const r = readRecord(ev2([['1', 'Write', {file_path: 'out/index.html'}]], [['1', false]]));
  assert.equal(r.ascBodyRead, false);
  assert.equal(r.relevantReferenceRead, false);
  assert.deepEqual(r.ascFilesRead, []);
});

test('run-trial: the claude command has the #1807 tools, the MCP tools only and no prompt-forced procedure', () => {
  const a = claudeArgs({prompt: 'P', model: 'sonnet', budget: 1.5, mcpConfigPath: '/m.json'});
  const v = (k) => a[a.indexOf(k) + 1];
  assert.equal(a[0], '-p'); assert.equal(a[1], 'P');
  assert.equal(v('--tools'), 'Read,Write,Edit,Glob,Grep,Skill');
  assert.equal(v('--allowedTools'), 'mcp__browser__fetch_page,mcp__browser__view_page,mcp__browser__screenshot');
  assert.ok(v('--disallowedTools').split(',').includes('Bash'));
  assert.equal(v('--max-budget-usd'), '1.5');
  assert.ok(a.includes('--strict-mcp-config') && a.includes('--no-session-persistence'));
  assert.ok(!a.includes('--setting-sources') && !a.includes('--settings'));
  const prompt = fs.readFileSync(path.join(ev, '..', conds.prompt), 'utf8');
  assert.ok(!/2つの案|手順を行って/.test(prompt));
});

test('run-trial: docker plan keeps #1807 isolation, adds the label and never pulls', () => {
  const d = dockerPlan({prefix: 'p', fixture: '/f', logDir: '/l', envDir: '/t/env'});
  assert.ok(d.mcpConfig.mcpServers.browser.args.includes('/t/env:/opt/env:ro'));
  assert.deepEqual(d.setup[0], ['network', 'create', '--internal', '--label', LABEL, 'p-gen']);
  const mcp = d.mcpConfig.mcpServers.browser.args;
  for (const f of ['--read-only', '--cap-drop', '--pull', '--network']) assert.ok(mcp.includes(f), f);
  assert.equal(mcp[mcp.indexOf('--pull') + 1], 'never');
  assert.equal(mcp[mcp.indexOf('--network') + 1], 'p-gen');
  assert.ok(mcp.includes('/f:/work:ro'));
  assert.ok(!mcp.some((x) => /docker\.sock|CLAUDE_CODE_OAUTH_TOKEN/.test(x)));
  assert.deepEqual(d.cleanup[1], ['network', 'rm', 'p-gen', 'p-egress']);
});

test('run-trial: the child environment carries only the listed variables', () => {
  const e = childEnv({home: '/h', config: '/c', token: 'T', dockerHost: 'unix:///d.sock'});
  assert.deepEqual(Object.keys(e).sort(), ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER', 'DISABLE_TELEMETRY', 'DOCKER_HOST', 'HOME', 'LANG', 'PATH']);
  assert.equal(e.HOME, '/h'); assert.equal(e.CLAUDE_CONFIG_DIR, '/c');
  assert.ok(!('ANTHROPIC_API_KEY' in e));
});

test('run-trial: init check and credential scrub', () => {
  assert.deepEqual(initProblems({tools: [...EXPECTED_INIT_TOOLS].reverse(), mcp_servers: [{name: 'browser', status: 'connected'}]}), []);
  assert.equal(initProblems({tools: [...EXPECTED_INIT_TOOLS, 'Bash'], mcp_servers: [{name: 'browser', status: 'connected'}]}).length, 1);
  assert.match(initProblems({tools: EXPECTED_INIT_TOOLS, mcp_servers: [{name: 'browser', status: 'failed'}]})[0], /failed/);
  assert.deepEqual(initProblems(null), ['no init event']);
  assert.equal(scrub('a SECRET b SECRET', 'SECRET'), 'a <credential> b <credential>');
});

test('run-trial CLI: fixed values, wrong pairing, unpinned tarball and an unauthorised run are refused', () => {
  const d = tmp();
  const fake = path.join(d, 'x.tgz'); fs.writeFileSync(fake, 'x');
  const run = (args, env = {}) => spawnSync(process.execPath, [path.join(here, 'run-trial.mjs'), path.join(d, 'runs'), ...args], {encoding: 'utf8', env: {PATH: process.env.PATH, ...env}});
  assert.match(run(['ui03-dashboard', 'B', '1', '--tarball', fake, '--budget', '9']).stderr, /--budget is fixed/);
  const r = run(['ui03-dashboard', 'B', '1', '--tarball', fake]);
  assert.equal(r.status, 3); assert.match(r.stderr, /not pinned/);
  assert.match(run(['ui99', 'B', '1', '--tarball', fake]).stderr, /unknown case/);
  assert.match(run(['ui03-dashboard', 'B', 'x', '--tarball', fake]).stderr, /usage/);
});

test('decide: positions, pairs, spearman and the direction thresholds', () => {
  const key = {a: 'S-r1', b: 'S-r2', c: 'S-r3', d: 'B-r1', e: 'B-r2', f: 'B-r3'};
  const p = positions(['a', 'b', 'd', 'c', 'e', 'f'], key);
  assert.equal(p['S-r1'], 1); assert.equal(p['B-r3'], 6);
  assert.equal(pairsSAboveB(p, ['S-r1', 'S-r2', 'S-r3'], ['B-r1', 'B-r2', 'B-r3']), 8);
  assert.throws(() => positions(['a', 'b'], key));
  assert.throws(() => positions(['a', 'a', 'b', 'c', 'd', 'e'], key));
  assert.equal(spearman(p, p), 1);
  const rev = Object.fromEntries(Object.entries(p).map(([t, v]) => [t, 7 - v]));
  assert.equal(spearman(p, rev), -1);
  assert.equal(direction(8), '改善'); assert.equal(direction(7), '差なし'); assert.equal(direction(1), '劣化'); assert.equal(direction(1.5), '差なし');
  assert.equal(pairsSAboveB(meanPositions([{s: 1, b: 2}, {s: 2, b: 1}]), ['s'], ['b']), 0.5);
});

const S = ['S-r1', 'S-r2', 'S-r3'], B = ['B-r1', 'B-r2', 'B-r3'];
const keyA = {a: 'S-r1', b: 'S-r2', c: 'S-r3', d: 'B-r1', e: 'B-r2', f: 'B-r3'};
const keyB = {u: 'B-r3', v: 'S-r2', w: 'B-r1', x: 'S-r3', y: 'S-r1', z: 'B-r2'};

test('decide: an evaluator favours S only when the mean of two rounds gives >= 8 of 9 pairs and the rounds agree', () => {
  const good = evaluatorCase([{order: ['a', 'b', 'c', 'd', 'e', 'f'], key: keyA}, {order: ['y', 'v', 'x', 'w', 'z', 'u'], key: keyB}], S, B);
  assert.equal(good.u, 9); assert.equal(good.direction, '改善'); assert.equal(good.reproducibility, 1); assert.equal(good.effective, '改善');
  const unstable = evaluatorCase([{order: ['a', 'b', 'c', 'd', 'e', 'f'], key: keyA}, {order: ['u', 'z', 'w', 'x', 'v', 'y'], key: keyB}], S, B);
  assert.equal(unstable.reproducibility, -1); assert.equal(unstable.effective, '採点の揺れ');
});

const row = (o) => ({failed: false, answerWidths: 2, hiddenRequiredWide: 0, coverage: 1, axeSeriousCritical: 0, overflow: false, externalRequests: 0, reads: {ascBodyRead: true, relevantReferenceRead: true}, ...o});

test('decide: indicators compare answer widths, then hidden items; failures are worst for S and best for B', () => {
  assert.equal(indicatorCase([row(), row(), row()], [row({answerWidths: 1}), row(), row()]).direction, 'better');
  assert.equal(indicatorCase([row(), row(), row()], [row(), row(), row()]).direction, 'equal');
  assert.equal(indicatorCase([row({hiddenRequiredWide: 2}), row(), row()], [row(), row(), row()]).direction, 'worse');
  assert.equal(indicatorCase([row({failed: true}), row(), row()], [row(), row(), row()]).direction, 'worse');
  assert.equal(indicatorCase([row(), row(), row()], [row({failed: true}), row(), row()]).direction, 'equal');
  assert.equal(indicatorCase([row({coverage: 0.8}), row(), row()], [row(), row(), row()]).nonDegradationFailed, true);
});

const improved = {effective: '改善'}, flat = {effective: '差なし'}, worse = {effective: '劣化'};

test('decide: a case shows an effect only with both evaluators, indicators not worse and the text read', () => {
  const rows = [row(), row(), row()];
  assert.equal(caseDecision({S: rows, B: rows, ranking: {fable: improved, codex: improved}}).status, '効果あり');
  assert.equal(caseDecision({S: rows, B: rows, ranking: {fable: improved, codex: flat}}).status, '効果なし');
  assert.equal(caseDecision({S: [row({hiddenRequiredWide: 3}), row(), row()], B: rows, ranking: {fable: improved, codex: improved}}).status, '効果なし');
  const unread = [row({reads: {ascBodyRead: true, relevantReferenceRead: false}}), row({reads: {ascBodyRead: false, relevantReferenceRead: false}}), row()];
  assert.match(caseDecision({S: unread, B: rows, ranking: {fable: improved, codex: improved}}).status, /^未判定/);
  assert.match(caseDecision({S: [row({failed: true}), row({failed: true}), row()], B: rows, ranking: {fable: improved, codex: improved}}).status, /^保留/);
  assert.equal(caseDecision({S: rows, B: rows, ranking: null}).status, '順位待ち');
  assert.equal(caseDecision({S: rows, B: rows, ranking: {fable: worse, codex: worse}}).harm, true);
});

test('decide: overall needs effects in >= 2 cases, no harm and cost ratio <= 3', () => {
  const eff = {status: '効果あり', harm: false, judgeable: true}, none = {status: '効果なし', harm: false, judgeable: true};
  assert.equal(overall({a: eff, b: eff, c: none}, 1.5).decision, '効果あり（取り込む）');
  assert.equal(overall({a: eff, b: eff, c: {...none, harm: true}}, 1.5).decision, '効果なし（取り込まない）');
  assert.equal(overall({a: eff, b: eff, c: none}, 3.5).decision, '効果なし（取り込まない）');
  assert.equal(overall({a: eff, b: none, c: none}, 1).decision, '効果なし（取り込まない）');
  assert.match(overall({a: eff, b: {status: '未判定', judgeable: false}, c: {status: '未判定', judgeable: false}}, 1).decision, /^未判定/);
});

test('make-blind: ids and order are fixed by the seed and differ between rounds', () => {
  const t = [...B, ...S];
  assert.deepEqual(blindIds(t, 'asc1815-round1'), blindIds(t, 'asc1815-round1'));
  const r1 = blindIds(t, 'asc1815-round1'), r2 = blindIds(t, 'asc1815-round2');
  assert.notDeepEqual(r1.map((c) => c.id), r2.map((c) => c.id));
  assert.ok(r1.every((c) => !/[BS]-r/.test(c.id)));
});

test('budget: a reservation must stay within cap minus margin', () => {
  const b = conds.budget;
  assert.equal(canReserve(0, b.rankingReserveUsd, b), true);
  assert.equal(canReserve(b.capUsd - b.safetyMarginUsd - 1, 1.5, b), false);
  assert.ok(3 * 2 * 3 * b.perTrialUsd + 2 * b.rankingReserveUsd <= b.capUsd - b.safetyMarginUsd);
});

test('fixation: every fixed file exists and a changed digest is reported', () => {
  for (const f of FIXED) assert.ok(fs.existsSync(path.join(ev, f)), f);
  const rec = {files: digests()};
  assert.deepEqual(differences(rec), []);
  rec.files['decision-criteria.md'] = '0';
  assert.deepEqual(differences(rec), ['decision-criteria.md']);
});

test('collect: the runs root and local paths are removed', () => {
  const d = tmp();
  const r = clean(`{"cwd":"${d}/ui03/B-r1/fixture","x":"/Users/someone/a","m":"a@b.example"}`, d);
  assert.ok(!r.text.includes(d)); assert.ok(r.text.includes('<runs>/ui03/B-r1'));
  assert.ok(!r.text.includes('someone')); assert.equal(r.hits, 1);
});

test('run-indicators: the first-view container has no network and mounts the runs read-only', () => {
  const a = firstViewCommand('/runs', 'ui03-dashboard', '/out', ['B-r1']);
  assert.equal(a[a.indexOf('--network') + 1], 'none');
  assert.ok(a.includes('/runs:/runs:ro'));
  assert.match(a.at(-1), /first-view\.mjs \/opt\/e\/cases\.json ui03-dashboard/);
});

test('cases: three cases incl. ui03-dashboard, two widths each, items for both widths', () => {
  const c = loadJson('cases.json').cases;
  assert.deepEqual(Object.keys(c).sort(), ['ui03-dashboard', 'ui04-parts-search', 'ui07-bus-mobile']);
  for (const k of Object.values(c)) {
    assert.ok(k.narrow.width < k.wide.width);
    for (const s of ['narrow', 'wide']) assert.ok(k.firstView[s].items.length > 0);
  }
});

// ---- order, replacements, completeness, fixation, images, probe (coordinator's review lessons) ----------------------
const mkTrial = (root, caseId, name, {exit = 0, subtype = 'success', init = [], page = true} = {}) => {
  const d = path.join(root, caseId, name);
  fs.mkdirSync(path.join(d, 'fixture', 'out'), {recursive: true});
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({trial: `${caseId}/${name}`, exit, resultSubtype: subtype, initProblems: init}));
  if (page) fs.writeFileSync(path.join(d, 'fixture', 'out', 'index.html'), '<p>x</p>');
};

test('order: run-order.json is valid and gives 18 planned trials, reps outermost, B/S alternating by rep', () => {
  assert.deepEqual(orderProblems(loadOrder(), loadJson('cases.json').cases, conds), []);
  const p = plannedTrials().map((t) => t.name);
  assert.equal(p.length, 18);
  assert.deepEqual(p.slice(0, 3), ['ui03-dashboard/B-r1', 'ui03-dashboard/S-r1', 'ui07-bus-mobile/B-r1']);
  assert.deepEqual(p.slice(6, 8), ['ui03-dashboard/S-r2', 'ui03-dashboard/B-r2']);
  assert.ok(p.slice(0, 6).every((n) => n.endsWith('-r1')));
});

test('order: run-trial accepts only the next planned trial, then only the next required replacement', () => {
  const root = tmp();
  const planned = plannedTrials().map((t) => t.name);
  assert.equal(orderRefusal({caseId: 'ui03-dashboard', condition: 'B', rep: 1, reserved: new Set(), runsRoot: root}), null);
  assert.match(orderRefusal({caseId: 'ui03-dashboard', condition: 'S', rep: 1, reserved: new Set(), runsRoot: root}), /out of order/);
  assert.match(orderRefusal({caseId: 'ui03-dashboard', condition: 'B', rep: 4, reserved: new Set(planned.slice(0, 5)), runsRoot: root}), /before every planned trial/);
  for (const n of planned) { const [c, t] = n.split('/'); mkTrial(root, c, t, n === 'ui07-bus-mobile/B-r2' ? {exit: 1} : n === 'ui04-parts-search/S-r3' ? {page: false} : {}); }
  const all = new Set(planned);
  assert.deepEqual(replacementPlan({runsRoot: root}).map((t) => t.name), ['ui07-bus-mobile/B-r4', 'ui04-parts-search/S-r4']);
  assert.match(orderRefusal({caseId: 'ui04-parts-search', condition: 'S', rep: 4, reserved: all, runsRoot: root}), /next: ui07-bus-mobile\/B-r4/);
  assert.equal(orderRefusal({caseId: 'ui07-bus-mobile', condition: 'B', rep: 4, reserved: all, runsRoot: root}), null);
  assert.match(orderRefusal({caseId: 'ui03-dashboard', condition: 'B', rep: 2, reserved: all, runsRoot: root}), /out of order/);
  // the replacement ran and failed: it is not replaced again
  mkTrial(root, 'ui07-bus-mobile', 'B-r4', {exit: 1});
  all.add('ui07-bus-mobile/B-r4');
  assert.equal(orderRefusal({caseId: 'ui07-bus-mobile', condition: 'B', rep: 5, reserved: all, runsRoot: root}).includes('ui04-parts-search/S-r4'), true);
});

test('order: the scorer counts exactly what the runner replaced (k-th failure -> rep runs+k, no second replacement)', () => {
  const root = tmp();
  for (const t of ['B-r1', 'B-r2', 'B-r3', 'B-r4', 'B-r5', 'B-r6', 'S-r1', 'S-r2', 'S-r3']) mkTrial(root, 'ui03-dashboard', t, ['B-r1', 'B-r3', 'B-r4'].includes(t) ? {subtype: 'error_max_budget_usd'} : {});
  const names = fs.readdirSync(path.join(root, 'ui03-dashboard'));
  const b = countedTrials(names, 'ui03-dashboard', 'B', {runsRoot: root, runs: 3});
  assert.deepEqual(b.counted, ['B-r4', 'B-r2', 'B-r5']);
  assert.deepEqual(b.missing, []);
  assert.deepEqual(b.notUsed.sort(), ['B-r1', 'B-r3', 'B-r6']);
  assert.deepEqual(replacementPlan({runsRoot: root, order: {...loadOrder(), caseOrder: ['ui03-dashboard']}, runs: 3}).map((t) => t.name), ['ui03-dashboard/B-r4', 'ui03-dashboard/B-r5']);
  const root2 = tmp();
  for (const t of ['B-r1', 'B-r2', 'S-r1', 'S-r2', 'S-r3']) mkTrial(root2, 'ui03-dashboard', t, t === 'S-r2' ? {init: ['browser MCP server failed']} : {});
  const sel = selectCounted(fs.readdirSync(path.join(root2, 'ui03-dashboard')), 'ui03-dashboard', root2, 3);
  assert.deepEqual(sel.missing.sort(), ['B-r3', 'S-r4']);
  assert.equal(generationFailure(path.join(root2, 'ui03-dashboard', 'S-r2')), 'init: browser MCP server failed');
  assert.equal(generationFailure(path.join(root2, 'nope')), 'no meta.json');
});

test('decide: not judged when the run stopped early (unless the cap was reached) or a cell has no valid trial', () => {
  const b = conds.budget;
  assert.equal(completeness({missing: ['x'], spentUsd: 10, budget: b}).capReached, false);
  assert.equal(completeness({missing: ['x'], spentUsd: b.capUsd - b.safetyMarginUsd - 1, budget: b}).capReached, true);
  const eff = {status: '効果あり', harm: false, judgeable: true};
  const cs = {a: eff, b: eff, c: eff};
  assert.match(overall(cs, 1, {complete: false, capReached: false, emptyCells: []}).decision, /途中で止まった/);
  assert.equal(overall(cs, 1, {complete: false, capReached: true, emptyCells: []}).decision, '効果あり（取り込む）');
  assert.match(overall(cs, 1, {complete: true, capReached: false, emptyCells: ['ui03-dashboard/S']}).decision, /有効な試行の無い/);
});

test('decide: scoring is refused when a trial ran under another fixation record', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(ev, 'results/fixation.json'), 'utf8'));
  const sha = sha256(fs.readFileSync(path.join(ev, 'results/fixation.json')));
  const ok = {trial: 't', fixationSha256: sha, fixedAtCommit: fx.records.at(-1).fixedAtCommit};
  const mine = (p) => p.filter((x) => x.startsWith('t:'));
  assert.deepEqual(mine(fixationProblemsForScoring([ok])), []);
  assert.match(mine(fixationProblemsForScoring([{...ok, fixationSha256: '0'}]))[0], /another fixation record/);
  assert.match(mine(fixationProblemsForScoring([{...ok, fixedAtCommit: 'x'}]))[0], /fixedAtCommit/);
  // a changed fixed file is reported too (here: compared with a record whose digests are all '0')
  assert.ok(fixationProblemsForScoring([ok]).every((x) => x.startsWith('fixed file differs') || x.startsWith('t:')));
});

test('run-trial: images must have the pinned ids', () => {
  const im = conds.images;
  const ids = Object.fromEntries(Object.values(im).map((x) => [x.name, x.id]));
  assert.deepEqual(imageProblems((n) => ids[n]), []);
  assert.match(imageProblems((n) => (n === im.tools.name ? 'sha256:other' : ids[n]))[0], /pinned/);
  assert.match(imageProblems(() => null)[0], /absent/);
  assert.match(im.tools.id, /^sha256:[0-9a-f]{64}$/);
});

test('fixation: refix after the probes may change only probe.mjs; after a planned trial nothing', () => {
  const d = tmp(), l = path.join(d, 'ledger.jsonl');
  ledgerOps.create(l);
  const fx = {records: [{ledgerId: ledgerOps.ledgerId(l), files: digests()}]};
  assert.deepEqual(refixViolations(fx, l), []);
  ledgerOps.reserve(l, 'probe/B-r1', 0.5);
  assert.deepEqual(refixViolations(fx, l), []);
  const changed = {records: [{...fx.records[0], files: {...fx.records[0].files, 'decision-criteria.md': '0', 'harness/probe.mjs': '0'}}]};
  assert.deepEqual(refixViolations(changed, l), ['decision-criteria.md changed after the probes (only harness/probe.mjs may)']);
  ledgerOps.reserve(l, 'ui03-dashboard/B-r1', 1.5);
  assert.match(refixViolations(fx, l)[0], /measurement reservations/);
});

const probeTrace = ({tools = EXPECTED_INIT_TOOLS, text, reads = [], cwd}) => [
  {type: 'system', subtype: 'init', cwd, tools, mcp_servers: [{name: 'browser', status: 'connected'}], skills: ['asc', 'user-journey-acceptance', 'dataviz'], plugins: [], model: 'm'},
  {type: 'assistant', message: {content: reads.map((p, i) => ({type: 'tool_use', id: `r${i}`, name: 'Read', input: {file_path: p}}))}},
  {type: 'user', message: {content: reads.map((_, i) => ({type: 'tool_result', tool_use_id: `r${i}`, is_error: true, content: 'denied'}))}},
  {type: 'assistant', message: {content: [{type: 'text', text}]}},
  {type: 'result', subtype: 'success', result: text, total_cost_usd: 0.1},
].map((e) => JSON.stringify(e)).join('\n');

test('probe: passes only with the condition context, refused markers and no owner or repository text', () => {
  const d = tmp(), fixture = path.join(d, 'fixture'); fs.mkdirSync(fixture);
  const markers = [path.join(d, 'home-marker.txt'), path.join(d, 'repo-marker.txt')];
  const text = ['CLAUDE.md: <!-- asc:read-trigger v1 --> / このプロジェクトでASCを使う…', 'DESC asc: A desc', 'DESC user-journey-acceptance: U desc', 'GIT: Install ASC | initial'].join('\n');
  const base = {trace: probeTrace({text, reads: markers, cwd: fixture}), debug: '', stderr: '', fixture, trialDir: d, ascSkills: {asc: 'A desc', 'user-journey-acceptance': 'U desc'},
    forbiddenTexts: ['agent-skill-chain 利用案内（Claude Code）'], ownerLines: ['owner memory line one'], ownerSkills: ['own-skill'], markerPaths: markers, tokens: ['TOK1', 'TOK2'],
    realHome: '/home/someone', repoRoot: '/repo', hostInstallDir: '/opt/claude', installProblems: []};
  const ok = checkProbe(base);
  assert.equal(ok.pass, true, JSON.stringify(Object.entries(ok.checks).filter(([, c]) => !c.pass)));
  assert.equal(checkProbe({...base, trace: probeTrace({text: text + '\nowner memory line one', reads: markers, cwd: fixture})}).checks.noOwnerInstructionsOrMemory.pass, false);
  assert.equal(checkProbe({...base, trace: probeTrace({text: text.replace('このプロジェクトでASCを使う', ''), reads: markers, cwd: fixture})}).checks.readTriggerInContext.pass, false);
  assert.equal(checkProbe({...base, trace: probeTrace({text, reads: markers.slice(0, 1), cwd: fixture})}).checks.markersAttempted.pass, false);
  assert.equal(checkProbe({...base, debug: 'loaded /repo/CLAUDE.md'}).checks.noRealHomeOrRepoInDebug.pass, false);
  assert.equal(checkProbe({...base, debug: 'memory at /home/someone/.claude/projects/x/memory/MEMORY.md'}).checks.debugPathsInsideTrial.pass, false);
  assert.equal(checkProbe({...base, trace: probeTrace({text: text + '\nTOK1', reads: markers, cwd: fixture})}).checks.markerTokensAbsent.pass, false);
  assert.equal(checkProbe({...base, trace: probeTrace({tools: [...EXPECTED_INIT_TOOLS, 'Bash'], text, reads: markers, cwd: fixture})}).checks.tools.pass, false);
  assert.match(probePrompt('/h/m', '/r/m'), /Readで \/h\/m を読む/);
  assert.equal(compareProbes([ok, ok]).pass, true);
  assert.deepEqual(compareProbes([ok, {...ok, tools: ['Read']}]).differ, ['tools']);
});

test('probe: measurement waits for passing probes of both conditions; the probe waits for the owner confirmation', () => {
  const root = tmp();
  assert.equal(probeProblems(root, ['B', 'S']).length, 3);
  for (const c of ['B', 'S']) { fs.mkdirSync(path.join(root, 'probe', `${c}-r1`), {recursive: true}); fs.writeFileSync(path.join(root, 'probe', `${c}-r1`, 'probe-check.json'), JSON.stringify({pass: c === 'B'})); }
  assert.deepEqual(probeProblems(root, ['B', 'S']), ['no passing isolation probe for condition S', 'no passing probe comparison (probe/compare.json)']);
  const d = tmp(); fs.mkdirSync(path.join(d, 'results'));
  assert.match(approvalProblems(d)[0], /missing/);
});

// ---- third round of review lessons: probe limits, late probes, name sets ----------------------------------------------
test('probe: one per condition, one retry only after a judged failure, none once measurement is reserved', () => {
  const root = tmp();
  assert.equal(probeRefusal({condition: 'B', rep: 1, reserved: new Set(), runsRoot: root}), null);
  assert.match(probeRefusal({condition: 'B', rep: 1, reserved: new Set(['probe/B-r1']), runsRoot: root}), /already reserved/);
  assert.match(probeRefusal({condition: 'B', rep: 2, reserved: new Set(), runsRoot: root}), /rep 1 first/);
  assert.match(probeRefusal({condition: 'B', rep: 2, reserved: new Set(['probe/B-r1']), runsRoot: root}), /judged and failed/);
  fs.mkdirSync(path.join(root, 'probe', 'B-r1'), {recursive: true});
  fs.writeFileSync(path.join(root, 'probe', 'B-r1', 'probe-check.json'), JSON.stringify({pass: true}));
  assert.match(probeRefusal({condition: 'B', rep: 2, reserved: new Set(['probe/B-r1']), runsRoot: root}), /judged and failed/);
  fs.writeFileSync(path.join(root, 'probe', 'B-r1', 'probe-check.json'), JSON.stringify({pass: false}));
  assert.equal(probeRefusal({condition: 'B', rep: 2, reserved: new Set(['probe/B-r1']), runsRoot: root}), null);
  assert.match(probeRefusal({condition: 'B', rep: 3, reserved: new Set(['probe/B-r1', 'probe/B-r2']), runsRoot: root}), /at most one probe/);
  assert.match(probeRefusal({condition: 'S', rep: 1, reserved: new Set(['probe/B-r1', 'ui03-dashboard/B-r1']), runsRoot: root}), /before the first measurement/);
  assert.equal(probeRefusal({condition: 'S', rep: 1, reserved: new Set(['probe/B-r1', 'rank-fable-1']), runsRoot: root}), null);
});

test('decide: a probe reserved after the first measurement reservation voids the cap exception', () => {
  const d = tmp(), l = path.join(d, 'l.jsonl');
  ledgerOps.create(l);
  ledgerOps.reserve(l, 'probe/B-r1', 0.5); ledgerOps.reserve(l, 'probe/S-r1', 0.5);
  ledgerOps.reserve(l, 'ui03-dashboard/B-r1', 1.5);
  assert.deepEqual(ledgerFacts(l).lateProbes, []);
  ledgerOps.reserve(l, 'probe/S-r2', 0.5);
  const f = ledgerFacts(l);
  assert.deepEqual(f.lateProbes, ['probe/S-r2']);
  assert.deepEqual(f.names, ['ui03-dashboard/B-r1']);
  const b = conds.budget;
  const high = b.capUsd - b.safetyMarginUsd;
  assert.equal(completeness({missing: ['x'], spentUsd: high, budget: b}).capReached, true);
  assert.equal(completeness({missing: ['x'], spentUsd: high, budget: b, lateProbes: f.lateProbes}).capReached, false);
});

test('decide/make-blind: a reserved trial whose directory was removed is refused', () => {
  const root = tmp(), l = path.join(tmp(), 'l.jsonl');
  ledgerOps.create(l);
  const planned = plannedTrials().map((t) => t.name);
  for (const n of planned) { const [c, t] = n.split('/'); ledgerOps.reserve(l, n, 1.5); mkTrial(root, c, t); }
  assert.deepEqual(runConsistency(root, l).problems, []);
  fs.rmSync(path.join(root, 'ui07-bus-mobile', 'S-r2'), {recursive: true});
  const p = runConsistency(root, l).problems;
  assert.deepEqual(p, ['ui07-bus-mobile/S-r2 is only in ledger']);
  assert.throws(() => decide(root, tmp(), null, {ledger: l}), /refused: ui07-bus-mobile\/S-r2 is only in ledger/);
  assert.throws(() => makeRound(root, tmp(), 1, tmp(), tmp(), l), /refused: ui07-bus-mobile\/S-r2 is only in ledger/);
  // a directory that was never reserved is refused too
  mkTrial(root, 'ui07-bus-mobile', 'S-r2');
  mkTrial(root, 'ui04-parts-search', 'B-r9');
  assert.ok(runConsistency(root, l).problems.includes('ui04-parts-search/B-r9 is only in directories and classified'));
  assert.match(runConsistency(root, null).problems[0], /ledger is required/);
  assert.deepEqual(nameSetProblems({ledgerNames: ['a'], dirNames: ['a'], classifiedNames: []}), ['a is only in ledger and directories']);
});

// ---- independent review fixes ------------------------------------------------------------------------------------------
test('make-blind (M-1): only index.html and the assets it references are copied, never alternatives or notes', () => {
  const src = path.join(tmp(), 'out'), dst = path.join(tmp(), 'live', 'abcd');
  const w = (r, t) => { fs.mkdirSync(path.dirname(path.join(src, r)), {recursive: true}); fs.writeFileSync(path.join(src, r), t); };
  w('index.html', '<html><head><link rel="stylesheet" href="style.css"></head><body><img src="img/logo.png" srcset="img/logo@2x.png 2x"><a href="a/index.html">案A</a><a href="https://example.com/x.png">x</a></body></html>');
  w('style.css', 'body{background:url("img/bg.png")}');
  for (const r of ['img/logo.png', 'img/logo@2x.png', 'img/bg.png', 'unused.png', 'a/index.html', 'a/a.png', 'alt-b.html', 'DESIGN-NOTES.md', 'notes.md', 'compare.md']) w(r, 'x');
  assert.deepEqual(referencedAssets(src), ['img/bg.png', 'img/logo.png', 'img/logo@2x.png', 'style.css']);
  copyDeliverable(src, dst);
  const copied = []; const walk = (d, p = '') => { for (const e of fs.readdirSync(d, {withFileTypes: true})) { if (e.isDirectory()) walk(path.join(d, e.name), `${p}${e.name}/`); else copied.push(`${p}${e.name}`); } };
  walk(dst);
  assert.deepEqual(copied.sort(), ['img/bg.png', 'img/logo.png', 'img/logo@2x.png', 'index.html', 'style.css']);
  assert.match(fs.readFileSync(path.join(dst, 'index.html'), 'utf8'), /Content-Security-Policy/);
});

test('rank-guard (M-2): a round starts only with the runs and keys roots at mode 000 and the round directory separate', () => {
  const base = tmp(), runs = path.join(base, 'runs'), keys = path.join(base, 'keys'), round = path.join(base, 'blind', 'round1');
  for (const d of [runs, keys, path.join(round, 'ui03-dashboard')]) fs.mkdirSync(d, {recursive: true});
  fs.writeFileSync(path.join(round, 'ui03-dashboard', 'ORDER.txt'), 'x\n');
  assert.equal(guardProblems({runsRoot: runs, keysRoot: keys, roundDir: round}).length, 2);
  fs.chmodSync(runs, 0); fs.chmodSync(keys, 0);
  try {
    assert.deepEqual(guardProblems({runsRoot: runs, keysRoot: keys, roundDir: round}), []);
    assert.ok(guardProblems({runsRoot: runs, keysRoot: base, roundDir: round}).some((p) => /separate trees/.test(p)));
  } finally { fs.chmodSync(runs, 0o700); fs.chmodSync(keys, 0o700); }
  assert.deepEqual(blindPlacementProblems(path.join(runs, 'blind'), runs, keys), ['blind root is inside the runs root']);
  assert.deepEqual(blindPlacementProblems(path.join(base, 'blind'), runs, keys), []);
});

const rankLedger = () => { const d = tmp(), l = path.join(d, 'l.jsonl'); ledgerOps.create(l); return {d, l}; };
const addRank = (l, name, settle) => {
  const id = crypto.randomUUID();
  fs.appendFileSync(l, JSON.stringify({id, seq: ledgerOps.reservations(l).length, trial: name, reservedUsd: name.includes('fable') ? 4 : 0}) + '\n');
  if (settle) fs.appendFileSync(l, JSON.stringify({id, trial: name, costUsd: name.includes('fable') ? 2 : null, ...settle}) + '\n');
};
const rawOut = (n) => `理由…\n\`\`\`json\n{"ui03-dashboard":["a${n}","b"],"ui07-bus-mobile":[],"ui04-parts-search":[]}\n\`\`\`\n`;

test('budget (M-3): one round per evaluator and round number, one retry only after a failed launch', () => {
  const {l} = rankLedger();
  assert.deepEqual(nextRankName(rankEntries(l), 'fable', 1), {name: 'rank-fable-1'});
  addRank(l, 'rank-fable-1', null);
  assert.match(nextRankName(rankEntries(l), 'fable', 1).error, /not settled/);
  const {l: l2} = rankLedger();
  addRank(l2, 'rank-fable-1', {outputSha256: 'x', launchFailed: false});
  assert.match(nextRankName(rankEntries(l2), 'fable', 1).error, /already ran/);
  const {l: l3} = rankLedger();
  addRank(l3, 'rank-codex-2', {launchFailed: true});
  assert.deepEqual(nextRankName(rankEntries(l3), 'codex', 2), {name: 'rank-codex-2-retry'});
  addRank(l3, 'rank-codex-2-retry', {launchFailed: true});
  assert.match(nextRankName(rankEntries(l3), 'codex', 2).error, /one retry only/);
  assert.match(nextRankName(rankEntries(l3), 'other', 1).error, /evaluator/);
  assert.deepEqual(extractRanking(rawOut(1))['ui03-dashboard'], ['a1', 'b']);
});

test('budget/decide (M-3): ranks must match the ledger hashes; missing, extra or unsettled rounds are refused', () => {
  const {d, l} = rankLedger(); const ranks = path.join(d, 'ranks'); fs.mkdirSync(ranks);
  let n = 0;
  for (const e of ['fable', 'codex']) for (const r of [1, 2]) {
    const text = rawOut(++n); fs.writeFileSync(path.join(ranks, `${e}-${r}.txt`), text);
    if (e === 'codex' && r === 1) addRank(l, 'rank-codex-1', {launchFailed: true});
    addRank(l, e === 'codex' && r === 1 ? 'rank-codex-1-retry' : `rank-${e}-${r}`, {outputSha256: sha256(text), sessionId: 's', launchFailed: false});
  }
  const ok = rankRounds(l, ranks);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.rankings.codex[1]['ui03-dashboard'], ['a3', 'b']);
  fs.appendFileSync(path.join(ranks, 'fable-2.txt'), 'edited');
  assert.ok(rankRounds(l, ranks).problems.some((p) => /fable round 2: raw output differs/.test(p)));
  fs.writeFileSync(path.join(ranks, 'fable-2.txt'), rawOut(2));
  fs.writeFileSync(path.join(ranks, 'fable-3.txt'), 'x');
  assert.ok(rankRounds(l, ranks).problems.some((p) => /unexpected file/.test(p)));
  fs.rmSync(path.join(ranks, 'fable-3.txt'));
  addRank(l, 'rank-fable-1-retry', null);
  assert.ok(rankRounds(l, ranks).problems.some((p) => /rank-fable-1-retry is reserved but not settled/.test(p)));
  const {d: d2, l: l2} = rankLedger(); fs.mkdirSync(path.join(d2, 'ranks'));
  assert.ok(rankRounds(l2, path.join(d2, 'ranks')).problems.some((p) => /fable round 1: 0 completed/.test(p)));
});

test('decide (M-4): failed trials are not ranked; U over valid pairs with scaled thresholds; < 2 valid is 未判定', () => {
  assert.deepEqual(thresholds(9), {improved: 8, worse: 1});
  assert.deepEqual(thresholds(6), {improved: 6, worse: 0});
  assert.deepEqual(thresholds(4), {improved: 4, worse: 0});
  const key = {a: 'S-r1', b: 'S-r2', d: 'B-r1', e: 'B-r2', f: 'B-r3'};
  const r = evaluatorCase([{order: ['a', 'b', 'd', 'e', 'f'], key}, {order: ['b', 'a', 'd', 'f', 'e'], key}], ['S-r1', 'S-r2'], ['B-r1', 'B-r2', 'B-r3']);
  assert.equal(r.of, 6); assert.equal(r.u, 6); assert.equal(r.effective, '改善');
  assert.equal(evaluatorCase([], ['S-r1'], ['B-r1', 'B-r2']).effective, '未判定');
  assert.throws(() => evaluatorCase([{order: ['a', 'b', 'd', 'e', 'f'], key}], ['S-r1', 'S-r2', 'S-r3'], ['B-r1', 'B-r2', 'B-r3']), /exactly the valid trials/);
});

test('decide (L-2, L-6): 保留 and an excluded evaluator make the case not judgeable; < 2 judgeable cases is 未判定', () => {
  const rows = [row(), row(), row()];
  const shaky = caseDecision({S: rows, B: rows, ranking: {fable: {effective: '採点の揺れ'}, codex: improved}});
  assert.match(shaky.status, /^未判定/); assert.equal(shaky.judgeable, false);
  const few = caseDecision({S: rows, B: rows, ranking: {fable: {effective: '未判定'}, codex: improved}});
  assert.match(few.status, /^未判定/);
  const deferred = caseDecision({S: [row({failed: true}), row({failed: true}), row()], B: rows, ranking: {fable: improved, codex: improved}});
  assert.match(deferred.status, /^保留/); assert.equal(deferred.judgeable, false);
  const eff = caseDecision({S: rows, B: rows, ranking: {fable: improved, codex: improved}});
  assert.match(overall({a: eff, b: deferred, c: shaky}, 1).decision, /^未判定/);
});

test('collect (M-5): page text, images, input bodies and session ids never reach the published records', () => {
  const root = tmp(), src = path.join(root, 'ui07-bus-mobile', 'S-r1'); fs.mkdirSync(src, {recursive: true});
  const sid = '3439c3d2-d2d6-4317-b3c5-950e957b546c', b64 = 'iVBORw0KGgo' + 'A'.repeat(400);
  const ev3 = [
    {type: 'system', subtype: 'init', session_id: sid, cwd: path.join(src, 'fixture')},
    {type: 'assistant', session_id: sid, message: {content: [
      {type: 'tool_use', id: '1', name: 'mcp__browser__fetch_page', input: {url: 'https://example.org/work'}},
      {type: 'tool_use', id: '2', name: 'mcp__browser__screenshot', input: {path: 'out/index.html', width: 390}},
      {type: 'tool_use', id: '3', name: 'Write', input: {file_path: path.join(src, 'fixture', 'out', 'index.html'), content: 'GENERATED PAGE BODY'}}]}},
    {type: 'user', message: {content: [
      {type: 'tool_result', tool_use_id: '1', content: 'THIRD-PARTY PAGE TEXT'},
      {type: 'tool_result', tool_use_id: '2', content: [{type: 'image', source: {type: 'base64', data: b64}}]},
      {type: 'tool_result', tool_use_id: '3', content: 'ok'}]}}];
  fs.writeFileSync(path.join(src, 'trace.jsonl'), ev3.map((e) => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(src, 'meta.json'), JSON.stringify({trial: 'ui07-bus-mobile/S-r1', costUsd: 0.3, exit: 0, resultSubtype: 'success', initSkills: ['x'], finalText: 'FINAL', sessionId: sid}));
  fs.writeFileSync(path.join(src, 'reads.json'), JSON.stringify({cwd: path.join(src, 'fixture'), ascBodyRead: true}));
  const p = publishTrial({src, renderDir: path.join(root, 'none'), renderRow: {id: 'S-r1', file: '/x', viewports: {mobile: {textSample: 'PAGE TEXT SAMPLE', overflowX: false}}}, runsRoot: root});
  const all = Object.values(p.files).join('\n');
  for (const bad of ['THIRD-PARTY PAGE TEXT', b64.slice(0, 40), 'GENERATED PAGE BODY', 'FINAL', sid, root, 'PAGE TEXT SAMPLE']) assert.ok(!all.includes(bad), bad);
  assert.deepEqual(Object.keys(p.files).sort(), ['indicators.json', 'meta.json', 'reads.json', 'tool-calls.json']);
  assert.deepEqual(JSON.parse(p.files['tool-calls.json']).map((t) => [t.name, t.target]), [['mcp__browser__fetch_page', 'https://example.org/work'], ['mcp__browser__screenshot', 'out/index.html @390'], ['Write', 'out/index.html']]);
  assert.ok(!('trace.jsonl' in p.files) && !('tools.jsonl' in p.files));
  assert.equal(toolCalls('', null).length, 0);
});
