# 共通の測定の仕組み（shared harness）

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。

「ASCのSkillが、書込みのtoolがある利用者同等の隔離した環境で読まれ、適用されるか」を測る仕組みを1つにまとめたもの。#1820の段階2のharness（`docs/evidence/1820-write-tools-read/stage2/harness/`）を一度だけ写し、Issueごとの値を設定のdirectoryから読む形にした（#1823、ownerの決定）。**以後の測定は、Issueごとに設定のdirectoryだけを置き、この仕組みを写さない。**

## 画面デザインの評価（#1835）

画面デザインを評価者（Fable・Codex）に比べさせる測定は、この仕組みとは別の手順で行う。3層（層1：機械判定の下限、層2：既知の劣化による評価者の校正、層3：ownerの盲検の一対比較）を総合点にまとめずに報告する。手順・道具・結果は[1835-design-eval-layers](../1835-design-eval-layers/README.md)にある。#1835では、画面を並べて見せる一対比較が既知の劣化を最もよく見分け、講評を点にする方式は、FLRが不採用、SSRはこの形（ペルソナ無し・画面ごとの講評1件）では不採用だった（論文の形のSSRは未判定）。道具はこのdirectoryへ移していない。良い案どうしの比較では、一対比較もownerとの一致が両評価者で偶然と区別できず、使わないと決めた（[#1852](../1852-p-good-pairs/README.md)）。

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

- `run-trial.mjs`の`confinedSettings`（`sandbox.layout: "confined"`）：`allowRead`を使わない`--settings`。#1820の段階1の水準Xは、`--settings`の`allowRead`が同じ`--settings`の`denyRead`を開け直さず（Claude Code 2.1.323）、`work/`を読めずに不合格だった。この配置では、`work/`と試行の`tmp/`の祖先を禁止しない。読取りと書込みを禁じる（`denyRead`と`denyWrite`の両方に入れる）のは、`/Users`、`denyReadRoots`、fixture、台帳のdirectory、runs rootの他の項目（起動時に列挙）、runs rootの親と祖父の他の項目、試行の記録のfile（`TRIAL_RECORD_FILES`）。書込みは、試行の`home/`・`config/`・`bin/`も禁じる。runs rootそのものや`/private/var/tmp`等、`work/`の祖先は禁止できないので、そこへの書込みはClaude Codeのsandboxの書込みの許可に任され、probeで確かめる（下の2回目のレビューM-a）。禁止が`work/`か`tmp/`を覆う配置（例：runs rootが`/private/tmp`の下で、`/private/tmp`を禁じる）は、予約の前に拒否する。
- `trialEnv`：Claude Codeの一時directory（`CLAUDE_CODE_TMPDIR`。sandboxの中の`TMPDIR`）を試行の`tmp/`にし、Bashの`PATH`を試行の`bin/`（`copyNode`：harnessのnodeの写し。起動の前に1回実行する）と`pathDirs`だけにする。`claude`はharnessの`PATH`から絶対pathで起動する。試行の後に`bin/`と`tmp/`を消す。
- probe（`probeSteps('X')`、`bashProbeSteps`）：Wの6操作に、Bashの操作（`work/`の中の書込み・`cat CLAUDE.md`・`git status`・node・ASC CLIの`--help`と`worktree-create`・`TMPDIR`への書込みが成功、目印・runs rootの別の項目`probe-sibling/record.txt`（probeの前に作る）・試行の`settings.json`・fixture・台帳・`denyReadRoots`の各項目の読取り、試行のdirectoryとrepositoryへの`touch`、通信が拒否）を足した。`probeContext`は水準を受け取り、confinedの水準だけ`siblingRecord`・`deniedRoots`を加える。判定は`probe-check.mjs`の水準Xの項目（#1820の段階1から残っていたもの）を使う。
- `meta.json`（confinedの水準だけ）：`sandboxLayout`、`nodeVersion`、`endHead`（Bashはcommitできる）、`workFilesOptions`（`make-fixture.mjs`の`workChanges`の`base`：開始のHEADからのcommitの変更も含める、`worktrees`：`.git`がfileのdirectory（linked worktree）はその中の変更だけを列挙する）。`collect.mjs`は、`workFilesOptions`のある試行では`work/`のHEADが`endHead`であることと、同じoptionsでの`workFiles`の一致を確かめ、変更・作成されたfileを書いたfileとして採点に渡す（`changedFiles`）。
- `score.mjs`（`level.sandbox`の水準だけ）：成功したBashの読むcommandの引数を読込みに数える（`bashReadsOf`・`bashReadPaths`。数え方と数えないものは`score.mjs`の注記）。`cases.json`の`expectCommands`（成功したBashのcommandに合う正規表現。指標`commandsAll`）と、`report.commands`（試みたか、成功したか）を加えた。書いたfile（`writtenFiles`）は、toolの書込みに`changedFiles`を足したもの。
- `dry-run.mjs`：起動の引数とprobeの操作の数を、各条件の水準で確かめる（従来はWに固定）。confinedの水準には`confinedLayout`の項目を加えた。
- `sandbox-check.mjs`（固定しないtool）：probeと同じ配置を作り、`isolationSettings`の読取り・書込みの規則を公開のsandbox runtime（`@anthropic-ai/sandbox-runtime`）に渡して、probeのBashの操作をモデルなしで実行する。Claude Codeの本体のruntimeでの確認ではないので、probeの代わりにしない。

