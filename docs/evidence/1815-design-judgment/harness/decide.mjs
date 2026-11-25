// Applies decision-criteria.md mechanically (#1815). Pure functions + a CLI. No model call.
// Usage: node decide.mjs <runs-root> <render-root> <ranks-root|-> <out.json> --ledger <file> --keys <keys-root>
//          --blind <blind-root> --guard-record <rank-guard.jsonl>
//   ranks-root holds the host-session output directories <fable|codex>-<round>[-retry]/ (budget.mjs rankRounds checks
//   result.txt and status.json against the ledger); keys-root and blind-root are make-blind's (checked against the
//   ledger's make-blind records); the guard record must show the lock held from each round's reservation to its settle.
// Refuses (exit 3) without the ledger, when the measurement reservations, the trial directories and the counted or
// classified trials are not the same names, when the fixed files differ from the last fixation record or a counted trial ran under another record.
// Not judged when the run stopped before every planned trial and required replacement existed (unless the ledger shows
// the cap was reached), or when a condition/case has no valid trial.
//   runs-root/<case>/<B|S>-r<n>/{meta.json,reads.json,core-steps.json}
//   render-root/<case>/{render.json,<trial>/{gold.json,first-view.json}}       (run-indicators.mjs)
//   keys-root/<round>/<case>.json  {"<blind id>": "<B|S>-r<n>"}                 (make-blind.mjs; opened after ranking)
//   ranks-root/<evaluator>-<round>/result.txt  the evaluator's answer ending with {"<case>": ["<best id>", ..., "<worst id>"]}
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as ledgerOps from '../../1814-skill-invocation/harness/ledger.mjs';
import {loadJson, ev} from './pairing.mjs';
import {countedTrials} from './order.mjs';
import {isMeasurementName} from './probe.mjs';
import {rankRounds, unsealOutputs, guardChainProblems} from './budget.mjs';
import {lockHeldProblems} from './rank-guard.mjs';
import {treeSha256, ledgerBlindRecords} from './make-blind.mjs';
import {differences, lastRecord} from './fixation.mjs';

export const EVALUATORS = ['fable', 'codex'];
export const ROUNDS = [1, 2];
export const RULES = {improvedFraction: 8 / 9, minValidPerCondition: 2, reproducibleAtLeast: 0.5, readMajority: 2, minEffectCases: 2, maxCostRatio: 3, maxFailedPerCondition: 1};
const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

// ---- trials ----------------------------------------------------------------------------------------------------------
export function trialRecord(runsRoot, renderRoot, caseId, trial) {
  const dir = path.join(runsRoot, caseId, trial);
  const meta = read(path.join(dir, 'meta.json')) ?? {};
  const reads = read(path.join(dir, 'reads.json')) ?? {};
  const core = read(path.join(dir, 'core-steps.json')) ?? {};
  const render = (read(path.join(renderRoot, caseId, 'render.json')) ?? []).find((r) => r.id === trial) ?? {};
  const gold = read(path.join(renderRoot, caseId, trial, 'gold.json')) ?? {};
  const fv = read(path.join(renderRoot, caseId, trial, 'first-view.json')) ?? {};
  return {trial, meta, reads, core, render, gold, fv};
}

// Failure (decision-criteria.md「失敗」): generation not successful, the session did not receive the condition, no
// deliverable, rendering or indicator error.
export function failed(t) {
  const vps = Object.values(t.render.viewports ?? {});
  return t.meta.exit !== 0 || t.meta.resultSubtype !== 'success' || (t.meta.initProblems ?? ['no meta']).length > 0
    || !t.render.exists || vps.length === 0 || vps.some((v) => v.renderError) || Boolean(t.gold.error) || t.gold.coverage === undefined
    || Boolean(t.fv.error) || !t.fv.widths?.narrow || !t.fv.widths?.wide;
}

// Which trials count (order.mjs countedTrials, the same rule as the runner): planned reps 1..runs; the k-th generation
// failure of a condition/case is replaced by rep runs+k; a replacement is never replaced.
export function selectCounted(names, caseId, runsRoot, runs) {
  const B = countedTrials(names, caseId, 'B', {runsRoot, runs}), S = countedTrials(names, caseId, 'S', {runsRoot, runs});
  return {B: B.counted, S: S.counted, missing: [...B.missing, ...S.missing], notUsed: [...B.notUsed, ...S.notUsed]};
}

