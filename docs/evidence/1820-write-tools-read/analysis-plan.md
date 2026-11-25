# 分析の計画（モデル実行の前に固定）

対象：#1820の段階1（原因の切り分け）。ownerの判断（2026-11-26、[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1820)「ownerの判断」）による。段階1は原因を調べる測定で、採否の判定はしない。集計は[harness/score.mjs](harness/score.mjs)の`summarizeCell`・`mainEffects`で実装し、合成の記録で試験した（[harness/harness.test.mjs](harness/harness.test.mjs)）。分析は[harness/analyze.mjs](harness/analyze.mjs)だけで行う。結果を見た後に、この計画・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・採点の処理を変えない。

## 条件

- 3つの要因、12条件（セル）。各セル4回、計48試行。
  - tool（T）：R＝読取りだけ（Read・Glob・Grep・Skill）、W＝R＋Write・Edit（`acceptEdits`）、X＝W＋Bash（sandboxの中だけ）。
  - 依頼文（P）：S＝短い形、G＝#1815の形（browserの注意書きを除く）。
  - フォルダ（F）：A＝アプリのrepo、D＝画面の依頼のフォルダ。
- 該当しない依頼：#1814の`neg-1`〜`neg-3`を、セルRSAとWSAで各2回、計12試行。
- どの試行も`--max-turns 2`で、最初の2つのassistant messageだけを見る。

## 指標

- 主な指標：`bodyRead2`＝最初の2つのmessageで、ASCの本文`.agent-skill-chain/skills/asc/SKILL.md`をReadしたか。拒否されたReadは数えない。打切りで結果の無いReadは数え、別に記録する。
- 併せて記録する（分析の主な値には使わない）：最初のmessageでの本文の読込み（`bodyRead1`）、`Skill(asc)`の呼出し（`skillAsc1`）、入口`.claude/skills/asc/SKILL.md`の読込み（`entryRead1`）、目的別一覧`skills/README.md`の読込み（`readmeRead1`）、最初のmessageのtool呼出し（名前と対象）。
- 該当しない依頼：最初の2つのmessageでの、ASCのSkill tool・入口・本文の読込み（`overapplication`）の件数。
- 定義の詳細は[cases.json](cases.json)の`scoring`。

## 分析

1. セルごとに`bodyRead2`の件数／有効な試行を示す。
2. 主効果：要因の各水準の率を、その水準をもつセルの率の単純平均（セルの重みは等しい）とし、水準の差を主効果とする。
   - tool：W−R、X−R、X−W。
   - 依頼文：G−S。
   - フォルダ：D−A。
   - 水準ごとに、セルを合算した件数も併記する。
3. 交互作用は、2要因の組ごとの平均の表（tool×依頼文、tool×フォルダ、依頼文×フォルダ）を示すだけで、検定はしない。
4. 該当しない依頼は、セルRSA・WSAごとの過剰な読込みの件数を示す。
5. 解釈の限界：各セル4回では、1〜2試行の差は偶然の範囲を出ない。どの要因が大きいかの目安として、段階2の設計に使う。

## 分析しない場合

次のどれかに当たれば、セルごとの件数だけを示し、主効果は出さない（`analysis.analysed: false`）。

- 測定が完了しておらず（`complete`）、費用の線にも達していない（`cap-reached`）。結果を見た後の打切りを含む。`cap-reached`は、最初の計画した試行より後にprobeの予約があれば認めない。
- 必須の置き換えが欠けているセルがある。
- 置き換えの後も、セルの失敗が試行の10%を超える。
- 有効な試行の無いセルがある。

## 失敗と置き換え

- 次は失敗として別に数える：process・APIのエラー、traceの欠落、init・result eventの無い記録、セルのtool・permission modeと違うinit（条件を受け取っていない）。`--max-turns`・予算による停止は失敗ではない。
- 計画した試行の失敗は、同じセル・依頼で、失敗の数だけ次の番号で1回ずつ必ず置き換える（`brief`は5、6、…、該当しない依頼は3、4、…）。置き換えの失敗はもう置き換えない。
- 台帳に予約があり精算の無い試行は失敗、精算済みの試行のfileの欠け・改変は記録の改変として扱う（#1817と同じ）。

## 隔離の確認

- 測定の前に、toolの水準ごとに1回（セルRSA・WSA・XSA）のprobeを行う。[harness/probe-check.mjs](harness/probe-check.mjs)のすべての項目が合格し、`compare`が合格した場合だけ測定する。`run-trial.mjs`は、`probe-compare.json`が3つのprobeセルの合格を示さない限り、計画した試行を起動しない。
- probeが失敗・不合格だったセルに限り、1回だけ再実行できる（回2）。それでも合格しなければ、そのtoolの水準は測らずにownerへ報告する（計画の変更として固定し直す）。
- probeは、計画した試行が1件でも予約された後は実行しない。

## 費用

上限は段階1・2の合計で25 USD（owner）。段階1は、台帳の累計＋1試行の予算（0.3 USD）が6 USDを超えるなら起動しない（[conditions.json](conditions.json)の`budget`）。段階2は、この台帳の累計を25 USDの中に数える。