### #1844の独立レビューの是正（2026-11-28）

いずれも`level.sandbox`の水準（confined）か、新しい設定のfieldがある場合だけ動く。水準Wと既存の設定の結果は変わらない（試験で確かめる）。

- H1（`score.mjs`の`commandRan`）：`expectCommands`・`report.commands`の項目に`exclude`（除くcommand）と`resultPattern`（結果の本文に要るもの）を加えた。pipelineの終了codeは最後のcommandのものなので、`start`は出力のJSONのschemaが結果にある場合だけ「実行した」。`report.commands`に`exitOk`（終了code 0）を加えた。
- M1（`bashScan`・`bashTraceReads`・`projectFilesOf`）：Bashの読込みを2通りに数える。strict（期待する読込み）：読むcommandのfileの引数（検索のpattern・sed等のscriptを除く）、`-f FILE`、`<`、`git show <rev>:<path>`、前の呼出しから引き継いだ`cd`。possible（禁止する読込み）：結果のある全ての呼出しについて、globと検索したdirectoryをfixtureのHEAD・変更したfile・各worktreeのfileに展開し、中身の分からない出力（`git show <rev>`等）は全てを読んだとし、項目の`bashMention`がcommandの文字列に合えば読んだとする。`caseChecks`は`forbiddenReads`にpossibleを、`forbiddenReadsStrict`にstrictを示す。`collect.mjs`は`.worktrees/`の名前を渡す。
- M2（`indirectProbeSteps`、`probe-check.mjs`の`refusalKind`・`sandboxRefusal`）：symlink（BashとRead）、hard link、`node -e`、`sh -c '$0'`、変数で組み立てたpath、認証情報の長さをprobeに加えた。拒否の主体（sandbox／許可の確認／その他）を記録し、pathが文字列に無い操作はsandboxの拒否の文を要る。`expect: "any"`は記録だけ。
- M3（`run-trial.mjs`の`credentialLeakOf`）：試行の後、消す前に、試行のdirectory（`home/`・`config/`を除く）、`work/`のgitのobject、置き換えた記録の`<credential>`を調べる。漏れがあれば測定の試行は`work/`を消して`collect.mjs`で失敗（`credential leak`）、probeは`credentialNotLeaked`で不合格。`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`は許可のmodeを`default`に強制するので使わない。
- L1（`confinedSettings`）：runs rootの親と祖父の他の項目も禁止する（深さ3以上のdirectoryだけ列挙）。
- L2（`make-fixture.mjs`の`unreachedChanges`、`workChanges`）：HEADも残ったworktreeも届かないcommit（`git rev-list --all --reflog`）とそのfileを`meta.json`の`unreached`に記録し、`score.mjs`はpathPatternの下のそのfileを「書いたが照合できない」（`writeUnreached`、`writeMissingText`）にする。`worktrees`のoptionでは、入れ子のrepositoryの`.git`を1項目にする。
- L3（`levelsVerdict`）：`rule.minProvisional`があれば、判定に`minProvisional`と`verdictBasis`を付ける。

### #1844の2回目の独立レビューの是正（2026-11-28）

いずれも`level.sandbox`の水準か、新しい項目（probeの操作の`notMissing`・`outputPattern`、`meta.json`の`workFilesOptions`、行の`forbiddenReadsBy`）がある場合だけ動く。水準Wと既存の設定の結果は変わらない（試験で確かめる）。

