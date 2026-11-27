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
import {positions, meanPositions, pairsSAboveB, spearman, direction, evaluatorCase, indicatorCase, caseDecision, overall, selectCounted, completeness, fixationProblemsForScoring, ledgerFacts, nameSetProblems, runConsistency, decide, thresholds, generationStopUsd, blindRecordProblems} from './decide.mjs';
import {plannedTrials, orderRefusal, replacementPlan, countedTrials, generationFailure, orderProblems, loadOrder} from './order.mjs';
import {checkProbe, compareProbes, probeProblems, approvalProblems, probePrompt, probeRefusal} from './probe.mjs';
import {refixViolations} from './fixation.mjs';
import {RESULTS} from './results-dir.mjs';
import * as ledgerOps from '../../1814-skill-invocation/harness/ledger.mjs';
import {blindIds, makeRound, referencedAssets, copyDeliverable, blindPlacementProblems, stripCues, treeSha256, stripSvg} from './make-blind.mjs';
import {guardProblems, setModes, lockHeldProblems} from './rank-guard.mjs';
import {clockScript} from './clock.mjs';
import vm from 'node:vm';
import {nextRankName, rankEntries, rankRounds, extractRanking, hostOutputProblems, reserveName, unsealOutputs, guardChainProblems} from './budget.mjs';
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
  assert.equal(completeness({missing: ['x'], genSpentUsd: 10, budget: b}).capReached, false);
  assert.equal(completeness({missing: ['x'], genSpentUsd: generationStopUsd(b) - 1, budget: b}).capReached, true);
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
  const high = generationStopUsd(b);
  assert.equal(completeness({missing: ['x'], genSpentUsd: high, budget: b}).capReached, true);
  assert.equal(completeness({missing: ['x'], genSpentUsd: high, budget: b, lateProbes: f.lateProbes}).capReached, false);
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

test('rank-guard (M-2, M-a): a round starts only with runs, keys, render and the other round at mode 000', () => {
  const base = tmp(), o = {runsRoot: path.join(base, 'runs'), keysRoot: path.join(base, 'keys'), renderRoot: path.join(base, 'render'), blindRoot: path.join(base, 'blind'), round: 1};
  for (const d of [o.runsRoot, o.keysRoot, o.renderRoot, path.join(o.blindRoot, 'round1', 'ui03-dashboard'), path.join(o.blindRoot, 'round2')]) fs.mkdirSync(d, {recursive: true});
  fs.writeFileSync(path.join(o.blindRoot, 'round1', 'ui03-dashboard', 'ORDER.txt'), 'x\n');
  const rec = path.join(base, 'guard.jsonl');
  assert.equal(guardProblems(o).length, 4);
  setModes(o, 0, rec);
  try {
    assert.deepEqual(guardProblems(o), []);
    assert.ok(guardProblems({...o, ranksRoot: path.join(o.blindRoot, 'round1', 'out')}).some((p) => /ranks root/.test(p)));
    assert.ok(guardProblems({...o, keysRoot: o.blindRoot}).some((p) => /separate trees/.test(p)));
  } finally { setModes(o, 0o700, rec); }
  const lines = fs.readFileSync(rec, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.action), ['lock', 'unlock']);
  assert.ok(Object.values(lines[0].modes).every((m) => m === '0'));
  assert.deepEqual(blindPlacementProblems(path.join(o.runsRoot, 'blind'), o.runsRoot, o.keysRoot), ['blind root is inside the runs root']);
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

const hostOut = (dir, {host, model, cwd, startedAt = '2026-11-26T01:00:00Z', finishedAt = '2026-11-26T01:10:00Z', status = 'completed', text}) => {
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({host, model, cwd, targetDirectory: cwd, sessionId: 'sid', status, startedAt, finishedAt}));
  if (text) fs.writeFileSync(path.join(dir, 'result.txt'), text);
};

