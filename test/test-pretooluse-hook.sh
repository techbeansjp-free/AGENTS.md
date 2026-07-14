#!/usr/bin/env bash
# test-pretooluse-hook.sh — PreToolUse.sh / PostToolUse.sh の単体テスト（stdin JSON 契約・exit 2 ブロック・AGENT_ROLE 別 reject）。
#
# ユースケース（このテストファイル全体）:
#   実機 Claude Code の hooks 契約（stdin JSON 入力・ブロック exit 2）に整合した PreToolUse.sh が、
#   stdin の JSON（または env 後方互換）から tool 情報を取得し、AGENT_ROLE（orchestrator/worker/scribe/unknown）
#   ごとに規約違反を exit 2 で reject し、正当操作を exit 0 で allow すること。jq 有/無の両系統で同一に動くこと。
#   PostToolUse.sh は stdin を受けても案内のみ exit 0 すること。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - 検証は mktemp -d ＋ git archive HEAD | tar -x のクリーン clone 再現環境で行う。
#   - 本開発リポの .agent-skill-chain/source/ .claude/ .cursor/ .agent-skill-chain/runtime/ workflow.db を一切読み書き・変更しない。
#   - jq 無し系統は jq を除いた PATH（NOJQ_PATH）で同テストを再実行する。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-pretooluse-hook.sh   # リポジトリルートで実行
#
# 前提: bash・git・tar。jq は任意（無い系統も検証する）。
# 参照:
#   docs/maintainer/workflow/20260614_183739_enforcement-runtime実効性是正/02_設計.md, 03_実装計画.md（T1〜T6・UC1〜7）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"   # test/ -> repo root（配置非依存）

command -v git >/dev/null 2>&1 || { echo "エラー: git が必要です" >&2; exit 2; }
command -v tar >/dev/null 2>&1 || { echo "エラー: tar が必要です" >&2; exit 2; }

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: 期待 '$1' 実際 '$2'}"; }
assert_grep() { grep -q "$1" "$2" && ok "${3:-stderr に '$1'}" || ng "${3:-stderr に '$1' が無い}"; }

# ---- tmp 隔離環境（クリーン clone 再現）を作る ----
#   git archive HEAD でコミット済みツリーを展開し、その上に作業ツリーの正本 hook を
#   オーバーレイする。これにより本リポを一切書き換えずに「いま編集中の hook」を隔離環境で検証する。
#   （未コミットの是正を verify するための運用。確定後は HEAD のみで一致する。）
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
( cd "$REPO_ROOT" && git ls-files -z | tar --null -T - -cf - ) | tar -x -C "$TMP"
# 作業ツリーの最新 hook をオーバーレイ（read-only コピー。本リポ側は変更しない）。
cp "$REPO_ROOT/.agent-skill-chain/source/enforcement/claude/PreToolUse.sh"  "$TMP/.agent-skill-chain/source/enforcement/claude/PreToolUse.sh"
cp "$REPO_ROOT/.agent-skill-chain/source/enforcement/claude/PostToolUse.sh" "$TMP/.agent-skill-chain/source/enforcement/claude/PostToolUse.sh"

HOOK="$TMP/.agent-skill-chain/source/enforcement/claude/PreToolUse.sh"
POST_HOOK="$TMP/.agent-skill-chain/source/enforcement/claude/PostToolUse.sh"
[[ -f "$HOOK" && -f "$POST_HOOK" ]] || { echo "エラー: 隔離環境に hook がありません" >&2; exit 2; }

# AGENTS_ROOT を隔離環境の .agent-skill-chain/source に固定（案内出力を有効化しつつ、判定は確定変数で行う）。
export AGENTS_ROOT="$TMP/.agent-skill-chain/source"

# jq 不在 PATH を作る（jq バイナリだけを除いたディレクトリ群を再構成）。
make_nojq_path() {
  local d="$TMP/nojq-bin"
  mkdir -p "$d"
  # よく使うコアコマンドを symlink（jq は意図的に含めない）。
  local cmd src
  for cmd in bash sh cat sed grep head env dirname basename realpath readlink printf echo cut tr; do
    src="$(command -v "$cmd" 2>/dev/null)" || continue
    ln -sf "$src" "$d/$cmd" 2>/dev/null || true
  done
  printf '%s' "$d"
}
NOJQ_PATH="$(make_nojq_path)"

# jq 経路を確実に通すための jq シム。hook が使う 3 フィルタ
#   （.tool_name // empty / .tool_input.command // empty / .tool_input.file_path // empty）だけを
#   忠実に実装する。システムに jq が無い環境でも jq 分岐の配線を決定的に検証するためのもの。
#   システムに本物の jq がある場合はそれを優先する（シムは PATH の前段に置くが、本物があればテスト名で区別）。
make_jq_path() {
  local d="$TMP/jq-bin"
  mkdir -p "$d"
  # 本物の jq があればそれを使う（シム不要）。
  if command -v jq >/dev/null 2>&1; then
    ln -sf "$(command -v jq)" "$d/jq"
    printf '%s' "$d:$PATH"
    return 0
  fi
  # jq シム（限定フィルタのみ）。python3 があれば JSON 厳密解析、無ければ素朴抽出。
  cat > "$d/jq" <<'SHIM'
#!/usr/bin/env bash
# minimal jq shim: supports -r '<filter>' reading JSON from stdin. Limited to hook の 3 フィルタ。
raw=""; filter=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -r) shift ;;
    *) filter="$1"; shift ;;
  esac
done
raw="$(cat)"
key=""
case "$filter" in
  *'.tool_name'*) key="tool_name" ;;
  *'.tool_input.command'*) key="command" ;;
  *'.tool_input.file_path'*) key="file_path" ;;
  *'.agent_id'*) key="agent_id" ;;
  *) printf '\n'; exit 0 ;;
esac
if command -v python3 >/dev/null 2>&1; then
  JQSHIM_RAW="$raw" JQSHIM_KEY="$key" python3 -c '
import os, json, sys
raw = os.environ.get("JQSHIM_RAW", "")
k = os.environ.get("JQSHIM_KEY", "")
try:
    d = json.loads(raw)
except Exception:
    print(""); sys.exit(0)
if k == "tool_name":
    v = d.get("tool_name", "")
elif k == "agent_id":
    # agent_id はトップレベル（tool_input 配下ではない）。hook の .agent_id // empty と同一。
    v = d.get("agent_id", "")
