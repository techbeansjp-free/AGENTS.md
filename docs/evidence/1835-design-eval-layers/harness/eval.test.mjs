// node --test docs/evidence/1835-design-eval-layers/harness/
// Tests of the layer-2/3 evaluation tools on synthetic screenshots (no model, no network, no Docker).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {loadConfig, planItems, screensOf, shotPath, WIDTHS, pngChunks, PNG_KEEP, extractJson, readJson, parseScreen} from './eval-common.mjs';
import {buildPackets} from './make-packets.mjs';
import {runEvaluator, readLedger, spentUsd, budgetPlan} from './run-eval.mjs';
import {computeAll, decideEvaluator} from './aggregate.mjs';
import {buildOwnerPage} from './owner-page.mjs';

const cfg = loadConfig();
const here = path.dirname(new URL(import.meta.url).pathname);

// a 1x1 PNG with metadata chunks that name the condition (they must not reach a packet)
function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); }
function png(label, shade) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from(`Comment\0${label}`, 'latin1')),
    chunk('tIME', Buffer.alloc(7)), chunk('IDAT', zlib.deflateSync(Buffer.from([0, shade, shade, shade]))), chunk('IEND', Buffer.alloc(0))]);
}
function fakeRenderRoot({skip = []} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1835-render-'));
  screensOf(planItems(cfg)).forEach((s, i) => {
    if (skip.includes(s)) return;
    for (const w of WIDTHS) { const f = shotPath(cfg, root, s, w); fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, png(`${s} ${w}`, i)); }
  });
  return root;
}
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const walk = (d) => fs.readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? [path.join(d, e.name), ...walk(path.join(d, e.name))] : [path.join(d, e.name)]));

const render = fakeRenderRoot();
const out = tmp('asc1835-pk-');
const key = buildPackets({cfg, renderRoot: render, out, seed: 'test-seed'});
const pkRoot = path.join(out, 'packets');

test('packets: no condition, trial, variant or case name leaks through names, TASK.json, index or PNG metadata', () => {
  const tokens = [...Object.keys(cfg.cases), ...cfg.layer3.trials, cfg.layer2.base, 'original', ...Object.keys(cfg.layer2.variants), 'hierarchy', 'spacing', 'contrast', 'control', 'L2', 'L3'];
  const files = walk(pkRoot);
  for (const f of files) {
    const rel = path.relative(pkRoot, f);
    for (const t of tokens) assert.ok(!rel.includes(t), `${rel} contains ${t}`);
    if (f.endsWith('.png')) {
      assert.match(path.basename(f), /^[a-z][a-z0-9]{3}-(narrow|wide)\.png$/);
      for (const c of pngChunks(fs.readFileSync(f))) assert.ok(PNG_KEEP.has(c.type), `${rel} keeps chunk ${c.type}`);
      assert.ok(!fs.readFileSync(f).includes(Buffer.from('ui0')), `${rel} has a case name in its bytes`);
    }
    if (f.endsWith('.json')) { const s = fs.readFileSync(f, 'utf8'); for (const t of tokens) assert.ok(!s.includes(t), `${rel} mentions ${t}`); }
    if (f.endsWith('BRIEF.md')) { const s = fs.readFileSync(f, 'utf8'); for (const t of [...cfg.layer3.trials, ...Object.keys(cfg.layer2.variants)]) assert.ok(!s.includes(t), `${rel} brief mentions ${t}`); }
    assert.equal(Math.round(fs.statSync(f).mtimeMs / 1000), 946684800, `${rel} mtime is fixed`);
  }
  // the key is outside the packets, and every packet is self-contained
  assert.ok(path.relative(pkRoot, path.join(out, 'key/key.json')).startsWith('..'));
  for (const [pk, p] of Object.entries(key.packets)) {
    const dir = path.join(pkRoot, `round${p.round}`, pk);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['BRIEF.md', 'TASK.json', 'shots']);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'shots')).sort(), Object.keys(p.ids).flatMap((id) => [`${id}-narrow.png`, `${id}-wide.png`]).sort());
  }
});

