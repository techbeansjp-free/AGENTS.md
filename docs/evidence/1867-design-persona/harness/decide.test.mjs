// #1867 decide.mjs on synthetic records (review M-4): every branch of the conclusion, the owner's harm rules of
// 2026-11-28, the missing screen (H-1), the missing P judgment (M-2), the n lower bound and the layer-2 cap (M-5).
// node --test docs/evidence/1867-design-persona/harness/   No model call.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide, layer2Cap, layer1Counts, forcedSide, gateCostUsd, EVAL_JSON, GATE_JSON} from './decide.mjs';
import {loadConfig, planItems, readJson} from '../../1835-design-eval-layers/harness/eval-common.mjs';
import {CASES} from './trials.mjs';

const cfg = loadConfig(EVAL_JSON);
const gateCfg = readJson(GATE_JSON);
const items = planItems(cfg).filter((i) => i.layer === 3);
const pIds = Object.entries(cfg.pPairs).flatMap(([c, ps]) => ps.map(([a, b]) => `L3:${c}:${a}~${b}`));
const id = (c, s, b) => `L3:${c}:S-r${s}~B-r${b}`;
const L = {S: 'first', B: 'second', '=': 'same', '-': 'skip'};

// owner choices per case as 9 letters in the eval.json order (S-r1~B-r1, S-r1~B-r2, ..., S-r3~B-r3); '.' = unanswered
function ownerOf(perCase) {
  const o = {};
  for (const c of CASES) cfg.layer3.pairs[c].forEach(([a, b], i) => { const ch = (perCase[c] ?? perCase.all)[i]; if (ch !== '.') o[`L3:${c}:${a}~${b}`] = L[ch]; });
  return o;
}
// P judgments: every evaluator and round the same value per pair (default same); over: {pairId: value | [4 values]}
function jOf(over = {}) {
  const J = {};
  ['fable', 'codex'].forEach((e, ei) => { J[e] = {}; [1, 2].forEach((r, ri) => { J[e][r] = Object.fromEntries(pIds.map((p) => { const v = p in over ? over[p] : 'same'; return [p, Array.isArray(v) ? v[ei * 2 + ri] : v]; })); }); });
  return J;
}
const pass = {answerInitialView: true, noOverflowX: true, axeNoSeriousCritical: true, noExternalRequests: true};
// layer 1: every slot passes unless named in fail ({'<case>/<slot>': {check: false}}) or absent (omit list)
function l1Of(fail = {}, omit = []) {
  return CASES.map((c) => ({pages: ['S', 'B'].flatMap((cond) => [1, 2, 3].map((r) => `${cond}-r${r}`)).filter((t) => !omit.includes(`${c}/${t}`))
    .map((t) => ({case: c, trial: t, variants: [{variant: 'original', checks: {...pass, ...(fail[`${c}/${t}`] ?? {})}, layer1: {errors: fail[`${c}/${t}`]?.errors ?? []}}]}))}));
}
const ownerKeyOf = (missing = []) => ({seed: cfg.seeds.ownerPage, missingScreens: missing, pairs: Object.fromEntries(items.map((i, n) => [`p${n}`, {item: i.id, first: i.first, A: i.first, B: i.second}]))});
const GOOD = 'SSSSSB==S'; // 6 S, 1 B per case: n 28, k 24
function run(o = {}) {
  const missing = o.missing ?? [];
  return decide({cfg, judge: o.judge ?? {judgement: {verdict: 'meets-levels'}, completion: {spentUsd: 8, capReached: false}},
    gate: o.gate ?? {gate: 'judged', judgeableCases: CASES, minOwnerDecidedPairs: 24, costUsd: 1.8, costMissing: 0},
    owner: o.owner ?? ownerOf({all: GOOD}), ownerKey: ownerKeyOf(missing), pKey: {rounds: [1, 2], missing: (o.pMissing ?? missing).map((s) => ({screen: s, width: 'wide'}))},
    J: o.J ?? jOf(), layer1Files: o.l1 ?? l1Of(), fableSpentUsd: o.fable ?? 5, gatePerRoundCapUsd: gateCfg.budget.perRoundCapUsd});
}

