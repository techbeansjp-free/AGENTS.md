# ADR

```yaml
id: ADR-0012
status: proposed
title: npm pack検証を使い捨てsource snapshotへ隔離する
tags: [testing, npm, concurrency]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

package files統合テストはnpmが算出する実際の収録内容を検証する必要がある。一方、repository rootで
`npm pack --dry-run`を動かすと`prepare`が共有`bin/`を再生成し、並列テストが生成途中のCLIを読む。

直列化やprocess内mutexは別processを含む共有可変状態を残す。`--ignore-scripts`は公開時のlifecycleと
現在sourceからのCLI生成を検証せず、productionのbuild出力先変更はpackage契約へ影響する。

## Decision

package内容検証はOS一時rootのsource snapshotをcwdとして、通常の
`npm pack --dry-run --json`を実行する。package rootはGit metadata、worktree、共有`bin`、
`node_modules`を除外して一度copyし、依存は別に一度copyする。fileは物理的に分離し、内部相対symlinkは
維持する。copy後に全linkの`realpath`がsnapshot内であることを検査し、absolute、破損、外向きlinkを拒否する。

HOME、npm cache、temp、markerはprobe専用pathへ隔離する。npm childは独立process treeで起動し、
timeoutまたはbuffer超過時はtreeを終了、有限時間でreap/joinしてからcleanupする。出力buffer、
pack、終了grace、reap、cleanupはそれぞれ有限上限を持つ。
primary errorとcleanup errorを失わず、cleanup単独失敗も非成功にする。

隔離の証明はroot `bin`全fileの相対pathとbytes digestを成功、prepare失敗、timeoutの前後で直接比較する。
lifecycle中の一意markerでroot CLIのhelp/lintを重ね、timeoutではdescendantを含むtree回収を検査する。
npmはdry-runでcacheも隔離されるため、共有publish lockやtest順序制御は導入しない。

## Consequences

- 並列probeとCLI利用testは書込みpathを共有せず、実行順に依存しない。
- 実際のprepare、現在sourceからのbuild、npmのpack files算出をまとめて検査できる。
- 内部相対symlinkの解決意味を保ちつつ、rootへのwrite-throughをcontainment検査で拒否できる。
- copy、build、tree supervisionにより時間・一時disk・platform別process処理は増える。
- helper/testを戻すと既知raceが復活するため、rollback前に同等の隔離策を必要とする。
