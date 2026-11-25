# 書込みのtoolとASCの読込み：段階1（#1820）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

**結果：未測定**（この文書は測定の前の準備の記録である）。

## 目的

#1814・#1817（読取りのtoolだけ）では、`docs/BRIEF.md`の依頼でASCの本文が読まれた（#1817のasc-3で7/8）。#1815（書込みとbrowserのtool、別の依頼文・フォルダ）では2/18だった。[Issueの原因の調査](https://github.com/techbeansjp-free/AGENTS.md/issues/1820)で、本文を読むかどうかは最初のassistant messageで決まると分かった。段階1では、最初の2ターンだけを見る安い試行で、tool・依頼文・フォルダのどれが読込みを左右するかを切り分ける。採否の判定はしない。

## ownerの判断（2026-11-26、[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1820)「ownerの判断」）

- 2段階で測る。費用の上限は2段階の合計で25 USD。
- 段階1：最初の2ターンだけの試行で3つの要因を切り分ける。12条件×各4回、約3 USD。
- 段階2：書込みのある環境で、現状と改善版（`CLAUDE.md`の案内文と`asc`の説明を直したもの）を比べる。段階2は別に固定する。
- 採用の基準は段階2に適用する（段階1には無い）。

## 要因と条件

| 要因 | 水準 |
| --- | --- |
| tool（T） | R：Read・Glob・Grep・Skill（#1817と同じ）／W：R＋Write・Edit、`--permission-mode acceptEdits`（#1815と同じtool。browser MCPは無い）／X：W＋Bash（下の隔離） |
| 依頼文（P） | S：`docs/BRIEF.md の依頼に対応して。`（#1817のasc-3）／G：#1815の形（[gen-prompt.txt](../1807-design-eval-browser/env/gen-prompt.txt)の最初の段落）。段階1にはbrowserのtoolが無いので、その注意書きの段落は除いた |
| フォルダ（F） | A：#1814・#1817のアプリのrepo（`CLAUDE.md`はプロジェクトの説明＋案内文）／D：#1815と同じ形の画面の依頼のフォルダ（ui03の`BRIEF.md`・`data.json`、#1815と同じ`FONTS.md`、空の`out/`。`CLAUDE.md`は案内文だけ） |

- 依頼文はフォルダのBRIEFの位置だけを合わせた（Sは、Dでは`BRIEF.md`。Gは、Aでは`docs/BRIEF.md`）。文面は[cases.json](cases.json)。
- 12セル（`RSA`〜`XGD`、[conditions.json](conditions.json)）×各4回＝48試行。該当しない依頼（#1814の`neg-1`〜`neg-3`）をセルRSA・WSAで各2回＝12試行。計60試行と、toolの水準ごとの隔離の確認3回。
- 水準Xの隔離の確認が2回とも不合格なら、事前に決めた手順でXを外し、8セル・44試行にする（[analysis-plan.md](analysis-plan.md)「隔離の確認」、`conditions.json`の`dropNote`）。
- どのセルも、release v0.5.111（[release.json](release.json)。#1817の本文の修正を含む最新のrelease。sha256はSHA256SUMSとreleaseのassetのdigestの両方と一致）を利用者の手順で導入し、読む契機`claude-md`を採用する（#1814の条件I）。
- どの試行も`--max-turns 2`。セルの違いは、toolの水準の起動の引数・依頼文・フォルダだけである。実行の順序は[run-order.json](run-order.json)で固定した（回を外側、各回の中で同じ依頼文・フォルダの3つのtoolの水準を隣に並べ、該当しない依頼を間に挟む）。

## Bashの隔離（水準X）

Claude Codeのsandboxで隔離し、測定に使えるかをprobeで確かめてから測る。すべての水準に同じ`--settings`を渡す（Bashがあるのは水準Xだけなので、sandboxが働くのはXだけである）。