test('step 4: 採用 with a clear S preference; 不採用 when the test fails (the meaning: not shown at this scale)', () => {
  const r = run();
  assert.deepEqual([r.conclusion, r.step, r.layer3.n, r.layer3.k, r.layer3.minN], ['採用', 4, 28, 24, 24]);
  const weak = run({owner: ownerOf({all: 'SSSSBBB=='})});
  assert.deepEqual([weak.conclusion, weak.step, weak.layer3.n, weak.layer3.k], ['不採用', 4, 28, 16]);
  assert.match(weak.why[0], /この規模では効果を示せなかった/);
});

test('step 3: n under the lower bound is 未判定; with 3 judged cases the bound is 18 and only their pairs count', () => {
  const few = run({owner: ownerOf({all: 'SSSSS====', 'ui02-exhibition': 'S========'})});
  assert.deepEqual([few.conclusion, few.step, few.layer3.n], ['未判定', 3, 16]);
  const three = run({gate: {gate: 'judged', judgeableCases: ['ui02-exhibition', 'ui03-dashboard', 'ui08-existing-ds'], minOwnerDecidedPairs: 18, costUsd: 1.8, costMissing: 0},
    owner: ownerOf({all: 'SSSSSSB==', 'lp-new': 'BBBBB====' })});
  assert.deepEqual([three.layer3.minN, three.layer3.n, three.layer3.k, three.conclusion], [18, 21, 18, '採用'], 'lp-new (not judged) is outside n and k');
  assert.throws(() => run({gate: {gate: 'judged', judgeableCases: CASES, minOwnerDecidedPairs: 18, costUsd: 0}}), /minOwnerDecidedPairs/);
});

test('step 1: the gate 未判定; step 0 comes first (judge not-judged, the stop line, the cost)', () => {
  assert.deepEqual([run({gate: {gate: '未判定', judgeableCases: ['lp-new'], minOwnerDecidedPairs: 6, costUsd: 1}}).step, run({gate: {gate: '未判定', judgeableCases: [], minOwnerDecidedPairs: 0, costUsd: 1}}).conclusion], [1, '未判定']);
  assert.equal(run({judge: {judgement: {verdict: 'not-judged', reason: 'failure rate'}, completion: {spentUsd: 8}}}).step, 0);
  assert.equal(run({judge: {judgement: {verdict: 'meets-levels'}, completion: {spentUsd: 11.6, capReached: true}}}).step, 0);
  const cost = run({judge: {judgement: {verdict: 'meets-levels'}, completion: {spentUsd: 11.5, capReached: false}}, gate: {gate: 'judged', judgeableCases: CASES, minOwnerDecidedPairs: 24, costUsd: 2.6, costMissing: 0}});
  assert.deepEqual([cost.step, cost.cost.capUsd, cost.cost.start], [0, 5.9, false]);
  assert.equal(run({fable: 8.5}).step, 0, 'Fable over the cap');
  // gate cost unknown: counted at the per-round cap
  assert.equal(run({gate: {gate: 'judged', judgeableCases: CASES, minOwnerDecidedPairs: 24, costUsd: 0.9, costMissing: 2}}).cost.gateUsd, 3.9);
});

test('M-5: the layer-2 cap is min(8, 20 - (generation + gate)); layer 2 starts at 6 or more', () => {
  const b = cfg.decision.budget;
  assert.deepEqual([layer2Cap({generationUsd: 8, gateUsd: 1.8, budget: b}).capUsd, layer2Cap({generationUsd: 11, gateUsd: 2, budget: b}).capUsd, layer2Cap({generationUsd: 11.5, gateUsd: 6, budget: b}).capUsd], [8, 7, 2.5]);
  assert.deepEqual([layer2Cap({generationUsd: 12, gateUsd: 2, budget: b}).start, layer2Cap({generationUsd: 12, gateUsd: 2.01, budget: b}).start], [true, false]);
  assert.equal(gateCostUsd([0.9, null, 0.8], 1.5), 3.2);
});

