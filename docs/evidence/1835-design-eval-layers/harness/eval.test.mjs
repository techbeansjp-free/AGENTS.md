// node --test docs/evidence/1835-design-eval-layers/harness/
// Tests of the layer-2/3 evaluation tools on synthetic screenshots (no model, no network, no Docker).
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawnSync, spawn} from 'node:child_process';
import {loadConfig, planItems, screensOf, shotPath, WIDTHS, pngChunks, PNG_KEEP, extractJson, readJson, parseScreen} from './eval-common.mjs';
import {buildPackets} from './make-packets.mjs';
import {rate, combine} from './ssr.mjs';
import {runEvaluator, readLedger, spentUsd, budgetPlan, parseFable, parseCodex, checkImagesRead, acquireLocks} from './run-eval.mjs';
import {computeAll, decideEvaluator, missingByReason, excludeSkipped, collectJudgments, negationFailures, loadLayer1, ssrNegation} from './aggregate.mjs';
import {newFailures} from './layer1.mjs';
import {layer1CommandFailures} from './run-layer1.mjs';
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
  assert.equal(fa.args[fa.args.indexOf('--output-format') + 1], 'stream-json'); assert.ok(fa.args.includes('--verbose'));
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

test('run-eval trace checks: all images read / one unread / a path outside the packet (dry-run fake output in the CLI event shapes)', () => {
  const only = new Set([Object.entries(key.packets).find(([, p]) => p.round === 1 && p.method === 'P')[0]]);
  const one = (evaluator, dryTrace) => {
    const runs = tmp('asc1835-t-');
    const s = runEvaluator({cfg, packetsRoot: pkRoot, runs, evaluator, dryRun: true, capUsd: 1000, methods: ['P'], rounds: [1], only, dryTrace});
    const id = [...only][0], st = readJson(path.join(runs, evaluator, 'round1/P', id, 'status.json'));
    return {s, st, runs, id};
  };
  // Fable
  let r = one('fable', 'all');
  assert.equal(r.st.status, 'valid'); assert.equal(r.st.missingReason, null);
  assert.equal(r.st.attempts[0].trace.imagesExpected, 4); assert.equal(r.st.attempts[0].trace.imagesRead, 4);
  r = one('fable', 'skip-one');
  assert.equal(r.st.status, 'invalid'); assert.equal(r.st.missingReason, 'images-not-read'); assert.equal(r.st.attempts[0].trace.unread.length, 1);
  assert.equal(r.s.missingByReason['images-not-read'], 1);
  assert.ok(r.st.attempts[0].chargedUsd > 0, 'a call with a result is still charged');
  const m = missingByReason(r.runs); assert.equal(m.fable.byReason['images-not-read'], 1); assert.equal(m.fable.valid, 0);
  // no final result event: no answer, cost charged at the call's budget
  r = one('fable', 'no-result');
  assert.equal(r.st.status, 'failed'); assert.equal(r.st.attempts[0].costMissing, true); assert.equal(r.st.attempts[0].chargedUsd, cfg.limits.fable.P.maxBudgetUsd); assert.equal(r.st.missingReason, 'no-result-event');
  // Codex
  r = one('codex', 'all');
  assert.equal(r.st.status, 'valid'); assert.equal(r.st.isolation, 'checked'); assert.equal(r.st.attempts[0].trace.commands, 4);
  r = one('codex', 'outside');
  assert.equal(r.st.status, 'invalid'); assert.equal(r.st.missingReason, 'isolation-violation'); assert.equal(r.st.attempts[0].trace.outside.length, 1);
  r = one('codex', 'odd');
  assert.equal(r.st.status, 'valid'); assert.equal(r.st.isolation, 'unconfirmed'); assert.equal(r.s.isolationUnconfirmed, 1);
  assert.equal(missingByReason(r.runs).codex.isolationUnconfirmed, 1);
  // parsers on hand-written events
  const f = parseFable([{type: 'assistant', message: {content: [{type: 'tool_use', name: 'Read', input: {file_path: '/x/a.png'}}, {type: 'tool_use', name: 'Grep', input: {pattern: 'p', path: '/x'}}]}},
    {type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.5, duration_ms: 7, usage: {input_tokens: 1, output_tokens: 2}}].map((x) => JSON.stringify(x)).join('\n'));
  assert.deepEqual(f.toolCalls.map((t) => t.name), ['Read', 'Grep']); assert.equal(f.usd, 0.5); assert.equal(f.durationMs, 7);
  const c = parseCodex(JSON.stringify({type: 'item.completed', item: {type: 'command_execution', command: 'cat $HOME/x'}}), '/p');
  assert.equal(c.isolation.state, 'unconfirmed');
  assert.equal(parseCodex(JSON.stringify({type: 'item.completed', item: {type: 'command_execution', command: 'sed -n 1,5p /etc/passwd'}}), '/p').isolation.state, 'violation');
});

