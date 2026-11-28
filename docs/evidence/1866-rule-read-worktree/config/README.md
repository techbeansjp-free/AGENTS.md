# 利用者が作ったworktreeでの固有ルールの読込み（#1866）：設定

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。測定の仕組みは共通のもの（[../../shared-harness/](../../shared-harness/)）を使い、このdirectoryには設定だけを置く。

**状態：準備（2026-11-28）。** モデルを呼ばない確認まで行った。固定（`fixation.mjs init`）・目印file・probe・測定はまだ行っていない。最初の固定のcommitは、固定のときにこのREADMEに書く（`run-trial.mjs`が照合する）。

## 目的

#1844の目的を引き継ぐ：利用者が`.agent-skill-chain/project/context.json`に登録した固有ルールが、該当するpathの変更で読まれるか。手順は#1861で決めたもの（利用者が自分のterminalで`worktree-create`を実行し、作られたworktreeでClaude Codeを起動する。`v05/USAGE.md`）に従う。判定の規則は#1844の[decision-criteria.md](../../1844-rule-read-bash/config/decision-criteria.md)をそのまま使う（ownerの決定、2026-11-28）。

## #1844の設定を写さずに使う

Issueは「#1844の設定を、このIssueのためにコピーすること」を禁じている。そこで共通の仕組みに、設定が別の設定を土台にする形（`conditions.json`の`extends`、`config.mjs`）を加えた。

- [conditions.json](conditions.json)は`extends: "../../1844-rule-read-bash/config"`で#1844の`conditions.json`を読み、このIssueで変える項目だけを書く（objectは項目ごとに重ね、`null`は項目を消す）。変える項目：Issue番号・目印の名前（`1866`）、説明の文、予算、水準Xの`sandbox.startWorktree`、条件の名前、`priorProbes`（消す）。
- `cases.json`・`run-order.json`・`decision-criteria.md`は#1844のものを読む（このdirectoryに置かない）。依頼文・採点の項目・水準・順序は#1844（つまり#1840の依頼文）と同じである。
- [release.json](release.json)・このREADME・`results/`はこのIssueのものである。
- 固定の記録（`fixation.mjs`）は、読んだとおりのfile（`config/<file>`。#1844のものを含む）と、土台のfile（`base/<file>`：#1844の5file）のsha256を持つ。固定の後に#1844の設定が変われば、`run-trial.mjs`と`judge.mjs`が拒否する。

## 条件と環境

- R：v0.5.133（PR #1864のworktree-createの確認と新しいmessageを含む最初のrelease。進行役の指定、2026-11-28）。tarballのsha256 `05cdf910…81cd`は、`SHA256SUMS`の行、releaseのassetのdigest、release notesのPackage SHA256と一致した（Source `4284bf95`、Verified PR #1864）。配布されるSkillはv0.5.128と同じ17件。2026-11-28T12:12:18Zにv0.5.134（#1873）がLatestになったが、v0.5.133との差は`docs/evidence`（配布されない）とversionだけである。#1844の`decision-criteria.md`は「測定の時点で最新のGitHub Release」と書くので、v0.5.134に替えるかはowner・進行役が固定の前に決める（替えるなら`release.json`だけを直し、dry runをやり直す）。
- 環境：#1844の水準X（W＋Bash、Bashは`confined`のsandboxの中だけ）、fixture U、認証は`CLAUDE_CODE_OAUTH_TOKEN`だけ。
- **試行の前のworktree**（`toolLevels.X.sandbox.startWorktree`、`run-trial.mjs`の`createStartWorktree`）：`run-trial.mjs`は、中立のcommitの後、台帳の予約の前に、導入されたASC CLIで`worktree-create <work> 1866 test trial HEAD`をsandboxの外で実行する（利用者が自分のterminalで行うのと同じ）。Claude Codeはそのworktree（`work/.worktrees/<YYYYMMDD_HHMMSS>-1866-trial`、branch `test/1866-trial`）で起動する（cwd、trustの項目）。sandboxの配置（`confinedSettings`）は#1844と同じで、`work/`の全体が読める。書込みはClaude Codeの許可（起動したworktreeと`CLAUDE_CODE_TMPDIR`、本体が許すそのworktreeのGitの記録）に任される。`worktree-create`が失敗すれば、予約の前に拒否する。`meta.json`に`startDir`・`startWorktree`（branch・base・試行の終わりのHEAD）を記録する。
- 採点：`score.mjs`の`scoreRun`は`startDir`を受け取り、pathは従来どおりproject（`work/`）からの相対で数える（worktreeのfileは`.worktrees/<名前>/<path>`、worktreeから`../../.agent-skill-chain/…`で読んだmain checkoutのfileはprojectのfile）。Bashはworktreeから始まり、worktreeの外で終わった`cd`は次の呼出しでworktreeに戻る（Claude Codeの動作）。

