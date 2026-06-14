#!/usr/bin/env bash
# PreToolUse.sh — ツール実行前に契約違反を reject するフック（絶対強制）
# 配置: .claude/hooks/（setup が enforcement/claude/ からコピー）／plugin 経由は .agents/enforcement/claude/ を直接呼ぶ。
#
# 責務:
#   - 実機 Claude Code の hooks 契約（stdin JSON 入力・ブロック exit 2）に整合させる。
#   - stdin の JSON から tool_name / tool_input.command / tool_input.file_path を限定抽出し、該当違反で exit 2（block）する（runtime enforcement・Layer 2）。
#   - **絶対強制**: orchestrator（ROLE=orchestrator）の Write/Edit/StrReplace/Shell/Delete/Bash 等は例外なく必ず exit 2 で拒否する。
#   - 入力が取れない（stdin 空・非 JSON・env 未設定）場合は案内のみ exit 0（CI で事後検知）。保守的に倒す（過剰ブロックしない）。
#
# 入力（2 経路・優先順位は parse_input）:
#   (a) stdin の JSON（実機が渡す tool_name / tool_input.{command,file_path}）【優先】
#   (b) env 後方互換（CLAUDE_TOOL_NAME / TOOL_NAME、CLAUDE_FILE_PATH / FILE_PATH、CLAUDE_COMMAND / COMMAND）。stdin 空/非 JSON 時のみ。
#   ROLE: AGENT_ROLE / CLAUDE_AGENT_ROLE（未設定時 unknown）。
#
# 終了コード規約: 違反=2（block）/ 許可・案内のみ=0（allow）。
# Fail-safe: set +e でフック自体の失敗が全ツール停止にならないようにする。内部エラーは allow（exit 0）に倒す。

set +e

# ---------------------------------------------------------------------------
# 終了コード規約（block / allow）— exit 2 / exit 0 を 1 か所に集約する薄関数。
# ---------------------------------------------------------------------------
block() {
  # 違反確証時: 理由を stderr に出し exit 2（fail-closed）。
  echo "[enforcement] ERROR: $1" >&2
  exit 2
}
allow() {
  # 許可・案内のみ: exit 0（fail-safe 側）。
  exit 0
}

# ---------------------------------------------------------------------------
# json_get <key> — RAW（stdin 全量）から限定キーを 1 つ抽出する低レベル関数。
#   対象キー: tool_name / command（= tool_input.command）/ file_path（= tool_input.file_path）。
#   jq があれば jq、無ければ sed/grep の保守的 fallback。抽出失敗は空文字（誤検知抑制）。
# ---------------------------------------------------------------------------
json_get() {
  local key="$1"
  [[ -z "$RAW" ]] && return 0
  if command -v jq >/dev/null 2>&1; then
    case "$key" in
      tool_name) printf '%s' "$RAW" | jq -r '.tool_name // empty' 2>/dev/null ;;
      command)   printf '%s' "$RAW" | jq -r '.tool_input.command // empty' 2>/dev/null ;;
      file_path) printf '%s' "$RAW" | jq -r '.tool_input.file_path // empty' 2>/dev/null ;;
    esac
    return 0
  fi
  # jq 非依存フォールバック（最小・限定キーのみ）。"key" : "値" を 1 件抽出する。
  # 値中の \" エスケープを許容し、最初の非エスケープ " で閉じる。
  local pat val
  case "$key" in
    tool_name) pat='"tool_name"' ;;
    command)   pat='"command"' ;;
    file_path) pat='"file_path"' ;;
    *) return 0 ;;
  esac
  # grep -o で `"key"\s*:\s*"...(エスケープ許容)..."` を抜き、sed で値部分だけ取り出す。
  val="$(printf '%s' "$RAW" \
    | grep -oE "$pat[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" \
    | head -n1 \
    | sed -E "s/^$pat[[:space:]]*:[[:space:]]*\"//" \
    | sed -E 's/"$//')"
  # JSON エスケープを最小限デコード（\" \\ \/ のみ。誤検知抑制のため過剰デコードしない）。
  val="${val//\\\"/\"}"
  val="${val//\\\//\/}"
  val="${val//\\\\/\\}"
  printf '%s' "$val"
}

