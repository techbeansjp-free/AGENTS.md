# 共通の測定の仕組み（shared harness）

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。

「ASCのSkillが、書込みのtoolがある利用者同等の隔離した環境で読まれ、適用されるか」を測る仕組みを1つにまとめたもの。#1820の段階2のharness（`docs/evidence/1820-write-tools-read/stage2/harness/`）を一度だけ写し、Issueごとの値を設定のdirectoryから読む形にした（#1823、ownerの決定）。**以後の測定は、Issueごとに設定のdirectoryだけを置き、この仕組みを写さない。**

## 画面デザインの評価（#1835）

画面デザインを評価者（Fable・Codex）に比べさせる測定は、この仕組みとは別の手順で行う。3層（層1：機械判定の下限、層2：既知の劣化による評価者の校正、層3：ownerの盲検の一対比較）を総合点にまとめずに報告する。手順・道具・結果は[1835-design-eval-layers](../1835-design-eval-layers/README.md)にある。#1835では、画面を並べて見せる一対比較が既知の劣化を最もよく見分け、講評を点にする方式（FLR・SSR）は不採用だった。道具はこのdirectoryへ移していない。

## 過去の写しの扱い

#1807・#1814・#1815・#1817・#1820の各directoryにあるharnessの写しは、その測定の記録として残す。**変更・拡張しない。** 新しい測定に必要な変更は、ここに加える（下の「変更するとき」）。

## 設定のdirectory

すべてのcommandは`--config <dir>`か環境変数`ASC_EVAL_CONFIG`で設定のdirectoryを受け取る（`config.mjs`）。harnessのdirectoryにIssueのfileは置かない（試験が確かめる）。

| file | 内容 |
| --- | --- |
| `conditions.json` | Issue番号・目印の名前（`markerTag`）、条件（`cells`：toolの水準、`release.json`の項目、`release`か`candidate`か）、toolの水準、fixture（`app`：fixture Aと追加のfile、`design`：sha256で固定した画面の依頼のfile）、`--max-turns`、予算（上限・余裕・1試行の予算・以前の段階の費用`priorSpend`・見込み）、判定の規則（`rule`）、別に報告する部分集合（`subsets`）、dry runの比較（`dryRun`） |
| `release.json` | 条件ごとのtarballとsha256。`placeholder`の項目や埋まっていないsha256は何も固定しない |
| `cases.json` | 依頼・期待するSkill・reference（条件ごとに`referencesByCondition`）・回答の目印 |
| `run-order.json` | 実行の順序 |
| `decision-criteria.md` | 判定の規則の文章 |
| `README.md` | 最初の固定の記録のcommitを書く（`run-trial.mjs`が照合する） |
| `results/` | `probe-approval.json`（ownerの目印fileの承認）、`fixation.json`、公開する結果 |

## 守っていること（#1820の段階2から変えていない）

- 固定した順序・必須の置き換え・完了と費用の線の規則・probeの回数の制限（`order.mjs`）。
- 精算のsha256（`ledger.mjs`）、台帳の手での編集の検出、公開した台帳。
- 固定の記録（`fixation.mjs`。設定の5fileと共通の仕組みのmodule 16件のsha256）と`refix`（probeの後の`probe-check.mjs`の是正だけ）。
- 有料の実行の環境変数（`ASC_EVAL_ALLOW_PAID=1`）。`release.json`に仮の値がある間は、すべての有料の実行と固定の記録を拒否する。
- 隔離：試行ごとの空のHOMEと設定directory、`--settings`のsandbox、認証は`CLAUDE_CODE_OAUTH_TOKEN`（または`ANTHROPIC_API_KEY`）だけ、試行のdirectoryの祖先に`CLAUDE.md`・`AGENTS.md`・`.claude`・`.git`等が無く、repositoryと実HOMEの外であること（`guard.mjs`）。
- probe（隔離の確認）を試行の記録から計算し直す照合。

## 生の実行記録を公開しない（#1823の決定B）

`collect.mjs`は、生のtraceをrepositoryへ写さない。公開するのは次だけである。

