-- ワークフローログ用 SQLite スキーマ（最小）
-- workflow.db に適用。必ず .gitignore に workflow.db を追加すること。
-- 参照: .agents/ledger/ワークフローログ_SQLiteスキーマ.md
--
-- 既存 DB 移行時: SQLite は ALTER COLUMN で NOT NULL 追加ができない。手順: (1) 新テーブルを CREATE TABLE AS または希望スキーマで作成
-- (2) 既存データをコピー／バックフィル (3) 旧テーブルを RENAME して退避 (4) 新テーブルを execution_logs に RENAME (5) 旧テーブルを DROP。

-- issue 一覧（全 issue に UUID を振る）
CREATE TABLE IF NOT EXISTS issues (
  issue_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  workflow_path TEXT,
  created_at TEXT NOT NULL,
  status     TEXT DEFAULT 'open'
);

-- 実行ログ（書記のみが INSERT）
CREATE TABLE IF NOT EXISTS execution_logs (
  log_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id     TEXT NOT NULL REFERENCES issues(issue_id),
  timestamp    TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  action_type  TEXT NOT NULL,
  target_artifact TEXT NOT NULL CHECK (length(trim(target_artifact)) > 0),  -- CONTRACT §2 必須。空禁止。
  input_ref    TEXT,
  output_ref   TEXT,
  summary      TEXT NOT NULL CHECK (length(trim(summary)) > 0),     -- CONTRACT §2 必須。空禁止。
  error_flag   INTEGER DEFAULT 0,
  human_required INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_issue ON execution_logs(issue_id);
CREATE INDEX IF NOT EXISTS idx_logs_agent ON execution_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON execution_logs(timestamp);
