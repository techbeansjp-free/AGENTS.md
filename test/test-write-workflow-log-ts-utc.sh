#!/usr/bin/env bash
# test-write-workflow-log-ts-utc.sh — write-workflow-log.sh の ts_utc ISO8601 形式バリデーションの回帰テスト。
#
# ユースケース（このテストファイル全体）:
#   TS_UTC（第4引数）が ISO8601 UTC 形式（YYYY-MM-DDTHH:MM:SSZ、任意小数秒、末尾 Z 必須）でなければ、
#   INSERT・DB 作成・ロック取得のいずれよりも前に exit 1 で fail-fast することを保証する。
#   (i) 正常系（Z・小数秒）は従来どおり exit 0・1 行 INSERT、
#   (ii) 異常系（Scenario Outline 6 値）は exit 1・行数不変・DB 未作成、
#   (iii) エラーメッセージに ISO8601 である旨・期待形式例・実際の値が含まれる、
#   (iv) 旧スキーマ（entry_id 無し）経路にも同一のバリデーションが効く、
#   (v) --print-head は ts_utc 検証の影響を受けない、
#   (vi) 本リポの本番 workflow.db を一切変更・破壊しない、ことを保証する。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - 全シナリオを mktemp -d の一時 DB／クリーン環境で実行する（.agent-skill-chain/project/自己拡張ワークフロー.md §テストの tmp 隔離）。
#   - 本開発リポの .agent-skill-chain/runtime/workflow.db を一切読み書き・変更しない（PROJECT_ROOT を一時ディレクトリに向ける）。
#   - schema.sql / write-workflow-log.sh は read のみ（一時 DB に流す／呼び出すのみ・無改造）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-write-workflow-log-ts-utc.sh   # リポジトリルートで実行
#
# 前提: bash・sqlite3。
# 参照:
#   docs/maintainer/workflow/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/20260711_055602_write-workflow-log_ts_utc検証/
#     00_要求定義.md・01_要件定義.md・02_設計.md・03_実装計画.md（T2-1〜T2-6）
#   .agent-skill-chain/source/scripts/write-workflow-log.sh（TS_UTC_ISO8601_REGEX・fail-fast ブロック）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md
#   test/test-write-workflow-log-multidoc.sh（隔離・BDD 記法の型）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"   # test/ -> repo root（配置非依存）
WWL="$REPO_ROOT/.agent-skill-chain/source/scripts/write-workflow-log.sh"
SCHEMA="$REPO_ROOT/.agent-skill-chain/source/ledger/schema.sql"

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: '$1' != '$2'}"; }

command -v sqlite3 >/dev/null 2>&1 || { echo "エラー: sqlite3 が必要です" >&2; exit 2; }
[[ -f "$WWL" && -f "$SCHEMA" ]] || { echo "エラー: 対象スクリプト/スキーマが見つかりません" >&2; exit 2; }

echo "== 本番 DB 非破壊の事前計測 =="
BEFORE_DB="$REPO_ROOT/.agent-skill-chain/runtime/workflow.db"
before_rows="$(sqlite3 "$BEFORE_DB" 'SELECT COUNT(*) FROM workflow_log;' 2>/dev/null || echo NA)"
before_mtime="$(stat -c %Y "$BEFORE_DB" 2>/dev/null || echo NA)"

# --- T2-1: 正常系（Z・小数秒）は従来どおり exit 0・1 行 INSERT ------------------
echo "== T2-1: 正常系（ISO8601 UTC）は exit 0・1 行 INSERT（SC 正常系） =="
# シナリオ: ISO8601 UTC 形式（末尾 Z・任意小数秒）の ts_utc を渡すと、fail-fast されず従来どおり成功する。
t2_1_ok() {
  local label="$1" ts="$2"
  # Given: 隔離環境(mktemp -d)・AGENT_ROLE=scribe・有効な DOCUMENT_ID
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.agent-skill-chain/runtime/workflow.db"
  # When: ts_utc に正常形式を渡して実行する
  local rc
  PROJECT_ROOT="$TMP" AGENT_ROLE=scribe \
    DOCUMENT_ID="11111111-1111-1111-1111-111111111111" \
    DOCUMENT_PATH=".agent-skill-chain/runtime/x/00_要求定義.md" \
    "$WWL" requirement-discovery "正常系 ts_utc テスト($label)" 1 "$ts" >/dev/null 2>&1
  rc=$?
  # Then: 終了コードは 0 で、workflow_log に ts_utc がその値のまま 1 行 INSERT されている
  assert_eq "$rc" "0" "T2-1 正常系($label) は exit 0"
  local cnt stored
  cnt="$(sqlite3 "$DB" "SELECT COUNT(*) FROM workflow_log;" 2>/dev/null || echo 0)"
  stored="$(sqlite3 "$DB" "SELECT ts_utc FROM workflow_log ORDER BY rowid DESC LIMIT 1;" 2>/dev/null || echo "")"
  assert_eq "$cnt" "1" "T2-1 正常系($label) は 1 行 INSERT される"
  assert_eq "$stored" "$ts" "T2-1 正常系($label) の ts_utc がそのまま保存される"
  rm -rf "$TMP"
}
t2_1_ok "Z"       "2026-07-11T00:00:00Z"
t2_1_ok "小数秒Z" "2026-07-11T00:00:00.123Z"

