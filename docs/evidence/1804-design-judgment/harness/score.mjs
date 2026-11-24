// Deterministic scoring of one case: generation meta + render metrics + gold, plus blinded evaluator scores if given.
// Usage: node score.mjs <runs-root> <render-dir> <case-id> <out-json> [--key key.json --evals e1.json,e2.json]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.resolve(here, '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const [runs, render, caseId, outJson] = args;
const short = caseId.slice(0, 4);
const gold = JSON.parse(fs.readFileSync(path.join(evidence, 'gold.json'), 'utf8'))[short];
const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '').replace(/[〜～]/g, '~');
const rendered = fs.existsSync(path.join(render, 'render.json')) ? JSON.parse(fs.readFileSync(path.join(render, 'render.json'), 'utf8')) : [];
const byId = Object.fromEntries(rendered.map((r) => [r.id, r]));
const AXES = ['subject', 'hierarchy', 'typography', 'composition', 'color', 'spacing', 'distinctiveness', 'consistency', 'decoration', 'rationale'];
const keyMap = opt('--key') ? JSON.parse(fs.readFileSync(opt('--key'), 'utf8')).key : {};
const evals = (opt('--evals') ?? '').split(',').filter(Boolean).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const DESIGN = ['frontend-design', 'anything-frontend-art-direction', 'anything-frontend-product-design'];
const trials = [];
for (const trial of fs.readdirSync(path.join(runs, caseId)).sort()) {
  const dir = path.join(runs, caseId, trial); const fx = path.join(dir, 'fixture');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const t = {trial, condition: meta.condition, rep: meta.rep, gen: {exit: meta.exit, subtype: meta.resultSubtype, isError: meta.isError, costUsd: meta.costUsd,
    turns: meta.numTurns, wallMs: meta.wallMs, inputTokens: meta.usage?.input_tokens ?? null, outputTokens: meta.usage?.output_tokens ?? null,
    cacheRead: meta.usage?.cache_read_input_tokens ?? null, cacheWrite: meta.usage?.cache_creation_input_tokens ?? null,
    toolCalls: Object.values(meta.toolCounts ?? {}).reduce((a, b) => a + b, 0), toolCounts: meta.toolCounts, skillCalls: meta.skillCalls,
    designSkillInvoked: (meta.skillCalls ?? []).some((s) => DESIGN.some((d) => String(s).includes(d))), skillFileReads: (meta.skillFileReads ?? []).length,
    model: meta.initModel}};
  t.status = meta.exit !== 0 || meta.isError ? 'gen-failed' : 'ok';
  if (short === 'ui10') {
    const files = listFiles(fx).filter((f) => !f.startsWith('.claude/'));
    t.uiFilesCreated = files.filter((f) => /\.(html|css)$/.test(f) || /DESIGN-NOTES/.test(f));
    t.srcChanged = sha(path.join(fx, 'src/summarize.mjs')) !== sha(path.join(evidence, 'cases', caseId, 'src/summarize.mjs'));
    trials.push(t); continue;
  }
  const r = byId[trial];
  const main = r?.viewports?.desktop;
  const narrow = r?.viewports?.[short === 'ui03' ? 'tablet' : 'mobile'];
  t.outputExists = !!r?.exists;
  if (!t.outputExists) { t.status = t.status === 'ok' ? 'no-output' : t.status; }
  else if (fs.statSync(path.join(fx, short === 'ui08' ? 'app/billing.html' : 'out/index.html')).size === 0) { t.status = t.status === 'ok' ? 'empty-output' : t.status; }
  else if (!main || main.renderError) { t.status = 'render-failed'; t.renderError = main?.renderError ?? 'missing'; }
  if (t.outputExists && main && !main.renderError) {
    const text = norm(fs.readFileSync(path.join(render, trial, 'desktop.txt'), 'utf8'));
    const miss = gold.required.filter((alts) => !alts.some((a) => text.includes(norm(a))));
    t.coverage = +(1 - miss.length / gold.required.length).toFixed(3); t.missing = miss.map((a) => a[0]);
    if (gold.englishSentencesMin) { const raw = fs.readFileSync(path.join(render, trial, 'desktop.txt'), 'utf8'); t.englishSentences = (raw.match(/[A-Za-z][A-Za-z,'’\- ]{40,}[.!?]/g) ?? []).length; }
    if (gold.firstViewportMobile && narrow && !narrow.renderError) t.firstViewportMobile = gold.firstViewportMobile.every((k) => narrow.firstY?.[k] != null && narrow.firstY[k] < 844);
    t.overflowNarrow = narrow ? !!narrow.overflowX : null; t.overflowDesktop = !!main.overflowX;
    t.axeSeriousNodes = (main.axe ?? []).filter((v) => v.impact === 'serious' || v.impact === 'critical').reduce((a, v) => a + v.nodes, 0);
    t.axeRules = (main.axe ?? []).map((v) => `${v.id}:${v.impact}:${v.nodes}`);
    t.externalRequests = Object.values(r.viewports).reduce((a, v) => a + (v.externalRequests?.length ?? 0), 0);
    t.pageErrors = Object.values(r.viewports).reduce((a, v) => a + (v.pageErrors?.length ?? 0), 0);
    t.tabStops = main.tabStops; t.focusIndicatorRatio = main.tabStops ? +(main.tabStopsWithIndicator / main.tabStops).toFixed(2) : null;
    t.tabsToReserve = main.tabsToReserve ?? null; t.tabsToRetry = main.tabsToRetry ?? null;
    t.motion = {animations: main.animations, reducedQuery: main.hasReducedMotionQuery, runningWhenReduced: main.animationsReduced};
    t.motionOk = main.animations === 0 || main.animationsReduced === 0 || main.hasReducedMotionQuery;
    t.lcpMs = main.lcp; t.cls = main.cls;
    t.fingerprint = {h1: first(main.fontH1), body: first(main.fontBody), bg: main.bodyBg, top: (main.topColors ?? []).slice(0, 4).map((c) => c[0])};
    const outFiles = short === 'ui08' ? ['app/billing.html', 'app/billing.css'] : ['out/index.html'];
    t.bytes = outFiles.reduce((a, f) => a + (fs.existsSync(path.join(fx, f)) ? fs.statSync(path.join(fx, f)).size : 0), 0);
    t.notesExist = fs.existsSync(path.join(fx, 'out', 'DESIGN-NOTES.md'));
    if (short === 'ui08') {
      t.existingUnchanged = gold.existingFiles.every((f) => sha(path.join(fx, f)) === sha(path.join(evidence, 'cases', caseId, f)));
      const html = fs.readFileSync(path.join(fx, 'app/billing.html'), 'utf8');
      const css = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/g) ?? []).join('\n') + (fs.existsSync(path.join(fx, 'app/billing.css')) ? fs.readFileSync(path.join(fx, 'app/billing.css'), 'utf8') : '') + (html.match(/style="[^"]*"/g) ?? []).join('\n');
      t.tokenViolations = {rawColors: (css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? []).length, fontLiterals: (css.match(/font-family\s*:\s*(?!var\()/g) ?? []).length,
        newCustomProps: (css.match(/--[a-z0-9-]+\s*:/gi) ?? []).length};
      t.tokenViolationTotal = t.tokenViolations.rawColors + t.tokenViolations.fontLiterals;
      t.linksTokens = /href="tokens\.css"/.test(html) && /href="components\.css"/.test(html);
      t.componentClassesUsed = gold.componentClasses.filter((c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(html)).length;
      const f = r.form ?? {};
      const checks = {labels: f.labelsFound ? Object.values(f.labelsFound).every(Boolean) : false, emptyInvalid: (f.emptySubmit?.invalid ?? 0) >= 5,
        errorsLinked: (f.emptySubmit?.describedBy ?? 0) >= 5, badEmailFlagged: (f.badEmail?.invalid ?? []).length >= 1, retainedAfterError: f.retainedAfterError === true,
        disabledWhileSaving: f.disabledWhileSaving === true, success: f.successText === true, failure: f.failureText === true, retainedAfterFailure: f.retainedAfterFailure === true,
        viewerLocked: !!f.viewer && f.viewer.inputs > 0 && f.viewer.locked === f.viewer.inputs && !f.viewer.saveUsable, viewerReason: f.viewer?.reasonShown === true};
      t.formChecks = checks; t.formScore = Object.values(checks).filter(Boolean).length; t.formError = f.error ?? null;
    }
  }
  const id = Object.keys(keyMap).find((k) => keyMap[k] === trial);
  if (id && evals.length) {
    const per = evals.map((e) => e.scores?.[id] ?? null);
    t.eval = {id, totals: per.map((s) => s && AXES.every((a) => typeof s[a] === 'number') ? AXES.reduce((x, a) => x + s[a], 0) : null),
      axes: Object.fromEntries(AXES.map((a) => [a, per.map((s) => s?.[a] ?? null)]))};
    const ok = t.eval.totals.filter((x) => x != null); t.eval.mean = ok.length ? +(ok.reduce((a, b) => a + b, 0) / ok.length).toFixed(2) : null;
    if (short === 'ui03') t.eval.gray = per.map((s) => { if (!s?.flaggedInGray) return null; const got = s.flaggedInGray.map(String);
      const hit = gold.flagged.filter((g) => got.some((x) => norm(x).includes(norm(g)))).length; const fp = gold.notFlagged.filter((g) => got.some((x) => norm(x).includes(norm(g)) && !gold.flagged.some((f) => norm(x).includes(norm(f))))).length;
      return {recall: +(hit / gold.flagged.length).toFixed(2), falsePositives: fp}; });
  }
  t.lowQuality = t.status !== 'ok' || (t.coverage ?? 0) < 0.9 || t.overflowNarrow === true || (t.eval?.mean != null && t.eval.mean < 10);
  trials.push(t);
}
fs.writeFileSync(outJson, JSON.stringify({schema: 'asc-1804-score/v1', case: caseId, trials}, null, 1));
console.log(`${caseId}: ${trials.length} trials scored`);
function first(ff) { return ff ? ff.split(',')[0].replace(/["']/g, '').trim() : null; }
function listFiles(d, base = d) { return fs.readdirSync(d, {withFileTypes: true}).flatMap((e) => e.isDirectory() ? listFiles(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name))]); }
