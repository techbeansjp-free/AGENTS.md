#!/usr/bin/env bash
# test-workflow-db-guard.sh — workflow.db 由来検知（軽量警告）の単体テスト。
#
# ユースケース（このテストファイル全体）:
#   .agent-skill-chain/source/scripts/lib/workflow-db-guard.sh の warn_if_foreign_workflow_db が、
#   非 sqlite3 ファイル・workflow_log テーブル不在の sqlite3 ファイル・正規 DB のそれぞれに対して
#   期待どおりの挙動（警告 or 沈黙・常に return 0・既存ファイル不変）を返すことを検証する。
#   加えて sqlite3 未導入・対象パス不在という検査不能ケースでも沈黙して return 0 することを確認する。
#
# 方針（破壊禁止・tmp 隔離）:
#   - 全シナリオを mktemp -d で完全隔離した一時ディレクトリ内で実行する。
#   - 本開発リポの .agent-skill-chain/runtime/workflow.db・.agent-skill-chain/source/・.claude/・.cursor/
#     を一切変更しない（対象パスは必ず /tmp 配下であることを assert_tmp_target で保証する）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-workflow-db-guard.sh   # リポジトリルート（git ツリー内）で実行
#   npm test                              # run-all.sh 経由
#
# 前提: bash。sqlite3 が無い環境では「有効 sqlite3」系ケースを SKIP 扱いにせず、
#       関数自体が沈黙 return 0 する挙動（検査不能ケース）として検証する。
# 参照:
#   .agent-skill-chain/source/scripts/lib/workflow-db-guard.sh（単一正本）
#   docs/maintainer/workflow/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/
#     20260711_062125_workflowDB由来検知欠如是正/03_実装計画.md §2.1
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
GUARD_SH="$REPO_ROOT/.agent-skill-chain/source/scripts/lib/workflow-db-guard.sh"

PASS=0
FAIL=0
FAILED_NAMES=()