- M-a（`confinedSettings`、`outsideProbeSteps`、`probe-check.mjs`の`outsideWritesAbsent`）：`/Users`と`denyReadRoots`を`denyWrite`にも入れた。probeに、`/private/tmp/claude-<uid>/`・runs root・`/private/var/tmp/`への`touch`（変数で組み立てたpath、sandboxの拒否を要る）を加え、probeの後にそのfileが無いことを確かめる。
- M-b（`indirectProbeSteps`、`refusedNotMissing`）：`lnSymlinkHome`は成功を要る。`catSymlinkHome`はsandboxの拒否を要る。symlinkのReadは、拒否が「fileが無い」（`refusalKind`の`other`）でないことを要る。
- M-c（`outsideProbeSteps`、`probeStepOutputs`）：keychainの検索（既定の検索先と実userの`login.keychain-db`）、`pbpaste`、`ps`を、終了codeか数だけを出す形でprobeに加えた。操作の`outputPattern`に結果の最初の行が合うことを要る。`sandbox-check.mjs`は、この操作をsandboxなしでも実行して`baseline`に記録する。
- L-a（`score.mjs`の`bashScan`・`bashTraceReads`）：標準出力を`/dev/null`へ流した読込み、`grep -q`・`-c`・`-l`・`-L`等、fixtureにも変更にも無いpath（`existing`。`scoreRun`はfixtureのfileが分かるときに使う）は、厳しい数え方の読込みにしない（広い数え方には残す）。
- L-b（`forbiddenReadsBy`、`levelChecks`の`breakdown`）：禁止の読込みが、どの数え方（strict・possible・unbounded・mention）で見つかったかを行に記録し、`forbidReadsOk`の水準に、strictで合格した数と、unboundedだけ・mentionだけで落ちた数を並べる（判定には使わない）。
- L-c（`make-fixture.mjs`の`headReader(work, rev)`、`collect.mjs`）：`workFilesOptions`のある試行は、試行の前のfileを`meta.json`の`sampleHead`で読む（Bashはcommitできるため）。
- L-d・L-e：設定のREADMEの記述を直し、認証情報の検査の範囲（64MB以上のfile、入れ子のrepositoryの圧縮object）を「限界」に書いた。

### PR #1857のCodeRabbitのレビューの是正（2026-11-28）

#1844の測定は終わっている（未判定。15試行は行っていない）。次の直しは、#1844の記録した結果を変えない：probeの指示の文は同じ（pathに空白等が無いので、引用の直しは文字を変えない）で、`R-probe-2`を作り直した照合（`recheckProbe`）は直す前と一致した。採点（`score.mjs`）は測定の試行が無いので使っていない。#1844の照合は、`results/fixation.json`の`fixedAtCommit`の共通の仕組みで行う（上の#1845と同じ扱い）。

- `score.mjs`：`||`の後の部分（`;`か改行まで）の読込みは広い数え方だけにし、そこの`cd`は作業directoryを不明にする。`git -C <dir>`は、そのcommandの中だけ`<dir>`からpathを解く。失敗した呼出しは、`cd`だけなら前の作業directoryを保ち、`cd`と他のcommandなら不明にする。正規表現にできないglob（`[z-a]`）は、bashと同じく何にも合わないとする（`unbounded`に数えない。採点を止めない）。`||`の後の`sh -c`の中の読込みも広い数え方だけにする。`git -C`の先が変数等で不明なら、`<rev>:<path>`は広い数え方だけにする。失敗した呼出しが`cd`を2つ以上含む（`cd src && cd nope`）なら、作業directoryを不明にする。`markerBase`は、linked worktreeに書いたfile（`.worktrees/<name>/<rel>`）にもfixtureのHEADの`<rel>`の旧版を使う。
- `collect.mjs`：`.worktrees`が通常のfileなら、worktreeの一覧を空にする。
- `run-trial.mjs`：`claude`の実行fileを、試行のdirectoryと台帳の予約の前に探す。置き換えた`debug.log`も`<credential>`の検査に渡す。認証情報の検査で読めないfileとdirectoryは、それぞれ`credentialUnreadable`として漏れに数え、検査を続ける。検査自体の失敗は`credentialCheckError`として漏れに数え、probeでも`work/`を丸ごと消す（どちらも従来どおり隔離して精算する。読めないdirectoryも権限を戻して消す）。`probe-check.mjs`の`credentialNotLeaked`の詳細は、この2つが記録されていれば`unreadable`・`checkError`として示す（記録の無い#1844のprobeの詳細は変わらない）。probeの終わりの目印・`work/`の中のfile・試行の外への書込みの有無を`meta.json`の`probeEndState`に記録し、`probe-check.mjs`はそれで判定する（その記録の無い以前のprobeは、従来どおり判定の時点のfileを見る）。probeのBashのpathの引数は1語として引用する（`shq`。`sandbox-check.mjs`も同じ）。
- 試験：祖父のdirectoryを列挙する試験は、`os.tmpdir()`が`/tmp`でも深さ3以上になるよう1階層深くした。