- `trials.json`：試行ごとの小さな要約（条件・依頼・導入の出所・model・費用・turn・時間・生の`trace.jsonl`と`meta.json`のsha256等）。
- `runs.json`：試行ごとの採点（`score.mjs`）。読んだASCのbyte（`ascBytesRead`）、入力トークン、読んだreferenceを含む。
- `ledger.jsonl`：台帳。
- `published.json`：上の3fileのsha256と、手元の生の記録の識別子`rawRunsSha256`。
- `judge.json`（`judge.mjs`）と`probes/`（`probe-check.mjs publish`）。

`judge.mjs`は、手元（scratch）の生の記録から公開する記録を作り直し、byteで照合してから判定する。生の記録が手元に無ければ判定できない（第三者は、公開した採点と台帳のsha256までを照合できる）。

## 試験

```text
node --test docs/evidence/shared-harness/test/harness.test.mjs
```

試験用の設定（`test/config/`：#1820の段階2の計画をこの形にしたもの。有料の実行には使わない）と、#1823の設定を使う。#1820の段階2の試験を移したものに、設定の解決、仮の値の拒否、merge場面の目印と採点、条件ごとのreference、#1823の規則、生のtraceを公開しない`collect`と作り直しの照合の試験を加えた。`test/config/results/probe-approval.json`がcommitされていないと、承認の試験は失敗する。

## 大きさ（2026-11-26）

- この仕組み：module 17件（`dry-run.mjs`を含む）と試験1件、計3,048行（moduleは2,457行）。
- 設定の例（#1823）：7file、約1,050行（大半は`cases.json`）。
- 過去の写し：`docs/evidence/`の他の`.mjs`は240件、23,346行（#1820の段階2の写しは17件、2,735行）。

## #1840で加えたもの（2026-11-27）

どれも設定のfieldで働き、そのfieldの無い設定（試験用の設定、#1823）の動きと公開する記録は変えない（試験で確かめる）。#1823の測定は終わっている。

- `conditions.json`の`ascSkills`：配布Skillの名前の一覧（`warranty-scope`を含む17件）。採点（`score.mjs`の`ascSkillsOf`）、probeの期待するdescriptionの件数（`probe-check.mjs`の`ascEntriesOf`）、dry runの入口の数が使う。無ければ従来の16件。
- fixture：`appFiles: false`（fixture Aのfileを入れず、`extraFiles`だけの別のproject）、`afterInstallFiles`（ASCの導入の後に利用者が置くfile。固有ルールの`context.json`や固有Skill。導入のcommitに含め、commitの件名を他のfixtureと揃える。導入したfileは置き換えない）。
- `cases.json`の依頼のfield：`expectReads`・`forbidReads`（読むべき・読んではならないfileのpathの正規表現）、`forbidSkills`（選ばれてはならないSkill）、`writes`（書いたfileを試行の終わりの`work/`の写しで読み、`require`・`forbid`を照合する。`collect.mjs`の`fileText`）、`answerNone`（回答に現れてはならない目印）、`userSkill`（利用者のSkill：Skill tool呼出しか`.claude/skills/<name>/SKILL.md`のReadを本文とし、ASCのbyteに数えない）。
- 判定：`rule.mode: levels`（`score.mjs`の`levelsVerdict`）。候補と基準の比較ではなく、条件ごとに固定の水準（依頼の集合・指標・min）を満たすかを示す。

## #1840の測定前の独立レビューで加えたもの（2026-11-27）

これもfieldの無い設定（試験用、#1823）の動きと公開する記録を変えない（試験で確かめる）。

