// #1867 layers 1-3 and the gate count: node --test docs/evidence/1867-design-persona/harness/   No model call.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildPages} from './layer-pages.mjs';
import {pack, combine, roundAnswers, answerStatus, answerOf} from './gate-packet.mjs';
import {countedTrials, parseReplacements, checkCounted} from './trials.mjs';
import {promptProblems, TOOLS, REPO, CONFIG, stageCheck, fixedCommitProblems} from './stage-check.mjs';
import {spawnSync} from 'node:child_process';
import {loadConfig, planItems, screensOf, shotPath, WIDTHS} from '../../1835-design-eval-layers/harness/eval-common.mjs';
import {buildPackets} from '../../1835-design-eval-layers/harness/make-packets.mjs';
import {buildOwnerPage} from '../../1835-design-eval-layers/harness/owner-page.mjs';
import {mergedCases, mergedGold} from '../../1835-design-eval-layers/harness/run-layer1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LAYERS = path.resolve(here, '../config/layers');
const cfg = loadConfig(path.join(LAYERS, 'eval.json'));
// runs.json rows of the 24 planned trials, every one counted and valid
const ROWS = countedTrials().map((x) => ({condition: x.condition, case: x.case, run: x.rep, counted: true, expectReadsAll: true}));
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1867-')); t.after(() => fs.rmSync(d, {recursive: true, force: true})); return d; };

// a raw runs root: every planned trial and S-lp-new-4 (a replacement); S-ui03-dashboard-3 wrote no record
function fakeRuns(root) {
  for (const t of [...countedTrials(), {condition: 'S', case: 'lp-new', rep: 4, name: 'S-lp-new-4'}]) {
    const w = path.join(root, t.name, 'work');
    const page = t.case === 'ui08-existing-ds' ? 'app/billing.html' : 'out/index.html';
    fs.mkdirSync(path.dirname(path.join(w, page)), {recursive: true});
    fs.mkdirSync(path.join(w, 'out'), {recursive: true});
    fs.writeFileSync(path.join(w, page), `<html>${t.name}</html>`);
    if (t.case === 'ui08-existing-ds') { fs.writeFileSync(path.join(w, 'app/tokens.css'), ':root{}'); fs.writeFileSync(path.join(w, 'app/DESIGN-SYSTEM.md'), 'ds'); }
    if (t.name !== 'S-ui03-dashboard-3') fs.writeFileSync(path.join(w, 'out/DESIGN-NOTES.md'), `記録 ${t.name}`);
  }
}

test('trials: 24 slots; a replacement takes the failed slot; malformed or doubled replacements are refused', () => {
  assert.equal(countedTrials().length, 24);
  const r = countedTrials(parseReplacements(['S-lp-new-2=S-lp-new-4']));
  assert.equal(r.find((t) => t.condition === 'S' && t.case === 'lp-new' && t.rep === 2).name, 'S-lp-new-4');
  for (const bad of [['S-lp-new-2=B-lp-new-4'], ['S-lp-new-2=S-lp-new-3'], ['S-lp-new-5=S-lp-new-4'], ['S-lp-new-2=S-lp-new-4', 'S-lp-new-2=S-lp-new-5']]) assert.throws(() => parseReplacements(bad));
  assert.throws(() => countedTrials({'S-lp-new-1': 'S-lp-new-4', 'S-lp-new-2': 'S-lp-new-4'}));
});

