# Ledger（workflow.db）

- **schema.sql**: 本ディレクトリの `schema.sql` を `workflow.db` に適用して使用する。
- **運用**: 書記のみが INSERT。**配置は `.workflow/` 直下**（`.workflow/workflow.db`）。**AGENTS-spec には最初から `.workflow/.gitignore`（`workflow.db` を無視）が含まれており**、`.workflow/` をコピーすれば workflow.db は Git 管理外になる。ルートの `.gitignore` に `.workflow/workflow.db` を追加してもよい。受け入れ条件は [workers/README](../workers/README.md) および [ワークフローログ_SQLiteスキーマ](./ワークフローログ_SQLiteスキーマ.md) を参照。