else:
    v = (d.get("tool_input") or {}).get(k, "")
print(v if v is not None else "")
'
else
  printf '%s' "$raw" | grep -oE "\"$key\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" | head -n1 | sed -E "s/^\"$key\"[[:space:]]*:[[:space:]]*\"//" | sed -E 's/"$//'
fi
SHIM
  chmod +x "$d/jq"
  # コア coreutils も使えるよう既存 PATH を後段に連結。
  printf '%s' "$d:$PATH"
}
JQ_PATH="$(make_jq_path)"

# run_pre <PATHval> <role> <json> [extra env assignments...] -> sets RC and writes ERR file
ERR="$TMP/err.txt"
run_pre() {
  local pathval="$1" role="$2" json="$3"; shift 3
  : > "$ERR"
  echo "$json" | env PATH="$pathval" AGENT_ROLE="$role" "$@" bash "$HOOK" >/dev/null 2>"$ERR"
  RC=$?
}

# =====================================================================================
# UC1: stdin JSON からの入力取得（jq 経路）
# =====================================================================================
echo "== UC1: stdin JSON 入力取得（jq 経路） =="
uc1_orchestrator_write_blocked() {
  # シナリオ: orchestrator の Write が stdin 入力で exit 2 ブロックされる（01 SC-1 / UC1 シナリオ1-1）
  # Given: AGENT_ROLE=orchestrator、tool env は未供給、違反 Write の stdin JSON
  local json='{"tool_name":"Write","tool_input":{"file_path":"00_要求定義.md"}}'
  # When: 違反 JSON を stdin で hook に渡す（通常 PATH＝jq があれば jq 経路）
  run_pre "$PATH" orchestrator "$json"
  # Then: 終了コードは 2、stderr に orchestrator の編集禁止メッセージ
  assert_eq 2 "$RC" "UC1: orchestrator Write は exit 2"
  assert_grep "orchestrator must never modify files" "$ERR" "UC1: orchestrator 編集禁止メッセージ"
}
uc1_orchestrator_grep_allowed() {
  # シナリオ: orchestrator の Grep（allowlist 内）は exit 0 で許可される（01 UC5 シナリオ5-1 相当）
  # Given: AGENT_ROLE=orchestrator、許可ツール Grep の stdin JSON
  local json='{"tool_name":"Grep","tool_input":{"pattern":"foo"}}'
  # When: 正当 JSON を stdin で渡す
  run_pre "$PATH" orchestrator "$json"
  # Then: 終了コードは 0（allowlist 内）
  assert_eq 0 "$RC" "UC1: orchestrator Grep は exit 0"
}
uc1_orchestrator_agent_allowed() {
  # シナリオ: orchestrator の Agent（実機の委譲ツール・allowlist 内）は exit 0 で許可される（Agent 名のみの環境での自己ロックアウト再発防止）
  # Given: AGENT_ROLE=orchestrator、委譲ツール Agent の stdin JSON
  local json='{"tool_name":"Agent","tool_input":{"description":"delegate"}}'
  # When: 委譲 JSON を stdin で渡す
  run_pre "$PATH" orchestrator "$json"
  # Then: 終了コードは 0（allowlist 内）
  assert_eq 0 "$RC" "UC1: orchestrator Agent は exit 0"
}
uc1_orchestrator_task_allowed() {
  # シナリオ: orchestrator の Task（他ハーネス互換の委譲ツール）は引き続き exit 0 で許可される（互換維持）
  # Given: AGENT_ROLE=orchestrator、委譲ツール Task の stdin JSON
  local json='{"tool_name":"Task","tool_input":{"description":"delegate"}}'
  # When: 委譲 JSON を stdin で渡す
  run_pre "$PATH" orchestrator "$json"
  # Then: 終了コードは 0（allowlist 内・既存互換）
  assert_eq 0 "$RC" "UC1: orchestrator Task は exit 0"
}
uc1_orchestrator_askuserquestion_allowed() {
  # シナリオ: orchestrator の AskUserQuestion（読み取り専用・非破壊のユーザー対話ツール・allowlist 内）は exit 0 で許可される（FR-1・ADR-1）
  # Given: AGENT_ROLE=orchestrator、AskUserQuestion の stdin JSON
  local json='{"tool_name":"AskUserQuestion","tool_input":{"questions":[]}}'
  # When: AskUserQuestion JSON を stdin で渡す
  run_pre "$PATH" orchestrator "$json"
  # Then: 終了コードは 0（allowlist 内）
  assert_eq 0 "$RC" "UC1: orchestrator AskUserQuestion は exit 0"
}
uc1_orchestrator_write_blocked
uc1_orchestrator_grep_allowed
uc1_orchestrator_agent_allowed
uc1_orchestrator_task_allowed
uc1_orchestrator_askuserquestion_allowed

# =====================================================================================
# UC2: jq 非依存フォールバック（jq を PATH から外す）
# =====================================================================================
echo "== UC2: jq 非依存フォールバック =="
uc2_nojq_sqlite_blocked() {
  # シナリオ: jq 不在で sqlite3 直接実行が exit 2 ブロックされる（01 SC-4 / UC2 シナリオ2-1）
  # Given: jq を除いた PATH、AGENT_ROLE=scribe、sqlite3 直叩きコマンドの stdin JSON
  local json='{"tool_name":"Bash","tool_input":{"command":"sqlite3 .agent-skill-chain/runtime/workflow.db \"SELECT 1\""}}'
  # When: jq 不在の PATH で違反 JSON を stdin に渡す
  run_pre "$NOJQ_PATH" scribe "$json"
  # Then: 終了コードは 2 かつ sqlite3 禁止メッセージ
  assert_eq 2 "$RC" "UC2: jq 無し sqlite3 は exit 2"
  assert_grep "sqlite3 direct execution forbidden" "$ERR" "UC2: sqlite3 禁止メッセージ"
}
uc2_nojq_extracts_file_path() {
  # シナリオ: jq 不在でも file_path を抽出し orchestrator Write を reject する（jq 非依存の抽出確認）
  # Given: jq を除いた PATH、AGENT_ROLE=orchestrator、違反 Write JSON
  local json='{"tool_name":"Write","tool_input":{"file_path":"x.md"}}'
  # When: jq 不在の PATH で違反 JSON を stdin に渡す
  run_pre "$NOJQ_PATH" orchestrator "$json"
  # Then: 終了コードは 2（jq 非依存で tool_name 抽出が成立）
  assert_eq 2 "$RC" "UC2: jq 無し orchestrator Write は exit 2"
}
uc2_nojq_sqlite_blocked
uc2_nojq_extracts_file_path

