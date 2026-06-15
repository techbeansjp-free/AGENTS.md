#!/usr/bin/env bash
# test-write-workflow-log-prevhash.sh — write-workflow-log.sh の prev_hash 自動連結・--print-head の単体/結合テスト。
#
# ユースケース（このテストファイル全体）:
#   書記が PREV_HASH を指定せず記録しても、記録直前に DB head（最新 entry の entry_hash）が
#   自動取得され prev_hash に連結される。書記以外も --print-head で sqlite3 を直接叩かず現 head を
#   確認できる。明示指定・空 DB・scribe 限定・CHECK 制約は従来どおり維持される（後方互換・非破壊）。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - 全シナリオを mktemp -d の一時 DB／クリーン環境で実行する。
#   - 本開発リポの .workflow/workflow.db を一切読み書き・変更しない（PROJECT_ROOT を一時ディレクトリに向ける）。
#   - schema.sql は read のみ（一時 DB に流す）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-write-workflow-log-prevhash.sh   # リポジトリルートで実行
#
# 前提: bash・sqlite3。
# 参照:
#   docs/maintainer/workflow/20260614_184756_台帳prev_hash自動連結/02_設計.md, 03_実装計画.md（SC-01〜05）
#   .agents/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"   # test/ -> repo root（配置非依存）
WWL="$REPO_ROOT/.agents/scripts/write-workflow-log.sh"
SCHEMA="$REPO_ROOT/.agents/ledger/schema.sql"

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: '$1' != '$2'}"; }

command -v sqlite3 >/dev/null 2>&1 || { echo "エラー: sqlite3 が必要です" >&2; exit 2; }
[[ -f "$WWL" && -f "$SCHEMA" ]] || { echo "エラー: 対象スクリプト/スキーマが見つかりません" >&2; exit 2; }

# 記録ヘルパ: PROJECT_ROOT を tmp に向け書記として 1 件記録（PREV_HASH 未指定＝自動連結対象）。
record() {
  local root="$1" docid="$2" summary="$3"
  PROJECT_ROOT="$root" AGENT_ROLE=scribe DOCUMENT_ID="$docid" \
    "$WWL" requirement-discovery "$summary" 1 "2026-06-14T10:00:00Z"
}

echo "== 本番 DB 非破壊の事前計測 =="
BEFORE_DB="$REPO_ROOT/.workflow/workflow.db"
before_rows="$(sqlite3 "$BEFORE_DB" 'SELECT COUNT(*) FROM workflow_log;' 2>/dev/null || echo NA)"
before_mtime="$(stat -c %Y "$BEFORE_DB" 2>/dev/null || echo NA)"

# --- T1: resolve_head_hash（head 決定キー = rowid） --------------------------
# シナリオ: rowid 最大の entry_hash を head として返し、ts_utc の文字列比較に依存しない（SC-01 基盤）。
echo "== T1: head 決定（rowid 順・形式混在 ts_utc 回帰） =="
t1() {
  # Given: クリーン一時 DB に schema を流し、entry A(UTC) → B(JST) の順に直接 INSERT
  local TMP DB; TMP="$(mktemp -d)"; DB="$TMP/workflow.db"
  sqlite3 "$DB" < "$SCHEMA"
  ins() { sqlite3 "$DB" "INSERT INTO workflow_log (entry_id, ts_utc, created_at, actor_role, delegated_by_role, command, summary, dod_met, entry_hash) VALUES ('$1','$2','2026-06-14T00:00:00Z','scribe','orchestrator','requirement-discovery','summary text',1,'$3');"; }
  ins "11111111-1111-1111-1111-111111111111" "2026-06-14T18:00:00Z"     "hashA"
  ins "22222222-2222-2222-2222-222222222222" "2026-06-14T10:00:00+0900" "hashB"
  # When: --print-head 経由で head 決定関数（rowid DESC LIMIT 1）を実行（DB は $TMP/workflow.db）
  local head; head="$(PROJECT_ROOT="$TMP" WORKFLOW_DIR="." "$WWL" --print-head)"
  # Then: 文字列比較なら A>B だが、最後に INSERT した B の entry_hash が返る
  assert_eq "$head" "hashB" "T1 head=最後に INSERT した行（rowid 順・ts_utc 非依存）"
  rm -rf "$TMP"
}
t1

