#!/usr/bin/env bash
# write-workflow-log.sh — workflow.db への書記用専用ラッパー（1 回 1 行 INSERT のみ）
# 使い方:
#   AGENT_ROLE=scribe .agent-skill-chain/source/scripts/write-workflow-log.sh command summary dod_met ts_utc [issue_path] [changed_files]
#   ENTRY_ID= PARENT_ENTRY_ID= ACTOR_ROLE=scribe DELEGATED_BY_ROLE=orchestrator 等を任意で指定。
# 位置引数: command summary dod_met ts_utc [issue_path] [changed_files]
# 環境変数: ENTRY_ID, PARENT_ENTRY_ID, DOCUMENT_ID, DOCUMENT_PATH, ACTOR_ROLE, DELEGATED_BY_ROLE, REVIEW_PATH, REVIEW_ID, ISSUE_ID, CHANGED_FILES_JSON, PREV_HASH
# DOCUMENT_PATH: 成果ドキュメントのパス（プロジェクトルート相対、例: .agent-skill-chain/runtime/xxx/04_review.md）。指定時は document_id 不変チェックに使用（同一パスで既に別の document_id が記録されていれば INSERT を拒否）。
# DB パスは固定（.agent-skill-chain/runtime/workflow.db）。引数で別 DB を渡せない。
# 新スキーマ（entry_id 等）の DB では因果チェーン・actor を記録。旧スキーマでは従来どおり INSERT。

set -euo pipefail

# DB パス解決（read 経路でも使うため早期に定義。INSERT 経路と同一の固定パス）
PROJECT_ROOT="${PROJECT_ROOT:-.}"
WORKFLOW_DIR="${WORKFLOW_DIR:-.agent-skill-chain/runtime}"
WF_DB="${PROJECT_ROOT}/${WORKFLOW_DIR}/workflow.db"

# head 決定関数（共有 Query）: 現 head（最新 entry）の entry_hash を固定 read クエリで返す。
# head 決定キー = 暗黙 rowid（INSERT 順に単調増加）。DB 未存在・workflow_log 不在・旧スキーマ
# （entry_id 無し）・0 件のときは空文字列を返し、異常終了しない（read 専用・副作用なし）。
resolve_head_hash() {
  [[ -f "$WF_DB" ]] || return 0
  command -v sqlite3 &>/dev/null || return 0
  # 新スキーマ（entry_id・entry_hash カラム）でなければ head 無しとして空を返す
  if ! sqlite3 -separator $'\t' "$WF_DB" "PRAGMA table_info(workflow_log);" 2>/dev/null \
      | awk -F '\t' '{print $2}' | grep -qx 'entry_id'; then
    return 0
  fi
  sqlite3 "$WF_DB" "SELECT entry_hash FROM workflow_log ORDER BY rowid DESC LIMIT 1;" 2>/dev/null || true
}

