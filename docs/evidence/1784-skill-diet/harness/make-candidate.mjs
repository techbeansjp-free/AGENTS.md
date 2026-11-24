// Apply candidate C edits to a copy of skills/asc. Fails if any anchor is missing.
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2];
const edit = (file, pairs) => { const p = path.join(dir, file); let t = fs.readFileSync(p, 'utf8');
  for (const [a, b] of pairs) { const n = t.split(a).length - 1; if (n !== 1) throw Error(`${file}: anchor count ${n}: ${a.slice(0, 40)}`); t = t.replace(a, b); }
  fs.writeFileSync(p, t); };
const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
const grab = (start, end) => { const i = skill.indexOf(start); const j = skill.indexOf(end, i); if (i < 0 || j < 0) throw Error('grab ' + start.slice(0, 20)); return skill.slice(i, j); };
// D3: request-content bullets + remediation details duplicate references/review.md and review-and-remediation.
const bullets = grab('依頼文には次を含める。', '独立性はContextで確保し');
const remed = grab('指摘の是正と再レビューの要否は[重要度別の是正]', '許可されたDraft PR提出');
// D4: low-frequency merge-permission persistence/revocation details move to review.md (verbatim).
const persist = grab('同じ会話の中では、merge前に毎回', 'どの段階のmerge許可も');
// D5: sentences guaranteed by `start` output (notices/authority).
const r1 = 'この時点では入れ子のAGENTS.md/CLAUDE.mdは未探索なので、編集対象が決まったら実装前に全対象pathで再実行する。';
const r2 = '一覧の適用規約を読み、実装と既存の独立Reviewerへ同じpath・hash・適用条件を渡す。';
const r3 = 'CLIは対象project外を自動探索しない。旧project-policyや索引未設定のnoticeを無視せず、旧設定の参照先と現在適用すべき内容を確認する。旧設定を置いただけで旧CLIの強制機構が動くとは扱わない。';
const r4 = '設定から権限を拡大しない。';
const r5 = '参照取得は適用の証明ではなく、Reviewerは要求・実装が規約に適合するか確認する。';
// D2: CLI-enforced fact and claim guard.
const s1 = '`run` 系CLIには `--snapshot` が必要であり、通常の開発依頼だけをその選択と解釈しない。';
const s2 = 'Controllerの単一model指定は自動ルーティングではない。このSkillを追加したことを自動選択機能の実装済みと説明しない。\n\n';
edit('SKILL.md', [
  [bullets, '依頼文の内容（手順の所在・要求・対象・実検証の参照）と結果の回収は[独立レビューと是正](references/review.md)に従い、本文や差分全文を複製せず参照で渡す。\n\n'],
  [remed, '指摘の是正と再レビューの要否は[重要度別の是正](references/review.md#重要度別の是正と再レビュー)に従う。要求・コード・検証設定・依存環境が不変で、指摘や実行異常もなければ、進行役による同じ差分全文の再読込み・同じテストの再実行は不要。Reviewer自身の独立確認と必須CIは省略しない。\n\n'],
  [r1, 'notices・authorityの指示に従う。'],
  [r2, '一覧の適用規約を読む。'],
  [r3, ''],
  [r4, ''],
  [r5, ''],
  [persist, '別セッション・引継ぎ文・compaction後の要約にある許可は、利用者が現在の会話で改めて明示した場合、または利用者が記録した「常に許可」を照合できた場合だけ有効とする。記録の条件・照合・取消しは[直前確認](references/review.md#許可されたmergeの直前)に従う。\n\n'],
  [s1, '通常の開発依頼だけをその選択と解釈しない。'],
  [s2, ''],
]);
edit('references/review.md', [
  ['## 許可されたmergeの直前\n\n', '## 許可されたmergeの直前\n\n' + persist.replaceAll('](references/', '](')],
]);
edit('references/controller.md', [
  ['`capabilities`で実際の入口', 'Controllerの単一model指定は自動ルーティングではない。ASC Skillを追加したことを自動選択機能の実装済みと説明しない。\n\n`capabilities`で実際の入口'],
]);