# --- T2: --print-head（read 経路・scribe 不要） ------------------------------
echo "== T2: --print-head read 経路 =="
# シナリオ: 1 件記録済みで --print-head が head の entry_hash を stdout に返し exit 0（SC-03）。
t2_head() {
  # Given: 1 件記録済みの一時環境（書記として記録 → 自動連結経路を通る）
  local TMP; TMP="$(mktemp -d)"
  record "$TMP" "33333333-3333-3333-3333-333333333333" "first entry text" >/dev/null
  local DB="$TMP/.workflow/workflow.db"
  local want; want="$(sqlite3 "$DB" "SELECT entry_hash FROM workflow_log ORDER BY rowid DESC LIMIT 1;")"
  # When: AGENT_ROLE 未設定（書記以外）で --print-head を実行
  local out rc
  out="$(PROJECT_ROOT="$TMP" "$WWL" --print-head)"; rc=$?
  # Then: head の entry_hash が返り、exit 0（scribe 不要）
  assert_eq "$out" "$want" "T2 --print-head が現 head の entry_hash を返す"
  assert_eq "$rc" "0" "T2 --print-head は exit 0"
  rm -rf "$TMP"
}
t2_head
# シナリオ: 空 DB（DB 未作成）では --print-head が空文字列・exit 0（SC-03 後半）。
t2_empty() {
  # Given: DB が未作成のクリーン一時環境
  local TMP; TMP="$(mktemp -d)"
  # When: --print-head を実行
  local out rc
  out="$(PROJECT_ROOT="$TMP" "$WWL" --print-head)"; rc=$?
  # Then: 空文字列・exit 0（異常終了しない）
  assert_eq "$out" "" "T2 空 DB では --print-head は空文字列"
  assert_eq "$rc" "0" "T2 空 DB でも --print-head は exit 0"
  rm -rf "$TMP"
}
t2_empty

# --- T3: prev_hash 自動連結（INSERT 経路） ----------------------------------
echo "== T3: prev_hash 自動連結 =="
# シナリオ: 連続 2 件（PREV_HASH 未指定）で 2 件目の prev_hash が 1 件目の entry_hash に一致し中間 NULL なし（SC-01）。
t3_chain() {
  # Given: クリーン一時環境に 1 件目を PREV_HASH 未指定で記録
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.workflow/workflow.db"
  record "$TMP" "44444444-4444-4444-4444-444444444444" "first entry text"  >/dev/null
  # When: 2 件目も PREV_HASH 未指定で記録（自動連結）
  record "$TMP" "55555555-5555-5555-5555-555555555555" "second entry text" >/dev/null
  local e1 p2 nulls
  e1="$(sqlite3 "$DB" "SELECT entry_hash FROM workflow_log ORDER BY rowid ASC  LIMIT 1;")"
  p2="$(sqlite3 "$DB" "SELECT prev_hash  FROM workflow_log ORDER BY rowid DESC LIMIT 1;")"
  nulls="$(sqlite3 "$DB" "SELECT COUNT(*) FROM workflow_log WHERE rowid>(SELECT MIN(rowid) FROM workflow_log) AND prev_hash IS NULL;")"
  # Then: 2 件目の prev_hash = 1 件目の entry_hash、かつ rowid>min で NULL の中間 entry なし
  assert_eq "$p2" "$e1" "T3 2 件目の prev_hash = 1 件目の entry_hash（自動連結）"
  assert_eq "$nulls" "0" "T3 中間 NULL entry が存在しない"
  rm -rf "$TMP"
}
t3_chain
# シナリオ: 空 DB への初回記録は prev_hash が NULL・exit 0（SC-02）。
t3_first_null() {
  # Given: クリーン一時環境（DB 未作成）
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.workflow/workflow.db"
  # When: 初回 1 件を PREV_HASH 未指定で記録
  local rc; record "$TMP" "66666666-6666-6666-6666-666666666666" "only entry text" >/dev/null; rc=$?
  local p1; p1="$(sqlite3 "$DB" "SELECT CASE WHEN prev_hash IS NULL THEN 'NULL' ELSE prev_hash END FROM workflow_log ORDER BY rowid DESC LIMIT 1;")"
  # Then: 初回 entry の prev_hash は NULL、記録は exit 0
  assert_eq "$p1" "NULL" "T3 空 DB 初回記録の prev_hash は NULL"
  assert_eq "$rc" "0" "T3 初回記録は exit 0"
  rm -rf "$TMP"
}
t3_first_null
# シナリオ: PREV_HASH 明示指定時は自動取得で上書きしない（SC-04・後方互換）。
t3_explicit() {
  # Given: 1 件記録済みの一時環境（head が存在する状態）
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.workflow/workflow.db"
  record "$TMP" "77777777-7777-7777-7777-777777777777" "first entry text" >/dev/null
  # When: 2 件目を PREV_HASH 明示指定で記録
  PROJECT_ROOT="$TMP" AGENT_ROLE=scribe DOCUMENT_ID="88888888-8888-8888-8888-888888888888" \
    PREV_HASH="explicit-fixed-hash" \
    "$WWL" requirement-discovery "second entry text" 1 "2026-06-14T10:00:00Z" >/dev/null
  local p2; p2="$(sqlite3 "$DB" "SELECT prev_hash FROM workflow_log ORDER BY rowid DESC LIMIT 1;")"
  # Then: prev_hash は明示値のまま（head の自動取得値で上書きされない）
  assert_eq "$p2" "explicit-fixed-hash" "T3 明示 PREV_HASH は上書きされない（後方互換）"
  rm -rf "$TMP"
}
t3_explicit
# シナリオ: 自動連結と --print-head が同一ロジックで整合する（結合）。
t3_consistency() {
  # Given: 連続 2 件を PREV_HASH 未指定で記録した一時環境
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.workflow/workflow.db"
  record "$TMP" "99999999-9999-9999-9999-999999999999" "first entry text"  >/dev/null
  record "$TMP" "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" "second entry text" >/dev/null
  # When: --print-head と DB 直読みの head を比較
  local from_cmd from_db
  from_cmd="$(PROJECT_ROOT="$TMP" "$WWL" --print-head)"
  from_db="$(sqlite3 "$DB" "SELECT entry_hash FROM workflow_log ORDER BY rowid DESC LIMIT 1;")"
  # Then: 両者が一致（自動連結時の head 取得と read 経路が同一 Query）
  assert_eq "$from_cmd" "$from_db" "T3 --print-head と自動連結の head が整合"
  rm -rf "$TMP"
}
t3_consistency

