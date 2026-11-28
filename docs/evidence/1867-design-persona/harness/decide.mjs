// #1867 the decision of the plan (../EVAL_PLAN.md「判定」4 and「層2」), from the records of every layer (review M-4). No model call.
//   cap:    node harness/decide.mjs cap --judge <results/judge.json> --gate-answers <answer>...
//           The layer-2 cap (review M-5): min(layer2MaxUsd, ownerCapUsd - (the generation ledger + the gate count)),
//           and whether layer 2 may start (cap >= layer2MinUsd; else exit 4 and the conclusion is 未判定).
//           Pass every answer file of the gate count, the redos included; an answer without a cost counts at the
//           per-round cap of gate-count.json.
//   decide: node harness/decide.mjs decide --judge <results/judge.json> --gate <gate.json> --owner <owner-answers.json>
//           --owner-key <owner-key.json> --p-key <eval>/key/key.json --p-runs <pruns> --layer1 <l1-case>/layer1.json (x4)
//           --out <result.json> [--config <eval.json>]
//           The conclusion 0-4 (the first that applies) and every number it rests on.
// Rules (eval.json decision, fixed with the plan):
//   - A screen is missing when a width of its screenshot is missing (a valid trial that wrote no page, a page that did not
//     render, a failed trial without a valid one in its slot). Layer 1 counts it failed. Layers 2 and 3 (review H-1): a
//     pair with one side missing counts as the present side chosen (by the owner and by every P judgment), both missing
//     as 同等. The owner's answer on such a pair is not used.
//   - Layer 2: a pair is an alarm when both evaluators chose the same side in both rounds. A confirmed harm is an alarm
//     for B on a pair where the owner chose B. A case has layer-2 harm when confirmed harms >= 2 of 3 and, in its 9
//     layer-3 pairs, the owner chose B more often than S (owner decision 2026-11-28). A P judgment without a valid answer
//     (failed, invalid, images not viewed, isolation, the budget stop) is filled with S and with B; when the conclusion
//     (not only the layer-2 harm) differs between the two, the conclusion is 未判定 (review M-2, L-4). Filling is
//     monotone, so the two extremes cover every filling.
//   - Layer 3: n and k over the cases the gate judged; n >= gate.minOwnerDecidedPairs; one-sided binomial at alpha.
//     Business-screen harm: in ui03 or ui08, owner B - owner S >= 3 (owner decision 2026-11-28). All 4 cases.
//   - The harm rules (layer-3 business harm, layer-2 "owner B more than S") count the wins forced by a missing screen once
//     per missing screen, on either side (review M-2 (b) and the lead's decision); n and k count every pair.
//   - Layer 1 harm: axeNoSeriousCritical failing in more S than B trials (of 3) in >= 2 cases.
//   - Step 0 also covers: the shared harness not-judged, a generation stopped at the stop line without completing (review
//     High-1: capReached && !complete), the layer-2 cap under 6 USD, Fable over the cap.
//   - Checks (review L-2, L-3): the owner-key and P-key seeds and the P rounds are those of eval.json, the P ledger header
//     capUsd is the layer-2 cap, and an unknown owner choice stops.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJson, writeJson, loadConfig, planItems, parseScreen} from '../../1835-design-eval-layers/harness/eval-common.mjs';
import {EVALUATORS, loadOwner} from '../../1835-design-eval-layers/harness/aggregate.mjs';
import {binomTail, criticalK, pJudgments} from '../../1852-p-good-pairs/harness/decide.mjs';
import {answerOf} from './gate-packet.mjs';
import {CASES, CONDITIONS, REPS} from './trials.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EVAL_JSON = path.resolve(here, '../config/layers/eval.json');
export const GATE_JSON = path.resolve(here, '../config/layers/gate-count.json');
const round4 = (x) => Number(x.toFixed(4));

