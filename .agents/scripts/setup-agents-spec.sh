#!/usr/bin/env bash
# setup-agents-spec.sh — 初回セットアップ
# 本 .agents/ をプロジェクトの .agents/ にコピーし、AGENTS.md / CLAUDE.md をルートに配置する。
# .claude/・.cursor/ の生成とスキル同期・テンプレートコピーを行う。
# 配置: AGENTS-spec/.agents/scripts/。参照: COPY_TO_PROJECT_ROOT.md

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_SOURCE="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_ROOT="${1:-$(cd "$PACKAGE_ROOT/.." && pwd)}"

if [[ ! -d "$AGENTS_SOURCE" ]]; then
  echo "Error: .agents not found at $AGENTS_SOURCE. Run from project root: bash AGENTS-spec/.agents/scripts/setup-agents-spec.sh" >&2
  exit 1
fi

echo "Project root:  $PROJECT_ROOT"
echo "Package root:  $PACKAGE_ROOT"
echo "Agents source: $AGENTS_SOURCE"

for f in AGENTS.md CLAUDE.md; do
  if [[ -f "$PACKAGE_ROOT/$f" ]]; then
    cp "$PACKAGE_ROOT/$f" "$PROJECT_ROOT/$f"
    echo "Copied $f to project root."
  fi
done

if [[ -d "$PROJECT_ROOT/.agents" ]]; then
  echo "Warning: .agents already exists. Skipping copy. Remove or backup it to overwrite with new .agents." >&2
else
  cp -R "$AGENTS_SOURCE" "$PROJECT_ROOT/.agents"
  echo "Copied AGENTS-spec/.agents to .agents."
fi

# プロジェクトの .workflow/templates が無い場合、AGENTS-spec/.workflow/templates からコピーする
WF_TEMPLATES="$PROJECT_ROOT/.workflow/templates"
WF_SOURCE="$PACKAGE_ROOT/.workflow/templates"
if [[ ! -d "$WF_TEMPLATES" ]] && [[ -d "$WF_SOURCE" ]]; then
  mkdir -p "$PROJECT_ROOT/.workflow"
  cp -R "$WF_SOURCE" "$PROJECT_ROOT/.workflow/"
  echo "Copied templates from AGENTS-spec/.workflow/templates to .workflow/templates."
fi

# スキルをプラットフォーム別パスに同期する（.claude/skills, .cursor/skills）
# 配備先は {domain}__{capability} で一意にし、異なる domain の同名 capability の衝突を防ぐ。参照: platforms/DESIGN_SYNC_SKILLS_NAMING.md
sync_skills() {
  local dest_root="$1"
  local agents_skills="${2:-$PROJECT_ROOT/.agents/skills}"
  [[ ! -d "$agents_skills" ]] && return 0
  mkdir -p "$dest_root"
  for domain_dir in "$agents_skills"/*/; do
    [[ -d "$domain_dir" ]] || continue
    domain=$(basename "$domain_dir")
    [[ -z "$domain" ]] && continue
    for cap_dir in "$domain_dir"*/; do
      [[ -d "$cap_dir" ]] || continue
      cap_name=$(basename "$cap_dir")
      [[ -z "$cap_name" ]] && continue
      if [[ -f "$cap_dir/SKILL.md" ]] || [[ -f "$cap_dir/README.md" ]]; then
        deploy_name="${domain}__${cap_name}"
        mkdir -p "$dest_root/$deploy_name"
        cp -R "$cap_dir"/* "$dest_root/$deploy_name/" 2>/dev/null || true
      fi
    done
  done
}
if [[ -d "$PROJECT_ROOT/.agents" ]]; then
  sync_skills "$PROJECT_ROOT/.claude/skills" "$PROJECT_ROOT/.agents/skills"
  sync_skills "$PROJECT_ROOT/.cursor/skills" "$PROJECT_ROOT/.agents/skills"
  echo "Synced skills to .claude/skills and .cursor/skills."
fi

CLAUDE_DIR="$PROJECT_ROOT/.claude"
mkdir -p "$CLAUDE_DIR"
if [[ -d "$PROJECT_ROOT/.agents/enforcement/claude" ]]; then
  mkdir -p "$CLAUDE_DIR/hooks"
  cp -R "$PROJECT_ROOT/.agents/enforcement/claude/"* "$CLAUDE_DIR/hooks/" 2>/dev/null || true
  echo "Created .claude/ from enforcement/claude."
else
  echo "Note: enforcement/claude not found; .claude/ created empty."
fi

CURSOR_DIR="$PROJECT_ROOT/.cursor"
mkdir -p "$CURSOR_DIR"
if [[ -d "$PROJECT_ROOT/.agents/enforcement/cursor" ]]; then
  cp -R "$PROJECT_ROOT/.agents/enforcement/cursor/"* "$CURSOR_DIR/" 2>/dev/null || true
  echo "Created .cursor/ from enforcement/cursor."
else
  echo "Note: enforcement/cursor not found; .cursor/ created empty."
fi

# 証跡 DB を setup 時に生成（実体は Git 管理対象外。配布物に含めない）
init_workflow_db() {
  local db="$PROJECT_ROOT/.workflow/workflow.db"
  if [[ -f "$db" ]]; then
    return 0
  fi
  echo "[setup] creating workflow database"
  mkdir -p "$(dirname "$db")"
  sqlite3 "$db" <<'SQL'
CREATE TABLE IF NOT EXISTS workflow_log (
  entry_id TEXT PRIMARY KEY,
  parent_entry_id TEXT NULL,
  ts_utc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  delegated_by_role TEXT NOT NULL,
  command TEXT NOT NULL,
  issue_path TEXT NULL,
  review_path TEXT NULL,
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
  CHECK (command IN ('requirement-discovery', 'design-feature', 'implement-feature', 'verify-and-close'))
);
CREATE INDEX IF NOT EXISTS idx_workflow_log_ts_utc ON workflow_log(ts_utc);
CREATE INDEX IF NOT EXISTS idx_workflow_log_command ON workflow_log(command);
CREATE INDEX IF NOT EXISTS idx_workflow_log_parent ON workflow_log(parent_entry_id);
SQL
}

init_workflow_db

echo "Setup done. Check AGENTS-spec/COPY_TO_PROJECT_ROOT.md for smoke test."