test('packets: counts, unique ids, and new ids/sides/orders in round 2', () => {
  const ps = Object.values(key.packets), count = (r, m) => ps.filter((p) => p.round === r && p.method === m).length;
  for (const r of [1, 2]) { assert.equal(count(r, 'P'), 27); assert.equal(count(r, 'F'), 27); assert.equal(count(r, 'D'), 3); }
  const ids = ps.flatMap((p) => Object.keys(p.ids));
  assert.equal(new Set(ids).size, ids.length, 'ids are unique over both rounds');
  const r1 = new Set(ps.filter((p) => p.round === 1).flatMap((p) => Object.keys(p.ids)));
  assert.ok(ps.filter((p) => p.round === 2).flatMap((p) => Object.keys(p.ids)).every((i) => !r1.has(i)));
  // P: each pair shows its first screen as A once and as B once; round 1 is balanced
  const items = key.items.filter((i) => !i.excluded);
  for (const it of items) {
    const sides = [1, 2].map((r) => { const p = ps.find((x) => x.round === r && x.method === 'P' && x.item === it.id); return p.ids[p.task.A] === it.first; });
    assert.notEqual(sides[0], sides[1], `${it.id} swaps sides`);
  }
  const firstA = ps.filter((p) => p.round === 1 && p.method === 'P' && p.ids[p.task.A] === items.find((i) => i.id === p.item).first).length;
  assert.ok(Math.abs(firstA - items.length / 2) <= 0.5 + 1e-9, `balanced: ${firstA}/${items.length}`);
  // D: the negative control is not in D; the display order changes between rounds
  for (const c of Object.keys(cfg.cases)) {
    const [d1, d2] = [1, 2].map((r) => ps.find((p) => p.round === r && p.method === 'D' && p.case === c));
    for (const p of [d1, d2]) assert.ok(Object.values(p.ids).every((s) => !s.endsWith(cfg.layer2.control)));
    for (const label of ['L2', 'L3']) {
      const ord = (p) => p.task.groups.find((g) => p.groupLayers[g.name] === label).order.map((id) => p.ids[id]).join();
      assert.notEqual(ord(d1), ord(d2), `${c} ${label} order changes`);
    }
  }
});

test('packets: missing screenshots are refused, or excluded with a reason when allowed', () => {
  const miss = 'ui03-dashboard/A-r1/spacing-weak';
  const r = fakeRenderRoot({skip: [miss, 'ui08-existing-ds/E-r1/original']});
  assert.throws(() => buildPackets({cfg, renderRoot: r, out: tmp('asc1835-m-'), seed: 's'}), /missing screenshots/);
  const k = buildPackets({cfg, renderRoot: r, out: tmp('asc1835-m-'), seed: 's', allowMissing: true});
  assert.deepEqual(k.items.filter((i) => i.excluded).map((i) => i.id).sort(), ['L2:ui03-dashboard:spacing-weak', 'L3:ui08-existing-ds:A-r1~E-r1', 'L3:ui08-existing-ds:D-r1~E-r1']);
  assert.ok(!Object.values(k.packets).some((p) => Object.values(p.ids).includes(miss)));
  assert.deepEqual(k.l2Undetermined, []);
});