test('run-eval plan: the reduction order D -> contrast-strong -> stop', () => {
  const index = readJson(path.join(pkRoot, 'index.json')), negPairs = readJson(path.join(here, '..', 'negation-pairs.json'));
  // The thresholds below assume a projection line of 18 USD (the original plan), independent of config/eval.json.
  const cfg18 = {...cfg, budget: {...cfg.budget, projectionLimitUsd: 18}};
  const p = (perCall) => budgetPlan({index, key, perCall, cfg: cfg18, negPairs});
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

test('ssr: the formula on known vectors, and the recorded results/ssr.json recomputed from its similarities', () => {
  const e = (k) => Array.from({length: 6}, (_, i) => (i === k ? 1 : 0));
  const anchors = [[0, 1, 2, 3, 4].map(e), [0, 1, 2, 3, 4].map(e)];
  const a = rate([1, 2, 3, 4, 5, 0], anchors), flat = rate([0, 0, 0, 0, 0, 1], anchors), top = rate([0, 0, 0, 0, 1, 0], anchors);
  // s_r = r/sqrt(55); p_r = (r-1)/10; E = sum r(r-1)/10 = 4
  a.pmf.forEach((p, i) => assert.ok(Math.abs(p - i / 10) < 1e-12));
  assert.ok(Math.abs(a.expected - 4) < 1e-12);
  assert.equal(flat.degenerate, true); assert.ok(Math.abs(flat.expected - 3) < 1e-12);
  assert.ok(Math.abs(top.expected - 5) < 1e-12);
  // the main run (ssr.py): every pmf and expected value follows from the recorded similarities by this formula
  const rec = readJson(path.join(here, '..', 'results', 'ssr.json')).results;
  assert.equal(Object.keys(rec).length, 96);
  for (const [id, r] of Object.entries(rec)) {
    const c = combine(r.sets.map((s) => s.similarities));
    assert.ok(Math.abs(c.expected - r.expected) < 1e-9, id);
    c.pmf.forEach((p, k) => assert.ok(Math.abs(p - r.pmf[k]) < 1e-9, id));
    assert.equal(c.degenerate, !!r.degenerate, id);
  }
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

test('codex: images-not-viewed from an image error or an answer that says the screenshots could not be seen', async () => {
  const {checkCodexImagesViewed, buildPrompt} = await import('./run-eval.mjs');
  assert.equal(checkCodexImagesViewed({stderr: 'ERROR codex_core::tools::router: error=unable to process image: invalid', text: ''}), 'image-error');
  assert.equal(checkCodexImagesViewed({text: 'A・Bともに画像を確認できませんでした。'}), 'answer-says-not-seen');
  assert.equal(checkCodexImagesViewed({text: '狭幅・広幅のスクリーンショットはどちらも閲覧できていません。'}), 'answer-says-not-seen');
  assert.equal(checkCodexImagesViewed({text: 'Aは要約が最上部にあり、対処が必要な項目がすぐ見える。'}), null);
  assert.equal(checkCodexImagesViewed({text: '保存中のボタンの状態は、画像からは確認できませんでした。'}), null);
  assert.equal(checkCodexImagesViewed({text: '画像を開けませんでした。'}), 'answer-says-not-seen');
  assert.equal(checkCodexImagesViewed({text: 'スクリーンショットを読めませんでした。'}), 'answer-says-not-seen');
  // remarks about what a screenshot shows are not "not seen"
  assert.equal(checkCodexImagesViewed({text: '画像から読み取れる範囲では、保存の失敗の表示は確認できない。'}), null);
  assert.equal(checkCodexImagesViewed({text: '狭幅の画像では、詳細の開閉の状態が分からない。'}), null);
  assert.equal(checkCodexImagesViewed({text: '画像を見る限り、確認できない状態がある。'}), null);
  const cfg = JSON.parse(fs.readFileSync(path.join(here, '..', 'config', 'eval.json'), 'utf8'));
  assert.ok(buildPrompt('P', cfg, {evaluator: 'codex'}).includes('読取りだけのcommand'));
  assert.ok(!buildPrompt('P', cfg, {evaluator: 'fable'}).includes('読取りだけのcommand'));
});

test('aggregate: --skip-packets excludes a layer-2 item only when all its P and F packets are skipped', () => {
  const sec = 'c/A-r1/contrast-strong', org = 'c/A-r1/original';
  const key = {rounds: [1], items: [{id: 'a', layer: 2, second: sec}, {id: 'b', layer: 2, second: 'c/A-r1/spacing-weak'}, {id: 'd', layer: 2, second: sec, excluded: 'earlier'}],
    packets: {p1: {round: 1, method: 'P', ids: {x: org, y: sec}}, f1: {round: 1, method: 'F', ids: {y: sec}}, f2: {round: 1, method: 'F', ids: {z: org}}}};
  assert.deepEqual(excludeSkipped(key, ['p1', 'f1']).items.map((i) => i.excluded ?? null), ['予算の削り方で本番から外した（計画5.2）', null, 'earlier']);
  assert.equal(key.items[0].excluded, undefined); // the input is not changed
  assert.throws(() => excludeSkipped(key, ['p1']), /covers 1\/2 packets/);
  assert.deepEqual(excludeSkipped(key, []).items.map((i) => i.excluded ?? null), [null, null, 'earlier']);
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1835-skip-'));
  fs.mkdirSync(path.join(runs, 'codex', 'round1', 'Fc', 'f1'), {recursive: true});
  fs.writeFileSync(path.join(runs, 'codex', 'round1', 'Fc', 'f1', 'status.json'), '{"status":"valid"}');
  assert.throws(() => excludeSkipped(key, ['p1', 'f1'], runs), /has a run record \(codex\/Fc\)/);
  assert.throws(() => excludeSkipped(key, ['nope'], runs), /unknown packet/);
});

test('aggregate: excluded items are reported as excluded, not counted as missing', () => {
  const ex = items.find((i) => i.variant === 'contrast-strong');
  const key = {...smallKey, items: items.map((i) => (i.variant === 'contrast-strong' ? {...i, excluded: 'budget'} : i))};
  const drop = (j) => Object.fromEntries(Object.entries(j).map(([r, x]) => [r, {...x, [ex.id]: null}]));
  const J = {fable: {P: drop(Pj), F: drop(good), S: drop(good), D: good}, codex: {P: drop(Pj), F: drop(good), S: drop(good), D: good}};
  const r = computeAll({cfg, key, J, fNeg: {fable: fNegOk, codex: fNegOk}, layer1, owner, ssrNeg, costs});
  assert.equal(r.metrics.fable.P.missing, 0);
  assert.ok(r.excludedItems.some((x) => x.id === ex.id && x.why === 'budget'));
  assert.equal(r.items, items.length - items.filter((i) => i.variant === 'contrast-strong').length);
});

test('fable: a Read whose tool_result is an error does not count as reading the image', () => {
  const ev = [{type: 'assistant', message: {content: [{type: 'tool_use', id: 't1', name: 'Read', input: {file_path: '/x/a.png'}}, {type: 'tool_use', id: 't2', name: 'Read', input: {file_path: '/x/b.png'}}]}},
    {type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'error'}, {type: 'tool_result', tool_use_id: 't2', content: [{type: 'image'}]}]}},
    {type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.1, usage: {}}];
  const f = parseFable(ev.map((x) => JSON.stringify(x)).join('\n'));
  assert.deepEqual(f.toolCalls.map((t) => t.ok), [false, true]);
  const r = checkImagesRead({toolCalls: f.toolCalls, images: ['/x/a.png', '/x/b.png'], cwd: '/x'});
  assert.equal(r.reason, 'images-not-read'); assert.deepEqual(r.unread, ['a.png']);
});

test('aggregate: a planned negation pair with no record in a round is missing', () => {
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1835-neg-'));
  for (const side of ['positive', 'negative']) {
    const d = path.join(runs, 'fable', 'round1', 'Neg', `neg-n01-${side}`); fs.mkdirSync(d, {recursive: true});
    fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify({status: 'valid', answer: {score: side === 'positive' ? 4 : 2}}));
  }
  const key = {rounds: [1, 2], items: [], packets: {}};
  const {fNeg} = collectJudgments({key, runs, cfg, negIds: ['n01']});
  assert.deepEqual(negationFailures(fNeg.fable), {failures: 0, missing: 1, d: 2});
});

