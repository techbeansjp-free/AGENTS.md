// Copies the per-trial records that go into the repository, with local paths and account data removed (#1815).
// Redaction is #1814 collect.mjs redact + scrubSensitive (paths under /Users, /home, /private/var/folders; mail addresses,
// tokens, account fields), plus the runs root replaced by <runs>. Refuses to write when a scrubbed record still contains
// the runs root.
// Kept per trial: meta.json (initSkills dropped), reads.json, core-steps.json, trace.jsonl (redacted), proxy.jsonl,
// tools.jsonl, gold.json, first-view.json and the render summary without page text. Not kept: fixtures, screenshots,
// the sample project, HOME/config (already deleted by run-trial).
// Usage: node collect.mjs <runs-root> <render-root> <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import {redact, scrubSensitive} from '../../1814-skill-invocation/harness/collect.mjs';

export function clean(text, runsRoot) {
  const real = fs.existsSync(runsRoot) ? fs.realpathSync(runsRoot) : runsRoot;
  const variants = [...new Set([runsRoot, real, real.replace(/^\/private(?=\/(tmp|var)\/)/, '')])].sort((a, b) => b.length - a.length);
  let t = String(text);
  for (const v of variants) t = t.split(v).join('<runs>');
  const r = scrubSensitive(redact(t, runsRoot));
  if (variants.some((v) => r.text.includes(v))) throw new Error('runs root left after redaction');
  return r;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [runsArg, renderArg, outArg] = process.argv.slice(2).map((p) => path.resolve(p));
  let hits = 0;
  const rows = [];
  for (const c of fs.readdirSync(runsArg).filter((x) => fs.statSync(path.join(runsArg, x)).isDirectory()).sort()) {
    for (const t of fs.readdirSync(path.join(runsArg, c)).filter((x) => /^(B|S)-r\d+$/.test(x)).sort()) {
      const src = path.join(runsArg, c, t), dst = path.join(outArg, 'trials', c, t);
      if (!fs.existsSync(path.join(src, 'meta.json'))) { rows.push({case: c, trial: t, missing: 'meta.json'}); continue; }
      fs.mkdirSync(dst, {recursive: true});
      const put = (name, text) => { const r = clean(text, runsArg); hits += r.hits; fs.writeFileSync(path.join(dst, name), r.text); };
      const meta = JSON.parse(fs.readFileSync(path.join(src, 'meta.json'), 'utf8'));
      delete meta.initSkills;
      put('meta.json', JSON.stringify(meta, null, 1));
      for (const f of ['reads.json', 'core-steps.json', 'trace.jsonl', 'proxy.jsonl']) if (fs.existsSync(path.join(src, f))) put(f, fs.readFileSync(path.join(src, f), 'utf8'));
      const tl = path.join(src, 'log', 'tools.jsonl');
      if (fs.existsSync(tl)) put('tools.jsonl', fs.readFileSync(tl, 'utf8'));
      for (const f of ['gold.json', 'first-view.json']) { const g = path.join(renderArg, c, t, f); if (fs.existsSync(g)) put(f, fs.readFileSync(g, 'utf8')); }
      const rj = path.join(renderArg, c, 'render.json');
      if (fs.existsSync(rj)) {
        const r = JSON.parse(fs.readFileSync(rj, 'utf8')).find((x) => x.id === t);
        if (r) { for (const v of Object.values(r.viewports ?? {})) delete v.textSample; delete r.file; put('render.json', JSON.stringify(r, null, 1)); }
      }
      rows.push({case: c, trial: t, costUsd: meta.costUsd, exit: meta.exit, subtype: meta.resultSubtype, reads: meta.reads, coreSteps: meta.coreSteps, ledgerSeq: meta.ledgerSeq});
    }
  }
  fs.mkdirSync(outArg, {recursive: true});
  fs.writeFileSync(path.join(outArg, 'trials.json'), JSON.stringify(rows, null, 1));
  console.log(JSON.stringify({trials: rows.length, redactedSensitive: hits}));
}