test('run-eval: paid runs are refused without ASC1835_ALLOW_PAID; --cap-usd is dry-run only', () => {
  const prev = process.env.ASC1835_ALLOW_PAID; delete process.env.ASC1835_ALLOW_PAID;
  try {
    let spawned = 0;
    assert.throws(() => runEvaluator({cfg, packetsRoot: pkRoot, runs: tmp('asc1835-r-'), evaluator: 'fable', dryRun: false, spawn: () => { spawned++; }}), /ASC1835_ALLOW_PAID/);
    assert.equal(spawned, 0);
    process.env.ASC1835_ALLOW_PAID = '1';
    assert.throws(() => runEvaluator({cfg, packetsRoot: pkRoot, runs: tmp('asc1835-r-'), evaluator: 'fable', dryRun: false, capUsd: 1, spawn: () => { spawned++; }}), /dry-run/);
    assert.equal(spawned, 0);
  } finally { if (prev === undefined) delete process.env.ASC1835_ALLOW_PAID; else process.env.ASC1835_ALLOW_PAID = prev; }
});

test('run-eval --dry-run: every path runs for both evaluators; invalid answers are missing; resume skips done calls', () => {
  const runs = tmp('asc1835-r-');
  for (const evaluator of ['fable', 'codex']) {
    const s = runEvaluator({cfg, packetsRoot: pkRoot, runs, evaluator, dryRun: true, capUsd: 1000, dryInvalidEvery: 25});
    assert.equal(s.planned, 2 * (3 + 27 + 27 + 27 + 20));
    assert.equal(s.stopped, null);
    assert.ok(s.invalid > 0, 'some answers are invalid');
    assert.equal(s.valid + s.invalid + s.failed + s.missingInput, s.planned);
    for (const m of ['D', 'P', 'Fc', 'Fs', 'Neg']) assert.ok(fs.readdirSync(path.join(runs, evaluator, 'round1', m)).length > 0);
    const again = runEvaluator({cfg, packetsRoot: pkRoot, runs, evaluator, dryRun: true, capUsd: 1000});
    assert.equal(again.skippedDone, s.planned);
  }
  // command lines: Fable read-only and closed to the packet; Codex read-only sandbox on the packet
  const pk = Object.entries(key.packets).find(([, p]) => p.round === 1 && p.method === 'P')[0];
  const fa = readJson(path.join(runs, 'fable/round1/P', pk, 'argv.json'));
  assert.equal(fa.cwd, path.join(pkRoot, 'round1', pk));
  for (const x of ['--restricted', '--no-session-persistence', '--strict-mcp-config']) assert.ok(fa.args.includes(x));
  assert.equal(fa.args[fa.args.indexOf('--tools') + 1], 'Read,Glob,Grep');
  assert.equal(fa.args[fa.args.indexOf('--output-format') + 1], 'json');
  assert.ok(fa.args.includes('--max-turns') && fa.args.includes('--max-budget-usd'));
  const ca = readJson(path.join(runs, 'codex/round1/P', pk, 'argv.json'));
  assert.deepEqual(ca.args.slice(0, 7), ['exec', '--ephemeral', '-s', 'read-only', '-C', path.join(pkRoot, 'round1', pk), '--skip-git-repo-check']);
  assert.ok(ca.args.includes('--json'));
  // ledger: a header, one line per attempt, Fable costs, Codex costs 0
  const l = readLedger(path.join(runs, 'ledger.jsonl'));
  assert.equal(l[0].type, 'header'); assert.equal(l[0].dryRun, true);
  assert.ok(spentUsd(l, 'fable') > 0); assert.equal(spentUsd(l, 'codex'), 0);
  // a paid run never reuses a dry-run ledger
  process.env.ASC1835_ALLOW_PAID = '1';
  try { assert.throws(() => runEvaluator({cfg, packetsRoot: pkRoot, runs, evaluator: 'codex', dryRun: false, spawn: () => ({status: 0, stdout: ''})}), /dry-run ledger/); } finally { delete process.env.ASC1835_ALLOW_PAID; }
});

