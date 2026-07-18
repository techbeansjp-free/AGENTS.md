#!/usr/bin/env bash
# gen-entry-hash.sh — workflow_log の entry_hash 計算の共有正本（単一実装）。
#
# 責務:
#   - write-workflow-log.sh（書込=v2 生成）・doctor（検証=hash_version 別検証）・
#     export-ndjson.sh（必要時=全カラム出力）が同一の entry_hash 計算を使うための共有関数を
#     1 か所に定義する。この計算式を二重実装してはならない（1 文字でもズレると当該版の
#     チェーンが全行 false positive になる）。利用側は本ファイルを source して呼ぶ。
#
# 版と hash_version 分岐:
#   workflow_log.hash_version 列が計算式の版を示す（NULL=レガシー v1、2=v2）。検証側は行ごとの
#   hash_version を読み、NULL なら gen_entry_hash（v1）、2 なら gen_entry_hash_v2（v2）で再計算する。
#
#   [v1] hash_version = NULL（既存行のみ）。14 フィールド
#        eid|pid|docid|ts|ar|dr|cmd|iid|rid|ip|rp|cf|sum|dod を '|' 連結し sha256sum の先頭語。
#        引数順: entry_id parent_entry_id document_id ts_utc actor_role delegated_by_role command \
#                issue_id review_id issue_path review_path changed_files_json summary dod_met
#        v1 は不変（1 文字も変更しない）。prev_hash を含まないため、行削除・並べ替え・prev_hash
#        書換をチェーンとしては検知できない（劣化境界。ledger/schema.md 参照）。
#
#   [v2] hash_version = 2（新規行）。entry_hash と hash_version を除く全 20 カラム（prev_hash を含む）を、
#        LC_ALL=C 下のバイト長プレフィックス枠付けで連結し sha256sum の先頭語。
#        引数順（schema.sql のカラム順・entry_hash と hash_version を除く 20 個）:
#          entry_id parent_entry_id document_id ts_utc created_at actor_role delegated_by_role \
#          command issue_id review_id issue_path review_path document_path changed_files_json \
#          summary dod_met model_tier tier_rationale tier_exception prev_hash
#        枠付けにより値に '|'・改行・制御文字が含まれても連結は単射となり、フィールド境界の
#        衝突が原理的に起きない。DB の NULL 値は空文字列に正規化して渡す（ラッパーが空文字を
#        NULLIF で NULL 化するのと逆写像。検証側も同一規則）。prev_hash を含むため、行の削除・
#        並べ替え・prev_hash 書換のいずれも再計算なしにはチェーン検証を通過できない。
#
# 使い方:
#   source "$(dirname "$0")/gen-entry-hash.sh"
#   h="$(gen_entry_hash "$eid" "$pid" ... "$dod")"          # v1（既存行の検証専用）
#   h="$(gen_entry_hash_v2 "$eid" "$pid" ... "$prev_hash")" # v2（新規行の生成・検証）

# 二重 source 時の再定義を避けるためのガード（同一プロセスで複数回 source されても無害）。
if [[ -n "${__AGENTS_GEN_ENTRY_HASH_LOADED:-}" ]]; then
  return 0 2>/dev/null || true
fi
__AGENTS_GEN_ENTRY_HASH_LOADED=1

# gen_entry_hash — v1（不変）。14 フィールドを '|' 連結 → sha256sum の先頭語を返す。
# 既存行（hash_version=NULL）の検証専用。新規行には gen_entry_hash_v2 を用いる。
gen_entry_hash() {
  local eid="$1" pid="$2" docid="$3" ts="$4" ar="$5" dr="$6" cmd="$7" iid="$8" rid="$9" ip="${10}" rp="${11}" cf="${12}" sum="${13}" dod="${14}"
  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s' \
    "$eid" "$pid" "$docid" "$ts" "$ar" "$dr" "$cmd" "$iid" "$rid" "$ip" "$rp" "$cf" "$sum" "$dod" \
    | sha256sum | awk '{print $1}'
}

# gen_entry_hash_v2 — v2（hash_version=2）。entry_hash を除く全 20 カラム（prev_hash 含む）を
# LC_ALL=C 下のバイト長プレフィックス枠付け（"<バイト長>:<値>" の連結）で並べ、sha256sum の先頭語を返す。
# NULL は呼び出し側で空文字列に正規化して渡すこと。引数は上記 [v2] の順で 20 個。
gen_entry_hash_v2() {
  # LC_ALL/LANG を C に固定し、${#f} をバイト長として決定的に評価する（UTF-8 パスでの環境差を排除）。
  local LC_ALL=C LANG=C
  local out="" f
  for f in "$@"; do
    out+="${#f}:${f}"
  done
  printf '%s' "$out" | LC_ALL=C sha256sum | awk '{print $1}'
}
