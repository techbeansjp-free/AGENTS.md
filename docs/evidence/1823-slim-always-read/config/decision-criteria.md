# 判定の規則（#1823。モデル実行の前に固定）

対象：#1823の測定（毎回読む規則を縮めた候補Sと、現状Bの比較）。規則はownerの判断（2026-11-26、[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1823#issuecomment-7186299740)）と、Issueの完了の基準による。判定は共通の測定の仕組み（[../../shared-harness/](../../shared-harness/)）の`judge.mjs`だけで行い、規則は[conditions.json](conditions.json)の`rule`で与える（`score.mjs`の`verdictOf`）。`judge.mjs`は、#1817・#1820と同じ照合（固定の照合、試行ごとの固定の記録と台帳、台帳の予約・`trials.json`・試行のdirectoryが同じ試行の集まりであること、精算済みの試行の記録の改変、公開した記録と台帳が試行の元の記録から作り直したものとbyteで同じこと）をしてから採点する。評価結果を見た後に、この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・共通の仕組みのmoduleを変えない（固定の記録は両方のsha256を持つ）。

## ownerの決定

| 項目 | 決定 |
| --- | --- |
| 比べる条件 | B（現状：release v0.5.112）とS（候補：merge許可の記録・取消しの検索と手続き、Draft・auto-mergeの扱い、release起動の判定、merge・releaseの問い方、判断者の細則を条件付きのreferenceへ移したtarball）。どちらも`project-assets`の提案から`CLAUDE.md`へ読む契機を採用する |
| 環境 | #1820の段階2と同じ書込みのある環境（水準W：Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`、同じ隔離の設定） |
| 依頼と回数 | #1820の段階2の17依頼と、場面の5依頼（merge場面4、判断者の場面1）。各4回、計22依頼×4回×2条件＝176試行。ownerは168試行（22依頼のうち`m-decision`を除く21依頼）の計画を承認した。`m-decision`は独立レビューの指摘で足した8試行（1試行約0.13 USD、計約1 USD）で、同じ上限40 USDの中に収める |
| 費用 | 測定の上限40 USD。独立レビューは合計3回まで（統括が行う） |

## 数え方

- 「該当する依頼」：`expect`のある依頼（fixture Aの`asc`・`purpose`の11件、画面の依頼の3件、場面の5件、計19件。各条件76試行）。「該当しない依頼」：`negative`の3件（各条件12試行）。
- 「本文の読込み」`bodyRead`：期待するSkillの本文`.agent-skill-chain/skills/<skill>/SKILL.md`の読込み（#1817・#1820と同じ）。
- 「手順の適用」`applied`：
  - fixture Aの依頼・画面の依頼：#1820の段階2と同じ。
  - 場面（merge場面4件と判断者の場面1件）：`asc`の本文、その条件で規則を持つreference（Bは本文そのものなので無し、Sは、場面ごとの`merge-permission.md`（Draft・release起動・問い方）か`merge-grant.md`（「常に許可」の記録・取消しの検索と手続き）。判断者の場面`m-decision`は`decision-handling.md`。`referencesByCondition`）、回答の目印（`answerGroups`のすべて）。目印は、現在の`skills/asc/SKILL.md`（main `6e950366`）のL25・L28・L29・L91・L93・L95の規則から決めた。目印は、誤った手順（許可を得ているのでmergeする等）を通さないよう、「mergeしない・許可を求める・既定の段階に戻る」等の止まる・聞く文だけを通す。各正規表現の理由は`cases.json`の`markerNotes`。
- 「余計な読込み」`overapplication`：該当しない依頼で、ASCのSkill tool・入口・本文のいずれか（#1817と同じ）。
- 読込みに基づく記録（判定には使わない）：各試行の`ascReferencesRead`（読んだascのreference）と`markersWithoutReference`（目印は合ったが、その条件で規則を持つreferenceを読んでいない。Sでは`SKILL.md`の入口の文から規則を適用したことを示す）。
- 効率：各試行の`ascBytesRead`（読んだASCのfile、すなわち入口・本文・referenceの重複を除いたbyte数。試行の`work/`の写しから数える）、`inputTokens`（入力＋cache書込み＋cache読出し）、`durationMs`。

## 規則

