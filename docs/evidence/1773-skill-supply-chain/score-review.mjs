#!/usr/bin/env node
// Scores the blinded reviewer answers (`sNN | verdict | file | reason` lines) against gold.json and probes-gold.json.
// usage: node score-review.mjs <review-map.json> <review.txt> <gold.json>...   Reads only; prints one JSON summary.
import fs from 'node:fs';

const [mapFile, reviewFile, ...goldFiles] = process.argv.slice(2);
if (!mapFile || !reviewFile || !goldFiles.length) throw Error('usage: score-review.mjs <map> <review> <gold>...');
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const gold = new Map(goldFiles.flatMap(f => JSON.parse(fs.readFileSync(f, 'utf8')).fixtures.map(g => [g.id, g])));
const answers = new Map(fs.readFileSync(reviewFile, 'utf8').split('\n').filter(l => l.trim())
  .map(l => l.split('|').map(x => x.trim())).map(([code, verdict, file]) => [code, {verdict, file}]));
const rows = Object.entries(map).map(([code, id]) => {
  const g = gold.get(id), a = answers.get(code);
  if (!g || !a) throw Error(`missing gold or answer for ${code} (${id})`);
  const located = (g.threatFiles ?? []).includes(a.file);
  return {code, id, label: g.label, verdict: a.verdict, file: a.file, located, warn: a.verdict !== 'allow', block: a.verdict === 'block'};
});
const point = (key, set) => {
  const pos = set.filter(x => x.label === 'malicious'), neg = set.filter(x => x.label === 'benign');
  const tp = pos.filter(x => x[key] && x.located).length, fp = neg.filter(x => x[key]).length;
  return {tp, fn: pos.length - tp, fp, tn: neg.length - fp, recall: pos.length ? +(tp / pos.length).toFixed(3) : null,
    missed: pos.filter(x => !(x[key] && x.located)).map(x => x.id), falsePositives: neg.filter(x => x[key]).map(x => x.id)};
};
const fixtures = rows.filter(x => !x.id.startsWith('q')), probes = rows.filter(x => x.id.startsWith('q'));
console.log(JSON.stringify({rows, fixtures: {warn: point('warn', fixtures), block: point('block', fixtures)},
  probes: {warn: point('warn', probes), block: point('block', probes)}}, null, 1));
