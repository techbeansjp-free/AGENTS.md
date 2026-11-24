// Usage: node aggregate.mjs <outRoot>
// Prints the per-cell tables and the range judgments of EVAL_PLAN.md (no path is printed).
import fs from 'node:fs';
import path from 'node:path';

const outRoot = process.argv[2];
const recs = [];
for (const d of fs.readdirSync(outRoot)) {
  const f = path.join(outRoot, d, 'record.json');
  if (!/^P[123]-[A-E]-\d$/.test(d) || !fs.existsSync(f)) continue;
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  const rv = path.join(outRoot, d, 'review.json');
  rec.review = fs.existsSync(rv) ? JSON.parse(fs.readFileSync(rv, 'utf8')) : null;
  recs.push(rec);
}
const cell = (t, c) => recs.filter((r) => r.task === t && r.cond === c).sort((a, b) => a.rep - b.rep);
const rng = (xs) => (xs.some((x) => x == null) || !xs.length ? null : [Math.min(...xs), Math.max(...xs)]);
const fmt = (x, d = 2) => (x == null ? '欠測' : `${x[0].toFixed(d)}〜${x[1].toFixed(d)}`);
const sum = (o, k) => Object.values(o ?? {}).reduce((s, v) => s + (v[k] ?? 0), 0);
const sumU = (rs, who, k) => rs.map((r) => (who === 'parent' ? sum(r.parent?.usage, k) : r.children.reduce((s, c) => s + sum(c.usage, k), 0)));
const reviewH = (rs) => (rs.some((r) => r.review?.high == null) ? null : rs.reduce((s, r) => s + r.review.high, 0));
function quality(t, c) {
  const rs = cell(t, c); const a = reviewH(cell(t, 'A')); const h = reviewH(rs);
  return rs.length === 3 && rs.every((r) => r.pass === true) && (c === 'A' || (h != null && a != null && h <= a));
}
function judge(t, x, y) {
  const X = cell(t, x); const Y = cell(t, y);
  if (X.length !== 3 || Y.length !== 3) return '欠測';
  const xc = rng(X.map((r) => r.costUsd)); const yc = rng(Y.map((r) => r.costUsd));
  const xw = rng(X.map((r) => r.wallMs)); const yw = rng(Y.map((r) => r.wallMs));
  if (!xc || !yc) return '欠測';
  const loss = yc[0] > xc[1] || yw[0] > xw[1];
  if (loss) return `損（${yc[0] > xc[1] ? '費用' : ''}${yc[0] > xc[1] && yw[0] > xw[1] ? '・' : ''}${yw[0] > xw[1] ? '時間' : ''}）`;
  const q = quality(t, y);
  const better = (yc[1] < xc[0] && yw[1] <= xw[1]) || (yw[1] < xw[0] && yc[1] <= xc[1]);
  if (better && q) return `改善あり（${yc[1] < xc[0] ? '費用' : '時間'}）`;
  if (better && !q) return '改善の範囲だが品質の必要条件を満たさない';
  return '差が不明';
}
const lines = [];
for (const t of ['P1', 'P2', 'P3']) {
  lines.push(`\n### ${t}\n`);
  lines.push('| 条件 | 合格 | 費用 USD | wall-clock 秒 | 子 session（各回） | 子の最大同時数 | 1メッセージの最大 Agent 起動 | 親の Agent 起動 | test 実行（失敗） | レビュー H/M/L 合計 | 隠し test 失敗 | 親が子の file を編集 |');
  lines.push('| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const c of ['A', 'B', 'C', 'D', 'E']) {
    const rs = cell(t, c); if (!rs.length) continue;
    const rv = rs.every((r) => r.review && r.review.high != null) ? `${rs.reduce((s, r) => s + r.review.high, 0)}/${rs.reduce((s, r) => s + r.review.medium, 0)}/${rs.reduce((s, r) => s + r.review.low, 0)}` : '欠測';
    lines.push(`| ${c} | ${rs.filter((r) => r.pass).length}/${rs.length} | ${fmt(rng(rs.map((r) => r.costUsd)), 3)} | ${fmt(rng(rs.map((r) => r.wallMs / 1000)), 1)} | ${rs.map((r) => r.childSessions).join(',')} | ${rs.map((r) => r.childMaxConcurrency).join(',')} | ${rs.map((r) => r.parent?.maxAgentCallsPerMessage ?? '欠測').join(',')} | ${rs.map((r) => r.parent?.agentCalls.length ?? '欠測').join(',')} | ${rs.map((r) => `${r.testRuns}(${r.testRunFailures})`).join(',')} | ${rv} | ${rs.map((r) => r.hiddenFailures).join(',')} | ${rs.map((r) => r.parent?.reworkFiles.length ?? '欠測').join(',')} |`);
  }
  lines.push('\n| 条件 | 親 input/output/cache read/cache write（各回の和の範囲、千 token） | 子 input/output/cache read/cache write（同） | 子のモデル（実際） | CPU user+sys 秒 | 最大 RSS MB | 子の稼働の和集合 秒 | 親だけの時間 秒 | 親の Read 回数 | 子の Read 回数合計 | tool error（親/子） | 同じ file を書いた子 | 権限拒否 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const c of ['A', 'B', 'C', 'D', 'E']) {
    const rs = cell(t, c); if (!rs.length) continue;
    const k = (who) => ['input', 'output', 'cache_read', 'cache_write'].map((x) => fmt(rng(sumU(rs, who, x).map((v) => v / 1000)), 1)).join(' / ');
    const models = [...new Set(rs.flatMap((r) => r.children.flatMap((ch) => Object.keys(ch.usage))))].join(',') || 'なし';
    lines.push(`| ${c} | ${k('parent')} | ${k('child')} | ${models} | ${fmt(rng(rs.map((r) => (r.rusage.userSec ?? NaN) + (r.rusage.sysSec ?? NaN))), 1)} | ${fmt(rng(rs.map((r) => r.rusage.maxRssBytes / 1048576)), 0)} | ${fmt(rng(rs.map((r) => r.childUnionMs / 1000)), 1)} | ${fmt(rng(rs.map((r) => (r.wallMs - r.childUnionMs) / 1000)), 1)} | ${rs.map((r) => r.parent?.reads ?? '欠測').join(',')} | ${rs.map((r) => r.children.reduce((s, ch) => s + ch.reads, 0)).join(',')} | ${rs.map((r) => `${r.parent?.toolErrors ?? '欠測'}/${r.children.reduce((s, ch) => s + ch.toolErrors, 0)}`).join(',')} | ${rs.map((r) => r.sharedWriteFiles.length).join(',')} | ${rs.map((r) => r.permissionDenials ?? '欠測').join(',')} |`);
  }
}
lines.push('\n### 判定（範囲の比較）\n');
lines.push('| 課題 | 比較 | 判定 |');
lines.push('| --- | --- | --- |');
for (const t of ['P1', 'P2']) {
  for (const y of ['B', 'C', 'D', 'E']) lines.push(`| ${t} | ${y} 対 A | ${judge(t, 'A', y)} |`);
  for (const [x, y, what] of [['B', 'C', 'モデル分離（逐次）'], ['D', 'E', 'モデル分離（並列）'], ['B', 'D', '並列化（opus 子）'], ['C', 'E', '並列化（sonnet 子）']]) lines.push(`| ${t} | ${y} 対 ${x}（${what}） | ${judge(t, x, y)} |`);
}
lines.push(`| P3 | D 対 E（モデル分離、並列） | ${judge('P3', 'D', 'E')} |`);
lines.push('\n### A の自発的な選択\n');
for (const t of ['P1', 'P2']) lines.push(`- ${t}：子 session ${cell(t, 'A').map((r) => r.childSessions).join(',')}、1メッセージの最大 Agent 起動 ${cell(t, 'A').map((r) => r.parent?.maxAgentCallsPerMessage).join(',')}、子のモデル指定 ${cell(t, 'A').map((r) => (r.parent?.agentCalls ?? []).map((a) => a.model).join('+') || 'なし').join(' / ')}`);
lines.push('\n### P3 の失敗時の扱い\n');
for (const r of cell('P3', 'D').concat(cell('P3', 'E'))) lines.push(`- P3-${r.cond}-${r.rep}：合格 ${r.pass}、csv ${r.unitPass.csv}、semver ${r.unitPass.semver}、duration 不変 ${r.detail.durUnchanged}、報告 DONE=${(r.done ?? []).join('+')} BLOCKED=${(r.blocked ?? []).join('+')}`);
const total = recs.reduce((s, r) => s + (r.costUsd ?? 0), 0); const rtotal = recs.reduce((s, r) => s + (r.review?.costUsd ?? 0), 0);
lines.push(`\n費用の合計：試行 ${total.toFixed(2)} USD（${recs.length}件）、独立レビュー ${rtotal.toFixed(2)} USD（${recs.filter((r) => r.review).length}件）。`);
lines.push(`失敗の内訳：subtype が success 以外 ${recs.filter((r) => r.subtype !== 'success').length}件、exit が0以外 ${recs.filter((r) => r.exit !== 0).length}件、最大の test 同時数 ${Math.max(0, ...recs.map((r) => r.testMaxConcurrency))}。`);
console.log(lines.join('\n'));
