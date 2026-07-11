#!/usr/bin/env bash
# PreToolUse.sh — ツール実行前に契約違反を reject するフック（絶対強制）
# 配置: .claude/hooks/（setup が enforcement/claude/ からコピー）／plugin 経由は .agent-skill-chain/source/enforcement/claude/ を直接呼ぶ。
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

  # ROLE 確定（C-4b: AGENT_ROLE の出所制御）。
  #   scribe を主張する呼び出しは、env 配線された実 nonce（AGENTS_SCRIBE_NONCE）が、
  #   **期待 nonce** と一致する場合のみ scribe として扱う。手動 export した AGENT_ROLE=scribe は
  #   実 nonce を知らないため不一致となり unknown へ降格する（= write-workflow-log.sh 実行を block）。
  #
  #   出所分離（HIGH 是正の核心）: 期待 nonce の出所を **実 nonce（env）と別経路**にする。
  #     優先順: ① ${AGENTS_ROOT}/.scribe-nonce ファイル（setup/enforce が 0600 で生成）を最優先で読む。
  #             ② ファイルが無い環境のみ AGENTS_EXPECTED_SCRIBE_NONCE（env・後方互換）を期待値に用いる。
  #     ファイルが存在する場合、env だけを掌握した相手は AGENTS_SCRIBE_NONCE と
  #     AGENTS_EXPECTED_SCRIBE_NONCE を同値に揃えても、期待値は **ファイル**から読むため一致できない
  #     （ファイルは 0600 で書けない）。これにより素朴な手動 export 偽装を遮断する。
  #   限界（正直化）: env 空間全体＋ファイル読取まで掌握された相手に対する完全防御ではない。
  #     最終保証は CI audit ＋ 外部証跡（NDJSON export / 署名 / append-only）が担う。
  #   nonce 配線が無い環境（消費者が未配線・後方互換）では、従来どおり AGENT_ROLE をそのまま採用する
  #   （主防御の nonce は opt-in。配線時のみ scribe 偽装を遮断する）。
  ROLE="${AGENT_ROLE:-${CLAUDE_AGENT_ROLE:-unknown}}"
  if [[ "$ROLE" == "scribe" ]]; then
    # 期待 nonce を **実 nonce と別出所**から確定する。
    #   ① ファイル出所（最優先・env と独立）: ${AGENTS_ROOT}/.scribe-nonce を読む。
    #   ② フォールバック（後方互換）: ファイルが無い場合のみ env の期待 nonce を用いる。
    expected_nonce=""
    nonce_file="${AGENTS_ROOT:-.agent-skill-chain/source}/.scribe-nonce"
    if [[ -f "$nonce_file" ]]; then
      # ファイル先頭行のみ採用（改行・余白を除去）。読めなければ空のまま（検証スキップ＝後方互換）。
      expected_nonce="$(head -n1 "$nonce_file" 2>/dev/null | tr -d '[:space:]')"
    else
      expected_nonce="${AGENTS_EXPECTED_SCRIBE_NONCE:-}"
    fi
    if [[ -n "$expected_nonce" ]]; then
      if [[ "${AGENTS_SCRIBE_NONCE:-}" != "$expected_nonce" ]]; then
        # nonce 不一致の scribe 主張は出所不明として降格（手動 export 偽装の遮断）。
        ROLE="unknown"
      fi
    fi
  fi

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

AGENTS_ROOT="${AGENTS_ROOT:-.agent-skill-chain/source}"
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
    if [[ "$PATH_TARGET" =~ \.agent-skill-chain/runtime/ ]] || [[ "$PATH_TARGET" =~ /\.agent-skill-chain/runtime/ ]]; then
      block "direct edit of .agent-skill-chain/runtime/ is forbidden"
    fi
  fi

  # R2 / R2'. orchestrator: 許可ツールのみ（allowlist）。それ以外は拒否。
  #    許可: Read, Grep, Glob, LS, list_dir, Task, Agent, mcp_task 等「読む・検索・委譲」のみ。
  #    委譲ツールの実名はハーネスで異なる（Agent SDK 系は Task、Claude Code CLI / FleetView 系は Agent）。
  #    両名を許可に残さないと、実機側の委譲ツールが下の *) に落ちて拒否され、orchestrator が委譲手段ごと
  #    自己ロックアウトする（Agent 名のみの環境で実際に発生済み）。互換のため Task と Agent の両方を許可する。
  if [[ "$ROLE" == "orchestrator" ]]; then
    case "$TOOL" in
      Read|Grep|Glob|LS|list_dir|Task|Agent|mcp_task|ReadLints|fetch_mcp_resource|list_mcp_resources)
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
    # R5. write-workflow-log.sh は単独実行のみ（C-4a: 正規化済み絶対パス比較で回避ベクタを塞ぐ）。
    #   ①第 1 トークンを取り出し、②realpath（無ければ readlink -f、無ければ cd+pwd）で正規化済み絶対パスへ解決、
    #   ③その実体パスが「許可正本パス＝実行 cwd 起点の配備先 .agent-skill-chain/source/scripts/write-workflow-log.sh を
    #     realpath 解決した値」と一致することを要求する。固定文字列はハードコードしない（消費者配備先で誤 block
    #     しないため・N-E）。相対パス（./...）は realpath 正規化で同一判定へ収れんし、symlink で別実体を
    #     指す同名スクリプトは実体 realpath 不一致で block、bash -c "..." は第 1 トークンが bash になり不一致で block。
    norm_path() {
      local p="$1"
      [[ -z "$p" ]] && return 0
      if command -v realpath &>/dev/null; then
        realpath "$p" 2>/dev/null
      elif command -v readlink &>/dev/null && readlink -f -- "." &>/dev/null; then
        readlink -f "$p" 2>/dev/null
      elif [[ -e "$p" ]]; then
        ( cd "$(dirname "$p")" 2>/dev/null && printf '%s/%s' "$(pwd)" "$(basename "$p")" )
      fi
    }
    first_token="$(echo "$CMD" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]].*//')"
    resolved="$(norm_path "$first_token")"
    # 許可正本パス: 実行 cwd 起点の配備先を realpath 解決（実行時算出・固定文字列禁止）。
    canonical_wwl="$(norm_path "${AGENTS_ROOT}/scripts/write-workflow-log.sh")"
    if [[ -z "$resolved" ]] || [[ -z "$canonical_wwl" ]] || [[ "$resolved" != "$canonical_wwl" ]]; then
      block "only the canonical write-workflow-log.sh (realpath of \$AGENTS_ROOT/scripts/write-workflow-log.sh) may be run directly"
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
