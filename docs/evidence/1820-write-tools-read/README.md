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
- どのセルも、release v0.5.111（[release.json](release.json)。#1817の本文の修正を含む最新のrelease。sha256はSHA256SUMSとreleaseのassetのdigestの両方と一致）を利用者の手順で導入し、読む契機`claude-md`を採用する（#1814の条件I）。
- どの試行も`--max-turns 2`。セルの違いは、toolの水準の起動の引数・依頼文・フォルダだけである。実行の順序は[run-order.json](run-order.json)で固定した（回を外側、各回の中で同じ依頼文・フォルダの3つのtoolの水準を隣に並べ、該当しない依頼を間に挟む）。

## Bashの隔離（水準X）

Claude Codeのsandboxで隔離し、測定に使えるかをprobeで確かめてから測る。すべての水準に同じ`--settings`を渡す（Bashがあるのは水準Xだけなので、sandboxが働くのはXだけである）。

- `permissions.blockReadsOutsideWorkingDirectories`：file toolの作業directoryの外の読込みを止める。
- `sandbox`：`enabled`、`failIfUnavailable`（sandboxが使えなければ起動しない）、`allowUnsandboxedCommands: false`（sandboxの外での実行を許さない）、`autoAllowBashIfSandboxed`（sandboxの中のcommandは確認なしで実行する）、`network.allowedDomains: []`（通信先なし）。
- 読取りの禁止：`/Users`（実HOMEとこのrepositoryを含む）、runs root、fixture、台帳のdirectory。試行の`work/`だけを読めるように戻す。書込みの禁止：fixtureと台帳のdirectory。
- 水準Xのprobeは、次を確かめる。`work/`の中への書込みが成功する（sandboxの設定が効いている証拠）。目印fileの`cat`・試行のdirectoryとrepositoryへの`touch`・`curl`が失敗する。目印のtokenがどの記録にも無い。sentinelのfileが残らない。水準Wのprobeは、作業directoryの外へのWriteの拒否を確かめる。

残る危険：

- 設定fileが検証で落ちると、`-p`では黙って無視される。そのためprobeで、`work/`への書込みが成功することを確かめる。
- sandboxはmacOSのSeatbeltを使う。sandboxの中のshellから起動すると入れ子になり使えないので、harnessはsandboxの外のshellで実行する（`failIfUnavailable`により、使えなければ起動しない）。
- 上の禁止以外のpath（`/private/tmp`の他のfile、`/etc`等）は読める。書込みは、Claude Codeのsandboxの既定で許される場所（作業directoryと一時directory等）に限られる。他の試行のdirectoryへの書込みはprobeで確かめる。精算済みの試行の記録はsha256で台帳に結んであり、改変は検出される。
- 実HOMEにあるcommand（nodenvの`node`等）はsandboxの中では動かない。利用者の環境とはBashで実行できるものが違う。ただし判断が起きる最初のmessageまでに見えるのはtoolの定義だけである。
- sandboxを有効にすると、Bashのtoolの説明文にsandboxの注意が加わる。これも水準Xの条件に含まれる。

probeでXが合格しない場合は、Xを測らずにownerへ報告する。Xを外すとセルは8になる（計画を変えて固定し直す）。

## 指標と分析

[analysis-plan.md](analysis-plan.md)で固定した。

- 主な指標：最初の2つのmessageでのASC本文の読込み（`bodyRead2`）を、セルごとに件数／有効な試行で示す。
- 併せて記録する：最初のmessageでの本文の読込み・`Skill(asc)`・入口・`skills/README.md`の読込みと、最初のtool呼出し。
- 主効果：水準ごとにセルの率を単純平均し、その差（W−R、X−R、X−W、G−S、D−A）を示す。交互作用は2要因の平均の表だけ。
- 該当しない依頼（RSA・WSA）での過剰な読込みの件数。
- 段階1は診断であり、採否の判定はしない。各セル4回では1〜2試行の差は偶然の範囲を出ない。

## 費用

