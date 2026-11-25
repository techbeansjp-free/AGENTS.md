// Builds one blinded ranking round for the model evaluators (#1815). Adapted from #1807 harness/make-blind.mjs.
// Usage: node make-blind.mjs <runs-root> <render-root> <round 1|2> <blind-root> <keys-root> <ledger>
// Refuses when decide.mjs runConsistency fails, when a counted trial's fixation record differs, or when the blind root
// and the runs/keys roots are not separate trees. For every case: the valid trials (decide.mjs counts them and they are
// not failed; failed trials are not ranked, review M-4), new random ids and a new viewing order from the seed
// "asc1815-round<round>". Output: <blind-root>/round<round>/<case>/{BRIEF.md, ORDER.txt, shots/<ID>-{narrow,wide}.png,
// live/<ID>/index.html + only the assets it references (referencedAssets; review M-1)} with a Content-Security-Policy
// that blocks every network request, and <keys-root>/<round>/<case>.json ({ID: "<B|S>-r<n>"}). The ranking itself runs
// in a copy of <blind-root>/round<round> while rank-guard.mjs keeps the runs and keys roots unreadable (review M-2).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {evidenceRoot, loadJson} from './pairing.mjs';
import {trialRecord, fixationProblemsForScoring, runConsistency, failed} from './decide.mjs';

const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\' data: blob:; connect-src \'none\'; form-action \'none\'">';

export function blindIds(trials, seed) {
  const h = (s) => crypto.createHash('sha256').update(`${seed}:${s}`).digest('hex');
  const order = [...trials].sort((a, b) => h(a).localeCompare(h(b)));
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const ids = order.map((t) => { const x = h(`id:${t}`); return [0, 2, 4, 6].map((i) => alphabet[parseInt(x.slice(i, i + 2), 16) % alphabet.length]).join(''); });
  if (new Set(ids).size !== ids.length) throw new Error('id collision; change the seed');
  return order.map((t, i) => ({trial: t, id: ids[i]}));
}

