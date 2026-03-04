# Ledger（workflow.db）

- **schema.sql**: 本ディレクトリの `schema.sql` を `workflow.db` に適用して使用する。
- **運用**: 書記のみが INSERT。配置はプロジェクトルートまたは `.workflow/` 直下。**必ず .gitignore に `workflow.db` を追加する。** 受け入れ条件は [workers/README](../workers/README.md) および [ワークフローログ_SQLiteスキーマ](./ワークフローログ_SQLiteスキーマ.md) を参照。