#### #1866（この仕組みと設定を使う次の測定）へ引き継ぐこと

（#1866で対応した：L8は#1866の設定のREADMEの「モデルを呼ばない確認」、L9と`commandRan`は下の「#1866で加えたもの」。L2・L6の限界は残る。）

- 既知の限界（L2）：`||`の条件は`;`か改行で解けるので、`false || { cat a.md; cat b.md; }`や`if … then … fi`の中では、`b.md`を厳しい数え方に数える（期待する読込みの偽陽性の方向）。
- 既知の限界（L6）：`probe-check.mjs`の`stepPathsOf`・`isProbeStepLine`のpathは空白で止まり、`unquote`は`'\''`の`\`を残す。空白や`'`を含むpathのprobeは不合格の方向に外れる（#1844のpathには無い）。probeのpathにそれらを使うなら、先に`shq`と揃える。
- 確認（L8）：`debug.log`を認証情報の検査に加えた影響は、#1844の照合（記録済みの`credentialLeak`を使う）では確かめていない。#1866のprobeの前に、Claude Codeの`debug.log`に認証情報が通常から現れないかを1回確かめる（現れるなら全probeが誤って不合格になる）。
- 限界（L9）：`run-trial.mjs`の`main`の配線（`debug.log`を検査に渡すこと、`claude`を予約の前に探すこと、`probeEndState`の記録）の試験は、sourceの文字列の照合にとどまる。#1866で`main`を変えるなら、実際の実行で確かめる試験を足す。
- `cases.json`の`expectCommands`・`report.commands`（`commandRan`）は、Bashの呼出し全体の文字列に`pattern`を、結果全体に`resultPattern`を当てる。引用した文（`echo 'asc-v05.mjs start …'`）と、保存した`start`のJSONの表示を1つの呼出しで行うと、`start`を実行しなくても「実行した」に数えられる。#1844では測定の試行が無いので結果に影響しない。#1866で`start`の実行を指標にするなら、測定の前に、command（`node <asc-v05.mjs> start`の部分）と、その出力に結び付けて判定する形を加え、試験を足す（設定の`pattern`は引用したpathも許すので、引用した文を除くだけでは足りない）。

### PR #1857の再レビューの是正（2026-11-28）

#1844の記録した結果は変えない（測定の試行が無く、#1844のprobeの`meta.json`には`probeEndState`も`credentialCleanupErrors`も無い）。

- M-1（`run-trial.mjs`の`removeCredentialCopies`・`removeAll`・`removeTree`）：認証情報の写しの削除は項目ごとに行い、1件が失敗しても残りを続け、失敗を`meta.json`の`credentialCleanupErrors`に記録する。`removeTree(p, root)`は、`root`（試行のdirectory）から`p`までのdirectoryに所有者の権限を戻してから消す（`chmod 500`のdirectoryの中のfileも消せる）。測定の試行も、`work/`に加えて`tmp/`と、記録された`work/`の外の項目を消す。試行の終わりの`finally`は`home/`・`config/`・`bin/`・`tmp/`を`removeAll`で消し、失敗しても台帳のlockを必ず解いて、消せなかったpathを標準エラーに出し終了codeを1にする（`meta.json`は精算の後なので書き足さない）。
- M-2（`score.mjs`の`bashScan`）：作業directoryが不明なとき、深く検索するdirectoryの引数（`grep -r x .`、`grep -r x rules`、`rg x`、`find … -exec`、`git -C "$W" grep x`）と、`..`を含むpath・`.`そのものは`unbounded`（全てを読んだ）に数える。禁止の読込みの偽陰性を作らない方向で、期待する読込み（strict）は増やさない。作業directoryが分かるときと、不明なときの通常のpathの末尾の照合は従来どおり。
- L-1：試行のdirectoryそのものが読めない（`credentialUnreadable`に`'.'`）ときは、probeでも`work/`と`tmp/`を丸ごと消し、`workRemoved`に`trial directory unreadable`と記録する。
- L-2：`removeTree`は、試行のdirectoryの外のpathと、途中にsymlinkがあるpathを拒否する（失敗として記録し、外の権限を変えない）。残る限界：途中のdirectoryを調べてから消すまでの間にsymlinkへ差し替えられる競合は残る（Claude Codeの終了の後に子processが残る場合だけ。#1866で`main`を実際に動かす試験を足すときに確かめる）。
- L-3：`probeEndState`はprobeなら水準Wでも記録され、Wの`sentinelsAbsent`も試行の終わりの記録で判定する（判定の結果は判定の時点のfileで見る場合と実質同じ）。上の「水準Wと既存の設定の結果は変わらない」は、このfieldの無い記録（#1844と既存のW）についての記述である。
- L-4（`probe-check.mjs`の`fileInputs`）：`work/`を丸ごと消したprobeも読み、不合格として判定する（`work/`が無ければSkillの一覧は空）。`credentialNotLeaked`の詳細に、記録があれば`cleanupErrors`・`workRemoved`を示す。