# =====================================================================================
# UC3: exit 2 ブロック化（.workflow 直接編集）
# =====================================================================================
echo "== UC3: exit 2 ブロック化 =="
uc3_workflow_edit_exit2() {
  # シナリオ: .workflow 配下 Edit が exit 2（01 SC-1 / UC3 シナリオ3-1）
  # Given: AGENT_ROLE=worker、保護パスを対象とした Edit JSON
  local json='{"tool_name":"Edit","tool_input":{"file_path":".agent-skill-chain/runtime/x/00_要求定義.md"}}'
  # When: 違反 JSON を stdin で渡す
  run_pre "$PATH" worker "$json"
  # Then: 終了コードは 2（1 ではない）かつ理由が出る
  assert_eq 2 "$RC" "UC3: .workflow Edit は exit 2"
  assert_grep "direct edit of .agent-skill-chain/runtime/ is forbidden" "$ERR" "UC3: .workflow 直接編集禁止メッセージ"
}
uc3_worker_normal_write_allowed() {
  # シナリオ: worker の通常 Write（保護外）は exit 0（worker は実作業者）
  # Given: AGENT_ROLE=worker、保護外パスの Write JSON
  local json='{"tool_name":"Write","tool_input":{"file_path":"src/foo.txt"}}'
  # When: 正当 JSON を stdin で渡す
  run_pre "$PATH" worker "$json"
  # Then: 終了コードは 0（許可）
  assert_eq 0 "$RC" "UC3: worker 通常 Write は exit 0"
}
uc3_workflow_edit_exit2
uc3_worker_normal_write_allowed

# =====================================================================================
# UC4: env 後方互換フォールバック（stdin 空 + env）
# =====================================================================================
echo "== UC4: env 後方互換フォールバック =="
uc4_env_backcompat_blocked() {
  # シナリオ: stdin 無し + env 違反で reject（01 SC-3 / UC4 シナリオ4-1）
  # Given: AGENT_ROLE=orchestrator、CLAUDE_TOOL_NAME=Write、stdin は空
  : > "$ERR"
  # When: 空 stdin で hook を実行（env 後方互換）
  echo -n "" | env PATH="$PATH" AGENT_ROLE=orchestrator CLAUDE_TOOL_NAME=Write bash "$HOOK" >/dev/null 2>"$ERR"
  RC=$?
  # Then: 終了コードは 2（env 後方互換が効く）
  assert_eq 2 "$RC" "UC4: stdin 空 + env Write は exit 2"
}
uc4_empty_stdin_no_env_allowed() {
  # シナリオ: stdin も env も無いとき安全側（過剰ブロックしない）
  # Given: AGENT_ROLE 未供給に近い unknown、stdin 空、tool env 無し
  : > "$ERR"
  # When: 空 stdin・tool 情報なしで hook を実行
  echo -n "" | env PATH="$PATH" AGENT_ROLE=unknown bash "$HOOK" >/dev/null 2>"$ERR"
  RC=$?
  # Then: 終了コードは 0（保守的に allow・過剰ブロックしない）
  assert_eq 0 "$RC" "UC4: 入力なしは exit 0（保守的）"
}
uc4_non_json_stdin_allowed() {
  # シナリオ: 非 JSON stdin は env フォールバックに倒れ誤抽出しない
  # Given: AGENT_ROLE=orchestrator、非 JSON な stdin、tool env 無し
  : > "$ERR"
  # When: 非 JSON 文字列を stdin で渡す
  echo "not json at all" | env PATH="$PATH" AGENT_ROLE=orchestrator bash "$HOOK" >/dev/null 2>"$ERR"
  RC=$?
  # Then: 終了コードは 0（誤検知せず allow）
  assert_eq 0 "$RC" "UC4: 非 JSON stdin は exit 0（誤検知なし）"
}
uc4_env_backcompat_blocked
uc4_empty_stdin_no_env_allowed
uc4_non_json_stdin_allowed

