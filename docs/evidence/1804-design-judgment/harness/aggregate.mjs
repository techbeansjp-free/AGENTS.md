// Applies the pre-registered decision rules (EVAL_PLAN.md) to scored trials.
// Usage: node aggregate.mjs <out-json> <score-ui02.json> <score-ui03.json> <score-ui08.json> <score-ui10.json> <ui10-tests.json> [--candidates B,D,E] [--control A]
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [out, s02, s03, s08, s10, t10] = args;
const control = opt('--control', 'A');
const candidates = opt('--candidates', 'B,D,E').split(',');
const load = (f) => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const cases = {ui02: load(s02), ui03: load(s03), ui08: load(s08)};
const ui10 = load(s10); const tests10 = load(t10) ?? {};
const of = (c, cond) => (cases[c]?.trials ?? []).filter((t) => t.condition === cond);
const ok = (t) => t.status === 'ok';
const med = (xs) => { const a = xs.filter((x) => x != null).sort((p, q) => p - q); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
// conservative substitution: a failed trial counts as worst for the candidate, best for the control
const val = (t, f, isCand, worst, best) => (ok(t) && f(t) != null ? f(t) : (isCand ? worst : best));
const range = (ts, f, isCand, worst, best) => { const v = ts.map((t) => val(t, f, isCand, worst, best)); return {values: v, min: Math.min(...v), max: Math.max(...v)}; };
const report = {schema: 'asc-1804-decision/v1', control, candidates: {}};
for (const X of candidates) {
  const r = {cases: {}, improvedAesthetic: [], improvedUx: [], worse: [], nonInferiorityFailures: [], missingCells: []};
  for (const c of ['ui02', 'ui03', 'ui08']) {
    const A = of(c, control), C = of(c, X);
    if (A.length < 3 || C.length < 3 || A.filter((t) => !ok(t)).length >= 2 || C.filter((t) => !ok(t)).length >= 2) r.missingCells.push(c);
    if (!A.length || !C.length) continue;
    const e = (t) => t.eval?.mean ?? null;
    const aE = range(A, e, false, -Infinity, Infinity), cE = range(C, e, true, -Infinity, Infinity);
    const cell = {evalTotal: {control: aE.values, candidate: cE.values}};
    if (cE.min > aE.max) r.improvedAesthetic.push(c);
    if (cE.max < aE.min) r.worse.push(c);
    const ni = [];
    const cov = [range(A, (t) => t.coverage, false, 0, 1), range(C, (t) => t.coverage, true, 0, 1)];
    if (cov[1].min < cov[0].min - 0.05) ni.push('coverage');
    const axe = [range(A, (t) => t.axeSeriousNodes, false, Infinity, 0), range(C, (t) => t.axeSeriousNodes, true, Infinity, 0)];
    if (axe[1].max > axe[0].max) ni.push('axe');
    const cnt = (ts, f) => ts.filter(f).length;
    if (cnt(C, (t) => t.overflowNarrow === true) > cnt(A, (t) => t.overflowNarrow === true)) ni.push('overflow');
    if (cnt(C, (t) => (t.externalRequests ?? 0) > 0) > cnt(A, (t) => (t.externalRequests ?? 0) > 0)) ni.push('externalRequests');
    if (cnt(C, (t) => t.motionOk === false) > cnt(A, (t) => t.motionOk === false)) ni.push('reducedMotion');
    if (cnt(C, (t) => t.lowQuality) > cnt(A, (t) => t.lowQuality)) ni.push('lowQuality');
    cell.coverage = {control: cov[0].values, candidate: cov[1].values}; cell.axeSeriousNodes = {control: axe[0].values, candidate: axe[1].values};
    if (c === 'ui08') {
      const tv = [range(A, (t) => t.tokenViolationTotal, false, Infinity, 0), range(C, (t) => t.tokenViolationTotal, true, Infinity, 0)];
      if (tv[1].max > tv[0].max) ni.push('tokens');
      if (cnt(C, (t) => t.existingUnchanged === false) > cnt(A, (t) => t.existingUnchanged === false)) ni.push('existingFilesChanged');
      const fs_ = [range(A, (t) => t.formScore, false, 0, 11), range(C, (t) => t.formScore, true, 0, 11)];
      if (fs_[1].min < fs_[0].min - 1) ni.push('formJourney');
      if (fs_[1].min > fs_[0].max) r.improvedUx.push('ui08-form');
      cell.tokenViolations = {control: tv[0].values, candidate: tv[1].values}; cell.formScore = {control: fs_[0].values, candidate: fs_[1].values};
    }
    if (c === 'ui03') {
      const g = (t) => { const xs = (t.eval?.gray ?? []).filter(Boolean).map((x) => x.recall); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
      const gr = [range(A, g, false, 0, 1), range(C, g, true, 0, 1)];
      if (gr[1].min < gr[0].min) ni.push('grayRecall');
      if (gr[1].min > gr[0].max) r.improvedUx.push('ui03-gray');
      cell.grayRecall = {control: gr[0].values, candidate: gr[1].values};
    }
    cell.nonInferiorityFailures = ni; r.nonInferiorityFailures.push(...ni.map((x) => `${c}:${x}`));
    r.cases[c] = cell;
  }
  const m10 = (cond) => (ui10?.trials ?? []).filter((t) => t.condition === cond);
  const mis = m10(X).filter((t) => t.gen.designSkillInvoked || (t.uiFilesCreated ?? []).length).length;
  const oraclePass = (cond) => m10(cond).filter((t) => ok(t) && tests10[t.trial]?.oracle?.fail === 0 && tests10[t.trial]?.oracle?.pass > 0).length;
  r.ui10 = {misfires: mis, trials: m10(X).length, oraclePassCandidate: oraclePass(X), oraclePassControl: oraclePass(control)};
  if (mis > 0) r.nonInferiorityFailures.push('ui10:misfire');
  if (oraclePass(X) < oraclePass(control)) r.nonInferiorityFailures.push('ui10:oracle');
  const costs = (cond) => ['ui02', 'ui03', 'ui08'].flatMap((c) => of(c, cond).map((t) => t.gen.costUsd));
  r.medianCost = {control: med(costs(control)), candidate: med(costs(X))};
  r.costRatio = r.medianCost.control ? +(r.medianCost.candidate / r.medianCost.control).toFixed(2) : null;
  r.designSkillInvokedRate = ['ui02', 'ui03', 'ui08'].flatMap((c) => of(c, X)).filter((t) => t.gen.designSkillInvoked).length + '/' + ['ui02', 'ui03', 'ui08'].flatMap((c) => of(c, X)).length;
  const nImp = new Set([...r.improvedAesthetic, ...r.improvedUx.map((u) => u.slice(0, 4))]).size;
  const allNi = r.nonInferiorityFailures.length === 0;
  r.decision = r.missingCells.length ? 'defer' : (nImp >= 2 && allNi && r.costRatio <= 3) ? 'adopt' : (nImp >= 1 && allNi && r.costRatio <= 3) ? 'adopt-partial' : nImp >= 1 ? 'optional' : 'reject';
  report.candidates[X] = r;
}
// descriptive: evaluator agreement and convergence fingerprints
const AX = ['subject', 'hierarchy', 'typography', 'composition', 'color', 'spacing', 'distinctiveness', 'consistency', 'decoration', 'rationale'];
let pairs = 0, exact = 0, absTot = 0, nTot = 0;
for (const c of Object.values(cases)) for (const t of c?.trials ?? []) {
  if (!t.eval) continue;
  for (const a of AX) { const [p, q] = t.eval.axes[a]; if (p != null && q != null) { pairs++; if (p === q) exact++; } }
  const [p, q] = t.eval.totals; if (p != null && q != null) { absTot += Math.abs(p - q); nTot++; }
}
report.evaluatorAgreement = {axisPairs: pairs, exactRate: pairs ? +(exact / pairs).toFixed(3) : null, meanAbsTotalDiff: nTot ? +(absTot / nTot).toFixed(2) : null};
report.fingerprints = {};
for (const cond of [control, ...candidates]) report.fingerprints[cond] = ['ui02', 'ui03'].flatMap((c) => of(c, cond).filter(ok).map((t) => `${c}:${t.fingerprint?.h1}|${t.fingerprint?.bg}`));
fs.writeFileSync(out, JSON.stringify(report, null, 1));
for (const [X, r] of Object.entries(report.candidates)) console.log(X, r.decision, 'improved', r.improvedAesthetic, r.improvedUx, 'NI-fail', r.nonInferiorityFailures, 'cost', r.costRatio, 'missing', r.missingCells);
