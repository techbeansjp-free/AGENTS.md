# ワークフローログ：SQLite スキーマ（最小）とログ必須項目

> **AI 向け**: MVP で採用した **方式 C（SQLite）** のスキーマと、書記が記録する**ログ必須項目**の定義。書記役は [書記役とログ委譲](../scribe/書記役とログ委譲.md) のとおり唯一の書者とする。**トレーサビリティ（誰が何をしたか）は最初から必須**。メインは各サブ実行後に書記へログ項目を委譲する。

---

## 1. 前提

- **workflow.db** は **`.workflow/` 直下**に配置する（パス: `.workflow/workflow.db`）。**AGENTS-spec には `.workflow/.gitignore`（`workflow.db`）が最初から含まれており**、`.workflow/` をコピーすれば無視される。ルートの .gitignore に `.workflow/workflow.db` を追加してもよい。Git 管理外とする。
- **SQLite の外部キー制約**: SQLite はデフォルトで `PRAGMA foreign_keys` が OFF のため、`execution_logs` の `REFERENCES issues(issue_id)` を有効にするには**接続ごとに** `PRAGMA foreign_keys = ON;` を実行すること。DB 接続直後（またはクライアントの接続オプション）で設定し、スキーマ初期化・マイグレーションスクリプトにも同 pragma を含めることを推奨する。
- **受け入れ条件**: 「workflow.db を Git 管理外にすること」（`.workflow/.gitignore` をコピーしているか、ルート .gitignore に `.workflow/workflow.db` を追加する）を **書記サブ導入タスク** または **初回セットアップ（SQLite 利用開始）タスク** の受け入れ条件に明示し、漏れを防ぐ。詳細は [workers/README](../workers/README.md) を参照。
- 書記のみが INSERT。他は書記にログ項目を渡すだけ。書き込みはキュー＋単一書者で直列化する。

---

## 2. SQLite スキーマ（最小 DDL）

```sql
-- issue 一覧（全 issue に UUID を振る）
CREATE TABLE IF NOT EXISTS issues (
  issue_id   TEXT PRIMARY KEY,  -- UUID
  name       TEXT NOT NULL,
  workflow_path TEXT,           -- .workflow/YYYYMMDD_HHMMSS_名前/ 等
  created_at TEXT NOT NULL,     -- ISO8601
  status     TEXT DEFAULT 'open'
);

-- 実行ログ（書記のみが INSERT）
CREATE TABLE IF NOT EXISTS execution_logs (
  log_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id     TEXT NOT NULL REFERENCES issues(issue_id),
  timestamp    TEXT NOT NULL,   -- ISO8601
  agent_id     TEXT NOT NULL,   -- 人格識別子（要件/BDDリード, 実装者, 書記 等）
  action_type  TEXT NOT NULL,   -- 実装 / レビュー / 監査 / 壁打ち / ログ記録 等
  target_artifact TEXT NOT NULL CHECK (length(trim(target_artifact)) > 0), -- 対象成果物（CONTRACT §2 必須・空禁止）
  input_ref    TEXT,             -- 入力参照
  output_ref   TEXT,             -- 出力参照
  summary      TEXT NOT NULL CHECK (length(trim(summary)) > 0),    -- 人間が読む用の要約（CONTRACT §2 必須・空禁止）
  error_flag   INTEGER DEFAULT 0,        -- 0=正常, 1=エラー
  human_required INTEGER DEFAULT 0,     -- 0=不要, 1=人間介入要（MVP ではフラグのみ、通知は将来拡張）
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_issue ON execution_logs(issue_id);
CREATE INDEX IF NOT EXISTS idx_logs_agent ON execution_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON execution_logs(timestamp);
```

---

## 3. ログ必須項目（書記が受け取るペイロード）

**正本は [scribe/CONTRACT](../scribe/CONTRACT.md) §2 のみ。** メインは CONTRACT §2 の JSON 形式で書記に渡す。本節はスキーマとの対応を示すのみ。必須・任意の区別は CONTRACT に従う。

| 項目 | CONTRACT | 説明 |
|------|----------|------|
| issue_id | 必須 | 対象 issue の識別子。 |
| timestamp | 必須 | 実行時刻（ISO8601）。 |
| created_at | 必須 | 記録日時（ISO8601）。書記が補完可。 |
| agent_id | 必須 | 実行した人格。 |
| action_type | 必須 | CONTRACT §4・EXECUTION_CONTRACT §2.1 に従う。plan / execute / review またはフェーズ名。 |
| target_artifact | 必須 | 主な対象成果物。空禁止。 |
| summary | 必須 | 要約（3 行以内）。空禁止。 |
| input_ref, output_ref, error_flag, human_required | 任意 | 同上。 |

書記は CONTRACT §2 のペイロードを受け取り、`execution_logs` に 1 行 INSERT する。**ログの書き方にブレを出さないため、CONTRACT 以外の形式で渡してはならない。**

---

## 4. マイグレーション（既存 DB に CHECK を追加する場合）

SQLite では既存テーブルに `CHECK` 制約を後から追加する `ALTER TABLE` ができない。既存の workflow.db に `target_artifact` / `summary` の空文字禁止を適用する場合は、次の手順を SQLite 上で行う。

1. 新テーブル `execution_logs_new` を上記 §2 の DDL と同様の定義（CHECK 含む）で作成する。
2. `PRAGMA foreign_keys = OFF;` のうえで、既存 `execution_logs` から `execution_logs_new` へデータをコピーする（空文字・空白のみの行は CONTRACT 違反のため修正するか除外する）。
3. 既存テーブルを `DROP` し、`execution_logs_new` を `ALTER TABLE ... RENAME TO execution_logs` する。
4. インデックスを再作成する。`PRAGMA foreign_keys = ON;` を再設定する。

新規に workflow.db を作る場合は、§2 の DDL をそのまま実行すればよい。

---

## 5. エラー時（MVP）

- サブが失敗 → 同一入力で **1 回だけリトライ**。
- 2 回目も失敗 → **そのフェーズを停止**。書記がログに 1 件書き、`error_flag=1`, `human_required=1` を設定。メインは次フェーズに進まない。
- **人間への通知は MVP では行わない**。ログに `human_required=1` が立っていることを、手動確認または将来の「通知拡張」で扱う。

---

## 6. 参照

- 書記役ルール: [書記役とログ委譲](../scribe/書記役とログ委譲.md)
- MVP 確定: 常時ロード廃止 issue の「意思決定用 2d. MVP 確定案」を参照。
