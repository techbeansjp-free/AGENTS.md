#!/usr/bin/env bash
# test-c4-bypass-resistance.sh — PreToolUse.sh の C-4 バイパス耐性回帰テスト。
#
# ユースケース（このテストファイル全体）:
#   C-4a（パス正規化）: write-workflow-log.sh の単独実行判定を「正規化済み絶対パス＝実行 cwd 起点の配備先
#     .agents/scripts/write-workflow-log.sh の realpath」一致で行い、相対パス・symlink で別実体を指す同名・
#     bash -c 経由の回避を block(exit 2) する。正規の配備先絶対パス単独実行は allow(exit 0)。許可正本パスは
#     固定文字列でなく実行時 realpath 解決値である（消費者配備先で誤 block しない）。
#   C-4b（AGENT_ROLE 偽装耐性・主防御は hook 側 env 出所制御）: 正規 nonce/settings 配線でのみ scribe を許可。
#     手動 export した AGENT_ROLE=scribe（nonce 不一致）は unknown 降格＝write-workflow-log.sh 実行を block。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - mktemp -d ＋ git archive HEAD | tar -x のクリーン clone を作り、作業ツリーの最新 hook をオーバーレイする。
#   - 本開発リポの .agents/ .claude/ .cursor/ .workflow/ workflow.db を一切読み書き・変更しない。
#
# 使い方:
#   bash test/test-c4-bypass-resistance.sh
#
# 前提: bash・git・tar。realpath（無ければ readlink -f）。
# 参照:
#   docs/maintainer/workflow/20260616_042911_npmスコープ無し公開_将来組織移管/02_設計.md §3.6, 03_実装計画.md（T4）
#   .agents/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"

command -v git >/dev/null 2>&1 || { echo "エラー: git が必要です" >&2; exit 2; }
command -v tar >/dev/null 2>&1 || { echo "エラー: tar が必要です" >&2; exit 2; }

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: 期待 '$1' 実際 '$2'}"; }

# ---- tmp 隔離環境（クリーン clone 再現）----
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
( cd "$REPO_ROOT" && git archive HEAD | tar -x -C "$TMP" )
# 作業ツリーの最新 hook と scripts をオーバーレイ（未コミットの C-4 是正を verify するため）。
cp "$REPO_ROOT/.agents/enforcement/claude/PreToolUse.sh" "$TMP/.agents/enforcement/claude/PreToolUse.sh"
mkdir -p "$TMP/.agents/scripts"
cp "$REPO_ROOT/.agents/scripts/write-workflow-log.sh" "$TMP/.agents/scripts/write-workflow-log.sh"
cp "$REPO_ROOT/.agents/scripts/gen-entry-hash.sh" "$TMP/.agents/scripts/gen-entry-hash.sh"
chmod +x "$TMP/.agents/scripts/write-workflow-log.sh"

HOOK="$TMP/.agents/enforcement/claude/PreToolUse.sh"
[[ -f "$HOOK" ]] || { echo "エラー: 隔離環境に hook がありません" >&2; exit 2; }

# 配備先正本（realpath 解決値）。
WWL_REL=".agents/scripts/write-workflow-log.sh"
WWL_ABS="$(cd "$TMP" && (command -v realpath >/dev/null 2>&1 && realpath "$WWL_REL" || readlink -f "$WWL_REL"))"

ERR="$TMP/err.txt"
# run_hook <cwd> <role> <json> [extra env...] -> sets RC
run_hook() {
  local cwd="$1" role="$2" json="$3"; shift 3
  : > "$ERR"
  ( cd "$cwd" && echo "$json" | env PATH="$PATH" AGENTS_ROOT="$TMP/.agents" AGENT_ROLE="$role" "$@" bash "$HOOK" >/dev/null 2>"$ERR" )
  RC=$?
}

# =====================================================================================
echo "== C-4a: パス正規化（回避ベクタを block・正規経路を allow） =="

