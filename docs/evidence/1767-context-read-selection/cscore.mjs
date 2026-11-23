// 条件C：モデルを使わない決定論的な候補順位付け（語のTF-IDF＋path一致＋test対応付け）の読取りだけの評価script（#1767）。
// 使い方: node cscore.mjs <git作業tree> <commit> cases.json
// 対象commitのfileをGitのobjectから読む（作業treeの未commit変更は使わない）。
// 原版（Python）と同じく、gitがquoteするpath（非ASCII名。日本語の.md等）は候補に含めない。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [repo, commit, casesPath] = process.argv.slice(2);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8')).cases;
const files = git('ls-tree', '-r', '--name-only', commit)
  .split('\n')
  .filter((f) => f && !f.startsWith('"') && /\.(mjs|ts|json|md|js)$/.test(f) && !f.startsWith('docs/') && !f.includes('package-lock'));
const text = new Map(files.map((f) => [f, git('show', `${commit}:${f}`)]));
const STOP = new Set('that this make also with from must should the and for are any under into than only have each what when which their command current instead includes include whether'.split(' '));
const count = (s, t) => s.split(t).length - 1;
function tokens(req) {
  const out = [];
  for (let x of req.match(/[A-Za-z_][A-Za-z0-9_.\-/]{3,}/g) ?? []) {
    x = x.replace(/^\.+|\.+$/g, '');
    if (STOP.has(x.toLowerCase())) continue;
    out.push(x);
    for (const y of x.split(/[-/._]/)) if (y.length > 3 && !STOP.has(y.toLowerCase()) && y !== x) out.push(y);
  }
  return [...new Set(out)];
}
const N = text.size;
const res = [];
for (const c of cases) {
  const toks = tokens(c.req);
  const score = new Map();
  const bump = (f, v) => score.set(f, (score.get(f) ?? 0) + v);
  for (const t of toks) {
    const h = [...text].filter(([, s]) => s.includes(t));
    if (!h.length) continue;
    const idf = Math.log(N / (1 + h.length));
    for (const [f, s] of h) bump(f, idf * Math.log(1 + count(s, t)));
  }
  for (const f of [...score.keys()]) for (const t of toks) if (f.toLowerCase().includes(t.toLowerCase())) bump(f, 2);
  const top = [...score.keys()].sort((a, b) => score.get(b) - score.get(a)).slice(0, 5);
  for (const f of top) {
    const base = path.basename(f).replace('.mjs', '');
    for (const [g, s] of text) {
      if (g === `test/test_${base.replaceAll('-', '_')}.mjs` || g === `test/test_${base}.mjs`) bump(g, 5);
      if ((f.startsWith('src/') && s.includes(`./${path.basename(f)}`)) || s.includes(`../${f}`)) bump(g, 1);
    }
  }
  const rank = [...score.keys()].sort((a, b) => score.get(b) - score.get(a));
  const row = { id: c.id, n_req: c.required.length };
  for (const k of [5, 10]) {
    const sel = new Set(rank.slice(0, k));
    row[`recall@${k}`] = Math.round((c.required.filter((x) => sel.has(x)).length / c.required.length) * 100) / 100;
    row[`crit_miss@${k}`] = c.critical.filter((x) => !sel.has(x)).sort();
  }
  row[`missed@10`] = c.required.filter((x) => !rank.slice(0, 10).includes(x)).sort();
  res.push(row);
}
for (const r of res) console.log(JSON.stringify(r));
for (const k of ['recall@5', 'recall@10'])
  console.log(k, 'mean', (res.reduce((a, r) => a + r[k], 0) / res.length).toFixed(2), 'full-recall cases', res.filter((r) => r[k] === 1).length, '/', res.length);
