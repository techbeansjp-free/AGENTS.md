# 判定の規則（モデル実行の前に固定）

対象：#1817。規則はownerの判断（2026-11-25、[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1817#issuecomment-7159921981)）による。判定の手順は[harness/score.mjs](harness/score.mjs)の`judge1817`で実装し、合成の記録で試験した（[harness/score.test.mjs](harness/score.test.mjs)）。評価結果を見た後に、この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・採点の処理を変えない。

## ownerの決定

| 項目 | 決定 |
| --- | --- |
| 比べる条件 | B（現状：v0.5.109のrelease）とS（改善案：Skill本文2か所だけを変えた候補のtarball）。どちらも`project-assets`の提案から`CLAUDE.md`へ読む契機を採用する（#1814の条件Iと同じ手順） |
| 回数と費用 | 14依頼×各4回×2条件。費用の上限15 USD（Hostの計算値。`claude -p`の`total_cost_usd`の合計） |
| 回答の目印 | 表記の揺れを許す形に見直して固定する（[cases.json](cases.json)の各依頼の`relaxed`）。BもSも同じ規則で新しく測る |
| 採否の目安 | 改善後が現状を上回れば採用の候補とし、採否はownerが決める |

## 測定の条件（#1814から引き継ぐもの）

model（`sonnet`の別名、解決後のidを記録）、tool（`Read`・`Glob`・`Grep`・`Skill`だけ）、認証（`CLAUDE_CODE_OAUTH_TOKEN`を子processの環境変数だけで渡す）、隔離（sample projectをrepositoryと実HOMEの外に置き、試行ごとに空のHOME・設定）、中立のcommit、1つの台帳と順次実行、1試行の予算0.6 USD、固定の記録（`results/fixation.json`）は#1814と同じ。上限と余裕は`conditions.json`の`budget`（上限15 USD、余裕1 USD）で固定し、累計と次の試行の予算の和が14 USDを超えるなら起動しない。

## 数え方

- 「該当する依頼」は`kind`が`asc`または`purpose`の11件（各条件44試行）、「該当しない依頼」は`negative`の3件（各条件12試行）。
- 「手順の適用」は`applied`（期待するSkillの本文・必要なreference・回答の目印のすべて）。主な指標とする。
- 「本文の読込み」は`bodyRead`、「過剰な読込み」は`overapplication`（該当しない依頼で、ASCのSkill tool・入口・本文のいずれか）。定義は#1814と同じ（[cases.json](cases.json)の`scoring`）。

## 規則

1. 採用の候補：次の3つをすべて満たせば、Sを「採用の候補」とする。どれかを満たさなければ「候補ではない」。
   - (a) `applied`(S) ＞ `applied`(B)
   - (b) `bodyRead`(S) ≧ `bodyRead`(B) − 1
   - (c) `overapplication`(S) ≦ `overapplication`(B) ＋ 1
   - (a)(b)は有効な試行の割合で比べる（失敗が無ければ両条件とも分母44で、件数の比較と同じ）。(b)の「−1」はBの分母での1試行分。(c)は件数で比べる。
2. 対象の依頼の報告：改善案が狙った`asc-3`（作業場所の手順）と`es-1`（見積の調査部分）について、条件ごとの試行の記号（`A`適用・`B`本文まで・`E`入口だけ・`M`誤選択・`U`未選択）と適用の件数を別に示す。合否には使わない。
3. 解釈の限界：各依頼4回では、数試行の差は偶然の範囲を出ない。判定は「採用の候補」かどうかの目安であり、採否はownerが決める。
4. 失敗・欠測（#1814の規則5と同じ）：process・APIのエラー、traceの欠落、init eventの無い記録は失敗として別に数え、未選択や合格に変換しない。失敗した試行に限り、同じ条件・依頼で次の番号（5）の試行を1回だけ実行でき、採点では失敗の代わりに数える（その試行も失敗なら失敗のまま）。それ以外の追加の試行は採点に含めず、別に報告する。置き換えた後も1条件の失敗が試行の10%を超えた場合、その条件は「判定不能」とし、ownerに報告する。1試行ごとの予算上限による停止は、停止までの記録で採点し、件数を報告する。
5. 隔離の確認：測定の前に、B・Sそれぞれ1回の隔離の確認（probe）を行い、[harness/probe-check.mjs](harness/probe-check.mjs)のすべての項目が合格し、`compare`で条件の間に差が無い条件だけを測定する（#1814の規則6と同じ）。
6. 費用の上限で途中で止まった場合：測れた試行で規則1を割合として判定し、測れなかった試行の数を条件ごとに報告する（試行はB・Sを依頼・回ごとに交互に実行するので、条件の間の差は最大1試行）。
