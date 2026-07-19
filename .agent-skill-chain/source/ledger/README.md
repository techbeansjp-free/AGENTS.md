# ledger — workflow.db の配置・スキーマ

**ログは SQLite（workflow.db）を用いる**。書記（write-workflow-log）のみが書き込む。**workflow.db が無ければ作成する**（初回実行時に [schema.sql](schema.sql) を流して作成）。

---

## 配置

- **配置先**: プロジェクトルートの **.agent-skill-chain/runtime/workflow.db** を推奨。または .agent-skill-chain/source/ledger/ 配下など、書記のみが書き込む一意のパスをプロジェクトで定める。
- **スキーマ定義ファイル**: SQL の実体は本ディレクトリの [schema.sql](schema.sql)、仕様の解説は [schema.md](schema.md) を参照する。write-workflow-log capability はこのスキーマに従って記録する。**DB が存在しなければ、schema.sql を流して作成すること。**
- **Git 管理・配布**: **workflow.db の実体および SQLite WAL モードの sidecar（workflow.db-wal, workflow.db-shm）は Git 管理対象外とする。** .agent-skill-chain/runtime/.gitignore に `workflow.db`, `workflow.db-wal`, `workflow.db-shm` を記載すること。テンプレート・spec の配布物に DB 実体を含めない。証跡の正本はローカルまたは CI で生成される DB であり、リポジトリにはスキーマ定義のみを管理する。

workflow.db を採用しない場合は、scribe/README に従い memo 等で CONTRACT 準拠の暫定記録を行う。

---

## 役割境界（何をどこに書くか・正本はどれか）

| 対象 | 役割 | 誰が書くか | 人間が読む「正本」か |
|------|------|------------|----------------------|
| **workflow.db** | トレーサビリティの**正本**。いつ・どの command・どの issue・何をしたか・DoD 達成有無を記録する。 | 書記（write-workflow-log）のみ | **はい。** 「何がいつ行われたか」を参照する正本は workflow.db（またはその export）。 |
| **04_review.md / docs のレビュー書** | 人間向けレビュー記録。プロジェクトのレビュー内容・確認観点。 | レビュー担当（verify-and-close 等） | レビュー内容の正本。トレーサビリティ正本ではない。 |
| **pre-push ログ** | ローカルでの push 前チェック結果。デバッグ・違反検知用。 | pre-push スクリプト | いいえ。ローカル/CI 用。正本ではない。 |
| **CI / audit ログ** | ビルド・テスト・監査スクリプトの結果。監査・差し戻し判定用。 | CI / audit スクリプト | いいえ。判定結果の記録。トレーサビリティ正本は workflow.db のみ。 |
| **memo（YYYYMMDD_HHMMSS_*.md）** | workflow.db を採用しない場合の CONTRACT 準拠の暫定証跡。 | 書記のみ | workflow.db の代替として正本になり得る。採用時はプロジェクトでどちらを正本とするか明記する。 |

**運用上の原則**

- **workflow.db に必ず書くもの**: schema.md で定義した必須カラム（ts_utc, command, issue_path, summary, changed_files_json, dod_met 等。列名の正本は [schema.md](schema.md) を参照）。1 実行 = 1 行を基本とする。
- **docs/00_review や 04_review との関係**: レビュー「内容」は 04_review.md 等に残す。実行「事実」（いつ・誰が・何をしたか）は workflow.db に残す。両方揃って証跡が完結する。
- **人間が読みに行く正本**: トレーサビリティは **workflow.db**（または export したレポート）。レビュー内容は **04_review.md / docs のレビュー書**。