## #1858で加えたもの（2026-11-28）

#1846の測定（PR #1850）で見つかった2点と、#1843の測定で見つかった経緯の目印の誤検出を、次の設定から使える形で直した。どちらも、そのfieldの無い設定（試験用、#1823、#1840、#1843、#1844、#1846）の採点と判定を変えない。

### 文ごとの照合（`sentenceWith`・`sentenceUnless`）

減点の目印（`cases.json`の`answerNone`の`{id, pattern}`）と、書いたfileの禁止（`writes.forbid`・`writesReport.forbid`）の項目に、次の2つのfieldを足せる。どちらかがあると、`pattern`を文ごとに当て、条件を満たす文が1つでもあれば当たったとする（`score.mjs`の`entryMatches`）。どちらも無い項目と文字列だけの項目は、従来どおり全文に当てる。

- `sentenceUnless`：`pattern`に当たった箇所を囲む文がこの照合にも当たれば、その箇所を数えない。約束しないと述べた文の中の引用（「今は『無償で直します』とも『有償です』とも答えません。」）を除くのに使う。括弧の中の文章は、その中でさらに文に分ける。囲む文とは、当たった箇所のある括弧の中の文と、その括弧を引用している外側の文である。それぞれの文の、さらに内側の括弧の中は見ない。このため、返信の案（「返信案：「原因はまだお答えしません。無償で直します。」」）では、否定は別の文にあり、約束は数える。
- `sentenceWith`：同じ文がこの照合にも当たるときだけ数える。経緯の文（「以前はメールアドレスだけだった。」）だけを数え、現在の事実の文（「選択中のタブの入力欄だけを表示する。」）を数えないのに使う。

文は、改行と、括弧（「」『』（））の外の「。」「．」「！」「？」「!」「?」と、後ろが空白か末尾の「.」（英文。`1.1`や`a.ts`では区切らない）で区切る（`sentencesOf`）。括弧は種類を区別せずに深さだけを数える（「…）でも閉じる）。返信の案を括弧で囲んだ文（「『無償で直します』とお返事します。」「「無償で直します。」とお返事します。」）は、引用した文と1つの文になり、`sentenceUnless`に当たらなければ数える。括弧の深さは改行で戻す。閉じない括弧は、行の終わりまでを括弧の中として文に分ける。半角の`"`は括弧に数えない（`"…。"`の中でも区切る）。`scope: "code"`の項目は、JavaScript・TypeScriptのfileでは、先にコードだけを取り出し、行ごとに1つの文とする（コードの`!`・`?`・`.`では区切らない。`a !== b`・`a ? b : c`・`a?.b`・`1.1`）。`sentenceWith`・`sentenceUnless`は空でない文字列で、正規表現として作れなければならない（`dry-run.mjs`の`sentenceFields`の検査が拒否する。空の`sentenceUnless`はすべての文に当たり、その項目を黙って無効にするため）。必須の項目（`writes.require`・`writesReport.require`）は全文に当てるので、このfieldを書くと同じ検査が拒否する。`calibrate.mjs`の雛形の当たり（`templateHits`）も、雛形の行を同じ照合（`entryMatches`）で数える。

書き方の例（#1846・#1843の設定は書き換えない。次の設定で使う）：

```json
{"id": "free-before-check", "pattern": "無償で(修補|修正|対応|直)(いた)?します|無償(修補|対応)の対象です",
 "sentenceUnless": "(答え|お答えし|約束し|お約束し|言い|申し上げ|お伝えし)ません"}
{"id": "history-only", "pattern": "入力欄だけ|メールアドレスだけ", "group": "history",
 "sentenceWith": "以前|変更前|これまで|だった|でした|していた|から変更|に変更"}
```

