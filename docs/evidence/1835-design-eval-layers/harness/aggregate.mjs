// Metrics and decisions of EVAL_PLAN.md sections 6 and 7, matched through the key after scoring.
// Usage:
//   node harness/aggregate.mjs critiques --runs <runs> --out <texts.jsonl>     (input of ssr.py score)
//   node harness/aggregate.mjs decide --key <key.json> --runs <runs> --out <result.json>
//        [--layer1 <layer1.json>]... [--owner <owner-answers.json> --owner-key <owner-key.json>]
//        [--ssr <ssr.json>] [--ssr-negation <ssr-negation.json>]
// Pair judgments are in the item's orientation: "first" (layer 2: the original), "second", "same", or null (missing).
// Counts are pooled over the two rounds (each pair x round is one judgment), except reproducibility (one per pair).
// Every rate is reported as {n, d, rate}. D is recorded with the same metrics but is not decided; D has no ties, so its
// false-positive rate is not measured and the negative control is excluded from D.
import fs from 'node:fs';
import path from 'node:path';
import {loadConfig, readJson, writeJson} from './eval-common.mjs';

export const EVALUATORS = ['fable', 'codex'];
const frac = (n, d) => ({n, d, rate: d ? n / d : null});
const geq = (a, b) => (a.d && b.d ? a.n * b.d >= b.n * a.d : null); // a.rate >= b.rate without floating error

// ---- collecting judgments from the run records ----
const statusOf = (runs, e, r, m, id) => { const f = path.join(runs, e, `round${r}`, m, id, 'status.json'); return fs.existsSync(f) ? readJson(f) : null; };
const cmp = (a, b, tie = 0) => (a === null || b === null || a === undefined || b === undefined ? null : Math.abs(a - b) < tie || a === b ? 'same' : a > b ? 'first' : 'second');

export function collectJudgments({key, runs, cfg, ssr = null}) {
  const J = {}, fNeg = {};
  const items = key.items.filter((i) => !i.excluded);
  const pk = Object.entries(key.packets);
  for (const e of EVALUATORS) {
    J[e] = {D: {}, P: {}, F: {}, S: {}}; fNeg[e] = {};
    for (const r of key.rounds) {
      for (const m of ['D', 'P', 'F', 'S']) J[e][m][r] = Object.fromEntries(items.map((i) => [i.id, null]));
      // P
      for (const [id, p] of pk.filter(([, p]) => p.round === r && p.method === 'P')) {
        const st = statusOf(runs, e, r, 'P', id), it = items.find((i) => i.id === p.item);
        if (!it || st?.status !== 'valid') continue;
        const c = st.answer.choice;
        J[e].P[r][it.id] = c === '同等' ? 'same' : (p.ids[p.task[c]] === it.first ? 'first' : 'second');
      }
      // F (score of the critique) and S (SSR expected value of the same critique), by screen
      const fScore = {}, sScore = {};
      for (const [id, p] of pk.filter(([, p]) => p.round === r && p.method === 'F')) {
        const screen = Object.values(p.ids)[0];
        const st = statusOf(runs, e, r, 'Fs', `fs-${id}`);
        if (st?.status === 'valid') fScore[screen] = st.answer.score;
        const s = ssr?.results?.[`${e}/round${r}/${id}`];
        if (s && typeof s.expected === 'number') sScore[screen] = s.expected;
      }
      for (const it of items) {
        J[e].F[r][it.id] = cmp(fScore[it.first] ?? null, fScore[it.second] ?? null);
        J[e].S[r][it.id] = cmp(sScore[it.first] ?? null, sScore[it.second] ?? null, cfg.ssr.sameThreshold);
      }
      // D: rank inside the group of the item's layer
      for (const [id, p] of pk.filter(([, p]) => p.round === r && p.method === 'D')) {
        const st = statusOf(runs, e, r, 'D', id);
        if (st?.status !== 'valid') continue;
        for (const g of p.task.groups) {
          const layer = p.groupLayers[g.name] === 'L2' ? 2 : 3;
          const rank = Object.fromEntries(st.answer.groups[g.name].map((x, i) => [p.ids[x], i]));
          for (const it of items.filter((i) => i.case === p.case && i.layer === layer && !i.control)) {
            if (rank[it.first] !== undefined && rank[it.second] !== undefined) J[e].D[r][it.id] = rank[it.first] < rank[it.second] ? 'first' : 'second';
          }
        }
      }
      // F scores of the negation sentences
      const negPairs = new Set();
      const dir = path.join(runs, e, `round${r}`, 'Neg');
      for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) { const m = /^neg-(.+)-(positive|negative)$/.exec(f); if (m) negPairs.add(m[1]); }
      fNeg[e][r] = {};
      for (const id of negPairs) {
        const g = (side) => { const st = statusOf(runs, e, r, 'Neg', `neg-${id}-${side}`); return st?.status === 'valid' ? st.answer.score : null; };
        fNeg[e][r][id] = {positive: g('positive'), negative: g('negative')};
      }
    }
  }
  return {J, fNeg};
}