// Before scoring (and before building the blind pages): the fixed files equal the last fixation record and every counted
// trial was run under that record (meta.fixationSha256 = sha256 of the current results/fixation.json, fixedAtCommit =
// the last record's commit).
export function fixationProblemsForScoring(metas, root = ev) {
  const file = path.join(root, 'results/fixation.json');
  if (!fs.existsSync(file)) return ['results/fixation.json is missing'];
  const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
  const p = differences(lastRecord(fx), root).map((f) => `fixed file differs: ${f}`);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  for (const m of metas) {
    if (m.fixationSha256 !== sha) p.push(`${m.trial ?? '?'}: run under another fixation record`);
    if (m.fixedAtCommit !== lastRecord(fx).fixedAtCommit) p.push(`${m.trial ?? '?'}: fixedAtCommit differs`);
  }
  return p;
}

// The run is complete when every planned trial and every required replacement exists, or the cap was reached: the ledger
// cannot take one more generation trial.
// The cap exception does not hold when a probe was reserved after the first measurement reservation (the ledger was
// inflated after the measurement started; run-trial refuses that, this is the scorer's own check).
// review M-c / L-d: only generation and probe spending counts (ranking rounds are excluded), and the generation stop line
// is capUsd - safetyMarginUsd - 2 x rankingReserveUsd (the two Fable rounds stay reserved).
export const generationStopUsd = (budget) => budget.capUsd - budget.safetyMarginUsd - 2 * budget.rankingReserveUsd;
export function completeness({missing, genSpentUsd, budget, lateProbes = []}) {
  const capReached = lateProbes.length === 0 && typeof genSpentUsd === 'number' && genSpentUsd + budget.perTrialUsd > generationStopUsd(budget);
  return {missing, capReached, complete: missing.length === 0, lateProbes};
}

// Ledger facts in reservation order: measurement names, probes reserved after the first measurement reservation, total.
export function ledgerFacts(ledger) {
  const res = ledgerOps.reservations(ledger);
  const meas = res.filter((e) => isMeasurementName(e.trial));
  const first = meas.length ? Math.min(...meas.map((e) => e.seq)) : null;
  // generation + probe spending: each reservation at its settled cost, or at its reservation when never settled.
  const all = fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const gen = res.filter((e) => !String(e.trial).startsWith('rank-'));
  const genSpentUsd = gen.reduce((a, r) => { const st = all.filter((x) => x.id === r.id && 'costUsd' in x && typeof x.reservedUsd !== 'number').at(-1); return a + (typeof st?.costUsd === 'number' ? st.costUsd : r.reservedUsd); }, 0);
  return {names: meas.map((e) => e.trial).sort(), lateProbes: first === null ? [] : res.filter((e) => String(e.trial).startsWith('probe/') && e.seq > first).map((e) => e.trial), spentUsd: ledgerOps.spent(ledger), genSpentUsd};
}

// The three name sets must be equal: measurement reservations in the ledger, trial directories present under the runs
// root, and trials the scorer counts or classifies (counted + replaced/unused). A reserved trial whose directory was
// removed, or a directory that was never reserved, is refused.
export function nameSetProblems({ledgerNames, dirNames, classifiedNames}) {
  const sets = {ledger: new Set(ledgerNames), directories: new Set(dirNames), classified: new Set(classifiedNames)};
  const p = [];
  const all = [...new Set([...ledgerNames, ...dirNames, ...classifiedNames])].sort();
  for (const n of all) {
    const where = Object.entries(sets).filter(([, x]) => x.has(n)).map(([k]) => k);
    if (where.length !== 3) p.push(`${n} is only in ${where.join(' and ')}`);
  }
  return p;
}

