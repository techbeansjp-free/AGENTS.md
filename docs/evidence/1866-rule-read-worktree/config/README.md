# 利用者が作ったworktreeでの固有ルールの読込み（#1866）：設定

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。測定の仕組みは共通のもの（[../../shared-harness/](../../shared-harness/)）を使い、このdirectoryには設定だけを置く。

**状態：固定済み（2026-11-28）。** 最初の固定は`3b429132a804b2942e9e737c354155bfdc6fb081`（[results/fixation.json](results/fixation.json)、台帳`226d63c3`、26 file）。固定の時点のLatestはv0.5.134のまま（`gh release list`、2026-11-28）。ownerの承認は[results/probe-approval.json](results/probe-approval.json)。

## 目的

#1844の目的を引き継ぐ：利用者が`.agent-skill-chain/project/context.json`に登録した固有ルールが、該当するpathの変更で読まれるか。手順は#1861で決めたもの（利用者が自分のterminalで`worktree-create`を実行し、作られたworktreeでClaude Codeを起動する。`v05/USAGE.md`）に従う。判定の規則は#1844の[decision-criteria.md](../../1844-rule-read-bash/config/decision-criteria.md)をそのまま使う（ownerの決定、2026-11-28）。

## #1844の設定を写さずに使う

Issueは「#1844の設定を、このIssueのためにコピーすること」を禁じている。そこで共通の仕組みに、設定が別の設定を土台にする形（`conditions.json`の`extends`、`config.mjs`）を加えた。

- [conditions.json](conditions.json)は`extends: "../../1844-rule-read-bash/config"`で#1844の`conditions.json`を読み、このIssueで変える項目だけを書く（objectは項目ごとに重ね、`null`は項目を消す）。変える項目：Issue番号・目印の名前（`1866`）、説明の文、予算、水準Xの`sandbox.startWorktree`、条件の名前、`priorProbes`（消す）。
- `cases.json`・`run-order.json`・`decision-criteria.md`は#1844のものを読む（このdirectoryに置かない）。依頼文・採点の項目・水準・順序は#1844（つまり#1840の依頼文）と同じである。
- [release.json](release.json)・このREADME・`results/`はこのIssueのものである。
- 固定の記録（`fixation.mjs`）は、読んだとおりのfile（`config/<file>`。#1844のものを含む）と、土台のfile（`base/<file>`：#1844の5file）のsha256を持つ。固定の後に#1844の設定が変われば、`run-trial.mjs`と`judge.mjs`が拒否する。

## 条件と環境

- R：v0.5.134（固定の時点で最新のGitHub Release。#1844の`decision-criteria.md`の「測定の時点で最新のGitHub Release」に従う。進行役の決定、2026-11-28、PR #1875の独立レビューM3）。2026-11-28の`gh release list`でLatest。tarballのsha256 `a5245996…f0e9`は、`SHA256SUMS`の行、releaseのassetのdigest、release notesのPackage SHA256と一致した（Source `a63c1cb6`、Verified PR #1873、Tested HEAD `7b07bde8`、`source-commit.txt`も`a63c1cb6`）。PR #1864のworktree-createの確認と新しいmessageを含む。v0.5.133（`05cdf910…81cd`、PR #1864を含む最初のrelease）と展開して比べると、165 fileのうち違うのは`package.json`（version）と`release-identity.json`（versionと`distributionManifestSha256`）だけで、配布されるSkillは同じ17件、ASC CLIも同じである。固定の前に新しいreleaseがLatestになれば、`release.json`を直してdry runをやり直す。
- 環境：#1844の水準X（W＋Bash、Bashは`confined`のsandboxの中だけ）、fixture U、認証は`CLAUDE_CODE_OAUTH_TOKEN`だけ。
- **試行の前のworktree**（`toolLevels.X.sandbox.startWorktree`、`run-trial.mjs`の`createStartWorktree`）：`run-trial.mjs`は、中立のcommitの後、台帳の予約の前に、導入されたASC CLIで`worktree-create <work> 1866 test trial HEAD`をsandboxの外で実行する（利用者が自分のterminalで行うのと同じ）。Claude Codeはそのworktree（`work/.worktrees/<YYYYMMDD_HHMMSS>-1866-trial`、branch `test/1866-trial`）で起動する（cwd、trustの項目）。sandboxの配置（`confinedSettings`）は#1844と同じで、`work/`の全体が読める。書込みはClaude Codeの許可（起動したworktreeと`CLAUDE_CODE_TMPDIR`、本体が許すそのworktreeのGitの記録）に任される。`worktree-create`が失敗すれば、予約の前に拒否する。`meta.json`に`startDir`・`startWorktree`（branch・base・試行の終わりのHEAD）を記録する。
- 採点：`score.mjs`の`scoreRun`は`startDir`を受け取り、pathは従来どおりproject（`work/`）からの相対で数える（worktreeのfileは`.worktrees/<名前>/<path>`、worktreeから`../../.agent-skill-chain/…`で読んだmain checkoutのfileはprojectのfile）。Bashはworktreeから始まり、worktreeの外で終わった`cd`は次の呼出しでworktreeに戻る（Claude Codeの動作）。
- Skillのfileの照合（PR #1875の独立レビューM1）：#1844の`cases.json`の`bodyPattern`・`entryPattern`・`referencePattern`は`^\.agent-skill-chain/…`・`^\.claude/skills/…`で、`.worktrees/<名前>/`を許さない（`extends`では`cases.json`を変えられない）。そこで`startDir`のある採点では、ASCのSkillの本文・入口・reference、利用者のSkill（`forbidSkills`、`userSkill`）、ASCのfileの数と大きさを、先頭の`.worktrees/<名前>/`を外したpathで照合する（worktreeは同じcommitのcheckoutなので同じfile）。これで、worktreeでSKILL.mdをReadした試行の`bodyRead`・`reach`・`ascBytesRead`と、u-negで`.worktrees/<名前>/.claude/skills/invoice-format/SKILL.md`を読んだ試行の`forbidSkillsOk`・`negativeOk`が、#1844の`decision-criteria.md`の「`reach`・`negativeOk`は#1840と同じ」のとおりに数えられる。判定に使う4つの水準の規則のfileの型はもともと`.worktrees/`を許すので、変わらない。

