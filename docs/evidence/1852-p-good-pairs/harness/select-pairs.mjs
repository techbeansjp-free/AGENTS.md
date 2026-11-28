// Choose the owner-decided layer-3 pairs of #1852 (EVAL_PLAN.md section 2): per case, 2 pairs for each of the 6 pairs of
// conditions (A, B, D, E), from the 3 runs of each condition in #1804; #1835's layer-3 pairs are never chosen, and the 2
// pairs of one condition pair use different runs on both sides. Deterministic from the seed (#1835 eval-common makeRng).
// Usage: node harness/select-pairs.mjs [--seed <text>]   prints the layer3.pairs object of config/eval.json
import {makeRng, shuffle} from '../../1835-design-eval-layers/harness/eval-common.mjs';

export const SEED = '18520001';
export const CASES = ['ui02-exhibition', 'ui03-dashboard', 'ui08-existing-ds'];
export const CONDITIONS = ['A', 'B', 'D', 'E'];
export const RUNS = [1, 2, 3];
export const PAIRS_PER_CONDITION_PAIR = 2;
// #1835 layer 3 (config/eval.json layer3.trials A-r1, D-r1, E-r1): the owner has seen these pairs with the evaluators' results
export const EXCLUDED = new Set(['A-r1~D-r1', 'A-r1~E-r1', 'D-r1~E-r1']);

export function selectPairs(seed = SEED) {
  const out = {};
  for (const c of CASES) {
    out[c] = [];
    for (let x = 0; x < CONDITIONS.length; x++) for (let y = x + 1; y < CONDITIONS.length; y++) {
      const [X, Y] = [CONDITIONS[x], CONDITIONS[y]];
      const cand = shuffle(RUNS.flatMap((i) => RUNS.map((j) => [`${X}-r${i}`, `${Y}-r${j}`])).filter(([a, b]) => !EXCLUDED.has(`${a}~${b}`)), makeRng(seed, `${c}:${X}${Y}`));
      const chosen = [];
      for (const p of cand) {
        if (chosen.length >= PAIRS_PER_CONDITION_PAIR) break;
        if (chosen.every((q) => q[0] !== p[0] && q[1] !== p[1])) chosen.push(p);
      }
      if (chosen.length < PAIRS_PER_CONDITION_PAIR) throw new Error(`${c} ${X}${Y}: only ${chosen.length} pairs`);
      out[c].push(...chosen);
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), i = a.indexOf('--seed');
  console.log(JSON.stringify(selectPairs(i >= 0 ? a[i + 1] : SEED)));
}
