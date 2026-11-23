#!/usr/bin/env node
// Scores SkillSpector JSON reports (one <fixture-id>.json/.stderr per fixture) against gold.json.
// usage: node score.mjs <gold.json> <report-dir>   Reads only; prints one JSON summary.
import fs from 'node:fs';
import path from 'node:path';

const [goldFile, dir] = process.argv.slice(2);
if (!goldFile || !dir) throw Error('usage: score.mjs <gold.json> <report-dir>');
const gold = JSON.parse(fs.readFileSync(goldFile, 'utf8'));
const rows = [];
for (const g of gold.fixtures) {
  const text = fs.readFileSync(path.join(dir, g.id + '.json'), 'utf8');
  const stderr = fs.readFileSync(path.join(dir, g.id + '.stderr'), 'utf8');
  const m = /ASC_MEASURE exit=(\d+) rss_kib=(\d+) seconds=([\d.]+)/.exec(stderr);
  let r = null;
  try { r = JSON.parse(text); } catch { /* an error run has no report */ }
  const issues = r?.issues ?? [];
  const recommendation = r?.risk_assessment?.recommendation ?? 'ERROR';
  if (!['SAFE', 'CAUTION', 'DO_NOT_INSTALL', 'ERROR'].includes(recommendation)) throw Error(`unknown recommendation for ${g.id}: ${recommendation}`);
  const completeness = r?.analysis_completeness ?? {};
  const incomplete = !r || completeness.is_complete === false || completeness.status !== 'complete';
  const files = [...new Set(issues.map(i => i.location?.file).filter(Boolean))];
  const located = (g.threatFiles ?? []).some(f => files.some(x => x === f || x.startsWith(f + '!') || x.startsWith(f + '/') || x.startsWith(f + '::')));
  const warn = recommendation === 'CAUTION' || recommendation === 'DO_NOT_INSTALL' || incomplete;
  const block = recommendation === 'DO_NOT_INSTALL';
  rows.push({id: g.id, label: g.label, exit: m ? Number(m[1]) : null, recommendation, score: r?.risk_assessment?.score ?? null,
    incomplete, coverage: completeness.coverage_percent ?? null, issues: issues.length, ids: [...new Set(issues.map(i => i.id))].sort(),
    files, located, warn, block, llmRequested: r?.metadata?.llm_requested ?? null, rssKiB: m ? Number(m[2]) : null, seconds: m ? Number(m[3]) : null});
}
const pos = rows.filter(x => x.label === 'malicious'), neg = rows.filter(x => x.label === 'benign');
const accepts = id => gold.fixtures.find(g => g.id === id).acceptIncomplete === true;
const detected = (x, key) => x[key] && (x.located || (x.incomplete && accepts(x.id)));
const point = key => {
  const tp = pos.filter(x => detected(x, key)).length;
  const fp = neg.filter(x => x[key]).length;
  return {tp, fn: pos.length - tp, fp, tn: neg.length - fp, recall: +(tp / pos.length).toFixed(3), precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null,
    missed: pos.filter(x => !detected(x, key)).map(x => x.id), falsePositives: neg.filter(x => x[key]).map(x => x.id)};
};
const exit0 = rows.filter(x => x.exit === 0);
console.log(JSON.stringify({
  rows,
  warn: point('warn'), block: point('block'),
  exitZero: {count: exit0.length, recommendations: [...new Set(exit0.map(x => x.recommendation))].sort(), malicious: exit0.filter(x => x.label === 'malicious').map(x => x.id)},
  maxRssKiB: Math.max(...rows.map(x => x.rssKiB ?? 0)),
  meanSeconds: +(rows.reduce((s, x) => s + (x.seconds ?? 0), 0) / rows.length).toFixed(2),
}, null, 1));
