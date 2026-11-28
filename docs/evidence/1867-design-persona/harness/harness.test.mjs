// #1867 layers 1-3 and the gate count: node --test docs/evidence/1867-design-persona/harness/   No model call.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {buildPages} from './layer-pages.mjs';
import {pack, combine, roundAnswers} from './gate-packet.mjs';
import {countedTrials, parseReplacements} from './trials.mjs';
import {loadConfig, planItems, screensOf, shotPath, WIDTHS} from '../../1835-design-eval-layers/harness/eval-common.mjs';
import {buildPackets} from '../../1835-design-eval-layers/harness/make-packets.mjs';
import {buildOwnerPage} from '../../1835-design-eval-layers/harness/owner-page.mjs';
import {mergedCases, mergedGold} from '../../1835-design-eval-layers/harness/run-layer1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LAYERS = path.resolve(here, '../config/layers');
const cfg = loadConfig(path.join(LAYERS, 'eval.json'));
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
  const key = pack({runs, out, seed: '18670011'});
  const pk = path.join(out, 'packet');
  const ids = JSON.parse(fs.readFileSync(path.join(pk, 'index.json'), 'utf8'));
  assert.equal(ids.length, 24);
  assert.deepEqual(fs.readdirSync(pk).sort(), ['TASK.md', 'index.json', 'records']);
  for (const n of [...fs.readdirSync(path.join(pk, 'records')), JSON.stringify(ids)]) assert.doesNotMatch(n, /\b[BS]-|ui0|lp-new|exhibition|dashboard/);
  assert.equal(Object.values(key.records).filter((r) => r.recordMissing).map((r) => r.run).join(), 'S-ui03-dashboard-3');
  const again = pack({runs, out: tmp(t), seed: '18670011'});
  assert.deepEqual(Object.keys(again.records), Object.keys(key.records), 'same seed, same ids');
  const other = pack({runs, out: tmp(t), seed: '18670012'});
  assert.notDeepEqual(Object.keys(other.records), Object.keys(key.records));
  assert.throws(() => pack({runs, out, seed: 'x'}), /exists/);
});

test('gate combine: both rounds true, else false; the machine part; 2 of 3 per case; 3 of 4 cases', (t) => {
  const runs = tmp(t);
  fakeRuns(runs);
  const k1 = pack({runs, out: tmp(t), seed: '1'}), k2 = pack({runs, out: tmp(t), seed: '2'});
  const answer = (key, f) => '```json\n' + JSON.stringify({records: Object.fromEntries(Object.entries(key.records).map(([id, r]) => [id, f(r)]))}) + '\n```';
  const yes = () => ({a: true, b: true});
  // round 2 splits S-lp-new-1 (b false) and S-lp-new-2 (a false): lp-new has 1/3 -> not judgeable
  const r2 = (r) => ({a: r.run !== 'S-lp-new-2', b: r.run !== 'S-lp-new-1'});
  const rows = countedTrials().map((x) => ({condition: x.condition, case: x.case, run: x.rep, expectReadsAll: x.condition === 'S' && x.name !== 'S-ui02-exhibition-1'}));
  const res = combine({rounds: [{key: k1, text: answer(k1, yes)}, {key: k2, text: answer(k2, r2)}], runsRows: rows});
  assert.deepEqual(res.perCase['lp-new'], {S: '1/3', judgeable: false, B: {a: 3, b: 3, of: 3}});
  assert.equal(res.perCase['ui02-exhibition'].S, '2/3', 'machine part fails in S-ui02-exhibition-1');
  assert.deepEqual([res.judgeableCases, res.gate, res.minOwnerDecidedPairs], [['ui02-exhibition', 'ui03-dashboard', 'ui08-existing-ds'], 'judged', 18]);
  const unread = combine({rounds: [{key: k1, text: 'no json'}, {key: k2, text: answer(k2, yes)}], runsRows: rows});
  assert.deepEqual([unread.gate, unread.judgeableCases], ['未判定', []]);
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