// ---- cost (review M-5, L-1) ----
export function layer2Cap({generationUsd, gateUsd, budget}) {
  const left = budget.ownerCapUsd - generationUsd - gateUsd;
  const capUsd = round4(Math.max(0, Math.min(budget.layer2MaxUsd, left)));
  return {generationUsd: round4(generationUsd), gateUsd: round4(gateUsd), capUsd, start: capUsd >= budget.layer2MinUsd,
    rule: `min(${budget.layer2MaxUsd}, ${budget.ownerCapUsd} - (generation + gate)); layer 2 starts when the cap >= ${budget.layer2MinUsd}`};
}
export const gateCostUsd = (costs, perRoundCapUsd) => costs.reduce((s, c) => s + (typeof c === 'number' ? c : perRoundCapUsd), 0);

// ---- layer 1 ----
// layer1 files of #1835 run-layer1.mjs: pages [{case, trial, variants: [{variant: 'original', checks, layer1: {errors}}]}].
// Per case and condition: the trials (of 3) failing any check, and failing axeNoSeriousCritical. A slot absent from the
// records or measured with errors is unmeasured, and fails both.
export function layer1Counts(files) {
  const rec = {};
  for (const f of files) for (const p of f.pages ?? []) {
    const v = (p.variants ?? []).find((x) => x.variant === 'original');
    if (!v || v.excluded) continue;
    const key = `${p.case}/${p.trial}`;
    if (key in rec) throw new Error(`layer 1: ${key} appears twice`);
    const unmeasured = (v.layer1?.errors ?? []).length > 0 || !v.checks;
    rec[key] = {unmeasured, any: unmeasured || !Object.values(v.checks).every(Boolean), axe: unmeasured || v.checks.axeNoSeriousCritical !== true};
  }
  const perCase = {};
  for (const c of CASES) {
    perCase[c] = {};
    for (const cond of CONDITIONS) {
      const slots = REPS.map((r) => rec[`${c}/${cond}-r${r}`] ?? {unmeasured: true, any: true, axe: true, absent: true});
      perCase[c][cond] = {failing: slots.filter((s) => s.any).length, axeFailing: slots.filter((s) => s.axe).length, unmeasured: slots.filter((s) => s.unmeasured).length, of: REPS.length};
    }
  }
  const axeWorse = CASES.filter((c) => perCase[c].S.axeFailing > perCase[c].B.axeFailing);
  const anyWorse = CASES.filter((c) => perCase[c].S.failing > perCase[c].B.failing);
  return {perCase, axeWorseCases: axeWorse, failingWorseCases: anyWorse};
}

// ---- layers 2 and 3 ----
// The side a pair counts for when a screen is missing (review H-1): null when both are present.
export function forcedSide(item, missing) {
  const a = missing.has(item.first), b = missing.has(item.second);
  return a && b ? 'same' : a ? 'second' : b ? 'first' : null;
}

// owner: item -> 'first' | 'second' | 'same' | 'skip' (absent: unanswered). First = S in every #1867 pair.
export function ownerCounts(items, owner) {
  const out = {};
  for (const c of CASES) {
    const its = items.filter((i) => i.case === c);
    out[c] = {S: its.filter((i) => owner[i.id] === 'first').length, B: its.filter((i) => owner[i.id] === 'second').length,
      same: its.filter((i) => owner[i.id] === 'same').length, skip: its.filter((i) => owner[i.id] === 'skip').length,
      unanswered: its.filter((i) => !(i.id in owner)).length, of: its.length};
  }
  return out;
}