## probe（隔離の確認）

#1844の43操作のうち、`insideWorktreeCreate`（成功を要る）を`insideWorktreeCreateStops`に置き換えた（操作の数は43のまま）。

- 同じcommand（`node .agent-skill-chain/managed-runtime/bin/asc-v05.mjs worktree-create . 1866 test probe HEAD`）が拒否され（終了code 0でない）、すべての結果に`Git worktree records are not writable`があること（`probe-check.mjs`の`probeStepResultText`）。
- probeの終わりに、branch `test/1866-probe`が無く、projectとstartのworktreeの`.worktrees/`に`-1866-probe`で終わるdirectoryが無く、main checkoutと試行の前のworktree以外のGitのworktreeが無いこと（`meta.json`の`probeEndState.worktreeCreateLeft`、`probe-check.mjs`の`worktreeCreateStopped`）。
- symlinkの操作は起動したworktreeの中で行われるので、`readSymlinkHome`のRead先はそのworktreeの`probe-link-home.txt`である。`cwd`の確認は起動したworktreeと照合する。ほかの項目（目印を読めない、試行の外へ書けない、通信できない、認証情報が漏れない等）は#1844と同じ。
- probeは2回まで（1回のやり直し。ownerの決定）。#1844のprobeは#1844の台帳の下のもので、ここでは数えない（`priorProbes`なし）。

## 費用

- ownerの決定（2026-11-28、Issueのcomment 7236492574）：上限は#1844の割当ての残り約9.4 USD（10 − 0.58）。`ownerCapUsd` 10と、#1844の2つの台帳を`priorSpend`にして表す：台帳1（probe 1、0.3472675 USD、#1844が公開した`results/ledger-1.jsonl`）と台帳2（probe 2、0.2318255 USD、台帳`a48998d6`。#1844は公開していなかったので[results/prior/1844-ledger-2.jsonl](results/prior/1844-ledger-2.jsonl)に公開した。その`R-probe-2`のtrace・metaのsha256は#1844の公開した`probe-compare.json`と一致し、台帳のIDは#1844の`results/fixation.json`の台帳と一致する）。`capUsd` = floor((10 − 0.579093) × 100) / 100 = 9.42、余裕1、新しい台帳の停止の線8.42 USD。`priorSpend`を複数の台帳の一覧で書けるようにした（`run-trial.mjs`の`priorSpendEntries`）。
- 1試行の予算0.8 USD、probe 0.6 USD（#1844と同じ）。dry runの見込み3.86 USD（計画の単価で5.51 USD）、入力約292万トークン、出力約5.5万トークン。probeのやり直し（約0.4 USD）と置き換えがあっても停止の線の内に収まる見込み。

## モデルを呼ばない確認（2026-11-28）

いずれも費用0（モデルを呼ばない）。

