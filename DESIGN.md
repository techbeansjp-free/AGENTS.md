# DESIGN: 並列テスト中のnpm pack用ビルドがCLI成果物を競合更新する

- Issue: `ISSUE-279`
- 対応する SPEC: `SPEC.md`

## 目的・入力・出力・前提

目的は、npmの実際のlifecycleとpack算出を維持したまま、package検証の書き込みを使い捨て領域へ
閉じ込めることである。入力はrepositoryのpackage source snapshotと依存モジュール、出力はnpmが
返すpack files一覧である。テスト開始前の通常buildで共有CLIが完成しており、`prepare`は依存を
読み取るが`node_modules`へ書き込まないことを前提とする。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | Isolated package probe | source snapshot内だけで`prepare`を実行 |
| AC-2 | Pack result parser / contract assertions | npmのJSON filesを既存集合と照合 |
| AC-3 | Controlled race fixture | marker後に共有CLIを起動して競合時間帯を固定 |
| AC-4 | 既定test command / 反復検証 | concurrency指定を変更しない |
| AC-5 | Workspace owner / failure-path test | `finally`で一時rootを再帰削除 |

## 責務・境界

### Isolated package probe

`test/helpers/npm-pack.ts` は1回のprobeについて次だけを担う。

1. OS一時directory内へ専用workspaceを作る。
2. package rootをsnapshot copyする。ただし環境状態の`.git`・`.worktrees`、依存の
   `node_modules`、共有生成物の`bin`はcopyしない。
3. 読取り専用依存境界として元の`node_modules`をsnapshotへsymlinkする。
4. snapshotをcwdとして`npm pack --dry-run --json`を通常どおり実行し、files一覧を返す。
5. 成功・spawn失敗・JSON不正の全経路でworkspace ownerが`finally` cleanupする。

元package rootは読取り入力であり、probeへ書込みAPIを公開しない。`bin`をcopyしないため、packへ
入るCLIはsnapshot内の`prepare`が現在のsourceから生成した実物となる。

### Package contract assertions

`test/integration/package-files.test.ts` はprobeのfiles出力だけを受け取り、SPECの必須集合・禁止集合を
検査する。workspace作成やnpm process管理は持たない。2つの既存package契約テストは同じhelperを
個別に呼び、Node test runnerが並行配置しても別workspaceを所有する。

### Controlled race fixture

回帰テストは使い捨てfixture packageを作る。fixtureの`prepare`は外部markerを作成後、snapshot内の
CLIを一時的に不正な内容へして待機し、最後に正常CLIを生成する。テストはmarkerを観測した時点で
fixture元rootの正常CLIを起動する。probeが誤って元rootでlifecycleを動かせばCLI loadが必ず失敗し、
隔離されていればusage・lint相当の正常結果を返す。

cleanup反例は失敗する`prepare`を持つfixtureと専用temp parentを使い、reject後に子workspaceが
残らないことを検査する。一時path自体をproduct APIや永続状態へ保存しない。

## 依存関係とデータフロー

```text
package-files assertions ─┐
controlled race fixture ──┴→ isolated package probe → OS temp snapshot → npm pack
                                  ↓ read-only
                           source root / node_modules
```

依存方向はassertionからprobe、probeから外部npmへの一方向で、productの`src/`はtest helperへ
依存しない。別probe間でworkspace、marker、生成物を共有しない。

## 代替案と判断

- `--ignore-scripts`: 共有書換えは止まるが、公開時に動く`prepare`と現在sourceからのCLI生成を
  検証できないため不採用。
- test全体の直列化またはmutex: 共有可変状態を残し、別processとの競合も防げないため不採用。
- repository rootの`outDir`切替: package scriptとproduction build契約を変更するため不採用。
- 採用: package sourceを使い捨てsnapshotへ移し、実際のnpm lifecycleをその境界内で実行する。

## 障害・セキュリティ・ロールバック

- copy・symlink・npm・JSON parseの失敗は成功扱いせず、cleanup後に元のerrorを返す。
- `.git`と`.worktrees`をcopyしないため、別worktreeやcredential-bearing Git metadataを一時領域へ
  展開しない。commandは固定引数の`execFile`で起動し、shell文字列を解釈しない。
- symlink対象は固定の`node_modules`だけで、fixtureに依存が無い場合は作成しない。
- ロールバックはhelperと回帰テストを戻し、package-files testを元の直接probeへ戻す。ただしその場合は
  既知raceが復活するため、revert前に代替隔離策を要求する。
- CLI本体、package manifest、公開files契約は変更しない。

## 完了条件・未決事項・関連ADR

- 全ACの自動テスト、既定並列度の全テスト3回以上、型検査、規約lintを成功させる。
- 未決事項はない。本設計の長期判断は同checkpointのproposed ADRで記録する。

```yaml
related_adrs: []
```
