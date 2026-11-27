# 判定の規則（#1823 段階2。モデル実行の前に固定）

対象：#1823の段階2の測定（候補S2と、現状Bの比較）。規則はownerの判断（2026-11-27）による。判定は共通の測定の仕組み（[../../../shared-harness/](../../../shared-harness/)）の`judge.mjs`だけで行い、規則は[conditions.json](conditions.json)の`rule`で与える（`score.mjs`の`verdictOf`と`toleranceOf`）。`judge.mjs`は段階1と同じ照合（固定の照合、試行ごとの固定の記録と台帳、台帳の予約・`trials.json`・試行のdirectoryが同じ試行の集まりであること、精算済みの試行の記録の改変、公開した記録と台帳が試行の元の記録から作り直したものとbyteで同じこと）をしてから採点する。評価結果を見た後に、この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・共通の仕組みのmoduleを変えない（固定の記録は両方のsha256を持つ）。

## ownerの決定（2026-11-27）

| 項目 | 決定 |
| --- | --- |
| 比べる条件 | B（現状：release v0.5.113）とS（候補S2：merge関係の規則（merge許可・Draft・auto-merge・release起動・許可の記録と取消し）と判断者の規則を`SKILL.md`にそのまま残し、merge以外の重複と言い回しだけを縮めたtarball。[../rule-move-map.md](../rule-move-map.md)）。どちらも`project-assets`の提案から`CLAUDE.md`へ読む契機を採用する |
| 環境 | 段階1と同じ書込みのある環境（水準W：Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`、同じ隔離の設定） |
| 依頼と回数 | 段階1と同じ22依頼（[../../config/cases.json](../../config/cases.json)と同じ依頼文・fixture・目印）。各4回、計22依頼×4回×2条件＝176試行 |
| 費用 | 測定の上限40 USD（段階1とは別） |
| 独立レビュー | 測定の前に1回、Medium以上を直した場合は差分に絞った再レビューを1回まで |

段階1で、規則が同じだったmerge以外の17依頼でも手順の適用が53から51へ変わった（各4回の偶然の幅）。段階2の規則は、この幅を許す許容（`tolerance`、試行の数）を持つ。

## 数え方

- 「該当する依頼」：`expect`のある依頼（fixture Aの`asc`・`purpose`の11件、画面の依頼の3件、場面の5件、計19件。各条件76試行）。「該当しない依頼」：`negative`の3件（各条件12試行）。
- 「本文の読込み」`bodyRead`：期待するSkillの本文`.agent-skill-chain/skills/<skill>/SKILL.md`の読込み（段階1と同じ）。
- 「手順の適用」`applied`：段階1と同じ。場面（merge場面4件と判断者の場面1件）では、規則はB・Sのどちらでも`SKILL.md`そのものにあるので、規則を持つreferenceは無い（`referencesByCondition`はB・Sとも空）。`asc`の本文と回答の目印（`answerGroups`のすべて）で見る。
- 「余計な読込み」`overapplication`：該当しない依頼で、ASCのSkill tool・入口・本文のいずれか（段階1と同じ）。
- 効率：各試行の`ascBytesRead`（読んだASCのfile、すなわち入口・本文・referenceの重複を除いたbyte数）、`inputTokens`（入力＋cache書込み＋cache読出し）、`durationMs`。

## 規則

1. 採用の候補：次のすべてを満たせばSを「採用の候補」、どれかを満たさなければ「候補ではない」とする。許容は試行の数で、率で比べる（S/Sの有効な試行 ≧ (B − 許容)/Bの有効な試行。有効な試行が同じ数なら件数の比較と同じ）。
   - (a) 該当する依頼の全体で、`bodyRead`(S) ≧ `bodyRead`(B) − 2（`tolerance.bodyRead`）。段階1の絶対の下限（0.8）は置かない（`minBodyRate` 0）。
   - (b) 該当する依頼の全体で、`applied`(S) ≧ `applied`(B) − 2（`tolerance.applied`）。
   - (c) `overapplication`(S) ≦ `overapplication`(B) ＋ 1（`tolerance.overapplication`、件数）。
   - (d) 場面の各依頼（`m-grant`・`m-revoked`・`m-draft`・`m-release`・`m-decision`）で、それぞれ`applied`(S) ≧ `applied`(B) − 1（4回のうち。`tolerance.perScenarioApplied`、`perCase`）。
   - (e) すべての依頼（22依頼）の1試行あたりの平均の`ascBytesRead`・`inputTokens`・`durationMs`が、それぞれS ≦ B（`efficiency`。許容なし）。
2. 判定しない場合（「判定不能」。段階1と同じ）：測定が完了しておらず費用の線にも達していない（規則6）、該当する依頼か該当しない依頼の有効な試行が0件の条件がある、有効な試行が1件も無い依頼がある、規則4の置き換えが欠けている、置き換えた後の失敗が条件の数える試行の10%を超える。
3. 別の報告（合否には使わない）：fixture A・画面の依頼・場面・共通の経路（場面以外の17依頼）のそれぞれで(a)(b)(c)の値（同じ許容で計算する）、依頼ごとの記号（`A`適用・`B`本文まで・`E`入口だけ・`M`誤選択・`U`未選択、該当しない依頼は`O`過剰・`-`）、referenceごとの読込みの件数（`referenceReads`）、効率の平均。
4. 失敗と置き換え（段階1と同じ）：process・APIのエラー、traceの欠落、init・result eventの無い記録、水準Wと違うtool・permission mode・MCP serverのinitは失敗として別に数える。計画した試行（回1〜4）の失敗は、同じ条件・依頼で次の番号（5、6、…）の試行で1回ずつ置き換える（必須）。置き換えの失敗はもう置き換えない。1試行の予算による停止と、画面の依頼の`--max-turns`による停止は失敗ではない。台帳に予約があり精算の無い試行は失敗。精算済みの試行の`trace.jsonl`・`meta.json`が無い、または精算のsha256と違えば、採点を拒否する。
5. 隔離の確認：測定の前に、B・Sそれぞれ1回のprobe（fixture A、水準W、6操作、`--debug-file`）を行い、`probe-check.mjs`のすべての項目と`compare`が合格した場合だけ測定する。不合格の条件に限り1回だけ再実行できる（回2）。目印fileの使用は、ownerの承認を`results/probe-approval.json`に記録してから行う（目印の名前は`markerTag` `1823s2`）。
6. 実行の順序と途中の停止：順序は[run-order.json](run-order.json)（段階1と同じ。回を外側、各回の中は固定した22依頼の順、各依頼の中はB、Sの順）。判定してよいのは、`complete`（計画した176試行と必要な置き換えのすべてが台帳に予約されている）か、`cap-reached`（台帳の累計＋1試行の予算0.35 USDが、停止の線39.2 USDを超え、最初の計画した試行より後のprobeが無い）の場合だけ。`cap-reached`では測れた試行で規則1を割合として判定し、測れなかった試行の数を条件ごとに報告する。
7. 費用：上限40 USD（owner）。停止の線は余裕0.8 USDを引いた39.2 USD。見込みは段階1のBの平均から約18.6 USD（176試行とprobe 2回）。`run-trial.mjs`は、台帳の累計＋その試行の予算が線を超えるなら起動しない。
8. 解釈の限界：各依頼4回では、数試行の差は偶然の範囲を出ない。許容はその幅を判定に入れたもので、許容の中の低下を「同じ」と言うものではない。(d)は場面ごとに4試行での比較、(e)のトークンと時間は試行ごとのばらつきが大きい。判定は目安で、採否はownerが決める。