test('layer1: a variant with measurement errors is unknown in the aggregate and adds no failure evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1835-l1-'));
  const ok = {pass: true, checks: {a: true}, layer1: {errors: []}};
  fs.writeFileSync(path.join(dir, 'l.json'), JSON.stringify({pages: [{case: 'c', trial: 't', variants: [{variant: 'original', ...ok}, {variant: 'v', pass: false, checks: {a: false}, layer1: {errors: ['first-view.json missing']}}, {variant: 'w', pass: false, checks: {a: false}, layer1: {errors: []}}]}]}));
  const {map} = loadLayer1([path.join(dir, 'l.json')]);
  assert.equal(map['c/t/v'], undefined); assert.equal(map['c/t/w'], false); assert.equal(map['c/t/original'], true);
  const w = {checks: {a: true}, widths: {wide: {}, narrow: {}}, coverage: null};
  assert.deepEqual(newFailures(w, {checks: {a: false}, widths: {wide: {}, narrow: {}}, coverage: null, errors: ['x missing']}), ['unmeasured: x missing']);
  assert.deepEqual(newFailures(w, {checks: {a: false}, widths: {wide: {}, narrow: {}}, coverage: null, errors: []}), ['a']);
  assert.deepEqual(newFailures({...w, errors: ['o missing']}, {checks: {a: false}, widths: {wide: {}, narrow: {}}, coverage: null, errors: []}), ['unmeasured original: o missing']);
  // S's negation result counts planned pairs absent from ssr-negation.json as missing
  assert.deepEqual(ssrNegation({failures: 0, pairs: [{id: 'n01'}]}, ['n01', 'n02']), {failures: 0, missing: 1, d: 2});
});

