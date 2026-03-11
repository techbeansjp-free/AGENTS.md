# 書記 I/O 契約（一枚）

**書記（scribe）の入出力・保存先・呼び出し条件を一意に定める。** 実装は skills/logging/write-workflow-log が従う。

---

## 誰が呼べるか

| 呼び出し元 | 条件 |
|------------|------|
| **orchestrator（親）** | 検証・クローズや phase 完了時に**必ず**書記へ委譲する。書記未実行のまま次 Task に進んではならない。enforcement で拒否する。 |
| **単体 capability として** | LOAD_POLICY の「単体 capability」に従い、write-workflow-log を呼ぶ場合のみ。 |

---

## 何を受け取るか（入力）

| 項目 | 必須 | 説明 |
|------|------|------|
| command | ○ | 実行した command 名（例: requirement-discovery, design-feature, implement-feature, verify-and-close） |
| issue_path | △ | 対象 issue のパス（.workflow/YYYYMMDD_HHMMSS_* 形式のフォルダ名を必須とする）。不明時は空でも可。 |
| summary | ○ | 実施内容の要約（1 文以上）。 |
| changed_files | △（implement-feature は必須） | 変更ファイル一覧（改行区切りまたは JSON）。implement-feature 時は必須。 |
| dod_met | ○ | DoD 達成 0 または 1。 |
| memo ファイルパス（memo 運用時） | △ | memo_ref に登録する memo の相対パス。過渡的・例外・**非推奨**運用時のみ。本則は workflow.db。 |

---

## 何を出力するか（出力）

- **workflow.db 採用時**: workflow_log テーブルに 1 行を INSERT。必須キーを満たす。記録は .agents/scripts/write-workflow-log.sh 経由で行うこと。
- **memo 運用時**: .workflow/{issue}/memo/ に YYYYMMDD_HHMMSS_ プレフィックスの .md を 1 件以上作成し、CONTRACT 準拠の内容を記載。**{issue} は YYYYMMDD_HHMMSS_ をプレフィックスとするフォルダ名（必須）。** 必要に応じて memo_ref に登録。**memo のみの運用は非推奨（移行モード）であり、将来の仕様で廃止予定とする。** 採用可能なプロジェクトは workflow.db を必ず用いること。

---

## 必須キー一覧

**workflow_log テーブル**（[ledger/schema.md](../ledger/schema.md) 準拠）:

| キー | 型 | 必須 | 説明 |
|------|-----|------|------|
| ts_utc | TEXT | ○ | ISO8601 時刻。 |
| command | TEXT | ○ | 上記「何を受け取るか」の command。 |
| issue_path | TEXT | △ | 対象 issue パス。 |
| summary | TEXT | ○ | 実施内容の要約。 |
| changed_files | TEXT | △ | 変更ファイル一覧。 |
| dod_met | INTEGER | ○ | 0 または 1。 |
| created_at | TEXT | ○ | デフォルトで datetime('now')。 |

**推奨スキーマ（チェーン型証跡）**（[ledger/schema.md](../ledger/schema.md) の推奨スキーマ完成版）では、さらに以下を記録する。write-workflow-log.sh は環境変数で受け取る。

| キー | 型 | 必須 | 説明 |
|------|-----|------|------|
| entry_id | TEXT | ○（新スキーマ） | 1 レコードを一意に識別。未指定時はラッパーが UUID を生成。 |
| parent_entry_id | TEXT | △（verify-and-close は必須） | 親ログの entry_id。順序監査で使用。 |
| actor_role | TEXT | ○（新スキーマ） | 実行主体。本則は `scribe`。 |
| delegated_by_role | TEXT | ○（新スキーマ） | 委譲元。原則 `orchestrator`。 |
| review_path | TEXT | △（verify-and-close は必須） | 例: .workflow/{issue}/04_review.md。 |
| changed_files_json | TEXT | △（implement-feature は必須） | 変更ファイル一覧の JSON 配列文字列。 |

**必須キー不足時**: 記録を失敗とみなし、親にエラーを返す。完了とみなさない。

**memo ファイル**（workflow.db を採用しない場合）:

| 項目 | 必須 | 説明 |
|------|------|------|
| ファイル名 | ○ | YYYYMMDD_HHMMSS_ プレフィックス（日本標準時・実行環境の現在時刻取得。推測禁止）。**プレフィックスの日時部分を手入力・固定値・推測で指定してはならない。必ず実行時に `date` 等で取得する。** |
| 内容 | ○ | 実施内容・変更・完了判定が分かる形式。ledger/schema の workflow_log と同等の情報を含む。 |

---

## どこに保存するか

**本則**: 書記の記録先は **workflow.db を採用することが本則（第一の選択）** とする。**通常運用では workflow.db のみを用い、memo 出力は workflow.db を採用しないプロジェクトの移行期・例外時のみ許容する。** 証跡の正本は workflow.db（[ledger/README.md](../ledger/README.md)・[ledger/schema.md](../ledger/schema.md) 準拠）に集約する。**新規プロジェクトでは memo のみ運用の採用を禁止する。** 既存の memo のみ運用は移行期のみ許容し、**将来のメジャーバージョンで memo 出力経路を削除する予定**である。

| 運用 | 保存先 | 備考 |
|------|--------|------|
| **workflow.db 採用（本則）** | プロジェクトで定めた 1 パス（推奨: .workflow/workflow.db）。[ledger/README.md](../ledger/README.md) の配置に従う。 | 証跡の正本。採用可能なプロジェクトは必ずこちらを用いる。 |
| **memo のみ（過渡的・例外）** | .workflow/{issue}/memo/ に YYYYMMDD_HHMMSS_*.md。**{issue} は YYYYMMDD_HHMMSS_ をプレフィックスとするフォルダ名（必須）。** 例: .workflow/20260310_090428_issue-title/memo/20260310_132042_実施結果.md | workflow.db を採用しない場合の過渡的・例外運用。**memo はログの別経路ではなく、workflow.db を採用しない場合の一時的・移行用の思考メモである。** 第一の選択肢ではない。**非推奨。移行モード。将来廃止予定。** |

---

## 参照

- [scribe/README.md](README.md) — 誰がどこに書くか
- [ledger/schema.md](../ledger/schema.md) — workflow.db スキーマ
- [ledger/README.md](../ledger/README.md) — 配置・役割境界
- [agents/scribe.md](../agents/scribe.md) — 書記の責務