- `permissions.blockReadsOutsideWorkingDirectories`：file toolの作業directoryの外の読込みを止める。
- `sandbox`：`enabled`、`failIfUnavailable`（sandboxが使えなければ起動しない）、`allowUnsandboxedCommands: false`（sandboxの外での実行を許さない）、`autoAllowBashIfSandboxed`（sandboxの中のcommandは確認なしで実行する）、`network.allowedDomains: []`（通信先なし）。
- 読取りの禁止：`/Users`（実HOMEとこのrepositoryを含む）、runs root、fixture、台帳のdirectory。試行の`work/`だけを読めるように戻す。書込みの禁止：fixtureと台帳のdirectory。
- probeの操作は水準ごとに固定した（`run-trial.mjs`の`probeSteps`。R 4、W 6、X 19）。1つずつ別のtoolの呼出しで行い、すべての呼出しにtool_resultが要る。拒否は積極的な証拠（`is_error`、0以外の終了、`Operation not permitted`等。`curl`は0以外の終了か`000`）で判定し、結果が無ければ不合格とする。
  - どの水準も：目印fileのRead（実HOMEとrepository）、repositoryの`.agent-skill-chain/local/`へのGlob、実HOMEの目印へのGrepが拒否される。
  - W・X：試行のdirectory（`work/`の外）とrepositoryへのWriteが拒否され、fileが残らない。
  - X：`work/`の中への書込みが成功する（sandboxの設定が効いている証拠）。`work/`での`cat CLAUDE.md`が成功し、最初の行が`work/CLAUDE.md`と一致する（runs rootの読込みを禁じたうえで`work/`を戻す`allowRead`が効いている証拠）。目印fileの`cat`、runs rootの`ls`、試行の`settings.json`の`cat`、fixtureの`ls`と`CLAUDE.md`の`cat`、台帳のdirectoryの`ls`、試行のdirectoryとrepositoryへの`touch`、`curl`が拒否される。`work/`での`git status`は記録する（判定しない）。
  - 目印のtokenがどの記録にも無い。sentinelのfileが残らない。

残る危険：

