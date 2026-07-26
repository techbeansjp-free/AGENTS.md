# DESIGN: 並列テスト中のnpm pack用ビルドがCLI成果物を競合更新する

- Issue: `ISSUE-279`
- 対応する SPEC: `SPEC.md`

## 目的・入力・出力・前提

npmの実lifecycleとpack算出を維持し、package検証の全書込みを使い捨て領域へ閉じ込める。
入力は読取り専用のpackage root、出力はnpmが返すfiles一覧である。通常build済みの共有CLIと
`node_modules`を前提とし、CLI本体、package manifest、test runnerの並列度は変更しない。

## 要件 → 設計要素

| AC-ID | 設計要素 | 検証 |
|---|---|---|
| AC-1 | Isolated package probe | root `bin` manifestの前後一致 |
| AC-2 | Pack result parser | npmのJSON filesと収録契約を照合 |
| AC-3 | Controlled race fixture | lifecycle中にroot CLIのhelp/lintを起動 |
| AC-4 | 既定test command | concurrency指定なしで3回以上実行 |
| AC-5 | Process supervisor / workspace owner | failure・timeout・cleanup複合障害 |

## Isolated package probe

`test/helpers/npm-pack.ts`はprobeごとに次を行う。

1. OS一時rootにsource、HOME、npm cache、TMPDIRと一意なmarker領域を作る。
2. package rootをsourceへ一度だけcopyする。`.git`、`.worktrees`、`bin`、`node_modules`を除外し、
   fileは新しい実体とする。`node_modules`はsource直下へ別に一度だけcopyする。
3. 内部の相対symlinkはNode解決規則を保つためsymlinkのまま維持する。両copy後に全symlinkを走査し、
   absolute linkを拒否する。さらに各targetの`realpath`を求め、sourceの`realpath`からの相対pathが
   `..`で始まらずabsoluteでもないことを確認する。破損linkとsource外targetはprobe開始前に拒否する。
4. `HOME`、`npm_config_cache`、`TMPDIR`、`TMP`、`TEMP`を専用領域へ固定する。package lock、
   lifecycle出力、npm cache、temp fileのいずれもrootへ書き戻せない。
5. sourceをcwdとして、shellを介さず固定引数`npm pack --dry-run --json`をspawnする。
   stdout/stderrは合計8 MiB、packは60秒を既定上限とし、testから短縮注入できる。
6. child回収後にJSONをparseしてfilesを返し、最後にworkspaceを再帰削除する。

copy後だけに作用するtest hookでsnapshotの`package.json`を変更できる。成功経路ではhookを使わず、
実際のmanifestとsourceを検証する。元package rootへ書込みAPIを公開せず、別probe間でpath、
environment、markerを共有しない。dry-runはpublishせずcacheも隔離されるため、process間mutex、
共有publish lock、実行順制御は不要である。

## Process supervisor / workspace owner

childは独立したprocess group/treeとして起動する。通常終了では`close`をjoinしてからcleanupする。
timeoutまたはbuffer超過時はtree全体へ終了要求を送り、2秒のgrace後も残れば強制終了し、5秒以内に
`close`をjoinしてからcleanupする。POSIXはgroupへのTERM→KILL、Windowsは同等のtree terminationを
固定引数で行う。順序は必ず「terminate tree → reap/join → cleanup」であり、親だけをkillしない。

pack timeout、termination grace、reap timeout、10秒のcleanup watchdog、buffer上限、cleanup関数は
test seamで注入できる。timeout経路の全体上限は77秒である。reap不能時は生存childと競合する削除をせず、
workspace path付きfatal errorにする。primary errorを保持してcleanupし、cleanupも失敗した場合は
両errorとpathを`AggregateError`で返す。cleanup単独失敗も成功扱いしない。

## Assertions と回帰fixture

`package-files.test.ts`は`before`で成功probeを1回実行し、2つの契約testが不変なfilesを共有する。
helper内で収録規則を模倣せず、npm JSONの`files[].path`だけを必須・禁止集合と照合する。

root `bin`は再帰walkし、各fileのrootからの相対pathとbytesのSHA-256をsortしたmanifestにする。
成功、snapshot内prepare失敗、snapshot内prepare timeoutの各BDDでprobe前後manifestを直接
deep-equalし、追加・削除・内容変更を検出する。failure/timeout注入はcopy後のsnapshotだけを変える。

race fixtureはprobe固有の予測不能なentered/release markerを絶対pathで子へ渡す。snapshotのprepareが
snapshot CLIを不正化してenteredを作りreleaseまで有限待機する間に、親はroot CLIの`--help`とclean
入力への`lint vocab`を実行する。`finally`でreleaseし、supervisorへjoin/killを委ねる。timeout fixtureは
descendantも起動し、tree回収後にworkspaceが消えることを検査してscheduler依存のhangを反証する。

## 依存・代替案・障害・ロールバック

```text
package assertions / race / failure BDD → isolated probe → temp snapshot → npm pack
                                              ↑ physical files + contained relative links
```

`--ignore-scripts`は公開時のprepareを検査せず、直列化/mutexは共有可変状態を残し、rootのoutDir変更は
production契約へ影響するため不採用。copy・containment・spawn・buffer・timeout・parse・cleanupの
失敗は全て非成功とする。ロールバックはhelper/testだけを戻すが、既知raceを復活させるため代替隔離策を
先に要求する。未決事項はなく、全AC、既定並列test 3回以上、型検査、規約lintの成功を完了条件とする。

```yaml
related_adrs: [ADR-0012]
```