test('budget/decide (M-3, M-d 1): ranks must match the recorded host-session outputs; missing, extra or unsettled rounds are refused', () => {
  const {d, l} = rankLedger(); const ranks = path.join(d, 'ranks'), round = path.join(d, 'round1');
  let n = 0;
  for (const e of ['fable', 'codex']) for (const r of [1, 2]) {
    const name = e === 'codex' && r === 1 ? 'rank-codex-1-retry' : `rank-${e}-${r}`;
    if (name.endsWith('-retry')) addRank(l, 'rank-codex-1', {launchFailed: true});
    const dir = path.join(ranks, name.replace(/^rank-/, ''));
    hostOut(dir, {host: e === 'fable' ? 'claude' : 'codex', model: e, cwd: round, text: rawOut(++n)});
    addRank(l, name, {resultSha256: sha256(fs.readFileSync(path.join(dir, 'result.txt'))), statusSha256: sha256(fs.readFileSync(path.join(dir, 'status.json'))), launchFailed: false});
  }
  const ok = rankRounds(l, ranks);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.rankings.codex[1]['ui03-dashboard'], ['a3', 'b']);
  fs.appendFileSync(path.join(ranks, 'fable-2', 'result.txt'), 'edited');
  assert.ok(rankRounds(l, ranks).problems.some((p) => /fable round 2: result.txt differs/.test(p)));
  fs.writeFileSync(path.join(ranks, 'fable-2', 'result.txt'), rawOut(2));
  fs.mkdirSync(path.join(ranks, 'fable-3'));
  assert.ok(rankRounds(l, ranks).problems.some((p) => /unexpected entry in the ranks root: fable-3/.test(p)));
  fs.rmSync(path.join(ranks, 'fable-3'), {recursive: true});
  addRank(l, 'rank-fable-1-retry', null);
  assert.ok(rankRounds(l, ranks).problems.some((p) => /rank-fable-1-retry is reserved but not settled/.test(p)));
  const {d: d2, l: l2} = rankLedger(); fs.mkdirSync(path.join(d2, 'ranks'));
  assert.ok(rankRounds(l2, path.join(d2, 'ranks')).problems.some((p) => /fable round 1: 0 completed/.test(p)));
});

test('budget (M-d 1): settle checks host, model, cwd, times and status of the host-session output', () => {
  const d = tmp(), round = path.join(d, 'round1'); fs.mkdirSync(round);
  const good = path.join(d, 'fable-1');
  hostOut(good, {host: 'claude', model: 'fable', cwd: round, text: 'x'});
  const base = {dir: good, evaluator: 'fable', roundDir: round, reservedAt: '2026-11-26T00:59:00Z', settleAt: '2026-11-26T01:11:00Z'};
  assert.deepEqual(hostOutputProblems(base), []);
  assert.ok(hostOutputProblems({...base, evaluator: 'codex'}).some((p) => /host claude is not codex/.test(p)));
  assert.ok(hostOutputProblems({...base, roundDir: d}).some((p) => /round directory/.test(p)));
  assert.ok(hostOutputProblems({...base, reservedAt: '2026-11-26T01:05:00Z'}).some((p) => /before the reservation/.test(p)));
  assert.ok(hostOutputProblems({...base, settleAt: '2026-11-26T01:05:00Z'}).some((p) => /before the settle/.test(p)));
  assert.deepEqual(hostOutputProblems({...base, launchFailed: true}), ['status.json says completed; not a launch failure']);
  const failedRun = path.join(d, 'fable-1-retry'); hostOut(failedRun, {host: 'claude', model: 'fable', cwd: round, status: 'failed'});
  assert.deepEqual(hostOutputProblems({...base, dir: failedRun, launchFailed: true}), []);
  assert.deepEqual(hostOutputProblems({...base, dir: path.join(d, 'none'), launchFailed: true}), []);
});

test('decide (M-d 2, 3): the keys and the blind tree must equal the make-blind records in the ledger', () => {
  const {d, l} = rankLedger(); const keys = path.join(d, 'keys'), blind = path.join(d, 'blind');
  for (const r of [1, 2]) {
    fs.mkdirSync(path.join(keys, String(r)), {recursive: true}); fs.writeFileSync(path.join(keys, String(r), 'ui03-dashboard.json'), `{"a${r}":"S-r1"}`); fs.writeFileSync(path.join(keys, String(r), 'seed.txt'), `seed${r}\n`);
    fs.mkdirSync(path.join(blind, `round${r}`, 'ui03-dashboard'), {recursive: true}); fs.writeFileSync(path.join(blind, `round${r}`, 'ui03-dashboard', 'ORDER.txt'), `a${r}\n`);
    fs.appendFileSync(l, JSON.stringify({blind: r, keysSha256: treeSha256(path.join(keys, String(r))), blindTreeSha256: treeSha256(path.join(blind, `round${r}`))}) + '\n');
  }
  assert.deepEqual(blindRecordProblems(l, keys, blind), []);
  fs.writeFileSync(path.join(keys, '2', 'ui03-dashboard.json'), '{"a2":"B-r1"}');
  assert.deepEqual(blindRecordProblems(l, keys, blind), ['round 2: keys differ from the ledger record']);
  fs.writeFileSync(path.join(keys, '2', 'ui03-dashboard.json'), '{"a2":"S-r1"}');
  fs.writeFileSync(path.join(blind, 'round1', 'ui03-dashboard', 'extra.html'), 'x');
  assert.deepEqual(blindRecordProblems(l, keys, blind), ['round 1: blind tree differs from the ledger record']);
  fs.appendFileSync(l, JSON.stringify({blind: 1, keysSha256: 'x', blindTreeSha256: 'y'}) + '\n');
  assert.ok(blindRecordProblems(l, keys, blind).includes('round 1: 2 make-blind record(s) in the ledger, expected 1'));
});