# =====================================================================================
# UC5: AGENT_ROLE 別分岐（R2/R3/R4/R5/R6）
# =====================================================================================
echo "== UC5: AGENT_ROLE 別分岐 =="
uc5_orchestrator_bash_blocked() {
  # シナリオ: orchestrator の Bash は専用メッセージで exit 2（R2/R3）
  # Given: AGENT_ROLE=orchestrator、Bash JSON
  local json='{"tool_name":"Bash","tool_input":{"command":"ls"}}'
  # When: Bash JSON を stdin で渡す
  run_pre "$PATH" orchestrator "$json"
  # Then: 終了コードは 2 かつ orchestrator は Bash 不可メッセージ
  assert_eq 2 "$RC" "UC5: orchestrator Bash は exit 2"
  assert_grep "orchestrator cannot run Bash" "$ERR" "UC5: orchestrator Bash 禁止メッセージ"
}
uc5_worker_bash_blocked() {
  # シナリオ: 非 scribe（worker）の Bash は exit 2（01 SC-5 / UC5 シナリオ5-2）
  # Given: AGENT_ROLE=worker、任意の ls コマンド
  local json='{"tool_name":"Bash","tool_input":{"command":"ls"}}'
  # When: Bash JSON を stdin で渡す
  run_pre "$PATH" worker "$json"
  # Then: 終了コードは 2 かつ scribe のみ Bash 可のメッセージ
  assert_eq 2 "$RC" "UC5: worker Bash は exit 2"
  assert_grep "only scribe may run Bash" "$ERR" "UC5: scribe のみ Bash 可メッセージ"
}
uc5_scribe_writelog_allowed() {
  # シナリオ: scribe の write-workflow-log.sh 単独実行は許可（01 SC-5 / UC5 シナリオ5-3）
  # Given: AGENT_ROLE=scribe、write-workflow-log.sh の単独実行コマンド
  local json='{"tool_name":"Bash","tool_input":{"command":".agent-skill-chain/source/scripts/write-workflow-log.sh requirement-discovery x"}}'
  # When: 正当 JSON を stdin で渡す（cwd を隔離環境に置き相対パスを解決可能にする）
  : > "$ERR"
  ( cd "$TMP" && echo "$json" | env PATH="$PATH" AGENT_ROLE=scribe bash "$HOOK" >/dev/null 2>"$ERR" )
  RC=$?
  # Then: 終了コードは 0（許可）
  assert_eq 0 "$RC" "UC5: scribe write-workflow-log.sh 単独は exit 0"
}
uc5_scribe_sqlite_blocked() {
  # シナリオ: scribe の sqlite3 直接実行は exit 2（R6・全 ROLE 適用）
  # Given: AGENT_ROLE=scribe、sqlite3 直叩きコマンド
  local json='{"tool_name":"Bash","tool_input":{"command":"sqlite3 db.sqlite \"SELECT 1\""}}'
  # When: 違反 JSON を stdin で渡す
  run_pre "$PATH" scribe "$json"
  # Then: 終了コードは 2 かつ sqlite3 禁止メッセージ
  assert_eq 2 "$RC" "UC5: scribe sqlite3 は exit 2"
  assert_grep "sqlite3 direct execution forbidden" "$ERR" "UC5: sqlite3 禁止メッセージ"
}
uc5_scribe_compound_blocked() {
  # シナリオ: scribe の複合シェル（&&）は exit 2（R4）
  # Given: AGENT_ROLE=scribe、複合シェルコマンド（write-workflow-log.sh && rm）
  local json='{"tool_name":"Bash","tool_input":{"command":".agent-skill-chain/source/scripts/write-workflow-log.sh x && rm -rf /"}}'
  # When: 違反 JSON を stdin で渡す
  run_pre "$PATH" scribe "$json"
  # Then: 終了コードは 2 かつ複合シェル禁止メッセージ
  assert_eq 2 "$RC" "UC5: scribe 複合シェルは exit 2"
  assert_grep "compound shell command forbidden" "$ERR" "UC5: 複合シェル禁止メッセージ"
}
uc5_unknown_role_workflow_blocked() {
  # シナリオ: ROLE=unknown でも R1（.workflow 編集）は発火する（role 非依存）
  # Given: AGENT_ROLE=unknown、.workflow 配下 Write JSON
  local json='{"tool_name":"Write","tool_input":{"file_path":".agent-skill-chain/runtime/x/note.md"}}'
  # When: 違反 JSON を stdin で渡す
  run_pre "$PATH" unknown "$json"
  # Then: 終了コードは 2（R1 は全 ROLE 適用）
  assert_eq 2 "$RC" "UC5: unknown でも .workflow 編集は exit 2"
}
uc5_orchestrator_bash_blocked
uc5_worker_bash_blocked
uc5_scribe_writelog_allowed
uc5_scribe_sqlite_blocked
uc5_scribe_compound_blocked
uc5_unknown_role_workflow_blocked

# =====================================================================================
# UC6: 両経路発火（setup / plugin）
# =====================================================================================
echo "== UC6: 両経路発火（setup / plugin） =="
uc6_setup_path_blocks() {
  # シナリオ: setup 経路（settings.enforce.json 由来の .claude/hooks 配置相当）で違反 JSON が exit 2（01 SC-6 / UC6 シナリオ6-1）
  # Given: setup が配備する .claude/hooks/PreToolUse.sh は正本のコピー。隔離環境にコピーして配備を再現
  mkdir -p "$TMP/.claude/hooks"
  cp "$HOOK" "$TMP/.claude/hooks/PreToolUse.sh"
  local json='{"tool_name":"Write","tool_input":{"file_path":"00_要求定義.md"}}'
  : > "$ERR"
  # When: 違反 JSON を setup 経路の hook に stdin で渡す
  echo "$json" | env PATH="$PATH" AGENTS_ROOT="$TMP/.agent-skill-chain/source" AGENT_ROLE=orchestrator bash "$TMP/.claude/hooks/PreToolUse.sh" >/dev/null 2>"$ERR"
  RC=$?
  # Then: 終了コードは 2
  assert_eq 2 "$RC" "UC6: setup 経路で違反 JSON は exit 2"
}
uc6_plugin_path_blocks() {
  # シナリオ: plugin 経路（hooks.json → ${CLAUDE_PLUGIN_ROOT}/.agent-skill-chain/source/enforcement/claude/PreToolUse.sh）で違反 JSON が exit 2（01 SC-6 / UC6 シナリオ6-2）
  # Given: plugin 結線先は同梱 .agents 配下の正本 hook（隔離環境の HOOK そのもの）
  local json='{"tool_name":"Bash","tool_input":{"command":"sqlite3 a.db x"}}'
  : > "$ERR"
  # When: 違反 JSON を plugin 結線先 hook に stdin で渡す
  echo "$json" | env PATH="$PATH" AGENTS_ROOT="$TMP/.agent-skill-chain/source" AGENT_ROLE=orchestrator bash "$HOOK" >/dev/null 2>"$ERR"
  RC=$?
  # Then: 終了コードは 2（plugin 経路でも同一 hook が発火）
  assert_eq 2 "$RC" "UC6: plugin 経路で違反 JSON は exit 2"
}
uc6_setup_path_blocks
uc6_plugin_path_blocks

# =====================================================================================
# UC7: PostToolUse 整合（stdin を受けても案内のみ exit 0）
# =====================================================================================
echo "== UC7: PostToolUse 整合 =="
uc7_posttooluse_exit0() {
  # シナリオ: PostToolUse は stdin JSON を受けて案内し exit 0（01 SC- / UC7 シナリオ7-1）
  # Given: 任意の実行後 JSON
  local json='{"tool_name":"Write","tool_input":{"file_path":"x"}}'
  : > "$ERR"
  # When: PostToolUse に stdin で渡す
  echo "$json" | env PATH="$PATH" AGENTS_ROOT="$TMP/.agent-skill-chain/source" bash "$POST_HOOK" >/dev/null 2>"$ERR"
  RC=$?
  # Then: 終了コードは 0 かつ証跡規約案内
  assert_eq 0 "$RC" "UC7: PostToolUse は stdin JSON で exit 0"
  assert_grep "workflow.db is canonical" "$ERR" "UC7: 証跡規約案内が出る"
}
uc7_posttooluse_empty_exit0() {
  # シナリオ: 空 stdin でも exit 0（set -e 由来の非 0 終了がない）
  : > "$ERR"
  # Given: 空 stdin
  # When: PostToolUse に空 stdin を渡す
  echo -n "" | env PATH="$PATH" AGENTS_ROOT="$TMP/.agent-skill-chain/source" bash "$POST_HOOK" >/dev/null 2>"$ERR"
  RC=$?
  # Then: 終了コードは 0
  assert_eq 0 "$RC" "UC7: PostToolUse は空 stdin でも exit 0"
}
uc7_posttooluse_exit0
uc7_posttooluse_empty_exit0