test('step 2, layer 1: axeNoSeriousCritical worse in S in 2 cases; an unmeasured or absent slot fails', () => {
  const one = run({l1: l1Of({'ui02-exhibition/S-r1': {axeNoSeriousCritical: false}})});
  assert.deepEqual([one.conclusion, one.layer1.axeWorseCases], ['採用', ['ui02-exhibition']]);
  const two = run({l1: l1Of({'ui02-exhibition/S-r1': {axeNoSeriousCritical: false}, 'lp-new/S-r2': {errors: ['render wide: missing']}})});
  assert.deepEqual([two.conclusion, two.step, two.layer1.axeWorseCases], ['不採用', 2, ['ui02-exhibition', 'lp-new']]);
  const absent = run({l1: l1Of({'ui02-exhibition/S-r1': {axeNoSeriousCritical: false}}, ['ui08-existing-ds/S-r3'])});
  assert.deepEqual([absent.step, absent.layer1.perCase['ui08-existing-ds'].S], [2, {failing: 1, axeFailing: 1, unmeasured: 1, of: 3}]);
  const tie = run({l1: l1Of({'ui02-exhibition/S-r1': {axeNoSeriousCritical: false}, 'lp-new/S-r2': {axeNoSeriousCritical: false}, 'lp-new/B-r1': {axeNoSeriousCritical: false}})});
  assert.equal(tie.conclusion, '採用', 'equal counts are not worse');
  assert.deepEqual(run({l1: l1Of({'ui02-exhibition/S-r1': {noOverflowX: false}})}).layer1.failingWorseCases, ['ui02-exhibition'], 'recorded, not decided');
  assert.throws(() => layer1Counts([{pages: [{case: 'lp-new', trial: 'S-r1', variants: [{variant: 'original', checks: pass}]}]}, {pages: [{case: 'lp-new', trial: 'S-r1', variants: [{variant: 'original', checks: pass}]}]}]), /twice/);
});

test('step 2, layer 3 (owner 2026-11-28): business-screen harm only when owner B exceeds S by 3 or more', () => {
  const by2 = run({owner: ownerOf({all: GOOD, 'ui03-dashboard': 'SBBB=====' })});
  assert.deepEqual([by2.conclusion, by2.layer3.businessHarmCases], ['採用', []], 'B 3 to S 1 is a margin of 2');
  const by3 = run({owner: ownerOf({all: GOOD, 'ui08-existing-ds': 'BBB======' })});
  assert.deepEqual([by3.conclusion, by3.step, by3.layer3.businessHarmCases], ['不採用', 2, ['ui08-existing-ds']]);
  assert.deepEqual(run({owner: ownerOf({all: GOOD, 'lp-new': 'BBBBBB===' })}).layer3.businessHarmCases, [], 'a public page is not a business screen');
});

test('step 2, layer 2 (owner 2026-11-28): 2 of 3 confirmed harms count only when the owner chose B more than S in the 9 pairs', () => {
  const c = 'ui02-exhibition';
  const J = jOf({[id(c, 1, 1)]: 'second', [id(c, 2, 2)]: 'second'});
  // owner B on both diagonal pairs (positions 0 and 4), S more often overall: no harm
  const sMore = run({J, owner: ownerOf({all: GOOD, [c]: 'BSSSBSS==' })});
  assert.deepEqual([sMore.conclusion, sMore.layer2.perCase[c].confirmed, sMore.layer2.harmIfFilledS], ['採用', 2, []]);
  const bMore = run({J, owner: ownerOf({all: GOOD, [c]: 'BBBSBS===' })});
  assert.deepEqual([bMore.conclusion, bMore.step, bMore.layer2.harmIfFilledS], ['不採用', 2, [c]]);
  // one confirmed harm is not enough; an alarm without the owner's B is no harm; a split judgment is no alarm
  assert.deepEqual(run({J: jOf({[id(c, 1, 1)]: 'second'}), owner: ownerOf({all: GOOD, [c]: 'BBBSBS===' })}).layer2.harmIfFilledS, []);
  assert.deepEqual(run({J, owner: ownerOf({all: GOOD, [c]: 'SBBBSB===' })}).layer2.perCase[c].confirmed, 0);
  assert.equal(run({J: jOf({[id(c, 1, 1)]: ['second', 'second', 'second', 'first'], [id(c, 2, 2)]: 'second'}), owner: ownerOf({all: GOOD, [c]: 'BBBSBS===' })}).layer2.perCase[c].confirmed, 1);
  assert.equal(run({J}).layer2.perCase[c].alarmsB, 2, 'alarms are reported');
});