// review M-d items 2 and 3: one make-blind record per round in the ledger, and the keys and the blind tree unchanged.
export function blindRecordProblems(ledger, keysRoot, blindRoot) {
  const recs = ledgerBlindRecords(ledger);
  const p = [];
  for (const r of ROUNDS) {
    const mine = recs.filter((x) => x.blind === r);
    if (mine.length !== 1) { p.push(`round ${r}: ${mine.length} make-blind record(s) in the ledger, expected 1`); continue; }
    const k = path.join(keysRoot, String(r)), b = path.join(blindRoot, `round${r}`);
    if (!fs.existsSync(k) || treeSha256(k) !== mine[0].keysSha256) p.push(`round ${r}: keys differ from the ledger record`);
    if (!fs.existsSync(b) || treeSha256(b) !== mine[0].blindTreeSha256) p.push(`round ${r}: blind tree differs from the ledger record`);
  }
  return p;
}

// Everything decide and make-blind check about the run as a whole before scoring.
export function runConsistency(runsRoot, ledger, runs = loadJson('conditions.json').runs) {
  if (!ledger || !fs.existsSync(ledger)) return {problems: ['the ledger is required'], facts: null, perCase: {}};
  const facts = ledgerFacts(ledger);
  const dirNames = [], classifiedNames = [], perCase = {};
  for (const caseId of Object.keys(loadJson('cases.json').cases)) {
    const dir = path.join(runsRoot, caseId);
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^(B|S)-r\d+$/.test(n)) : [];
    dirNames.push(...names.map((n) => `${caseId}/${n}`));
    const sel = selectCounted(names, caseId, runsRoot, runs);
    classifiedNames.push(...[...sel.B, ...sel.S, ...sel.notUsed].map((n) => `${caseId}/${n}`));
    perCase[caseId] = {names, sel};
  }
  return {problems: nameSetProblems({ledgerNames: facts.names, dirNames, classifiedNames: [...new Set(classifiedNames)]}), facts, perCase};
}

// ---- per-trial indicators --------------------------------------------------------------------------------------------
export function indicators(t) {
  const w = t.fv.widths ?? {};
  const vps = Object.values(t.render.viewports ?? {});
  return {
    answerWidths: ['narrow', 'wide'].filter((s) => w[s]?.answerAll).length,
    answerItemsFound: ['narrow', 'wide'].reduce((a, s) => a + (w[s]?.answerFound?.length ?? 0), 0),
    hiddenRequiredWide: w.wide?.hiddenRequired?.length ?? null,
    coverage: t.gold.coverage ?? null,
    axeSeriousCritical: vps.length ? Math.max(...vps.map((v) => v.axeSeriousCritical ?? 0)) : null,
    overflow: vps.some((v) => v.overflowX),
    externalRequests: vps.reduce((a, v) => a + (v.externalRequests?.length ?? 0), 0) + (t.fv.externalRequests ?? 0),
    // mechanism (reported, not an effect): what the generator itself rendered and checked
    bothWidthsRendered: Boolean(t.core.finalBothWidths), narrowChecked: Boolean(t.core.narrowChecked), wideChecked: Boolean(t.core.wideChecked),
    twoDesignsRendered: Boolean(t.core.alternativesCompared), screenshots: t.core.toolCalls?.screenshot?.ok ?? 0,
    costUsd: t.meta.costUsd ?? null,
  };
}

