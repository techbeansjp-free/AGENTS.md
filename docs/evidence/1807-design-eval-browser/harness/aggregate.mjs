// Applies the EVAL_PLAN.md rules mechanically (#1807).
// Usage: node aggregate.mjs <runs-root> <render-root> <out.json> [--keys <dir>] [--ranks <ranks.json>] [--evals <dir>]
//   runs-root/<case>/<cond>-r<rep>/{meta.json,core-steps.json}; render-root/<case>/{render.json,<trial>/gold.json}
//   keys/<case>.json: {"<blind id>": "<cond>-r<rep>"}; ranks.json: {"<case>": {"<blind id>": 1..9}} (owner; optional)
//   evals/<case>-*.json: auxiliary model scoring (optional; used only for the UI-03 grayscale recall and reported as auxiliary)
import fs from 'node:fs';
import path from 'node:path';

const [runsRoot, renderRoot, outPath, ...rest] = process.argv.slice(2);
const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
const CASES = ['ui03-dashboard', 'ui04-parts-search', 'ui07-bus-mobile'];
const NARROW = {'ui03-dashboard': 'tablet', 'ui04-parts-search': 'mobile', 'ui07-bus-mobile': 'mobile'};
const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const gold = read(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'gold.json'));

function trialMetrics(caseId, trial) {
  const dir = path.join(runsRoot, caseId, trial);
  const meta = read(path.join(dir, 'meta.json')) ?? {};
  const core = read(path.join(dir, 'core-steps.json')) ?? {};
  const render = (read(path.join(renderRoot, caseId, 'render.json')) ?? []).find((r) => r.id === trial) ?? {};
  const g = read(path.join(renderRoot, caseId, trial, 'gold.json')) ?? {};
  const vps = Object.values(render.viewports ?? {});
  const renderFailed = !render.exists || vps.length === 0 || vps.some((v) => v.renderError);
  const genFailed = meta.exit !== 0 || meta.resultSubtype !== 'success';
  const failed = genFailed || renderFailed || Boolean(g.error) || g.coverage === undefined;
  const narrow = render.viewports?.[NARROW[caseId]] ?? {};
  const m = {
    trial, failed, genFailed, renderFailed, costUsd: meta.costUsd ?? null,
    coreSteps: Boolean(core.coreSteps), exemplarViewed: Boolean(core.exemplarViewed), alternativesCompared: Boolean(core.alternativesCompared),
    narrowChecked: Boolean(core.narrowChecked), wideChecked: Boolean(core.wideChecked), finalBothWidths: Boolean(core.finalBothWidths),
    toolCalls: core.toolCalls ?? null, proxy: core.proxy ?? null, proxyCorroborates: core.proxyCorroborates ?? null,
    coverage: g.coverage ?? null,
    axeSeriousCritical: vps.length ? Math.max(...vps.map((v) => v.axeSeriousCritical ?? 0)) : null,
    narrowOverflow: Boolean(narrow.overflowX),
    externalRequests: vps.reduce((a, v) => a + (v.externalRequests?.length ?? 0), 0),
    reducedMotionViolation: vps.some((v) => (v.animationsReduced ?? 0) > 0),
    tabStops: render.viewports?.desktop?.tabStops ?? null, tabStopsWithIndicator: render.viewports?.desktop?.tabStopsWithIndicator ?? null,
  };
  if (caseId === 'ui04-parts-search') m.interactionsPassed = (g.interactions ?? []).filter((x) => x.ok).length;
  if (caseId === 'ui07-bus-mobile') {
    m.firstViewportPassed = (gold.ui07.firstViewportMobile.length) - (g.firstViewportMissing?.length ?? gold.ui07.firstViewportMobile.length);
    m.minTapTargetPx = g.minTapTargetPx ?? null;
  }
  m.lowQuality = failed || (m.coverage ?? 0) < 0.9 || m.narrowOverflow;
  return m;
}

// worst-for-X / best-for-A substitution for failed trials (same as #1804)
const vals = (ts, k, side, worst, best) => ts.map((t) => (t.failed ? (side === 'X' ? worst : best) : t[k]));
const min = (a) => Math.min(...a); const max = (a) => Math.max(...a);
const count = (ts, k, side) => ts.filter((t) => (t.failed ? side === 'X' : t[k])).length;