// J: {evaluator: {round: {item: 'first'|'second'|'same'|null}}} over the layer-2 items. fill replaces null.
export function layer2({pItems, J, rounds, owner, counts, fill, rule}) {
  const perCase = Object.fromEntries(CASES.map((c) => [c, {alarmsB: 0, alarmsS: 0, confirmed: 0, harm: false}]));
  const pairs = {};
  for (const i of pItems) {
    const js = EVALUATORS.flatMap((e) => rounds.map((r) => J[e]?.[r]?.[i.id] ?? null)).map((j) => j ?? fill);
    const alarm = js.every((j) => j === js[0]) && js[0] !== 'same' ? js[0] : null;
    const confirmed = alarm === 'second' && owner[i.id] === 'second';
    pairs[i.id] = {judgments: js, alarm: alarm === 'first' ? 'S' : alarm === 'second' ? 'B' : null, owner: owner[i.id] ?? null, confirmed};
    const pc = perCase[i.case];
    if (alarm === 'first') pc.alarmsS++;
    if (alarm === 'second') pc.alarmsB++;
    if (confirmed) pc.confirmed++;
  }
  for (const c of CASES) {
    const pc = perCase[c];
    pc.ownerBMoreThanS = counts[c].B > counts[c].S;
    pc.harm = pc.confirmed >= rule.harmMinConfirmed && (!rule.requireOwnerBMoreThanS || pc.ownerBMoreThanS);
  }
  return {perCase, pairs, harmCases: CASES.filter((c) => perCase[c].harm)};
}

// The counts of the harm rules (review M-2 (b), and the lead's decision after it): owner S and B per case, where the
// wins that a missing screen forced count once per missing screen, not once per pair, on either side (a missing S screen
// gives B 1 win, a missing B screen gives S 1 win). Used by the layer-3 business-screen harm (B - S >= 3) and by the
// layer-2 "the owner chose B more often than S in the case's 9 pairs". The effect (n, k) counts every pair.
export function harmCounts(items, ownerAll, forced, cases = CASES) {
  const out = {};
  for (const c of cases) {
    const its = items.filter((i) => i.case === c);
    const ownerS = its.filter((i) => !forced[i.id] && ownerAll[i.id] === 'first').length;
    const ownerB = its.filter((i) => !forced[i.id] && ownerAll[i.id] === 'second').length;
    const forcedBScreens = [...new Set(its.filter((i) => forced[i.id] === 'second').map((i) => i.first))].sort();
    const forcedSScreens = [...new Set(its.filter((i) => forced[i.id] === 'first').map((i) => i.second))].sort();
    out[c] = {S: ownerS + forcedSScreens.length, B: ownerB + forcedBScreens.length, ownerS, ownerB,
      forcedSPairs: its.filter((i) => forced[i.id] === 'first').length, forcedBPairs: its.filter((i) => forced[i.id] === 'second').length, forcedSScreens, forcedBScreens};
  }
  return out;
}

// The conclusion 1-4 given the layer-2 harm cases of one filling (step 0 is decided before, by the caller).
function conclude({gate, judgeable, harmsL1, l2Cases, harmsL3, n, k, minN, pValue, alpha}) {
  const harms = [...harmsL1, ...(l2Cases.length ? [`層2：確かめられた害（${l2Cases.join('・')}）`] : []), ...harmsL3];
  if (gate.gate !== 'judged') return {step: 1, conclusion: '未判定', why: [`門で判定できたケースが${judgeable.length}（3未満）`]};
  if (harms.length) return {step: 2, conclusion: '不採用', why: harms};
  if (n < minN) return {step: 3, conclusion: '未判定', why: [`ownerが優劣を付けた組n=${n}が下限${minN}に届かない`]};
  if (pValue <= alpha) return {step: 4, conclusion: '採用', why: [`k=${k}/n=${n}、p=${pValue.toFixed(4)} ≤ ${alpha}`]};
  return {step: 4, conclusion: '不採用', why: [`k=${k}/n=${n}、p=${pValue.toFixed(4)} > ${alpha}（この規模では効果を示せなかった）`]};
}

