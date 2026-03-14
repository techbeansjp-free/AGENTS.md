#!/usr/bin/env bash
# setup-agents-spec.sh — 初回セットアップ
# 本 .agents/ をプロジェクトの .agents/ にコピーし、AGENTS.md / CLAUDE.md をルートに配置する。
# .claude/・.cursor/ の生成とスキル同期・テンプレートコピーを行う。
# 配置: AGENTS-spec/.agents/scripts/。参照: SETUP.md

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_SOURCE="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_ROOT="${1:-$(cd "$PACKAGE_ROOT/.." && pwd)}"

if [[ ! -d "$AGENTS_SOURCE" ]]; then
  echo "エラー: .agents が見つかりません: $AGENTS_SOURCE。プロジェクトルートで実行してください: bash AGENTS-spec/.agents/scripts/setup-agents-spec.sh" >&2
  exit 1
fi

echo "プロジェクトルート:  $PROJECT_ROOT"
echo "パッケージルート:    $PACKAGE_ROOT"
echo "Agents ソース:       $AGENTS_SOURCE"

for f in AGENTS.md CLAUDE.md; do
  if [[ -f "$PACKAGE_ROOT/$f" ]]; then
    cp "$PACKAGE_ROOT/$f" "$PROJECT_ROOT/$f"
    echo "$f をプロジェクトルートにコピーしました。"
  fi
done

if [[ -d "$PROJECT_ROOT/.agents" ]]; then
  rm -rf "$PROJECT_ROOT/.agents"
  echo "既存の .agents を削除しました。"
fi
cp -R "$AGENTS_SOURCE" "$PROJECT_ROOT/.agents"
echo "AGENTS-spec/.agents を .agents にコピーしました。"

# .agents-project はプロジェクト固有のため、なければコピー・既存なら上書きしない
if [[ ! -d "$PROJECT_ROOT/.agents-project" ]] && [[ -d "$PACKAGE_ROOT/.agents-project" ]]; then
  cp -R "$PACKAGE_ROOT/.agents-project" "$PROJECT_ROOT/.agents-project"
  echo "AGENTS-spec/.agents-project をプロジェクトにコピーしました（初回のみ）。"
fi

# .workflow/templates は常に AGENTS-spec の内容で最新化する
WF_TEMPLATES="$PROJECT_ROOT/.workflow/templates"
WF_SOURCE="$PACKAGE_ROOT/.workflow/templates"
if [[ -d "$WF_SOURCE" ]]; then
  rm -rf "$WF_TEMPLATES"
  mkdir -p "$PROJECT_ROOT/.workflow"
  cp -R "$WF_SOURCE" "$PROJECT_ROOT/.workflow/"
  echo "AGENTS-spec/.workflow/templates を .workflow/templates にコピーしました（常に最新化）。"
fi

# スキルをプラットフォーム別パスに同期する（.claude/skills, .cursor/skills）
# 配備先は {domain}__{capability} で一意にし、異なる domain の同名 capability の衝突を防ぐ。参照: platforms/DESIGN_SYNC_SKILLS_NAMING.md
# 常に最新にするため、同期前に既存のスキル配備先を削除する。
sync_skills() {
  local dest_root="$1"
  local agents_skills="${2:-$PROJECT_ROOT/.agents/skills}"
  [[ ! -d "$agents_skills" ]] && return 0
  rm -rf "$dest_root"
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

CLAUDE_DIR="$PROJECT_ROOT/.claude"
mkdir -p "$CLAUDE_DIR"
if [[ -d "$PROJECT_ROOT/.agents/enforcement/claude" ]]; then
  rm -rf "$CLAUDE_DIR/hooks"
  mkdir -p "$CLAUDE_DIR/hooks"
  cp -R "$PROJECT_ROOT/.agents/enforcement/claude/"* "$CLAUDE_DIR/hooks/" 2>/dev/null || true
  echo "enforcement/claude から .claude/ を最新化しました。"
else
  echo "注: enforcement/claude が見つかりません。.claude/ を空で作成しました。"
fi

CURSOR_DIR="$PROJECT_ROOT/.cursor"
if [[ -d "$PROJECT_ROOT/.agents/enforcement/cursor" ]]; then
  rm -rf "$CURSOR_DIR"
  mkdir -p "$CURSOR_DIR"
  cp -R "$PROJECT_ROOT/.agents/enforcement/cursor/"* "$CURSOR_DIR/" 2>/dev/null || true
  echo "enforcement/cursor から .cursor/ を最新化しました。"
else
  mkdir -p "$CURSOR_DIR"
  echo "注: enforcement/cursor が見つかりません。.cursor/ を空で作成しました。"
fi

if [[ -d "$PROJECT_ROOT/.agents" ]]; then
  sync_skills "$PROJECT_ROOT/.claude/skills" "$PROJECT_ROOT/.agents/skills"
  sync_skills "$PROJECT_ROOT/.cursor/skills" "$PROJECT_ROOT/.agents/skills"
  echo "スキルを .claude/skills と .cursor/skills に同期しました。"
fi

# 証跡 DB を setup 時に生成（実体は Git 管理対象外。配布物に含めない）
init_workflow_db() {
  local db="$PROJECT_ROOT/.workflow/workflow.db"
  if [[ -f "$db" ]]; then
    return 0
  fi
  echo "[setup] ワークフロー用 DB を作成しています"
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

echo "セットアップ完了。スモークテストは .agents/SETUP.md を参照してください。"