export function costsFromLedger(lines) {
  const c = {};
  for (const l of lines.filter((x) => x.type === 'call')) {
    const k = (c[l.evaluator] ??= {})[l.method] ??= {calls: 0, usd: 0, costMissing: 0, durationMs: 0, tokens: {input: 0, cacheCreation: 0, cacheRead: 0, output: 0}};
    k.calls++; k.usd += l.chargedUsd ?? 0; k.costMissing += l.costMissing ? 1 : 0; k.durationMs += l.durationMs ?? 0;
    for (const t of Object.keys(k.tokens)) k.tokens[t] += l.tokens?.[t] ?? 0;
  }
  return c;
}

// ---- metrics (pure) ----
export function methodMetrics({items, J, rounds, layer1, owner, method}) {
  const use = items.filter((i) => !(method === 'D' && i.control));
  const all = use.flatMap((i) => rounds.map((r) => ({i, r, j: J[r]?.[i.id] ?? null})));
  const l1 = (i) => (layer1[i.second] === undefined ? 'unknown' : layer1[i.second] ? 'pass' : 'fail');
  const missing = all.filter((x) => x.j === null).length;
  const sens = {};
  for (const x of all.filter((x) => x.i.layer === 2 && !x.i.control && x.j !== null)) {
    const k = `${x.i.kind}-${x.i.strength}/${l1(x.i)}`;
    sens[k] = {n: (sens[k]?.n ?? 0) + (x.j === 'first' ? 1 : 0), d: (sens[k]?.d ?? 0) + 1};
  }
  for (const k of Object.keys(sens)) sens[k].rate = sens[k].n / sens[k].d;
  const pick = (f) => { const xs = all.filter((x) => x.i.layer === 2 && !x.i.control && f(x.i) && x.j !== null); return frac(xs.filter((x) => x.j === 'first').length, xs.length); };
  const strongPass = pick((i) => i.strength === 'strong' && l1(i) === 'pass');
  const weakPass = pick((i) => i.strength === 'weak' && l1(i) === 'pass');
  const kinds = [...new Set(use.filter((i) => i.layer === 2 && !i.control).map((i) => i.kind))];
  const byKind = Object.fromEntries(kinds.filter((k) => use.some((i) => i.kind === k && i.strength === 'weak') && use.some((i) => i.kind === k && i.strength === 'strong'))
    .map((k) => [k, {strong: pick((i) => i.kind === k && i.strength === 'strong' && l1(i) === 'pass'), weak: pick((i) => i.kind === k && i.strength === 'weak' && l1(i) === 'pass')}]));
  const ctl = all.filter((x) => x.i.control && x.j !== null);
  const falsePositive = method === 'D' ? {n: null, d: null, rate: null, note: 'Dは同順位が無いので測らない'} : frac(ctl.filter((x) => x.j !== 'same').length, ctl.length);
  const both = use.filter((i) => rounds.every((r) => (J[r]?.[i.id] ?? null) !== null));
  const reproducibility = frac(both.filter((i) => rounds.every((r) => J[r][i.id] === J[rounds[0]][i.id])).length, both.length);
  let layer3 = null;
  if (owner) {
    const decided = use.filter((i) => i.layer === 3 && (owner[i.id] === 'first' || owner[i.id] === 'second'));
    const xs = decided.flatMap((i) => rounds.map((r) => ({i, j: J[r]?.[i.id] ?? null}))).filter((x) => x.j !== null);
    layer3 = {...frac(xs.filter((x) => x.j === owner[x.i.id]).length, xs.length), ownerDecidedPairs: decided.length};
  }
  const l1Unknown = use.filter((i) => i.layer === 2 && !i.control && l1(i) === 'unknown').map((i) => i.id);
  return {expected: all.length, missing, sensitivity: sens, strongPassedL1: strongPass, weakPassedL1: weakPass, byKind, falsePositive, reproducibility, layer3, l1Unknown};
}