const OWNER_VALUES = ['first', 'second', 'same', 'skip'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// pLedgerHeader: the header line of <p-runs>/ledger.jsonl (review L-2); required when layer 2 may start.
export function decide({cfg, judge, gate, owner, ownerKey, pKey, J, layer1Files, fableSpentUsd = 0, gatePerRoundCapUsd, pLedgerHeader = null}) {
  const rule = cfg.decision;
  const reasons0 = [];
  // review L-2: the keys and the P ledger are those of this config
  if (ownerKey.seed !== cfg.seeds.ownerPage) throw new Error(`owner-key.json seed ${ownerKey.seed} is not eval.json seeds.ownerPage ${cfg.seeds.ownerPage}`);
  if (pKey.seed !== cfg.seeds.packets) throw new Error(`P key seed ${pKey.seed} is not eval.json seeds.packets ${cfg.seeds.packets}`);
  if (!same(pKey.rounds, cfg.rounds)) throw new Error(`P key rounds ${JSON.stringify(pKey.rounds)} are not eval.json rounds ${JSON.stringify(cfg.rounds)}`);
  // review L-3: an unknown owner choice stops (as #1852 decide)
  const bad = Object.entries(owner).filter(([, v]) => !OWNER_VALUES.includes(v));
  if (bad.length) throw new Error(`owner answers with an unknown choice: ${bad.map(([k]) => k).join(', ')}`);
  // every layer-3 pair has S first (eval.json)
  const items = planItems(cfg).filter((i) => i.layer === 3);
  if (!items.every((i) => parseScreen(i.first).trial.startsWith('S-') && parseScreen(i.second).trial.startsWith('B-'))) throw new Error('every layer-3 pair must be [S, B]');
  const keyItems = Object.values(ownerKey.pairs).map((p) => p.item).sort();
  if (keyItems.join() !== items.map((i) => i.id).sort().join()) throw new Error('owner-key.json does not hold the layer-3 pairs of eval.json');
  const pIds = new Set(Object.entries(cfg.pPairs).flatMap(([c, ps]) => ps.map(([a, b]) => `L3:${c}:${a}~${b}`)));
  const pItems = items.filter((i) => pIds.has(i.id));
  if (pItems.length !== pIds.size) throw new Error('pPairs must be layer-3 pairs');
  // missing screens: the owner page and the P packets were built from the same render root
  const fromOwner = new Set(ownerKey.missingScreens ?? []);
  const fromP = new Set((pKey.missing ?? []).map((m) => m.screen));
  if ([...fromOwner].sort().join() !== [...fromP].sort().join()) throw new Error(`missing screens differ: owner page [${[...fromOwner]}] vs P packets [${[...fromP]}]`);
  const missing = fromOwner;
  const forced = Object.fromEntries(items.map((i) => [i.id, forcedSide(i, missing)]).filter(([, v]) => v));
  // owner, with H-1
  const ownerAll = {...owner};
  for (const [id, side] of Object.entries(forced)) ownerAll[id] = side;
  const counts = ownerCounts(items, ownerAll);
  // P, with H-1; null = no valid judgment (M-2)
  const Jf = {};
  for (const e of EVALUATORS) {
    Jf[e] = {};
    for (const r of pKey.rounds) Jf[e][r] = Object.fromEntries(pItems.map((i) => [i.id, forced[i.id] ?? J[e]?.[r]?.[i.id] ?? null]));
  }
  const nulls = EVALUATORS.flatMap((e) => pKey.rounds.flatMap((r) => pItems.filter((i) => Jf[e][r][i.id] === null).map((i) => `${e}/round${r}/${i.id}`)));
  // the harm rules count a missing screen's forced wins once per screen (review M-2 (b), both sides, layers 2 and 3)
  const hc = harmCounts(items, ownerAll, forced);
  const fillS = layer2({pItems, J: Jf, rounds: pKey.rounds, owner: ownerAll, counts: hc, fill: 'first', rule: rule.layer2});
  const fillB = layer2({pItems, J: Jf, rounds: pKey.rounds, owner: ownerAll, counts: hc, fill: 'second', rule: rule.layer2});
  // layer 1
  const l1 = layer1Counts(layer1Files);
  // layer 3
  const judgeable = gate.judgeableCases ?? [];
  const minN = Math.ceil((rule.minOwnerDecidedPairs * judgeable.length) / CASES.length);
  if (gate.minOwnerDecidedPairs !== undefined && gate.minOwnerDecidedPairs !== minN) throw new Error(`gate.json minOwnerDecidedPairs ${gate.minOwnerDecidedPairs} is not ${minN}`);
  const n = judgeable.reduce((s, c) => s + counts[c].S + counts[c].B, 0), k = judgeable.reduce((s, c) => s + counts[c].S, 0);
  const pValue = n ? binomTail(n, k, rule.chance) : null;
  const business = rule.layer3Harm.cases.filter((c) => hc[c].B - hc[c].S >= rule.layer3Harm.minBMinusS);
  // cost
  const gateUsd = (gate.costUsd ?? 0) + (gate.costMissing ?? 0) * gatePerRoundCapUsd;
  const cap = layer2Cap({generationUsd: judge.completion?.spentUsd ?? 0, gateUsd, budget: rule.budget});
  if (cap.start) {
    if (!pLedgerHeader) throw new Error('the P ledger (<p-runs>/ledger.jsonl) has no header line');
    if (typeof pLedgerHeader.capUsd !== 'number' || Math.abs(pLedgerHeader.capUsd - cap.capUsd) > 1e-6) throw new Error(`the P ledger header capUsd ${pLedgerHeader.capUsd} is not the layer-2 cap ${cap.capUsd}`);
  }
  // conclusion, step 0
  // review High-1: only a run stopped at the stop line without completing (basis cap-reached); a complete run whose
  // ledger is near the line (capReached: true, complete: true, basis complete) is judged
  const stoppedAtCap = judge.completion?.capReached === true && judge.completion?.complete !== true;
  if (judge.judgement?.verdict === 'not-judged') reasons0.push(`共通の仕組みの判定がnot-judged（${judge.judgement.reason ?? ''}）`);
  if (stoppedAtCap) reasons0.push('生成が完了せずに停止の線で止まった');
  if (!cap.start) reasons0.push(`層2の上限${cap.capUsd} USDが${rule.budget.layer2MinUsd} USD未満（費用の超過の見込み）`);
  if (fableSpentUsd > cap.capUsd + 0.01) reasons0.push(`層2のFableの費用${round4(fableSpentUsd)} USDが上限${cap.capUsd} USDを超えた`);
  const harmsL1 = l1.axeWorseCases.length >= rule.layer1Harm.minCases ? [`層1：${rule.layer1Harm.check}の不合格がBより多いケースが${l1.axeWorseCases.length}（${l1.axeWorseCases.join('・')}）`] : [];
  const harmsL3 = business.length ? [`層3：業務の画面でownerのBがSより${rule.layer3Harm.minBMinusS}以上多い（${business.join('・')}。画面の欠けによる勝ちは欠けた画面1つにつき1組）`] : [];
  const base = {gate, judgeable, harmsL1, harmsL3, n, k, minN, pValue, alpha: rule.alpha};
  // review L-4: the missing P judgments make the conclusion 未判定 only when the conclusion with every one filled S differs
  // from the conclusion with every one filled B. The conclusion depends on layer 2 only through whether a case has harm,
  // which is monotone in the filling, so the two extremes cover every filling.
  const rS = conclude({...base, l2Cases: fillS.harmCases}), rB = conclude({...base, l2Cases: fillB.harmCases});
  const l2Undecided = rS.conclusion !== rB.conclusion;
  let step, conclusion, why;
  if (reasons0.length) [step, conclusion, why] = [0, '未判定', reasons0];
  else if (l2Undecided) [step, conclusion, why] = [0, '未判定', [`層2の欠け（${nulls.length}件）を全部Sで埋めると「${rS.conclusion}」（段${rS.step}）、全部Bで埋めると「${rB.conclusion}」（段${rB.step}）で、結論が変わる`]];
  else {
    // the S filling has the fewest layer-2 harms: what it finds holds for every filling
    [step, conclusion, why] = [rS.step, rS.conclusion, rS.why];
    if (rB.step !== rS.step || !same(rB.why, rS.why)) why = [...why, `（層2の欠けを全部Bで埋めた場合も結論は「${rB.conclusion}」：段${rB.step}、${rB.why.join('；')}）`];
  }
  return {schema: 'asc-1867-decision/v1', conclusion, step, why,
    note: '「不採用」は「この規模では効果を示せなかった」という意味を含む。組は独立ではないので、p値は目安（計画）',
    missingScreens: [...missing].sort(), forcedPairs: forced,
    layer1: l1,
    layer2: {missingJudgments: nulls, undecided: l2Undecided, harmDiffers: !same(fillS.harmCases, fillB.harmCases), conclusionIfFilledS: rS, conclusionIfFilledB: rB,
      harmIfFilledS: fillS.harmCases, harmIfFilledB: fillB.harmCases, perCase: fillS.perCase, perCaseIfFilledB: fillB.perCase, pairs: fillS.pairs},
    layer3: {perCase: counts, judgeableCases: judgeable, n, k, minN, pValue, criticalK: n ? criticalK(n, rule.alpha, rule.chance) : null, effect: pValue !== null && pValue <= rule.alpha,
      harmCounts: hc, businessHarmCases: business},
    gate: {gate: gate.gate, judgeableCases: judgeable, perCase: gate.perCase},
    cost: {...cap, fableSpentUsd: round4(fableSpentUsd), pLedgerCapUsd: pLedgerHeader?.capUsd ?? null},
    judge: {verdict: judge.judgement?.verdict ?? null, capReached: !!judge.completion?.capReached, complete: !!judge.completion?.complete, basis: judge.completion?.basis ?? null, stoppedAtCap}};
}

function main() {
  const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  const all = (n) => a.flatMap((x, i) => (x === n ? [a[i + 1]] : []));
  const need = (n) => { const v = opt(n); if (!v) throw new Error(`${n} is required`); return path.resolve(v); };
  const cfg = loadConfig(opt('--config') ? path.resolve(opt('--config')) : EVAL_JSON);
  const gateCfg = readJson(GATE_JSON);
  if (a[0] === 'cap') {
    const judge = readJson(need('--judge'));
    const files = all('--gate-answers');
    if (!files.length) throw new Error('--gate-answers <file>... is required (every answer of the gate count, the redos included)');
    const costs = files.map((f) => answerOf(fs.readFileSync(path.resolve(f), 'utf8')).costUsd);
    const r = layer2Cap({generationUsd: judge.completion?.spentUsd ?? 0, gateUsd: gateCostUsd(costs, gateCfg.budget.perRoundCapUsd), budget: cfg.decision.budget});
    console.log(JSON.stringify({...r, gateCostMissing: costs.filter((c) => typeof c !== 'number').length}));
    if (!r.start) process.exitCode = 4;
    return;
  }
  if (a[0] !== 'decide') { console.error('usage: decide.mjs cap|decide ... (see the header)'); process.exit(2); }
  const ownerKey = readJson(need('--owner-key')), answers = readJson(need('--owner'));
  if (answers.page !== ownerKey.seed) throw new Error(`owner answers are for page ${answers.page}, the key is ${ownerKey.seed}`);
  const pKey = readJson(need('--p-key')), runs = need('--p-runs');
  const ledgerFile = path.join(runs, 'ledger.jsonl');
  const ledger = fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const fableSpentUsd = ledger.filter((l) => l.type === 'call' && l.evaluator === 'fable').reduce((s, l) => s + (l.chargedUsd ?? 0), 0);
  const pLedgerHeader = ledger.find((l) => l.type === 'header') ?? null;
  const l1 = all('--layer1').map((f) => readJson(path.resolve(f)));
  if (l1.length !== CASES.length) throw new Error(`--layer1: one layer1.json per case (${CASES.length})`);
  const res = decide({cfg, judge: readJson(need('--judge')), gate: readJson(need('--gate')), owner: loadOwner(need('--owner'), need('--owner-key')), ownerKey,
    pKey, J: pJudgments({key: pKey, runs}), layer1Files: l1, fableSpentUsd, gatePerRoundCapUsd: gateCfg.budget.perRoundCapUsd, pLedgerHeader});
  writeJson(need('--out'), res);
  console.log(JSON.stringify({conclusion: res.conclusion, step: res.step, why: res.why, n: res.layer3.n, k: res.layer3.k, minN: res.layer3.minN, pValue: res.layer3.pValue}, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (e) { console.error(e.message); process.exit(2); }
}
