# Bashがある環境での固有ルールの読込み（#1844）：設定

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。測定の仕組みは共通のもの（[../../shared-harness/](../../shared-harness/)）を使い、このdirectoryには設定だけを置く。

**状態：固定のやり直し（2026-11-28）。** 最初の固定（`59dc321d`、[results/fixation-1.json](results/fixation-1.json)、台帳`889bb6f5`）の下でprobeの1回目（R-probe-1）が不合格だった。原因の2つ（下の「probeの1回目の後の是正」）を直すために`run-trial.mjs`等を変えたので、新しい台帳で固定をやり直した（[results/fixation.json](results/fixation.json)。固定の記録のcommitは下の「probeの1回目の後の是正」の3）。結果と原因は[../README.md](../README.md)。

## 目的

利用者が`.agent-skill-chain/project/context.json`に登録した固有ルールが、Bashを使える利用者の環境（`start`を実行できる）で、該当するpathの変更で読まれるか。読まれなければ、どこで止まるか（`start`を実行しない、main checkoutで`start`が止まる、`--path`を付けない、選ばれたのに読まない、等）を試行ごとの記録で示す。判定の規則は[decision-criteria.md](decision-criteria.md)。

## 条件と環境

- R：測定の時点で最新のGitHub Releaseのtarball（進行役の指定）。固定の直前（2026-11-28）の`gh release list`ではv0.5.128（Latest、2026-11-28T02:57:03Z、対象commit `05a53891`）。[release.json](release.json)のsha256 `2fd9dcef…b922`は、releaseのassetのdigest、`SHA256SUMS`、release notesのPackage SHA256と一致する。配布されるSkillはv0.5.121・v0.5.123と同じ17件（tarballの`v05/optional-skills/model-deliberation`は配布されない）。以前の指定のv0.5.123から、固定の前に更新し、dry runをやり直した（下の「dry run」）。モデルを呼ばない確認（sandbox-check）は、probeの1回目の後の是正の後に、v0.5.128のfixtureで取り直した（下の「モデルを呼ばない確認」）。
- 導入と認証は#1840と同じ：利用者の手順で導入、試行ごとの空のHOMEと設定directory、認証は`CLAUDE_CODE_OAUTH_TOKEN`だけ（ownerのtoken file `~/.config/asc-eval/claude-oauth-token`をenvへ渡す。中身を表示しない）。
- 水準X：#1840の水準WにBashを足した（`--tools Bash,Read,Write,Edit,Glob,Grep,Skill`、`acceptEdits`）。BashはClaude Codeのsandboxの中だけで動く。

## Bashの隔離（`confined`の配置）

#1820の段階1の水準Xは、`--settings`の`allowRead`（`work/`）が同じ`--settings`の`denyRead`（runs root）を開け直さなかったため、`work/`を読めず不合格だった（Claude Code 2.1.323。同じ版の本体の文にも「--settingsが読取りを禁じたpathを開け直すallowReadは無視する」とある）。共通の仕組みに、`allowRead`を使わない配置を足した（`run-trial.mjs`の`confinedSettings`。conditions.jsonの`toolLevels.X.sandbox`）。