export function interEvaluator({items, J, rounds, method}) {
  const xs = items.filter((i) => !(method === 'D' && i.control)).flatMap((i) => rounds.map((r) => [J.fable?.[method]?.[r]?.[i.id] ?? null, J.codex?.[method]?.[r]?.[i.id] ?? null])).filter(([a, b]) => a !== null && b !== null);
  return frac(xs.filter(([a, b]) => a === b).length, xs.length);
}

export function negationFailures(fNegRounds) {
  let fail = 0, missing = 0, d = 0;
  for (const r of Object.values(fNegRounds ?? {})) for (const v of Object.values(r)) { d++; if (v.positive === null || v.negative === null) missing++; else if (v.negative >= v.positive) fail++; }
  return {failures: fail, missing, d};
}

// Decision of one evaluator for method m (F or S) against P (plan 7).
export function decideEvaluator({m, P, neg, flags = {}}) {
  const reasons = [];
  if (flags.budgetStopped) reasons.push('予算で止まった');
  if (flags.coreFailed) reasons.push('中心の仕組みが動かなかった');
  for (const [name, x] of [[m.name, m], ['P', P]]) {
    if (x.missing > 0) reasons.push(`${name}に欠測${x.missing}件`);
    if (!x.reproducibility.d) reasons.push(`${name}の再現性の分母が0`);
    if (!x.strongPassedL1.d) reasons.push(`${name}の強い劣化（層1を通った版）の分母が0`);
    if (x.l1Unknown.length) reasons.push(`${name}の層1の結果が無い版がある`);
  }
  if (!neg || neg.missing > 0 || !neg.d) reasons.push('否定の反例の欠測');
  if (reasons.length) return {result: '未判定', reasons};
  const minimum = {strong: m.strongPassedL1.n * 3 >= m.strongPassedL1.d * 2, reproducibility: m.reproducibility.rate >= 0.5};
  if (!minimum.strong || !minimum.reproducibility) return {result: '不採用', minimum, reasons: ['最低の基準を満たさない']};
  const c = {};
  c['1 再現性がP以上'] = geq(m.reproducibility, P.reproducibility);
  c['2 層3の一致がP以上'] = m.layer3 && P.layer3 ? geq(m.layer3, P.layer3) : null;
  const kindOk = Object.values(m.byKind).map((k) => geq(k.strong, k.weak));
  const weakOk = geq(m.weakPassedL1, P.weakPassedL1);
  c['3 強≥弱（全種類）かつ弱の感度がP以上'] = kindOk.includes(null) || weakOk === null || !kindOk.length ? null : kindOk.every(Boolean) && weakOk;
  c['4 否定の反例の失敗が0件'] = neg.failures === 0;
  const undetermined = Object.entries(c).filter(([, v]) => v === null).map(([k]) => `${k}：分母が0か、ownerの判断が無い`);
  if (undetermined.length) return {result: '未判定', minimum, conditions: c, reasons: undetermined};
  return {result: Object.values(c).every(Boolean) ? '合格' : '不合格', minimum, conditions: c};
}

export function costCheck(costs, m) {
  const f = costs?.fable ?? {}, usd = (k) => f[k]?.usd ?? 0;
  const P = usd('P'), M = m === 'F' ? usd('Fc') + usd('Fs') : m === 'S' ? usd('Fc') : usd(m);
  if (!P) return {ok: null, P, method: M, why: 'Pの費用が無い'};
  return {ok: M <= 2 * P, P, method: M, ratio: M / P};
}

export function conclude({perEvaluator, cost, ceiling, ownerPresent}) {
  const rs = EVALUATORS.map((e) => perEvaluator[e].result);
  const reasons = [];
  if (rs.every((r) => r === '合格') && cost.ok === true && !ceiling.length && ownerPresent) return {conclusion: '採用候補', note: '今回の結果だけでは評価の判定に使わない（計画7節）'};
  if (rs.every((r) => r === '不合格' || r === '不採用')) return {conclusion: '不採用'};
  if (!ownerPresent) reasons.push('層3のownerの判断が無い');
  if (ceiling.length) reasons.push(`弱の感度が全方式で100%（天井）：${ceiling.join('・')}`);
  if (cost.ok !== true) reasons.push(cost.ok === false ? '費用の条件を満たさない' : '費用を判定できない');
  if (new Set(rs).size > 1) reasons.push(`評価者で結論が分かれた（${rs.join('・')}）`);
  if (rs.includes('未判定')) reasons.push('未判定の評価者がいる');
  return {conclusion: '未判定', reasons};
}

