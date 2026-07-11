#!/usr/bin/env bash
# test-export-ndjson.sh — C-7: workflow.db → NDJSON export の検証テスト。
#
# ユースケース（このテストファイル全体）:
#   (1) export-ndjson.sh / agents-md export が workflow_log を 1 行 1 JSON で出力し、各行が妥当 JSON で
#       可視化主眼の連鎖列（parent_entry_id / command / issue_id）を含むこと。
#   (2) 出力が rowid 昇順（INSERT 順 = 因果順）であること。
#   (3) 固定列 actor_role=scribe / delegated_by_role=orchestrator が定数で含まれること（主眼ではないが出力）。
#   (4) read-only であること（export 後に DB が不変）。
#   (5) DB 不在は明示エラー非 0。workflow_log 不在は空出力＋警告（exit 0）。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - mktemp -d で隔離環境を作り、書記経路で既知ログを持つ DB を作って検証する。
#   - 本開発リポの .agent-skill-chain/source/ .agent-skill-chain/runtime/ workflow.db を変更しない。
#
# 使い方:
#   bash test/test-export-ndjson.sh
#
# 前提: bash・git・tar・node・sqlite3・python3（JSON 妥当性検証）。
# 参照:
#   docs/maintainer/workflow/20260616_042911_npmスコープ無し公開_将来組織移管/02_設計.md §3.9, 03_実装計画.md（T6）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"

for dep in git tar node sqlite3 python3; do
  command -v "$dep" >/dev/null 2>&1 || { echo "エラー: $dep が必要です（依存欠如）" >&2; exit 2; }
done

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: 期待 '$1' 実際 '$2'}"; }

[[ -f "$REPO_ROOT/bin/agents-md.js" ]] || { echo "エラー: bin/agents-md.js が無い（npm run build を先に）" >&2; exit 2; }
BIN="$REPO_ROOT/bin/agents-md.js"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
( cd "$REPO_ROOT" && git ls-files -z | tar --null -T - -cf - ) | tar -x -C "$TMP"
mkdir -p "$TMP/.agent-skill-chain/source/scripts"
cp "$REPO_ROOT/.agent-skill-chain/source/scripts/gen-entry-hash.sh" "$TMP/.agent-skill-chain/source/scripts/"
cp "$REPO_ROOT/.agent-skill-chain/source/scripts/write-workflow-log.sh" "$TMP/.agent-skill-chain/source/scripts/"
cp "$REPO_ROOT/.agent-skill-chain/source/scripts/export-ndjson.sh" "$TMP/.agent-skill-chain/source/scripts/"
chmod +x "$TMP/.agent-skill-chain/source/scripts/"*.sh
WWL="$TMP/.agent-skill-chain/source/scripts/write-workflow-log.sh"
EXP="$TMP/.agent-skill-chain/source/scripts/export-ndjson.sh"

# 既知ログを持つ DB を構築（書記経路・連鎖を作る: parent_entry_id でつながる）。
H="$TMP/repo"
mkdir -p "$H/.agent-skill-chain/runtime"
PARENT_ID="11111111-1111-4111-8111-111111111111"
( cd "$H" && AGENT_ROLE=scribe ENTRY_ID="$PARENT_ID" ISSUE_ID="22222222-2222-4222-8222-222222222222" \
    DOCUMENT_ID="33333333-3333-4333-8333-333333333331" \
    "$WWL" design-feature "export テスト 親（設計）" 1 "2026-06-16T00:00:01Z" "x/issue" >/dev/null 2>&1 )
( cd "$H" && AGENT_ROLE=scribe PARENT_ENTRY_ID="$PARENT_ID" ISSUE_ID="22222222-2222-4222-8222-222222222222" \
    DOCUMENT_ID="33333333-3333-4333-8333-333333333332" CHANGED_FILES_JSON='["a.txt","b.txt"]' \
    "$WWL" implement-feature "export テスト 子（実装）" 1 "2026-06-16T00:00:02Z" "x/issue" >/dev/null 2>&1 )

