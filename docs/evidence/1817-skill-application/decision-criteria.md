# 判定の規則（モデル実行の前に固定）

対象：#1817。規則はownerの判断（2026-11-25、[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1817#issuecomment-7159921981)、および同日の会話での(b)(c)の承認）による。判定の手順は[harness/score.mjs](harness/score.mjs)の`judge1817`で実装し、合成の記録で試験した（[harness/score.test.mjs](harness/score.test.mjs)）。判定は[harness/judge.mjs](harness/judge.mjs)だけで行う。judge.mjsは、固定の照合、試行ごとの固定の記録と台帳の照合、台帳の予約・`trials.json`・traceが同じ試行の集まりであること（予約の番号の欠けが無いことを含む）、台帳による完了の確認をしてから採点する。評価結果を見た後に、この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・採点の処理を変えない。

## ownerの決定

| 項目 | 決定 |
| --- | --- |
| 比べる条件 | B（現状：v0.5.109のrelease）とS（改善案：Skill本文2か所だけを変えた候補のtarball）。どちらも`project-assets`の提案から`CLAUDE.md`へ読む契機を採用する（#1814の条件Iと同じ手順） |
| 回数と費用 | 14依頼×各4回×2条件。費用の上限15 USD（Hostの計算値。`claude -p`の`total_cost_usd`の合計） |
| 回答の目印 | 表記の揺れを許す形に見直して固定する（[cases.json](cases.json)の各依頼の`relaxed`）。BもSも同じ規則で新しく測る |
| 採否の目安 | 改善後が現状を上回れば採用の候補とし、採否はownerが決める |
| 規則1の(b)(c) | 作業者の案を承認（2026-11-25、会話。統括が記録） |
| 隔離の確認（実HOMEとrepositoryに目印fileを一時的に作るprobe） | #1817での実行を承認（2026-11-25、会話。統括が記録） |

## 測定の条件（#1814から引き継ぐもの）

model（`sonnet`の別名、解決後のidを記録）、tool（`Read`・`Glob`・`Grep`・`Skill`だけ）、認証（`CLAUDE_CODE_OAUTH_TOKEN`を子processの環境変数だけで渡す）、隔離（sample projectをrepositoryと実HOMEの外に置き、試行ごとに空のHOME・設定）、中立のcommit、1つの台帳と順次実行、1試行の予算0.6 USD、固定の記録（`results/fixation.json`）は#1814と同じ。上限と余裕は`conditions.json`の`budget`（上限15 USD、余裕1 USD）で固定し、累計と次の試行の予算の和が14 USDを超えるなら起動しない。

## 数え方

- 「該当する依頼」は`kind`が`asc`または`purpose`の11件（各条件44試行）、「該当しない依頼」は`negative`の3件（各条件12試行）。
- 「手順の適用」は`applied`（期待するSkillの本文・必要なreference・回答の目印のすべて）。主な指標とする。
- 「本文の読込み」は`bodyRead`、「過剰な読込み」は`overapplication`（該当しない依頼で、ASCのSkill tool・入口・本文のいずれか）。定義は#1814と同じ（[cases.json](cases.json)の`scoring`）。

## 規則

1. 採用の候補：次の3つをすべて満たせば、Sを「採用の候補」とする。どれかを満たさなければ「候補ではない」。
   - (a) `applied`(S) ＞ `applied`(B)
   - (b) `bodyRead`(S) ≧ `bodyRead`(B) − 1 （2026-11-25 ownerが承認）
   - (c) `overapplication`(S) ≦ `overapplication`(B) ＋ 1 （2026-11-25 ownerが承認）
   - (a)(b)は有効な試行の割合で比べる（失敗が無ければ両条件とも分母44で、件数の比較と同じ）。(b)の「−1」はBの分母での1試行分。(c)は件数で比べる。
   - (b)(c)は、作業者が#1814の水準（該当しない依頼での過剰な読込みは現状＋1試行まで）とIssueの「してはいけないこと」から導いた案で、2026-11-25にownerが会話で承認した（統括が記録）。
   - 判定しない場合（「判定不能」）：次のどれかに当たれば判定しない。
     - 測定が完了しておらず、費用の上限にも達していない（規則7）。
     - 該当しない依頼の有効な試行が0件の条件がある（(c)が中身なしで成り立つのを防ぐ）。
     - 計画した依頼のうち、有効な試行が1件も無い依頼がある。
     - 規則4の置き換えが欠けている。
     - 置き換えた後の失敗が10%を超える。