- 読取りの禁止：`/Users`（実HOMEとrepository、`nodenv`のnode）、`/private/tmp`・`/private/var/folders`・`/Volumes`（他のsessionの一時file等）、fixture、台帳のdirectory、runs rootの他の項目（起動時に列挙。試行は台帳のlockの下で1つずつ動く）、runs rootの親と祖父の他の項目（深さ3以上のものだけ。`/var/tmp/r1844`では親だけ。`$ROOT/tmp`・`$ROOT/probe-R-2.json`・`/private/var/tmp`の他のIssueの評価用directory等。起動時に列挙。深さ3未満のdirectoryは列挙しない。レビューL1）、試行の`settings.json`・`debug.log`・`trace.jsonl`・`stderr.txt`・`meta.json`。どれも`work/`と試行の`tmp/`の祖先ではない（祖先なら`run-trial.mjs`が予約の前に拒否する）。
- 書込みの禁止：上の読取りの禁止のすべて（`/Users`と`denyReadRoots`を含む。2回目のレビューM-a）に加え、試行の`home/`・`config/`・`bin/`。runs rootそのものと`/private/var/tmp`は`work/`の祖先なので禁止できず、`work/`と`tmp/`の外への書込みが拒否されるかはClaude Codeのsandboxの書込みの許可（作業directoryと`CLAUDE_CODE_TMPDIR`。`CLAUDE_CODE_TMPDIR`を試行の`tmp/`にする）に任される。本体が既定で足す許可があるかは、probeで`/private/tmp/claude-<uid>/`・runs root・`/private/var/tmp/`への`touch`を試して確かめる（変数で組み立てたpathで、sandboxの拒否を要る）。
- Bashの`PATH`：試行の`bin/`（harnessのnodeの写し。実HOMEの下のnodeはsandboxで動かないため）と`/Library/Developer/CommandLineTools/usr/bin`・`/usr/bin`・`/bin`・`/usr/sbin`・`/sbin`。`/usr/bin/git`はxcrunの一時fileを`/private/var/folders`に作ろうとして警告を出すので、Command Line Toolsのgitを先に置く。
- fixture・台帳は`/private/var/tmp/asc-eval-1844/`の下に置く（`/private/tmp`は読取りの禁止の中なので使えない）。runs rootは、probeの1回目の後、`/var/tmp/r1844`（実pathは`/private/var/tmp/r1844`）にした（下の「probeの1回目の後の是正」）。runs rootの親`/private/var/tmp`の他の項目（`asc-eval-1844`の全体を含む）は起動時に列挙して禁止する。祖父の`/private/var`は深さ2なので列挙しない（以前のruns rootでも`/private/var`は列挙していなかった）。
- 認証情報：Bashの子processの環境に`CLAUDE_CODE_OAUTH_TOKEN`が入る。Claude Code 2.1.323には子processの環境から認証情報を除く`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`があるが、本体の実装（2.1.323のbinaryの文）では、これを設定すると許可のmodeが`default`に強制される（`acceptEdits`の水準Xが成り立たない）ので使わない。file descriptorで渡す経路（`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`）もbinaryにはあるが、モデルを呼ばずに認証が通るかを確かめられないので未判定とし、使わない（使うならownerの判断で、probeで確かめる）。代わりに、(1) probeの`credentialLength`で、Bashから見えるかを長さだけで記録する（中身は出さない）、(2) 試行の後、消す前に、試行のdirectory全体（`home/`・`config/`は従来どおり別に数える）、`work/`のgitのobject（`git cat-file --batch-all-objects`）、置き換え済みの記録の`<credential>`を調べ、1件でもあれば`credentialLeak`として、測定の試行は`work/`を消して失敗にし（collect.mjs）、probeは不合格にする（`credentialNotLeaked`）。レビューM3。

### モデルを呼ばない確認（2026-11-28）

[sandbox-check.json](sandbox-check.json)（probeの1回目の後の是正の後に、v0.5.128のfixture、runs root `/var/tmp/r1844sc/runs`で取り直した。下の数はその前の記録（49件）で、今の記録は`processListIndirect`を足した50件すべてが期待どおり。`ps`のsandboxなしの行数は948）：`shared-harness/sandbox-check.mjs`が、probeの試行と同じ配置を作り、`isolationSettings`が書く設定の読取り・書込みの規則を、公開のsandbox runtime（`@anthropic-ai/sandbox-runtime` 0.0.83、Claude Codeが使うものと同じ系統）に渡して、probeのBashの35操作と、追加の14操作を普通のcommandとして実行した。**49件すべてが期待どおり**（成功すべき15件が成功、拒否されるべき33件が拒否、記録だけの1件。成功すべき15件は、下の「成功」の11件と、出力の値で判定する4件（keychainの検索2件・`pbpaste`・`ps`。3回目のレビューL2））で、sentinelのfileも試行の外へ書こうとしたfileも残らなかった。srtには書込みの許可（`work/`と`tmp/`）を明示して渡すので、Claude Code本体が既定で足す許可は再現しない（probeで確かめる）。