- 設定fileが検証で落ちると、`-p`では黙って無視される。そのためprobeで、`work/`への書込みと`CLAUDE.md`の読込みが成功し、runs root・fixture・台帳のdirectoryの読込みが拒否されることを確かめる。
- probeはfixture Aだけで行う。fixture Dの試行は、同じ設定の作り方（`isolationSettings`）でDのfixtureを読込み・書込みの禁止に入れる（dry runの`fixtureDDenied`と`settingsExampleD`で確認）。Dでの隔離そのものは試していない。Dのfixtureの中身は依頼のfile（`BRIEF.md`等）だけで、ASCの記録や台帳は無い。
- GlobとGrepの外への呼出しは、目印の場所（実HOMEの目印file、repositoryの`.agent-skill-chain/local/`）で試す。他の外のpathでのGlob・Grepは試していない（どちらもfile toolで、Readと同じ作業directoryの外の読込みの禁止を受ける）。
- 水準Wのrepositoryへの書込みは、repositoryの`.agent-skill-chain/local/`（git管理外）へのWriteで試す。repositoryの他の場所への書込みは試していない（Writeの拒否は作業directoryの外かどうかで決まり、場所によらない）。
- gitがsandboxの中で動かない場合（`git status`の記録で分かる）、水準Xは利用者の環境とさらに違う。それでもXは測る。本文を読むかの判断は最初のmessageで起き、そこまでにcommandは実行されていない（[Issueの原因の調査](https://github.com/techbeansjp-free/AGENTS.md/issues/1820)）。gitの結果は報告に記す。
- sandboxはmacOSのSeatbeltを使う。sandboxの中のshellから起動すると入れ子になり使えないので、harnessはsandboxの外のshellで実行する（`failIfUnavailable`により、使えなければ起動しない）。
- 上の禁止以外のpath（`/private/tmp`の他のfile、`/etc`等）は読める。書込みは、Claude Codeのsandboxの既定で許される場所（作業directoryと一時directory等）に限られる。他の試行のdirectoryへの書込みはprobeで確かめる。精算済みの試行の記録はsha256で台帳に結んであり、改変は検出される。
- 実HOMEにあるcommand（nodenvの`node`等）はsandboxの中では動かない。利用者の環境とはBashで実行できるものが違う。ただし判断が起きる最初のmessageまでに見えるのはtoolの定義だけである。
- sandboxを有効にすると、Bashのtoolの説明文にsandboxの注意が加わる。これも水準Xの条件に含まれる。

probeでXが2回とも合格しない場合は、事前に決めた手順（[analysis-plan.md](analysis-plan.md)「隔離の確認」）でXを外し、8セル・44試行を測って、ownerへ報告する。`fixation.mjs drop-level`がその記録を加え、`run-trial.mjs`・`order.mjs`・`analyze.mjs`はXのセルを除いた計画で動く。RかWが2回とも合格しない場合は測定しない。

## 指標と分析

[analysis-plan.md](analysis-plan.md)で固定した。

- 主な指標：最初の2つのmessageでのASC本文の読込み（`bodyRead2`）を、セルごとに件数／有効な試行で示す。読込みはReadと、水準XのBash（中身を読むcommand、`cat`・`head`・`tail`・`sed`・`awk`・`less`・`more`・`grep`・`rg`・`nl`・`bat`・`view`・`strings`の引数に本文のpathがあるもの）の両方を数え、Bashの分は`bodyReadBash2`として別にも示す。`ls`・`test`・`stat`・`wc`等の存在の確認は数えない。入口・目的別一覧・過剰な読込みも同じ規則で数える。
- 併せて記録する：最初のmessageでの本文の読込み・`Skill(asc)`・入口・`skills/README.md`の読込みと、最初のtool呼出し。
- 主効果：水準ごとにセルの率を単純平均し、その差（W−R、X−R、X−W、G−S、D−A）を示す。交互作用は2要因の平均の表だけ。
- 該当しない依頼（RSA・WSA）での過剰な読込みの件数。
- 段階1は診断であり、採否の判定はしない。各セル4回では1〜2試行の差は偶然の範囲を出ない。
- 置き換えの後もセルに失敗が2件以上あれば主効果を出さない。1件（4件中、25%）は許し、そのセルは有効な3件で率を出す。該当しない依頼の失敗はこの規則に数えない。

## 費用

- 上限：段階1・2の合計で25 USD。段階1は、台帳の累計＋その試行の予算が6 USDを超えるなら起動しない。
- 1試行の予算（`--max-budget-usd`と台帳の予約）：0.3 USD。#1817の実績は、全ターンの試行で平均0.085 USD、最大0.141 USD（112試行）。2ターンの試行はこれより安く、その約2倍とした。
- probeの予算：0.6 USD。#1817のprobe（8操作）は0.066・0.084 USDだった。水準Xのprobeは19操作・最大30ターンなので、試行の予算の2倍とした。
- 見込み：#1817のtraceのtoken量で、最初の2つのmessageは平均0.048 USD、asc-3では最大0.089 USDだった。計画の単価を1試行0.08 USD、probe 0.2 USDとして、60試行＋probe 3回で約5.4 USD。平均どおりなら約3.5 USD。1試行の平均が約0.086 USDを超えると、6 USDの線で最後の数試行が起動しない（`cap-reached`として分析する）。

## 実行の手順

統括が行う。`<scratch>`は一時directory、`<repo-root>`はこのrepositoryのcheckoutを指す。harnessはsandboxの外のshellで実行する。統括は台帳を手で編集しない（#1817と同じ）。

隔離の確認は、実HOMEとこのrepositoryに目印fileを一時的に作る。#1820での承認は統括が[results/probe-approval.json](results/probe-approval.json)に記録してcommitする。それまでは`markers.mjs create`とprobeの起動が拒否される。

```text
EV=docs/evidence/1820-write-tools-read
LEDGER=<scratch>/rel1820/ledger/ledger-1820.jsonl
TGZ=<scratch>/rel1820/release/agent-skill-chain-0.5.111.tgz
SHA=e7df164a8c132d4d77db270cd8c3fe7ed196906484b0f51d52b4de57125d3be0
mkdir -p <scratch>/run1820m/tmp
# 1. fixture（固定したsha256だけを受け付ける）
node $EV/harness/make-fixture.mjs A $TGZ $SHA <scratch>/run1820m/fixture-A <scratch>/run1820m/tmp
node $EV/harness/make-fixture.mjs D $TGZ $SHA <scratch>/run1820m/fixture-D <scratch>/run1820m/tmp
# 2. 隔離の確認（R・W・X各1回、fixture A）。目印fileは確認の後に消す
node $EV/harness/markers.mjs create <repo-root>
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1820_ALLOW_PAID=1 node $EV/harness/run-trial.mjs <scratch>/run1820m/runs RSA probe 1 --fixture <scratch>/run1820m/fixture-A --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run
node $EV/harness/probe-check.mjs <scratch>/run1820m/runs/RSA-probe-1 RSA <home marker> <repo marker> <repo-root> > <scratch>/run1820m/probe-RSA.json
#   （WSA・XSAも同じ。不合格のセルだけ回2を1回実行できる：... RSA probe 2 ...）
node $EV/harness/probe-check.mjs compare <scratch>/run1820m/probe-RSA.json <scratch>/run1820m/probe-WSA.json <scratch>/run1820m/probe-XSA.json --out <scratch>/run1820m/runs/probe-compare.json
#   XSAが回2も不合格で、RSA・WSAが合格した場合だけ（事前に決めた手順）：
#   node $EV/harness/probe-check.mjs compare <RSAの結果> <WSAの結果> <XSA回2の結果> --drop X --out <scratch>/run1820m/runs/probe-compare.json
#   node $EV/harness/fixation.mjs drop-level $EV/results/fixation.json X --ledger $LEDGER --runs-root <scratch>/run1820m/runs --reason "<理由>" --review "<記録>"
#   （results/fixation.jsonをcommitする）
#   各probeの結果（回2を含む）と比較を、目印・local path・HOMEを伏せて写す（目印fileを消す前に。tokenが残れば拒否する）
node $EV/harness/probe-check.mjs publish $EV/results/probes <scratch>/run1820m/probe-*.json <scratch>/run1820m/runs/probe-compare.json --home-marker <home marker> --repo-marker <repo marker> --repo-root <repo-root> --runs-root <scratch>/run1820m/runs
node $EV/harness/markers.mjs remove <repo-root>
# 3. 測定：固定した順の60試行（止まった場合は同じcommandで次の試行から続く）、その後に必須の置き換え
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1820_ALLOW_PAID=1 node $EV/harness/run-all.mjs planned <scratch>/run1820m/runs --fixture-A <scratch>/run1820m/fixture-A --fixture-D <scratch>/run1820m/fixture-D --ledger $LEDGER --run
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1820_ALLOW_PAID=1 node $EV/harness/run-all.mjs replacements <scratch>/run1820m/runs --fixture-A <scratch>/run1820m/fixture-A --fixture-D <scratch>/run1820m/fixture-D --ledger $LEDGER --run
# 4. 固定の照合、取り出し、分析
node $EV/harness/fixation.mjs check $EV/results/fixation.json
node $EV/harness/collect.mjs <scratch>/run1820m/runs $EV/results/traces --ledger $LEDGER --publish-ledger $EV/results/ledger.jsonl
node $EV/harness/analyze.mjs $EV/results/traces --runs-root <scratch>/run1820m/runs --ledger $LEDGER --runs-json $EV/results/runs.json --out $EV/results/analysis.json
#   results/probes/（手順2で写したprobe-*.jsonとprobe-compare.json）を、結果と一緒にcommitする
```

計画した試行の前に、`run-trial.mjs`は`probe-compare.json`の記録を信用せず、各probeをruns rootの`trace.jsonl`と`meta.json`から計算し直して照合する（[analysis-plan.md](analysis-plan.md)「隔離の確認」）。probeの結果は目印のtokenそのものを持たず、各tokenのsha256だけを持つ。

`--run`を付けない`run-trial.mjs`・`run-all.mjs`は、起動するcommandや試行の一覧を出すだけでモデルを呼ばない。途中で止まった試行からの再開は#1817の[README](../1817-skill-application/README.md)「途中で止まった試行からの再開」と同じ（`run1817e`を`run1820m`と読み替える）。

## 測定の前の固定

- 最初の記録のcommit：`results/fixation.json`の最初の記録のcommitは`c7478b7d47ee541d68cbd4accfaa854d61b540e1`である。`run-trial.mjs`と`analyze.mjs`はこの記載を照合する。`fixation.mjs check`は合格（差なし）。
- 作り直した理由（2回目）：有料の測定の前の指摘2件（Low）を是正し、固定したfile（`analysis-plan.md`・`cases.json`・`harness/score.mjs`・`harness/order.mjs`・`harness/probe-check.mjs`・`harness/run-trial.mjs`）が変わったため、台帳に予約が無い（0件）ことを確かめたうえで、記録を新しい最初の記録として作り直した（同じ台帳）。
  - Low-1：Bashで本文のpathを挙げるだけのcommand（`ls -l`・`test -f`・`wc -l`・`stat`等）が本文の読込みに数えられ、`bodyRead`とXの主効果を水増ししていた。中身を読むcommandの区切りだけを数える形にした。
  - Low-2：計画した試行の前の照合が`probe-compare.json`の`pass`を信用し、probeの結果も公開されていなかった。照合でprobeをruns rootの記録から計算し直し、probeの結果を`results/probes/`に写す手順を加えた。
- 前の記録（`b698bfef`、1回目の作り直しの`85a0fe81`）はgitの履歴に残る。1回目は、独立レビューの是正で固定したfileが変わったための作り直しだった。
- 固定したfile：`analysis-plan.md`・`cases.json`・`conditions.json`・`release.json`・`run-order.json`と、`harness/`の15件（`dry-run.mjs`と試験を除く）。
- 台帳：repositoryの外の`<scratch>/rel1820/ledger/ledger-1820.jsonl`（予約0件）。台帳idは`results/fixation.json`にあり、`run-trial.mjs`と`analyze.mjs`はこの台帳だけを使う。
- `results/probe-approval.json`は固定の対象に含めない（承認の記録で計画は変わらない）。

## モデルを呼ばない確認

HEAD `cc786927`（clean tree。固定したfileは最初の記録`85a0fe81`と同じで、`fixation.mjs check`は差なし）で行った。

| 項目 | 結果 | 記録 |
| --- | --- | --- |
| harnessの試験（合成の記録） | 28件すべて合格。#1817から写した4つのfileは#1817の試験68件で合格。`test/test_source_quality.mjs` 2件合格、`npx eslint src bin test v05`は指摘なし | [results/harness-tests.txt](results/harness-tests.txt) |
| dry run（本物のtarball、`--allow-unreleased`なし。fixtureは`<scratch>/run1820b/`） | 全11項目が合格（下の箇条） | [results/dry-run.json](results/dry-run.json) |

dry runの内容：

- A・Dとも、出所`release`（`e7df164a…`、v0.5.111）。16件の入口が記録とpackageに一致し、`claude-md`を採用した。Aは基の`CLAUDE.md`への追記（`append`）、Dは案内文だけの`CLAUDE.md`の作成（`create`。blockSha256 `444b31b5…`は#1814の条件Iと同じ）。
- 試行の写しに中立のcommitを1件入れた後、commitの件名はA・Dで同じ（`Update project files`・`Install ASC`・`initial`）。
- 計画：probe 3回と60試行（`brief` 48、該当しない依頼12）。計画の単価（試行0.08 USD、probe 0.2 USD）で5.4 USD、停止線6 USD。
- 全63件の起動のcommand（引数と依頼文）を出した。どの試行も`--max-turns 2`・`--max-budget-usd 0.3`、probeは`--max-turns 30`・`--max-budget-usd 0.6`で、toolの水準ごとの`--tools`・`--disallowedTools`・`--permission-mode`が条件どおりだった。
- probeの操作の数はR 4、W 6、X 19で、`conditions.json`の`probeSteps`と一致し、`probeMaxTurns`に収まる（`probeStepsCounted`）。
- 隔離の`--settings`の例は、fixture Aの試行とfixture Dの試行（`RGD-brief-1`）の両方を記録した。DのfixtureはDの試行で読込み・書込みの禁止に入る（`fixtureDDenied`）。
- Xを外した場合の計画：8セル、44試行（`brief` 32、該当しない依頼12）、probeセルRSA・WSA、順序の検査に指摘なし（`dropXPlan`）。
- `run-trial.mjs`を`--run`なしで実行すると、計画だけを出した。`--run`は、許可の環境変数が無いと拒否した。probeセル以外のprobe、`--ledger`の無いprobe、承認の記録の無い`markers.mjs create`も拒否した。`fixation.mjs drop-level X`は、`XSA-probe-2`の精算と`probe-compare.json`が無いため拒否した。台帳は1行（台帳idだけ）のまま。

## #1817のharnessからの変更

[harness/](harness/)は#1817のharnessの写しで、#1814・#1815・#1817のfileは変えていない。`guard`・`ledger`・`install-asc`・`condition-i`は#1817とbyteで同じ（試験で照合）。変更は各fileの先頭に注記した。主なもの：

- `make-fixture.mjs`：fixtureをA・Dの2つにした。Dの元のfileはsha256を[conditions.json](conditions.json)で固定した。導入するのは1つのreleaseだけ。
- `run-trial.mjs`：セル（tool×依頼文×フォルダ）と依頼で試行を決める。toolの水準ごとの引数、`--max-turns 2`、隔離の`--settings`を加えた。probeは#1820の承認の記録を、計画した試行は3つのprobeの比較の合格（台帳の精算に結んだもの）を条件にした。probeの操作は水準ごとの固定の一覧（`probeSteps`）。許可の環境変数は`ASC1820_ALLOW_PAID`。
- `score.mjs`：最初の2つのmessage（message idでまとめる）で採点する形にした。Bashの中身を読むcommand（`BASH_READERS`）の引数での本文の読込みも数える。セルのtool・permission modeと違うinitは失敗とする。セルごとの集計と主効果（`summarizeCell`・`mainEffects`）を加えた。
- `order.mjs`・`run-all.mjs`：`run-order.json`の`perRep`から計画を作る。該当しない依頼は回1・2だけで、置き換えはその次の番号。probeはprobeセルだけ。`probe-compare.json`を台帳に結び、各probeをruns rootの記録から計算し直す照合（`probeCompareProblems`）。
- `probe-check.mjs`：toolの水準ごとの期待（tool・permission mode）と、水準ごとの操作の一覧の判定（結果の有無、拒否の証拠、成功、`work/`の読込み、`git status`の記録）を加えた。`compare`はtool以外を比べ、各probeの試行名とsha256、項目の合否、目印のtokenのsha256、sessionの事実を持ち、`--drop X`と`--out`を受ける。`recheckProbe`（照合での計算し直し）と`publish`（伏せた写し）を加えた。
- `apply-condition.mjs`・`fixation.mjs`：事前に決めたXの削除（`applyDrop`、`drop-level`）。
- `analyze.mjs`：#1817の`judge.mjs`の照合をそのまま行い、判定の代わりに分析を出す。失敗の規則はセルあたり1件まで（`cellRuleReasons`）。
- `collect.mjs`：hookの記録を除き、セルと要因・initの事実を行に加えた。
- `fixation.mjs`：段階3の処理を除いた。`markers.mjs`：目印の名前と、承認の確認。`apply-condition.mjs`：中立のcommitだけにした。

## 限界

- 各セル4回。1〜2試行の差は偶然の範囲を出ない。段階1は原因の目安を得るためのもので、改善の効果は段階2で測る。
- 最初の2ターンだけを見る。その後の読込み（BRIEFを読んだ後の再判断など）と手順の適用は見ない。
- 水準Rも、#1817と違い隔離の`--settings`（作業directoryの外の読込みの禁止とsandboxの設定）を受ける。3つの水準をtoolとpermission modeだけで分けるためである。#1817のRとの比較は参考にとどめる。
- 水準Wには、#1815にあったbrowser MCPとその注意書きが無い。browserのtoolの効果は段階1では分からない。
- フォルダDはui03だけ。#1815の他の2つの依頼（ui04・ui07）は使わない。
- 依頼文Gは、#1815の文面からbrowserの注意書きを除き、AではBRIEFの位置を`docs/BRIEF.md`に変えた。#1815の文面そのものではない。
- 該当しない依頼は、RとWのアプリのrepoで各2回だけ。Xとフォルダ`D`での過剰な読込みは測らない。
- Bashでの本文の読込みは、中身を読むcommand（`cat`・`head`・`tail`・`sed`・`awk`・`less`・`more`・`grep`・`rg`・`nl`・`bat`・`view`・`strings`）の引数に本文のpathがある場合だけ数える。一覧に無い読むcommand（`od`・`xxd`・`python`での読込み等）は数えない。`cd`で移動してから相対pathで読む形や、変数・globで指す形も数えない。
- 計画した試行の前の照合は、probeの時点のhostの状態による項目（Claude Codeのprogram directory、ownerのSkill・指示file・memory、debug logのpathとprogram directoryの関係）を計算し直さず、記録の値を使う。目印のtokenの照合は記録されたsha256による（tokenそのものは目印fileと一緒に消える）。