test('decide (M-d 4): the lock must be held from each round reservation to its settle', () => {
  const settles = {fable: {1: {reservedAt: '2026-11-26T01:00:00Z', settledAt: '2026-11-26T01:30:00Z'}}};
  const lock = (at, round = 1) => JSON.stringify({action: 'lock', round, at, modes: {a: '0', b: '0'}});
  const unlock = (at, round = 1) => JSON.stringify({action: 'unlock', round, at, modes: {a: '700'}});
  assert.deepEqual(lockHeldProblems([lock('2026-11-26T00:59:00Z'), unlock('2026-11-26T01:31:00Z')].join('\n'), settles), []);
  assert.match(lockHeldProblems([lock('2026-11-26T00:59:00Z'), unlock('2026-11-26T01:10:00Z')].join('\n'), settles)[0], /unlocked between/);
  assert.match(lockHeldProblems([lock('2026-11-26T01:05:00Z')].join('\n'), settles)[0], /no lock before/);
  assert.match(lockHeldProblems([lock('2026-11-26T00:59:00Z', 2)].join('\n'), settles)[0], /no lock before/);
});

test('make-blind (M-b): comments, meta and title cues are removed from what the evaluators read', () => {
  const src = path.join(tmp(), 'out'), dst = path.join(tmp(), 'live');
  fs.mkdirSync(src, {recursive: true});
  fs.writeFileSync(path.join(src, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="案Bを採用した版"><title>出荷監視（案B）</title><link rel="stylesheet" href="s.css"><style>/* 2案比較 */ body{color:red}</style></head><body><!-- 案Bを採用 --><p>本文</p></body></html>');
  fs.writeFileSync(path.join(src, 's.css'), '/* 案Aより密度を上げた */ p{margin:0}');
  copyDeliverable(src, dst, 'k7mx');
  const html = fs.readFileSync(path.join(dst, 'index.html'), 'utf8'), css = fs.readFileSync(path.join(dst, 's.css'), 'utf8');
  for (const cue of ['案B', '2案比較', '案A']) assert.ok(!html.includes(cue) && !css.includes(cue), cue);
  assert.match(html, /<meta charset="utf-8">/); assert.match(html, /name="viewport"/); assert.match(html, /<title>画面 k7mx<\/title>/);
  assert.match(html, /<p>本文<\/p>/); assert.match(css, /p\{margin:0\}/);
  assert.deepEqual(stripCues('<p>a</p>', 'x'), '<p>a</p>');
});

test('decide (M-c, L-d): ranking costs do not count toward the cap exception; generation stops before the ranking reserve', () => {
  const b = conds.budget;
  assert.equal(generationStopUsd(b), b.capUsd - b.safetyMarginUsd - 2 * b.rankingReserveUsd);
  assert.ok(3 * 2 * 3 * b.perTrialUsd + 2 * b.probeUsd <= generationStopUsd(b));
  const {l} = rankLedger();
  const res = (name, usd, cost) => { const r = ledgerOps.reserve(l, name, usd); ledgerOps.settle(l, r.id, name, cost); };
  res('probe/B-r1', 0.5, 0.2);
  for (let i = 0; i < 18; i++) res(`ui03-dashboard/B-r${i + 1}`, 1.5, 1.4);
  res('rank-fable-1', 4, 3.9); res('rank-fable-2', 4, 3.9);
  const f = ledgerFacts(l);
  assert.ok(Math.abs(f.genSpentUsd - (0.2 + 18 * 1.4)) < 1e-9);
  assert.ok(f.spentUsd + b.perTrialUsd > generationStopUsd(b));
  assert.equal(completeness({missing: ['x'], genSpentUsd: f.genSpentUsd, budget: b}).capReached, false);
});

test('decide (L-c): harm is the symmetric counterpart of improvement (owner-approved 2026-11-26)', () => {
  assert.deepEqual(thresholds(9), {improved: 8, worse: 1});
  assert.deepEqual(thresholds(6), {improved: 6, worse: 0});
  assert.deepEqual(thresholds(5), {improved: 5, worse: 0});
  assert.deepEqual(thresholds(4), {improved: 4, worse: 0});
  assert.equal(direction(1, 9), '劣化'); assert.equal(direction(2, 9), '差なし');
});

test('first-view clock (L-e): fixed instant, callable without new, real instances', () => {
  const F = Date.parse('2027-05-12T07:41:00+09:00');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(clockScript(F), ctx);
  assert.equal(vm.runInContext('Date.now()', ctx), F);
  assert.equal(vm.runInContext('new Date().getTime()', ctx), F);
  assert.equal(vm.runInContext('typeof Date()', ctx), 'string');
  assert.equal(vm.runInContext('Date() === new Date().toString()', ctx), true);
  assert.equal(vm.runInContext('new Date(0).getTime()', ctx), 0);
  assert.equal(vm.runInContext('new Date(2027, 0, 1) instanceof Date', ctx), true);
  assert.equal(vm.runInContext('Date.UTC(2027, 0, 1)', ctx), Date.UTC(2027, 0, 1));
  assert.throws(() => clockScript(NaN));
});

test('collect (L-b): permission denials keep the tool name and target only', () => {
  const root = tmp(), src = path.join(root, 'ui03-dashboard', 'B-r1'); fs.mkdirSync(src, {recursive: true});
  fs.writeFileSync(path.join(src, 'trace.jsonl'), '');
  fs.writeFileSync(path.join(src, 'reads.json'), JSON.stringify({cwd: path.join(src, 'fixture')}));
  fs.writeFileSync(path.join(src, 'meta.json'), JSON.stringify({trial: 'ui03-dashboard/B-r1', permissionDenials: [{tool_name: 'Write', tool_use_id: 't1', tool_input: {file_path: '/etc/x', content: 'DENIED BODY TEXT'}}]}));
  const p = publishTrial({src, renderDir: path.join(root, 'none'), renderRow: null, runsRoot: root});
  const meta = JSON.parse(p.files['meta.json']);
  assert.deepEqual(meta.permissionDenials, [{name: 'Write', target: '<outside the project>'}]);
  assert.ok(!p.files['meta.json'].includes('DENIED BODY TEXT'));
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

// ---- third review ------------------------------------------------------------------------------------------------------
test('ranks (M-1, third review): one evaluator at a time; settled outputs stay sealed until decide unseals them after every round', () => {
  const {d, l} = rankLedger(); const ranks = path.join(d, 'ranks');
  addRank(l, 'rank-fable-1', null);
  assert.match(reserveName(rankEntries(l), 'codex', 1).error, /settle rank-fable-1 before/);
  const base = tmp(), o = {runsRoot: path.join(base, 'runs'), keysRoot: path.join(base, 'keys'), renderRoot: path.join(base, 'render'), blindRoot: path.join(base, 'blind'), round: 1};
  for (const x of [o.runsRoot, o.keysRoot, o.renderRoot, path.join(o.blindRoot, 'round1', 'ui03-dashboard'), path.join(o.blindRoot, 'round2'), path.join(ranks, 'fable-1')]) fs.mkdirSync(x, {recursive: true});
  fs.writeFileSync(path.join(o.blindRoot, 'round1', 'ui03-dashboard', 'ORDER.txt'), 'x\n');
  const rec = path.join(base, 'guard.jsonl');
  setModes(o, 0, rec);
  try {
    const sealedDirs = [path.join(ranks, 'fable-1')];
    assert.match(guardProblems({...o, sealedDirs}).join(), /^settled output fable-1 is mode [0-7]+, not 000$/);
    fs.chmodSync(sealedDirs[0], 0);
    assert.deepEqual(guardProblems({...o, sealedDirs}), []);
  } finally { setModes(o, 0o700, rec); fs.chmodSync(path.join(ranks, 'fable-1'), 0o700); }
  // decide's unseal: refused while a round is open or missing; then every output becomes readable and is recorded
  assert.ok(unsealOutputs({ledger: l, ranksRoot: ranks, guardRecord: rec}).some((p) => /rank-fable-1 is reserved but not settled/.test(p)));
  const {d: d2, l: l2} = rankLedger(); const ranks2 = path.join(d2, 'ranks'); const rec2 = path.join(d2, 'guard.jsonl'); fs.writeFileSync(rec2, '');
  for (const n of ['fable-1', 'codex-1', 'fable-2', 'codex-2']) { fs.mkdirSync(path.join(ranks2, n), {recursive: true}); fs.writeFileSync(path.join(ranks2, n, 'result.txt'), 'x'); fs.chmodSync(path.join(ranks2, n), 0); addRank(l2, `rank-${n}`, {launchFailed: false, resultSha256: 'x'}); }
  try {
    assert.deepEqual(unsealOutputs({ledger: l2, ranksRoot: ranks2, guardRecord: rec2}), []);
    assert.ok(['fable-1', 'codex-2'].every((n) => (fs.statSync(path.join(ranks2, n)).mode & 0o777) === 0o700));
    const last = JSON.parse(fs.readFileSync(rec2, 'utf8').trim().split('\n').at(-1));
    assert.equal(last.action, 'unseal'); assert.deepEqual(last.dirs, ['codex-1', 'codex-2', 'fable-1', 'fable-2']);
  } finally { for (const n of ['fable-1', 'codex-1', 'fable-2', 'codex-2']) fs.chmodSync(path.join(ranks2, n), 0o700); }
});

test('ranks (L-2, third review): the rank-guard record must keep every prefix recorded at a settle', () => {
  const {d, l} = rankLedger(); const rec = path.join(d, 'guard.jsonl');
  fs.writeFileSync(rec, '{"action":"lock","round":1}\n');
  const b = fs.readFileSync(rec);
  addRank(l, 'rank-fable-1', {launchFailed: false, guardRecordBytes: b.length, guardRecordSha256: sha256(b)});
  fs.appendFileSync(rec, '{"action":"unlock","round":1}\n');
  assert.deepEqual(guardChainProblems(l, rec), []);
  fs.writeFileSync(rec, '{"action":"lock","round":2}\n{"action":"unlock","round":1}\n');
  assert.deepEqual(guardChainProblems(l, rec), ['rank-fable-1: the rank-guard record changed after the settle']);
  addRank(l, 'rank-codex-1', {launchFailed: false});
  assert.ok(guardChainProblems(l, rec).includes('rank-codex-1: no rank-guard record hash in the settle'));
});

test('make-blind (L-1, third review): SVG comments, title, desc and metadata are removed', () => {
  const src = path.join(tmp(), 'out'), dst = path.join(tmp(), 'live');
  fs.mkdirSync(src, {recursive: true});
  fs.writeFileSync(path.join(src, 'index.html'), '<html><head><title>t</title></head><body><img src="icon.svg"><svg><title>案Bの図</title><desc>2案比較</desc><!-- 案A --><circle r="1"/></svg></body></html>');
  fs.writeFileSync(path.join(src, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><metadata>案B</metadata><title>案A</title><desc>比較</desc><!-- 案B --><rect width="1"/></svg>');
  copyDeliverable(src, dst, 'id1');
  const html = fs.readFileSync(path.join(dst, 'index.html'), 'utf8'), svg = fs.readFileSync(path.join(dst, 'icon.svg'), 'utf8');
  for (const cue of ['案A', '案B', '2案比較', '比較']) { assert.ok(!html.includes(cue), cue); assert.ok(!svg.includes(cue), cue); }
  assert.match(html, /<title>画面 id1<\/title>/); assert.match(html, /<circle r="1"\/>/); assert.match(svg, /<rect width="1"\/>/);
  assert.equal(stripSvg('<svg><title/></svg>'), '<svg></svg>');
});

// ---- fourth review (Low-1): the budget.mjs CLI seals a settled output, and a reserve is refused once it is unsealed ----
// This test drives the real CLI, which accepts only files equal to the active fixation record (RESULTS). Before the plan of a
// stage is fixed (fixation.mjs init/refix) the record does not match the files, so the test is skipped with that reason and
// runs once the stage's fixation is committed.
const activeFixation = (() => { const f = path.join(ev, RESULTS, 'fixation.json'); if (!fs.existsSync(f)) return {file: f, fx: null, stale: 'no fixation record yet'}; const fx = JSON.parse(fs.readFileSync(f, 'utf8')); const d = differences(fx.records.at(-1)); return {file: f, fx, stale: d.length ? `fixed files differ from the record: ${d.join(', ')}` : null}; })();
test('budget CLI: reserve fable -> settle seals the output (mode 000) -> a manual chmod 700 makes the next reserve fail', {skip: activeFixation.stale ? `plan not fixed for ${RESULTS}: ${activeFixation.stale}` : false}, () => {
  const fx = activeFixation.fx;
  const base = fs.realpathSync(tmp());
  const ledger = path.join(base, 'ledger.jsonl');
  // A temporary ledger carrying the recorded ledger id (the CLI accepts only that ledger); never the real one.
  fs.writeFileSync(ledger, JSON.stringify({ledgerId: fx.records[0].ledgerId, createdAt: new Date().toISOString()}) + '\n');
  const o = {runs: path.join(base, 'runs'), keys: path.join(base, 'keys'), render: path.join(base, 'render'), blind: path.join(base, 'blind'), ranks: path.join(base, 'ranks')};
  for (const d of [o.runs, o.keys, o.render, path.join(o.blind, 'round1', 'ui03-dashboard'), path.join(o.blind, 'round2'), o.ranks]) fs.mkdirSync(d, {recursive: true});
  fs.writeFileSync(path.join(o.blind, 'round1', 'ui03-dashboard', 'ORDER.txt'), 'x\n');
  const record = path.join(base, 'rank-guard.jsonl');
  const guard = ['--round', '1', '--runs-root', o.runs, '--keys-root', o.keys, '--render-root', o.render, '--blind-root', o.blind, '--ranks-root', o.ranks];
  const cli = (...a) => spawnSync(process.execPath, [path.join(here, 'budget.mjs'), ...a], {encoding: 'utf8'});
  const locked = [o.runs, o.keys, o.render, path.join(o.blind, 'round2')];
  const out = path.join(o.ranks, 'fable-1');
  try {
    for (const d of locked) fs.chmodSync(d, 0);
    fs.appendFileSync(record, JSON.stringify({action: 'lock', round: 1, at: new Date().toISOString(), modes: {}}) + '\n');
    const r1 = cli('reserve', ledger, 'fable', '1', ...guard);
    assert.equal(r1.status, 0, r1.stderr);
    fs.mkdirSync(out);
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'status.json'), JSON.stringify({host: 'claude', model: 'fable', cwd: path.join(o.blind, 'round1'), targetDirectory: path.join(o.blind, 'round1'), sessionId: 'sid', status: 'completed', startedAt: now, finishedAt: now}));
    fs.writeFileSync(path.join(out, 'result.txt'), '{"ui03-dashboard":[]}\n');
    const s = cli('settle', ledger, 'rank-fable-1', '--host-output', out, '--guard-record', record, ...guard);
    assert.equal(s.status, 0, s.stderr);
    assert.equal(fs.statSync(out).mode & 0o777, 0);
    fs.chmodSync(out, 0o700);
    const r2 = cli('reserve', ledger, 'codex', '1', ...guard);
    assert.equal(r2.status, 3);
    assert.match(r2.stderr, /settled output fable-1 is mode 700, not 000/);
    fs.chmodSync(out, 0);
    const r3 = cli('reserve', ledger, 'codex', '1', ...guard);
    assert.equal(r3.status, 0, r3.stderr);
  } finally {
    for (const d of [...locked, out]) if (fs.existsSync(d)) fs.chmodSync(d, 0o700);
  }
});

// ---- stage 2: the results directory is chosen by ASC1815_RESULTS (fresh fixation and ledger, stage-1 records untouched) ----
test('results-dir: default is results; ASC1815_RESULTS moves the fixation and probe-approval lookups', () => {
  const run = (env) => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {RESULTS} from ${JSON.stringify(path.join(here, 'results-dir.mjs'))}; import {paidStepProblems} from ${JSON.stringify(path.join(here, 'fixation.mjs'))}; import {approvalProblems} from ${JSON.stringify(path.join(here, 'probe.mjs'))}; console.log(JSON.stringify({RESULTS, paid: paidStepProblems(null)[0], approval: approvalProblems(${JSON.stringify(ev)})[0]}))`],
  {encoding: 'utf8', env: {...process.env, ASC1815_RESULTS: '', ...env}});
  const a = JSON.parse(run({}).stdout);
  assert.equal(a.RESULTS, 'results');
  const b = JSON.parse(run({ASC1815_RESULTS: 'results/stage-x/'}).stdout);
  assert.equal(b.RESULTS, 'results/stage-x');
  assert.match(b.paid, /^results\/stage-x\/fixation\.json is missing/);
  assert.match(b.approval, /^results\/stage-x\/probe-approval\.json is missing/);
});