# --- T5: 非破壊（scribe 限定・CHECK） ---------------------------------------
echo "== T5: 非破壊（scribe 限定・CHECK 維持） =="
# シナリオ: AGENT_ROLE が scribe 以外なら INSERT 経路は拒否（書込ガード維持・SC-05）。
t5_scribe_guard() {
  # Given: クリーン一時環境
  local TMP; TMP="$(mktemp -d)"
  # When: AGENT_ROLE=other で記録を試みる
  local rc
  PROJECT_ROOT="$TMP" AGENT_ROLE=other DOCUMENT_ID="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" \
    "$WWL" requirement-discovery "blocked entry" 1 "2026-06-14T10:00:00Z" >/dev/null 2>&1
  rc=$?
  # Then: 非ゼロ終了で拒否される（INSERT の scribe 限定は維持）
  [[ "$rc" -ne 0 ]] && ok "T5 AGENT_ROLE!=scribe の記録は拒否（exit!=0）" || ng "T5 scribe 限定が維持されていない"
  rm -rf "$TMP"
}
t5_scribe_guard
# シナリオ: CHECK 制約（actor_role='scribe' 等）が一時 DB で従来どおり効く（不正 INSERT 拒否・SC-05）。
t5_check() {
  # Given: schema.sql を流した一時 DB
  local TMP DB; TMP="$(mktemp -d)"; DB="$TMP/workflow.db"
  sqlite3 "$DB" < "$SCHEMA"
  # When: actor_role を 'scribe' 以外にした不正 INSERT を直接実行
  local err
  err="$(sqlite3 "$DB" "INSERT INTO workflow_log (entry_id, ts_utc, created_at, actor_role, delegated_by_role, command, summary, dod_met, entry_hash) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','2026-06-14T10:00:00Z','2026-06-14T10:00:00Z','intruder','orchestrator','requirement-discovery','summary text',1,'h');" 2>&1)"
  local cnt; cnt="$(sqlite3 "$DB" "SELECT COUNT(*) FROM workflow_log;")"
  # Then: CHECK 違反で拒否され、行は増えない
  assert_eq "$cnt" "0" "T5 actor_role!=scribe の不正 INSERT は CHECK で拒否"
  [[ -n "$err" ]] && ok "T5 CHECK 違反エラーが返る" || ng "T5 CHECK 違反エラーが返らない"
  rm -rf "$TMP"
}
t5_check

# --- 本番 DB 非破壊の検証 ----------------------------------------------------
echo "== 本番 DB 非破壊の事後検証 =="
# シナリオ: 全テスト実行後も本リポの .workflow/workflow.db が変化しない（tmp 隔離の自己検証）。
after_rows="$(sqlite3 "$BEFORE_DB" 'SELECT COUNT(*) FROM workflow_log;' 2>/dev/null || echo NA)"
after_mtime="$(stat -c %Y "$BEFORE_DB" 2>/dev/null || echo NA)"
assert_eq "$after_rows" "$before_rows" "本番 DB の行数が不変（before=$before_rows after=$after_rows）"
assert_eq "$after_mtime" "$before_mtime" "本番 DB の mtime が不変"

# --- 集計 -------------------------------------------------------------------
echo ""
echo "== 結果: PASS=$PASS FAIL=$FAIL =="
if [[ "$FAIL" -ne 0 ]]; then
  printf '  失敗: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
exit 0