- 上限：段階1・2の合計で25 USD。段階1は、台帳の累計＋0.3 USDが6 USDを超えるなら起動しない。
- 1試行の予算（`--max-budget-usd`と台帳の予約）：0.3 USD。#1817の実績は、全ターンの試行で平均0.085 USD、最大0.141 USD（112試行）。2ターンの試行はこれより安く、その約2倍とした。
- 見込み：#1817のtraceのtoken量で、最初の2つのmessageは平均0.048 USD、asc-3では最大0.089 USDだった。計画の単価を1試行0.08 USD、probe 0.15 USDとして、60試行＋probe 3回で約5.3 USD。平均どおりなら約3.3 USD。1試行の平均が約0.089 USDを超えると、6 USDの線で最後の数試行が起動しない（`cap-reached`として分析する）。

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
#   （WSA・XSAも同じ）
node $EV/harness/probe-check.mjs compare <scratch>/run1820m/probe-RSA.json <scratch>/run1820m/probe-WSA.json <scratch>/run1820m/probe-XSA.json --out <scratch>/run1820m/runs/probe-compare.json
node $EV/harness/markers.mjs remove <repo-root>
# 3. 測定：固定した順の60試行（止まった場合は同じcommandで次の試行から続く）、その後に必須の置き換え
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1820_ALLOW_PAID=1 node $EV/harness/run-all.mjs planned <scratch>/run1820m/runs --fixture-A <scratch>/run1820m/fixture-A --fixture-D <scratch>/run1820m/fixture-D --ledger $LEDGER --run
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1820_ALLOW_PAID=1 node $EV/harness/run-all.mjs replacements <scratch>/run1820m/runs --fixture-A <scratch>/run1820m/fixture-A --fixture-D <scratch>/run1820m/fixture-D --ledger $LEDGER --run
# 4. 固定の照合、取り出し、分析
node $EV/harness/fixation.mjs check $EV/results/fixation.json
node $EV/harness/collect.mjs <scratch>/run1820m/runs $EV/results/traces --ledger $LEDGER --publish-ledger $EV/results/ledger.jsonl
node $EV/harness/analyze.mjs $EV/results/traces --runs-root <scratch>/run1820m/runs --ledger $LEDGER --runs-json $EV/results/runs.json --out $EV/results/analysis.json
```

`--run`を付けない`run-trial.mjs`・`run-all.mjs`は、起動するcommandや試行の一覧を出すだけでモデルを呼ばない。途中で止まった試行からの再開は#1817の[README](../1817-skill-application/README.md)「途中で止まった試行からの再開」と同じ（`run1817e`を`run1820m`と読み替える）。

## 測定の前の固定

- 最初の記録のcommit：FIXATION_COMMIT_PLACEHOLDER
- 固定したfile：`analysis-plan.md`・`cases.json`・`conditions.json`・`release.json`・`run-order.json`と、`harness/`の15件（`dry-run.mjs`と試験を除く）。
- 台帳：repositoryの外の`<scratch>/rel1820/ledger/ledger-1820.jsonl`（予約0件）。台帳idは`results/fixation.json`にあり、`run-trial.mjs`と`analyze.mjs`はこの台帳だけを使う。
- `results/probe-approval.json`は固定の対象に含めない（承認の記録で計画は変わらない）。

## モデルを呼ばない確認

DRYRUN_PLACEHOLDER

## #1817のharnessからの変更

[harness/](harness/)は#1817のharnessの写しで、#1814・#1815・#1817のfileは変えていない。`guard`・`ledger`・`install-asc`・`condition-i`は#1817とbyteで同じ（試験で照合）。変更は各fileの先頭に注記した。主なもの：

- `make-fixture.mjs`：fixtureをA・Dの2つにした。Dの元のfileはsha256を[conditions.json](conditions.json)で固定した。導入するのは1つのreleaseだけ。
- `run-trial.mjs`：セル（tool×依頼文×フォルダ）と依頼で試行を決める。toolの水準ごとの引数、`--max-turns 2`、隔離の`--settings`を加えた。probeは#1820の承認の記録を、計画した試行は3つのprobeの比較の合格を条件にした。許可の環境変数は`ASC1820_ALLOW_PAID`。
- `score.mjs`：最初の2つのmessage（message idでまとめる）で採点する形にした。セルのtool・permission modeと違うinitは失敗とする。セルごとの集計と主効果（`summarizeCell`・`mainEffects`）を加えた。
- `order.mjs`・`run-all.mjs`：`run-order.json`の`perRep`から計画を作る。該当しない依頼は回1・2だけで、置き換えはその次の番号。probeはprobeセルだけ。
- `probe-check.mjs`：toolの水準ごとの期待（tool・permission mode）、水準W・Xの外への書込みの拒否、水準Xのsandboxの確認を加えた。`compare`はtool以外を比べ、`--out`で書く。
- `analyze.mjs`：#1817の`judge.mjs`の照合をそのまま行い、判定の代わりに分析を出す。
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
