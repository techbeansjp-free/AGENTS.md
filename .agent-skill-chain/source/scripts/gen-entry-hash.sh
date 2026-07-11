#!/usr/bin/env bash
# gen-entry-hash.sh — workflow_log の entry_hash 計算の共有正本（単一実装）。
#
# 責務:
#   - write-workflow-log.sh（書込時）・doctor（検証時）・export-ndjson.sh（必要時）が
#     同一の entry_hash 計算を使うための共有関数 gen_entry_hash を 1 か所に定義する。
#   - この計算式を二重実装してはならない（1 文字でもズレると既存チェーンが全行 false positive になる）。
#     利用側は本ファイルを source して gen_entry_hash を呼ぶ。
#
# 計算式（不変・schema の entry_hash と同期する）:
#   14 フィールド eid|pid|docid|ts|ar|dr|cmd|iid|rid|ip|rp|cf|sum|dod を '|' 連結し sha256sum の先頭語。
#   引数順: entry_id parent_entry_id document_id ts_utc actor_role delegated_by_role command \
#           issue_id review_id issue_path review_path changed_files_json summary dod_met
#
# 使い方:
#   source "$(dirname "$0")/gen-entry-hash.sh"
#   h="$(gen_entry_hash "$eid" "$pid" ... "$dod")"

# 二重 source 時の再定義を避けるためのガード（同一プロセスで複数回 source されても無害）。
if [[ -n "${__AGENTS_GEN_ENTRY_HASH_LOADED:-}" ]]; then
  return 0 2>/dev/null || true
fi
__AGENTS_GEN_ENTRY_HASH_LOADED=1

# gen_entry_hash — 14 フィールドを '|' 連結 → sha256sum の先頭語を返す。
gen_entry_hash() {
  local eid="$1" pid="$2" docid="$3" ts="$4" ar="$5" dr="$6" cmd="$7" iid="$8" rid="$9" ip="${10}" rp="${11}" cf="${12}" sum="${13}" dod="${14}"
  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s' \
    "$eid" "$pid" "$docid" "$ts" "$ar" "$dr" "$cmd" "$iid" "$rid" "$ip" "$rp" "$cf" "$sum" "$dod" \
    | sha256sum | awk '{print $1}'
}