- 成功：`work/`への書込み、目印へのsymlinkの作成、`cat CLAUDE.md`、`git status`、写したnode（v20.12.2）、ASC CLIの`--help`・`worktree-create`、`TMPDIR`への書込み、worktreeでの`start --path src/billing/invoice.ts`が`money.md`を選ぶこと、worktreeの`money.md`の読込み、worktreeでのcommit。
- 拒否：目印fileのpath、実HOMEとrepositoryにある既存のfile（`~/.zshrc`、`AGENTS.md`）、runs rootの別の項目、試行の`settings.json`、fixture、台帳、`/private/tmp`・`/tmp/claude-<uid>`・`/private/var/folders`・`/Volumes`、試行のdirectoryとrepositoryへの`touch`、通信（proxyが403）。main checkoutでの`start`は「Use a dedicated Git worktree」で終了code 1、worktreeでの`--path src/users/store.ts`は`money.md`を選ばない。
- 試行の外への書込み（2回目のレビューM-a）：`/private/tmp/claude-<uid>/`・runs root・`/private/var/tmp/`への`touch`は、どれもsandboxの拒否（「Operation not permitted」）だった。
- fileを経ない経路（2回目のレビューM-c）：同じ環境でsandboxを使わずに実行した値（`baseline`）と並べた。keychainの検索は、実userの`login.keychain-db`をpathで指定すると、sandboxなしでは見つかる（終了code 0）が、sandboxの中では見つからない（44）。試行のHOMEの既定の検索先では、sandboxなしでも見つからない（44。検索先はHOMEで決まる）。`pbpaste | wc -c`はsandboxなしで754、中では0。`ps -axo pid=`はsandboxなしで942行、中では`ps`の実行が拒否されて0。
- 間接の経路（レビューM2）：既存の禁止されたfile（台帳のdirectoryに置いた記録）へのsymlinkとhard link（`ln`が「Operation not permitted」）、`sh -c 'cat "$0"'`、2つの変数で組み立てたpathの`cat`、runs rootの親の項目（`probe-R.json`）は、どれもsandboxの拒否（「Operation not permitted」）だった。`node -e`の読込みも拒否（終了code 1）。
- 目印fileは作っていない（#1846のprobeと重ならないように）。存在しない目印のpathは「No such file or directory」になる（読取りの禁止の下でも、存在しないことは分かる）。probeでは目印fileを置いてから試す。
- これはsandbox runtimeが規則をどう強制するかの確認で、Claude Codeが本体に持つruntimeでの確認ではない。測定する環境の確認はprobe（`run-trial.mjs`のprobe、`probe-check.mjs`）である。probeでは、拒否した主体を操作ごとに記録し（`refusalKind`：sandbox／Claude Codeの許可の確認／その他）、pathがcommandの文字列に無い6操作（`catSymlinkHome`・`varPathHome`・`varPathSibling`・`touchUserTmp`・`touchRunsRoot`・`touchVarTmp`）は、sandboxの拒否の文（「Operation not permitted」）が無ければ不合格にする（`sandboxRefusal`。許可の層がcommandの文字列から止めただけでは、sandboxが効いていることを示さないため。レビューM2、2回目のレビューM-a・M-b）。`sandbox-check`では、目印fileを作らないため、目印が対象の2操作（`catSymlinkHome`・`varPathHome`）は「No such file」になり、この2操作だけsandboxの拒否を求めない（`sandboxRequired: false`）。probeでは目印fileを置いてから試すので、6操作すべてに求める。

### dry run（2026-11-28）

（probeの1回目の後の是正の後に取り直した：`--runs-root /var/tmp/r1844`で全16項目が合格（`runsRootTmpDir`を含む）、probeは43操作。`--runs-root /private/var/tmp/asc-eval-1844/runs`では`runsRootTmpDir`が不合格（60 byte）。sandbox-checkもv0.5.128のfixtureとruns root `/var/tmp/r1844sc/runs`で取り直し、50件すべて期待どおり（`processListIndirect`はsandboxなしで941、中で0）。下の段落は是正の前の記録。）

`dry-run.mjs`（v0.5.128の本物のtarball、sha256 `2fd9dcef…b922`。v0.5.123でも同じ結果だった）：全15項目が合格。fixture Uに17件の入口と`claude-md`の採用、`cases.json`の`needs`、probe 1回（42操作、`--max-turns 50`。是正の後は43操作、`--max-turns 60`）と15試行の起動command、`confinedLayout`（`allowRead`なし、`/Users`とfixtureの禁止、dry runの根が禁止の外）。見込み3.86 USD、計画の単価で5.51 USD（2回目のレビューの是正の後に取り直した）。

## 依頼

[cases.json](cases.json)：#1840のu-bill-1・u-bill-2・u-users・u-docs・u-neg（依頼文は#1840と同じ）。#1840からの変更は、金額の規則の`scope: "code"`（#1845）、`expectCommands`（変更の4依頼で`start`）、規則のfileのpathに`.worktrees/<名前>/`を許すこと、`report.commands`（`start`・`--path src/billing`・`worktree-create`・commitを試みたか、成功したか）。