限界：除くか数えるかは文の単位で決まる。`sentenceUnless`は、囲む文のどこに当たっても、その中の箇所を除く。1つの文で、ある約束を引用して否定しながら別の約束をする（「『有償です』とは言いませんが、無償で直します。」）と、`sentenceUnless`はその文ごと除く（数え漏れの方向）。`sentenceUnless`は否定の言い方に絞り、測定の前に、その設定の想定する回答の例で試験する。上の例の`sentenceWith`の`だった|でした`も、現在の仕様の文（「入力欄だけが空だった場合はエラーを表示する。」）に当たる。`sentenceWith`も、想定する回答の例（経緯の文と現在の事実の文の両方）で試してから使う。

### 条件が1つの設定

実装者の選択：**条件が1つの設定も判定する**（dry runで拒否する方ではない）。理由：固定の水準の規則（`rule.mode`が`levels`）は条件ごとに水準を当てるので、1つの条件だけで判定でき、#1846と同じ形の測定（候補を1つ、比較の基準は別の固定の結果）を今後も行えるため。

- `judge.mjs`の`judgeScored`（`judgeRun`から呼ぶ）は、`conditions.json`の`cells`の条件だけを使う。条件が1つなら、存在しない2つ目の条件を作らず、全体の判定（`verdict`が`levels`か`not-judged`）と`perCondition`は、その条件の試行だけから出す。判定しない理由（`reason`）は、その条件の理由を1回ずつ示す（`verdictOf`は同じ理由を重ねない）。`subsets`がある設定では、各subsetの`separate`はその条件の集計だけを示し、比べる検査（`checks`）を作らない。
- 候補と基準を比べる規則（`rule.mode`の無い設定）は、条件がちょうど2つでないと判定できない。`levels`も、条件が0か3つ以上なら判定しない。`score.mjs`の`conditionCountProblems`がこれを示し、`dry-run.mjs`は`conditionCount`の検査で、`judge.mjs`は判定の前に、理由を示して拒否する。
- 条件が2つの設定の判定は変わらない（試験で、`levelsVerdict`・`verdictOf`を直接呼んだ結果と一致することと、#1823（比べる規則）・#1840・#1843（`levels`）の公開した`runs.json`と`judge.json`の`completion`から作り直した判定が、公開した`judge.json`と一致することを確かめる）。

### 既存の記録への影響（2026-11-28に確かめた）

- #1840・#1843・#1846の設定と記録（`cases.json`・`conditions.json`・`judge.json`・`runs.json`等）は変えていない。#1846の結果は再判定しない。
- 各`results/fixation.json`の最後の`fixedAtCommit`の共通の仕組み（#1840は`93b200e8`、#1843は`9d6e55f5`、#1846は`3e358c13`。`git archive`で取り出したもの）で`fixation.mjs check`を行い、3つとも`ok`（差なし）だった。この変更の共通の仕組みで行うと、moduleの差（`collect`・`judge`・`make-fixture`・`order`・`probe-check`・`run-trial`・`score`）を示す。測定の後の変更であり、上の#1845と同じ扱いである。
- 条件が2つの#1823・#1840・#1843は、公開した`runs.json`と`judge.json`の`completion`から、この変更の`judgeScored`で作り直した判定と条件の集計が、公開した`judge.json`と一致した（`test/harness.test.mjs`の試験で再確認できる）。

## #1861で加えたもの（2026-11-28）

- `claude-sandbox-bash.mjs`：モデルを呼ばずに、Claude Code本体のBash toolに、そのsandboxの中で1 commandずつ実行させる。`ANTHROPIC_BASE_URL`を127.0.0.1の代役（各turnにBashのtool_useを1つ返す）へ向け、API keyはダミーにするので、要求はAnthropicへ届かない。結果は各commandのtool_result（`result.json`）。環境は`env -i`から作り、HOMEは試験用のものだけを受け付ける。設定は試験用のHOMEの`.claude/settings.json`か、`--`の後の`--settings`で渡す。測定の固定の記録が持つmoduleではなく、既存のmoduleは変えていない。使い方と記録は[1861-sandbox-worktree-create](../1861-sandbox-worktree-create/README.md)。対話画面のBash mode（`!command`）はsandboxの外で動くので、この目的には使えない（Claude Code 2.1.323）。

## #1866で加えたもの（2026-11-28）

