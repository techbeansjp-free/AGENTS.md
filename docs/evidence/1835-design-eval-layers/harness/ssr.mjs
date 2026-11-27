// The SSR formula of EVAL_PLAN.md 3 (Maier et al.), ported from the ssr.py used in the main run so that the repository
// keeps no Python source (TypeScript/.mjs only). The embedding step (fastembed, intfloat/multilingual-e5-large) cannot be
// ported; the ssr.py that ran it is kept in Git history only (see README "SSR"), and is not run from the repository.
//   per anchor set: s_r = cos(response, anchor_r); p_r = (s_r - min s) / sum_j (s_j - min s) (uniform and "degenerate"
//   when the denominator is 0); the pmf is averaged over the sets; expected = sum r * p_r.
export const cos = (a, b) => {
  const n = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return a.reduce((s, x, i) => s + x * b[i], 0) / (n(a) * n(b));
};
export function pmfOf(sims) {
  const m = Math.min(...sims), d = sims.map((s) => s - m), total = d.reduce((s, x) => s + x, 0);
  return total <= 0 ? {pmf: sims.map(() => 1 / sims.length), degenerate: true} : {pmf: d.map((x) => x / total), degenerate: false};
}
// sets: one array of 5 similarities per anchor set.
export function combine(simSets) {
  const sets = simSets.map((sims) => ({similarities: sims, ...pmfOf(sims)}));
  const pmf = [0, 1, 2, 3, 4].map((r) => sets.reduce((s, x) => s + x.pmf[r], 0) / sets.length);
  return {pmf, expected: pmf.reduce((s, p, r) => s + (r + 1) * p, 0), sets, degenerate: sets.some((x) => x.degenerate)};
}
export const rate = (vec, anchorSets) => combine(anchorSets.map((vecs) => vecs.map((v) => cos(vec, v))));