test('run-eval --dry-run: the Fable budget stops the run at the cap, and retries are counted (max 1)', () => {
  const runs = tmp('asc1835-r-');
  const s = runEvaluator({cfg, packetsRoot: pkRoot, runs, evaluator: 'fable', dryRun: true, capUsd: 3});
  assert.match(s.stopped, /budget/);
  const l = readLedger(path.join(runs, 'ledger.jsonl'));
  assert.ok(l.some((x) => x.type === 'stop'));
  assert.ok(spentUsd(l, 'fable') <= 3 + 1e-9, `spent ${spentUsd(l, 'fable')}`);
  assert.ok(s.valid + s.invalid < s.planned);
  // Codex is not under the Fable budget
  const c = runEvaluator({cfg, packetsRoot: pkRoot, runs, evaluator: 'codex', dryRun: true, capUsd: 3, methods: ['P'], rounds: [1]});
  assert.equal(c.stopped, null); assert.equal(c.valid + c.invalid, 27);
  // retries
  assert.throws(() => runEvaluator({cfg, packetsRoot: pkRoot, runs: tmp('asc1835-r-'), evaluator: 'codex', dryRun: true, retries: 2}), /retries/);
  const runs2 = tmp('asc1835-r-');
  const r = runEvaluator({cfg, packetsRoot: pkRoot, runs: runs2, evaluator: 'codex', dryRun: true, retries: 1, dryInvalidEvery: 2, methods: ['P'], rounds: [1]});
  assert.ok(r.retried > 0);
  const st = fs.readdirSync(path.join(runs2, 'codex/round1/P')).map((d) => readJson(path.join(runs2, 'codex/round1/P', d, 'status.json')));
  assert.ok(st.every((x) => x.attempts.length <= 2));
  assert.ok(st.some((x) => x.attempts.length === 2 && x.status === 'valid'));
});

test('run-eval plan: the reduction order D -> contrast-strong -> stop', () => {
  const index = readJson(path.join(pkRoot, 'index.json')), negPairs = readJson(path.join(here, '..', 'negation-pairs.json'));
  const p = (perCall) => budgetPlan({index, key, perCall, cfg, negPairs});
  assert.equal(p({D: 0.1, P: 0.05, Fc: 0.05, Fs: 0.01, Neg: 0.01}).decision, 'all');
  assert.equal(p({D: 2, P: 0.1, Fc: 0.1, Fs: 0.02, Neg: 0.02}).decision, 'without D');
  const c = p({D: 2, P: 0.15, Fc: 0.14, Fs: 0.03, Neg: 0.02});
  assert.equal(c.decision, 'without D and contrast-strong');
  assert.equal(c.skip.length, 2 * (3 + 3));
  assert.equal(p({D: 1, P: 0.3, Fc: 0.3, Fs: 0.1, Neg: 0.1}).decision, 'stop: 予算の見込みで未判定');
});

test('extractJson takes the last JSON block or object', () => {
  assert.deepEqual(extractJson('a {"x":1} b\n```json\n{"choice":"A"}\n```'), {choice: 'A'});
  assert.deepEqual(extractJson('理由 {"a":{"b":"}"}} 後'), {a: {b: '}'}});
  assert.equal(extractJson('画像を見られませんでした'), null);
});

