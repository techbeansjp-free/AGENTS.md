-- workflow.db スキーマの正本（SQL）
-- 本ファイルが workflow.db の全実在テーブル（現状 workflow_log の 1 つ）と索引定義の単一正本。
-- 新規 DB 作成時は setup.sh:init_workflow_db / write-workflow-log.sh が本 SQL をそのまま流す。
-- 実在テーブルを増やす場合は必ず本ファイルに CREATE TABLE を追加する（schema.md 側には書かない）。
-- 仕様の記述・解説・移行手順は ledger/schema.md を参照（schema.md の SQL は解説/例示で実体ではない）。

CREATE TABLE IF NOT EXISTS workflow_log (
  entry_id TEXT PRIMARY KEY,
  parent_entry_id TEXT NULL,
  document_id TEXT NULL,
  ts_utc TEXT NOT NULL,
  created_at TEXT NOT NULL,

  actor_role TEXT NOT NULL,
  delegated_by_role TEXT NOT NULL,

  command TEXT NOT NULL,
  issue_id TEXT NULL,
  review_id TEXT NULL,
  issue_path TEXT NULL,
  review_path TEXT NULL,
  document_path TEXT NULL,
  changed_files_json TEXT NULL,

  summary TEXT NOT NULL,
  dod_met INTEGER NOT NULL CHECK (dod_met IN (0, 1)),

  prev_hash TEXT NULL,
  entry_hash TEXT NOT NULL,

  CHECK (length(entry_id) > 0),
  CHECK (length(ts_utc) > 0),
  CHECK (length(created_at) > 0),
  CHECK (length(actor_role) > 0),
  CHECK (length(delegated_by_role) > 0),
  CHECK (length(command) > 0),
  CHECK (length(summary) > 5),
  CHECK (actor_role = 'scribe'),
  CHECK (delegated_by_role = 'orchestrator'),
  CHECK (command IN (
    'requirement-discovery',
    'design-feature',
    'implement-feature',
    'verify-and-close',
    'review-docs',
    'create-pr-review-issue'
  ))
);

CREATE INDEX IF NOT EXISTS idx_workflow_log_ts_utc ON workflow_log(ts_utc);
CREATE INDEX IF NOT EXISTS idx_workflow_log_command ON workflow_log(command);
CREATE INDEX IF NOT EXISTS idx_workflow_log_parent ON workflow_log(parent_entry_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_document_id ON workflow_log(document_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_issue_id ON workflow_log(issue_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_review_id ON workflow_log(review_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_document_path ON workflow_log(document_path) WHERE document_path IS NOT NULL;