n=$(sqlite3 "$H/.agent-skill-chain/runtime/workflow.db" "SELECT COUNT(*) FROM workflow_log;" 2>/dev/null || echo 0)
[[ "$n" -eq 2 ]] && ok "既知ログ DB を 2 件作成（親→子の連鎖）" || ng "DB 作成失敗（件数=$n）"

# =====================================================================================
echo "== C-7(1)(2)(3): NDJSON 妥当・連鎖列・rowid 昇順・固定列 =="

export_via_cli() {
  # シナリオ: agents-md export が各行妥当 JSON・連鎖列含む・rowid 昇順・固定列を出力
  # Given: 既知の 2 件 DB
  local out
  out="$( cd "$H" && node "$BIN" export . 2>/dev/null )"
  # When: 行数を数える
  local lines; lines="$(printf '%s\n' "$out" | grep -c .)"
  # Then: 2 行
  assert_eq 2 "$lines" "export: 2 行（1 行 1 JSON）"

  # 各行が妥当 JSON で必須キーを含むことを python で検証。
  local valid
  valid="$(printf '%s\n' "$out" | python3 -c '
import sys, json
need = ["parent_entry_id","command","issue_id","actor_role","delegated_by_role","entry_hash","prev_hash"]
rows = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    d = json.loads(line)
    for k in need:
        assert k in d, "missing "+k
    rows.append(d)
# rowid 昇順 = 親（design-feature）が先、子（implement-feature）が後
assert rows[0]["command"] == "design-feature", "order: first must be design-feature"
assert rows[1]["command"] == "implement-feature", "order: second must be implement-feature"
# 連鎖: 子の parent_entry_id == 親の entry_id
assert rows[1]["parent_entry_id"] == rows[0]["entry_id"], "chain: child.parent must equal parent.entry_id"
# 固定列
assert rows[0]["actor_role"] == "scribe"
assert rows[0]["delegated_by_role"] == "orchestrator"
print("OK")
' 2>&1 )"
  assert_eq "OK" "$valid" "export: 各行妥当 JSON・連鎖列・rowid 昇順・固定列（$valid）"
}
export_via_cli

# =====================================================================================
echo "== C-7(4): read-only（export 後に DB 不変） =="
export_readonly() {
  # シナリオ: export 後も DB が変化しない（read-only）
  # Given: export 前の DB ハッシュ
  local before after
  before="$(sha256sum "$H/.agent-skill-chain/runtime/workflow.db" | awk '{print $1}')"
  # When: export を実行
  ( cd "$H" && node "$BIN" export . >/dev/null 2>&1 )
  ( cd "$H" && bash "$EXP" . >/dev/null 2>&1 )
  # Then: DB ハッシュ不変
  after="$(sha256sum "$H/.agent-skill-chain/runtime/workflow.db" | awk '{print $1}')"
  assert_eq "$before" "$after" "export: read-only（実行後 DB 不変）"
}
export_readonly

# =====================================================================================
echo "== C-7(5): 契約違反（DB 不在は非 0・workflow_log 不在は空出力 exit 0） =="
export_missing_db() {
  # シナリオ: DB 不在は明示エラー非 0
  local E="$TMP/empty"; mkdir -p "$E"
  local rc=0
  ( cd "$E" && bash "$EXP" . >/dev/null 2>&1 ) || rc=$?
  assert_eq 1 "$rc" "export: DB 不在は exit 1（明示エラー）"
}
export_empty_table() {
  # シナリオ: workflow_log テーブル不在は空出力＋警告 exit 0
  local E="$TMP/emptytable"; mkdir -p "$E/.agent-skill-chain/runtime"
  sqlite3 "$E/.agent-skill-chain/runtime/workflow.db" "CREATE TABLE other(x);"
  local out rc=0
  out="$( cd "$E" && bash "$EXP" . 2>/dev/null )" || rc=$?
  assert_eq 0 "$rc" "export: workflow_log 不在は exit 0（空出力＋警告）"
  assert_eq "" "$out" "export: workflow_log 不在は空出力"
}
export_missing_db
export_empty_table

# =====================================================================================
echo ""
echo "==================== 結果 ===================="
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "失敗:"
  for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
  exit 1
fi
echo "全テスト PASS"
exit 0
