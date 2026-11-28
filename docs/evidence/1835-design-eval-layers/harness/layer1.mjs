// Layer 1 record of one rendered page (#1835): a provisional reading of the request's minimum, made from the outputs of
// #1807 render.mjs (axe-core WCAG 2.1 A/AA at both widths, horizontal overflow), #1815 first-view.mjs (the answer in the
// initial view at both widths, required items hidden behind an operation) and compare.mjs (pixel difference with the
// original). Passing layer 1 is not "usable"; a failure is a refutation within this limited range only.
//
// checks (each true = passes):
//   answerInitialView : first-view answerAll at both widths (items in the initial view; selectors in view)
//   noOverflowX       : no horizontal scroll at both widths
//   axeNoSeriousCritical : no axe-core node of impact serious or critical at both widths
//   noExternalRequests: no request outside the page's directory
// recorded but not a check: coverage of #1804 gold required items in the wide text, hiddenRequired, axe color-contrast
// nodes, page errors.
const norm = (s) => String(s).normalize('NFKC').replace(/\s+/g, '').replace(/[〜～]/g, '~');

export function layer1Record({render, firstView, gold, wideText, spec}) {
  const widths = {};
  const errors = [];
  for (const side of ['wide', 'narrow']) {
    const vp = render?.viewports?.[spec[side].renderName];
    const fv = firstView?.widths?.[side];
    if (!vp || vp.renderError) errors.push(`render ${side}: ${vp?.renderError ?? 'missing'}`);
    if (!fv) errors.push(`first-view ${side}: ${firstView?.error ?? 'missing'}`);
    widths[side] = {
      width: spec[side].width,
      answerAll: fv ? fv.answerAll : null,
      answerMissing: fv ? fv.answerMissing : null,
      overflowX: vp && !vp.renderError ? vp.overflowX : null,
      axeSeriousCritical: vp?.axeSeriousCritical ?? null,
      axeColorContrastNodes: vp?.axe ? vp.axe.filter((x) => x.id === 'color-contrast').reduce((a, x) => a + x.nodes, 0) : null,
      axeIds: vp?.axe ? vp.axe.map((x) => `${x.id}:${x.impact}:${x.nodes}`) : null,
    };
  }
  const both = (f) => ['wide', 'narrow'].every((s) => f(widths[s]) === true);
  const external = ['wide', 'narrow'].reduce((a, s) => a + (render?.viewports?.[spec[s].renderName]?.externalRequests?.length ?? 0), 0) + (firstView?.externalRequests ?? 0);
  const checks = {
    answerInitialView: both((w) => w.answerAll),
    noOverflowX: both((w) => w.overflowX === false),
    axeNoSeriousCritical: both((w) => w.axeSeriousCritical === 0),
    noExternalRequests: external === 0,
  };
  let coverage = null;
  if (wideText != null && gold?.required) {
    const t = norm(wideText);
    const missing = gold.required.filter((alts) => !alts.some((a) => t.includes(norm(a)))).map((a) => a[0]);
    coverage = {value: Number(((gold.required.length - missing.length) / gold.required.length).toFixed(3)), missing};
  }
  return {
    widths, checks, pass: errors.length === 0 && Object.values(checks).every(Boolean), errors,
    coverage, hiddenRequired: firstView?.widths?.wide?.hiddenRequired ?? null,
    pageErrors: ['wide', 'narrow'].flatMap((s) => render?.viewports?.[spec[s].renderName]?.pageErrors ?? []),
  };
}

// What fails in the variant that did not fail in the original (the evidence a variant adds within layer 1).
// A variant with measurement errors adds no failure evidence from its checks (a missing file is not a degradation).
export function newFailures(orig, v) {
  if ((v.errors ?? []).length) return [`unmeasured: ${v.errors.join('; ')}`];
  if ((orig.errors ?? []).length) return [`unmeasured original: ${orig.errors.join('; ')}`];
  const out = Object.keys(v.checks).filter((k) => orig.checks[k] && !v.checks[k]);
  for (const s of ['wide', 'narrow']) {
    const a = orig.widths[s].axeColorContrastNodes, b = v.widths[s].axeColorContrastNodes;
    if (a != null && b != null && b > a) out.push(`axe color-contrast +${b - a} (${s})`);
  }
  if (orig.coverage && v.coverage && v.coverage.value < orig.coverage.value) out.push(`coverage ${orig.coverage.value}→${v.coverage.value}`);
  return out;
}
