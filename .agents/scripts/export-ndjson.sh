#!/usr/bin/env bash
# export-ndjson.sh — workflow.db の workflow_log を NDJSON（1 行 1 JSON）で書き出す read-only エクスポータ。
#
# 責務:
#   - workflow_log の全カラムを rowid 昇順（= INSERT 順 = 因果順）で 1 行 1 JSON に射影して標準出力する。
#   - 読み出し専用（SELECT のみ）。DB を一切変更しない（query に副作用を書かない）。
#   - 可視化の主眼は parent_entry_id / command / issue_id の連鎖（誰が誰に何を依頼したか）。
#     actor_role/delegated_by_role は schema の CHECK で固定値のため定数として含めるが主眼ではない。
#
# 使い方:
#   .agents/scripts/export-ndjson.sh [dir]
#     dir 既定 cwd。<dir>/.workflow/workflow.db を読む（PROJECT_ROOT/WORKFLOW_DIR で上書き可）。
#
# 契約違反の扱い:
#   - DB 不在        → stderr に明示エラー・exit 1
#   - sqlite3 不在    → stderr に明示エラー・exit 1
#   - workflow_log 不在 → 空出力＋警告（exit 0。テーブル未作成の新規 DB を異常終了にしない）
#
# 出力スキーマは ledger/schema.sql のカラム順に準拠（カラムを増やす場合は schema.sql を正本に追随）。

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-${1:-.}}"
WORKFLOW_DIR="${WORKFLOW_DIR:-.workflow}"
WF_DB="${PROJECT_ROOT}/${WORKFLOW_DIR}/workflow.db"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "ERROR: sqlite3 がインストールされていません（export には sqlite3 が必要です）。" >&2
  exit 1
fi

if [[ ! -f "$WF_DB" ]]; then
  echo "ERROR: workflow.db が見つかりません: $WF_DB" >&2
  exit 1
fi

# workflow_log テーブルが無ければ空出力＋警告（exit 0）。
if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then
  echo "WARN: workflow_log テーブルが存在しません（空出力）。" >&2
  exit 0
fi

# 1 行 1 JSON。sqlite3 の json_object で全カラムを射影し rowid 昇順で出力（read-only SELECT）。
# json_object はキー値ペアを受け取り正しくエスケープした JSON を返すため、手組みより安全。
# NULL は json_object 内で JSON null として出力される（数値 dod_met は数値のまま）。
sqlite3 "$WF_DB" "
SELECT json_object(
  'entry_id', entry_id,
  'parent_entry_id', parent_entry_id,
  'document_id', document_id,
  'ts_utc', ts_utc,
  'created_at', created_at,
  'actor_role', actor_role,
  'delegated_by_role', delegated_by_role,
  'command', command,
  'issue_id', issue_id,
  'review_id', review_id,
  'issue_path', issue_path,
  'review_path', review_path,
  'document_path', document_path,
  'changed_files_json', changed_files_json,
  'summary', summary,
  'dod_met', dod_met,
  'prev_hash', prev_hash,
  'entry_hash', entry_hash
)
FROM workflow_log
ORDER BY rowid ASC;
"