## 費用とトークン

- 15試行（変更12、該当しない3）とprobe 1回。上限10 USD、停止の線9 USD。1試行の予算（`--max-budget-usd`と台帳の予約）0.8 USD、probe 0.6 USD。
- 見込み：変更0.28、該当しない0.04、probe 0.38 USD（#1840の平均：変更0.11〜0.21、該当しない0.025を、`start`の実行・出力とBashの分だけ増やした。probeは42操作。是正の後は43操作、`--max-turns 60`）。計 **約3.9 USD**（計画の単価で5.5 USD）、入力（入力＋cache）約292万トークン、出力約5.5万トークン。probeのやり直しと置き換えがあっても停止の線の内に収まる見込み。

## probeの1回目の後の是正（2026-11-28）

原因と観察は[../README.md](../README.md)の「probeの1回目」。判定の規則・水準・採点（`score.mjs`・`judge.mjs`・decision-criteria.md・cases.json）は変えていない。

1. **Bashの作業fileの場所**：Claude Code 2.1.323は、`<CLAUDE_CODE_TMPDIR>/claude-<uid>`が44 byteを超えると、子processの`TMPDIR`とshellのcwdのfileを`/tmp/claude-<uid>`（読取りと書込みの禁止の中）に移す。長さは環境変数の文字列のまま数える（linkを解かない）。
   - runs rootを`/var/tmp/r1844`にする（最長の`R-u-bill-1-99`で43 byte）。`/private/var/tmp`の下では、名前が無くても最長の試行で50 byteになり、収まらない。
   - `run-trial.mjs`：試行の`tmp/`のper-uidのpathが44 byteを超える試行を、予約の前に拒否する（`tmpDirProblem`。`--run`なしの計画の表示でも）。`dry-run.mjs`：`--runs-root`の、probe・予定の15試行・rep 9までの置き換えのすべてを確かめる（`runsRootTmpDir`。confinedの水準では`--runs-root`が要る）。
   - `/var`は`/private/var`へのlinkなので、`run-trial.mjs`の`realOr`を、存在する一番深い祖先の実pathに残りを足す形にした（以前は、runs rootがあり試行のdirectoryがまだ無いと、runs rootだけ実pathになり、`confinedSettings`が「<runs-root>/<trial>/workでない」と拒否した）。sandboxの禁止の一覧は従来どおり実path（`/private/var/tmp/…`）で書かれる。
2. **`ps`を許可の層が止める**：`processList`の操作に`permissionRefusalOk`を付け、`probe-check.mjs`は、Claude Codeの許可の確認による拒否（errorの結果で、「requires approval」「has been denied」「haven't granted」の文があり、sandboxの拒否の文が無く、0でない数の行が無いもの）を、一覧を取れなかったとして合格に数える（`permissionRefused`）。拒否の主体は`info.permissionRefusalOk`に記録する。ほかの操作には適用しない。是正のレビューM1により、許可の層が見ない経路として`processListIndirect`（`node -e`から`spawnSync("ps")`、行数を出す。`permissionRefusalOk`なし）を足し、probeは43操作にした。sandboxが一覧を空にすることはこの操作で確かめる。再レビューのLowにより、この操作のcommandはbackslashを含まない形（`String.fromCharCode(10)`）にし、`probeMaxTurns`を50から60にした（probe 1は42操作で44ターン）。
3. 固定のやり直し：`run-trial.mjs`は`refix`で変えられないので（`refix`は`probe-check.mjs`だけ）、新しい台帳で固定をやり直した（固定の記録のcommit `c25da95b313f9f9689072ea887838ce00ce0dd29`、台帳`a48998d6`、[results/fixation.json](results/fixation.json)）。最初の台帳を[results/ledger-1.jsonl](results/ledger-1.jsonl)に公開し、`conditions.json`の`budget.priorSpend`（0.3472675 USD）で費用を引き継ぐ（`capUsd` 9.65、新しい台帳の停止の線8.65 USD、合計で9 USD）。R-probe-1は`priorProbes`で予約済みと数える（`order.mjs`）ので、残りのやり直しはR-probe-2の1回だけである。

## 手順（進行役が行う。probeは#1846のprobeが終わってから）

