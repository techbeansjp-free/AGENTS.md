// 評価対象Agentへ渡すpromptを決定論的に作る（#1786）。goldは読まない。
// 使い方: node build-prompt.mjs <caseId: R1..R6|P1..P3> <cond: A|A0|B|C> [repoRoot]
// A0（補足、結果を見た後に独立レビューの指摘で追加）：Aから tracker-issue-writing の照合の段落だけを除いたもの。
// 現行ASCの規定は固定commitからgit showで取得し、作業treeの変更に影響されない。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const BASE = 'c45a8abcb1441a034f3d0b53db22644b77a9fc7f';
const here = path.dirname(new URL(import.meta.url).pathname);
const evDir = path.resolve(here, '..');

function gitShow(repoRoot, rel) {
  return execFileSync('git', ['-C', repoRoot, 'show', `${BASE}:${rel}`], { encoding: 'utf8' });
}

function body(md) {
  return md.replace(/^---\n[\s\S]*?\n---\n/u, '').trim();
}

function trackerCollation(md) {
  const start = md.indexOf('1. **依頼者の言葉との照合**');
  const end = md.indexOf('2. **新しいcontextでの読取り**');
  if (start < 0 || end < 0) throw new Error('tracker-issue-writing の照合段落が見つからない');
  return md.slice(start, end).trim();
}

export const REVERSE_OUTLINE = [
  '## 追加の確認：リバースアウトライン',
  '',
  '文書の各節（見出しごと）について、その節が実際に主張している内容を1〜2文で取り出し、元資料の要求・目的・必須制約・決定と照合する。',
  'その節が担うべき内容（例：目的の節なら得たい結果、完了の基準の節なら目的に対応する検証可能な観測、根拠の節なら主張を支える観測）と、実際の主張が一致するかを確かめ、不一致を指摘として報告する。',
  '取り出した主張そのものは出力しない。',
].join('\n');

export const MEANING_CHECK = [
  '## 追加の確認：読解と意味の保持',
  '',
  '1. 指示語の参照先が一つに決まらない箇所、定義のない語、同じものを別の語で呼ぶ・同じ語で別のものを呼ぶ箇所、適用範囲が不明な箇所、主張と具体例が合わない箇所を探す。',
  '2. 元資料と一文ずつ比べ、否定・数値・必須性（しなければならない／望ましい）・確実性（確認済み／未確認／推論）・主語・対象・条件・権限・例外・互換性要求が変わっていないかを確かめる。同じ語や数値を使っていても、主語や条件が入れ替わっていないかを見る。',
  '3. 重複した主張や目的に寄与しない記述を冗長として挙げる。ただし、独立して読まれる節に必要な警告・制約の反復、定義した用語の正当な反復は削除を提案しない。',
].join('\n');

const REVIEW_FORMAT = [
  '## 出力',
  '',
  'JSONだけを出力する（前後に説明やコードフェンスを付けない）。形式：',
  '{"findings":[{"quote":"文書からの原文どおりの引用（文書に該当箇所がない欠落の指摘なら空文字）","source_quote":"元資料からの原文どおりの引用（該当がなければ空文字）","type":"指摘の種類（自由記述）","severity":"High|Medium|Low","action":"修正|削除|確認","reason":"根拠と影響"}]%REVISED%}',
  '指摘がなければfindingsを空配列にする。',
].join('\n');

const READER_BASE = [
  'あなたは前提を知らない読み手である。次の文書だけを読み、書かれていないことは補わずに答える。本文から分からないことは「不明」とする。',
  '',
  '次を、本文の根拠（原文どおりの引用）とともに答える：目的、完了の基準、してはいけないこと、対象外、変えてよい案、最初にすること、完了の基準を満たしても目的が達成されない場合、二通りに読める点。',
].join('\n');