# --- T2-2: 異常系（Scenario Outline）は exit 1・行数不変・DB 未作成 -------------
echo "== T2-2: 異常系 Scenario Outline（多様な非 ISO8601 形式が一律拒否） =="
# シナリオ: 多様な非 ISO8601 形式の ts_utc を渡すと、INSERT 前に exit 1 で拒否され、DB も新規作成されない。
run_bad() {
  local bad="$1"
  # Given: 隔離環境(mktemp -d)・AGENT_ROLE=scribe・有効な DOCUMENT_ID（本番 DB は触らない）
  local TMP; TMP="$(mktemp -d)"
  local DB="$TMP/.agent-skill-chain/runtime/workflow.db"
  # When: 不正な ts_utc を渡して実行する
  local rc stderr_out
  stderr_out="$(PROJECT_ROOT="$TMP" AGENT_ROLE=scribe \
    DOCUMENT_ID="22222222-2222-2222-2222-222222222222" \
    DOCUMENT_PATH=".agent-skill-chain/runtime/x/00_要求定義.md" \
    "$WWL" requirement-discovery "異常系テスト記録" 1 "$bad" 2>&1 1>/dev/null)"
  rc=$?
  # Then: exit 1 かつ DB 未作成（副作用なし）
  assert_eq "$rc" "1" "T2-2 拒否: '$bad' は exit 1"
  [[ ! -f "$DB" ]] && ok "T2-2 拒否時 DB 未作成: '$bad'" || ng "T2-2 拒否時に DB が作られた: '$bad'"
  # T2-3: エラーメッセージ機械検証（ISO8601 である旨・期待形式例・実際の値を含む）
  echo "$stderr_out" | grep -q "ISO8601" \
    && ok "T2-3 エラーメッセージに 'ISO8601' を含む: '$bad'" \
    || ng "T2-3 エラーメッセージに 'ISO8601' が無い: '$bad'"
  echo "$stderr_out" | grep -q "YYYY-MM-DDTHH:MM:SSZ" \
    && ok "T2-3 エラーメッセージに期待形式例を含む: '$bad'" \
    || ng "T2-3 エラーメッセージに期待形式例が無い: '$bad'"
  echo "$stderr_out" | grep -qF "$bad" \
    && ok "T2-3 エラーメッセージに実際の値を含む: '$bad'" \
    || ng "T2-3 エラーメッセージに実際の値が無い: '$bad'"
  rm -rf "$TMP"
}
run_bad "20260101_000000"
run_bad "2026/07/11 00:00:00"
run_bad "2026-07-11"
run_bad "invalid"
run_bad "1720656000"
run_bad "2026-07-11T00:00:00+09:00"

