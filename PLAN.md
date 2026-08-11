# PLAN: writer leaseの現在状態を副作用無しで確認できる読み取り専用コマンドが無く、Issueコメントの古い記録を誤って現在状態と誤認しうる

- Issue: `ISSUE-602`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `classifyLeaseState` の追加 | `src/lib/github-lease.ts` へ、`LeaseRefEntry`（またはローカルモードの `WriterLease`）と現在時刻から `not_found`／`expired`／`active` の3値と残り秒数を導出する純粋関数を追加する。GitHubモード・ローカルモード双方の `LeaseStatusCommand` から共通利用する。既存export（`allLeasesFor` 等）は変更しない。 | `AC-1, AC-3` | なし |
| 2 | GitHubモードの読み取り経路の実装 | `LeaseStatusCommand` から、segment指定時は `allLeasesFor(number).find(segment一致)`、segment省略時は `activeLeasesFor(number)`（いずれも既存関数）を呼び出し、#1の分類関数へ渡す。`git fetch` の終了コード・stderrを判定し、認証・接続エラー相当の場合は `fail()` として異常終了させる分岐を追加する（DESIGN.mdの失敗モード3対応）。 | `AC-1, AC-2, AC-3, AC-5, AC-6` | `#1` |
| 3 | ローカルモードの読み取り経路の実装 | `LeaseStatusCommand` から、`leaseFilePath` と既存の `tryReadYamlFile` を使い `lease.yaml` を読む。segment指定時はファイル内の `segment` フィールドと不一致なら `not_found` として扱う。segment省略時はファイルが存在し期限内であればそのまま返す。 | `AC-1, AC-3, AC-5, AC-6` | `#1` |
| 4 | 出力整形（人間可読／`--json`） | `src/commands/lease.ts` に `status(args: string[])` を新規exportし、`issue_id`・任意の`segment`・`--json` フラグを解釈する。既定は `holder`・`segment`・`acquired_at`・`expires_at`・残り時間を含む人間可読な要約を標準出力へ、`--json` 指定時は同一情報を構造化データとして標準出力へ返す。`STATUS_USAGE` 文字列と `-h`/`--help` 対応も既存の他サブコマンドと同じパターンで追加する。 | `AC-1, AC-3, AC-4, AC-5` | `#2, #3` |
| 5 | CLIディスパッチ登録 | `src/lib/cli-routes.ts` の `routes` へ `'lease status': lease.status` を1行追加する。既存route定義（`lease acquire` 等）は変更しない。 | `AC-1` | `#4` |
| 6 | 既存lease系サブコマンドの回帰確認 | 変更単位1〜5の適用後、既存の `test/unit/github-lease.test.ts`・`test/integration/lease-reclaim.test.ts`・`test/integration/lease-renew.test.ts`・`test/integration/lease-resume.test.ts`・`test/integration/lease-concurrency.test.ts` を無変更のまま実行し、`acquire`/`release`/`renew`/`resume`/`reclaim` の標準出力・標準エラー出力・終了コードに変更が無いことを確認する。 | `AC-7` | `#5` |
| 7 | `lease status` 用テストの追加 | AC-1〜AC-6それぞれに対応するユニット・統合テスト（有効lease表示、Issueコメントとの不一致再現、lease無し/期限切れの区別、`--json`出力のパース可能性、segment省略時の全件表示、credential不在での実行）を新規追加する。 | `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6` | `#5` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
