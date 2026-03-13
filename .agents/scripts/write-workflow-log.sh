#!/usr/bin/env bash
# write-workflow-log.sh — workflow.db への書記用専用ラッパー（1 回 1 行 INSERT のみ）
# 使い方:
#   AGENT_ROLE=scribe .agents/scripts/write-workflow-log.sh command summary dod_met ts_utc [issue_path] [changed_files]
#   ENTRY_ID= PARENT_ENTRY_ID= ACTOR_ROLE=scribe DELEGATED_BY_ROLE=orchestrator 等を任意で指定。
# 位置引数: command summary dod_met ts_utc [issue_path] [changed_files]
# 環境変数: ENTRY_ID, PARENT_ENTRY_ID, DOCUMENT_ID, ACTOR_ROLE, DELEGATED_BY_ROLE, REVIEW_PATH, REVIEW_ID, ISSUE_ID, CHANGED_FILES_JSON, PREV_HASH
# DB パスは固定（.workflow/workflow.db）。引数で別 DB を渡せない。
# 新スキーマ（entry_id 等）の DB では因果チェーン・actor を記録。旧スキーマでは従来どおり INSERT。

set -euo pipefail

# 書記のみ実行可能
if [[ "${AGENT_ROLE:-}" != "scribe" ]]; then
  echo "ERROR: AGENT_ROLE が scribe である必要があります。このスクリプトは書記（scribe）のみが実行できます。" >&2
  exit 1
fi

# 許可 command 一覧（INSERT 専用のため、このリスト外は拒否）
ALLOWED_COMMANDS="requirement-discovery|design-feature|implement-feature|verify-and-close"

escape_sql() {
  printf '%s' "$1" | sed "s/'/''/g"
}

# UUID 生成（uuidgen / python3 / フォールバック）
gen_entry_id() {
  if command -v uuidgen &>/dev/null; then
    uuidgen
    return
  fi
  if command -v python3 &>/dev/null; then
    python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null && return
  fi
  printf '%s-%s-%s-%s-%s' "$(date +%s)" "${RANDOM:-0}" "${RANDOM:-0}" "${RANDOM:-0}" "${RANDOM:-0}"
}

# 新スキーマ用: entry_hash = sha256(entry_id|...|issue_id|review_id|...)。ledger/schema.md と同期する。
gen_entry_hash() {
  local eid="$1" pid="$2" docid="$3" ts="$4" ar="$5" dr="$6" cmd="$7" iid="$8" rid="$9" ip="${10}" rp="${11}" cf="${12}" sum="${13}" dod="${14}"
  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s' "$eid" "$pid" "$docid" "$ts" "$ar" "$dr" "$cmd" "$iid" "$rid" "$ip" "$rp" "$cf" "$sum" "$dod" | sha256sum | awk '{print $1}'
}