test('layer-pages: the original screens of the counted trials, the files next to the page but never a .md file', (t) => {
  const runs = tmp(t), pages = path.join(tmp(t), 'pages');
  fakeRuns(runs);
  const m = buildPages({runs, out: pages, replacements: parseReplacements(['S-lp-new-2=S-lp-new-4'])});
  assert.deepEqual([m.pages.length, m.missing.length], [24, 0]);
  assert.equal(fs.readFileSync(path.join(pages, 'lp-new/S-r2/original/index.html'), 'utf8'), '<html>S-lp-new-4</html>');
  assert.deepEqual(fs.readdirSync(path.join(pages, 'ui08-existing-ds/B-r1/original')).sort(), ['index.html', 'tokens.css']);
  assert.deepEqual(fs.readdirSync(path.join(pages, 'ui02-exhibition/B-r1/original')), ['index.html'], 'DESIGN-NOTES.md is not copied');
  assert.throws(() => buildPages({runs, out: pages}), /already/);
  fs.rmSync(path.join(runs, 'B-ui03-dashboard-1/work/out/index.html'));
  assert.deepEqual(buildPages({runs, out: path.join(tmp(t), 'p2')}).missing.map((x) => x.run), ['B-ui03-dashboard-1']);
});

test('gate pack: random ids and order, no condition, case or trial name in the packet; the key maps back', (t) => {
  const runs = tmp(t), out = tmp(t);
  fakeRuns(runs);
  const key = pack({runs, out, seed: '18670011', runsRows: ROWS});
  const pk = path.join(out, 'packet');
  const ids = JSON.parse(fs.readFileSync(path.join(pk, 'index.json'), 'utf8'));
  assert.equal(ids.length, 24);
  assert.deepEqual(fs.readdirSync(pk).sort(), ['TASK.md', 'index.json', 'records']);
  for (const n of [...fs.readdirSync(path.join(pk, 'records')), JSON.stringify(ids)]) assert.doesNotMatch(n, /\b[BS]-|ui0|lp-new|exhibition|dashboard/);
  assert.equal(Object.values(key.records).filter((r) => r.recordMissing).map((r) => r.run).join(), 'S-ui03-dashboard-3');
  const again = pack({runs, out: tmp(t), seed: '18670011', runsRows: ROWS});
  assert.deepEqual(Object.keys(again.records), Object.keys(key.records), 'same seed, same ids');
  const other = pack({runs, out: tmp(t), seed: '18670012', runsRows: ROWS});
  assert.notDeepEqual(Object.keys(other.records), Object.keys(key.records));
  assert.throws(() => pack({runs, out, seed: 'x', runsRows: ROWS}), /exists/);
  assert.throws(() => pack({runs, out: tmp(t), seed: 'x'}), /--runs-json/);
});

test('gate combine: both rounds true, else false; the machine part; 2 of 3 per case; 3 of 4 cases', (t) => {
  const runs = tmp(t);
  fakeRuns(runs);
  const k1 = pack({runs, out: tmp(t), seed: '1', runsRows: ROWS}), k2 = pack({runs, out: tmp(t), seed: '2', runsRows: ROWS});
  const answer = (key, f) => '```json\n' + JSON.stringify({records: Object.fromEntries(Object.entries(key.records).map(([id, r]) => [id, f(r)]))}) + '\n```';
  const yes = () => ({a: true, b: true});
  // round 2 splits S-lp-new-1 (b false) and S-lp-new-2 (a false): lp-new has 1/3 -> not judgeable
  const r2 = (r) => ({a: r.run !== 'S-lp-new-2', b: r.run !== 'S-lp-new-1'});
  const rows = countedTrials().map((x) => ({condition: x.condition, case: x.case, run: x.rep, counted: true, expectReadsAll: x.condition === 'S' && x.name !== 'S-ui02-exhibition-1'}));
  const res = combine({rounds: [{key: k1, text: answer(k1, yes)}, {key: k2, text: answer(k2, r2)}], runsRows: rows});
  assert.deepEqual(res.perCase['lp-new'], {S: '1/3', judgeable: false, B: {a: 3, b: 3, of: 3}});
  assert.equal(res.perCase['ui02-exhibition'].S, '2/3', 'machine part fails in S-ui02-exhibition-1');
  assert.deepEqual([res.judgeableCases, res.gate, res.minOwnerDecidedPairs], [['ui02-exhibition', 'ui03-dashboard', 'ui08-existing-ds'], 'judged', 18]);
  // review L-2: an unreadable answer must be redone once; after the redo, ids still unanswered are false
  assert.throws(() => combine({rounds: [{key: k1, text: 'no json'}, {key: k2, text: answer(k2, yes)}], runsRows: rows}), /redone once/);
  const unread = combine({rounds: [{key: k1, attempts: ['no json', 'still no json']}, {key: k2, text: answer(k2, yes)}], runsRows: rows});
  assert.deepEqual([unread.gate, unread.judgeableCases, unread.rounds[0].redone, unread.rounds[0].firstReason], ['未判定', [], true, 'unreadable']);
  assert.ok(Object.values(roundAnswers(k1, answer(k1, () => ({a: 'yes', b: 1})))).every((x) => !x.a && !x.b), 'only true counts');
  assert.throws(() => combine({rounds: [{key: k1, text: ''}], runsRows: rows}));
});