- `cases.json`の`answerQuota`（観点ごとの目印{`id`・`viewpoint`・`pattern`か`all`・`unless`・`report`}のうち`min`件以上。`report: true`は数えず`markerGroups`で示す）、`answerNone`の`{id, pattern}`（`markerDeductions`）、`markerText: "answer+writes"`（目印を回答と書いたfileの文の和に当てる）。
- `writes`の`require`・`forbid`の`group`（落ちた理由を`writeFailedGroups`で示す）、`writesReport`（合否に使わない照合）、書かなかった試行の`writeRequireInAnswer`。
- `cases.json`の`report`（試行ごとに、指定したfileのRead・回答の語・書いたfileの全部を`report`に記録する。合否に使わない）。利用者のSkillが試行のSkill一覧に載ったか（`userSkillsListed`）。
- 水準の`use: "report"`（計算して`perCondition.reported`に示し、合否に使わない）と`label`、指標`writeCleanWhenWritten`（書いた試行だけを率に入れ、書かなかった試行は`notEligible`）。
- `run-trial.mjs`が試行の終わりに変更・作成したfileのsha256を`meta.json`の`workFiles`に記録し（`make-fixture.mjs`の`workChanges`）、`collect.mjs`（と、それを呼ぶ`judge.mjs`）は`work/`がそれと違えば拒否する。
- `probe-check.mjs`：`conditions.json`の`ascSkills`があれば、それ以外の`.claude/skills/`の入口を利用者のSkillとして分け、Skill一覧に載りdescriptionが原文で示されることを`userSkillsListed`で確かめる。
- `dry-run.mjs`：referenceの計算は、`ascSkills`の無い設定では従来どおり`asc`の依頼だけ（`fixtureReferences`）。
- `calibrate.mjs`（固定しないtool。`dry-run.mjs`と同じく固定の記録に含めない）：設定の`calibration.json`に挙げた、これまでの評価で採点した回答に目印と書いたfileの照合を当て、これまでの採点と比べた表を作る（`--md`）。

## #1840の再レビューで加えたもの（2026-11-27）

これもfieldの無い設定（試験用、#1823）の動きと公開する記録を変えない（試験で確かめる）。

- `cases.json`の`markerBase` {`pathPattern`}：`markerText: "answer+writes"`で目印を当てる前に、書いたfileの文から、試行の前からあるfileと同じ行（前後の空白を除いて行単位で比べる）を除く（`score.mjs`の`baseLinesFor`・`markerTextOf`）。試行の前からあるfileは、fixtureのHEADのうち`pathPattern`に合うfile（導入した雛形）と、書いたfile自身の試行の前の版。除いた行の数を`markerBaseExcludedLines`に記録する。`collect.mjs`は`work/`のHEADを`make-fixture.mjs`の`headReader`（`git ls-tree`と`git cat-file --batch`）で読み、`priorFiles`・`priorTexts`として渡す。`markerBase`があるのにそれが無ければ採点を拒否する。
- `writes.requireWithoutBase`：`require`の照合にも同じ除き方を使う（`forbid`は全文に当てる）。
- `calibrate.mjs`：`bases`（条件ごとの雛形：commitとdirectory）、回答を書いたfileとして当てる形（`form: "written"`）、落ちるべき回答（`mustFail`：雛形そのまま・見出しと表だけ・利用案内だけ・1行だけ埋めた雛形等を、雛形のfileから作る）、1つの回答を複数のfileに分ける形（`fromLine`・`untilLine`）。表に、雛形と同じ行を除かない場合の結果、観点ごとのSkillあり・なしの当たる率と採点、各目印が当たる雛形の行の数、落ちるべき回答の結果を加えた。#1828の「これまでの採点」の合否は、目印と同じ観点と`min`を0/1の点に当てて作ったもので、#1828の判定ではないことを表に書く。

## #1845で加えたもの（2026-11-28）

#1840の測定の後に、金額の規則の照合と、PR #1842のレビューの指摘を直した。照合の直しと`requireFiles`・分数の水準は設定のfieldで働き、そのfieldの無い設定（試験用、#1823、#1840）の採点は変えない。残りの直し（`work/`の照合・すべての`GIT:`の行・利用者のSkillの成功）は拒否と判定を厳しくするもので、#1840の記録では結果が変わらない。#1840の生の記録から作り直した`trials.json`・`runs.json`は、公開したものとbyteで一致する（#1845のPRの記録）。#1840の設定のfile（`cases.json`・`conditions.json`・`decision-criteria.md`等）は変えていない。共通の仕組みのmoduleが変わるので、#1840と#1823の`fixation.mjs check`はmoduleの差を示す（下の「変更するとき」のとおり、測定の後の変更である）。#1840・#1823の記録の照合と判定（`fixation.mjs check`・`judge.mjs`）は、それぞれの`results/fixation.json`の`fixedAtCommit`の共通の仕組みで行う（例：`git worktree add <dir> <fixedAtCommit>`で取り出したものを使う）。#1840の`decision-criteria.md`の「共通の仕組みのmoduleを変えない」は、その測定の判定までを指す。

