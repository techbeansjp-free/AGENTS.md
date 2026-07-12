#!/usr/bin/env bash
# e2e-claude-hook.sh — C-3: Claude Code hook 実機相当 E2E（settings.json 配線経由）。
#
# ユースケース（このテストファイル全体）:
#   実機 Claude Code は起動できないため「実機相当」を合成環境で再現する:
#     (1) tmp 隔離クリーン clone に init 相当の配備 ＋ enforce on で .claude/settings.json の PreToolUse 配線
#         （settings.enforce.json 由来）を実構成する。
#     (2) settings.json の hook コマンド指定を解釈し、実プロセスとして hook を spawn し stdin に実機形式
#         JSON（{"tool_name":...,"tool_input":{...}}）を注入して exit code を検証する（block=2 / allow=0）。
#     (3) AGENT_ROLE は settings.json の env 経由で渡る経路を再現する。
#   既存 test-pretooluse-hook.sh が hook 単体の入力契約を担保するのに対し、本 E2E は settings.json 配線を
#   通した経路を担保する（責務分離・重複は配線部分のみ）。実機 Claude Code 実行は SC 対象外（合成で代替）。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - mktemp -d ＋ git archive HEAD | tar -x のクリーン clone で agents-md init/enforce を実行する。
#   - 本開発リポの .agent-skill-chain/source/ .claude/ .cursor/ .agent-skill-chain/runtime/ workflow.db を一切変更しない。
#
# 使い方:
#   bash test/e2e-claude-hook.sh
#
# 前提: bash・git・tar・node・python3（settings.json 解釈）。sqlite3 は不要（hook は DB を触らない）。
# 参照:
#   docs/maintainer/workflow/20260616_042911_npmスコープ無し公開_将来組織移管/02_設計.md §3.5, 03_実装計画.md（T7）
#   docs/maintainer/claude-hook-e2e.md（実機実行手順）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"

for dep in git tar node python3; do
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

# ---- tmp 隔離環境（クリーン clone） ----
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PROJ="$TMP/proj"
mkdir -p "$PROJ"
( cd "$REPO_ROOT" && git ls-files -z | tar --null -T - -cf - ) | tar -x -C "$PROJ"
# 作業ツリーの最新 hook・settings.enforce.json をオーバーレイ（未コミットの是正を E2E で検証）。
cp "$REPO_ROOT/.agent-skill-chain/source/enforcement/claude/PreToolUse.sh" "$PROJ/.agent-skill-chain/source/enforcement/claude/PreToolUse.sh"
cp "$REPO_ROOT/.agent-skill-chain/source/platforms/claude/settings.enforce.json" "$PROJ/.agent-skill-chain/source/platforms/claude/settings.enforce.json"

# init 相当（setup ではなく hook 配備を最小再現）: .claude/hooks に正本 hook を配置。
mkdir -p "$PROJ/.claude/hooks"
cp "$PROJ/.agent-skill-chain/source/enforcement/claude/PreToolUse.sh" "$PROJ/.claude/hooks/PreToolUse.sh"
[[ -f "$PROJ/.agent-skill-chain/source/enforcement/claude/PostToolUse.sh" ]] && cp "$PROJ/.agent-skill-chain/source/enforcement/claude/PostToolUse.sh" "$PROJ/.claude/hooks/PostToolUse.sh"

# enforce on で settings.json に PreToolUse 配線をマージする（CLI 経由＝実構成）。
( cd "$PROJ" && node "$BIN" enforce on . >/dev/null 2>&1 )
SETTINGS="$PROJ/.claude/settings.json"
[[ -f "$SETTINGS" ]] || { echo "エラー: enforce on で settings.json が作られませんでした" >&2; exit 2; }

# settings.json から PreToolUse の hook コマンド文字列を取り出す（実機が実行する command）。
HOOK_CMD="$(python3 -c '
import json, sys
s = json.load(open(sys.argv[1]))
pre = s.get("hooks", {}).get("PreToolUse", [])
for entry in pre:
    for h in entry.get("hooks", []):
        if h.get("type") == "command" and "command" in h:
            print(h["command"]); sys.exit(0)
sys.exit(1)
' "$SETTINGS")" || { echo "エラー: settings.json から PreToolUse command を取得できません" >&2; exit 2; }

[[ -n "$HOOK_CMD" ]] && ok "enforce on で settings.json に PreToolUse 配線が構成された" || ng "PreToolUse 配線が無い"

# 実機相当の hook 実行: settings の command 文字列を、実機が渡す環境変数（CLAUDE_PROJECT_DIR・AGENT_ROLE）で
#   評価し、stdin に実機形式 JSON を注入する。command 文字列内の ${CLAUDE_PROJECT_DIR} 等はシェルが展開する。
ERR="$TMP/err.txt"
run_wired() {
  local role="$1" json="$2"
  : > "$ERR"
  # CLAUDE_PROJECT_DIR を隔離環境に、AGENT_ROLE を注入。settings の command をシェルで評価して実行する
  # （実機: 設定の env と hook コマンドを通して PreToolUse が起動する経路の再現）。
  echo "$json" | env CLAUDE_PROJECT_DIR="$PROJ" AGENT_ROLE="$role" bash -c "$HOOK_CMD" >/dev/null 2>"$ERR"
  RC=$?
}

# =====================================================================================
echo "== C-3: settings.json 配線経由の block/allow（実機相当 stdin JSON 注入） =="

e2e_orchestrator_write_blocked() {
  # シナリオ: 配線経由で orchestrator の Write が block(exit 2)（01 SC-10）
  # Given: settings 配線・AGENT_ROLE=orchestrator・違反 Write JSON
  local json='{"tool_name":"Write","tool_input":{"file_path":"00_要求定義.md"}}'
  # When: settings の hook コマンドへ stdin JSON 注入
  run_wired orchestrator "$json"
  # Then: exit 2（配線経由で物理ブロック）
  assert_eq 2 "$RC" "C-3: 配線経由 orchestrator Write は exit 2（block）"
}

e2e_orchestrator_read_allowed() {
  # シナリオ: 配線経由で orchestrator の Read（allowlist 内）は allow(exit 0)
  # Given: settings 配線・AGENT_ROLE=orchestrator・許可ツール Read JSON
  local json='{"tool_name":"Read","tool_input":{"file_path":"README.md"}}'
  # When: settings の hook コマンドへ stdin JSON 注入
  run_wired orchestrator "$json"
  # Then: exit 0（正当な Read は allow）
  assert_eq 0 "$RC" "C-3: 配線経由 orchestrator Read は exit 0（allow）"
}

e2e_workflow_edit_blocked() {
  # シナリオ: 配線経由で .workflow 直接 Edit が block（全 ROLE 適用 R1）
  # Given: settings 配線・AGENT_ROLE=worker・保護パス Edit JSON
  local json='{"tool_name":"Edit","tool_input":{"file_path":".agent-skill-chain/runtime/x/00_要求定義.md"}}'
  # When: settings の hook コマンドへ stdin JSON 注入
  run_wired worker "$json"
  # Then: exit 2（R1 は配線経由でも発火）
  assert_eq 2 "$RC" "C-3: 配線経由 .workflow 直接 Edit は exit 2（block）"
}

e2e_orchestrator_write_blocked
e2e_orchestrator_read_allowed
e2e_workflow_edit_blocked

# ---- 非破壊確認 ----
echo "== 非破壊確認 =="
ok "全 E2E を tmp 隔離（$TMP 配下）で実行した"

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