test('run-layer1: failed commands recorded in failed.txt stop the run (also with --skip-render)', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1835-l1run-'));
  assert.deepEqual(layer1CommandFailures(out), []);
  fs.writeFileSync(path.join(out, 'failed.txt'), 'render\nui02__A-r1__original\n');
  assert.deepEqual(layer1CommandFailures(out), ['render', 'ui02__A-r1__original']);
});

// #1860: overlapping runs keep --lock paths closed until the last one ends
const lockDirs = [];
after(() => { for (const d of lockDirs) { try { fs.chmodSync(d, 0o750); } catch {} } });
const lockDir = () => { const d = path.join(tmp('asc1860-'), 'key'); fs.mkdirSync(d); fs.chmodSync(d, 0o750); lockDirs.push(d); return d; };
// a separate process that takes the lock, says "locked", and releases it when its stdin ends
function holderProc(d) {
  const src = `import {acquireLocks} from ${JSON.stringify(new URL('./run-eval.mjs', import.meta.url).href)};
const r = acquireLocks([${JSON.stringify(d)}]); console.log('locked'); process.stdin.resume(); process.stdin.on('end', () => { r(); process.exit(0); });`;
  const c = spawn(process.execPath, ['--input-type=module', '-e', src], {stdio: ['pipe', 'pipe', 'inherit']});
  const ready = new Promise((res, rej) => { c.stdout.on('data', (b) => { if (String(b).includes('locked')) res(); }); c.on('exit', (code) => rej(new Error(`holder exited ${code}`))); });
  const exited = new Promise((res) => c.on('exit', res));
  return {ready, release: () => { c.stdin.end(); return exited; }};
}
const modeOf = (d) => fs.statSync(d).mode & 0o777;
const leftovers = (d) => fs.readdirSync(path.dirname(d)).filter((n) => n !== 'key');

test('--lock: overlapping holders keep mode 000 until the last release, in either end order and with three holders', () => {
  for (const order of [[0, 1], [1, 0], [2, 0, 1]]) {
    const d = lockDir();
    const rel = order.map(() => acquireLocks([d]));
    assert.equal(modeOf(d), 0);
    order.forEach((i, k) => {
      rel[i]();
      assert.equal(modeOf(d), k === order.length - 1 ? 0o750 : 0, `order ${order} after ${k + 1} releases`);
    });
    assert.deepEqual(leftovers(d), [], 'no state or mutex file is left');
  }
});

test('--lock: a single holder restores the mode and leaves no file, also when its run throws', () => {
  const d = lockDir();
  const rel = acquireLocks([d]); assert.equal(modeOf(d), 0); rel();
  assert.equal(modeOf(d), 0o750); assert.deepEqual(leftovers(d), []);
  assert.throws(() => { const r = acquireLocks([d]); try { throw new Error('run failed'); } finally { r(); } }, /run failed/);
  assert.equal(modeOf(d), 0o750); assert.deepEqual(leftovers(d), []);
});