function compare(caseId, X, A, ranks, keys) {
  const r = {nonDegradation: {}, ux: null, aesthetic: null};
  const nd = r.nonDegradation;
  nd.coverage = min(vals(X, 'coverage', 'X', 0, 1)) >= min(vals(A, 'coverage', 'A', 0, 1)) - 0.05;
  nd.axe = max(vals(X, 'axeSeriousCritical', 'X', Infinity, 0)) <= max(vals(A, 'axeSeriousCritical', 'A', Infinity, 0));
  for (const k of ['narrowOverflow', 'reducedMotionViolation', 'lowQuality']) nd[k] = count(X, k, 'X') <= count(A, k, 'A');
  nd.externalRequests = X.filter((t) => t.failed || t.externalRequests > 0).length <= A.filter((t) => !t.failed && t.externalRequests > 0).length;
  if (caseId === 'ui04-parts-search') {
    nd.interactions = min(vals(X, 'interactionsPassed', 'X', 0, 2)) >= min(vals(A, 'interactionsPassed', 'A', 0, 2));
    r.ux = {improved: min(vals(X, 'interactionsPassed', 'X', 0, 2)) > max(vals(A, 'interactionsPassed', 'A', 0, 2))};
  }
  if (caseId === 'ui07-bus-mobile') {
    const xm = min(vals(X, 'minTapTargetPx', 'X', 0, 999)); const am = min(vals(A, 'minTapTargetPx', 'A', 0, 999));
    nd.minTapTarget = xm >= am || xm >= 44;
    r.ux = {improved: min(vals(X, 'firstViewportPassed', 'X', 0, 2)) > max(vals(A, 'firstViewportPassed', 'A', 0, 2))};
  }
  if (caseId === 'ui03-dashboard') {
    const xr = X.map((t) => (t.failed ? 0 : t.grayRecall)); const ar = A.map((t) => (t.failed ? 1 : t.grayRecall));
    nd.grayRecall = xr.some((v) => v == null) || ar.some((v) => v == null) ? null : min(xr) >= min(ar);
  }
  r.nonDegradationFailed = Object.values(nd).some((v) => v === false);
  r.nonDegradationMissing = Object.entries(nd).filter(([, v]) => v === null).map(([k2]) => k2);
  if (ranks && keys) {
    const rankOf = Object.fromEntries(Object.entries(keys).map(([id, trial]) => [trial, ranks[id]]));
    const rx = X.map((t) => (t.failed ? 99 : rankOf[t.trial])); const ra = A.map((t) => (t.failed ? 0 : rankOf[t.trial]));
    if ([...rx, ...ra].some((v) => v == null)) r.aesthetic = {status: '欠測'};
    else {
      let u = 0; for (const x of rx) for (const a of ra) if (x < a) u += 1;
      r.aesthetic = {pairsXAboveA: u, of: rx.length * ra.length, status: u >= 8 ? '改善' : u <= 1 ? '劣化' : '差なし'};
    }
  } else r.aesthetic = {status: 'owner順位待ち'};
  return r;
}

