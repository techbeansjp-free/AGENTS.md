-- ワークフローログ用 SQLite スキーマ（最小）
-- workflow.db に適用。必ず .gitignore に workflow.db を追加すること。
-- 参照: .agents/ledger/ワークフローログ_SQLiteスキーマ.md
--
-- 既存 DB 移行時: NOT NULL 制約を追加する場合は、既存行に NULL があると ALTER が失敗する。
-- 手順: (1) カラムを NULL 許容で追加 (2) 既存行をバックフィル (3) NOT NULL を付与。

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
  target_artifact TEXT NOT NULL,  -- CONTRACT §2 必須。空禁止。
  input_ref    TEXT,
  output_ref   TEXT,
  summary      TEXT NOT NULL,     -- CONTRACT §2 必須。空禁止。
  error_flag   INTEGER DEFAULT 0,
  human_required INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_issue ON execution_logs(issue_id);
CREATE INDEX IF NOT EXISTS idx_logs_agent ON execution_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON execution_logs(timestamp);
