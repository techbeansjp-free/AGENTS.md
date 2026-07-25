# ADR

```yaml
id: ADR-0010
status: proposed
title: npm pack検証を使い捨てsource snapshotへ隔離する
tags: [testing, npm, concurrency]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

package files統合テストはnpmが算出する実際の収録内容を検証する必要がある。一方、
repository rootで`npm pack --dry-run`を動かすと`prepare`が共有`bin/`を再生成し、並列テストが
生成途中のCLIを読む競合が起きる。

test runnerの直列化やprocess内mutexは共有可変状態を残し、別processを含む競合境界を閉じない。
`--ignore-scripts`は速いが、公開時に実行されるlifecycleと現在sourceから生成したCLIを検証しない。
productionのbuild出力先をテスト都合で変える案はpackage manifestとCLI build契約へ影響する。

## Decision

package内容検証は、OS一時領域に作成した使い捨てsource snapshotをcwdとして、通常の
`npm pack --dry-run --json`を実行する。snapshotからGit metadata、worktree集合、依存実体、
共有`bin/`を除外し、依存は元の`node_modules`への固定symlinkから読ませる。

`prepare`はsnapshot内に新しい`bin/`を生成する。元repositoryはread-only入力とし、probeの
成功・失敗を問わず所有者が`finally`で一時workspaceを削除する。pack filesの判定はnpmのJSON出力を
使用し、npmの収録計算を模倣しない。

## Consequences

- 並列package probe同士とCLI利用テストは生成物を共有せず、実行順に依存しない。
- 実際のnpm lifecycle、現在sourceからのbuild、pack files算出をまとめて検証できる。
- snapshot copyと複数buildによりテスト時間と一時disk使用量は増える。
- `node_modules`は読取り共有であり、将来`prepare`が依存へ書く処理を導入する場合は依存も隔離する
  新しいADRが必要になる。
- 隔離処理の回帰は、lifecycle中marker、元CLI実行、失敗時cleanupの自動テストで維持する。
