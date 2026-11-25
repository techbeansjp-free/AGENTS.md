// Applies decision-criteria.md mechanically (#1815). Pure functions + a CLI. No model call.
// Usage: node decide.mjs <runs-root> <render-root> <ranks-dir> <out.json>
//   runs-root/<case>/<B|S>-r<n>/{meta.json,reads.json,core-steps.json}
//   render-root/<case>/{render.json,<trial>/{gold.json,first-view.json}}       (run-indicators.mjs)
//   ranks-dir/keys/<round>/<case>.json  {"<blind id>": "<B|S>-r<n>"}           (make-blind.mjs; opened after ranking)
//   ranks-dir/<evaluator>-<round>.json  {"<case>": ["<best id>", ..., "<worst id>"]}  (evaluator: fable|codex, round: 1|2)
import fs from 'node:fs';
import path from 'node:path';
import {loadJson} from './pairing.mjs';

export const EVALUATORS = ['fable', 'codex'];
export const ROUNDS = [1, 2];
export const RULES = {improvedAtLeast: 8, worseAtMost: 1, pairs: 9, reproducibleAtLeast: 0.5, readMajority: 2, minEffectCases: 2, maxCostRatio: 3, maxFailedPerCondition: 1};
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

// reps 1..runs; each failed one is replaced, in order, by the next unused rep > runs of the same condition (once).
export function selectTrials(names, isFailed, runs) {
  const out = {};
  for (const c of ['B', 'S']) {
    const rep = (n) => Number(/-r(\d+)$/.exec(n)[1]);
    const mine = names.filter((n) => n.startsWith(`${c}-r`)).sort((a, b) => rep(a) - rep(b));
    const base = mine.filter((n) => rep(n) <= runs);
    const extra = mine.filter((n) => rep(n) > runs);
    out[c] = base.map((n) => (isFailed(n) && extra.length ? extra.shift() : n));
  }
  return out;
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
export const direction = (u) => (u >= RULES.improvedAtLeast ? '改善' : u <= RULES.worseAtMost ? '劣化' : '差なし');

// rounds: [{order, key}, {order, key}] of one evaluator for one case; S/B: selected trial names.
export function evaluatorCase(rounds, S, B) {
  const pos = rounds.map((r) => positions(r.order, r.key));
  const mean = meanPositions(pos);
  const u = pairsSAboveB(mean, S, B);
  const perRound = pos.map((p) => pairsSAboveB(p, S, B));
  const reproducibility = pos.length === 2 ? spearman(pos[0], pos[1]) : null;
  const usable = reproducibility !== null && reproducibility >= RULES.reproducibleAtLeast;
  return {perRound, u, of: S.length * B.length, direction: direction(u), reproducibility, usable, effective: usable ? direction(u) : '採点の揺れ'};
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
  const judgeable = readS >= RULES.readMajority;
  const failures = {S: S.filter((x) => x.failed).length, B: B.filter((x) => x.failed).length};
  const defer = failures.S > RULES.maxFailedPerCondition || failures.B > RULES.maxFailedPerCondition;
  const ind = indicatorCase(S, B);
  const rk = Object.fromEntries(EVALUATORS.map((e) => [e, ranking?.[e] ?? null]));
  const bothImproved = EVALUATORS.every((e) => rk[e]?.effective === '改善');
  const bothWorse = EVALUATORS.every((e) => rk[e]?.effective === '劣化');
  const indicatorOk = ind.direction !== 'worse' && !ind.nonDegradationFailed;
  let status;
  if (EVALUATORS.some((e) => !rk[e])) status = '順位待ち';
  else if (defer) status = '保留（失敗が多い）';
  else if (!judgeable) status = '未判定（候補の文が読まれていない）';
  else if (bothImproved && indicatorOk) status = '効果あり';
  else status = '効果なし';
  const harm = !defer && (bothWorse || ind.direction === 'worse' || ind.nonDegradationFailed);
  return {status, harm, judgeable, readS: `${readS}/${S.length}`, failures, indicators: ind, ranking: rk};
}

export function overall(cases, costRatio) {
  const st = Object.values(cases).map((c) => c.status);
  const effect = Object.entries(cases).filter(([, c]) => c.status === '効果あり').map(([k]) => k);
  const harm = Object.entries(cases).filter(([, c]) => c.harm).map(([k]) => k);
  const judgeable = Object.entries(cases).filter(([, c]) => c.judgeable).map(([k]) => k);
  let decision;
  if (st.includes('順位待ち')) decision = '順位待ち';
  else if (judgeable.length < RULES.minEffectCases) decision = '未判定（取り込まない）';
  else if (effect.length >= RULES.minEffectCases && harm.length === 0 && costRatio !== null && costRatio <= RULES.maxCostRatio) decision = '効果あり（取り込む）';
  else decision = '効果なし（取り込まない）';
  return {decision, effectCases: effect, harmCases: harm, judgeableCases: judgeable, costRatio};
}

const median = (a) => { const s = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

export function decide(runsRoot, renderRoot, ranksDir) {
  const cases = loadJson('cases.json').cases;
  const runs = loadJson('conditions.json').runs;
  const out = {schema: 'asc-1815-decision/v1', rules: RULES, cases: {}, trials: {}};
  const costs = {B: [], S: []};
  for (const caseId of Object.keys(cases)) {
    const dir = path.join(runsRoot, caseId);
    if (!fs.existsSync(dir)) continue;
    const names = fs.readdirSync(dir).filter((n) => /^(B|S)-r\d+$/.test(n));
    const recs = Object.fromEntries(names.map((n) => [n, trialRecord(runsRoot, renderRoot, caseId, n)]));
    const sel = selectTrials(names, (n) => failed(recs[n]), runs);
    const row = (n) => ({trial: n, failed: failed(recs[n]), reads: recs[n].reads, ...indicators(recs[n])});
    const S = sel.S.map(row), B = sel.B.map(row);
    for (const x of [...S, ...B]) costs[x.trial[0]].push(x.costUsd);
    let ranking = null;
    const files = Object.fromEntries(EVALUATORS.flatMap((e) => ROUNDS.map((r) => [`${e}-${r}`, read(path.join(ranksDir ?? '', `${e}-${r}.json`))])));
    if (ranksDir && Object.values(files).every(Boolean)) {
      ranking = Object.fromEntries(EVALUATORS.map((e) => [e, evaluatorCase(ROUNDS.map((r) => ({order: files[`${e}-${r}`][caseId], key: read(path.join(ranksDir, 'keys', String(r), `${caseId}.json`))})), sel.S, sel.B)]));
    }
    out.trials[caseId] = {selected: sel, all: names.sort(), notUsed: names.filter((n) => !sel.B.includes(n) && !sel.S.includes(n)), rows: [...B, ...S]};
    out.cases[caseId] = caseDecision({S, B, ranking});
  }
  const mB = median(costs.B), mS = median(costs.S);
  out.overall = overall(out.cases, mB ? mS / mB : null);
  out.cost = {medianB: mB, medianS: mS};
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [runsRoot, renderRoot, ranksDir, outPath] = process.argv.slice(2);
  const out = decide(path.resolve(runsRoot), path.resolve(renderRoot), ranksDir && ranksDir !== '-' ? path.resolve(ranksDir) : null);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({overall: out.overall, cases: Object.fromEntries(Object.entries(out.cases).map(([k, v]) => [k, v.status]))}));
}
