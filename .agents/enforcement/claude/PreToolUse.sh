#!/usr/bin/env bash
# PreToolUse.sh — ツール実行前に契約違反を reject するフック（絶対強制）
# 配置: .claude/hooks/（setup が enforcement/claude/ からコピー）
#
# 責務:
#   - プラットフォームがツール名・対象パス・コマンド・ロールを渡す場合、該当違反で exit 1 する（runtime enforcement）。
#   - **絶対強制**: orchestrator（ROLE=orchestrator）の Write/Edit/StrReplace/Shell/Delete 等は例外なく必ず exit 1 で拒否する。
#   - 渡されない場合は案内のみ exit 0（CI で事後検知）。絶対強制のため、プラットフォームはメインセッションに AGENT_ROLE=orchestrator を渡すことを推奨。
# 環境変数（プラットフォーム依存）: CLAUDE_TOOL_NAME / CLAUDE_FILE_PATH / CLAUDE_COMMAND / AGENT_ROLE
#   または TOOL_NAME / FILE_PATH / COMMAND / AGENT_ROLE。未設定時は reject せず案内のみ。
# Fail-safe: set +e でフック自体の失敗が全ツール停止にならないようにする。

set +e
TOOL="${CLAUDE_TOOL_NAME:-${TOOL_NAME:-}}"
PATH_TARGET="${CLAUDE_FILE_PATH:-${FILE_PATH:-}}"
CMD="${CLAUDE_COMMAND:-${COMMAND:-}}"
ROLE="${AGENT_ROLE:-${CLAUDE_AGENT_ROLE:-unknown}}"

AGENTS_ROOT="${AGENTS_ROOT:-.agents}"
if [[ ! -d "$AGENTS_ROOT" ]]; then
  echo "[PreToolUse] .agents not found; skip contract check." >&2
  exit 0
fi

# 案内（常に表示）
if [[ -f "$AGENTS_ROOT/boot/CORE.md" ]]; then
  echo "[PreToolUse] Ensure you have read: $AGENTS_ROOT/boot/CORE.md, $AGENTS_ROOT/boot/LOAD_POLICY.md, $AGENTS_ROOT/workflow/PHASES.md before starting workflow or running a command." >&2
  echo "[PreToolUse] Main (orchestrator) must NOT do real work (absolute): do not directly edit 00/01/02/03/04 or code. Always delegate via Task/Constraints/OutputSpec to sub. No exceptions." >&2
  echo "[PreToolUse] Evidence: workflow.db via write-workflow-log.sh only. Do NOT run sqlite3 directly. 書記は write-workflow-log.sh のみ実行可。sqlite3 直接は全ロールで reject。Memo timestamps must come from system clock (new-workflow-memo.sh or write-workflow-log)." >&2
fi

# Runtime enforcement: プラットフォームがツール名等を渡している場合のみ reject（Layer 2）
if [[ -n "$TOOL" ]]; then
  # 1. .workflow 配下への直接 Write/Edit 禁止
  if [[ "$TOOL" == "Edit" || "$TOOL" == "Write" ]]; then
    if [[ "$PATH_TARGET" =~ \.workflow/ ]] || [[ "$PATH_TARGET" =~ /\.workflow/ ]]; then
      echo "[enforcement] ERROR: direct edit of .workflow/ is forbidden" >&2
      exit 1
    fi
  fi

  # 2. orchestrator: 許可ツールのみ（allowlist）。それ以外は拒否。
  #    許可: Read, Grep, Glob, LS, list_dir, Task, mcp_task 等「読む・検索・委譲」のみ。
  if [[ "$ROLE" == "orchestrator" ]]; then
    case "$TOOL" in
      Read|Grep|Glob|LS|list_dir|Task|mcp_task|ReadLints|fetch_mcp_resource|list_mcp_resources)
        : # allowed
        ;;
      Bash)
        echo "[enforcement] ERROR: orchestrator cannot run Bash" >&2
        exit 1
        ;;
      Edit|Write|Delete|StrReplace|Shell|TodoWrite|EditNotebook|call_mcp_tool|GenerateImage)
        echo "[enforcement] ERROR: orchestrator must never modify files or run write/edit/shell (absolute). Delegate to sub only. No exceptions." >&2
        exit 1
        ;;
      *)
        # 未知のツールは orchestrator には許可しない（許可リスト方式）
        echo "[enforcement] ERROR: orchestrator may only use allowed tools (Read, Grep, Glob, LS, Task, etc.): $TOOL" >&2
        exit 1
        ;;
    esac
  fi
fi

# 3. Bash 実行: scribe のみ write-workflow-log.sh の単独実行を許可
if [[ -n "$CMD" && "$TOOL" == "Bash" ]]; then
  if [[ "$ROLE" == "orchestrator" ]]; then
    echo "[enforcement] ERROR: orchestrator cannot run Bash" >&2
    exit 1
  fi
  if [[ "$ROLE" != "scribe" ]]; then
    echo "[enforcement] ERROR: only scribe may run Bash for workflow logging" >&2
    exit 1
  fi
  # 複合シェル禁止（改行・;・&&・||・|）
  case "$CMD" in
    *$'\n'*|*';'*|*'&&'*|*'||'*|*'|'* )
      echo "[enforcement] ERROR: compound shell command forbidden" >&2
      exit 1
      ;;
  esac
  # write-workflow-log.sh は単独実行のみ: 先頭空白のあと (./)? 任意パス write-workflow-log.sh とその引数のみ
  # 現状はコマンド文字列に write-workflow-log.sh が含まれるかで許可。堅牢化する場合は絶対パス・正規化パスのみ許可する実装を検討する。
  if [[ ! "$CMD" =~ ^[[:space:]]*(\./)?[^[:space:]]*write-workflow-log\.sh([[:space:]].*)?$ ]]; then
    echo "[enforcement] ERROR: only direct write-workflow-log.sh execution is allowed" >&2
    exit 1
  fi
fi

if [[ -n "$CMD" ]]; then
  # 4. sqlite3 直接実行禁止（wrapper のみ許可）
  if [[ "$CMD" =~ sqlite3 ]]; then
    echo "[enforcement] ERROR: sqlite3 direct execution forbidden (use write-workflow-log.sh)" >&2
    exit 1
  fi
fi

exit 0
