// 条件A・Bの回答を固定oracle（cases.json）で採点する読取りだけのscript（#1767）。
// 使い方: node score.mjs cases.json runs.json
// runs.jsonの各値は [[subagent_tokens, tool_uses, duration_ms], "FILES行のpath（カンマ区切り）"]。
import fs from 'node:fs';
const [casesPath, runsPath] = process.argv.slice(2);
const cases = new Map(JSON.parse(fs.readFileSync(casesPath, 'utf8')).cases.map((c) => [c.id, c]));
const runs = JSON.parse(fs.readFileSync(runsPath, 'utf8'));
const rows = Object.keys(runs)
  .sort()
  .map((key) => {
    const [[tok, tu, ms], files] = runs[key];
    const [cond, cid, rep] = key.split('_');
    const c = cases.get(cid);
    const got = new Set(files.split(',').map((x) => x.trim()));
    const req = c.required, opt = new Set(c.optional);
    const missed = req.filter((x) => !got.has(x)).sort();
    const extra = [...got].filter((x) => !req.includes(x) && !opt.has(x)).length;
    const critMiss = c.critical.filter((x) => !got.has(x)).length;
    return { key, cond, cid, rep, recall: (req.length - missed.length) / req.length, critMiss, extra, tok, tu, ms, missed };
  });
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
for (const r of rows)
  console.log(r.key, 'recall', r.recall.toFixed(2), 'critmiss', r.critMiss, 'extra', r.extra, 'tok', r.tok, 'tu', r.tu, 's', Math.floor(r.ms / 1000), JSON.stringify(r.missed));
const summary = (label, rs) =>
  console.log(label, 'runs', rs.length, 'full-recall', rs.filter((r) => r.recall === 1).length, 'mean recall', mean(rs.map((r) => r.recall)).toFixed(3),
    'critmiss', rs.reduce((a, r) => a + r.critMiss, 0), 'mean extra', mean(rs.map((r) => r.extra)).toFixed(1),
    'mean tok', Math.round(mean(rs.map((r) => r.tok))), 'mean tu', mean(rs.map((r) => r.tu)).toFixed(1), 'mean s', (mean(rs.map((r) => r.ms)) / 1000).toFixed(1));
for (const cond of ['A', 'B']) {
  const rs = rows.filter((r) => r.cond === cond);
  if (!rs.length) continue;
  summary(cond, rs);
  for (const rep of [...new Set(rs.map((r) => r.rep))].sort()) summary(`  ${cond} rep${rep}`, rs.filter((r) => r.rep === rep));
}
