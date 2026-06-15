#!/usr/bin/env bash
# test-write-workflow-log-multidoc.sh — 1 command が複数成果物（00/01...）を生む場合に、
#   成果物ごとに write-workflow-log.sh を 1 回ずつ呼ぶ「複数件記録」の回帰テスト。
#
# ユースケース（このテストファイル全体）:
#   1 command が複数の成果ドキュメント（それぞれ別の document_id・document_path を持つ）を生んだとき、
#   書記が成果物ごとに write-workflow-log.sh を 1 回ずつ呼ぶ（スクリプト・スキーマ無改造）。このとき、
#   (i) 各行の prev_hash が直前行の entry_hash に自動連結され因果チェーンが壊れない、
#   (ii) 全 document_id について audit#20 相当（workflow_log に該当 document_id が 1 件以上）を満たす、
#   (iii) 同一 document_path に別の document_id を後追い記録すると #20+ で拒否（exit 1）される、
#   (iv) 両ランタイム（.workflow/<issue>/ と docs/maintainer/workflow/<issue>/）のルート相対 document_path で
#        いずれも #20 相当 PASS になる、ことを保証する。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - 全シナリオを mktemp -d の一時 DB／クリーン環境で実行する（.agents-project/自己拡張ワークフロー.md §テストの tmp 隔離）。
#   - 本開発リポの .workflow/workflow.db を一切読み書き・変更しない（PROJECT_ROOT を一時ディレクトリに向ける）。
#   - schema.sql / write-workflow-log.sh は read のみ（一時 DB に流す／呼び出すのみ・無改造）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-write-workflow-log-multidoc.sh   # リポジトリルートで実行
#
# 前提: bash・sqlite3。
# 参照:
#   docs/maintainer/workflow/20260615_124110_audit20の複数成果物document_id紐付け恒久対策/02_設計.md（§3.1/§3.2・SC1–SC6）, 03_実装計画.md（T1）
#   .agents/enforcement/ci/audit.sh（#20/#20+ check_document_id_linked。COUNT≥1 / 同一 path 別 id 拒否）
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

# 記録ヘルパ: PROJECT_ROOT を tmp に向け、書記として 1 成果物を記録（PREV_HASH 未指定＝自動連結対象）。
#   引数: root docid docpath summary  （docpath はプロジェクトルート相対）
record_doc() {
  local root="$1" docid="$2" docpath="$3" summary="$4"
  PROJECT_ROOT="$root" AGENT_ROLE=scribe DOCUMENT_ID="$docid" DOCUMENT_PATH="$docpath" \
    "$WWL" requirement-discovery "$summary" 1 "2026-06-15T10:00:00Z"
}

# audit#20 相当: ある document_id について workflow_log に 1 件以上記録があるか（COUNT を返す）。
#   audit.sh check_document_id_linked:619 の SELECT COUNT(*) と同型。
count_doc() {
  local db="$1" docid="$2"
  sqlite3 "$db" "SELECT COUNT(*) FROM workflow_log WHERE document_id = '${docid//\'/\'\'}';" 2>/dev/null || echo "0"
}

echo "== 本番 DB 非破壊の事前計測 =="
BEFORE_DB="$REPO_ROOT/.workflow/workflow.db"
before_rows="$(sqlite3 "$BEFORE_DB" 'SELECT COUNT(*) FROM workflow_log;' 2>/dev/null || echo NA)"
before_mtime="$(stat -c %Y "$BEFORE_DB" 2>/dev/null || echo NA)"

# --- M1: 複数件連結（00+01）の prev_hash 連結（CHAIN_OK・中間 NULL なし）--------
echo "== M1: 複数成果物 00+01 の prev_hash 自動連結（SC1/SC3） =="
# シナリオ: 同 command が 00（doc_id A）と 01（doc_id B）を生み、成果物ごとに 1 回ずつ記録すると
#           行2(01).prev_hash == 行1(00).entry_hash に連結し、中間 NULL entry が無い。
m1_chain() {
  # Given: クリーン一時環境。00（doc_id A・path .../00）を PREV_HASH 未指定で記録
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.workflow/workflow.db"
  local ISS=".workflow/20260615_000000_multidoc"
  record_doc "$TMP" "11111111-1111-1111-1111-111111111111" "$ISS/00_要求定義.md" "00 entry" >/dev/null
  # When: 続けて 01（doc_id B・path .../01）も PREV_HASH 未指定で記録（自動連結）
  record_doc "$TMP" "22222222-2222-2222-2222-222222222222" "$ISS/01_要件定義.md" "01 entry" >/dev/null
  local e1 p2 nulls
  e1="$(sqlite3 "$DB" "SELECT entry_hash FROM workflow_log ORDER BY rowid ASC  LIMIT 1;")"
  p2="$(sqlite3 "$DB" "SELECT prev_hash  FROM workflow_log ORDER BY rowid DESC LIMIT 1;")"
  nulls="$(sqlite3 "$DB" "SELECT COUNT(*) FROM workflow_log WHERE rowid>(SELECT MIN(rowid) FROM workflow_log) AND prev_hash IS NULL;")"
  # Then: 行2(01) の prev_hash = 行1(00) の entry_hash、かつ rowid>min で NULL の中間 entry なし（CHAIN_OK）
  assert_eq "$p2" "$e1" "M1 01 の prev_hash = 00 の entry_hash（複数件でも自動連結）"
  assert_eq "$nulls" "0" "M1 中間 NULL entry が存在しない（CHAIN_OK）"
  rm -rf "$TMP"
}
m1_chain

