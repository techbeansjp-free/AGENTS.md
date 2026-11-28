// #1867 review L-7: the Monte Carlo estimate of the plan's table (../EVAL_PLAN.md「規模と、誤った不採用の率・検出力」).
// It applies decide.mjs decide itself (the same rules, not a copy) to synthetic records. No model call.
//   node docs/evidence/1867-design-persona/harness/power-sim.mjs [--runs 400000] [--seed 1867] [--rates 0.5,0.6,0.7,0.8]
//        [--p-missing <q>] [--screen-missing <m>]
// Assumptions (the plan; an estimate, not a measurement):
//   - The owner decides a pair with probability 25/36 (#1852); a decided pair is S with probability "the S rate", else B.
//     Undecided pairs are 同等. Pairs and cases are independent (in fact a screen is in 3 pairs, so they are correlated).
//   - Layer 2: on a same-round pair the owner chose B, every P judgment is B (an alarm for B) with probability 14/25
//     (#1852: an alarm on the owner's side); otherwise no alarm for B. Alarms on other pairs cannot be confirmed harms.
//   - The gate judges all 4 cases (n >= 24); the generation completes; layer 1 passes every measured screen (equal S and B
//     failure rates are left out). Costs: generation 8, gate 1.8, Fable 5 USD (the layer-2 cap is 8).
//   - --p-missing q: each P judgment (evaluator x round x pair) is missing with probability q (review L-4).
//   - --screen-missing m: each of the 24 screens is missing with probability m (review M-2; layer 1 then fails it).
// Output: per S rate, the rates of 採用, 不採用 (and those by the harm rules, in total and per layer 1, 2 and 3), 未判定 (step 0,
// step 3), and "binomial only": the rate of p <= alpha over the owner's decided pairs alone, without the n lower bound
// and without the harm rules (the table's 採用 also needs n >= 24 and no harm).
import {decide, layer2Cap, EVAL_JSON, GATE_JSON} from './decide.mjs';
import {loadConfig, planItems, readJson} from '../../1835-design-eval-layers/harness/eval-common.mjs';
import {CASES, CONDITIONS, REPS} from './trials.mjs';

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export function simulate({runs = 400000, seed = 1867, sRate, pMissing = 0, screenMissing = 0, decidedRate = 25 / 36, alarmOnOwnerB = 14 / 25}) {
  const cfg = loadConfig(EVAL_JSON), gateCfg = readJson(GATE_JSON);
  const items = planItems(cfg).filter((i) => i.layer === 3);
  const pIds = new Set(Object.entries(cfg.pPairs).flatMap(([c, ps]) => ps.map(([a, b]) => `L3:${c}:${a}~${b}`)));
  const pItems = items.filter((i) => pIds.has(i.id));
  const screens = CASES.flatMap((c) => CONDITIONS.flatMap((cond) => REPS.map((r) => ({c, slot: `${cond}-r${r}`, screen: `${c}/${cond}-r${r}/original`}))));
  const judge = {judgement: {verdict: 'meets-levels'}, completion: {spentUsd: 8, complete: true, capReached: false, basis: 'complete'}};
  const gate = {gate: 'judged', judgeableCases: CASES, minOwnerDecidedPairs: 24, costUsd: 1.8, costMissing: 0};
  const capUsd = layer2Cap({generationUsd: 8, gateUsd: 1.8, budget: cfg.decision.budget}).capUsd;
  const pass = {answerInitialView: true, noOverflowX: true, axeNoSeriousCritical: true, noExternalRequests: true};
  const rnd = mulberry32(seed);
  const t = {runs, adopt: 0, reject: 0, rejectHarm: 0, harmL1: 0, harmL2: 0, harmL3: 0, undecided: 0, step0: 0, step3: 0, binomialOnly: 0};
  for (let x = 0; x < runs; x++) {
    const missing = screenMissing > 0 ? screens.filter(() => rnd() < screenMissing) : [];
    const gone = new Set(missing.map((s) => s.screen));
    const owner = {};
    for (const i of items) owner[i.id] = rnd() < decidedRate ? (rnd() < sRate ? 'first' : 'second') : 'same';
    const J = {fable: {1: {}, 2: {}}, codex: {1: {}, 2: {}}};
    for (const i of pItems) {
      const v = owner[i.id] === 'second' && rnd() < alarmOnOwnerB ? 'second' : 'same';
      for (const e of ['fable', 'codex']) for (const r of [1, 2]) J[e][r][i.id] = pMissing > 0 && rnd() < pMissing ? null : v;
    }
    const layer1Files = CASES.map((c) => ({pages: screens.filter((s) => s.c === c && !gone.has(s.screen)).map((s) => ({case: c, trial: s.slot, variants: [{variant: 'original', checks: pass, layer1: {errors: []}}]}))}));
    const ownerKey = {seed: cfg.seeds.ownerPage, missingScreens: [...gone], pairs: Object.fromEntries(items.map((i, n) => [`p${n}`, {item: i.id}]))};
    const pKey = {seed: cfg.seeds.packets, rounds: cfg.rounds, missing: [...gone].map((s) => ({screen: s, width: 'wide'}))};
    const r = decide({cfg, judge, gate, owner, ownerKey, pKey, J, layer1Files, fableSpentUsd: 5, gatePerRoundCapUsd: gateCfg.budget.perRoundCapUsd,
      pLedgerHeader: {type: 'header', dryRun: false, capUsd}});
    if (r.layer3.pValue !== null && r.layer3.pValue <= cfg.decision.alpha) t.binomialOnly++;
    if (r.conclusion === '採用') t.adopt++;
    else if (r.conclusion === '不採用') {
      t.reject++;
      if (r.step === 2) {
        t.rejectHarm++;
        if (r.why.some((w) => w.startsWith('層1'))) t.harmL1++;
        if (r.why.some((w) => w.startsWith('層2'))) t.harmL2++;
        if (r.why.some((w) => w.startsWith('層3'))) t.harmL3++;
      }
    } else { t.undecided++; if (r.step === 0) t.step0++; if (r.step === 3) t.step3++; }
  }
  const rate = (k) => Number((t[k] / runs).toFixed(3));
  return {sRate, runs, seed, pMissing, screenMissing, adopt: rate('adopt'), reject: rate('reject'), rejectByHarm: rate('rejectHarm'),
    harmLayer1: rate('harmL1'), harmLayer2: rate('harmL2'), harmLayer3: rate('harmL3'), undecided: rate('undecided'), undecidedStep0: rate('step0'),
    undecidedStep3: rate('step3'), binomialOnly: rate('binomialOnly')};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
  const runs = Number(opt('--runs', 400000)), seed = Number(opt('--seed', 1867));
  for (const s of opt('--rates', '0.5,0.6,0.7,0.8').split(',').map(Number)) {
    console.log(JSON.stringify(simulate({runs, seed, sRate: s, pMissing: Number(opt('--p-missing', 0)), screenMissing: Number(opt('--screen-missing', 0))})));
  }
}