export function computeAll({cfg, key, J, fNeg, layer1 = {}, owner = null, ssrNeg = null, ssrCoreFailed = false, costs = {}, budgetStopped = false}) {
  const und = new Set(key.l2Undetermined ?? []);
  const items = key.items.filter((i) => !i.excluded && !(i.layer === 2 && und.has(i.case)));
  const rounds = key.rounds;
  const metrics = {};
  for (const e of EVALUATORS) {
    metrics[e] = {};
    for (const m of ['D', 'P', 'F', 'S']) metrics[e][m] = {name: m, ...methodMetrics({items, J: J[e]?.[m] ?? {}, rounds, layer1, owner, method: m})};
  }
  const negation = {F: Object.fromEntries(EVALUATORS.map((e) => [e, negationFailures(fNeg?.[e])])),
    S: ssrNeg && !ssrNeg.coreFailed ? {failures: ssrNeg.failures, missing: 0, d: ssrNeg.pairs.length} : null};
  const ceiling = EVALUATORS.filter((e) => ['P', 'F', 'S'].every((m) => { const w = metrics[e][m].weakPassedL1; return w.d > 0 && w.n === w.d; }));
  const decisions = {};
  for (const m of ['F', 'S']) {
    const perEvaluator = {};
    for (const e of EVALUATORS) {
      perEvaluator[e] = decideEvaluator({m: metrics[e][m], P: metrics[e].P, neg: m === 'F' ? negation.F[e] : negation.S,
        flags: {budgetStopped: budgetStopped && e === cfg.budget.evaluator, coreFailed: m === 'S' && (ssrCoreFailed || !negation.S)}});
    }
    const cost = costCheck(costs, m);
    decisions[m] = {perEvaluator, cost, ...conclude({perEvaluator, cost, ceiling, ownerPresent: !!owner})};
  }
  const inter = Object.fromEntries(['D', 'P', 'F', 'S'].map((m) => [m, interEvaluator({items, J: Object.fromEntries(EVALUATORS.map((e) => [e, J[e]])), rounds, method: m})]));
  return {schema: 'asc-1835-result/v1', note: '件数と分母を併記する。探索的な小規模の評価で、統計的な差の証明ではない。Dは記録するが採否の対象にしない（計画7節）。', rounds,
    items: items.length, excludedItems: key.items.filter((i) => i.excluded).map((i) => ({id: i.id, why: i.excluded})), l2Undetermined: [...und],
    metrics, interEvaluator: inter, negation, ceiling, costs, budgetStopped, decisions};
}

// Counts of calls that gave no valid answer, per evaluator and per reason (missingReason of status.json:
// images-not-read, isolation-violation, invalid-answer, no-result-event, failed, missing-input). isolationUnconfirmed counts
// valid-or-not Codex calls whose isolation could not be judged from the event shapes (recorded, not missing).
export function missingByReason(runs) {
  const out = {};
  for (const e of EVALUATORS) {
    const o = {total: 0, valid: 0, byReason: {}, isolationUnconfirmed: 0};
    const base = path.join(runs, e);
    for (const rd of fs.existsSync(base) ? fs.readdirSync(base).filter((x) => /^round\d+$/.test(x)) : []) for (const m of fs.readdirSync(path.join(base, rd))) {
      const md = path.join(base, rd, m);
      for (const id of fs.statSync(md).isDirectory() ? fs.readdirSync(md) : []) {
        const f = path.join(md, id, 'status.json'); if (!fs.existsSync(f)) continue;
        const st = readJson(f); o.total++;
        if (st.isolation === 'unconfirmed') o.isolationUnconfirmed++;
        if (st.status === 'valid') { o.valid++; continue; }
        const r = st.missingReason ?? (st.status === 'missing-input' ? 'missing-input' : st.status === 'invalid' ? 'invalid-answer' : 'failed');
        o.byReason[r] = (o.byReason[r] ?? 0) + 1;
      }
    }
    out[e] = o;
  }
  return out;
}