1. 採用の候補：次のすべてを満たせばSを「採用の候補」、どれかを満たさなければ「候補ではない」とする。
   - (a) 該当する依頼の全体で、`bodyRead`(S)の率 ≧ 0.8、かつ`bodyRead`(S)の率 ≧ `bodyRead`(B)の率（縮める前より少なくならない）。
   - (b) 該当する依頼の全体で、`applied`(S)の率 ≧ `applied`(B)の率。
   - (c) `overapplication`(S) ≦ `overapplication`(B) ＋ 1（件数）。
   - (d) 場面の各依頼（`m-grant`・`m-revoked`・`m-draft`・`m-release`・`m-decision`）で、それぞれ`applied`(S)の率 ≧ `applied`(B)の率（`perCase`）。
   - (e) 共通の経路（場面以外の17依頼）で、1試行あたりの平均の`ascBytesRead`・`inputTokens`・`durationMs`が、それぞれS ≦ B（`efficiency`）。
   - 率は有効な試行の割合で比べる。
2. 判定しない場合（「判定不能」。#1817と同じ）：測定が完了しておらず費用の線にも達していない（規則6）、該当する依頼か該当しない依頼の有効な試行が0件の条件がある、有効な試行が1件も無い依頼がある、規則4の置き換えが欠けている、置き換えた後の失敗が条件の数える試行の10%を超える。
3. 別の報告（合否には使わない）：fixture A・画面の依頼・場面・共通の経路のそれぞれで(a)(b)(c)の値、依頼ごとの記号（`A`適用・`B`本文まで・`E`入口だけ・`M`誤選択・`U`未選択、該当しない依頼は`O`過剰・`-`）、referenceごとの読込みの件数（`referenceReads`）、効率の平均。
4. 失敗と置き換え（#1817と同じ）：process・APIのエラー、traceの欠落、init・result eventの無い記録、水準Wと違うtool・permission mode・MCP serverのinitは失敗として別に数える。計画した試行（回1〜4）の失敗は、同じ条件・依頼で次の番号（5、6、…）の試行で1回ずつ置き換える（必須）。置き換えの失敗はもう置き換えない。1試行の予算による停止と、画面の依頼の`--max-turns`による停止は失敗ではない。台帳に予約があり精算の無い試行は失敗。精算済みの試行の`trace.jsonl`・`meta.json`が無い、または精算のsha256と違えば、採点を拒否する。
5. 隔離の確認：測定の前に、B・Sそれぞれ1回のprobe（fixture A、水準W、6操作、`--debug-file`）を行い、`probe-check.mjs`のすべての項目と`compare`（Skill一覧の予算の状態と、ASCの16件のdescriptionがContextにあることを含む）が合格した場合だけ測定する。`run-trial.mjs`は記録された`pass`を信用せず、probeの記録から計算し直す。不合格の条件に限り1回だけ再実行できる（回2）。目印fileの使用は、ownerの承認を`results/probe-approval.json`に記録してから行う。
6. 実行の順序と途中の停止：順序は[run-order.json](run-order.json)（回を外側、各回の中は固定した22依頼の順、各依頼の中はB、Sの順）。判定してよいのは、`complete`（計画した176試行と必要な置き換えのすべてが台帳に予約されている）か、`cap-reached`（台帳の累計＋1試行の予算0.35 USDが、停止の線39.2 USDを超え、最初の計画した試行より後のprobeが無い）の場合だけ。`cap-reached`では測れた試行で規則1を割合として判定し、測れなかった試行の数を条件ごとに報告する。
7. 費用：上限40 USD（owner）。停止の線は余裕0.8 USDを引いた39.2 USD（40 − 0.8）。見込みの費用は約19.7 USD（176試行とprobe 2回）で、線までに使える1試行の平均（損益分岐、`dry-run.mjs`の`breakEvenPerTrialUsd`）は約0.221 USD。`run-trial.mjs`は、台帳の累計＋その試行の予算が線を超えるなら起動しない。`release.json`のSが仮の値（placeholder）の間は、すべての有料の試行を拒否する。
8. 解釈の限界：各依頼4回では、数試行の差は偶然の範囲を出ない。(d)は場面ごとに4試行での比較、(e)のトークンと時間は試行ごとのばらつきが大きい。判定は目安で、採否はownerが決める。
