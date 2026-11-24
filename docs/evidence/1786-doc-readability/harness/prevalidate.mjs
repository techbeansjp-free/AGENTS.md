// モデルを呼ばずに、採点器・prompt・収集経路を合成出力で事前検証する（#1786、#1785の観点を再利用）。
// 使い方: node prevalidate.mjs   （失敗があれば終了コード1）
import fs from 'node:fs';
import path from 'node:path';
import { scoreReview, scoreReader, parseJson } from './score.mjs';
import { buildPrompt } from './build-prompt.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const evDir = path.resolve(here, '..');
const repoRoot = path.resolve(evDir, '../../..');
const gold = JSON.parse(fs.readFileSync(path.join(evDir, 'gold.json'), 'utf8'));
const doc = (c) => fs.readFileSync(path.join(evDir, 'cases', c, 'document.md'), 'utf8');
const src = (c) => fs.readFileSync(path.join(evDir, 'cases', c, 'source.md'), 'utf8');
let fail = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) fail++;
};

// 1. gold の anchor が文書・元資料に実在する（存在しない anchor は永久に検出不能になる）
for (const [c, g] of Object.entries(gold.review)) {
  for (const d of g.defects) {
    for (const a of d.docAnchors) check(`${c} ${d.id} docAnchor 実在: ${a}`, doc(c).replace(/\s/gu, '').includes(a.replace(/\s/gu, '')));
    for (const k of d.keywords) check(`${c} ${d.id} keyword が元資料にあり文書にない: ${k}`, src(c).includes(k) && !doc(c).includes(k));
  }
  for (const k of g.keeps) for (const a of k.docAnchors) check(`${c} ${k.id} keep 実在`, doc(c).includes(a));
  for (const a of g.clean) check(`${c} clean 実在: ${a}`, doc(c).includes(a));
}
for (const [c, g] of Object.entries(gold.reader)) for (const a of g.ambiguityAnchors) for (const x of a.anchors) check(`${c} ${a.id} anchor 実在`, doc(c).includes(x));