# =====================================================================================
# UC8: subagent worker（agent_id）昇格 — jq 経路・非 jq 経路の両系統で同一合否
#   委譲先サブエージェント（stdin JSON に agent_id あり）は継承 orchestrator を上書きして
#   実作業（Bash/Edit/Write）を許可される。main（agent_id なし）の直接実作業 block は非劣化で維持。
#   R1（.workflow 直接編集）/R6（sqlite3）は subagent でも不変。scribe（nonce 検証済み）は agent_id を
#   伴っても最優先で判定され R5 を維持し worker allow へ落ちない（§8.1・03 §2.2.2）。
# =====================================================================================
echo "== UC8: subagent worker（agent_id）昇格 =="
run_uc8() {
  local label="$1" pathval="$2"
  # シナリオ（ケース1）: 継承 orchestrator の subagent が Write を許可される（核心是正・01 ストーリー1）
  # Given: AGENT_ROLE=orchestrator を継承した subagent（stdin JSON に agent_id あり）、保護外パスの Write
  local json1='{"tool_name":"Write","tool_input":{"file_path":"src/x"},"agent_id":"abc-123","agent_type":"worker"}'
  # When: 違反にならない Write を stdin で hook に渡す
  run_pre "$pathval" orchestrator "$json1"
  # Then: subagent 判定で exit 0（allow）
  assert_eq 0 "$RC" "UC8[$label]: subagent worker Write(src/x) は exit 0"
  # ケース1補: agent_id あり × Edit(src/x) → exit 0（worker は実作業許可・03 §2.1.3）
  # Given: agent_id 付きの保護外 Edit
  local json1b='{"tool_name":"Edit","tool_input":{"file_path":"src/x"},"agent_id":"abc-123"}'
  # When: hook を実行
  run_pre "$pathval" orchestrator "$json1b"
  # Then: exit 0（worker allow）
  assert_eq 0 "$RC" "UC8[$label]: subagent worker Edit(src/x) は exit 0"

  # シナリオ（ケース2）: agent_id 付き Bash(ls) が許可される
  # Given: agent_id 付き Bash(ls) の JSON（継承 orchestrator）
  local json2='{"tool_name":"Bash","tool_input":{"command":"ls"},"agent_id":"abc-123"}'
  # When: hook を実行
  run_pre "$pathval" orchestrator "$json2"
  # Then: subagent worker として exit 0（jq 経路と同一合否）
  assert_eq 0 "$RC" "UC8[$label]: subagent worker Bash(ls) は exit 0"

  # シナリオ（ケース3）: agent_id 付きでも .workflow 直接編集は R1 で block（不変）
  # Given: agent_id 付きだが保護パス .agent-skill-chain/runtime/ への Edit
  local json3='{"tool_name":"Edit","tool_input":{"file_path":".agent-skill-chain/runtime/x/00_要求定義.md"},"agent_id":"abc-123"}'
  # When: hook を実行
  run_pre "$pathval" orchestrator "$json3"
  # Then: R1 は全ロール（subagent 含む）で block（exit 2）
  assert_eq 2 "$RC" "UC8[$label]: subagent worker の .workflow Edit は exit 2（R1 不変）"

  # シナリオ（ケース4）: agent_id 付きでも sqlite3 直接実行は R6 で block（不変）
  # Given: agent_id 付きだが sqlite3 直叩き
  local json4='{"tool_name":"Bash","tool_input":{"command":"sqlite3 db.sqlite \"SELECT 1\""},"agent_id":"abc-123"}'
  # When: hook を実行
  run_pre "$pathval" orchestrator "$json4"
  # Then: R6 は全ロール（subagent 含む）で block（exit 2）
  assert_eq 2 "$RC" "UC8[$label]: subagent worker の sqlite3 は exit 2（R6 不変）"

  # シナリオ（ケース5）: agent_id なしの orchestrator（＝main 相当）直接 Write は block（story2 非劣化）
  # Given: 同じ orchestrator だが agent_id 無し（＝main 相当）、保護外パスの Write
  local json5='{"tool_name":"Write","tool_input":{"file_path":"src/x"}}'
  # When: main が直接 Write を試みる
  run_pre "$pathval" orchestrator "$json5"
  # Then: main は従来どおり exit 2（block・story2 非劣化）
  assert_eq 2 "$RC" "UC8[$label]: main（agent_id なし）Write は exit 2"

  # シナリオ（ケース6）: scribe（nonce 検証済み）＋ agent_id の非 wwl Bash は R5 維持で block（§8.1）
  # Given: nonce 検証環境（AGENTS_EXPECTED_SCRIBE_NONCE と AGENTS_SCRIBE_NONCE が一致）＋ agent_id あり
  local json6='{"tool_name":"Bash","tool_input":{"command":"ls"},"agent_id":"abc-123"}'
  # When: write-workflow-log 以外の Bash(ls) を stdin で渡す
  run_pre "$pathval" scribe "$json6" AGENTS_EXPECTED_SCRIBE_NONCE=nonce-uc8 AGENTS_SCRIBE_NONCE=nonce-uc8
  # Then: scribe が最優先で判定され R5 維持で exit 2（worker allow へ落ちない）
  assert_eq 2 "$RC" "UC8[$label]: scribe+agent_id の Bash(ls) は exit 2（scribe 最優先・R5 維持）"
  # ケース6補: 同 scribe+agent_id で write-workflow-log.sh 単独 → exit 0（scribe 経路 R5 許可・03 §2.1.3）
  # Given: nonce 検証済み scribe＋agent_id、cwd を隔離環境に置き相対パスを解決可能にする
  local json6b='{"tool_name":"Bash","tool_input":{"command":".agent-skill-chain/source/scripts/write-workflow-log.sh requirement-discovery x"},"agent_id":"abc-123"}'
  : > "$ERR"
  # When: write-workflow-log.sh の単独実行を stdin で渡す
  ( cd "$TMP" && echo "$json6b" | env PATH="$pathval" AGENT_ROLE=scribe AGENTS_EXPECTED_SCRIBE_NONCE=nonce-uc8 AGENTS_SCRIBE_NONCE=nonce-uc8 bash "$HOOK" >/dev/null 2>"$ERR" )
  RC=$?
  # Then: scribe 経路の R5 で単独実行は許可され exit 0
  assert_eq 0 "$RC" "UC8[$label]: scribe+agent_id の write-workflow-log.sh 単独は exit 0"
}
run_uc8 "jq" "$JQ_PATH"
run_uc8 "nojq" "$NOJQ_PATH"