```text
H=docs/evidence/shared-harness
EV=docs/evidence/1844-rule-read-bash/config
ROOT=/private/var/tmp/asc-eval-1844
RUNS=/var/tmp/r1844          # probeの1回目の後：<RUNS>/<試行>/tmp/claude-<uid>が44 byte以内（run-trial.mjs tmpDirProblem）
LEDGER=$ROOT/ledger/ledger-1844-2.jsonl   # 固定のやり直しの新しい台帳（最初の台帳はledger-1844.jsonl）
TGZ=<scratch>/rel1844-128/agent-skill-chain-0.5.128.tgz   # gh release download v0.5.128 で取得し、sha256を照合する
# 1. 固定（台帳を作り、固定の記録をcommitし、最初の固定のcommitをこのREADMEに書いてcommitする）
node $H/fixation.mjs init $EV/results/fixation.json --ledger $LEDGER --config $EV
# 2. fixture
node $H/make-fixture.mjs R U $TGZ 2fd9dcef88d997eb236a4b34a54babb9da3ccabcabd8629a0ba4624f3f74b922 $ROOT/fixtures/fixture-R-U $ROOT/tmp --config $EV
# 3. 隔離の確認（目印fileは確認の後に消す）。harnessはsandboxの外のshellで実行する
node $H/markers.mjs create <repo-root> --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/asc-eval/claude-oauth-token)" ASC_EVAL_ALLOW_PAID=1 node $H/run-trial.mjs $RUNS R probe 2 --fixture $ROOT/fixtures/fixture-R-U --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run --config $EV
node $H/probe-check.mjs $RUNS/R-probe-2 R <home marker> <repo marker> <repo-root> --config $EV > $ROOT/probe-R-2.json
node $H/probe-check.mjs compare $ROOT/probe-R-2.json --out $RUNS/probe-compare.json --config $EV
node $H/probe-check.mjs publish $EV/results/probes $ROOT/probe-R-2.json $RUNS/probe-compare.json --home-marker <home marker> --repo-marker <repo marker> --repo-root <repo-root> --runs-root $RUNS --config $EV
node $H/markers.mjs remove <repo-root> --config $EV
# 4. 測定（probeが合格した場合だけ）
CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/asc-eval/claude-oauth-token)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs planned $RUNS --fixtures $ROOT/fixtures --ledger $LEDGER --run --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/asc-eval/claude-oauth-token)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs replacements $RUNS --fixtures $ROOT/fixtures --ledger $LEDGER --run --config $EV
# 5. 公開する記録と判定
node $H/collect.mjs $RUNS $EV/results --ledger $LEDGER --config $EV
node $H/judge.mjs $EV/results --runs-root $RUNS --ledger $LEDGER --out $EV/results/judge.json --config $EV
```

- `<repo-root>`は、`run-trial.mjs`と照合が使うrepository（このworktree）。#1840の1回目のprobeは本体のcheckoutを渡して不合格になった。
- モデルを呼ばない確認のやり直し：`node $H/sandbox-check.mjs <新しいdirectory> R $ROOT/fixtures/fixture-R-U <srtのdist/cli.js> <node 22以上> <repo-root> --out $EV/sandbox-check.json --config $EV`。

## 限界