const out = {schema: 'asc-1807-decision/v1', cases: {}, candidates: {}};
const ranks = opt('--ranks') ? read(opt('--ranks')) : null;
const evalsDir = opt('--evals');
for (const caseId of CASES) {
  if (!fs.existsSync(path.join(runsRoot, caseId))) continue;
  const trials = fs.readdirSync(path.join(runsRoot, caseId)).filter((t) => /^[ADE]-r\d+$/.test(t)).sort();
  const ms = trials.map((t) => trialMetrics(caseId, t));
  if (caseId === 'ui03-dashboard' && evalsDir) {
    // auxiliary: grayscale recall from the model evaluator(s), averaged
    const keys = read(path.join(opt('--keys') ?? '', `${caseId}.json`)) ?? {};
    const inv = Object.fromEntries(Object.entries(keys).map(([id, t]) => [t, id]));
    const evs = fs.readdirSync(evalsDir).filter((f) => f.startsWith(caseId)).map((f) => read(path.join(evalsDir, f)));
    const g3 = gold.ui03;
    for (const m of ms) {
      const rs = evs.map((e) => e?.scores?.[inv[m.trial]]?.flaggedInGray).filter(Array.isArray);
      if (!rs.length) { m.grayRecall = null; continue; }
      const norm = (s) => String(s).normalize('NFKC').replace(/\s+/g, '');
      m.grayRecall = rs.map((got) => g3.flagged.filter((f) => got.some((x) => norm(x).includes(norm(f)))).length / g3.flagged.length).reduce((a, b) => a + b, 0) / rs.length;
    }
  }
  const keys = opt('--keys') ? read(path.join(opt('--keys'), `${caseId}.json`)) : null;
  const by = (c) => ms.filter((m) => m.trial.startsWith(`${c}-`));
  const A = by('A');
  const caseOut = {trials: ms, candidates: {}};
  for (const X of ['D', 'E']) {
    const xs = by(X);
    const coreN = xs.filter((t) => t.coreSteps).length;
    const judgeable = coreN * 2 > xs.length;
    const cmp = compare(caseId, xs, A, ranks?.[caseId] ?? null, keys);
    const failures = xs.filter((t) => t.failed).length + A.filter((t) => t.failed).length;
    caseOut.candidates[X] = {trials: xs.length, coreSteps: coreN, status: judgeable ? '判定可能' : '未判定',
      notExecuted: xs.filter((t) => !t.coreSteps).map((t) => ({trial: t.trial, exemplarViewed: t.exemplarViewed, alternativesCompared: t.alternativesCompared, genFailed: t.genFailed})),
      defer: xs.length < 3 || A.length < 3 || xs.filter((t) => t.failed).length >= 2 || A.filter((t) => t.failed).length >= 2, failures, ...cmp};
  }
  caseOut.coreStepsByCondition = Object.fromEntries(['A', 'D', 'E'].map((c) => [c, {trials: by(c).length, coreSteps: by(c).filter((t) => t.coreSteps).length,
    exemplarViewed: by(c).filter((t) => t.exemplarViewed).length, alternativesCompared: by(c).filter((t) => t.alternativesCompared).length,
    narrowChecked: by(c).filter((t) => t.narrowChecked).length, wideChecked: by(c).filter((t) => t.wideChecked).length}]));
  out.cases[caseId] = caseOut;
}
const med = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
for (const X of ['D', 'E']) {
  const per = Object.entries(out.cases).map(([c, v]) => ({c, ...v.candidates[X]}));
  const judge = per.filter((p) => p.status === '判定可能');
  const costA = med(Object.values(out.cases).flatMap((v) => v.trials.filter((t) => t.trial.startsWith('A-')).map((t) => t.costUsd)));
  const costX = med(Object.values(out.cases).flatMap((v) => v.trials.filter((t) => t.trial.startsWith(`${X}-`)).map((t) => t.costUsd)));
  const ratio = costA ? costX / costA : null;
  const improved = judge.filter((p) => p.aesthetic?.status === '改善' || p.ux?.improved).map((p) => p.c);
  const ndFail = judge.some((p) => p.nonDegradationFailed);
  const awaitingRanks = judge.some((p) => p.aesthetic?.status === 'owner順位待ち' || p.aesthetic?.status === '欠測');
  let cls;
  if (judge.length <= 1) cls = '未判定';
  else if (judge.some((p) => p.defer)) cls = 'defer';
  else if (awaitingRanks) cls = 'owner順位待ち';
  else if (improved.length >= 2 && !ndFail && ratio <= 3) cls = 'adopt';
  else if (improved.length === 1 && !ndFail && ratio <= 3) cls = 'adopt-partial';
  else if (improved.length >= 1) cls = 'optional';
  else cls = 'reject';
  out.candidates[X] = {judgeableCases: judge.map((p) => p.c), improvedCases: improved, nonDegradationFailed: ndFail, costMedianA: costA, costMedianX: costX, costRatio: ratio, classification: cls};
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.candidates));