# --- T2-4: 旧スキーマ経路にもバリデーションが効く ------------------------------
echo "== T2-4: 旧スキーマ経路への適用 =="
# シナリオ: entry_id カラムを持たない旧スキーマ DB に対しても、非 ISO8601 の ts_utc は exit 1 で拒否され、非 INSERT。
t2_4_old_schema() {
  # Given: 隔離環境に旧スキーマ（entry_id カラム無し）の workflow.db を用意する
  local TMP; TMP="$(mktemp -d)"
  local WFDIR="$TMP/.agent-skill-chain/runtime"; mkdir -p "$WFDIR"
  local DB="$WFDIR/workflow.db"
  sqlite3 "$DB" "CREATE TABLE workflow_log (ts_utc TEXT NOT NULL, command TEXT NOT NULL, issue_path TEXT NULL, summary TEXT NOT NULL, changed_files TEXT NULL, dod_met INTEGER NOT NULL CHECK (dod_met IN (0,1)));"
  local before_cnt after_cnt rc
  before_cnt="$(sqlite3 "$DB" "SELECT COUNT(*) FROM workflow_log;")"
  # When: 旧スキーマ DB に対し非 ISO8601 の ts_utc を渡して実行する
  PROJECT_ROOT="$TMP" AGENT_ROLE=scribe \
    DOCUMENT_ID="33333333-3333-3333-3333-333333333333" \
    DOCUMENT_PATH=".agent-skill-chain/runtime/x/00_要求定義.md" \
    "$WWL" requirement-discovery "旧スキーマ異常系テスト" 1 "20260101_000000" >/dev/null 2>&1
  rc=$?
  after_cnt="$(sqlite3 "$DB" "SELECT COUNT(*) FROM workflow_log;")"
  # Then: exit 1 であり、行は INSERT されない（旧スキーマ経路にも同一のバリデーションが効く）
  assert_eq "$rc" "1" "T2-4 旧スキーマ経路: 非 ISO8601 は exit 1"
  assert_eq "$after_cnt" "$before_cnt" "T2-4 旧スキーマ経路: 行数不変（before=$before_cnt after=$after_cnt）"
  rm -rf "$TMP"
}
t2_4_old_schema
# シナリオ: 旧スキーマ DB でも正しい ISO8601 UTC を渡せば従来どおり成功する（無回帰）。
t2_4_old_schema_ok() {
  # Given: 隔離環境に旧スキーマ（entry_id カラム無し）の workflow.db を用意する
  local TMP; TMP="$(mktemp -d)"
  local WFDIR="$TMP/.agent-skill-chain/runtime"; mkdir -p "$WFDIR"
  local DB="$WFDIR/workflow.db"
  sqlite3 "$DB" "CREATE TABLE workflow_log (ts_utc TEXT NOT NULL, command TEXT NOT NULL, issue_path TEXT NULL, summary TEXT NOT NULL, changed_files TEXT NULL, dod_met INTEGER NOT NULL CHECK (dod_met IN (0,1)));"
  local rc after_cnt
  # When: 旧スキーマ DB に対し正しい ISO8601 UTC の ts_utc を渡して実行する
  PROJECT_ROOT="$TMP" AGENT_ROLE=scribe \
    DOCUMENT_ID="44444444-4444-4444-4444-444444444444" \
    DOCUMENT_PATH=".agent-skill-chain/runtime/x/00_要求定義.md" \
    "$WWL" requirement-discovery "旧スキーマ正常系テスト" 1 "2026-07-11T00:00:00Z" >/dev/null 2>&1
  rc=$?
  after_cnt="$(sqlite3 "$DB" "SELECT COUNT(*) FROM workflow_log;")"
  # Then: exit 0 で 1 行 INSERT される（旧スキーマ経路の無回帰）
  assert_eq "$rc" "0" "T2-4 旧スキーマ経路: 正常系は exit 0"
  assert_eq "$after_cnt" "1" "T2-4 旧スキーマ経路: 正常系は 1 行 INSERT される"
  rm -rf "$TMP"
}
t2_4_old_schema_ok

# --- T2-5: --print-head は ts_utc 検証の影響を受けない -------------------------
echo "== T2-5: --print-head は ts_utc バリデーションの影響を受けない =="
# シナリオ: 新スキーマ DB に 1 件記録後、--print-head を実行すると exit 0 で最新 entry_hash が出力される。
t2_5_print_head() {
  # Given: 隔離環境に新スキーマ DB を用意し、正常系 ts_utc で 1 件記録する
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.agent-skill-chain/runtime/workflow.db"
  PROJECT_ROOT="$TMP" AGENT_ROLE=scribe \
    DOCUMENT_ID="55555555-5555-5555-5555-555555555555" \
    DOCUMENT_PATH=".agent-skill-chain/runtime/x/00_要求定義.md" \
    "$WWL" requirement-discovery "print-head 用記録" 1 "2026-07-11T00:00:00Z" >/dev/null 2>&1
  # When: --print-head を実行する（ts_utc の位置引数は渡さない・検証の影響を受けないはず）
  local out rc
  out="$(PROJECT_ROOT="$TMP" "$WWL" --print-head 2>/dev/null)"
  rc=$?
  # Then: 終了コードは 0 で、最新 entry の entry_hash（非空文字列）が出力される
  assert_eq "$rc" "0" "T2-5 --print-head は exit 0"
  [[ -n "$out" ]] && ok "T2-5 --print-head は entry_hash を出力する（非空）" || ng "T2-5 --print-head の出力が空"
  rm -rf "$TMP"
}
t2_5_print_head

# --- T2-6: 本番 DB 非破壊の検証 ----------------------------------------------
echo "== 本番 DB 非破壊の事後検証 =="
# シナリオ: 全テスト実行後も本リポの .agent-skill-chain/runtime/workflow.db が変化しない（tmp 隔離の自己検証）。
after_rows="$(sqlite3 "$BEFORE_DB" 'SELECT COUNT(*) FROM workflow_log;' 2>/dev/null || echo NA)"
after_mtime="$(stat -c %Y "$BEFORE_DB" 2>/dev/null || echo NA)"
assert_eq "$after_rows" "$before_rows" "T2-6 本番 DB の行数が不変（before=$before_rows after=$after_rows）"
assert_eq "$after_mtime" "$before_mtime" "T2-6 本番 DB の mtime が不変"

# --- 集計 -------------------------------------------------------------------
echo ""
echo "== 結果: PASS=$PASS FAIL=$FAIL =="
if [[ "$FAIL" -ne 0 ]]; then
  printf '  失敗: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
exit 0