# changed_files 文字列を JSON 配列に（カンマ・改行区切り対応）
to_json_array() {
  local raw="${1:-}"
  if [[ -z "$raw" || "$raw" == "[]" ]]; then
    echo "[]"
    return
  fi
  local first=1
  echo -n "["
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    for part in ${line//,/ }; do
      part="${part#"${part%%[![:space:]]*}"}"
      part="${part%"${part##*[![:space:]]}"}"
      [[ -z "$part" ]] && continue
      if [[ $first -eq 1 ]]; then first=0; else echo -n ","; fi
      printf '"%s"' "$(printf '%s' "$part" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    done
  done < <(printf '%s\n' "$raw" | tr ',' '\n')
  echo "]"
}

if ! command -v sqlite3 &>/dev/null; then
  echo "ERROR: sqlite3 がインストールされていません。" >&2
  exit 1
fi

# DB パス固定（引数・環境変数で上書きしない）
PROJECT_ROOT="${PROJECT_ROOT:-.}"
WORKFLOW_DIR="${WORKFLOW_DIR:-.workflow}"
WF_DB="${PROJECT_ROOT}/${WORKFLOW_DIR}/workflow.db"

if [[ $# -lt 4 ]]; then
  echo "Usage: AGENT_ROLE=scribe $0 command summary dod_met ts_utc [issue_path] [changed_files]" >&2
  exit 1
fi

COMMAND="$1"
SUMMARY="$2"
DOD_MET="$3"
TS_UTC="$4"
ISSUE_PATH="${5:-}"
CHANGED_FILES_RAW="${6:-}"

# command 許可リストチェック
if ! printf '%s' "$COMMAND" | grep -qE "^($ALLOWED_COMMANDS)$"; then
  echo "ERROR: 許可されていない command です。許可: requirement-discovery, design-feature, implement-feature, verify-and-close" >&2
  exit 1
fi

# 環境変数で上書き（新スキーマ用）
ACTOR_ROLE="${ACTOR_ROLE:-scribe}"
DELEGATED_BY_ROLE="${DELEGATED_BY_ROLE:-orchestrator}"
REVIEW_PATH="${REVIEW_PATH:-}"
PARENT_ENTRY_ID="${PARENT_ENTRY_ID:-}"
DOCUMENT_ID="${DOCUMENT_ID:-}"
ISSUE_ID="${ISSUE_ID:-}"
REVIEW_ID="${REVIEW_ID:-}"
PREV_HASH="${PREV_HASH:-}"
if [[ -n "${CHANGED_FILES_JSON:-}" ]]; then
  CHANGED_FILES_JSON="$CHANGED_FILES_JSON"
else
  CHANGED_FILES_JSON="$(to_json_array "$CHANGED_FILES_RAW")"
fi

# 共通必須チェック
if [[ -z "$COMMAND" || -z "$SUMMARY" || -z "$TS_UTC" ]]; then
  echo "ERROR: command, summary, ts_utc は必須です。" >&2
  exit 1
fi
if [[ ${#SUMMARY} -le 5 ]]; then
  echo "ERROR: summary は 6 文字以上必要です。" >&2
  exit 1
fi
if [[ "$DOD_MET" != "0" && "$DOD_MET" != "1" ]]; then
  echo "ERROR: dod_met は 0 または 1 を指定してください。" >&2
  exit 1
fi

# command 別必須パラメータ
case "$COMMAND" in
  implement-feature)
    if [[ -z "$CHANGED_FILES_JSON" || "$CHANGED_FILES_JSON" == "[]" ]]; then
      echo "ERROR: implement-feature では changed_files（または CHANGED_FILES_JSON）が必須です。" >&2
      exit 1
    fi
    ;;
  verify-and-close)
    if [[ -z "${REVIEW_PATH:-}" || "${REVIEW_PATH:-}" =~ ^[[:space:]]*$ ]]; then
      if [[ -z "${REVIEW_ID:-}" || "${REVIEW_ID:-}" =~ ^[[:space:]]*$ ]]; then
        echo "ERROR: verify-and-close では REVIEW_PATH または REVIEW_ID が必須です。" >&2
        exit 1
      fi
    fi
    if [[ -z "${PARENT_ENTRY_ID:-}" || "${PARENT_ENTRY_ID:-}" =~ ^[[:space:]]*$ ]]; then
      echo "ERROR: verify-and-close では PARENT_ENTRY_ID が必須です。" >&2
      exit 1
    fi
    ;;
esac

# 同時書き込み対策: 専用ロックファイルで flock 排他取得（利用可能な場合）。INSERT は SQLITE_BUSY 時リトライ（最大 5 回・100 ms）。
LOCK_FILE="${WF_DB}.lock"
MAX_RETRIES=5
RETRY_SLEEP_SEC=0.1
mkdir -p "$(dirname "$WF_DB")"
if command -v flock &>/dev/null; then
  exec 200>>"$LOCK_FILE"
  flock -x 200
fi
WFL_ERRFILE=""
WFL_ERRFILE=$(mktemp 2>/dev/null) || true
if [[ -n "$WFL_ERRFILE" && -f "$WFL_ERRFILE" ]]; then
  trap 'rm -f "$WFL_ERRFILE"' EXIT
fi

# DB が無ければ新スキーマで作成
if [[ ! -f "$WF_DB" ]]; then
  WF_DIR="$(dirname "$WF_DB")"
  mkdir -p "$WF_DIR"
  sqlite3 "$WF_DB" <<'SCHEMA'
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
CREATE INDEX IF NOT EXISTS idx_workflow_log_document_id ON workflow_log(document_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_issue_id ON workflow_log(issue_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_review_id ON workflow_log(review_id);
SCHEMA
fi

sqlite3 "$WF_DB" "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;" >/dev/null

# 新スキーマかどうか（entry_id カラムの有無）
HAS_NEW_SCHEMA=""
if sqlite3 -separator $'\t' "$WF_DB" "PRAGMA table_info(workflow_log);" 2>/dev/null | awk -F '\t' '{print $2}' | grep -qx 'entry_id'; then
  HAS_NEW_SCHEMA=1
fi

# スキーマ検知・マイグレーション（ledger/schema.md の定義順。不足カラムがあれば ADD COLUMN を実行）
if [[ -n "$HAS_NEW_SCHEMA" ]]; then
  CURRENT_COLS="$(sqlite3 -separator $'\t' "$WF_DB" "PRAGMA table_info(workflow_log);" 2>/dev/null | awk -F '\t' '{print $2}')"
  if ! printf '%s' "$CURRENT_COLS" | grep -qx 'document_id'; then
    sqlite3 "$WF_DB" "ALTER TABLE workflow_log ADD COLUMN document_id TEXT NULL; CREATE INDEX IF NOT EXISTS idx_workflow_log_document_id ON workflow_log(document_id);" || { echo "ERROR: document_id マイグレーションに失敗しました。" >&2; exit 1; }
  fi
  if ! printf '%s' "$CURRENT_COLS" | grep -qx 'issue_id'; then
    sqlite3 "$WF_DB" "ALTER TABLE workflow_log ADD COLUMN issue_id TEXT NULL; CREATE INDEX IF NOT EXISTS idx_workflow_log_issue_id ON workflow_log(issue_id);" || { echo "ERROR: issue_id マイグレーションに失敗しました。" >&2; exit 1; }
  fi
  if ! printf '%s' "$CURRENT_COLS" | grep -qx 'review_id'; then
    sqlite3 "$WF_DB" "ALTER TABLE workflow_log ADD COLUMN review_id TEXT NULL; CREATE INDEX IF NOT EXISTS idx_workflow_log_review_id ON workflow_log(review_id);" || { echo "ERROR: review_id マイグレーションに失敗しました。" >&2; exit 1; }
  fi
fi

if [[ -n "$HAS_NEW_SCHEMA" ]]; then
  ENTRY_ID="${ENTRY_ID:-$(gen_entry_id)}"
  CREATED_AT="${CREATED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"
  E_EID="$(escape_sql "$ENTRY_ID")"
  E_PID="$(escape_sql "$PARENT_ENTRY_ID")"
  E_DOCID="$(escape_sql "$DOCUMENT_ID")"
  E_TS="$(escape_sql "$TS_UTC")"
  E_CA="$(escape_sql "$CREATED_AT")"
  E_AR="$(escape_sql "$ACTOR_ROLE")"
  E_DR="$(escape_sql "$DELEGATED_BY_ROLE")"
  E_CMD="$(escape_sql "$COMMAND")"
  E_IID="$(escape_sql "$ISSUE_ID")"
  E_RID="$(escape_sql "$REVIEW_ID")"
  E_IP="$(escape_sql "$ISSUE_PATH")"
  E_RP="$(escape_sql "$REVIEW_PATH")"
  E_CF="$(escape_sql "$CHANGED_FILES_JSON")"
  E_SUM="$(escape_sql "$SUMMARY")"
  E_PH="$(escape_sql "$PREV_HASH")"
  ENTRY_HASH="$(gen_entry_hash "$ENTRY_ID" "$PARENT_ENTRY_ID" "$DOCUMENT_ID" "$TS_UTC" "$ACTOR_ROLE" "$DELEGATED_BY_ROLE" "$COMMAND" "$ISSUE_ID" "$REVIEW_ID" "$ISSUE_PATH" "$REVIEW_PATH" "$CHANGED_FILES_JSON" "$SUMMARY" "$DOD_MET")"
  E_EH="$(escape_sql "$ENTRY_HASH")"
  INSERT_SQL="INSERT INTO workflow_log (entry_id, parent_entry_id, document_id, ts_utc, created_at, actor_role, delegated_by_role, command, issue_id, review_id, issue_path, review_path, changed_files_json, summary, dod_met, prev_hash, entry_hash) VALUES ('$E_EID', NULLIF('$E_PID',''), NULLIF('$E_DOCID',''), '$E_TS', '$E_CA', '$E_AR', '$E_DR', '$E_CMD', NULLIF('$E_IID',''), NULLIF('$E_RID',''), NULLIF('$E_IP',''), NULLIF('$E_RP',''), '$E_CF', '$E_SUM', $DOD_MET, NULLIF('$E_PH',''), '$E_EH');"
  wfl_attempt=1
  while true; do
    if sqlite3 "$WF_DB" "$INSERT_SQL" 2>"${WFL_ERRFILE:-/dev/null}"; then
      break
    fi
    if [[ $wfl_attempt -ge $MAX_RETRIES ]]; then
      [[ -n "${WFL_ERRFILE:-}" && -f "${WFL_ERRFILE:-}" ]] && cat "$WFL_ERRFILE" >&2
      echo "ERROR: workflow_log への INSERT に失敗しました（リトライ上限: ${MAX_RETRIES} 回）。" >&2
      exit 1
    fi
    if [[ -n "${WFL_ERRFILE:-}" && -f "${WFL_ERRFILE:-}" ]] && ! grep -qi "locked\|busy" "$WFL_ERRFILE"; then
      cat "$WFL_ERRFILE" >&2
      echo "ERROR: workflow_log への INSERT に失敗しました。" >&2
      exit 1
    fi
    sleep "$RETRY_SLEEP_SEC"
    wfl_attempt=$((wfl_attempt+1))
  done
else
  E_TS="$(escape_sql "$TS_UTC")"
  E_CMD="$(escape_sql "$COMMAND")"
  E_IP="$(escape_sql "$ISSUE_PATH")"
  E_SUM="$(escape_sql "$SUMMARY")"
  E_CF="$(escape_sql "$CHANGED_FILES_RAW")"
  INSERT_SQL="INSERT OR IGNORE INTO workflow_log (ts_utc, command, issue_path, summary, changed_files, dod_met) VALUES ('$E_TS', '$E_CMD', '$E_IP', '$E_SUM', '$E_CF', $DOD_MET);"
  wfl_attempt=1
  while true; do
    if sqlite3 "$WF_DB" "$INSERT_SQL" 2>"${WFL_ERRFILE:-/dev/null}"; then
      break
    fi
    if [[ $wfl_attempt -ge $MAX_RETRIES ]]; then
      [[ -n "${WFL_ERRFILE:-}" && -f "${WFL_ERRFILE:-}" ]] && cat "$WFL_ERRFILE" >&2
      echo "ERROR: workflow_log への INSERT に失敗しました（リトライ上限: ${MAX_RETRIES} 回）。" >&2
      exit 1
    fi
    if [[ -n "${WFL_ERRFILE:-}" && -f "${WFL_ERRFILE:-}" ]] && ! grep -qi "locked\|busy" "$WFL_ERRFILE"; then
      cat "$WFL_ERRFILE" >&2
      echo "ERROR: workflow_log への INSERT に失敗しました。" >&2
      exit 1
    fi
    sleep "$RETRY_SLEEP_SEC"
    wfl_attempt=$((wfl_attempt+1))
  done
fi
exit 0