# =====================================================================================
# UC9: runtime/.gitignore の厳密パス一致例外（ADR-3・01_要件定義.md UC2 シナリオ1〜3）
#   配布漏れの自己修復用の正規手段。厳密一致のみ allow し、他の runtime/ 配下ファイルへの
#   禁止・過剰マッチ防止（サブディレクトリ/紛らわしいファイル名）は維持されることを検証する。
#   jq 有/無の両系統で同一合否になることを確認する。
# =====================================================================================
echo "== UC9: runtime/.gitignore 厳密パス一致例外 =="
run_uc9() {
  local label="$1" pathval="$2"

  # シナリオ1: runtime/.gitignore への直接 Edit は厳密パス一致で allow される（01 UC2 シナリオ1）
  # Given: AGENT_ROLE=worker、file_path が厳密に .agent-skill-chain/runtime/.gitignore
  local json1='{"tool_name":"Edit","tool_input":{"file_path":".agent-skill-chain/runtime/.gitignore"}}'
  # When: 正当 JSON を stdin で渡す
  run_pre "$pathval" worker "$json1"
  # Then: 終了コードは 0（allow）
  assert_eq 0 "$RC" "UC9[$label]: runtime/.gitignore の厳密一致 Edit は exit 0"

  # シナリオ2: 他の runtime/ 配下ファイルへの Write は引き続き block される（01 UC2 シナリオ2）
  # Given: AGENT_ROLE=worker、file_path が .agent-skill-chain/runtime/workflow.db
  local json2='{"tool_name":"Write","tool_input":{"file_path":".agent-skill-chain/runtime/workflow.db"}}'
  # When: 違反 JSON を stdin で渡す
  run_pre "$pathval" worker "$json2"
  # Then: 終了コードは 2（block・現状維持）
  assert_eq 2 "$RC" "UC9[$label]: runtime/workflow.db の Write は exit 2（現状維持）"
  assert_grep "direct edit of .agent-skill-chain/runtime/ is forbidden" "$ERR" "UC9[$label]: 従来どおりの禁止メッセージ"

  # シナリオ3: サブディレクトリの .gitignore は厳密一致でないため例外対象外（01 UC2 シナリオ3・過剰マッチ防止）
  # Given: AGENT_ROLE=worker、file_path が .agent-skill-chain/runtime/<issue>/.gitignore（厳密パスと不一致）
  local json3='{"tool_name":"Write","tool_input":{"file_path":".agent-skill-chain/runtime/x/.gitignore"}}'
  # When: 違反 JSON を stdin で渡す
  run_pre "$pathval" worker "$json3"
  # Then: 終了コードは 2（block・例外は完全一致のみ）
  assert_eq 2 "$RC" "UC9[$label]: サブディレクトリの .gitignore は exit 2（過剰マッチ防止）"

  # シナリオ4（境界値）: 紛らわしいファイル名（.gitignore.bak）は厳密一致でないため block される
  # Given: AGENT_ROLE=worker、file_path が .agent-skill-chain/runtime/.gitignore.bak
  local json4='{"tool_name":"Write","tool_input":{"file_path":".agent-skill-chain/runtime/.gitignore.bak"}}'
  # When: 違反 JSON を stdin で渡す
  run_pre "$pathval" worker "$json4"
  # Then: 終了コードは 2（前方一致で誤許可しないことの確認）
  assert_eq 2 "$RC" "UC9[$label]: .gitignore.bak は exit 2（前方一致で誤許可しない）"

  # シナリオ5（境界値）: 絶対パス表記の runtime/.gitignore も厳密一致として allow される（既存 R1 の絶対パス regex 分岐との整合）
  # Given: AGENT_ROLE=worker、file_path が絶対パス /repo/.agent-skill-chain/runtime/.gitignore
  local json5='{"tool_name":"Edit","tool_input":{"file_path":"/repo/.agent-skill-chain/runtime/.gitignore"}}'
  # When: 正当 JSON を stdin で渡す
  run_pre "$pathval" worker "$json5"
  # Then: 終了コードは 0（絶対パスでも末尾セグメントが厳密一致すれば allow）
  assert_eq 0 "$RC" "UC9[$label]: 絶対パス表記の runtime/.gitignore も exit 0"
}
run_uc9 "jq" "$JQ_PATH"
run_uc9 "nojq" "$NOJQ_PATH"