# --- M2: 全 document_id が #20 相当 PASS（取りこぼし 0）--------------------------
echo "== M2: 全 document_id が #20 相当 PASS（SC1） =="
# シナリオ: 00 と 01 を成果物ごとに記録すると、両 document_id とも workflow_log に COUNT≥1（取りこぼし 0）。
m2_all_linked() {
  # Given: クリーン一時環境に 00（A）と 01（B）を記録
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.workflow/workflow.db"
  local ISS=".workflow/20260615_000000_multidoc"
  local A="33333333-3333-3333-3333-333333333333" B="44444444-4444-4444-4444-444444444444"
  record_doc "$TMP" "$A" "$ISS/00_要求定義.md" "00 entry" >/dev/null
  record_doc "$TMP" "$B" "$ISS/01_要件定義.md" "01 entry" >/dev/null
  # When: 各 document_id について workflow_log の件数を数える（audit#20 相当）
  local ca cb
  ca="$(count_doc "$DB" "$A")"; cb="$(count_doc "$DB" "$B")"
  # Then: 両 document_id とも 1 件以上（#20 PASS・取りこぼし 0）
  [[ "${ca:-0}" -ge 1 ]] && ok "M2 00 の document_id は #20 PASS（COUNT=$ca≥1）" || ng "M2 00 の document_id が未記録（#20 FAIL）"
  [[ "${cb:-0}" -ge 1 ]] && ok "M2 01 の document_id は #20 PASS（COUNT=$cb≥1）" || ng "M2 01 の document_id が未記録（#20 FAIL）"
  rm -rf "$TMP"
}
m2_all_linked
# シナリオ: 02/03 を追加した N=4 連結でも全件 #20 PASS かつ各行 prev_hash が直前 entry_hash に連結する。
m2_four_docs() {
  # Given: クリーン一時環境に 00/01/02/03 を成果物ごとに 1 回ずつ昇順記録
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.workflow/workflow.db"
  local ISS=".workflow/20260615_000000_multidoc"
  local A="55555555-5555-5555-5555-555555555555" B="66666666-6666-6666-6666-666666666666"
  local C="77777777-7777-7777-7777-777777777777" D="88888888-8888-8888-8888-888888888888"
  record_doc "$TMP" "$A" "$ISS/00_要求定義.md"   "00 entry" >/dev/null
  record_doc "$TMP" "$B" "$ISS/01_要件定義.md"   "01 entry" >/dev/null
  record_doc "$TMP" "$C" "$ISS/02_設計.md"       "02 entry" >/dev/null
  record_doc "$TMP" "$D" "$ISS/03_実装計画.md"   "03 entry" >/dev/null
  # When: 全 document_id の記録件数の合計と、prev_hash≠直前 entry_hash の連結破れ件数を数える
  local linked broken
  linked=$(( $(count_doc "$DB" "$A") + $(count_doc "$DB" "$B") + $(count_doc "$DB" "$C") + $(count_doc "$DB" "$D") ))
  broken="$(sqlite3 "$DB" "
    SELECT COUNT(*) FROM workflow_log a
    WHERE a.rowid > (SELECT MIN(rowid) FROM workflow_log)
      AND a.prev_hash IS NOT (SELECT b.entry_hash FROM workflow_log b WHERE b.rowid < a.rowid ORDER BY b.rowid DESC LIMIT 1);" 2>/dev/null || echo "NA")"
  # Then: 4 件すべて記録（合計 4・#20 PASS）かつ連結破れ 0（全行が直前 entry_hash に連結）
  assert_eq "$linked" "4" "M2 N=4 全 document_id が #20 PASS（合計 COUNT=4）"
  assert_eq "$broken" "0" "M2 N=4 で全行の prev_hash が直前 entry_hash に連結（連結破れ 0）"
  rm -rf "$TMP"
}
m2_four_docs