// ---- aggregate on small known inputs ----
const items = planItems(cfg);
const smallKey = {rounds: [1, 2], items, l2Undetermined: []};
const layer1 = Object.fromEntries(items.filter((i) => i.layer === 2).map((i) => [i.second, i.kind !== 'contrast']));
const owner = Object.fromEntries(items.filter((i) => i.layer === 3).map((i) => [i.id, 'first']));
function judge(f) { return Object.fromEntries([1, 2].map((r) => [r, Object.fromEntries(items.map((i) => [i.id, f(i, r)]))])); }
const base = (i) => (i.control ? 'same' : 'first');
const Pj = judge((i) => (i.layer === 3 && i.id.endsWith('D-r1~E-r1') ? 'second' : i.id === 'L2:ui02-exhibition:hierarchy-weak' ? 'same' : base(i)));
const good = judge(base); // better than P everywhere
const badL3 = judge((i) => (i.layer === 3 ? 'second' : base(i)));
const failsMin = judge((i) => (i.strength === 'strong' ? 'second' : base(i)));
const fNegOk = {1: {n01: {positive: 5, negative: 1}}, 2: {n01: {positive: 4, negative: 2}}};
const fNegFail = {1: {n01: {positive: 3, negative: 3}}, 2: {n01: {positive: 4, negative: 2}}};
const costs = {fable: {P: {usd: 1}, Fc: {usd: 0.6}, Fs: {usd: 0.3}}};
const ssrNeg = {failures: 0, pairs: Array(10).fill({})};
const run = ({F = good, S = good, P = Pj, fNeg = fNegOk, own = owner, c = costs, nullOne = false, sNeg = ssrNeg} = {}) => {
  const J = {fable: {P, F, S, D: good}, codex: {P, F, S, D: good}};
  if (nullOne) J.codex = {...J.codex, F: {...F, 2: {...F[2], 'L3:ui02-exhibition:A-r1~D-r1': null}}};
  return computeAll({cfg, key: smallKey, J, fNeg: {fable: fNeg, codex: fNeg}, layer1, owner: own, ssrNeg: sNeg, costs: c});
};

test('aggregate: both evaluators pass -> 採用候補, with counts and denominators', () => {
  const r = run();
  assert.equal(r.decisions.F.perEvaluator.fable.result, '合格');
  assert.equal(r.decisions.F.conclusion, '採用候補');
  assert.equal(r.decisions.S.conclusion, '採用候補');
  const P = r.metrics.fable.P;
  assert.deepEqual(P.falsePositive, {n: 0, d: 6, rate: 0});
  assert.deepEqual(P.reproducibility, {n: 27, d: 27, rate: 1});
  assert.deepEqual(P.layer3, {n: 12, d: 18, rate: 12 / 18, ownerDecidedPairs: 9});
  assert.deepEqual(P.strongPassedL1, {n: 12, d: 12, rate: 1}); // hierarchy- and spacing-strong, 3 cases x 2 rounds
  assert.deepEqual(P.weakPassedL1, {n: 10, d: 12, rate: 10 / 12});
  assert.deepEqual(P.sensitivity['contrast-strong/fail'], {n: 6, d: 6, rate: 1});
  assert.equal(r.metrics.fable.D.falsePositive.d, null); // D: not measured
  assert.equal(r.metrics.fable.D.expected, 2 * 24); // the negative control is excluded from D
  assert.deepEqual(r.interEvaluator.P, {n: 54, d: 54, rate: 1});
});

test('aggregate: 不合格, 不採用 (minimum), 未判定 (missing, owner absent, cost, ceiling) branches', () => {
  const a = run({S: badL3});
  assert.equal(a.decisions.S.perEvaluator.fable.result, '不合格');
  assert.equal(a.decisions.S.perEvaluator.fable.conditions['2 層3の一致がP以上'], false);
  assert.equal(a.decisions.S.conclusion, '不採用');
  const b = run({F: failsMin});
  assert.equal(b.decisions.F.perEvaluator.fable.result, '不採用');
  assert.equal(b.decisions.F.conclusion, '不採用');
  const c = run({fNeg: fNegFail});
  assert.equal(c.decisions.F.perEvaluator.codex.result, '不合格');
  assert.equal(c.decisions.F.perEvaluator.codex.conditions['4 否定の反例の失敗が0件'], false);
  const d = run({nullOne: true});
  assert.equal(d.decisions.F.perEvaluator.codex.result, '未判定');
  assert.equal(d.decisions.F.perEvaluator.fable.result, '合格');
  assert.equal(d.decisions.F.conclusion, '未判定');
  const e = run({own: null});
  assert.equal(e.decisions.F.perEvaluator.fable.result, '未判定');
  assert.equal(e.decisions.F.conclusion, '未判定');
  const f = run({c: {fable: {P: {usd: 1}, Fc: {usd: 1.5}, Fs: {usd: 0.6}}}});
  assert.equal(f.decisions.F.cost.ok, false);
  assert.equal(f.decisions.F.conclusion, '未判定');
  assert.equal(f.decisions.S.conclusion, '採用候補'); // S counts only the critique cost (1.5 <= 2)
  const g = run({P: good});
  assert.deepEqual(g.ceiling, ['fable', 'codex']);
  assert.equal(g.decisions.F.conclusion, '未判定');
  const h = run({sNeg: null});
  assert.equal(h.decisions.S.perEvaluator.fable.result, '未判定');
  // the minimum criterion boundary: exactly 2/3 of the strong pairs is enough
  const m = (n) => ({name: 'F', missing: 0, reproducibility: {n: 1, d: 1, rate: 1}, strongPassedL1: {n, d: 3, rate: n / 3}, l1Unknown: [], byKind: {}, weakPassedL1: {n: 1, d: 1, rate: 1}, layer3: {n: 1, d: 1, rate: 1}});
  assert.notEqual(decideEvaluator({m: m(2), P: m(2), neg: {failures: 0, missing: 0, d: 1}}).result, '不採用');
  assert.equal(decideEvaluator({m: m(1), P: m(2), neg: {failures: 0, missing: 0, d: 1}}).result, '不採用');
});