# =====================================================================================
# UC10: project 固有 allowlist 拡張（FR-4・ADR-3/ADR-4）— jq 有/無の両系統で同一合否
#   .agent-skill-chain/project/orchestrator-allowlist.txt に厳密一致で列挙された未知ツールのみ opt-in 許可。
#   ファイル不在・空・注入行・内部空白難読化は fail-closed（default block）。明示拒否名（Bash/Edit）は
#   case のより手前で block され拡張では覆せない。能力ベース残余（mcp__* 書込ツール）も証跡化する。
#   本リポの .agent-skill-chain/project/ は触らず、隔離環境 $TMP 配下のみに例ファイルを書く（破壊禁止方針）。
# =====================================================================================
echo "== UC10: project 固有 allowlist 拡張 =="
run_uc10() {
  local label="$1" pathval="$2"
  local proj_dir="$TMP/.agent-skill-chain/project"
  local proj_file="$proj_dir/orchestrator-allowlist.txt"
  mkdir -p "$proj_dir"

  # シナリオ(a): 未設定（ファイル不在）は fail-closed
  # Given: 拡張ファイルが存在しない
  rm -f "$proj_file"
  # When: orchestrator が未知ツール Foo を呼ぶ
  run_pre "$pathval" orchestrator '{"tool_name":"Foo","tool_input":{}}'
  # Then: exit 2（default 拒否）
  assert_eq 2 "$RC" "UC10[$label]: 拡張未設定の未知ツール Foo は exit 2（fail-closed）"

  # シナリオ(b): opt-in 追加したツールが許可される
  # Given: 拡張ファイルに Foo を 1 行で列挙
  printf 'Foo\n' > "$proj_file"
  # When: orchestrator が Foo を呼ぶ
  run_pre "$pathval" orchestrator '{"tool_name":"Foo","tool_input":{}}'
  # Then: exit 0（project opt-in 許可）
  assert_eq 0 "$RC" "UC10[$label]: 拡張に列挙した Foo は exit 0"

  # シナリオ(c): 拡張は明示拒否名（変更系）を覆せない
  # Given: 拡張ファイルに Bash を列挙
  printf 'Bash\n' > "$proj_file"
  # When: orchestrator が Bash を呼ぶ
  run_pre "$pathval" orchestrator '{"tool_name":"Bash","tool_input":{"command":"ls"}}'
  # Then: exit 2（case のより手前で block・拡張で覆せない）
  assert_eq 2 "$RC" "UC10[$label]: 拡張に Bash があっても exit 2（case 手前で block）"
  # Edit も同様に覆せない
  printf 'Edit\n' > "$proj_file"
  run_pre "$pathval" orchestrator '{"tool_name":"Edit","tool_input":{"file_path":"src/x"}}'
  assert_eq 2 "$RC" "UC10[$label]: 拡張に Edit があっても exit 2（明示拒否名は覆せない）"

  # シナリオ(d): 注入行は厳密文字種不一致で無視（read-as-data のため副作用も無い）
  # Given: 拡張ファイルに 'Foo; rm -rf /' を書く
  printf 'Foo; rm -rf /\n' > "$proj_file"
  # When: orchestrator が Foo を呼ぶ
  run_pre "$pathval" orchestrator '{"tool_name":"Foo","tool_input":{}}'
  # Then: 当該行は無視され Foo は許可されない（exit 2）。'; rm -rf /' も実行されない
  assert_eq 2 "$RC" "UC10[$label]: 注入行 'Foo; rm -rf /' は無視され Foo は exit 2"

  # シナリオ(e): # コメント・空行の無視
  # Given: コメント行と空行のみ（Foo はコメント内）
  printf '# Foo\n\n' > "$proj_file"
  # When: orchestrator が Foo を呼ぶ
  run_pre "$pathval" orchestrator '{"tool_name":"Foo","tool_input":{}}'
  # Then: exit 2（コメント内の Foo は許可されない）
  assert_eq 2 "$RC" "UC10[$label]: コメント/空行のみは exit 2（Foo は許可されない）"

  # シナリオ(f): 内部空白の難読化無効化（trim のみ・collapse しない）
  # Given: 拡張ファイルに 'Foo bar'（内部空白）
  printf 'Foo bar\n' > "$proj_file"
  # When: orchestrator が Foo を呼ぶ
  run_pre "$pathval" orchestrator '{"tool_name":"Foo","tool_input":{}}'
  # Then: exit 2（'Foobar' に化けず Foo も bar も許可しない）
  assert_eq 2 "$RC" "UC10[$label]: 内部空白 'Foo bar' は無視され exit 2（化けない）"

  # シナリオ(g): CRLF 耐性
  # Given: 拡張ファイルに 'Foo\r\n'（CRLF）
  printf 'Foo\r\n' > "$proj_file"
  # When: orchestrator が Foo を呼ぶ
  run_pre "$pathval" orchestrator '{"tool_name":"Foo","tool_input":{}}'
  # Then: 末尾 trim で \r が除去され Foo として exit 0
  assert_eq 0 "$RC" "UC10[$label]: CRLF 'Foo\\r' は末尾 trim で exit 0"

  # シナリオ(h): 能力ベース残余リスクの証跡（ADR-3/ADR-4 残余2）
  #   mcp__foo__write（*) に落ちる MCP 書込ツール名）を opt-in すると exit 0 になり得る。
  #   機構は「名前一致」のみ保証し「能力（非破壊性）」は保証しない。未知＝安全ではない・人間レビュー前提。
  # Given: 拡張ファイルに mcp__foo__write を列挙
  printf 'mcp__foo__write\n' > "$proj_file"
  # When: orchestrator が mcp__foo__write を呼ぶ
  run_pre "$pathval" orchestrator '{"tool_name":"mcp__foo__write","tool_input":{}}'
  # Then: exit 0（opt-in で許可・能力ベース残余の可視化）
  assert_eq 0 "$RC" "UC10[$label]: mcp__foo__write の opt-in は exit 0（能力は機構で保証されない）"

  # シナリオ(h2): ハイフン付き MCP 名の opt-in（`^[A-Za-z][A-Za-z0-9_-]*$` 許可集合）
  #   MCP サーバ名は `brave-search` 等ハイフンを含むのが正式。厳密文字種にハイフンを含めないと
  #   正式名を allowlist できない。末尾 literal `-` を許可集合に含め、厳密一致ゲートは不変。
  # Given: 拡張ファイルに mcp__brave-search__search を列挙
  printf 'mcp__brave-search__search\n' > "$proj_file"
  # When: orchestrator が mcp__brave-search__search を呼ぶ
  run_pre "$pathval" orchestrator '{"tool_name":"mcp__brave-search__search","tool_input":{}}'
  # Then: exit 0（ハイフン付き正式 MCP 名が衛生フィルタを通過し opt-in で許可）
  assert_eq 0 "$RC" "UC10[$label]: ハイフン付き mcp__brave-search__search の opt-in は exit 0"

  # シナリオ(i): サブエージェント（agent_id あり）は R2 対象外で拡張判定に入らない（UC8 と整合）
  # Given: 拡張ファイルは Foo のみ、agent_id 付きの未知ツール Bar
  printf 'Foo\n' > "$proj_file"
  # When: agent_id ありの worker が Bar を呼ぶ（R2 は IS_SUBAGENT!=1 のみ対象）
  run_pre "$pathval" orchestrator '{"tool_name":"Bar","tool_input":{},"agent_id":"abc-123"}'
  # Then: R2 の allowlist 判定自体に入らず、他の R に該当しないため exit 0（worker 非対象・不変）
  assert_eq 0 "$RC" "UC10[$label]: agent_id ありは R2 対象外（拡張判定に入らない）exit 0"

  rm -f "$proj_file"
}
run_uc10 "jq" "$JQ_PATH"
run_uc10 "nojq" "$NOJQ_PATH"