// a 1x1 PNG
const crc32 = (buf) => { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
const png = (shade) => { const h = Buffer.alloc(13); h.writeUInt32BE(1, 0); h.writeUInt32BE(1, 4); h[8] = 8; h[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', zlib.deflateSync(Buffer.from([0, shade, shade, shade]))), chunk('IEND', Buffer.alloc(0))]); };

test('eval.json with the #1835 tools: 36 owner pairs, P packets only for the 12 same-round pairs, the brief of each case', (t) => {
  const items = planItems(cfg);
  assert.deepEqual([items.length, items.every((i) => i.layer === 3), new Set(items.map((i) => i.case)).size], [36, true, 4]);
  for (const c of Object.keys(cfg.cases)) {
    assert.deepEqual(cfg.pPairs[c], [['S-r1', 'B-r1'], ['S-r2', 'B-r2'], ['S-r3', 'B-r3']]);
    assert.ok(fs.existsSync(path.resolve(here, '../..', cfg.cases[c].brief)), c);
  }
  const root = tmp(t);
  screensOf(items).forEach((s, i) => { for (const w of WIDTHS) { const f = shotPath(cfg, root, s, w); fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, png(i)); } });
  const key = buildPackets({cfg, renderRoot: root, out: path.join(tmp(t), 'eval'), seed: cfg.seeds.packets});
  const P = Object.values(key.packets);
  assert.deepEqual([P.length, P.every((p) => p.method === 'P'), new Set(P.map((p) => p.item)).size], [24, true, 12]);
  assert.ok(P.every((p) => /^L3:[^:]+:S-r(\d)~B-r\1$/.test(p.item)), 'same-round pairs only');
  const ownerDir = path.join(tmp(t), 'owner');
  const owner = buildOwnerPage({cfg, renderRoot: root, out: ownerDir, seed: cfg.seeds.ownerPage});
  assert.equal(owner.pairs, 36);
  const page = fs.readFileSync(path.join(ownerDir, 'owner-page.html'), 'utf8');
  assert.doesNotMatch(page, /[SB]-r\d|lp-new|ui0\d/, 'no condition, trial or case id on the owner page (the briefs name DESIGN-NOTES.md as a deliverable; no record is on the page)');
  assert.throws(() => buildPackets({cfg: {...cfg, pPairs: {'lp-new': [['S-r1', 'B-r9']]}}, renderRoot: root, out: path.join(tmp(t), 'x'), seed: 's'}), /pPairs not in layer3.pairs/);
  const noP = buildPackets({cfg: {...cfg, pPairs: undefined}, renderRoot: root, out: path.join(tmp(t), 'y'), seed: 's'});
  assert.equal(Object.keys(noP.packets).length, 72, 'without pPairs every layer-3 pair gets P packets (as #1852)');
});

test('layer 1 settings: lp-new beside the three #1835 cases; gold merged with #1804 and a duplicate refused', (t) => {
  const defs = JSON.parse(fs.readFileSync(path.join(LAYERS, 'layer1-cases.json'), 'utf8')).cases;
  const m = mergedCases(defs).cases;
  assert.deepEqual(Object.keys(m), ['ui02-exhibition', 'lp-new', 'ui03-dashboard', 'ui08-existing-ds']);
  for (const [c, s] of Object.entries(m)) assert.ok(s.wide?.renderName && s.narrow?.renderName && s.fixedNow && s.firstView?.narrow && s.goldKey && s.renderAlias, c);
  assert.deepEqual([m['lp-new'].narrow.renderName, m['ui03-dashboard'].narrow.renderName], ['mobile', 'tablet']);
  const ref = JSON.parse(fs.readFileSync(path.resolve(here, '../../1835-design-eval-layers/config/cases.json'), 'utf8')).cases;
  for (const c of ['ui02-exhibition', 'ui08-existing-ds']) for (const f of ['fixedNow', 'wide', 'narrow', 'firstView', 'goldKey', 'renderAlias']) assert.deepEqual(defs[c][f], ref[c][f], `${c} ${f} as #1835`);
  assert.equal(defs['ui03-dashboard'].firstViewFrom, ref['ui03-dashboard'].firstViewFrom);
  const add = path.join(LAYERS, 'layer1-gold.json');
  const g = mergedGold(add);
  assert.deepEqual(Object.keys(g).filter((k) => !['schema', 'note'].includes(k)).sort(), ['lp-new', 'ui02', 'ui03', 'ui08', 'ui10']);
  assert.deepEqual(mergedGold(), mergedGold(null), 'without --gold-add the #1804 file as before');
  assert.equal(mergedGold().schema, g.schema, 'the #1804 schema and note are kept');
  const brief = fs.readFileSync(path.resolve(here, '../cases/lp-new/BRIEF.md'), 'utf8');
  for (const alts of g['lp-new'].required) assert.ok(alts.some((a) => brief.includes(a)), `${alts[0]} is in the brief`);
  const dup = path.join(tmp(t), 'dup.json');
  fs.writeFileSync(dup, JSON.stringify({ui02: {required: []}}));
  assert.throws(() => mergedGold(dup), /already in #1804/);
});

// ---- review L-2, L-3, H-1, L-5, M-3 ----
test('gate check (L-2): no answer, unreadable or partial must be redone; the claude -p JSON output is read with its cost', (t) => {
  const runs = tmp(t);
  fakeRuns(runs);
  const k = pack({runs, out: tmp(t), seed: '1', runsRows: ROWS});
  const ids = Object.keys(k.records);
  const full = {records: Object.fromEntries(ids.map((id) => [id, {a: true, b: false}]))};
  const claudeOut = (result, cost = 0.8) => JSON.stringify({type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: cost});
  assert.deepEqual(answerStatus(ids, claudeOut('```json\n' + JSON.stringify(full) + '\n```')), {ok: true, reason: null, missingIds: [], costUsd: 0.8, isError: false, subtype: 'success'});
  assert.equal(answerStatus(ids, '').reason, 'no-answer');
  assert.equal(answerStatus(ids, JSON.stringify({type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 1.52})).reason, 'no-answer');
  assert.equal(answerStatus(ids, claudeOut('I could not finish.')).reason, 'unreadable');
  const part = {records: {...full.records}}; delete part.records[ids[0]]; part.records[ids[1]] = {a: 'yes', b: true};
  const st = answerStatus(ids, JSON.stringify(part));
  assert.deepEqual([st.ok, st.reason, st.missingIds], [false, 'partial', [ids[0], ids[1]]]);
  assert.equal(answerOf('plain').costUsd, null);
  // combine: a redo only after a refused answer; the costs of every attempt are summed
  const rows = countedTrials().map((x) => ({condition: x.condition, case: x.case, run: x.rep, counted: true, expectReadsAll: true}));
  const k2 = pack({runs, out: tmp(t), seed: '2', runsRows: ROWS});
  const ok2 = claudeOut('```json\n' + JSON.stringify({records: Object.fromEntries(Object.keys(k2.records).map((id) => [id, {a: true, b: true}]))}) + '\n```', 0.9);
  assert.throws(() => combine({rounds: [{key: k, attempts: [claudeOut(JSON.stringify(full)), claudeOut(JSON.stringify(full))]}, {key: k2, text: ok2}], runsRows: rows}), /only for an answer that check refused/);
  const r = combine({rounds: [{key: k, attempts: [JSON.stringify({type: 'result', is_error: true, total_cost_usd: 1.5}), claudeOut(JSON.stringify(part), 0.7)]}, {key: k2, text: ok2}], runsRows: rows});
  assert.deepEqual([r.costUsd, r.costMissing, r.rounds[0].missingAfterRedo], [3.1, 0, 2]);
  assert.equal(r.trials.find((x) => x.run === k.records[ids[1]].run).aRounds[0], false, 'an id without a boolean after the redo is false');
});

test('L-3: the trials taken must be the counted rows of runs.json (combine and buildPages); a failed counted trial has no page (H-1)', (t) => {
  const runs = tmp(t);
  fakeRuns(runs);
  const repl = parseReplacements(['S-lp-new-2=S-lp-new-4']);
  const rows = [...countedTrials().map((x) => ({condition: x.condition, case: x.case, run: x.rep, counted: !(x.name === 'S-lp-new-2'), failure: x.name === 'S-lp-new-2' ? 'no result event' : undefined})),
    {condition: 'S', case: 'lp-new', run: 4, counted: true, replaces: 2}, {condition: 'B', case: 'probe', run: 1}];
  assert.ok(checkCounted(repl, rows));
  assert.throws(() => checkCounted({}, rows), /counted in runs.json but not taken: S-lp-new-4; taken but not counted in runs.json: S-lp-new-2/);
  assert.throws(() => checkCounted(parseReplacements(['S-lp-new-1=S-lp-new-4']), rows), /replaces 2/);
  assert.throws(() => buildPages({runs, out: path.join(tmp(t), 'p'), runsRows: rows}), /does not match/);
  const k1 = pack({runs, out: tmp(t), seed: '1', runsRows: ROWS}), k2 = pack({runs, out: tmp(t), seed: '2', runsRows: ROWS});
  assert.throws(() => combine({rounds: [{key: k1, text: '{"records":{}}'}, {key: k2, text: '{"records":{}}'}], runsRows: rows}), /does not match/, 'a key without the replacement');
  // the replacement failed too: the slot is counted as a failure and its page is missing
  const failedSub = rows.map((r) => (r.case === 'lp-new' && r.run === 4 ? {...r, failure: 'no assistant message'} : r));
  const m = buildPages({runs, out: path.join(tmp(t), 'p2'), replacements: repl, runsRows: failedSub});
  assert.deepEqual(m.missing.map((x) => [x.trial, x.run, x.reason]), [['S-r2', 'S-lp-new-4', 'failed trial (no valid trial in the slot)']]);
  assert.equal(m.pages.length, 23);
});

test('L-1: gate pack checks runs.json as combine; a slot whose replacement failed too is left out of the packet and counted 無い', (t) => {
  const runs = tmp(t);
  fakeRuns(runs);
  const repl = parseReplacements(['S-lp-new-2=S-lp-new-4']);
  const rows = [...countedTrials().map((x) => ({condition: x.condition, case: x.case, run: x.rep, counted: x.name !== 'S-lp-new-2', expectReadsAll: true, failure: x.name === 'S-lp-new-2' ? 'no result event' : undefined})),
    {condition: 'S', case: 'lp-new', run: 4, counted: true, replaces: 2, expectReadsAll: true}];
  // the --replace error is found at pack, before the counting
  assert.throws(() => pack({runs, out: tmp(t), seed: '1', runsRows: rows}), /does not match/);
  assert.throws(() => pack({runs, out: tmp(t), seed: '1', replacements: parseReplacements(['S-lp-new-1=S-lp-new-4']), runsRows: rows}), /replaces 2/);
  const ok = pack({runs, out: tmp(t), seed: '1', replacements: repl, runsRows: rows});
  assert.deepEqual([Object.keys(ok.records).length, ok.absent], [24, []]);
  // the replacement failed too: 23 records in the packet, the slot in absent
  const failedSub = rows.map((r) => (r.case === 'lp-new' && r.run === 4 ? {...r, failure: 'no assistant message'} : r));
  const outs = [tmp(t), tmp(t)];
  const [k1, k2] = ['1', '2'].map((seed, i) => pack({runs, out: outs[i], seed, replacements: repl, runsRows: failedSub}));
  assert.deepEqual([Object.keys(k1.records).length, k1.absent.map((r) => [r.slot, r.run])], [23, [['S-r2', 'S-lp-new-4']]]);
  const ids = JSON.parse(fs.readFileSync(path.join(outs[0], 'packet/index.json'), 'utf8'));
  assert.deepEqual([ids.length, fs.readdirSync(path.join(outs[0], 'packet/records')).length], [23, 23]);
  assert.ok(!Object.values(k1.records).some((r) => r.run === 'S-lp-new-4'));
  const yes = (key) => JSON.stringify({records: Object.fromEntries(Object.keys(key.records).map((id) => [id, {a: true, b: true}]))});
  const g = combine({rounds: [{key: k1, text: yes(k1)}, {key: k2, text: yes(k2)}], runsRows: failedSub});
  const slot = g.trials.find((x) => x.run === 'S-lp-new-4');
  assert.deepEqual([slot.a, slot.b, slot.gate, slot.absent, g.perCase['lp-new'].S, g.perCase['lp-new'].judgeable], [false, false, false, 'failed trial (no valid trial in the slot)', '2/3', true]);
  assert.equal(g.trials.length, 24);
  // combine refuses a key whose left-out slots are not the failed rows of runs.json
  assert.throws(() => combine({rounds: [{key: k1, text: yes(k1)}, {key: k2, text: yes(k2)}], runsRows: rows}), /not the failed counted rows/);
  assert.throws(() => combine({rounds: [{key: ok, text: yes(ok)}, {key: k2, text: yes(k2)}], runsRows: failedSub}), /same trials|same slots/);
});

test('L-5: the lp-new brief for the evaluators and the owner is BRIEF.md and inquiries.md joined', () => {
  const read = (f) => fs.readFileSync(path.resolve(here, f), 'utf8');
  const sep = '\n---\n\n（以下は、依頼のフォルダにある資料 `inquiries.md` の全文。評価で依頼文と一緒に見せるために、ここに写した。）\n\n';
  assert.equal(read('../config/layers/lp-new-brief-for-evaluation.md'), read('../cases/lp-new/BRIEF.md') + sep + read('../cases/lp-new/inquiries.md'));
  const fx = JSON.parse(read('../config/conditions.json')).fixtures.LP.files;
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(here, f))).digest('hex');
  assert.deepEqual([fx['BRIEF.md'].sha256, fx['inquiries.md'].sha256], [sha('../cases/lp-new/BRIEF.md'), sha('../cases/lp-new/inquiries.md')], 'conditions.json pins the case files');
});

test('M-3 stage-check: the #1835 prompts against eval.json; the tools named exist', (t) => {
  assert.deepEqual(promptProblems(cfg.prompts, path.resolve(here, '../../1835-design-eval-layers/prompts')), []);
  const d = tmp(t);
  fs.writeFileSync(path.join(d, 'P.txt'), 'changed');
  assert.deepEqual(promptProblems({note: 'x', 'P.txt': cfg.prompts['P.txt'], 'gone.txt': 'a'}, d).map((x) => x.split(':')[0]), ['P.txt', 'gone.txt']);
  for (const p of TOOLS) assert.ok(fs.existsSync(path.join(REPO, p)), p);
});

test('M-1: the stage check covers the #1852 harness and the #1804 cases', () => {
  for (const p of ['docs/evidence/1852-p-good-pairs/harness', 'docs/evidence/1804-design-judgment/cases']) assert.ok(TOOLS.includes(p), p);
  assert.ok(fs.existsSync(path.join(REPO, 'docs/evidence/1852-p-good-pairs/harness/decide.mjs')));
});

test('L-5 stage-check on a temporary repository: the fixed commit must be a fixation commit; a changed or untracked tool fails; the fixation check fails', (t) => {
  const repo = tmp(t);
  const git = (...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], {cwd: repo, encoding: 'utf8'}); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q');
  for (const p of TOOLS) {
    const f = path.extname(p) === '.json' ? path.join(repo, p) : path.join(repo, p, 'x.mjs');
    fs.mkdirSync(path.dirname(f), {recursive: true});
    fs.writeFileSync(f, `// ${p}\n`);
  }
  fs.mkdirSync(path.join(repo, CONFIG, 'layers'), {recursive: true});
  fs.writeFileSync(path.join(repo, CONFIG, 'layers/eval.json'), JSON.stringify({prompts: {note: 'none'}}));
  git('add', '-A'); git('commit', '-q', '-m', 'fixed');
  const c1 = git('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(repo, CONFIG, 'results'), {recursive: true});
  fs.writeFileSync(path.join(repo, CONFIG, 'results/fixation.json'), JSON.stringify({records: [{fixedAtCommit: c1}]}));
  git('add', '-A'); git('commit', '-q', '-m', 'fixation record');
  const c2 = git('rev-parse', 'HEAD');
  const pass = () => ({code: 0, out: '{"ok":true}'}), fail = () => ({code: 1, out: '{"ok":false}'});
  const chk = (fixedCommit, fixationCheck = pass) => stageCheck({stage: 'decide', fixedCommit, repo, fixationCheck});
  const ok = chk(c1);
  assert.deepEqual([ok.ok, ok.fixation.ok, ok.commit.ok, ok.diff.ok, ok.prompts.ok, ok.resolvedCommit, ok.head], [true, true, true, true, true, c1, c2]);
  assert.equal(chk(c1.slice(0, 8)).ok, true, 'a short hash resolves');
  // review L-5: another commit (here the commit of the fixation record) or an unknown one is refused
  const other = chk(c2);
  assert.deepEqual([other.ok, other.commit.ok, other.diff.ok], [false, false, true]);
  assert.match(other.commit.problems[0], /not a fixedAtCommit/);
  assert.deepEqual([chk('deadbeef').ok, chk('deadbeef').commit.problems], [false, ['--fixed-commit does not name a commit']]);
  // the fixation part
  const fx = chk(c1, fail);
  assert.deepEqual([fx.ok, fx.fixation.ok, fx.commit.ok], [false, false, true]);
  // the git part: a tool changed after the fixed commit, then an untracked file under a tool
  const tool = path.join(repo, 'docs/evidence/1852-p-good-pairs/harness/x.mjs');
  fs.writeFileSync(tool, '// changed\n');
  const ch = chk(c1);
  assert.deepEqual([ch.ok, ch.diff.ok], [false, false]);
  assert.match(ch.diff.changed, /1852-p-good-pairs\/harness\/x\.mjs/);
  git('checkout', '-q', '--', '.');
  fs.writeFileSync(path.join(repo, 'docs/evidence/1804-design-judgment/cases/new.md'), 'new');
  const un = chk(c1);
  assert.deepEqual([un.ok, un.diff.ok], [false, false]);
  assert.match(un.diff.untracked, /1804-design-judgment\/cases\/new\.md/);
  fs.rmSync(path.join(repo, 'docs/evidence/1804-design-judgment/cases/new.md'));
  // a change committed after the fixed commit is also a difference
  fs.writeFileSync(tool, '// committed change\n'); git('commit', '-q', '-am', 'change a tool');
  assert.equal(chk(c1).diff.ok, false);
  // no fixation record
  fs.rmSync(path.join(repo, CONFIG, 'results/fixation.json'));
  assert.deepEqual(chk(c1).commit.problems, ['results/fixation.json is missing or unreadable']);
  assert.deepEqual([fixedCommitProblems({records: []}, c1), fixedCommitProblems({records: [{fixedAtCommit: c1}, {fixedAtCommit: c2}]}, c2)], [['results/fixation.json has no fixedAtCommit'], []]);
});