- `writes.forbid`の`scope: "code"`：JavaScript・TypeScriptのfile（`.js`・`.ts`等）では、コメントと文字列（template literalの文字の部分）を空白にしたコードだけに照合する（`score.mjs`の`codeText`）。`// 税10.9 → 10`や`1bp = 0.01%`は数えず、`price * 1.1`や`Number(subtotal) * rate`は数える。他のfileとscopeの無い項目は全文に照合する（従来どおり）。JSX（`.jsx`・`.tsx`）の文の部分はコードとして照合する（`<p>1bp = 0.01%</p>`は数える）。JSXの文の中の`'`・`"`・`//`は文字列・コメントの始まりと読み、同じ行の後ろのコードを照合しない。小さなscannerでparserではなく、`)`の直後の正規表現（`if (ok) /x/.test(s)`）は除算と読む。
- `writes.requireFiles` [{`id`, `pattern`, `group`}]：書いたfileのpathに、項目ごとに合うものが要る（例：FN-003とSCR-005の両方）。足りない項目は`writeFilesMissing`。`calibrate.mjs`も`writeFilesMissing`を不合格に数える。`calibrate.mjs`で回答を1つの書いたfileとして当てる形では、sourceの`as`（`pathPattern`に合うpath）がそのfileの名前になり、`scope`が採点と同じに効く。`as`が無ければ名前は`<answer>`で、`scope`は当てず全文に照合し、表の「落ちた点」にそう書く。
- 水準の`min`を分数の文字列（例：`"2/3"`）で書くと、整数で比べる（`ok * 3 >= 2 * n`。4/6・7/9が届く）。数の`min`は従来どおり率で比べる。
- `collect.mjs`：`workFiles`（か`workFilesError`）を記録した試行は、`work/`が無ければ拒否し、`work/`のHEADが`meta.json`の`sampleHead`と違うか、`sampleHead`が記録されていなければ拒否する（何も書く前に。HEADは`gitEnv`の環境で読む）。
- `probe-check.mjs`：`gitContextNeutral`は、回答のすべての`GIT:`の行を見る（記録の`gitLine`は最後の行のまま）。
- 利用者のSkill（`userSkill`）の本文の読込みは、結果がerrorでない`Skill`の呼出しか、成功したReadだけを数える。

### 次の設定を書くときの注意（#1842のレビューの指摘のうち、設定で直すもの）

次の指摘は設定の値の問題なので、仕組みではなく次の測定の設定で直す（#1840の設定は固定したので直さない）。

- 雛形の読取りの照合（`forbidReads`・`expectReads`）は、配布の写し`managed-runtime/v05/templates/specs/`も含める（`cases.json`の値の例：`^\\.agent-skill-chain/(managed-runtime/v05/)?templates/specs/`）。
- 複数のfileを書く依頼（#1840のs-1）は、`writes.requireFiles`でfileごとに求める。
- 水準の`min`は、試行の数で割り切れない値（0.67・0.78）ではなく分数の文字列で書く。
- 金額の規則のような、コードについての禁止は`scope: "code"`にする。
- `decision-criteria.md`に、観点が求めないもの（#1840のm-r7は合意の版を求めない）と、水準の分子が数えるもの（#1840のg2-rule-readは`money.md`の読取りだけ）を書く。

## #1844で加えたもの（2026-11-28）

Bashを使える水準（水準X：W＋Bash）を、`conditions.json`の`toolLevels.<id>.sandbox`のfieldで加えた。そのfieldの無い水準（試験用の設定、#1823、#1840の水準W）の設定・起動・採点・照合は変えない（試験で確かめる）。#1840と#1823の測定は終わっていて、それぞれの`fixedAtCommit`の共通の仕組みで照合する（上の#1845と同じ扱い）。