# --- M3: #20+ 同一 document_path に別 document_id を後追い記録すると拒否（exit 1）----
echo "== M3: #20+ 同一 path 別 id の拒否（SC4） =="
# シナリオ: 00（path P・doc_id A）を記録後、同じ path P に別 doc_id A' を記録しようとすると exit 1 で拒否される。
m3_immutable() {
  # Given: 00（path P・doc_id A）を記録済みの一時環境
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.workflow/workflow.db"
  local ISS=".workflow/20260615_000000_multidoc" P
  P=".workflow/20260615_000000_multidoc/00_要求定義.md"
  record_doc "$TMP" "99999999-9999-9999-9999-999999999999" "$P" "00 entry" >/dev/null
  # When: 同一 path P に別 document_id を後追い記録する
  local rc before_cnt after_cnt
  before_cnt="$(sqlite3 "$DB" "SELECT COUNT(*) FROM workflow_log;")"
  PROJECT_ROOT="$TMP" AGENT_ROLE=scribe DOCUMENT_ID="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" DOCUMENT_PATH="$P" \
    "$WWL" requirement-discovery "00 mutated" 1 "2026-06-15T11:00:00Z" >/dev/null 2>&1
  rc=$?
  after_cnt="$(sqlite3 "$DB" "SELECT COUNT(*) FROM workflow_log;")"
  # Then: exit 1 で拒否され、行は増えない（document_id 不変・#20+ 維持）
  [[ "$rc" -ne 0 ]] && ok "M3 同一 path 別 id は exit!=0 で拒否（#20+ 維持）" || ng "M3 同一 path 別 id が拒否されない（#20+ 破れ）"
  assert_eq "$after_cnt" "$before_cnt" "M3 拒否時に行が増えない（before=$before_cnt after=$after_cnt）"
  rm -rf "$TMP"
}
m3_immutable
# シナリオ: 同一 path・同一 document_id の再記録は許容される（不変＝同値は許可・取り消しではない）。
m3_same_id_allowed() {
  # Given: 00（path P・doc_id A）を記録済みの一時環境
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.workflow/workflow.db"
  local P=".workflow/20260615_000000_multidoc/00_要求定義.md"
  local A="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
  record_doc "$TMP" "$A" "$P" "00 entry" >/dev/null
  # When: 同一 path P・同一 doc_id A を再記録する
  local rc; record_doc "$TMP" "$A" "$P" "00 re-entry" >/dev/null 2>&1; rc=$?
  # Then: exit 0（同一 id の再記録は #20+ で拒否しない）
  assert_eq "$rc" "0" "M3 同一 path 同一 id の再記録は許容（exit 0）"
  rm -rf "$TMP"
}
m3_same_id_allowed

# --- M4: 両ランタイムの document_path で #20 相当 PASS（ルート相対統一）-----------
echo "== M4: 両ランタイム共通の document_path 正規化（SC6） =="
# シナリオ: 消費者既定（.workflow/<issue>/00）と本リポ自己拡張（docs/maintainer/workflow/<issue>/00）の
#           いずれのルート相対 document_path でも、記録後に #20 相当（COUNT≥1）を満たす。
m4_dual_runtime() {
  # Given: クリーン一時環境。両ランタイムの 00 をルート相対 document_path で記録
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.workflow/workflow.db"
  local CON="cccccccc-cccc-cccc-cccc-cccccccccccc" SELF="dddddddd-dddd-dddd-dddd-dddddddddddd"
  local CON_PATH=".workflow/20260615_000000_multidoc/00_要求定義.md"
  local SELF_PATH="docs/maintainer/workflow/20260615_000000_multidoc/00_要求定義.md"
  record_doc "$TMP" "$CON"  "$CON_PATH"  "consumer runtime 00" >/dev/null
  record_doc "$TMP" "$SELF" "$SELF_PATH" "self-ext runtime 00" >/dev/null
  # When: 各ランタイムの document_id について #20 相当の COUNT を数え、記録された document_path を取得
  local cc cs stored_con stored_self
  cc="$(count_doc "$DB" "$CON")"; cs="$(count_doc "$DB" "$SELF")"
  stored_con="$(sqlite3 "$DB" "SELECT document_path FROM workflow_log WHERE document_id='$CON';")"
  stored_self="$(sqlite3 "$DB" "SELECT document_path FROM workflow_log WHERE document_id='$SELF';")"
  # Then: 両ランタイムとも #20 PASS（COUNT≥1）、document_path は渡したルート相対表記のまま（./・絶対化されない）
  [[ "${cc:-0}" -ge 1 ]] && ok "M4 .workflow ランタイムの 00 が #20 PASS" || ng "M4 .workflow ランタイムが #20 FAIL"
  [[ "${cs:-0}" -ge 1 ]] && ok "M4 docs/maintainer/workflow ランタイムの 00 が #20 PASS" || ng "M4 docs/maintainer/workflow ランタイムが #20 FAIL"
  assert_eq "$stored_con"  "$CON_PATH"  "M4 .workflow の document_path はルート相対のまま保存"
  assert_eq "$stored_self" "$SELF_PATH" "M4 docs/maintainer/workflow の document_path はルート相対のまま保存"
  rm -rf "$TMP"
}
m4_dual_runtime

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