// ---- rankings --------------------------------------------------------------------------------------------------------
// order: [best id, ..., worst id]; key: {id: trial}. Returns {trial: position (1 = best)}.
export function positions(order, key) {
  const ids = Object.keys(key).sort();
  if (!Array.isArray(order) || order.length !== ids.length || [...order].sort().join() !== ids.join()) throw new Error('ranking does not list every screen exactly once');
  return Object.fromEntries(order.map((id, i) => [key[id], i + 1]));
}
export function meanPositions(list) {
  const trials = Object.keys(list[0]);
  return Object.fromEntries(trials.map((t) => [t, list.reduce((a, p) => a + p[t], 0) / list.length]));
}
// Pairs (s, b) with s ranked better than b; ties count 0.5.
export function pairsSAboveB(pos, S, B) {
  let u = 0;
  for (const s of S) for (const b of B) u += pos[s] < pos[b] ? 1 : pos[s] === pos[b] ? 0.5 : 0;
  return u;
}
export function spearman(a, b) {
  const ts = Object.keys(a);
  const rank = (p) => { const s = [...ts].sort((x, y) => p[x] - p[y]); const r = {}; s.forEach((t, i) => { r[t] = i + 1; }); return r; };
  const ra = rank(a), rb = rank(b), n = ts.length;
  const d2 = ts.reduce((acc, t) => acc + (ra[t] - rb[t]) ** 2, 0);
  return Number((1 - (6 * d2) / (n * (n * n - 1))).toFixed(3));
}
// review M-4: U counts only the pairs of valid trials; the thresholds scale with the number of pairs:
// improved when U >= ceil(8/9 x pairs), worse when U <= pairs - ceil(8/9 x pairs) (9 pairs: 8 and 1, as #1807).
// review L-c: harm is the symmetric counterpart: S below B in >= ceil(8/9 x P) pairs, i.e. U <= P - ceil(8/9 x P)
// (P = 9: U <= 1, as before). The proportional scaling was approved by the owner (2026-11-26).
export const thresholds = (pairs) => { const k = Math.ceil(RULES.improvedFraction * pairs - 1e-9); return {improved: k, worse: pairs - k}; };
export const direction = (u, pairs = 9) => { const t = thresholds(pairs); return u >= t.improved ? '改善' : u <= t.worse ? '劣化' : '差なし'; };

// rounds: [{order, key}, {order, key}] of one evaluator for one case; S/B: the valid (ranked) trial names. Fewer than
// 2 valid trials in either condition: the ranking of the case is 未判定 (review M-4).
export function evaluatorCase(rounds, S, B) {
  if (S.length < RULES.minValidPerCondition || B.length < RULES.minValidPerCondition) return {effective: '未判定', reason: `valid trials S ${S.length}, B ${B.length} (< ${RULES.minValidPerCondition})`};
  for (const r of rounds) if ([...Object.values(r.key)].sort().join() !== [...S, ...B].sort().join()) throw new Error('the blind keys do not list exactly the valid trials');
  const pos = rounds.map((r) => positions(r.order, r.key));
  const mean = meanPositions(pos);
  const u = pairsSAboveB(mean, S, B);
  const perRound = pos.map((p) => pairsSAboveB(p, S, B));
  const reproducibility = pos.length === 2 ? spearman(pos[0], pos[1]) : null;
  const usable = reproducibility !== null && reproducibility >= RULES.reproducibleAtLeast;
  const pairs = S.length * B.length;
  return {perRound, u, of: pairs, thresholds: thresholds(pairs), direction: direction(u, pairs), reproducibility, usable, effective: usable ? direction(u, pairs) : '採点の揺れ'};
}

// ---- indicators per case ---------------------------------------------------------------------------------------------
// Failed trials: worst value for S, best value for B (#1804/#1807).
export function indicatorCase(Sx, Bx) {
  const sum = (xs, k, worst, best, side) => xs.reduce((a, x) => a + (x.failed ? (side === 'S' ? worst : best) : x[k] ?? worst), 0);
  const answer = {S: sum(Sx, 'answerWidths', 0, 2, 'S'), B: sum(Bx, 'answerWidths', 0, 2, 'B')};
  const hidden = {S: sum(Sx, 'hiddenRequiredWide', 99, 0, 'S'), B: sum(Bx, 'hiddenRequiredWide', 99, 0, 'B')};
  let dir = 'equal';
  if (answer.S > answer.B || (answer.S === answer.B && hidden.S < hidden.B)) dir = 'better';
  if (answer.S < answer.B || (answer.S === answer.B && hidden.S > hidden.B)) dir = 'worse';
  const v = (xs, k, side, worst, best) => xs.map((x) => (x.failed ? (side === 'S' ? worst : best) : x[k]));
  const min = (a) => Math.min(...a), max = (a) => Math.max(...a);
  const cnt = (xs, k, side) => xs.filter((x) => (x.failed ? side === 'S' : x[k])).length;
  const nonDegradation = {
    coverage: min(v(Sx, 'coverage', 'S', 0, 1)) >= min(v(Bx, 'coverage', 'B', 0, 1)) - 0.05,
    axe: max(v(Sx, 'axeSeriousCritical', 'S', Infinity, 0)) <= max(v(Bx, 'axeSeriousCritical', 'B', Infinity, 0)),
    overflow: cnt(Sx, 'overflow', 'S') <= cnt(Bx, 'overflow', 'B'),
    externalRequests: Sx.filter((x) => x.failed || x.externalRequests > 0).length <= Bx.filter((x) => !x.failed && x.externalRequests > 0).length,
  };
  return {answerWidths: answer, hiddenRequiredWide: hidden, direction: dir, nonDegradation, nonDegradationFailed: Object.values(nonDegradation).some((x) => !x)};
}