## `start`の実行の数え方と#1844の判定の規則（PR #1875の独立レビューM2）

ownerの決定で判定の規則（#1844の[decision-criteria.md](../../1844-rule-read-bash/config/decision-criteria.md)）は変えない。最初の版の`boundCommandRan`は「同じ呼出しの他の部分が別の出力を出さない」ことも要った。これは規則の文に無い条件で、`git status && start`のように`start`のJSONが結果にある呼出しを数えず、規則より厳しかった（規則と食い違う偽陰性）。そこで数え方を規則の文に合わせた。規則の文（35行目）と実装（`score.mjs`の`commandRan`・`boundCommandRan`・`savedCopy`・`fabricates`）の対応は次のとおり。

| 規則の文 | 実装 |
| --- | --- |
| `asc-v05.mjs start`か`asc.mjs start`のBash（`--help`・`-h`を除く） | `pattern`（`cases.json`）が、呼出しのある部分のprogramとして実行されていること（環境変数・wrapper・`sh -c`・`node`のoptionの後）。`exclude`で`--help`・`-h`を除く。`echo '… start …'`・`node -e`・here-documentの中の文は`start`のBashではない |
| 結果がerrorでなく | tool_resultの`is_error`がfalse |
| その本文に`start`のJSONの出力（3つのschema）があること | 結果の文が`resultPattern`に当たり、その文が`start`の出力であること：他の部分がその文を作れない（`echo`/`printf`の展開する文・`%`・`\`、変数の一覧、`eval`・`sh -c`・`node -e`等。`fabricates`）。fixtureにその形の文を持つfileは無く（v0.5.134のdry runのfixtureと写しで`resultPattern`に当たるfileは0件、2026-11-28）`start`はfileを書かないので、保存した写し（`savedCopy`）がありうるときだけ、他の部分が出力を出さないことを要る |
| 終了codeだけでは数えない（`start … \| head`・`; echo done`・`\|\| true`） | 終了codeは使わない。main checkoutで止まった`start`の結果にはschemaが無いので数えない |
| 出力をfileへ流した、`\| grep -c`で数だけ見た等は数えない | `start`の部分の標準出力がfileへ流れていれば数えない（`> s.json; cat s.json`も）。`\| grep -c`・`\| wc`の結果にはschemaが無い |
| `--path`、`worktree-create`、commitは`report.commands`に記録（合否に使わない） | 変えていない。加えて`report.commands`の各項目に`outputSchema`（結び付けの前の数え方）を`ok`と並べる（報告だけ） |

- 規則に合わせて数える形（試験で固定）：`start --path src/billing/invoice.ts && cat ../../.agent-skill-chain/project/rules/money.md`、`git status && start .`、`ls; start .`、`cd "$(git rev-parse --show-toplevel)" && start .`、`start . | python3 -m json.tool`、`sh -c '… start .'`。
- 数えない形（試験で固定）：引用した文と保存したJSONの表示（`echo '…start…'; cat saved.json`、`start . > s.json; cat s.json`）、文を作る部分のある呼出し（PR #1875のレビューL1：`printf '"schema": "%s"' …; start .; true`、`S=…; echo "$S"; start .`、`echo -e '\x22…'`、`set`・`export -p`）、保存した写しがありうる後の呼出しの他の出力（例：前のWriteがschemaの文を書いた後の`git status && start .`）。

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

1. **dry run**（`dry-run.mjs`、v0.5.134の本物のtarball、`--runs-root /var/tmp/r1866`。PR #1875の是正の後にやり直した。最初はv0.5.133で同じく19項目合格）：19項目すべて合格（`sameRuntimeVersion` 0.5.134）。fixture Uに17件の入口と`claude-md`の採用、`cases.json`の`needs`、`startWorktree`（中立のcommitの後の写しで`worktree-create`がworktreeを作り、HEAD・ASC CLI・`CLAUDE.md`・`context.json`が同じ、branch `test/1866-trial`）、`priorSpend`（2つの台帳）、`budget`、`confinedLayout`、`runsRootTmpDir`、probe 43操作（`insideWorktreeCreateStops`を含む）。
以下の2・3は是正の前にv0.5.133のfixtureで行った。v0.5.134の配布fileとの違いはversionの記録だけで、probeの操作と試行の前のworktreeの動作もPR #1875の是正で変えていないので、やり直していない（是正は採点・設定の読込み・計画の`cwd`の文字列だけ）。

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
TGZ=<scratch>/rel134/agent-skill-chain-0.5.134.tgz   # gh release download v0.5.134 で取得し、sha256を照合する（固定の時点で最新のrelease）
# 1. 固定（台帳を作り、固定の記録をcommitし、最初の固定のcommitをこのREADMEに書いてcommitする）
node $H/fixation.mjs init $EV/results/fixation.json --ledger $LEDGER --config $EV
# 2. fixture
node $H/make-fixture.mjs R U $TGZ a5245996a2098d267af3e9aebb0eae02bf9f30d97735f025fbeb9424ad82f0e9 $ROOT/fixtures/fixture-R-U $ROOT/tmp --config $EV
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
- `start`の実行（`commandsAll`）は、commandとその出力を結び付けて数える（PR #1857の引継ぎ、上の節）。変数で書いたCLIのpath（`node "$CLI" start`）は、規則の文（`asc-v05.mjs start`）にも当たらないので数えない。文を作る部分の判定（`fabricates`）は、`awk 'BEGIN{print …}'`のように他のprogramが文を作る形を見ない（楽観側。モデルが自然に書く形ではない）。保存した写しがありうるときの厳しい結び付けは「実行しない」側に偏る。
- sessionのcwdは`work/.worktrees/<名前>`なので、Claude Codeは祖先の`work/CLAUDE.md`も読む（worktreeの`CLAUDE.md`と同じ文が2回入る。PR #1875のレビューL2）。利用者がworktreeで起動する手順と同じ条件なので変えない。probeの問1（Contextの指示file）の答えには指示fileが2つ挙がりうる。#1840と同じ項目の照合で不合格になれば、その差として読む。
- 失敗した`cd …&& …`の後の作業directoryは、2つの候補（前の値と`cd`の先）で数える（PR #1857の最後のレビューM-A）。候補が8を超えるか、失敗した呼出しに`cd`が2つ以上あると不明として扱い、従来どおり深い検索は「全てを読んだ」（`unbounded`）になる。判定の前に`forbidReadsOk`の`breakdown.onlyUnbounded`を確かめる。
- 文を作る部分の判定（`fabricates`）は、保存した写しが無いときにも規則の文より厳しい（実行しない側の食い違い。PR #1875の再レビューL-1）：`printf '\n---\n'; … start .`（`\`）、`echo "cwd: $(pwd)" && … start .`・`echo "$PWD"; … start .`（展開する文）、`printf '%s\n' ok; … start .`（`%`）、`… start . && node -e 'console.log(1)'`は、結果に`start`のJSONがあっても数えない。判定の前に`report.commands`の`outputSchema`と`ok`の差を確かめ、この形で数えなかった呼出しがあれば結果に書く。
- 試行の前に作ったworktreeが空である（`workChanges`に何も無い）ことを、dry runも試験も確かめていない（PR #1875の再レビューL-2）。`worktree-create`がfileを残せば、試行の書いたfile（`mustWrite`・`docs/`の`require`）に入りうる。v0.5.134の`createWorktree`はHEADの内容だけを書く（再レビューの確認）ので、この版での危険は低い。
