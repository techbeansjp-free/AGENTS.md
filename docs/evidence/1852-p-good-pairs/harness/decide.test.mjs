import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {binomTail, criticalK, combine, decide} from './decide.mjs';
import {selectPairs, EXCLUDED} from './select-pairs.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/eval.json'), 'utf8'));

test('config layer3.pairs is the output of select-pairs with the default seed', () => {
  assert.deepEqual(cfg.layer3.pairs, selectPairs());
});
test('selection: 12 pairs per case, 2 per condition pair, no #1835 pair, distinct runs within a condition pair, no duplicates', () => {
  for (const [c, ps] of Object.entries(cfg.layer3.pairs)) {
    assert.equal(ps.length, 12, c);
    const ids = ps.map(([a, b]) => `${a}~${b}`);
    assert.equal(new Set(ids).size, 12);
    for (const id of ids) assert.ok(!EXCLUDED.has(id), id);
    const by = {};
    for (const [a, b] of ps) (by[a[0] + b[0]] ??= []).push([a, b]);
    assert.equal(Object.keys(by).length, 6);
    for (const [k, v] of Object.entries(by)) { assert.equal(v.length, 2, k); assert.notEqual(v[0][0], v[1][0]); assert.notEqual(v[0][1], v[1][1]); }
  }
});
test('binomial tail and critical k (n=24: 17, n=36: 24)', () => {
  assert.ok(Math.abs(binomTail(24, 17) - 0.0320) < 1e-3);
  assert.equal(criticalK(24), 17); assert.equal(criticalK(36), 24); assert.equal(criticalK(30), 20);
  assert.equal(binomTail(10, 0), 1);
});
test('combine: agree -> that judgment, split -> same, any missing -> null', () => {
  assert.equal(combine(['first', 'first']), 'first');
  assert.equal(combine(['first', 'second']), 'same');
  assert.equal(combine(['first', null]), null);
});

const mk = (n) => Array.from({length: n}, (_, i) => ({id: `L3:c:${i}`}));
const judge = (items, f) => Object.fromEntries([1, 2].map((r) => [r, Object.fromEntries(items.map((it, i) => [it.id, f(i, r)]))]));
const rule = cfg.decision;
test('decide: adopted only when both evaluators pass the test; missing counts against; too few decided pairs is undetermined', () => {
  const items = mk(36), owner = Object.fromEntries(items.map((it, i) => [it.id, i < 30 ? 'first' : 'same']));
  const good = judge(items, (i) => (i < 22 ? 'first' : 'second')); // 22/30 agree: p = 0.008
  const weak = judge(items, (i) => (i < 18 ? 'first' : 'second')); // 18/30: p = 0.18
  let r = decide({items, J: {fable: good, codex: good}, rounds: [1, 2], owner, rule});
  assert.equal(r.perEvaluator.fable.agree, 22); assert.equal(r.perEvaluator.fable.n, 30); assert.equal(r.conclusion, '採用');
  r = decide({items, J: {fable: good, codex: weak}, rounds: [1, 2], owner, rule});
  assert.equal(r.perEvaluator.codex.result, '不採用'); assert.equal(r.conclusion, '不採用');
  const missing = judge(items, (i, rd) => (i < 22 ? (rd === 2 && i < 6 ? null : 'first') : 'second')); // 6 missing -> 16/30
  r = decide({items, J: {fable: missing, codex: good}, rounds: [1, 2], owner, rule});
  assert.equal(r.perEvaluator.fable.agree, 16); assert.equal(r.perEvaluator.fable.missingOnDecided, 6); assert.equal(r.perEvaluator.fable.result, '不採用');
  const few = Object.fromEntries(items.map((it, i) => [it.id, i < 23 ? 'first' : 'same']));
  r = decide({items, J: {fable: good, codex: good}, rounds: [1, 2], owner: few, rule});
  assert.equal(r.conclusion, '未判定');
  r = decide({items, J: {fable: good, codex: good}, rounds: [1, 2], owner, rule, budgetStopped: true});
  assert.equal(r.conclusion, '未判定');
});
test('decide: split rounds become same and do not agree with an owner choice', () => {
  const items = mk(24), owner = Object.fromEntries(items.map((it) => [it.id, 'first']));
  const split = judge(items, (i, rd) => (rd === 1 ? 'first' : 'second'));
  const r = decide({items, J: {fable: split, codex: split}, rounds: [1, 2], owner, rule});
  assert.equal(r.perEvaluator.fable.agree, 0); assert.equal(r.perEvaluator.fable.pSameOnDecided, 24); assert.equal(r.perEvaluator.fable.reproducibility.n, 0);
});

test('pJudgments: orientation through the key when the A/B sides change between rounds; invalid answers are missing', async () => {
  const os = await import('node:os');
  const {pJudgments} = await import('./decide.mjs');
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'asc1852-'));
  const key = {rounds: [1, 2], items: [{id: 'L3:c:x', first: 'c/A-r1/original', second: 'c/B-r1/original'}],
    packets: {pk1: {round: 1, method: 'P', item: 'L3:c:x', task: {A: 'a1', B: 'b1'}, ids: {a1: 'c/A-r1/original', b1: 'c/B-r1/original'}},
      pk2: {round: 2, method: 'P', item: 'L3:c:x', task: {A: 'a2', B: 'b2'}, ids: {a2: 'c/B-r1/original', b2: 'c/A-r1/original'}}}};
  const put = (e, r, pk, st) => { const d = path.join(runs, e, `round${r}`, 'P', pk); fs.mkdirSync(d, {recursive: true}); fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify(st)); };
  put('fable', 1, 'pk1', {status: 'valid', answer: {choice: 'A'}}); // A = first
  put('fable', 2, 'pk2', {status: 'valid', answer: {choice: 'B'}}); // B = first (sides swapped)
  put('codex', 1, 'pk1', {status: 'valid', answer: {choice: '同等'}});
  put('codex', 2, 'pk2', {status: 'invalid', answer: null});
  const J = pJudgments({key, runs});
  assert.deepEqual([J.fable[1]['L3:c:x'], J.fable[2]['L3:c:x']], ['first', 'first']);
  assert.deepEqual([J.codex[1]['L3:c:x'], J.codex[2]['L3:c:x']], ['same', null]);
  fs.rmSync(runs, {recursive: true});
});
test('decide: no decided pair is undetermined (not adopted by a null p-value)', () => {
  const items = mk(3), owner = Object.fromEntries(items.map((it) => [it.id, 'same']));
  const r = decide({items, J: {fable: judge(items, () => 'first'), codex: judge(items, () => 'first')}, rounds: [1, 2], owner, rule: {...rule, minOwnerDecidedPairs: 0}});
  assert.equal(r.perEvaluator.fable.result, '未判定');
});