// ---- case and overall decision ---------------------------------------------------------------------------------------
export function caseDecision({S, B, ranking}) {
  const readS = S.filter((x) => !x.failed && x.reads.ascBodyRead && x.reads.relevantReferenceRead).length;
  const readOk = readS >= RULES.readMajority;
  const failures = {S: S.filter((x) => x.failed).length, B: B.filter((x) => x.failed).length};
  const defer = failures.S > RULES.maxFailedPerCondition || failures.B > RULES.maxFailedPerCondition;
  const ind = indicatorCase(S, B);
  const rk = Object.fromEntries(EVALUATORS.map((e) => [e, ranking?.[e] ?? null]));
  const bothImproved = EVALUATORS.every((e) => rk[e]?.effective === '改善');
  const bothWorse = EVALUATORS.every((e) => rk[e]?.effective === '劣化');
  const indicatorOk = ind.direction !== 'worse' && !ind.nonDegradationFailed;
  // review L-6: an evaluator excluded for low reproducibility, or a ranking without enough valid trials, makes the case
  // 未判定 (not 効果なし). review L-2: 保留 and 未判定 cases are not judgeable.
  const rankingUnusable = EVALUATORS.some((e) => rk[e] && ['採点の揺れ', '未判定'].includes(rk[e].effective));
  let status;
  if (EVALUATORS.some((e) => !rk[e])) status = '順位待ち';
  else if (defer) status = '保留（失敗が多い）';
  else if (!readOk) status = '未判定（候補の文が読まれていない）';
  else if (rankingUnusable) status = '未判定（順位を判定に使えない）';
  else if (bothImproved && indicatorOk) status = '効果あり';
  else status = '効果なし';
  const judgeable = ['効果あり', '効果なし'].includes(status);
  const harm = !defer && (bothWorse || ind.direction === 'worse' || ind.nonDegradationFailed);
  return {status, harm, judgeable, readS: `${readS}/${S.length}`, failures, indicators: ind, ranking: rk};
}

export function overall(cases, costRatio, run = {complete: true, capReached: false, emptyCells: []}) {
  const st = Object.values(cases).map((c) => c.status);
  const effect = Object.entries(cases).filter(([, c]) => c.status === '効果あり').map(([k]) => k);
  const harm = Object.entries(cases).filter(([, c]) => c.harm).map(([k]) => k);
  const judgeable = Object.entries(cases).filter(([, c]) => c.judgeable).map(([k]) => k);
  let decision;
  if (!run.complete && !run.capReached) decision = '未判定（実行が途中で止まった）';
  else if ((run.emptyCells ?? []).length) decision = '未判定（有効な試行の無い条件・ケース）';
  else if (st.includes('順位待ち')) decision = '順位待ち';
  else if (judgeable.length < RULES.minEffectCases) decision = '未判定（取り込まない）';
  else if (effect.length >= RULES.minEffectCases && harm.length === 0 && costRatio !== null && costRatio <= RULES.maxCostRatio) decision = '効果あり（取り込む）';
  else decision = '効果なし（取り込まない）';
  return {decision, effectCases: effect, harmCases: harm, judgeableCases: judgeable, costRatio, run};
}