// The files the deliverable references, resolved statically: src/href/poster/srcset attributes and CSS url() in the
// HTML and in referenced CSS files, relative paths only, inside out/, existing, not HTML/Markdown. Alternative designs
// (other HTML files, sub-folders not referenced), notes and unreferenced assets are never copied (review M-1).
export function referencedAssets(outDir) {
  const root = fs.realpathSync(outDir);
  const found = new Set();
  const refs = (text) => {
    const out = [];
    for (const m of text.matchAll(/\b(?:src|href|poster|data-src)\s*=\s*["']([^"']+)["']/gi)) out.push(m[1]);
    for (const m of text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) out.push(...m[1].split(',').map((x) => x.trim().split(/\s+/)[0]));
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) out.push(m[1]);
    return out;
  };
  const visit = (fromFile, text) => {
    for (const ref of refs(text)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//') || ref.startsWith('#') || ref.startsWith('/')) continue;
      const clean = decodeURIComponent(ref.split(/[?#]/)[0]);
      if (!clean) continue;
      const abs = path.resolve(path.dirname(fromFile), clean);
      const rel = path.relative(root, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      if (fs.realpathSync(abs) !== abs && path.relative(root, fs.realpathSync(abs)).startsWith('..')) continue;
      if (/\.(html?|md|markdown)$/i.test(abs) || found.has(rel)) continue;
      found.add(rel);
      if (/\.css$/i.test(abs)) visit(abs, fs.readFileSync(abs, 'utf8'));
    }
  };
  const index = path.join(root, 'index.html');
  visit(index, fs.readFileSync(index, 'utf8'));
  return [...found].sort();
}

// out/index.html (with the CSP) and the assets it references, nothing else.
export function copyDeliverable(src, dst) {
  fs.mkdirSync(dst, {recursive: true});
  for (const rel of referencedAssets(src)) { fs.mkdirSync(path.dirname(path.join(dst, rel)), {recursive: true}); fs.copyFileSync(path.join(src, rel), path.join(dst, rel)); }
  const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(dst, 'index.html'), /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (x) => `${x}${CSP}`) : CSP + html);
}

// The blind round directory must not be inside, nor contain, the runs root or the keys root (review M-2).
export function blindPlacementProblems(blindRoot, runsRoot, keysRoot) {
  const inside = (c, p) => { const r = path.relative(p, c); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  const p = [];
  for (const [n, x] of [['runs root', runsRoot], ['keys root', keysRoot]]) {
    if (inside(blindRoot, x)) p.push(`blind root is inside the ${n}`);
    if (inside(x, blindRoot)) p.push(`the ${n} is inside the blind root`);
  }
  if (inside(keysRoot, runsRoot) || inside(runsRoot, keysRoot)) p.push('keys root and runs root must be separate trees');
  return p;
}

// review M-4: only valid trials (counted and not failed, decide.mjs failed) are ranked.
export function makeRound(runsRoot, renderRoot, round, blindRoot, keysRoot, ledger) {
  const cases = loadJson('cases.json').cases;
  const rc = runConsistency(runsRoot, ledger);
  if (rc.problems.length) throw new Error(`refused: ${rc.problems.join('; ')}`);
  const bp = blindPlacementProblems(blindRoot, runsRoot, keysRoot);
  if (bp.length) throw new Error(`refused: ${bp.join('; ')}`);
  const seed = `asc1815-round${round}`;
  const summary = {};
  for (const [caseId, k] of Object.entries(cases)) {
    const {sel} = rc.perCase[caseId];
    const recs = Object.fromEntries([...sel.B, ...sel.S].map((n) => [n, trialRecord(runsRoot, renderRoot, caseId, n)]));
    const fp = fixationProblemsForScoring(Object.values(recs).map((r) => r.meta));
    if (fp.length) throw new Error(`refused: ${fp.join('; ')}`);
    const valid = [...sel.B, ...sel.S].filter((n) => !failed(recs[n]));
    const cards = blindIds(valid, seed);
    const out = path.join(blindRoot, `round${round}`, caseId);
    if (fs.existsSync(out)) throw new Error(`exists: ${out}`);
    fs.mkdirSync(path.join(out, 'shots'), {recursive: true});
    fs.copyFileSync(path.join(evidenceRoot, k.from, 'BRIEF.md'), path.join(out, 'BRIEF.md'));
    const key = {};
    for (const {trial, id} of cards) {
      key[id] = trial;
      const r = path.join(renderRoot, caseId, trial);
      for (const [side, file] of [['narrow', `${k.narrow.renderName}.png`], ['wide', `${k.wide.renderName}.png`]]) {
        if (fs.existsSync(path.join(r, file))) fs.copyFileSync(path.join(r, file), path.join(out, 'shots', `${id}-${side}.png`));
      }
      copyDeliverable(path.join(runsRoot, caseId, trial, 'fixture', 'out'), path.join(out, 'live', id));
    }
    fs.writeFileSync(path.join(out, 'ORDER.txt'), cards.map((c) => c.id).join('\n') + '\n');
    fs.mkdirSync(path.join(keysRoot, String(round)), {recursive: true});
    fs.writeFileSync(path.join(keysRoot, String(round), `${caseId}.json`), JSON.stringify(key, null, 1));
    summary[caseId] = {screens: cards.length, excludedFailed: [...sel.B, ...sel.S].filter((n) => !valid.includes(n)).length};
  }
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [runsRoot, renderRoot, round, blindRoot, keysRoot, ledger] = process.argv.slice(2);
  if (!ledger) { console.error('usage: make-blind.mjs <runs> <render> <1|2> <blind-root> <keys-root> <ledger>'); process.exit(2); }
  if (!['1', '2'].includes(round)) { console.error('round must be 1 or 2'); process.exit(2); }
  console.log(JSON.stringify(makeRound(path.resolve(runsRoot), path.resolve(renderRoot), Number(round), path.resolve(blindRoot), path.resolve(keysRoot), path.resolve(ledger))));
}
