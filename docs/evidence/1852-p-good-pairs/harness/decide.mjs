// The decision of #1852 (EVAL_PLAN.md sections 5-6): does P agree with the owner on pairs of natural screens beyond chance?
// Usage: node harness/decide.mjs --key <key.json> --runs <runs> --owner <owner-answers.json> --owner-key <owner-key.json>
//          --out <result.json> [--layer1 <layer1.json>]...
// Per pair, P's judgment is the two rounds' judgment when they agree, "same" when they differ, and missing when a round
// has no valid answer. A missing judgment counts as a disagreement (it never helps adoption). Only pairs the owner
// decided (A or B) are in the test. One-sided exact binomial test against chance 0.5 at alpha 0.05, per evaluator.
import fs from 'node:fs';
import path from 'node:path';
import {readJson, writeJson, loadConfig} from '../../1835-design-eval-layers/harness/eval-common.mjs';
import {EVALUATORS, loadOwner, costsFromLedger, missingByReason, loadLayer1} from '../../1835-design-eval-layers/harness/aggregate.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function binomTail(n, k, p = 0.5) { // P(X >= k), X ~ Bin(n, p)
  let s = 0, c = 1;
  for (let i = 0; i <= n; i++) { if (i >= k) s += c * p ** i * (1 - p) ** (n - i); c = c * (n - i) / (i + 1); }
  return Math.min(1, s);
}
export function criticalK(n, alpha = 0.05, p = 0.5) { for (let k = 0; k <= n; k++) if (binomTail(n, k, p) <= alpha) return k; return null; }

// P judgments in the item's orientation ("first" | "second" | "same" | null) per evaluator and round
export function pJudgments({key, runs}) {
  const J = {};
  for (const e of EVALUATORS) {
    J[e] = {};
    for (const r of key.rounds) {
      J[e][r] = Object.fromEntries(key.items.filter((i) => !i.excluded).map((i) => [i.id, null]));
      for (const [id, p] of Object.entries(key.packets).filter(([, p]) => p.round === r && p.method === 'P')) {
        const f = path.join(runs, e, `round${r}`, 'P', id, 'status.json');
        const st = fs.existsSync(f) ? readJson(f) : null;
        if (st?.status !== 'valid' || !(p.item in J[e][r])) continue;
        const c = st.answer.choice, it = key.items.find((i) => i.id === p.item);
        J[e][r][p.item] = c === '同等' ? 'same' : (p.ids[p.task[c]] === it.first ? 'first' : 'second');
      }
    }
  }
  return J;
}
export const combine = (js) => (js.some((j) => j === null) ? null : js.every((j) => j === js[0]) ? js[0] : 'same');

export function decide({items, J, rounds, owner, rule, budgetStopped = false}) {
  const bad = Object.entries(owner).filter(([, v]) => !['first', 'second', 'same', 'skip'].includes(v));
  if (bad.length) throw new Error(`owner answers with an unknown choice: ${bad.map(([k]) => k).join(', ')}`);
  const decided = items.filter((i) => owner[i.id] === 'first' || owner[i.id] === 'second');
  const ownerCounts = {decided: decided.length, same: items.filter((i) => owner[i.id] === 'same').length, skip: items.filter((i) => owner[i.id] === 'skip').length,
    unanswered: items.filter((i) => !(i.id in owner)).length};
  const per = {};
  for (const e of EVALUATORS) {
    const pair = Object.fromEntries(items.map((i) => [i.id, combine(rounds.map((r) => J[e]?.[r]?.[i.id] ?? null))]));
    const n = decided.length, k = decided.filter((i) => pair[i.id] === owner[i.id]).length;
    const missing = decided.filter((i) => pair[i.id] === null).length, same = decided.filter((i) => pair[i.id] === 'same').length;
    const both = items.filter((i) => rounds.every((r) => (J[e]?.[r]?.[i.id] ?? null) !== null));
    const repro = both.filter((i) => rounds.every((r) => J[e][r][i.id] === J[e][rounds[0]][i.id])).length;
    const pValue = n ? binomTail(n, k, rule.chance) : null;
    let result;
    if (budgetStopped) result = '未判定';
    else if (!n || n < rule.minOwnerDecidedPairs) result = '未判定';
    else result = pValue <= rule.alpha ? '採用' : '不採用';
    per[e] = {agree: k, n, rate: n ? k / n : null, pValue, criticalK: n ? criticalK(n, rule.alpha, rule.chance) : null, pSameOnDecided: same, missingOnDecided: missing,
      reproducibility: {n: repro, d: both.length}, result, pairs: pair};
  }
  const results = EVALUATORS.map((e) => per[e].result);
  const conclusion = results.includes('未判定') ? '未判定' : results.every((r) => r === '採用') ? '採用' : '不採用';
  const agreeBetween = items.filter((i) => per.fable.pairs[i.id] !== null && per.codex.pairs[i.id] !== null);
  return {owner: ownerCounts, perEvaluator: per, conclusion,
    interEvaluator: {n: agreeBetween.filter((i) => per.fable.pairs[i.id] === per.codex.pairs[i.id]).length, d: agreeBetween.length}};
}

function main() {
  const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  const all = (n) => a.flatMap((x, i) => (x === n ? [a[i + 1]] : []));
  const cfg = loadConfig(path.join(ROOT, 'config/eval.json'));
  const key = readJson(path.resolve(opt('--key'))), runs = path.resolve(opt('--runs'));
  const items = key.items.filter((i) => !i.excluded);
  const owner = loadOwner(path.resolve(opt('--owner')), path.resolve(opt('--owner-key')));
  const ledgerFile = path.join(runs, 'ledger.jsonl');
  const ledger = fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const res = decide({items, J: pJudgments({key, runs}), rounds: key.rounds, owner, rule: cfg.decision, budgetStopped: ledger.some((l) => l.type === 'stop')});
  const l1 = loadLayer1(all('--layer1').map((f) => path.resolve(f))).map;
  const failing = items.filter((i) => l1[i.first] === false || l1[i.second] === false).map((i) => i.id);
  // secondary (not decided): the test without pairs that contain a screen failing layer 1
  const passing = items.filter((i) => !failing.includes(i.id) && l1[i.first] !== undefined && l1[i.second] !== undefined);
  const sub = decide({items: passing, J: pJudgments({key, runs}), rounds: key.rounds, owner, rule: {...cfg.decision, minOwnerDecidedPairs: 0}});
  const out = {schema: 'asc-1852-result/v1', rule: cfg.decision, items: items.length, excludedItems: key.items.filter((i) => i.excluded),
    ...res, ownerByItem: owner, layer1: {screens: Object.keys(l1).length, failingScreens: Object.entries(l1).filter(([, v]) => v === false).map(([k]) => k),
      unknownScreens: Object.entries(l1).filter(([, v]) => v === undefined).map(([k]) => k), pairsWithFailingScreen: failing,
      secondaryWithoutFailing: {note: '副次の報告。判定しない（計画5節）', pairs: passing.length, ...Object.fromEntries(EVALUATORS.map((e) => [e, (({pairs, result, ...x}) => x)(sub.perEvaluator[e])]))}},
    costs: costsFromLedger(ledger), budgetStopped: ledger.some((l) => l.type === 'stop'), missingByReason: missingByReason(runs)};
  writeJson(path.resolve(opt('--out')), out);
  console.log(JSON.stringify({conclusion: out.conclusion, owner: out.owner, ...Object.fromEntries(EVALUATORS.map((e) => [e, (({pairs, ...x}) => x)(out.perEvaluator[e])]))}, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) main();