- sandboxの中のBashは利用者の環境と同じではない：`PATH`は試行の`bin/`とsystemのdirectoryだけで、実HOMEのcommand（nodenv、Homebrewの一部等）と通信は使えない。`npm install`・`npm test`は依存を取れず失敗する。Bashのtoolの説明文にsandboxの注意が加わる。
- 禁止していないpath（`/etc`、`/opt`等）は読める。`/private/var/tmp`とruns rootの親・祖父の項目（深さ3以上。`/var/tmp/r1844`では親の`/private/var/tmp`だけ）は、試行の起動時にあったものを禁止する。起動の後に作られた項目と、`/private/var/tmp`の一覧そのもの（`ls /private/var/tmp`）は読める（`/private/var/tmp`は深さ3なので、起動時にあった項目は禁止に入る。深さ3未満の`/private/var`等の項目は列挙しない。3回目のレビューL2）（#1846等を並行して動かすと、後から作られた評価用directoryが読める）。他のsessionの一時file（`/private/tmp`・`/private/var/folders`）は読取りも書込みも禁止した。
- Bashで読んだfileの数え方は、commandの文字列からの推定である（decision-criteria.mdの「数え方」）。偏りの向きは指標で逆なので、2通りに数える（レビューM1）。
  - rule-read（読むべき）は**厳しく**数える（`bashReadPaths`）。数え漏れ（`node -e`で読む、directoryを渡した検索、展開前のglob等）は「読まない」側に偏り、値は実際より低いことがある。中身の出ない読込み（`> /dev/null`、`grep -q`・`-c`・`-l`、無いpath）は数えない（2回目のレビューL-a）。それでも、中身を見せないcommandへのpipe（`cat money.md | wc -l`）と、読むcommandでないcommandへの`<`（`wc -l < money.md`）は「読んだ」に数え、楽観側に寄る。
  - rule-not-read（読まない）は**広く**数える（`forbiddenReads`）。globとdirectoryは試行の`work/`のfile（fixtureのHEAD・変更したfile・`.worktrees/`の各worktree）に展開し、検索（`grep -r`・`rg`・`git grep`・`find -exec`・`xargs`）はその配下をすべて読んだとみなし、`git show <rev>`・`git log -p`等の中身の分からない出力は「読んだ」とし、commandの文字列が`project/rules`・`rules/money`・`money.md`を含めば（`cd`・`cp`・`node -e`等）読んだとする。誤りは「読んだ」側（不合格の側）に偏る。厳しく数えた値は`forbiddenReadsStrict`に並べて示す。広すぎて落ちる例（自分のcommitの後の`git show`・`git log -p -1`は`money.md`を含まなくても「読んだ」）があるので、judge.jsonの`forbidReadsOk`の水準に`breakdown`（strictで合格した数、中身の分からない出力だけで落ちた数、`bashMention`だけで落ちた数）を並べる（2回目のレビューL-b）。
  - それでも数えられない読み方：別名へ写した後の読込み（例：`cp`で写したfileを別の名前で読む。写す操作は`bashMention`で数える）、文字列を含まない計算したpath（例：directoryを辿るscript）、`start`の出力を経た参照。これらは「読まない」側に偏る。
- `start`はworktreeでだけ動くので、`start`を使う試行はworktreeを作り、そこで書く。worktreeでのcommitも変更として数える。HEADも残ったworktreeも届かないcommit（commitの後に消したworktree、checkoutしていないbranch、stash）は`meta.json`の`unreached`に記録し、その中の`src/billing/`のfileは「書いたが照合できない」として規則の遵守を不合格にする（レビューL2）。branchまで消されたcommitは見えない。
- `start`の実行は、結果の本文に`start`のJSONの出力（`"schema": "asc-worktree/v1"`等）がある場合だけ数える（レビューH1）。pipelineの`| head`、`; echo`、`|| true`で終了codeが0でも、main checkoutで止まった`start`は数えない。出力をfileへ流して別に読んだ場合や`| grep -c`で数だけ見た場合も数えない（「実行しない」側に偏る）。`report.commands`の`attempted`・`exitOk`で別に示す。
- 水準の`min`は仮置き（`conditions.json`の`rule.minProvisional`）。judge.jsonの各条件に`minProvisional`と`verdictBasis`が付き、`meets-levels`／`below-levels`は仮の水準による（レビューL3）。
- 認証情報の漏れの検査（`credentialLeakOf`）は、試行のdirectoryの中の64MB未満のfileと、`work/`のrepositoryのgitのobjectだけを見る。64MB以上のfileと、`work/`の中に作られた別のrepository（入れ子の`.git`）の圧縮されたobjectは見ない（2回目のレビューL-e）。試行の外への書込みはsandboxで禁じ、probeで確かめる（M-a）。
- fileを経ない経路のprobe（M-c）は、その時点の状態に依る：clipboardが空なら`pbpaste | wc -c`は0で、sandboxが止めなくても合格する（`sandbox-check`のbaselineではsandboxなしで754だった）。keychainも同じで、probeにはsandboxなしの比較の値が無い：`keychainDefault`はsandboxなしでも44（試行のHOMEの既定の検索先に項目が無い）なのでsandboxの効きを見分けず、`keychainLogin`はprobeの時点で実keychainに項目が無ければ、sandboxが効いていなくても合格する（3回目のレビューL1。比較の値は`sandbox-check`のbaselineだけにある）。keychainは`Claude Code-credentials`の項目だけを探し、ほかの項目やsecurityd以外のMach serviceは試していない。processの一覧は`ps`だけを試す（`sysctl`等の別の経路は試していない）。
- 各依頼3回。数試行の差は偶然の範囲を出ない。
