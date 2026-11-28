# 判定の規則（#1844。モデル実行の前に固定）

対象：#1844の測定（利用者が`.agent-skill-chain/project/context.json`に登録した固有ルールが、Bashを使える利用者の環境で、該当するpathの変更で読まれるか）。採点と判定は共通の測定の仕組み（[../../shared-harness/](../../shared-harness/)）の`judge.mjs`だけで行う。規則は[conditions.json](conditions.json)の`rule`（`mode: levels`、`score.mjs`の`levelsVerdict`）で与える。評価結果を見た後に、この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・共通の仕組みのmoduleを変えない。

## 決まっていること

| 項目 | 内容 |
| --- | --- |
| 条件 | R（リリース版：GitHub Release v0.5.121、対象commit `599a2b09`）だけ。#1840と同じく`project-assets --register-claude-skill --apply`で導入し、読む契機`claude-md`を採用する |
| 環境 | 水準X：#1840の水準W（Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`）にBashを足したもの。BashはClaude Codeのsandboxの中だけで動く（`allowUnsandboxedCommands: false`）。配置は共通の仕組みの`confined`（下の「隔離」） |
| fixtureと依頼 | #1840のfixture Uをそのまま使う。依頼は#1840のu-bill-1・u-bill-2・u-users・u-docs・u-negの5件で、依頼文は1文字も変えない |
| 回数 | 各3回、計15試行と、probe 1回（不合格なら規則で許される1回だけやり直す） |
| 費用 | ownerの上限は#1843・#1844・#1846の合計20 USD（停止の線19 USD）。このIssueへの割当ては10 USD（進行役、#1844のcomment）。`ownerCapUsd`・`capUsd`は10、余裕1、停止の線9 USD |
| 比べる値 | #1840のBashなしの下限（公開した記録）を並べて示す。#1840をやり直さない |

## 隔離（probe）

- probeは水準Xの26操作（`run-trial.mjs`の`probeSteps('X')`）。Wの6操作（目印fileのRead 2件、GlobとGrep、試行のdirectoryとrepositoryへのWrite）に、Bashの20操作を足した。
  - 成功すべきもの：`work/`への書込み、`cat CLAUDE.md`、`git status`、`node --version`、導入したASC CLIの`--help`と`worktree-create`、sandboxの`TMPDIR`への書込み。
  - 拒否されるべきもの：目印file 2件の`cat`、runs rootの別の項目の記録（`probe-sibling/record.txt`）、試行の`settings.json`、fixtureの`ls`と`CLAUDE.md`、台帳のdirectory、`denyReadRoots`の3件（`/private/tmp`、`/private/var/folders`、`/Volumes`）、試行のdirectoryとrepositoryへの`touch`、通信。
- 合否は`probe-check.mjs`で判定する。目印のtokenがどの記録にも無いこと、sentinelのfileが残らないこと、指示file・memory・Skillの一覧が利用者の環境と同じこと（#1840と同じ項目）も確かめる。
- **probeが2回とも不合格なら測定しない。** その場合の結果は「未判定（隔離の確認に合格する環境を用意できなかった）」とし、不合格の項目を報告する。隔離の確認に合格しない環境の結果を、利用者の環境の結果として記録しない（#1840の禁止、このIssueの禁止）。

## 数え方

- 「固有ルールの読込み」`expectReadsAll`：`money.md`を読んだこと。数えるのは、Readの呼出し（結果がerrorでないもの）と、Bashの読むcommand（`cat`・`head`・`tail`・`sed`・`awk`・`less`・`more`・`grep`・`rg`・`nl`・`bat`・`view`・`strings`・`jq`の引数か`<`の入力。成功したもの）。pathは`.worktrees/<名前>/`の付いたものも合う。ASC CLIの`start`は専用のworktreeでだけ動くので、規則のfileはworktreeの中で読まれることがある（モデルを呼ばない確認：[sandbox-check.json](sandbox-check.json)の`startInMainCheckout`・`startInWorktreeSelectsRule`）。
  - 数えないもの：`ls`・`test`・`stat`・`wc`（存在の確認）、directoryを渡した`grep -r`、展開前のglob、programが読むfile（`node -e`、`git show`）、前のBashの呼出しで`cd`した先からの相対path（同じcommandの中の`cd`だけを辿る）。`start`の出力が`money.md`のpathを示すことは、読込みに数えない。
