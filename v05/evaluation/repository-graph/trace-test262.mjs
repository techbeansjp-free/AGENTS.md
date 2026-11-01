// V-trace: deterministic ID links. test262 front-matter `esid:` -> ecma262 spec.html element ids.
// Also measures what a regex "mention" extractor would add (the old supported-by edge) vs declared links.
import { lsTree, CatFile } from './prototype.mjs';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const [t262, spec, outFile] = process.argv.slice(2); // test262 clone, ecma262 clone, output JSON
const now = () => performance.now();
const specText = fs.readFileSync(spec + '/spec.html', 'utf8');
const ids = new Set([...specText.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const entries = [...lsTree(t262, 'HEAD')].filter(([p]) => p.startsWith('test/') && p.endsWith('.js') && !p.includes('_FIXTURE'));
const cat = new CatFile(t262);
let t = now();
const bodies = await Promise.all(entries.map(([, e]) => cat.read(e.blob)));
const readMs = now() - t;
t = now();
const stat = { files: entries.length, withEsid: 0, resolved: 0, unresolved: 0, withoutEsid: 0, mentionOnly: 0, mentionsTotal: 0, mentionsNotDeclared: 0 };
const unresolvedSamples = new Map(); const byDir = {};
for (let i = 0; i < entries.length; i++) {
  const text = bodies[i].toString('utf8');
  const fm = text.match(/\/\*---([\s\S]*?)---\*\//);
  const esid = fm?.[1].match(/^\s*esid:\s*(\S+)/m)?.[1];
  // "mention" extractor: any sec-* token anywhere in the file (what a regex supported-by edge would see)
  const mentions = new Set([...text.matchAll(/\bsec-[a-z0-9.\-%@]+/gi)].map((m) => m[0].replace(/[.-]+$/, '')));
  stat.mentionsTotal += mentions.size;
  for (const m of mentions) if (m !== esid) stat.mentionsNotDeclared++;
  if (!esid) { stat.withoutEsid++; if (mentions.size) stat.mentionOnly++; continue; }
  stat.withEsid++;
  const top = entries[i][0].split('/').slice(0, 3).join('/');
  byDir[top] ??= { n: 0, unresolved: 0 }; byDir[top].n++;
  if (ids.has(esid)) stat.resolved++;
  else { stat.unresolved++; byDir[top].unresolved++; unresolvedSamples.set(esid, (unresolvedSamples.get(esid) ?? 0) + 1); }
}
stat.extractMs = now() - t; stat.readMs = readMs; stat.specIds = ids.size;
stat.resolvedRate = stat.resolved / stat.withEsid;
const worst = Object.entries(byDir).filter(([, v]) => v.n >= 50).map(([k, v]) => [k, v.n, +(v.unresolved / v.n).toFixed(3)]).sort((a, b) => b[2] - a[2]).slice(0, 8);
const topUnresolved = [...unresolvedSamples].sort((a, b) => b[1] - a[1]).slice(0, 12);
const out = { stat, worstDirs: worst, topUnresolved };
console.log(JSON.stringify(out, null, 1));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
cat.close();