// ---- loaders ----
export function loadLayer1(files) {
  const m = {}, records = [];
  for (const f of files) for (const p of readJson(f).pages) for (const v of p.variants) {
    m[`${p.case}/${p.trial}/${v.variant}`] = v.pass;
    records.push({screen: `${p.case}/${p.trial}/${v.variant}`, pass: v.pass, checks: v.checks});
  }
  return {map: m, records};
}
export function layer1Summary({map, records}) {
  const control = [];
  for (const r of records.filter((x) => x.screen.endsWith('/control-attr-order'))) {
    const o = records.find((x) => x.screen === r.screen.replace(/control-attr-order$/, 'original'));
    control.push({screen: r.screen, sameAsOriginal: !!o && o.pass === r.pass && JSON.stringify(o.checks) === JSON.stringify(r.checks)});
  }
  return {screens: records.length, passed: records.filter((r) => r.pass).length, results: Object.fromEntries(Object.entries(map)), controlSameAsOriginal: control};
}
export function loadOwner(answersFile, keyFile) {
  const ans = readJson(answersFile), k = readJson(keyFile), o = {};
  for (const [pid, choice] of Object.entries(ans.answers ?? {})) {
    const p = k.pairs[pid]; if (!p) throw new Error(`owner answer for unknown pair ${pid}`);
    o[p.item] = choice === '同等' ? 'same' : choice === '判断しない' ? 'skip' : (choice === 'A' || choice === 'B') ? (p[choice] === p.first ? 'first' : 'second') : null;
  }
  return o;
}

function main() {
  const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  const all = (n) => a.flatMap((x, i) => (x === n ? [a[i + 1]] : []));
  const runs = path.resolve(opt('--runs') ?? '');
  if (a[0] === 'critiques') {
    const out = [];
    for (const e of EVALUATORS) for (const rd of fs.existsSync(path.join(runs, e)) ? fs.readdirSync(path.join(runs, e)).filter((x) => /^round\d+$/.test(x)) : []) {
      const dir = path.join(runs, e, rd, 'Fc');
      for (const id of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
        const st = statusOf(runs, e, rd.slice(5), 'Fc', id);
        if (st?.status === 'valid') out.push({id: `${e}/${rd}/${id}`, text: st.answer.critique});
      }
    }
    fs.writeFileSync(path.resolve(opt('--out')), out.map((x) => JSON.stringify(x)).join('\n') + (out.length ? '\n' : ''));
    console.log(`${out.length} critiques`);
    return;
  }
  if (a[0] !== 'decide') { console.error('usage: aggregate.mjs critiques|decide ... (see the header)'); process.exit(2); }
  const cfg = loadConfig(), key = readJson(path.resolve(opt('--key')));
  const ssr = opt('--ssr') ? readJson(path.resolve(opt('--ssr'))) : null;
  const ssrNeg = opt('--ssr-negation') ? readJson(path.resolve(opt('--ssr-negation'))) : null;
  const {J, fNeg} = collectJudgments({key, runs, cfg, ssr});
  const ledgerFile = path.join(runs, 'ledger.jsonl');
  const ledger = fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const l1 = loadLayer1(all('--layer1').map((f) => path.resolve(f)));
  const owner = opt('--owner') ? loadOwner(path.resolve(opt('--owner')), path.resolve(opt('--owner-key'))) : null;
  const res = computeAll({cfg, key, J, fNeg, layer1: l1.map, owner, ssrNeg, ssrCoreFailed: !!ssr?.coreFailed || !ssr, costs: costsFromLedger(ledger), budgetStopped: ledger.some((l) => l.type === 'stop')});
  res.layer1 = layer1Summary(l1);
  res.missingByReason = missingByReason(runs);
  res.dryRun = ledger.find((l) => l.type === 'header')?.dryRun ?? null;
  writeJson(path.resolve(opt('--out')), res);
  console.log(JSON.stringify({F: res.decisions.F.conclusion, S: res.decisions.S.conclusion, perEvaluator: Object.fromEntries(['F', 'S'].map((m) => [m, Object.fromEntries(EVALUATORS.map((e) => [e, res.decisions[m].perEvaluator[e].result]))]))}, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) main();