2. 対象の依頼の報告：改善案が狙った`asc-3`（作業場所の手順）と`es-1`（見積の調査部分）について、条件ごとの試行の記号（`A`適用・`B`本文まで・`E`入口だけ・`M`誤選択・`U`未選択）と適用の件数を別に示す。合否には使わない。
3. 解釈の限界：各依頼4回では、数試行の差は偶然の範囲を出ない。判定は「採用の候補」かどうかの目安であり、採否はownerが決める。
4. 失敗・欠測：process・APIのエラー、traceの欠落、init eventの無い記録は失敗として別に数え、未選択や合格に変換しない。
   - **置き換えは必須**：計画した試行（回1〜4）のうち失敗したものは、同じ条件・依頼で、失敗した数だけ次の番号（5、6、…）の試行で1回ずつ置き換える。回の小さい失敗から順に5、6、…を当てる。
   - 置き換えの試行も失敗なら失敗のまま数え、もう置き換えない。
   - この番号以外の追加の試行は採点に含めず、別に報告する。
   - 置き換えが欠けている条件は判定しない。置き換えた後も1条件の失敗が試行の10%を超えた場合、その条件は「判定不能」とし、ownerに報告する。
   - 1試行ごとの予算上限による停止は失敗ではない。停止までの記録で採点し、件数を報告する。
   - 実装：[harness/order.mjs](harness/order.mjs)の`replacementPlan`（実行）と[harness/score.mjs](harness/score.mjs)の`selectCounted`（採点）。
5. 隔離の確認：測定の前に、B・Sそれぞれ1回の隔離の確認（probe）を行い、[harness/probe-check.mjs](harness/probe-check.mjs)のすべての項目が合格し、`compare`で条件の間に差が無い条件だけを測定する（#1814の規則6と同じ）。
   - probeが失敗した、または不合格だった条件に限り、同じ条件で1回だけ再実行できる（回2）。それでも合格しなければ、その条件は測定せずにownerへ報告する。
   - probeは、計画した試行が1件でも台帳に予約された後は実行しない。`run-trial.mjs`は、そのprobe、回3以上のprobe、回1の無い回2を拒否する（[harness/order.mjs](harness/order.mjs)の`probeRefusal`）。
   - 規則7の`cap-reached`は、最初の計画した試行より後に予約されたprobeが台帳にあれば認めない。probeの費用で上限に届かせることを防ぐため。
6. 実行の順序は[run-order.json](run-order.json)で、モデル実行の前に固定する。
   - 回を外側にする（回1の14依頼、回2の14依頼、…）。
   - 各回の中は固定した依頼の順にする。該当しない依頼は間に挟み、最後にまとめない。
   - 各依頼の中はB、Sの順にする。
   - [harness/run-all.mjs](harness/run-all.mjs)はこの順だけを実行する。`run-trial.mjs`は、次に予約されるべき試行以外を拒否する。置き換えは、計画した試行がすべて予約された後に、置き換えの計画（`replacementPlan`）の次の試行だけを受け付ける。
   - 置き換えは、計画した112試行の後に、同じ依頼・条件の順で行う。
7. 途中で止まった場合：判定してよいのは、次のどちらかに当たる場合だけである。どちらに当たったかを判定の出力（`basis`、`completion`）に記録する。
   - `complete`：計画した112試行と、規則4で必要な置き換えのすべてが、台帳に予約されている。
   - `cap-reached`：止まった時点で、台帳の累計＋1試行の予算（0.6 USD）が、上限−余裕（14 USD）を超えている。つまり`run-trial.mjs`が次の試行を拒否する状態である。ただし、最初の計画した試行より後に予約されたprobeがあれば認めない（規則5）。
   - どちらでもない停止（結果を見た後の打切りを含む）は判定しない。ownerへ報告する。
   - `cap-reached`の場合は、測れた試行で規則1を割合として判定し、測れなかった試行の数を条件ごとに報告する。実行の順序により、条件の間の差は最大1試行で、どの依頼も前の回までは両条件で測れている。
   - 規則1の他の「判定しない場合」に当たれば、`cap-reached`でも判定しない。
   - 実装：[harness/order.mjs](harness/order.mjs)の`completionStatus`と[harness/judge.mjs](harness/judge.mjs)。