# --print-head: read 専用サブコマンド（書記以外も実行可・状態非変更）。
# AGENT_ROLE ガードより前に評価する（02 §3.2.4）。固定 read クエリのみ・任意 SQL 不可。
if [[ "${1:-}" == "--print-head" ]]; then
  if [[ $# -gt 1 ]]; then
    echo "Usage: $0 --print-head" >&2
    exit 1
  fi
  resolve_head_hash
  exit 0
fi

# 書記のみ実行可能
if [[ "${AGENT_ROLE:-}" != "scribe" ]]; then
  echo "ERROR: AGENT_ROLE が scribe である必要があります。このスクリプトは書記（scribe）のみが実行できます。" >&2
  exit 1
fi

# 許可 command 一覧（INSERT 専用のため、このリスト外は拒否）
ALLOWED_COMMANDS="requirement-discovery|design-feature|implement-feature|verify-and-close|review-docs|create-pr-review-issue"

escape_sql() {
  printf '%s' "$1" | sed "s/'/''/g"
}

# UUID 生成（uuidgen / python3 / フォールバック）。フォールバックも RFC4122 形式（8-4-4-4-12 の 16 進）で audit.sh の uuid_regex に合わせる。
gen_entry_id() {
  if command -v uuidgen &>/dev/null; then
    uuidgen
    return
  fi
  if command -v python3 &>/dev/null; then
    python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null && return
  fi
  # フォールバック: RFC4122 形式を出力
  if [[ -r /dev/urandom ]]; then
    local hex
    hex=$(head -c 16 /dev/urandom | od -A n -t x1 | tr -d ' \n')
    if [[ -n "$hex" && ${#hex} -ge 32 ]]; then
      printf '%s-%s-%s-%s-%s\n' "${hex:0:8}" "${hex:8:4}" "${hex:12:4}" "${hex:16:4}" "${hex:20:12}"
      return
    fi
  fi
  if command -v openssl &>/dev/null; then
    local hex
    hex=$(openssl rand -hex 16 2>/dev/null)
    if [[ -n "$hex" && ${#hex} -eq 32 ]]; then
      printf '%s-%s-%s-%s-%s\n' "${hex:0:8}" "${hex:8:4}" "${hex:12:4}" "${hex:16:4}" "${hex:20:12}"
      return
    fi
  fi
  # 最後のフォールバック: RANDOM で 16 進 32 文字を組み立て（8-4-4-4-12 に整形）
  local i hex=""
  for ((i=0; i<16; i++)); do
    hex="${hex}$(printf '%02x' $((RANDOM % 256)))"
  done
  printf '%s-%s-%s-%s-%s\n' "${hex:0:8}" "${hex:8:4}" "${hex:12:4}" "${hex:16:4}" "${hex:20:12}"
}

# 新スキーマ用: entry_hash の計算は gen-entry-hash.sh の共有関数 gen_entry_hash を source して使う
# （再実装禁止・式の二重定義禁止。ledger/schema.md と同期する単一正本）。source は SCRIPT_DIR 確定後に行う。

# changed_files 文字列を JSON 配列に（カンマ・改行区切り対応）
#   注意: 分割は unquoted 展開（${line//,/ }）で行うため、glob（* ? [...]）が有効だと changed_files に
#   含まれる * 等がカレントディレクトリの実ファイル名へ展開されてしまう。これを防ぐため、関数内では
#   noglob（set -f）を適用し、changed_files を文字どおり記録する（後方互換: 通常パスの分割挙動は不変）。
to_json_array() {
  local raw="${1:-}"
  if [[ -z "$raw" || "$raw" == "[]" ]]; then
    echo "[]"
    return
  fi
  # noglob を局所適用。呼び出し元の glob 設定は退避し関数終了時に必ず復元する。
  local _had_noglob=0
  case "$-" in *f*) _had_noglob=1 ;; esac
  set -f
  local first=1
  echo -n "["
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # set -f 下なので ${line//,/ } の単語分割で * ? [ がファイル名展開されない（文字どおり）。
    for part in ${line//,/ }; do
      part="${part#"${part%%[![:space:]]*}"}"
      part="${part%"${part##*[![:space:]]}"}"
      [[ -z "$part" ]] && continue
      if [[ $first -eq 1 ]]; then first=0; else echo -n ","; fi
      printf '"%s"' "$(printf '%s' "$part" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    done
  done < <(printf '%s\n' "$raw" | tr ',' '\n')
  echo "]"
  # glob 設定を復元（元々 noglob でなければ解除）。
  [[ "$_had_noglob" -eq 0 ]] && set +f
}

if ! command -v sqlite3 &>/dev/null; then
  echo "ERROR: sqlite3 がインストールされていません。" >&2
  exit 1
fi

# DB パス固定（引数・環境変数で上書きしない）。WF_DB はスクリプト冒頭で定義済み。

# スキーマ正本（ledger/schema.sql）の解決。本スクリプトは .agent-skill-chain/source/scripts/ 配下にある。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# entry_hash 計算の共有正本を source（gen_entry_hash を定義。再実装禁止・N-D）。
# shellcheck source=gen-entry-hash.sh
. "$SCRIPT_DIR/gen-entry-hash.sh"

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
  echo "ERROR: 許可されていない command です。許可: requirement-discovery, design-feature, implement-feature, verify-and-close, review-docs, create-pr-review-issue" >&2
  exit 1
fi

# UUID 形式検証（8-4-4-4-12）。空の場合は検証スキップ（DOCUMENT_ID は後で必須チェック）
UUID_REGEX='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

# ts_utc は ISO8601 UTC 形式（末尾 Z 必須・任意小数秒）。受理形式の単一情報源（二重定義禁止）。
TS_UTC_ISO8601_REGEX='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
validate_uuid_if_set() {
  local var_name="$1"
  local var_value="$2"
  if [[ -z "${var_value//[[:space:]]/}" ]]; then return 0; fi
  if [[ ! "$var_value" =~ $UUID_REGEX ]]; then
    echo "ERROR: ${var_name} が UUID 形式（8-4-4-4-12）ではありません: ${var_value}" >&2
    exit 1
  fi
  return 0
}

# 環境変数で上書き（新スキーマ用）
ACTOR_ROLE="${ACTOR_ROLE:-scribe}"
DELEGATED_BY_ROLE="${DELEGATED_BY_ROLE:-orchestrator}"
REVIEW_PATH="${REVIEW_PATH:-}"
PARENT_ENTRY_ID="${PARENT_ENTRY_ID:-}"
DOCUMENT_ID="${DOCUMENT_ID:-}"
DOCUMENT_PATH="${DOCUMENT_PATH:-}"
ISSUE_ID="${ISSUE_ID:-}"
REVIEW_ID="${REVIEW_ID:-}"
PREV_HASH="${PREV_HASH:-}"

# (A) DOCUMENT_ID / ISSUE_ID / REVIEW_ID の UUID 形式検証（指定時のみ。不正なら exit 1）
validate_uuid_if_set "DOCUMENT_ID" "$DOCUMENT_ID"
validate_uuid_if_set "ISSUE_ID" "$ISSUE_ID"
validate_uuid_if_set "REVIEW_ID" "$REVIEW_ID"

# (C) DOCUMENT_ID が空の場合は記録失敗・exit 1
if [[ -z "${DOCUMENT_ID:-}" || "${DOCUMENT_ID:-}" =~ ^[[:space:]]*$ ]]; then
  echo "ERROR: DOCUMENT_ID は必須です。空のため記録を拒否します。" >&2
  exit 1
fi
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

# ts_utc は ISO8601 UTC 形式でなければ INSERT 前に fail-fast（DB 作成・ロック取得より前）。
if [[ ! "$TS_UTC" =~ $TS_UTC_ISO8601_REGEX ]]; then
  echo "ERROR: ts_utc が ISO8601 UTC 形式ではありません。期待形式: YYYY-MM-DDTHH:MM:SSZ（例: 2026-07-11T00:00:00Z）。渡された値: '${TS_UTC}'。memo/issue プレフィックス形式（YYYYMMDD_HHMMSS・JST）とは別物です。UTC 時刻は date -u +\"%Y-%m-%dT%H:%M:%SZ\" で取得してください。" >&2
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

# INSERT をリトライ付きで実行するヘルパー（SQLITE_BUSY 時は最大 MAX_RETRIES 回まで待機）
insert_with_retries() {
  local db="$1" sql="$2" errfile="${3:-}"
  local attempt=1
  while true; do
    if sqlite3 "$db" "$sql" 2>"${errfile:-/dev/null}"; then
      return 0
    fi
    if [[ $attempt -ge $MAX_RETRIES ]]; then
      [[ -n "$errfile" && -f "$errfile" ]] && cat "$errfile" >&2
      echo "ERROR: workflow_log への INSERT に失敗しました（リトライ上限: ${MAX_RETRIES} 回）。" >&2
      return 1
    fi
    if [[ -n "$errfile" && -f "$errfile" ]] && ! grep -qi "locked\|busy" "$errfile"; then
      cat "$errfile" >&2
      echo "ERROR: workflow_log への INSERT に失敗しました。" >&2
      return 1
    fi
    sleep "$RETRY_SLEEP_SEC"
    attempt=$((attempt+1))
  done
}

# DB が無ければ新スキーマで作成（スキーマの正本は ledger/schema.sql。document_path を含む）
if [[ ! -f "$WF_DB" ]]; then
  WF_DIR="$(dirname "$WF_DB")"
  mkdir -p "$WF_DIR"
  sqlite3 "$WF_DB" < "$AGENTS_ROOT/ledger/schema.sql"
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
  if ! printf '%s' "$CURRENT_COLS" | grep -qx 'document_path'; then
    sqlite3 "$WF_DB" "ALTER TABLE workflow_log ADD COLUMN document_path TEXT NULL; CREATE INDEX IF NOT EXISTS idx_workflow_log_document_path ON workflow_log(document_path);" 2>/dev/null || sqlite3 "$WF_DB" "ALTER TABLE workflow_log ADD COLUMN document_path TEXT NULL;" || { echo "ERROR: document_path マイグレーションに失敗しました。" >&2; exit 1; }
  fi
  # CHECK に review-docs または create-pr-review-issue が無い場合はテーブル再作成でマイグレーション
  if [[ "$COMMAND" == "review-docs" || "$COMMAND" == "create-pr-review-issue" ]]; then
    CREATED_SQL="$(sqlite3 "$WF_DB" "SELECT sql FROM sqlite_master WHERE type='table' AND name='workflow_log';")"
    NEED_MIGRATE=""
    if [[ "$COMMAND" == "review-docs" && -n "$CREATED_SQL" && "$CREATED_SQL" != *"review-docs"* ]]; then NEED_MIGRATE=1; fi
    if [[ "$COMMAND" == "create-pr-review-issue" && -n "$CREATED_SQL" && "$CREATED_SQL" != *"create-pr-review-issue"* ]]; then NEED_MIGRATE=1; fi
    if [[ -n "$NEED_MIGRATE" ]]; then
      sqlite3 "$WF_DB" <<'MIGRATE'
BEGIN IMMEDIATE;
DROP TABLE IF EXISTS workflow_log_new;
CREATE TABLE workflow_log_new (
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
  CHECK (command IN ('requirement-discovery', 'design-feature', 'implement-feature', 'verify-and-close', 'review-docs', 'create-pr-review-issue'))
);
INSERT INTO workflow_log_new SELECT entry_id, parent_entry_id, document_id, ts_utc, created_at, actor_role, delegated_by_role, command, issue_id, review_id, issue_path, review_path, document_path, changed_files_json, summary, dod_met, prev_hash, entry_hash FROM workflow_log;
DROP TABLE workflow_log;
ALTER TABLE workflow_log_new RENAME TO workflow_log;
CREATE INDEX IF NOT EXISTS idx_workflow_log_ts_utc ON workflow_log(ts_utc);
CREATE INDEX IF NOT EXISTS idx_workflow_log_command ON workflow_log(command);
CREATE INDEX IF NOT EXISTS idx_workflow_log_parent ON workflow_log(parent_entry_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_document_id ON workflow_log(document_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_issue_id ON workflow_log(issue_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_review_id ON workflow_log(review_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_document_path ON workflow_log(document_path);
COMMIT;
MIGRATE
      [[ $? -eq 0 ]] || { echo "ERROR: CHECK マイグレーションに失敗しました（review-docs / create-pr-review-issue）。" >&2; exit 1; }
    fi
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
  E_DP="$(escape_sql "$DOCUMENT_PATH")"
  E_CF="$(escape_sql "$CHANGED_FILES_JSON")"
  E_SUM="$(escape_sql "$SUMMARY")"
  # prev_hash 自動連結: 明示 PREV_HASH 未指定時のみ、flock 取得後・INSERT 直前に現 head を取得して
  # 連結する（明示指定時は上書きしない＝後方互換）。head 不在（空 DB 初回）は空のまま→NULLIF で NULL。
  if [[ -z "${PREV_HASH//[[:space:]]/}" ]]; then
    PREV_HASH="$(resolve_head_hash)"
  fi
  E_PH="$(escape_sql "$PREV_HASH")"
  ENTRY_HASH="$(gen_entry_hash "$ENTRY_ID" "$PARENT_ENTRY_ID" "$DOCUMENT_ID" "$TS_UTC" "$ACTOR_ROLE" "$DELEGATED_BY_ROLE" "$COMMAND" "$ISSUE_ID" "$REVIEW_ID" "$ISSUE_PATH" "$REVIEW_PATH" "$CHANGED_FILES_JSON" "$SUMMARY" "$DOD_MET")"
  E_EH="$(escape_sql "$ENTRY_HASH")"
  # document_id 不変: 同一 document_path に既に別の document_id が記録されていれば拒否（RULES.md §document_id 不変）
  if [[ -n "$DOCUMENT_ID" && -n "$DOCUMENT_PATH" ]]; then
    existing_id="$(sqlite3 "$WF_DB" "SELECT document_id FROM workflow_log WHERE document_path = '$E_DP' AND document_id IS NOT NULL ORDER BY ts_utc ASC LIMIT 1;" 2>/dev/null || true)"
    if [[ -n "$existing_id" && "$existing_id" != "$DOCUMENT_ID" ]]; then
      echo "ERROR: document_id の変更は禁止されています（同一 document_path に既に別の document_id が記録済み）。stored=$existing_id, given=$DOCUMENT_ID" >&2
      exit 1
    fi
  fi
  INSERT_SQL="INSERT INTO workflow_log (entry_id, parent_entry_id, document_id, ts_utc, created_at, actor_role, delegated_by_role, command, issue_id, review_id, issue_path, review_path, document_path, changed_files_json, summary, dod_met, prev_hash, entry_hash) VALUES ('$E_EID', NULLIF('$E_PID',''), NULLIF('$E_DOCID',''), '$E_TS', '$E_CA', '$E_AR', '$E_DR', '$E_CMD', NULLIF('$E_IID',''), NULLIF('$E_RID',''), NULLIF('$E_IP',''), NULLIF('$E_RP',''), NULLIF('$E_DP',''), '$E_CF', '$E_SUM', $DOD_MET, NULLIF('$E_PH',''), '$E_EH');"
  insert_with_retries "$WF_DB" "$INSERT_SQL" "${WFL_ERRFILE:-}" || exit 1
else
  E_TS="$(escape_sql "$TS_UTC")"
  E_CMD="$(escape_sql "$COMMAND")"
  E_IP="$(escape_sql "$ISSUE_PATH")"
  E_SUM="$(escape_sql "$SUMMARY")"
  E_CF="$(escape_sql "$CHANGED_FILES_RAW")"
  INSERT_SQL="INSERT OR IGNORE INTO workflow_log (ts_utc, command, issue_path, summary, changed_files, dod_met) VALUES ('$E_TS', '$E_CMD', '$E_IP', '$E_SUM', '$E_CF', $DOD_MET);"
  insert_with_retries "$WF_DB" "$INSERT_SQL" "${WFL_ERRFILE:-}" || exit 1
fi
exit 0