# --- 簡易アサーション ---------------------------------------------------------
ok()   { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng()   { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: '$1' != '$2'}"; }

# 破壊的操作（フィクスチャ DB の生成等）の対象が必ず /tmp 配下（mktemp -d 由来）であることを保証する
# 安全ガード。誤って実リポジトリ等を対象にした場合に即座に FATAL 終了して被害を防ぐ（前回事故の再発防止）。
assert_tmp_target() {
  case "$1" in
    /tmp/*) : ;;
    *) echo "FATAL: unsafe target dir（/tmp 配下ではない）: $1" >&2; exit 1 ;;
  esac
}

# --- 必須前提 -----------------------------------------------------------------
[[ -f "$GUARD_SH" ]] || { echo "エラー: workflow-db-guard.sh が見つかりません: $GUARD_SH" >&2; exit 2; }

HAS_SQLITE=0; command -v sqlite3 >/dev/null 2>&1 && HAS_SQLITE=1

echo "[test-workflow-db-guard] REPO_ROOT=$REPO_ROOT"
echo "[test-workflow-db-guard] sqlite3=$([[ $HAS_SQLITE -eq 1 ]] && echo あり || echo なし（一部ケースは沈黙 return 0 として検証）)"

# shellcheck source=../.agent-skill-chain/source/scripts/lib/workflow-db-guard.sh
. "$GUARD_SH"

# =============================================================================
# シナリオ 1: 非 sqlite3 ファイルに対して警告する（01 UC1・03 §2.1.4）
# =============================================================================
test_non_sqlite_file_warns() {
  echo "[test] シナリオ1: 非 sqlite3 ファイルに対して警告し、戻り値0・ファイル不変であること"
  if [[ $HAS_SQLITE -eq 0 ]]; then
    echo "  [SKIP] sqlite3 が無いため本ケースは検査不能ケース（シナリオ5相当）に収束するため省略"
    return 0
  fi

  # Given: mktemp -d 内に "not a database" を書いた workflow.db を用意する
  local tmp db; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  db="$tmp/workflow.db"
  printf 'not a database' > "$db"

  # When: warn_if_foreign_workflow_db を呼び、stderr と戻り値を捕捉する
  local err rc
  err="$(warn_if_foreign_workflow_db "$db" 2>&1 1>/dev/null)"; rc=$?

  # Then: 戻り値0・3要素警告（対象パス・workflow_log・確認手順）・ファイル不変を検証する
  assert_eq "$rc" "0" "非sqlite3: 戻り値が常に0であること"
  if grep -qF "$db" <<<"$err" && grep -q "workflow_log" <<<"$err" && grep -q "確認" <<<"$err"; then
    ok "非sqlite3: 警告文に3要素（対象パス・推定される問題・確認手順）が含まれる"
  else
    ng "非sqlite3: 警告文に3要素が含まれるべき（実際: $err）"
  fi
  assert_eq "$(cat "$db")" "not a database" "非sqlite3: ファイル内容が不変であること"

  rm -rf "$tmp"
}

# =============================================================================
# シナリオ 2: workflow_log を持たない sqlite3 に対して警告する（01 UC1・03 §2.1.4）
# =============================================================================
test_sqlite_without_table_warns() {
  echo "[test] シナリオ2: workflow_log テーブル不在の有効 sqlite3 ファイルに対して警告すること"
  if [[ $HAS_SQLITE -eq 0 ]]; then
    echo "  [SKIP] sqlite3 が無いため本ケースを検証できない"
    return 0
  fi

  # Given: mktemp -d 内に workflow_log を持たない有効 sqlite3 DB を用意する
  local tmp db; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  db="$tmp/workflow.db"
  sqlite3 "$db" "CREATE TABLE other(x);" >/dev/null 2>&1

  # When: warn_if_foreign_workflow_db を呼ぶ
  local err rc
  err="$(warn_if_foreign_workflow_db "$db" 2>&1 1>/dev/null)"; rc=$?

  # Then: 警告が出力され、戻り値は0であること
  assert_eq "$rc" "0" "テーブル不在: 戻り値が常に0であること"
  if grep -qF "$db" <<<"$err" && grep -q "workflow_log" <<<"$err"; then
    ok "テーブル不在: 警告が出力される"
  else
    ng "テーブル不在: 警告が出力されるべき（実際: $err）"
  fi

  rm -rf "$tmp"
}

# =============================================================================
# シナリオ 3: 正規DBに対しては警告しない（01 UC2・false positive 回避・03 §2.1.4）
# =============================================================================
test_valid_db_silent() {
  echo "[test] シナリオ3: workflow_log テーブルを持つ正規DBに対しては警告しないこと"
  if [[ $HAS_SQLITE -eq 0 ]]; then
    echo "  [SKIP] sqlite3 が無いため本ケースを検証できない"
    return 0
  fi

  # Given: mktemp -d 内に workflow_log テーブルを持つ DB を用意する
  local tmp db; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  db="$tmp/workflow.db"
  sqlite3 "$db" "CREATE TABLE workflow_log(entry_id INTEGER PRIMARY KEY);" >/dev/null 2>&1

  # When: warn_if_foreign_workflow_db を呼ぶ
  local err rc
  err="$(warn_if_foreign_workflow_db "$db" 2>&1 1>/dev/null)"; rc=$?

  # Then: 警告が出力されず、戻り値は0であること
  assert_eq "$rc" "0" "正規DB: 戻り値が常に0であること"
  assert_eq "$err" "" "正規DB: 警告が出力されない（沈黙）こと"

  rm -rf "$tmp"
}

# =============================================================================
# シナリオ 3b: 旧スキーマ差分（マイグレーション救済対象）でも workflow_log があれば警告しない
# =============================================================================
test_legacy_schema_variant_silent() {
  echo "[test] シナリオ3b: workflow_log テーブルさえあれば旧カラム構成でも警告しないこと（false positive 回避）"
  if [[ $HAS_SQLITE -eq 0 ]]; then
    echo "  [SKIP] sqlite3 が無いため本ケースを検証できない"
    return 0
  fi

  # Given: マイグレーション未適用を模した最小カラムの workflow_log を持つ DB を用意する
  local tmp db; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  db="$tmp/workflow.db"
  sqlite3 "$db" "CREATE TABLE workflow_log(entry_id INTEGER PRIMARY KEY, note TEXT);" >/dev/null 2>&1

  # When: warn_if_foreign_workflow_db を呼ぶ
  local err rc
  err="$(warn_if_foreign_workflow_db "$db" 2>&1 1>/dev/null)"; rc=$?

  # Then: カラム構成の違いに関わらずテーブル存在のみで沈黙する
  assert_eq "$rc" "0" "旧スキーマ差分: 戻り値が常に0であること"
  assert_eq "$err" "" "旧スキーマ差分: テーブルが存在すれば警告しない（false positive 回避）"

  rm -rf "$tmp"
}

# =============================================================================
# シナリオ 4: sqlite3 未導入環境では検査不能のため沈黙して return 0 すること（03 §2.1.3）
# =============================================================================
test_sqlite_missing_silent() {
  echo "[test] シナリオ4: sqlite3 が PATH に無い場合、検査不能として沈黙 return 0 すること"

  # Given: 非 sqlite3 ファイル（本来なら警告対象）を用意し、PATH から sqlite3 を除いた環境を模す
  local tmp db; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  db="$tmp/workflow.db"
  printf 'not a database' > "$db"

  # sqlite3 の実体を含まない最小 PATH（POSIX 標準コマンドのみ）を用意する。
  # bash 組込み（command, printf 等）はそのまま使えるため PATH を空同然にしても関数は動く。
  local empty_path_dir; empty_path_dir="$tmp/emptybin"; mkdir -p "$empty_path_dir"

  # When: PATH を sqlite3 の無いディレクトリのみに絞った subshell で関数を呼ぶ
  local err rc
  err="$(PATH="$empty_path_dir" warn_if_foreign_workflow_db "$db" 2>&1 1>/dev/null)"; rc=$?

  # Then: 検査不能のため警告は出さず、戻り値は0であること（既存ファイルも不変）
  assert_eq "$rc" "0" "sqlite3不在: 戻り値が常に0であること"
  assert_eq "$err" "" "sqlite3不在: 検査不能のため沈黙する（警告を出さない）こと"
  assert_eq "$(cat "$db")" "not a database" "sqlite3不在: ファイル内容が不変であること"

  rm -rf "$tmp"
}

# =============================================================================
# シナリオ 5: 引数パスが存在しない場合は防御的に沈黙 return 0 すること（03 §2.1.3）
# =============================================================================
test_missing_path_silent() {
  echo "[test] シナリオ5: 引数パスが存在しない場合、防御的に沈黙 return 0 すること"

  # Given: 存在しないファイルパスを用意する
  local tmp db; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  db="$tmp/does-not-exist.db"

  # When: warn_if_foreign_workflow_db を呼ぶ
  local err rc
  err="$(warn_if_foreign_workflow_db "$db" 2>&1 1>/dev/null)"; rc=$?

  # Then: 警告を出さず、戻り値は0であること
  assert_eq "$rc" "0" "パス不在: 戻り値が常に0であること"
  assert_eq "$err" "" "パス不在: 警告を出さず沈黙すること"

  rm -rf "$tmp"
}

# --- 実行 ---------------------------------------------------------------------
test_non_sqlite_file_warns
test_sqlite_without_table_warns
test_valid_db_silent
test_legacy_schema_variant_silent
test_sqlite_missing_silent
test_missing_path_silent

echo "--------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
exit 0