test('--lock: a holder that throws, ending first or last, does not open the path while another holder runs', () => {
  for (const throwsFirst of [true, false]) {
    const d = lockDir();
    const a = acquireLocks([d]), b = acquireLocks([d]);
    const failing = throwsFirst ? a : b, other = throwsFirst ? b : a;
    if (throwsFirst) {
      assert.throws(() => { try { throw new Error('boom'); } finally { failing(); } }, /boom/);
      assert.equal(modeOf(d), 0); other(); assert.equal(modeOf(d), 0o750);
    } else {
      other(); assert.equal(modeOf(d), 0);
      assert.throws(() => { try { throw new Error('boom'); } finally { failing(); } }, /boom/);
      assert.equal(modeOf(d), 0o750);
    }
    assert.deepEqual(leftovers(d), []);
  }
});

test('--lock: a state file left by dead runs stops the run and keeps the recorded mode; a failed acquire releases what it took', () => {
  const d = lockDir();
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)']).stdout.toString().trim();
  fs.chmodSync(d, 0);
  fs.writeFileSync(`${d}.asc-lock.json`, JSON.stringify({mode: 0o750, holders: [{pid: Number(dead), token: 'x'}]}));
  const other = lockDir();
  assert.throws(() => acquireLocks([other, d]), /no longer alive.*750/s);
  assert.equal(modeOf(other), 0o750, 'the path locked before the failure is restored');
  assert.deepEqual(leftovers(other), []);
  assert.equal(modeOf(d), 0);
  fs.rmSync(`${d}.asc-lock.json`); fs.chmodSync(d, 0o750);
});

test('run --dry-run --lock: a CLI run that ends (normally or with an error) while another run holds the lock leaves the path closed', async () => {
  const d = lockDir();
  const h = holderProc(d); await h.ready;
  const holder = () => h.release();
  const cli = (evaluator) => spawnSync(process.execPath, [path.join(here, 'run-eval.mjs'), 'run', '--packets', pkRoot, '--runs', tmp('asc1860-r-'),
    '--evaluator', evaluator, '--methods', 'D', '--dry-run', '--cap-usd', '1000', '--lock', d], {encoding: 'utf8'});
  const ok = cli('fable');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(modeOf(d), 0, 'the CLI run ended first and did not open the path');
  const bad = cli('nobody');
  assert.equal(bad.status, 3);
  assert.equal(modeOf(d), 0, 'a CLI run that failed did not open the path');
  assert.equal(await holder(), 0);
  assert.equal(modeOf(d), 0o750);
  assert.deepEqual(leftovers(d), []);
  const alone = cli('fable');
  assert.equal(alone.status, 0, alone.stderr);
  assert.equal(modeOf(d), 0o750, 'a run alone restores the mode as before');
  assert.deepEqual(leftovers(d), []);
});

test('--lock: holders in separate processes keep mode 000 until the last one ends, in either end order and with three', async () => {
  for (const order of [[0, 1], [1, 0], [2, 0, 1]]) {
    const d = lockDir();
    const hs = [];
    for (const _ of order) { const h = holderProc(d); await h.ready; hs.push(h); assert.equal(modeOf(d), 0, 'closed right after each start'); }
    for (const [k, i] of order.entries()) {
      assert.equal(await hs[i].release(), 0);
      assert.equal(modeOf(d), k === order.length - 1 ? 0o750 : 0, `order ${order} after ${k + 1} ends`);
    }
    assert.deepEqual(leftovers(d), []);
  }
});

test('--lock: processes that start at the same time all get the lock (the mutex is contended) and the last end restores it', async () => {
  const d = lockDir();
  const hs = Array.from({length: 6}, () => holderProc(d));
  await Promise.all(hs.map((h) => h.ready));
  assert.equal(modeOf(d), 0);
  assert.equal(JSON.parse(fs.readFileSync(`${d}.asc-lock.json`, 'utf8')).holders.length, 6);
  for (const h of hs.slice(0, 5)) { assert.equal(await h.release(), 0); assert.equal(modeOf(d), 0); }
  assert.equal(await hs[5].release(), 0);
  assert.equal(modeOf(d), 0o750);
  assert.deepEqual(leftovers(d), []);
});

test('--lock: the same path twice in one run is taken once and released cleanly', () => {
  const d = lockDir();
  const r = acquireLocks([d, d]);
  assert.equal(JSON.parse(fs.readFileSync(`${d}.asc-lock.json`, 'utf8')).holders.length, 1);
  r();
  assert.equal(modeOf(d), 0o750);
  assert.deepEqual(leftovers(d), []);
});