// 2. prompt に gold・採点の識別情報が入らない
for (const c of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
  for (const cond of ['A', 'B', 'C']) {
    const p = buildPrompt(c, cond, repoRoot);
    check(`${c}-${cond} prompt に gold 情報なし`, !/gold(?!en)|R\d-d\d|R\d-r\d|R\d-k\d|anchor/iu.test(p) && !g_what(c).some((w) => p.includes(w)));
  }
}
for (const c of ['P1', 'P2', 'P3']) for (const cond of ['A', 'C']) check(`${c}-${cond} prompt に正答なし`, !/gold|P\d-a\d|"answers":\{"q1":\["/u.test(buildPrompt(c, cond, repoRoot)));
function g_what(c) {
  const g = gold.review[c];
  return [...g.defects, ...g.keeps].map((d) => d.what);
}
// 条件の差分だけが追加の指示であること
for (const c of ['R1', 'R5']) {
  const a = buildPrompt(c, 'A', repoRoot);
  const b = buildPrompt(c, 'B', repoRoot);
  const cc = buildPrompt(c, 'C', repoRoot);
  const tailA = a.slice(a.indexOf('# 元資料'));
  check(`${c} B/C は A と同じ資料・出力形式`, b.endsWith(tailA) && cc.endsWith(tailA) && b.startsWith(a.slice(0, a.indexOf('# 元資料')).trimEnd()));
}

// 3. 合成出力：正解・誤答・空・壊れたJSON・部分出力・重複・捏造引用
const perfect = (c) => {
  const g = gold.review[c];
  const findings = g.defects.map((d) => ({ quote: d.docAnchors[0] ?? '', source_quote: d.keywords[0] ?? '', type: 'x', severity: 'High', action: '修正', reason: '' }));
  const out = { findings };
  if (c === 'R5') out.revised = '# 設計\n## 取得\n毎日2時に取得する。\n## 保持\n30日保持する。\n## 鍵\n暗号鍵はバックアップと同じ保存先に置かない。\n## 5. 復元\n【警告】運用責任者の承認なしに本番DBへ復元してはならない。\n## 6. 復元演習\n四半期ごとに行う。\n';
  return JSON.stringify(out);
};
for (const c of Object.keys(gold.review)) {
  const s = scoreReview(c, perfect(c), gold, doc(c));
  check(`${c} 正解出力は recall=1、harmful=0、misquoted=0`, s.valid && s.recall === 1 && s.harmful.length === 0 && s.misquoted === 0);
  const fenced = scoreReview(c, '```json\n' + perfect(c) + '\n```', gold, doc(c));
  check(`${c} code fence 付きでも採点できる`, fenced.valid && fenced.recall === 1);
  check(`${c} 空出力は無効`, !scoreReview(c, '', gold, doc(c)).valid);
  check(`${c} 壊れたJSONは無効`, !scoreReview(c, '{"findings":[{"quote":', gold, doc(c)).valid);
  check(`${c} findingsなしは無効`, !scoreReview(c, '{"result":"ok"}', gold, doc(c)).valid);
  const none = scoreReview(c, '{"findings":[]}', gold, doc(c));
  check(`${c} 指摘0件は recall=0`, none.valid && none.recall === 0);
  const dup = JSON.parse(perfect(c));
  dup.findings = [...dup.findings, ...dup.findings];
  check(`${c} 重複指摘で recall が1を超えない`, scoreReview(c, JSON.stringify(dup), gold, doc(c)).recall === 1);
}
// 誤答：clean 文への修正指摘、keep の削除提案、捏造引用
const wrong = JSON.stringify({ findings: [{ quote: '最も遅いjobはe2eで、平均11分', source_quote: '', type: '数値', severity: 'High', action: '修正', reason: '' }, { quote: '存在しない文を引用した', source_quote: '', type: 'x', severity: 'Low', action: '確認', reason: '' }] });
const w = scoreReview('R1', wrong, gold, doc('R1'));
check('R1 誤答は recall=0、cleanFlagged=1、misquoted=1', w.valid && w.recall === 0 && w.cleanFlagged === 1 && w.misquoted === 1);
const harm = JSON.stringify({ findings: [{ quote: '【警告】運用責任者の承認なしに本番DBへ復元してはならない。', source_quote: '', type: '冗長', severity: 'Low', action: '削除', reason: '概要と重複' }], revised: '# x\n## 5. 復元\n手順のみ\n' });
const h = scoreReview('R5', harm, gold, doc('R5'));
check('R5 警告の削除提案は harmful、修正版で警告欠落を検出', h.harmful.includes('R5-k1') && h.revised.checks['R5-v4'] === false);
const keepOk = JSON.stringify({ findings: [{ quote: '【警告】運用責任者の承認なしに本番DBへ復元してはならない。', source_quote: '', type: '正当な反復', severity: 'Low', action: '確認', reason: '削除しない' }] });
check('R5 警告を削除しないとする指摘は harmful でない', scoreReview('R5', keepOk, gold, doc('R5')).harmful.length === 0);
// 部分一致：短すぎる引用で誤って当たらない
const short = JSON.stringify({ findings: [{ quote: '平均', source_quote: '', type: 'x', severity: 'Low', action: '確認', reason: '' }] });
check('短い引用（8文字未満）は anchor に当たらない', scoreReview('R1', short, gold, doc('R1')).recall === 0);

// 4. 読み手：正解・全部不明・誤読・欠落
const ansOf = (c, pick) => JSON.stringify({ answers: Object.fromEntries(Object.entries(gold.reader[c].answers).map(([q, ok]) => [q, { choice: pick(ok, q), evidence: '' }])), ambiguities: [], unknowns: [] });
for (const c of Object.keys(gold.reader)) {
  const s = scoreReader(c, ansOf(c, (ok) => ok[0]), gold);
  check(`${c} 正解出力は全問正答`, s.valid && s.correct === s.questions && s.misread === 0);
  const allX = scoreReader(c, ansOf(c, () => 'X'), gold);
  check(`${c} 全部「不明」は判断可能な設問で overUnknown`, allX.valid && allX.overUnknown === allX.questions - allX.unknownQ && allX.misread === 0);
  check(`${c} 空・壊れたJSONは無効`, !scoreReader(c, '', gold).valid && !scoreReader(c, '{"answers":', gold).valid);
}
const mis = scoreReader('P2', ansOf('P2', (ok, q) => (q === 'q6' ? 'A' : q === 'q1' ? 'B' : ok[0])), gold);
check('P2 誤読（q1=B）と誤った実装方針（q6=A）を数える', mis.misread === 2 && mis.wrongDirection === 1);
const partial = scoreReader('P1', JSON.stringify({ answers: { q1: { choice: 'B' } } }), gold);
check('P1 部分出力は欠落を数える', partial.valid && partial.missing === 7 && partial.correct === 1);
const amb = scoreReader('P2', JSON.stringify({ answers: {}, ambiguities: [{ quote: '対象の画面の表示が3秒以内になる。', readings: [] }], unknowns: [{ question: '', related_quote: '対象外：管理画面。' }] }), gold);
check('P2 曖昧箇所の引用を anchor で数える', amb.ambDetected.includes('P2-a1') && amb.ambDetected.includes('P2-a2') && amb.ambDetected.includes('P2-a4'));
check('parseJson は前後の説明文があっても本体を回収する', parseJson('説明です\n{"a":1}\n以上').ok);

console.log(fail ? `prevalidate: ${fail} failed` : 'prevalidate: all ok');
process.exit(fail ? 1 : 0);