const median = (a) => { const s = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

export function decide(runsRoot, renderRoot, ranksDir, {ledger = null, keysRoot = null, blindRoot = null, guardRecord = null} = {}) {
  const cases = loadJson('cases.json').cases;
  const conds = loadJson('conditions.json');
  const runs = conds.runs;
  const out = {schema: 'asc-1815-decision/v2', rules: RULES, cases: {}, trials: {}};
  const costs = {B: [], S: []};
  const missing = [], emptyCells = [], metas = [];
  const prepared = [];
  const rc = runConsistency(runsRoot, ledger, runs);
  if (rc.problems.length) throw new Error(`refused: ${rc.problems.join('; ')}`);
  let rankings = null;
  if (ranksDir) {
    if (!keysRoot || !blindRoot || !guardRecord) throw new Error('refused: --keys, --blind and --guard-record are required with ranks');
    const sealed = unsealOutputs({ledger, ranksRoot: ranksDir, guardRecord});
    if (sealed.length) throw new Error(`refused: ${sealed.join('; ')}`);
    const rr = rankRounds(ledger, ranksDir);
    const p = [...rr.problems, ...blindRecordProblems(ledger, keysRoot, blindRoot), ...guardChainProblems(ledger, guardRecord)];
    if (!rr.problems.length) p.push(...lockHeldProblems(fs.existsSync(guardRecord) ? fs.readFileSync(guardRecord, 'utf8') : '', rr.settles));
    if (p.length) throw new Error(`refused: ${p.join('; ')}`);
    rankings = rr.rankings;
  }
  for (const caseId of Object.keys(cases)) {
    const {sel} = rc.perCase[caseId];
    missing.push(...sel.missing.map((n) => `${caseId}/${n}`));
    const recs = Object.fromEntries([...sel.B, ...sel.S].map((n) => [n, trialRecord(runsRoot, renderRoot, caseId, n)]));
    metas.push(...Object.values(recs).map((r) => r.meta));
    prepared.push({caseId, sel, recs});
  }
  const fp = fixationProblemsForScoring(metas);
  if (fp.length) throw new Error(`refused: ${fp.join('; ')}`);
  for (const {caseId, sel, recs} of prepared) {
    const row = (n) => ({trial: n, failed: failed(recs[n]), reads: recs[n].reads, ...indicators(recs[n])});
    const S = sel.S.map(row), B = sel.B.map(row);
    for (const c of ['B', 'S']) if (!(c === 'B' ? B : S).some((x) => !x.failed)) emptyCells.push(`${caseId}/${c}`);
    for (const x of [...S, ...B]) costs[x.trial[0]].push(x.costUsd);
    let ranking = null;
    if (rankings) {
      const valid = (xs) => xs.filter((x) => !x.failed).map((x) => x.trial);
      ranking = Object.fromEntries(EVALUATORS.map((e) => [e, evaluatorCase(ROUNDS.map((r) => ({order: rankings[e][r][caseId], key: read(path.join(keysRoot, String(r), `${caseId}.json`))})), valid(S), valid(B))]));
    }
    out.trials[caseId] = {counted: {B: sel.B, S: sel.S}, missing: sel.missing, notUsed: sel.notUsed, rows: [...B, ...S]};
    out.cases[caseId] = caseDecision({S, B, ranking});
  }
  const run = {...completeness({missing, genSpentUsd: rc.facts.genSpentUsd, budget: conds.budget, lateProbes: rc.facts.lateProbes}), emptyCells};
  const mB = median(costs.B), mS = median(costs.S);
  out.overall = overall(out.cases, mB ? mS / mB : null, run);
  out.cost = {medianB: mB, medianS: mS};
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? path.resolve(args[i + 1]) : null; };
  const pos = args.filter((a, j) => !a.startsWith('--') && !['--ledger', '--keys', '--blind', '--guard-record'].includes(args[j - 1]));
  const [runsRoot, renderRoot, ranksDir, outPath] = pos;
  let out;
  try { out = decide(path.resolve(runsRoot), path.resolve(renderRoot), ranksDir && ranksDir !== '-' ? path.resolve(ranksDir) : null, {ledger: opt('--ledger'), keysRoot: opt('--keys'), blindRoot: opt('--blind'), guardRecord: opt('--guard-record')}); } catch (e) { console.error(e.message); process.exit(3); }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({overall: out.overall, cases: Object.fromEntries(Object.entries(out.cases).map(([k, v]) => [k, v.status]))}));
}