1. **dry run**（`dry-run.mjs`、v0.5.133の本物のtarball、`--runs-root /var/tmp/r1866`）：19項目すべて合格。fixture Uに17件の入口と`claude-md`の採用、`cases.json`の`needs`、`startWorktree`（中立のcommitの後の写しで`worktree-create`がworktreeを作り、HEAD・ASC CLI・`CLAUDE.md`・`context.json`が同じ、branch `test/1866-trial`）、`priorSpend`（2つの台帳）、`budget`、`confinedLayout`、`runsRootTmpDir`、probe 43操作（`insideWorktreeCreateStops`を含む）。
2. **sandbox-check**（[sandbox-check.json](sandbox-check.json)、公開のsandbox runtime srt 0.0.83、Claude Code本体のruntimeではない）：50件すべて期待どおり。srtには書込みの許可（起動したworktreeと`tmp/`）だけを渡すので、`work/.git`全体が書けず、`worktree-create`は#1730の確認（`Git metadata is not writable`）で止まる（どちらの止まり方も合格にした。Claude Codeでは次の3のとおり新しいmessageで止まる）。worktreeでのcommitもsrtでは`index.lock`で失敗する（記録だけ。srtには本体のような「自分のworktreeの記録」の例外が無い）。何も残らなかった（branch・`.worktrees`・目印・試行の外のfile）。
3. **Claude Code本体のsandbox**（[claude-sandbox-check.json](claude-sandbox-check.json)、Claude Code 2.1.323、`claude-sandbox-bash.mjs`の代役のAPI、ダミーのkey）：
   - probeのBashの全36操作と追加の6操作を、`run-trial.mjs`と同じ関数で作った配置（試行の前のworktreeで起動、水準Xの`--settings`）で実行した。`worktree-create`は`Git worktree records are not writable: <runs-root>/R-probe-1/work/.git/worktrees (EPERM)`で止まり、branchも`.worktrees`も作らなかった。拒否されるべき操作はすべて拒否された（pathが文字列に無い操作はsandboxの拒否）。`start . --path src/billing/invoice.ts`は成功して`money.md`を選び、`../../`のmain checkoutの規則も読めた。main checkoutへの`touch`は拒否された。`ps`は許可の層の拒否（#1844と同じく合格に数える）。worktreeでのcommitは`git add`と`git commit`を別の呼出しにすると成功した（`git -c … commit`を1つの呼出しに繋ぐと、許可の層が承認を求めて止める）。
   - **`run-trial.mjs`の`main`そのもの**を、この設定の写し（scratch。固定と台帳も写しのもの）で`R-probe-1`として実行した。harnessの`PATH`の先頭に、本物の`claude`を代役のAPIへ向けるwrapperを置き、代役はprobeの指示文から操作を読み、1turnに1操作ずつ返した（44turn、60秒）。`probe-check.mjs`で、操作の項目（`probeStepsAttempted`・`Refused`・`Succeeded`・`sandboxRefusal`・`refusedNotMissing`・`probeStepOutputs`・`probeStepResultText`・`worktreeCreateStopped`・`outsideWritesAbsent`・`credentialNotLeaked`・`cwd`・`allowReadWork`・`sandboxInsideWrite`・`networkBlocked`等）はすべて合格した。不合格は、代役が質問に答えない5項目と、目印をrepositoryの外のscratchに置いたために生じた2項目（`debugPathsInsideTrial`・`noRealHomeOrRepoInDebug`：Writeの許可の提案の行が`<repo-root>/.agent-skill-chain/local`を示し、probeの操作の行と認められない。本番では目印がそのdirectoryにあり、#1844のR-probe-2では同じ行があっても合格した）だけだった。
   - **`debug.log`の認証情報**（PR #1857の引継ぎL8）：上の2つの実行の`debug.log`（約92KB）に、ダミーのkeyもその一部も無かった。本物のOAuth tokenでは、#1844のR-probe-1（110KB）とR-probe-2（49KB）の`debug.log`（tokenを`<credential>`に置き換えて保存したもの）に`<credential>`が0件だった。どちらも通常のlogに認証情報は現れない（全probeが誤って不合格になることは無い）。
   - Bashから見える認証情報の長さは、ダミーの`ANTHROPIC_API_KEY`では0だった（本体が子processの環境から除いている）。OAuth tokenの場合は#1844のprobeで記録される（`credentialVisibleToBash`）。

## 手順（進行役が行う。固定から）

