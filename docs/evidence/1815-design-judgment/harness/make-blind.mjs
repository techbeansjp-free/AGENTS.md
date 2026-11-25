// Builds one blinded ranking round for the model evaluators (#1815). Adapted from #1807 harness/make-blind.mjs.
// Usage: node make-blind.mjs <runs-root> <render-root> <round 1|2> <blind-root> <keys-root>
// For every case: the trials decide.mjs selects (B and S reps 1..runs, failed ones replaced once), new random ids and a
// new viewing order from the seed "asc1815-round<round>" (round 2 differs from round 1 in ids and order).
// Output: <blind-root>/round<round>/<case>/{BRIEF.md, ORDER.txt, shots/<ID>-{narrow,wide}.png, live/<ID>/index.html}
// (the deliverable only, with a Content-Security-Policy that blocks every network request; DESIGN-NOTES.md, the other
// HTML files, condition names and trial numbers are not copied), and <keys-root>/<round>/<case>.json ({ID: "<B|S>-r<n>"}),
// which stays outside the blind folder until both evaluators have answered.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {evidenceRoot, loadJson} from './pairing.mjs';
import {trialRecord, failed, selectTrials} from './decide.mjs';

const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\' data: blob:; connect-src \'none\'; form-action \'none\'">';

export function blindIds(trials, seed) {
  const h = (s) => crypto.createHash('sha256').update(`${seed}:${s}`).digest('hex');
  const order = [...trials].sort((a, b) => h(a).localeCompare(h(b)));
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const ids = order.map((t) => { const x = h(`id:${t}`); return [0, 2, 4, 6].map((i) => alphabet[parseInt(x.slice(i, i + 2), 16) % alphabet.length]).join(''); });
  if (new Set(ids).size !== ids.length) throw new Error('id collision; change the seed');
  return order.map((t, i) => ({trial: t, id: ids[i]}));
}

export function makeRound(runsRoot, renderRoot, round, blindRoot, keysRoot) {
  const cases = loadJson('cases.json').cases, runs = loadJson('conditions.json').runs;
  const seed = `asc1815-round${round}`;
  const summary = {};
  for (const [caseId, k] of Object.entries(cases)) {
    const names = fs.readdirSync(path.join(runsRoot, caseId)).filter((n) => /^(B|S)-r\d+$/.test(n));
    const sel = selectTrials(names, (n) => failed(trialRecord(runsRoot, renderRoot, caseId, n)), runs);
    const cards = blindIds([...sel.B, ...sel.S], seed);
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
      const src = path.join(runsRoot, caseId, trial, 'fixture', 'out');
      if (fs.existsSync(path.join(src, 'index.html'))) {
        const dst = path.join(out, 'live', id);
        fs.cpSync(src, dst, {recursive: true, filter: (p) => p === src || (!/DESIGN-NOTES\.md$/i.test(p) && (!/\.html?$/i.test(p) || path.basename(p) === 'index.html'))});
        const f = path.join(dst, 'index.html'); const html = fs.readFileSync(f, 'utf8');
        fs.writeFileSync(f, /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${CSP}`) : CSP + html);
      }
    }
    fs.writeFileSync(path.join(out, 'ORDER.txt'), cards.map((c) => c.id).join('\n') + '\n');
    fs.mkdirSync(path.join(keysRoot, String(round)), {recursive: true});
    fs.writeFileSync(path.join(keysRoot, String(round), `${caseId}.json`), JSON.stringify(key, null, 1));
    summary[caseId] = {screens: cards.length, ids: cards.map((c) => c.id)};
  }
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [runsRoot, renderRoot, round, blindRoot, keysRoot] = process.argv.slice(2);
  if (!['1', '2'].includes(round)) { console.error('round must be 1 or 2'); process.exit(2); }
  console.log(JSON.stringify(makeRound(path.resolve(runsRoot), path.resolve(renderRoot), Number(round), path.resolve(blindRoot), path.resolve(keysRoot))));
}