# ---------------------------------------------------------------------------
# parse_input — 唯一 stdin/env を読む入力層。TOOL / PATH_TARGET / CMD / ROLE を確定する。
#   stdin が JSON 様なら json_get で抽出、そうでなければ env を後方互換で読む。
# ---------------------------------------------------------------------------
parse_input() {
  # stdin を全量読込（配線が stdin を継承する前提。空なら即 env フォールバックへ）。
  RAW=""
  if [[ ! -t 0 ]]; then
    RAW="$(cat 2>/dev/null)"
  fi

  ROLE="${AGENT_ROLE:-${CLAUDE_AGENT_ROLE:-unknown}}"

  # JSON 様判定: 先頭が { で tool_name を含む（軽量判定）。
  if [[ -n "$RAW" && "$RAW" == \{* && "$RAW" == *tool_name* ]]; then
    TOOL="$(json_get tool_name)"
    CMD="$(json_get command)"
    PATH_TARGET="$(json_get file_path)"
  else
    # stdin 空/非 JSON → env 後方互換フォールバック。
    TOOL="${CLAUDE_TOOL_NAME:-${TOOL_NAME:-}}"
    PATH_TARGET="${CLAUDE_FILE_PATH:-${FILE_PATH:-}}"
    CMD="${CLAUDE_COMMAND:-${COMMAND:-}}"
  fi
}

parse_input

AGENTS_ROOT="${AGENTS_ROOT:-.agents}"
if [[ ! -d "$AGENTS_ROOT" ]]; then
  echo "[PreToolUse] .agents not found; skip contract check." >&2
  allow
fi

# 案内（常に表示・exit には影響しない）
if [[ -f "$AGENTS_ROOT/boot/CORE.md" ]]; then
  echo "[PreToolUse] Ensure you have read: $AGENTS_ROOT/boot/CORE.md, $AGENTS_ROOT/boot/LOAD_POLICY.md, $AGENTS_ROOT/workflow/PHASES.md before starting workflow or running a command." >&2
  echo "[PreToolUse] Main (orchestrator) must NOT do real work (absolute): do not directly edit 00/01/02/03/04 or code. Always delegate via Task/Constraints/OutputSpec to sub. No exceptions." >&2
  echo "[PreToolUse] Evidence: workflow.db via write-workflow-log.sh only. Do NOT run sqlite3 directly. 書記は write-workflow-log.sh のみ実行可。sqlite3 直接は全ロールで reject。Memo timestamps must come from system clock (new-workflow-memo.sh or write-workflow-log)." >&2
fi

# ---------------------------------------------------------------------------
# Runtime enforcement（reject 判定群）: 確定変数 TOOL/PATH_TARGET/CMD/ROLE のみ参照する。
# 入力が取れない（TOOL も CMD も空）場合は保守的に倒す（BR-4: 違反確証なしは reject しない）。
# ---------------------------------------------------------------------------
if [[ -n "$TOOL" ]]; then
  # R1. .workflow 配下への直接 Write/Edit 禁止（全 ROLE）
  if [[ "$TOOL" == "Edit" || "$TOOL" == "Write" ]]; then
    if [[ "$PATH_TARGET" =~ \.workflow/ ]] || [[ "$PATH_TARGET" =~ /\.workflow/ ]]; then
      block "direct edit of .workflow/ is forbidden"
    fi
  fi

  # R2 / R2'. orchestrator: 許可ツールのみ（allowlist）。それ以外は拒否。
  #    許可: Read, Grep, Glob, LS, list_dir, Task, mcp_task 等「読む・検索・委譲」のみ。
  if [[ "$ROLE" == "orchestrator" ]]; then
    case "$TOOL" in
      Read|Grep|Glob|LS|list_dir|Task|mcp_task|ReadLints|fetch_mcp_resource|list_mcp_resources)
        : # allowed（R2'）
        ;;
      Bash)
        block "orchestrator cannot run Bash"
        ;;
      Edit|Write|Delete|StrReplace|Shell|TodoWrite|EditNotebook|call_mcp_tool|GenerateImage)
        block "orchestrator must never modify files or run write/edit/shell (absolute). Delegate to sub only. No exceptions."
        ;;
      *)
        # 未知のツールは orchestrator には許可しない（許可リスト方式）
        block "orchestrator may only use allowed tools (Read, Grep, Glob, LS, Task, etc.): $TOOL"
        ;;
    esac
  fi
fi

# R3 / R4 / R5. Bash 実行: scribe のみ write-workflow-log.sh の単独実行を許可
if [[ "$TOOL" == "Bash" ]]; then
  if [[ "$ROLE" == "orchestrator" ]]; then
    block "orchestrator cannot run Bash"
  fi
  if [[ "$ROLE" != "scribe" ]]; then
    block "only scribe may run Bash for workflow logging"
  fi
  # CMD が取れていない場合のみ保守的に通す（複合シェル/単独実行の確証なし）。
  if [[ -n "$CMD" ]]; then
    # R6（先行）. sqlite3 直接実行禁止（全 ROLE）。role 共通の明確な理由を優先表示するため
    #            scribe の write-workflow-log.sh 単独実行制約（R5）より前に判定する。
    if [[ "$CMD" =~ sqlite3 ]]; then
      block "sqlite3 direct execution forbidden (use write-workflow-log.sh)"
    fi
    # R4. 複合シェル禁止（改行・;・&&・||・|）
    case "$CMD" in
      *$'\n'*|*';'*|*'&&'*|*'||'*|*'|'* )
        block "compound shell command forbidden"
        ;;
    esac
    # R5. write-workflow-log.sh は単独実行のみ: 第1トークンを絶対パスに解決し basename が write-workflow-log.sh であることを確認
    first_token="$(echo "$CMD" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]].*//')"
    resolved=""
    if [[ -n "$first_token" ]] && [[ -e "$first_token" ]]; then
      if command -v realpath &>/dev/null; then
        resolved="$(realpath "$first_token" 2>/dev/null)"
      elif command -v readlink &>/dev/null && readlink -f -- "." &>/dev/null; then
        resolved="$(readlink -f "$first_token" 2>/dev/null)"
      else
        resolved="$(cd "$(dirname "$first_token")" && pwd)/$(basename "$first_token")"
      fi
    fi
    base_name="$(basename "$first_token")"
    if [[ "$base_name" != "write-workflow-log.sh" ]]; then
      if [[ -z "$resolved" ]] || [[ "$(basename "$resolved")" != "write-workflow-log.sh" ]]; then
        block "only direct write-workflow-log.sh execution is allowed"
      fi
    fi
  fi
fi

# R6. sqlite3 直接実行禁止（全 ROLE・wrapper のみ許可）
if [[ -n "$CMD" ]]; then
  if [[ "$CMD" =~ sqlite3 ]]; then
    block "sqlite3 direct execution forbidden (use write-workflow-log.sh)"
  fi
fi

allow