```text
H=docs/evidence/shared-harness
EV=docs/evidence/1866-rule-read-worktree/config
ROOT=/private/var/tmp/asc-eval-1866
RUNS=/var/tmp/r1866          # <RUNS>/<試行>/tmp/claude-<uid>が44 byte以内（run-trial.mjs tmpDirProblem）
LEDGER=$ROOT/ledger/ledger-1866.jsonl
TGZ=<scratch>/rel133/agent-skill-chain-0.5.133.tgz   # gh release download v0.5.133 で取得し、sha256を照合する
# 1. 固定（台帳を作り、固定の記録をcommitし、最初の固定のcommitをこのREADMEに書いてcommitする）
node $H/fixation.mjs init $EV/results/fixation.json --ledger $LEDGER --config $EV
# 2. fixture
node $H/make-fixture.mjs R U $TGZ 05cdf910e657aa6ae1237aa18922dc1013d2ddb2162992c0a58ba5a86d2281cd $ROOT/fixtures/fixture-R-U $ROOT/tmp --config $EV
# 3. 隔離の確認（目印fileは確認の後に消す）。harnessはsandboxの外のshellで実行する
node $H/markers.mjs create <repo-root> --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/asc-eval/claude-oauth-token)" ASC_EVAL_ALLOW_PAID=1 node $H/run-trial.mjs $RUNS R probe 1 --fixture $ROOT/fixtures/fixture-R-U --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run --config $EV 2> $ROOT/run-trial-probe-1.stderr.txt
node $H/probe-check.mjs $RUNS/R-probe-1 R <home marker> <repo marker> <repo-root> --config $EV > $ROOT/probe-R-1.json
node $H/probe-check.mjs compare $ROOT/probe-R-1.json --out $RUNS/probe-compare.json --config $EV
node $H/probe-check.mjs publish $EV/results/probes $ROOT/probe-R-1.json $RUNS/probe-compare.json --home-marker <home marker> --repo-marker <repo marker> --repo-root <repo-root> --runs-root $RUNS --config $EV
node $H/markers.mjs remove <repo-root> --config $EV
# 4. 測定（probeが合格した場合だけ）
CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/asc-eval/claude-oauth-token)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs planned $RUNS --fixtures $ROOT/fixtures --ledger $LEDGER --run --config $EV 2> $ROOT/run-all.stderr.txt
CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/asc-eval/claude-oauth-token)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs replacements $RUNS --fixtures $ROOT/fixtures --ledger $LEDGER --run --config $EV 2>> $ROOT/run-all.stderr.txt
# 5. 公開する記録と判定
node $H/collect.mjs $RUNS $EV/results --ledger $LEDGER --config $EV
node $H/judge.mjs $EV/results --runs-root $RUNS --ledger $LEDGER --out $EV/results/judge.json --config $EV
```

- 目印fileとtoken fileの使用は、#1843・#1844・#1846と同じくownerが承認した（2026-11-28、Issueのcomment 7236492574）。[results/probe-approval.json](results/probe-approval.json)は固定の前に進行役が記録する（まだ置いていない）。
- 標準エラーは保存する。消せなかった`home/`・`config/`等は、試行のdirectoryの`cleanup-left.txt`にも残る（PR #1857の最後のレビューL-B）。
- モデルを呼ばない確認のやり直し：`node $H/sandbox-check.mjs <新しいdirectory> R $ROOT/fixtures/fixture-R-U <srtのdist/cli.js> <node 22以上> <repo-root> --out $EV/sandbox-check.json --config $EV`。

## 限界

#1844の[README](../../1844-rule-read-bash/config/README.md)の「限界」に加えて：

- 試行の前のworktreeは、harnessが`worktree-create`で作る。利用者が名前（Issue番号・slug）を選ぶ場面と、worktreeを作ってからClaude Codeを起動するまでの操作は測らない。依頼文は#1840のままで、worktreeの存在に触れない。
- main checkout（`work/`）はBashで読める（`confined`の配置）。worktreeの外のfileを読んだ場合も、projectのfileとして数える（`forbidReads`のpathは`.worktrees/<名前>/`の有無を問わない）。
- `start`の実行（`commandsAll`）は、commandとその出力を結び付けて数える（PR #1857の引継ぎ）：`start`がその部分のprogramとして実行され（引用した文や`node -e`の中の文字列は数えない）、同じ呼出しの他の部分が別の出力を出さない（`cd`・`echo`等の短いcommandと、`start`の出力を受けるfilterだけ）場合だけ数える。`$(…)`を含む呼出し、`sh -c`の中、変数で書いたCLIのpath（`node "$CLI" start`）は数えない（「実行しない」側に偏る）。
- 失敗した`cd …&& …`の後の作業directoryは、2つの候補（前の値と`cd`の先）で数える（PR #1857の最後のレビューM-A）。候補が8を超えるか、失敗した呼出しに`cd`が2つ以上あると不明として扱い、従来どおり深い検索は「全てを読んだ」（`unbounded`）になる。判定の前に`forbidReadsOk`の`breakdown.onlyUnbounded`を確かめる。