test('ssr.py: the formula on known vectors (no model)', () => {
  const dir = tmp('asc1835-ssr-');
  const e = (k) => Array.from({length: 6}, (_, i) => (i === k ? 1 : 0));
  const anchors = [[0, 1, 2, 3, 4].map(e), [0, 1, 2, 3, 4].map(e)];
  fs.writeFileSync(path.join(dir, 'v.json'), JSON.stringify({responses: {a: [1, 2, 3, 4, 5, 0], flat: [0, 0, 0, 0, 0, 1], top: [0, 0, 0, 0, 1, 0]}, anchors}));
  const r = spawnSync('python3', ['-I', path.join(here, 'ssr.py'), 'formula', '--vectors', path.join(dir, 'v.json'), '--out', path.join(dir, 'o.json')], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  const o = readJson(path.join(dir, 'o.json')).results;
  // s_r = r/sqrt(55); p_r = (r-1)/10; E = sum r(r-1)/10 = 4
  o.a.pmf.forEach((p, i) => assert.ok(Math.abs(p - i / 10) < 1e-12));
  assert.ok(Math.abs(o.a.expected - 4) < 1e-12);
  assert.equal(o.flat.degenerate, true); assert.ok(Math.abs(o.flat.expected - 3) < 1e-12);
  assert.ok(Math.abs(o.top.expected - 5) < 1e-12);
});

test('owner page: 9 pairs, embedded images only, no condition names, key kept apart', () => {
  const dir = tmp('asc1835-owner-');
  const r = buildOwnerPage({cfg, renderRoot: render, out: dir, seed: 'owner-test'});
  assert.equal(r.pairs, 9);
  const html = fs.readFileSync(path.join(dir, 'owner-page.html'), 'utf8');
  for (const t of [...Object.keys(cfg.cases), ...cfg.layer3.trials, 'original', ...Object.keys(cfg.layer2.variants)]) assert.ok(!html.includes(t), `page mentions ${t}`);
  assert.ok(!/(src|href)=["']?(https?:|\/\/)/.test(html), 'no external resource');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  for (const v of ['A', 'B', '同等', '判断しない']) assert.ok(html.includes(`value="${v}"`));
  const k = readJson(path.join(dir, 'owner-key.json'));
  assert.equal(Object.keys(k.pairs).length, 9);
  assert.deepEqual(Object.values(k.pairs).map((p) => p.item).sort(), items.filter((i) => i.layer === 3).map((i) => i.id).sort());
  assert.ok(Object.values(k.pairs).every((p) => parseScreen(p.A).case === parseScreen(p.B).case));
});