c4a_canonical_absolute_allowed() {
  # シナリオ: 配備先の正規 write-workflow-log.sh を絶対パス単独実行は allow（exit 0・境界=正当経路を壊さない）
  # Given: AGENT_ROLE=scribe、配備先 realpath の絶対パス単独実行
  local json
  json="{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$WWL_ABS requirement-discovery x\"}}"
  # When: 絶対パスで hook に渡す
  run_hook "$TMP" scribe "$json"
  # Then: exit 0（正規経路）
  assert_eq 0 "$RC" "C-4a: 配備先絶対パス単独実行は exit 0（許可正本=realpath 一致）"
}

c4a_relative_path_allowed_when_resolves_same() {
  # シナリオ: cwd 起点の相対パスは realpath 正規化で配備先と同一に収れんし allow（消費者の正当な相対実行）
  # Given: cwd=$TMP、AGENT_ROLE=scribe、相対パス .agents/scripts/write-workflow-log.sh
  local json='{"tool_name":"Bash","tool_input":{"command":".agents/scripts/write-workflow-log.sh requirement-discovery x"}}'
  # When: cwd=$TMP で相対パス実行（配備先と同一実体へ解決）
  run_hook "$TMP" scribe "$json"
  # Then: exit 0（realpath で配備先正本に一致）
  assert_eq 0 "$RC" "C-4a: cwd 起点相対パスは正規化で allow（誤 block しない・N-E）"
}

c4a_relative_dotslash_outside_blocked() {
  # シナリオ: 別 cwd からの相対パスは配備先 realpath と不一致になり block（回避ベクタ）
  # Given: cwd=$TMP/sub（配備先と異なる基点）、相対 ./write-workflow-log.sh で別実体を作る
  mkdir -p "$TMP/sub"
  cp "$WWL_ABS" "$TMP/sub/write-workflow-log.sh"  # 別実体（realpath が配備先と異なる）
  local json='{"tool_name":"Bash","tool_input":{"command":"./write-workflow-log.sh requirement-discovery x"}}'
  # When: cwd=$TMP/sub で ./write-workflow-log.sh（別実体）を実行
  run_hook "$TMP/sub" scribe "$json"
  # Then: exit 2（配備先 realpath と不一致＝別実体）
  assert_eq 2 "$RC" "C-4a: 別実体への相対パスは block（実体 realpath 不一致）"
}

c4a_symlink_to_other_blocked() {
  # シナリオ: 配備先と同名だが symlink で別実体を指すパスは実体 realpath 不一致で block
  # Given: $TMP/evil/write-workflow-log.sh が別の偽スクリプトへの symlink
  mkdir -p "$TMP/evil"
  printf '#!/usr/bin/env bash\necho evil\n' > "$TMP/evil/real-evil.sh"
  chmod +x "$TMP/evil/real-evil.sh"
  ln -sf "$TMP/evil/real-evil.sh" "$TMP/evil/write-workflow-log.sh"
  local json
  json="{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$TMP/evil/write-workflow-log.sh x\"}}"
  # When: basename は一致するが symlink 先が別実体
  run_hook "$TMP" scribe "$json"
  # Then: exit 2（realpath が配備先と不一致）
  assert_eq 2 "$RC" "C-4a: symlink で別実体を指す同名は block"
}

c4a_bash_c_wrapper_blocked() {
  # シナリオ: bash -c "write-workflow-log.sh ..." 経由は第1トークンが bash になり不一致で block
  # Given: AGENT_ROLE=scribe、bash -c ラップ
  local json='{"tool_name":"Bash","tool_input":{"command":"bash -c \".agents/scripts/write-workflow-log.sh x\""}}'
  # When: bash -c 経由で渡す
  run_hook "$TMP" scribe "$json"
  # Then: exit 2（第1トークン bash の realpath が配備先と不一致）
  assert_eq 2 "$RC" "C-4a: bash -c 経由は block（第1トークン不一致）"
}

