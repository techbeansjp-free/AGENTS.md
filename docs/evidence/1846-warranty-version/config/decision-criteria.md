# 判定の規則（#1846。モデル実行の前に固定）

対象：#1846の測定（`estimate-and-scope`に合意の版の書き方の例「WAR-002（合意の版1.0）」を足した候補版で、保守の依頼の回答が根拠のWAR IDと合意の版を示すか）。判定は共通の測定の仕組み（[../../shared-harness/](../../shared-harness/)）の`judge.mjs`で行い、規則は[conditions.json](conditions.json)の`rule`（`mode: levels`）で与える。評価結果を見た後に、この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・共通の仕組みのmoduleを変えない。

## 決まっていること

| 項目 | 内容 |
| --- | --- |
| 条件 | C（候補版）だけ。`feature/1846-warranty-version-cite`の最終のHEADを`scripts/pack-candidate.mjs`で`npm pack`したtarball。base（main `599a2b09`）はGitHub Release v0.5.121の対象commitと同じなので、v0.5.121との違いは`estimate-and-scope`の本文と`release-identity.json`だけの見込み（packの後に確かめる） |
| 導入と環境 | #1840と同じ：`project-assets --register-claude-skill --apply`、読む契機`claude-md`、水準W（Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`、Bashなし）、同じ隔離の設定 |
| 依頼と回数 | #1840のm-r1・m-r2・m-r7（fixture MN）とn-2（fixture EC1）を変えずに使う。各3回、計12試行と、probe 1回（fixture MN） |
| 比べる相手 | この測定では条件を1つにする。比べる相手は、#1840の固定した結果と、#1840の生の記録をこの照合で採点し直した参考の値（[README.md](README.md)）である |
| 費用 | ownerの上限は#1843・#1844・#1846の合計で20 USD（2026-11-28）。この測定への割当ては3 USD（#1843 6 USD、#1844 10 USDとあわせて19 USD。Issue #1846に記録）で、`conditions.json`の`ownerCapUsd`は割当ての3。この測定の上限3 USD、停止の線2.5 USD |

## 数え方（#1840から変えたところ）

数え方は#1840の[decision-criteria.md](../../1840-user-environment/config/decision-criteria.md)の「数え方」と同じである。変えたのは合意の版の目印だけ。

- 合意の版の目印（m-r1の`R1-1-version`、m-r2の`R2-1-version`）：#1840の目印（「版」「合意の版」の近くの`1.0`、または`1.0版`）（「版」の後の`（1.0）`・`(1.0)`の括弧も許す。独立レビューのL2で足した）に加え、「品質保証範囲」・WAR ID・「合意」の後ろ12文字以内にある`v1.0`（`V1.0`、`v 1.0`も）と、後ろ12文字以内に「合意」が続く`v1.0`を数える。`v1.0.0`のように後に`.`か数字が続くものは数えない。単独の「リリース v1.0」は数えないが、近くに「品質保証範囲」・WAR ID・「合意」があれば数える（ownerの決定、2026-11-28）。
- m-r7には同じ目印を報告だけの観点（`R7-1-version`、`report: true`）として加える。数えないので、m-r7の合否の条件は#1840と同じ（WAR-005・未決・判断者の3件）。
- 減点（`answerNone`）は#1840と同じ。調査の前の無償の約束（`free-before-check`・`free-promise`・`free-direction`）、調査の前の有償の確定（`paid-fixed`）、法的な断定。

## 水準（`conditions.json`の`rule.levels`）