- `run-trial.mjs`の`confinedSettings`（`sandbox.layout: "confined"`）：`allowRead`を使わない`--settings`。#1820の段階1の水準Xは、`--settings`の`allowRead`が同じ`--settings`の`denyRead`を開け直さず（Claude Code 2.1.323）、`work/`を読めずに不合格だった。この配置では、`work/`と試行の`tmp/`の祖先を禁止しない。読取りと書込みを禁じるのは、`/Users`、`denyReadRoots`、fixture、台帳のdirectory、runs rootの他の項目（起動時に列挙）、試行の記録のfile（`TRIAL_RECORD_FILES`）。書込みは、試行の`home/`・`config/`・`bin/`も禁じる。禁止が`work/`か`tmp/`を覆う配置（例：runs rootが`/private/tmp`の下で、`/private/tmp`を禁じる）は、予約の前に拒否する。
- `trialEnv`：Claude Codeの一時directory（`CLAUDE_CODE_TMPDIR`。sandboxの中の`TMPDIR`）を試行の`tmp/`にし、Bashの`PATH`を試行の`bin/`（`copyNode`：harnessのnodeの写し。起動の前に1回実行する）と`pathDirs`だけにする。`claude`はharnessの`PATH`から絶対pathで起動する。試行の後に`bin/`と`tmp/`を消す。
- probe（`probeSteps('X')`、`bashProbeSteps`）：Wの6操作に、Bashの操作（`work/`の中の書込み・`cat CLAUDE.md`・`git status`・node・ASC CLIの`--help`と`worktree-create`・`TMPDIR`への書込みが成功、目印・runs rootの別の項目`probe-sibling/record.txt`（probeの前に作る）・試行の`settings.json`・fixture・台帳・`denyReadRoots`の各項目の読取り、試行のdirectoryとrepositoryへの`touch`、通信が拒否）を足した。`probeContext`は水準を受け取り、confinedの水準だけ`siblingRecord`・`deniedRoots`を加える。判定は`probe-check.mjs`の水準Xの項目（#1820の段階1から残っていたもの）を使う。
- `meta.json`（confinedの水準だけ）：`sandboxLayout`、`nodeVersion`、`endHead`（Bashはcommitできる）、`workFilesOptions`（`make-fixture.mjs`の`workChanges`の`base`：開始のHEADからのcommitの変更も含める、`worktrees`：`.git`がfileのdirectory（linked worktree）はその中の変更だけを列挙する）。`collect.mjs`は、`workFilesOptions`のある試行では`work/`のHEADが`endHead`であることと、同じoptionsでの`workFiles`の一致を確かめ、変更・作成されたfileを書いたfileとして採点に渡す（`changedFiles`）。
- `score.mjs`（`level.sandbox`の水準だけ）：成功したBashの読むcommandの引数を読込みに数える（`bashReadsOf`・`bashReadPaths`。数え方と数えないものは`score.mjs`の注記）。`cases.json`の`expectCommands`（成功したBashのcommandに合う正規表現。指標`commandsAll`）と、`report.commands`（試みたか、成功したか）を加えた。書いたfile（`writtenFiles`）は、toolの書込みに`changedFiles`を足したもの。
- `dry-run.mjs`：起動の引数とprobeの操作の数を、各条件の水準で確かめる（従来はWに固定）。confinedの水準には`confinedLayout`の項目を加えた。
- `sandbox-check.mjs`（固定しないtool）：probeと同じ配置を作り、`isolationSettings`の読取り・書込みの規則を公開のsandbox runtime（`@anthropic-ai/sandbox-runtime`）に渡して、probeのBashの操作をモデルなしで実行する。Claude Codeの本体のruntimeでの確認ではないので、probeの代わりにしない。

## 変更するとき

- 測定の途中（固定の記録の後）に変えない。固定の記録はmoduleのsha256も持つので、変えるとその測定の`run-trial.mjs`と`judge.mjs`が拒否する。
- 変える場合は、試験を加え、測定中の設定が無いことを確かめる。Issue固有の値はmoduleに書かず、設定のfieldとして加える。
