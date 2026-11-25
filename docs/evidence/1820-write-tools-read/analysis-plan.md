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

- 主な指標：`bodyRead2`＝最初の2つのmessageで、ASCの本文`.agent-skill-chain/skills/asc/SKILL.md`を読んだか。読込みは、Readと、水準XのBash（引数に本文のpathがあるcommand。`cat`・`head`・`sed -n`等）の両方を数える。拒否されたRead・失敗したBash（`is_error`、0以外の終了）は数えない。打切りで結果の無い呼出しは数え、別に記録する。
  - Bashの引数の判定：commandを空白とshellの区切り（`; | & ( ) < >`）で分け、引用符を外し、`-`で始まる語を除く。残った語をsessionの作業directoryを基準にpathとして解き、本文のpathに一致すれば本文の読込みとする。`cd`で移動してから相対pathで読む形は数えない（限界）。
- Bashによる本文の読込みは、`bodyRead2`に含めたうえで、別の項目（`bodyReadBash2`、最初のmessageは`bodyReadBash1`）としてもセルごとに示す。
- 併せて記録する（分析の主な値には使わない）：最初のmessageでの本文の読込み（`bodyRead1`）、`Skill(asc)`の呼出し（`skillAsc1`）、入口`.claude/skills/asc/SKILL.md`の読込み（`entryRead1`）、目的別一覧`skills/README.md`の読込み（`readmeRead1`）、最初のmessageのtool呼出し（名前と対象。Bashはcommandの各pathを作業directoryからの相対pathにしたもの、外は`<outside>`、200文字まで）。入口・目的別一覧も、Bashの引数での読込みを数える。
- 該当しない依頼：最初の2つのmessageでの、ASCのSkill tool・入口・本文の読込み（Bashを含む）（`overapplication`）の件数。
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

次のどれかに当たれば、セルごとの件数だけを示し、主効果は出さない（`analysis.analysed: false`）。[harness/analyze.mjs](harness/analyze.mjs)の`cellRuleReasons`・`analyzeRun`で実装した。

- 測定が完了しておらず（`complete`）、費用の線にも達していない（`cap-reached`）。結果を見た後の打切りを含む。`cap-reached`は、最初の計画した試行より後にprobeの予約があれば認めない。
- 必須の置き換えが欠けているセルがある。
- 置き換えの後も、セルの数える`brief`の試行（4件）のうち、失敗が2件以上ある。
  - 各セル4回なので、置き換えの失敗が1件あると、そのセルの失敗は1/4＝25%になる。これは許し、そのセルの率は有効な3件で求める。2件以上（50%以上）なら分析しない。
  - 該当しない依頼の試行（RSA・WSAの`neg-1`〜`neg-3`）は、この規則に数えない。その失敗はセルごとに別に示し（`negatives.failures`）、過剰な読込みは有効な試行だけで数える。主効果には使わない。
- 有効な試行の無いセルがある。

## 失敗と置き換え

- 次は失敗として別に数える：process・APIのエラー、traceの欠落、init・result eventの無い記録、セルのtool・permission modeと違うinit（条件を受け取っていない）。`--max-turns`・予算による停止は失敗ではない。
- 計画した試行の失敗は、同じセル・依頼で、失敗の数だけ次の番号で1回ずつ必ず置き換える（`brief`は5、6、…、該当しない依頼は3、4、…）。置き換えの失敗はもう置き換えない。
- 台帳に予約があり精算の無い試行は失敗、精算済みの試行のfileの欠け・改変は記録の改変として扱う（#1817と同じ）。

## 隔離の確認

- 測定の前に、toolの水準ごとに1回（セルRSA・WSA・XSA）のprobeを行う。[harness/probe-check.mjs](harness/probe-check.mjs)のすべての項目が合格し、`compare`が合格した場合だけ測定する。
- probeの操作は水準ごとに固定した（[harness/run-trial.mjs](harness/run-trial.mjs)の`probeSteps`。R 4、W 6、X 19。[conditions.json](conditions.json)の`probeSteps`）。probeは`probeMaxTurns`（30）と`budget.probeUsd`（0.6 USD）で起動する。
  - どの水準も：目印fileのRead 2件、repositoryの`.agent-skill-chain/local/`へのGlob、実HOMEの目印へのGrep。すべて拒否されること。
  - W・X：試行のdirectory（`work/`の外）とrepositoryへのWrite。拒否され、fileが残らないこと。
  - X（Bash）：`work/`への書込みと`cat CLAUDE.md`が成功し、出力の最初の行が`work/CLAUDE.md`の最初の行と一致すること（sandboxが`work/`の読込みを戻している証拠）。目印の`cat`、runs root・試行の`settings.json`・fixture・fixtureの`CLAUDE.md`・台帳のdirectoryの`ls`/`cat`、試行のdirectoryとrepositoryへの`touch`、`curl`が拒否されること。`work/`での`git status`は記録するが判定しない（sandboxの中でgitが動かなくても、Xは測る。判断は最初のmessageで起き、そこまでに見えるのはtoolの定義だけである）。
- どの操作も、呼出しのすべてにtool_resultが必要である（結果の無い呼出しは不合格）。拒否は積極的な証拠で判定する：`is_error`、0以外の終了、`Operation not permitted`等の拒否の文言。`curl`は0以外の終了か`000`。結果が無い・成功した場合は不合格。
- `compare`の出力（`probe-compare.json`）は、各probeの試行名とtrace・metaのsha256を持つ。`run-trial.mjs`は、それが各probeセルの最新のprobeで、台帳の精算のsha256とruns rootのfileに一致し、残る水準のprobeが合格した場合だけ、計画した試行を起動する。
- probeが失敗・不合格だったセルに限り、1回だけ再実行できる（回2）。
- 回2も不合格の場合（事前に決めた手順）：
  - 水準Xだけは、測らずに8セルへ縮める。手順は、`probe-check.mjs compare <R> <W> <X回2> --drop X --out <runs-root>/probe-compare.json`（R・Wが合格し、Xが不合格であること）、`fixation.mjs drop-level results/fixation.json X --ledger … --runs-root … --reason … --review …`、その記録のcommitである。`drop-level`は、計画した試行が台帳に1件も無く、`XSA-probe-2`が精算済みで、固定したfileが変わっておらず、比較が台帳に結ばれている場合だけ記録を加える。
  - 8セル（R・W×S・G×A・D）、`brief` 32試行と該当しない依頼12試行、計44試行。順序は[run-order.json](run-order.json)からXの項目を除いたもの。主効果はW−R・G−S・D−Aだけ（X−R・X−Wは出さない）。交互作用の表もR・Wだけ。その他の規則は12セルと同じ。ownerへは結果と併せて報告する。
  - 水準RかWのprobeが回2も不合格なら、測定しない（計画を変えず、ownerへ報告する）。
- probeと水準の削除は、計画した試行が1件でも予約された後は行わない（`run-trial.mjs`は、計画した試行の予約より後の修正・削除の記録を拒否する）。

## 費用

上限は段階1・2の合計で25 USD（owner）。段階1は、台帳の累計＋その試行の予算（試行0.3 USD、probe 0.6 USD）が6 USDを超えるなら起動しない（[conditions.json](conditions.json)の`budget`）。段階2は、この台帳の累計を25 USDの中に数える。