| id | 依頼 | 指標 | min | 備考 |
| --- | --- | --- | --- | --- |
| g1-select | m-r1・m-r2・m-r7 | `reach` | 0.8 | #1840と同じ |
| g1-body | m-r1・m-r2・m-r7 | `bodyRead` | 0.8 | #1840と同じ |
| g1-maintenance-reads | m-r1・m-r2・m-r7 | `expectReadsAll` | 0.8 | 案件の品質保証範囲のRead。#1840と同じ |
| g1-maintenance-answer | m-r1・m-r2・m-r7 | `markers` | `"7/9"` | ownerの水準0.78（9件中7件）。分数で書く（下） |
| g1-adjacent-skill | n-2 | `forbidSkillsOk` | 0.67 | 報告だけ（`use: "report"`） |
| g1-negative | n-2 | `negativeOk` | 0.8 | 3件中3件。判定に有効な該当しない試行が要るので入れた（`score.mjs`の`verdictOf`） |

- `"7/9"`は、PR #1848（#1845）の`levelMet`（`ok × 9 >= 7 × n`）で比べる。数の0.78では、7/9 = 0.777…が0.78に届かず、9件中7件で不合格になる。#1848がmergeされる前の共通の仕組みでは、文字列の`min`は常に不合格になる。**このため、この測定は#1848のmergeの後に固定・実行する。**

## 調査の前の無償の約束は0件

水準とは別に、次を合格の条件とする（`judge.json`の`meets-levels`とは別に、`runs.json`から数えて結果に書く）。

- Cの数えるm-r1・m-r2・m-r7の9試行の`markerDeductions`に、`free-before-check`・`free-promise`・`free-direction`が1件も無いこと。
- この減点は`markers`も落とすので、g1-maintenance-answerにも表れる。`paid-fixed`と法的な断定の減点は、件数を別に報告する。

## 規則

1. すべての水準が合格で、調査の前の無償の約束が0件なら「合格」。どれかが欠ければ「不合格」とし、落ちた観点（`markerGroups`の`false`、`markerDeductions`）を試行ごとに示す。
2. 判定しない場合（「判定不能」。#1840と同じ）：測定が完了しておらず費用の線にも達していない、有効な試行が0件の依頼がある、必須の置き換えが欠けている、置き換えた後の失敗が数える試行の10%を超える。
3. 失敗と置き換え：#1840と同じ（process・APIのエラー、traceの欠落、init・result eventの無い記録、水準Wと違うinitは失敗として別に数え、次の番号の試行で1回ずつ置き換える。1試行の予算による停止は失敗ではない）。
4. 隔離の確認：測定の前にCで1回のprobe（fixture MN、水準W）を行い、`probe-check.mjs`のすべての項目が合格した場合だけ測定する。不合格なら1回だけ再実行できる。目印fileの使用は、ownerの承認を`results/probe-approval.json`に記録してから行う。
5. 順序：[run-order.json](run-order.json)（回を外側、各回の中はm-r1・n-2・m-r2・m-r7）。
6. 費用：上限3 USD、停止の線2.5 USD、1試行の予算0.5 USD、probe 0.35 USD。見込み約1.3 USD（計画の単価で約1.7 USD）。

## 限界

- 各依頼3回、条件は1つ。同じ時期のリリース版との比較ではない。#1840のCとの違いには、文面の変更のほかに、時期・モデルの版の違いも含まれうる。
- 目印は文字列で見るもので、別Contextの採点者の判定と同じではない。緩めた目印は「品質保証範囲」等の近くの`v1.0`を合意の版として数える。回答が「品質保証範囲 v1.0」「合意したリリース v1.0」と書いて納品物の版（`v1.0.0`）を指していても区別できない。
- 正当な書き方でも数えないものがある（#1840から引き継ぐ）：「合意の版である1.0」、表の「| 合意の版 | 1.0 |」、「Ver.1.0」、全角の「ｖ１．０」。
- 緩めた目印では、#1840のC（変更前の本文）も9件中9件で合う。目印は#1840で版を落とした4件の書き方に合わせて作ったので、この9/9は標本の中の値である。このため、合格してもSkillの1文の効果とは分けられない。完了の基準（水準0.78と無償の約束0件）の判定には足りる。
- 書き方の例はm-r1（WAR-002）の行そのものなので、m-r1では例の写しで目印に合う場合がある。m-r2（WAR-001）とm-r7（WAR-005）では例と同じ行ではない。
