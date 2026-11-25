// Tests for the #1815 harness parts that are new or changed relative to #1807/#1814. No model call, no docker.
// Run: node --test docs/evidence/1815-design-judgment/harness/harness.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tarballProblems, installedProblems, packageDiff, loadJson, sha256, READ_TRIGGER_MARK, ev} from './pairing.mjs';
import {readRecord} from './reads.mjs';
import {claudeArgs, dockerPlan, childEnv, initProblems, scrub, EXPECTED_INIT_TOOLS, LABEL} from './run-trial.mjs';
import {positions, meanPositions, pairsSAboveB, spearman, direction, evaluatorCase, indicatorCase, caseDecision, overall, selectTrials} from './decide.mjs';
import {blindIds} from './make-blind.mjs';
import {canReserve} from './budget.mjs';
import {FIXED, differences, digests} from './fixation.mjs';
import {trialOrder} from './dry-run.mjs';
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
  const d = dockerPlan({prefix: 'p', fixture: '/f', logDir: '/l'});
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

test('decide: a failed trial is replaced once by the next extra rep of the same condition', () => {
  const names = ['B-r1', 'B-r2', 'B-r3', 'B-r4', 'S-r1', 'S-r2', 'S-r3'];
  assert.deepEqual(selectTrials(names, (n) => n === 'B-r2', 3), {B: ['B-r1', 'B-r4', 'B-r3'], S: ['S-r1', 'S-r2', 'S-r3']});
  assert.deepEqual(selectTrials(names, (n) => n === 'S-r1', 3).S, ['S-r1', 'S-r2', 'S-r3']);
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

test('dry-run: trial order alternates B/S first by round and covers every case', () => {
  const o = trialOrder(['c1', 'c2'], 3);
  assert.equal(o.length, 12);
  assert.deepEqual(o.slice(0, 4), ['c1/B-r1', 'c1/S-r1', 'c2/B-r1', 'c2/S-r1']);
  assert.deepEqual(o.slice(4, 6), ['c1/S-r2', 'c1/B-r2']);
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