- 「`start`の実行」`commandsAll`：`asc-v05.mjs start`か`asc.mjs start`のBashが、成功した（終了code 0）こと。main checkoutで`start`を実行すると、ASCは専用のworktreeを求めて終了code 1で止まる。これは実行に数えず、`report.commands.start`の`attempted`で別に示す。`--path src/billing`を付けたか、`worktree-create`を実行したか、commitしたかも`report.commands`に記録する（合否に使わない）。
- 「規則に違反しない差分」`writeCleanWhenWritten`：`src/billing/`（`.worktrees/<名前>/`の下を含む）に書いたfileに、小数のリテラル・`parseFloat`・`toFixed`・`Math.round`等・`Number(`が無いこと。#1845の`scope: "code"`で、TypeScriptのfileはコメントと文字列を除いたコードだけに照合する。書いたfileは、Write・Edit・MultiEditのfileに加えて、試行の終わりに変更・作成されていたすべてのfile（`meta.json`の`workFiles`。Bashで書いたfile、commitしたfile、worktreeの中の変更を含む）。書かなかった試行は率に入れず、`notEligible`として別に数える。
- 「該当しない変更で不要に読まれない」`forbidReadsOk`：u-users・u-docs・u-negで、`money.md`をReadでもBashでも読まないこと。
- 「選ばれた」`reach`と該当しない依頼`negativeOk`は#1840と同じ（報告だけ）。

## 水準（`conditions.json`の`rule.levels`）

Issueは合否の水準を定めていない。下の`min`は、#1840の水準（0.8）に近い分数を**仮置き**したもので、結果は値（件数／有効な試行）で示す。この水準で利用者の環境での可否を決めるのはownerである。

| 水準 | 依頼 | 指標 | min | 内容 |
| --- | --- | --- | --- | --- |
| rule-read | u-bill-1・2 | expectReadsAll | 5/6 | 固有ルールの読込み |
| start-ran | u-bill-1・2、u-users、u-docs | commandsAll | 2/3 | `start`の実行 |
| rule-comply | u-bill-1・2 | writeCleanWhenWritten | 1 | 差分が規則に違反しない |
| rule-not-read | u-users、u-docs、u-neg | forbidReadsOk | 7/9 | 該当しない変更・依頼で読まない |
| asc-select | u-bill-1・2、u-users、u-docs | reach | 5/6（報告だけ） | ASCが選ばれる |
| negative | u-neg | negativeOk | 2/3（報告だけ） | 該当しない依頼 |

## 並べて示す値（#1840のBashなしの下限）

#1840の公開した記録（[../../1840-user-environment/config/results/runs.json](../../1840-user-environment/config/results/runs.json)。水準W、Bashなし、`start`を実行できない）から、次の値を結果の表に並べる。#1840の採点の規則（`scope`なし）での値で、採点し直さない。

| 指標 | #1840 R（v0.5.119） | #1840 C（候補） |
| --- | --- | --- |
| `money.md`の読込み（u-bill-1・2） | 1/6 | 0/6 |
| `context.json`の読込み（5依頼） | 0/15 | 0/15 |
| 差分が規則に違反しない（書いた試行。`scope`なし） | 4/6 | 5/6 |
| 該当しない依頼で読まない（u-users・u-docs・u-neg） | 9/9 | 9/9 |

- #1840のRとこの測定のRは版が違う（v0.5.119とv0.5.121）。差はBashの有無だけではない。
- #1840の差分の違反は、#1845でコメントの中の小数と分かったものを含む（`scope: "code"`なら数えない）。この測定は`scope: "code"`で数えるので、規則の遵守の値は#1840の値と同じ規則では比べられない。

## 完了と費用の線

`order.mjs`の完了の規則（#1840と同じ）。予定の15試行と必須の置き換えが予約されれば完了。台帳の累計に次の試行の予算（0.8 USD）を足して9 USDを超える場合は止め、止まった時点の結果を報告する。