#1866の測定の前提（PR #1857の最後の再レビューのM-A・L-A・L-B、PR #1864のLow 2件、PR #1873のLow 2件、上の「#1866へ引き継ぐこと」）を直し、試行の前に作るworktreeを加えた。新しいfield（`extends`、`priorSpend`の一覧、`sandbox.startWorktree`、`meta.json`の`startDir`）の無い設定（試験用、#1823、#1840、#1843、#1844、#1846）の起動・採点・判定は、下の「既存の記録への影響」の点を除いて変えない（試験で確かめる）。

- **設定の土台**（`config.mjs`の`baseDirOf`・`mergeConditions`・`cfgPath`・`readCfg`）：`conditions.json`の`extends`（設定からの相対のdirectory。harnessの外、`conditions.json`があり、それ自身は`extends`を持たない）で、別の設定を写さずに使う。`conditions.json`は土台のものに自分のものを重ねる（objectは項目ごと、それ以外（配列を含む）は置き換え、`null`は項目を消す）。他の設定file（`cases.json`・`run-order.json`・`release.json`・`decision-criteria.md`・`calibration.json`）は、自分に無ければ土台のものを読む。`README.md`と`results/`は常に自分のもの。`fixation.mjs`の`fixedNames`は、`config/<file>`（読んだとおりのfile）に加えて`base/<file>`（土台の5file）を固定する。
- **`priorSpend`の一覧**（`run-trial.mjs`の`priorSpendEntries`・`priorSpentUsd`・`priorSpendProblems`）：以前の段階の台帳を複数書ける（#1844の2つの台帳）。各台帳のsha256と合計を確かめ、合計を引いた残りを上限にする。1つのobjectの形は従来どおり。`priorProbes`は1つの台帳だけと組む（同じ測定の固定のやり直し）。
- **試行の前のworktree**（`toolLevels.<id>.sandbox.startWorktree {issue, type, slug}`、`run-trial.mjs`の`startWorktreeProblems`・`createStartWorktree`）：中立のcommitの後、台帳の予約の前に、導入されたASC CLIの`worktree-create <work> <issue> <type> <slug> HEAD`をsandboxの外で実行し（#1861の支持する手順。modelは実行しない）、Claude Codeをそのworktreeで起動する（cwd、trustの項目）。失敗すれば予約の前に拒否する。`meta.json`に`startDir`（`.worktrees/<名前>`）と`startWorktree`（branch・base・終わりのHEAD）を記録し、`collect.mjs`は`startDir`を採点へ渡す。sandboxの配置（`confinedSettings`）は変えない。
- **probeの置き換え**（`probeContext`の`startDir`・`probeWorktree`、`bashProbeSteps`、`probeEndStateOf`・`worktreeCreateLeftOf`、`probe-check.mjs`の`probeStepResultText`・`worktreeCreateStopped`）：`startWorktree`の水準では、`insideWorktreeCreate`（成功を要る）を`insideWorktreeCreateStops`（同じcommandが拒否され、結果に`Git worktree records are not writable`がある）に置き換え、probeの終わりに`test/<tag>-probe`のbranch、`-<tag>-probe`で終わる`.worktrees/`の下のdirectory、他のGitのworktreeが無いことを記録して判定する。操作の数は変わらない。symlinkのReadと`insideWrite`のfileは起動したworktreeの中、`cwd`の確認は起動したworktreeとの照合になる。`startDir`の無い#1844のprobeは、操作も判定も変わらない（`recheckProbe`の結果も同じ）。
- **採点の起点**（`score.mjs`の`scoreRun`の`startDir`、`bashTraceReads`の`startCwd`）：sessionのcwdが起動したworktreeでも、pathはproject（`work/`）からの相対で数える。Bashはworktreeから始まり、worktreeの外で終わった`cd`は次の呼出しでworktreeに戻る。sessionのcwdが`startDir`でなければ、その試行は失敗にする。
- **M-A**（`bashTraceReads`、`MAX_CWD_CANDIDATES`）：失敗した呼出しが`cd`を1つと他のcommandを含むなら、作業directoryを「前の値」と「`cd`の先」の候補にし、後の呼出しを各候補から数える：厳しい数え方はすべての候補で見つかった読込みだけ、広い数え方はどれかの候補で見つかった読込み、`unbounded`はどれかの候補で（既知の候補からの深い検索は展開する）。`cd`が2つ以上、計算した先、`||`の後の`cd`、候補が8を超える場合は従来どおり不明（`null`）。
- **`commandRan`の結び付け**（`score.mjs`の`boundCommandRan`。上の引継ぎの最後の項）：`resultPattern`のある項目は、`pattern`がcommandの部分のprogramとして実行されたこと（環境変数・wrapper・`node`とそのoptionの後の最初の語で一致が始まる。`node -e`・引用した文・here-documentは数えない。標準出力をfileへ流した部分は数えない）と、同じ呼出しの他の部分が別の出力を出さないこと（前後には`cd`・`export`・`set`・`true`・`echo`/`printf`（`resultPattern`に当たらない文字列）等だけ、pipelineの後ろにはfile引数の無いfilter（`head`・`grep`・`jq`等））を要る。`$(…)`・backquoteを含む呼出しは数えない。`resultPattern`の無い項目は従来どおり。
- **L-A**（`removeCredentialCopies`）：probeで`work`か`tmp`そのものが読めない（`credentialUnreadable`）なら、`work/`と`tmp/`を丸ごと消し、`workRemoved`に`work/ unreadable`・`tmp/ unreadable`と記録する。
- **L-B**（`recordCleanupLeft`、`CLEANUP_LEFT_FILE`）：`finally`で消せなかったpathを、標準エラーに加えて試行のdirectoryの`cleanup-left.txt`に追記する（精算の後。記録のfileではない）。
- **PR #1864のLow**（`claude-sandbox-bash.mjs`の`realish`・`resolveLinkTarget`、`runInClaudeSandbox`）：壊れたlinkの先は、linkのdirectoryの実pathから成分ごとに解く（`..`は辿り着いた実directoryから上がり、途中のlinkは辿る）。`--config-dir`の中の項目（`settings.json`・`.claude.json`・`CLAUDE.md`とあるものすべて）も実HOMEの外であることを確かめる。
- **PR #1873のLow**（`score.mjs`の`sentenceFieldProblems`・`sentenceHasMatch`）：`answerNone`・`writes.forbid`・`writesReport.forbid`以外（`answerQuota.groups`、`expectReads`、`report`の項目、cases.jsonの上の階層等）に書いた`sentenceWith`・`sentenceUnless`は、黙って無視せず問題として示す（`dry-run.mjs`の`sentenceFields`が拒否する）。文のfieldのある項目の`pattern`が空の文字列に当たるなら問題とする。空の一致が文の末尾にあっても例外を投げない（最後の文字の単位に属するとする）。
- `dry-run.mjs`：`startWorktree`の水準では、中立のcommitの後の写しで`createStartWorktree`を実行し、HEAD・ASC CLI・`CLAUDE.md`・`context.json`がprojectと同じであることを確かめる（`startWorktree`）。`sandbox-check.mjs`：`startWorktree`の水準ではworktreeを作ってその中で実行し、srtには起動したworktreeと`tmp/`の書込みだけを許す（srtでは`work/.git`全体が書けないので、`worktree-create`が#1730の確認で止まる場合も合格にする）。
- 試験：上のそれぞれに加えて、`run-trial.mjs`の`main`を実際に動かす試験（引継ぎL9）：代役の`claude`（cwd・trustの項目を記録し、stream-jsonを出す）と代役のASC CLIで、`startWorktree`の水準のprobeを`--run`で実行し、worktreeが予約の前に作られ、sessionがそこで始まり、`meta.json`と`probeEndState`が記録され、`home/`等が消えることと、`worktree-create`が失敗すれば何も予約されないことを確かめる。

### 既存の記録への影響（2026-11-28）

- `commandRan`（`resultPattern`のある項目）と`bashTraceReads`（失敗した`cd`の後）は、定義が変わった。`resultPattern`は#1844の`cases.json`にだけあり、#1844には測定の試行が無い。失敗した`cd`の後の数え方は、#1844（試行なし）と水準Xだけで使われる。#1823・#1840・#1843・#1846の水準Wの採点は変わらない。
- `sentenceFieldProblems`は、既存の設定（#1840・#1843・#1844・#1846）で問題を示さない（試験）。
- #1844の設定と記録は変えていない。#1844のprobeの照合（`recheckProbe`）は、`meta.json`に`startDir`が無いので操作も判定も従来どおりである。これまでどおり、各測定の照合は`results/fixation.json`の`fixedAtCommit`の共通の仕組みで行う。

## 変更するとき

- 測定の途中（固定の記録の後）に変えない。固定の記録はmoduleのsha256も持つので、変えるとその測定の`run-trial.mjs`と`judge.mjs`が拒否する。
- 変える場合は、試験を加え、測定中の設定が無いことを確かめる。Issue固有の値はmoduleに書かず、設定のfieldとして加える。
