# 共通の測定の仕組み（shared harness）

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。

「ASCのSkillが、書込みのtoolがある利用者同等の隔離した環境で読まれ、適用されるか」を測る仕組みを1つにまとめたもの。#1820の段階2のharness（`docs/evidence/1820-write-tools-read/stage2/harness/`）を一度だけ写し、Issueごとの値を設定のdirectoryから読む形にした（#1823、ownerの決定）。**以後の測定は、Issueごとに設定のdirectoryだけを置き、この仕組みを写さない。**

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

## 変更するとき

- 測定の途中（固定の記録の後）に変えない。固定の記録はmoduleのsha256も持つので、変えるとその測定の`run-trial.mjs`と`judge.mjs`が拒否する。
- 変える場合は、試験を加え、測定中の設定が無いことを確かめる。Issue固有の値はmoduleに書かず、設定のfieldとして加える。