# =====================================================================================
# UC11: FR-6/FR-7 常時バナーとブロック理由の出力分離・日英併記（ADR-7・ADR-8）
#   許可時は [PreToolUse:info] バナーのみで違反 prefix は出ない。違反時は [enforcement:block] で区別でき、
#   理由は日英併記（英語部分文字列は保持）。挙動（exit code）は不変。
# =====================================================================================
echo "== UC11: 出力分離・日英併記（FR-6/FR-7） =="
uc11_info_banner_on_allow() {
  # シナリオ: 許可時は info バナーのみ・違反 prefix は出ない
  # Given: orchestrator × 許可ツール Read
  local json='{"tool_name":"Read","tool_input":{"file_path":"x"}}'
  # When: hook を実行
  run_pre "$PATH" orchestrator "$json"
  # Then: exit 0、info バナーが出て、違反 prefix は出ない
  assert_eq 0 "$RC" "UC11: orchestrator Read は exit 0"
  assert_grep "\[PreToolUse:info\]" "$ERR" "UC11: 許可時に [PreToolUse:info] バナーが出る"
  if grep -q "\[enforcement:block\]" "$ERR"; then ng "UC11: 許可時に違反 prefix が出ない"; else ok "UC11: 許可時に違反 prefix が出ない"; fi
}
uc11_block_prefix_and_bilingual() {
  # シナリオ: 違反時は [enforcement:block] prefix で区別でき日英併記になる
  # Given: orchestrator × Edit（変更系・明示拒否）
  local json='{"tool_name":"Edit","tool_input":{"file_path":"src/x"}}'
  # When: hook を実行
  run_pre "$PATH" orchestrator "$json"
  # Then: exit 2、block prefix・英語部分文字列・日本語併記が揃う
  assert_eq 2 "$RC" "UC11: orchestrator Edit は exit 2"
  assert_grep "\[enforcement:block\]" "$ERR" "UC11: 違反時に [enforcement:block] が出る"
  assert_grep "orchestrator must never modify files" "$ERR" "UC11: 英語部分文字列が保持される"
  assert_grep "サブへ委譲" "$ERR" "UC11: 日本語が併記される"
}
uc11_bash_bilingual() {
  # シナリオ: orchestrator Bash の block 理由が日英併記
  # Given: orchestrator × Bash
  local json='{"tool_name":"Bash","tool_input":{"command":"ls"}}'
  # When: hook を実行
  run_pre "$PATH" orchestrator "$json"
  # Then: exit 2、英語保持＋日本語併記
  assert_eq 2 "$RC" "UC11: orchestrator Bash は exit 2"
  assert_grep "orchestrator cannot run Bash" "$ERR" "UC11: 英語 'orchestrator cannot run Bash' 保持"
  assert_grep "orchestrator は Bash を実行できません" "$ERR" "UC11: 日本語併記"
}
uc11_posttooluse_bilingual() {
  # シナリオ: PostToolUse バナーが日英併記（英語部分文字列保持）
  # Given: 任意の実行後 JSON
  local json='{"tool_name":"Write","tool_input":{"file_path":"x"}}'
  : > "$ERR"
  # When: PostToolUse に stdin で渡す
  echo "$json" | env PATH="$PATH" AGENTS_ROOT="$TMP/.agent-skill-chain/source" bash "$POST_HOOK" >/dev/null 2>"$ERR"
  RC=$?
  # Then: exit 0、英語 'workflow.db is canonical' 保持＋日本語併記
  assert_eq 0 "$RC" "UC11: PostToolUse は exit 0"
  assert_grep "workflow.db is canonical" "$ERR" "UC11: 英語 'workflow.db is canonical' 保持"
  assert_grep "workflow ログを省略しないこと" "$ERR" "UC11: 日本語併記"
}
uc11_info_banner_on_allow
uc11_block_prefix_and_bilingual
uc11_bash_bilingual
uc11_posttooluse_bilingual

# =====================================================================================
# UC1/UC2 系: jq 経路（jq シムまたは本物 jq を PATH 前段に）— jq 有/無の両系統で同一合否
# =====================================================================================
echo "== jq 経路（jq present 系統）: 違反→2 / 正当→0 が jq 無し系統と一致 =="
jq_orchestrator_write_blocked() {
  # シナリオ: jq 経路でも orchestrator Write が exit 2（jq 有/無で同一合否・01 UC1）
  # Given: jq を PATH 前段に置く、AGENT_ROLE=orchestrator、違反 Write JSON
  local json='{"tool_name":"Write","tool_input":{"file_path":"00_要求定義.md"}}'
  # When: jq 経路で違反 JSON を stdin に渡す
  run_pre "$JQ_PATH" orchestrator "$json"
  # Then: 終了コードは 2（jq 経路で tool_name/file_path 抽出が成立）
  assert_eq 2 "$RC" "jq: orchestrator Write は exit 2"
}
jq_scribe_sqlite_blocked() {
  # シナリオ: jq 経路で sqlite3 直接実行が exit 2（jq 有/無で同一・01 UC2/UC5）
  # Given: jq を PATH 前段に置く、AGENT_ROLE=scribe、sqlite3 直叩き JSON
  local json='{"tool_name":"Bash","tool_input":{"command":"sqlite3 db.sqlite \"SELECT 1\""}}'
  # When: jq 経路で違反 JSON を stdin に渡す
  run_pre "$JQ_PATH" scribe "$json"
  # Then: 終了コードは 2 かつ sqlite3 禁止メッセージ
  assert_eq 2 "$RC" "jq: scribe sqlite3 は exit 2"
  assert_grep "sqlite3 direct execution forbidden" "$ERR" "jq: sqlite3 禁止メッセージ"
}
jq_orchestrator_grep_allowed() {
  # シナリオ: jq 経路で orchestrator Grep は exit 0（正当・jq 有/無で同一）
  # Given: jq を PATH 前段に置く、AGENT_ROLE=orchestrator、許可ツール Grep JSON
  local json='{"tool_name":"Grep","tool_input":{"pattern":"foo"}}'
  # When: jq 経路で正当 JSON を stdin に渡す
  run_pre "$JQ_PATH" orchestrator "$json"
  # Then: 終了コードは 0（allowlist 内）
  assert_eq 0 "$RC" "jq: orchestrator Grep は exit 0"
}
jq_orchestrator_write_blocked
jq_scribe_sqlite_blocked
jq_orchestrator_grep_allowed

# ---- 本番 DB / 本リポ非破壊の確認（隔離環境のみを触ったこと） ----
echo "== 非破壊確認 =="
# Given/When: 上記テストは全て $TMP 配下で実行している。Then: 本リポ .agents の hook が未変更（mtime 比較は省略、git status は呼び出し側で確認）。
ok "全テストを tmp 隔離（$TMP 配下）で実行した"

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