export const READER_CHECK = [
  '',
  '加えて、次の読解上の欠陥を具体的に探す：指示語の参照先が一つに決まらない、定義のない語、同じものを別の語で呼ぶ・同じ語で別のものを呼ぶ、適用範囲が不明、主張と具体例の不一致、判断に必要だが書かれていない情報。各欠陥について該当箇所を原文のまま引用し、成立する読み方を挙げる。欠陥がなければ無いと答える。',
].join('\n');

function readerFormat(qs, common) {
  const lines = [];
  for (const q of qs.questions) {
    const ch = Object.entries(q.choices).map(([k, v]) => `${k}: ${v}`).join(' / ');
    lines.push(`- ${q.id}: ${q.text}（${ch} / X: ${common.X} / Y: ${common.Y}）`);
  }
  return [
    '## 設問',
    '',
    '各設問に、選択肢の記号を一つだけ選んで答える。',
    ...lines,
    '',
    '## 出力',
    '',
    'JSONだけを出力する（前後に説明やコードフェンスを付けない）。形式：',
    '{"summary":{"purpose":"","done_criteria":[],"prohibitions":[],"out_of_scope":[],"changeable":[],"first_step":"","purpose_not_met_even_if_done":""},"ambiguities":[{"quote":"原文どおりの引用","readings":["読み方1","読み方2"]}],"unknowns":[{"question":"本文から分からないこと","related_quote":"関係する原文の引用（なければ空文字）"}],"answers":{"q1":{"choice":"記号","evidence":"根拠の引用"}}}',
  ].join('\n');
}

export function buildPrompt(caseId, cond, repoRoot) {
  const caseDir = path.join(evDir, 'cases', caseId);
  const doc = fs.readFileSync(path.join(caseDir, 'document.md'), 'utf8').trim();
  if (caseId.startsWith('R')) {
    if (!['A', 'A0', 'B', 'C'].includes(cond)) throw new Error(`unknown cond ${cond}`);
    const src = fs.readFileSync(path.join(caseDir, 'source.md'), 'utf8').trim();
    const rr = body(gitShow(repoRoot, 'skills/review-and-remediation/SKILL.md'));
    const rm = body(gitShow(repoRoot, 'skills/review-and-remediation/references/review-method.md'));
    const tc = trackerCollation(gitShow(repoRoot, 'skills/tracker-issue-writing/SKILL.md'));
    const revise = caseId === 'R5';
    const parts = [
      'あなたは独立Reviewerである。次の「文書」を「元資料」に照らしてレビューする。レビューのみの依頼であり、ファイルの読み書きやツールは使わない。',
      revise ? 'あわせて、レビュー結果を反映して文書を短く整えた修正版を作る。' : '文書を書き直さない。',
      '',
      '# 適用する現行の規定（ASC、固定commit）',
      '',
      '## review-and-remediation',
      '',
      rr,
      '',
      '## review-and-remediation/references/review-method.md',
      '',
      rm,
    ];
    if (cond !== 'A0') parts.push('', '## tracker-issue-writing（起票前の読み手確認の1段目）', '', tc);
    if (cond === 'B') parts.push('', REVERSE_OUTLINE);
    if (cond === 'C') parts.push('', MEANING_CHECK);
    parts.push('', '# 元資料', '', src, '', '# 文書', '', doc, '', REVIEW_FORMAT.replace('%REVISED%', revise ? ',"revised":"修正版の文書全文（Markdown）"' : ''));
    return parts.join('\n');
  }
  if (!['A', 'C'].includes(cond)) throw new Error(`reader cond must be A or C: ${cond}`);
  const qAll = JSON.parse(fs.readFileSync(path.join(evDir, 'cases', 'questions.json'), 'utf8'));
  const qs = qAll.docs[caseId];
  const parts = [`想定する読み手：${qs.reader}`, '', READER_BASE];
  if (cond === 'C') parts.push(READER_CHECK);
  parts.push('', '# 文書', '', doc, '', readerFormat(qs, qAll.common_choices));
  return parts.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [caseId, cond, repoRoot] = process.argv.slice(2);
  process.stdout.write(buildPrompt(caseId, cond, repoRoot ?? path.resolve(evDir, '../../..')));
}