test('M-2: a missing P judgment is filled with S and with B; 未判定 only when the layer-2 harm differs', () => {
  const c = 'ui02-exhibition';
  const own = ownerOf({all: GOOD, [c]: 'BBBSBS===' });
  // one confirmed harm, and the second diagonal pair has a missing judgment: filled with B it is a harm -> 未判定
  const und = run({J: jOf({[id(c, 1, 1)]: 'second', [id(c, 2, 2)]: ['second', null, 'second', 'second']}), owner: own});
  assert.deepEqual([und.conclusion, und.step, und.layer2.undecided, und.layer2.missingJudgments.length], ['未判定', 0, true, 1]);
  // the same missing judgment where the owner chose S on that pair: no filling makes a harm -> decided
  const dec = run({J: jOf({[id(c, 1, 1)]: 'second', [id(c, 2, 2)]: ['second', null, 'second', 'second']}), owner: ownerOf({all: GOOD, [c]: 'BBBSSS===' })});
  assert.deepEqual([dec.layer2.undecided, dec.conclusion], [false, '採用']);
  // every judgment missing (e.g. the budget stop), owner B never above S anywhere: decided
  const none = run({J: jOf(Object.fromEntries(pIds.map((p) => [p, null])))});
  assert.deepEqual([none.layer2.missingJudgments.length, none.layer2.undecided, none.conclusion], [48, false, '採用']);
});

test('H-1: a missing screen counts as the other side chosen (owner and P), both missing as 同等; layer 1 fails it', () => {
  assert.deepEqual([forcedSide(items[0], new Set([items[0].first])), forcedSide(items[0], new Set([items[0].second])), forcedSide(items[0], new Set([items[0].first, items[0].second])), forcedSide(items[0], new Set())], ['second', 'first', 'same', null]);
  const c = 'ui08-existing-ds', gone = `${c}/S-r1/original`;
  // the owner chose S on S-r1's pairs; the rule makes them B: ui08 then B 3+1 vs S 3 -> margin 1, no business harm
  const r = run({missing: [gone], owner: ownerOf({all: GOOD, [c]: 'SSSBS====' }), l1: l1Of({}, [`${c}/S-r1`])});
  assert.deepEqual(Object.entries(r.forcedPairs), [[id(c, 1, 1), 'second'], [id(c, 1, 2), 'second'], [id(c, 1, 3), 'second']]);
  assert.deepEqual(r.layer3.perCase[c], {S: 1, B: 4, same: 4, skip: 0, unanswered: 0, of: 9});
  assert.equal(r.layer2.pairs[id(c, 1, 1)].alarm, 'B', 'every P judgment of the pair is B');
  assert.deepEqual(r.layer3.businessHarmCases, [c], 'B 4 vs S 1');
  assert.equal(r.layer1.perCase[c].S.axeFailing, 1);
  // both screens of a pair missing: 同等
  const both = run({missing: [gone, `${c}/B-r1/original`]});
  assert.equal(both.forcedPairs[id(c, 1, 1)], 'same');
  assert.throws(() => run({missing: [gone], pMissing: []}), /missing screens differ/);
});

test('owner choices: 同等, 判断しない and unanswered are outside n', () => {
  const r = run({owner: ownerOf({all: 'SSSSSSB=-', 'lp-new': 'SSSSSSB..'})});
  assert.deepEqual([r.layer3.n, r.layer3.perCase['lp-new'].unanswered, r.layer3.perCase['ui02-exhibition'].skip], [28, 2, 1]);
});