c4a_canonical_absolute_allowed
c4a_relative_path_allowed_when_resolves_same
c4a_relative_dotslash_outside_blocked
c4a_symlink_to_other_blocked
c4a_bash_c_wrapper_blocked

# =====================================================================================
echo "== C-4b: AGENT_ROLE 偽装耐性（手動 export scribe を block・正規 nonce で allow） =="

c4b_manual_export_scribe_blocked() {
  # シナリオ: 期待 nonce が配線されている環境で、nonce を知らない手動 export AGENT_ROLE=scribe は block
  # Given: hook へ AGENTS_EXPECTED_SCRIBE_NONCE を配線（settings 配線相当）。呼び出し側は nonce を持たない。
  local json
  json="{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$WWL_ABS requirement-discovery x\"}}"
  # When: 正規 nonce なしで scribe を主張（手動 export 相当）
  run_hook "$TMP" scribe "$json" AGENTS_EXPECTED_SCRIBE_NONCE="sess-nonce-123"
  # Then: exit 2（nonce 不一致で unknown 降格 → scribe 以外の Bash は block）
  assert_eq 2 "$RC" "C-4b: 手動 export scribe（nonce 不一致）は block"
}

c4b_correct_nonce_scribe_allowed() {
  # シナリオ: 正規 nonce（settings 配線 env と一致）でのみ scribe として allow
  # Given: 期待 nonce と一致する AGENTS_SCRIBE_NONCE を持つ正規経路
  local json
  json="{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$WWL_ABS requirement-discovery x\"}}"
  # When: 正規 nonce 一致で scribe として実行
  run_hook "$TMP" scribe "$json" AGENTS_EXPECTED_SCRIBE_NONCE="sess-nonce-123" AGENTS_SCRIBE_NONCE="sess-nonce-123"
  # Then: exit 0（nonce 一致で scribe・配備先正本の単独実行）
  assert_eq 0 "$RC" "C-4b: 正規 nonce 一致の scribe は allow"
}

c4b_no_nonce_wiring_backcompat_allowed() {
  # シナリオ: nonce 未配線（後方互換）では従来どおり AGENT_ROLE をそのまま採用し正規経路は allow
  # Given: AGENTS_EXPECTED_SCRIBE_NONCE 未設定（消費者が未配線）
  local json
  json="{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$WWL_ABS requirement-discovery x\"}}"
  # When: nonce 配線なしで scribe として実行
  run_hook "$TMP" scribe "$json"
  # Then: exit 0（後方互換・nonce 未配線時は従来挙動）
  assert_eq 0 "$RC" "C-4b: nonce 未配線（後方互換）では正規経路 allow"
}

c4b_manual_export_scribe_blocked
c4b_correct_nonce_scribe_allowed
c4b_no_nonce_wiring_backcompat_allowed

# =====================================================================================
echo "== 既存ガード非破壊（R4 複合シェル・R6 sqlite3）が C-4 後も維持 =="

regress_compound_still_blocked() {
  # シナリオ: 複合シェル（&&）は C-4 後も exit 2（R4 維持）
  local json='{"tool_name":"Bash","tool_input":{"command":".agents/scripts/write-workflow-log.sh x && rm -rf /"}}'
  run_hook "$TMP" scribe "$json"
  assert_eq 2 "$RC" "回帰: R4 複合シェルは exit 2（非破壊）"
}
regress_sqlite_still_blocked() {
  # シナリオ: sqlite3 直接実行は C-4 後も exit 2（R6 維持）
  local json='{"tool_name":"Bash","tool_input":{"command":"sqlite3 db.sqlite \"SELECT 1\""}}'
  run_hook "$TMP" scribe "$json"
  assert_eq 2 "$RC" "回帰: R6 sqlite3 直接は exit 2（非破壊）"
}
regress_compound_still_blocked
regress_sqlite_still_blocked

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
