#!/usr/bin/env bash
# Codex adapter. 役割契約と lease/完了確認のライフサイクルは Claude adapter と同一であり、
# このファイルは Codex 固有の認証、sandbox、model、reasoning effort だけを差し替える。

set -euo pipefail

ADAPTER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

# I2/I8 の状態遷移は adapter 間で同一でなければならない。実装を複製せず、Claude adapter が
# 提供する lifecycle 関数を名前を変えて取り込む。下で定義する _claude_auth_ok は動的束縛され、
# 取り込んだ lifecycle からも Codex の認証検査として呼ばれる。
# shellcheck source=claude.sh
source "$ADAPTER_DIR/claude.sh"
eval "$(declare -f launch_gate_reviewer | sed '1s/^launch_gate_reviewer /_codex_gate_lifecycle /')"
eval "$(declare -f launch_worker | sed '1s/^launch_worker /_codex_worker_lifecycle /')"

_codex_auth_ok() {
  if [[ -n "${OPENAI_API_KEY:-}" || -n "${CODEX_API_KEY:-}" || -n "${CODEX_ACCESS_TOKEN:-}" ]]; then
    return 0
  fi
  local probe="${CODEX_AUTH_PROBE_CMD:-}"
  if [[ -z "$probe" ]]; then
    if command -v codex >/dev/null 2>&1; then
      probe='codex login status'
    else
      return 1
    fi
  fi
  local timeout_sec="${CODEX_AUTH_PROBE_TIMEOUT_SEC:-20}"
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_sec" bash -c "$probe" >/dev/null 2>&1
  else
    bash -c "$probe" >/dev/null 2>&1
  fi
}

# 取り込んだ lifecycle が呼ぶ認証フックを Codex 用に差し替える。トークン値・probe の出力は
# 一切ログに流さない。
_claude_auth_ok() { _codex_auth_ok; }

_codex_worker_model() {
  case "$1" in
    implementation) printf '%s\n' "${CODEX_IMPLEMENTATION_MODEL:-gpt-5.6-terra}" ;;
    *) printf '%s\n' "${CODEX_HIGH_CAPABILITY_MODEL:-gpt-5.6}" ;;
  esac
}

_codex_worker_effort() {
  case "$1" in
    implementation) printf '%s\n' "${CODEX_IMPLEMENTATION_REASONING_EFFORT:-medium}" ;;
    *) printf '%s\n' "${CODEX_HIGH_CAPABILITY_REASONING_EFFORT:-high}" ;;
  esac
}

# 引数: <issue_id> <gate_id> <profile> <gate_report_path> <target_sha>
# env: CODEX_REVIEWER_CMD（テスト用完全上書き）、GATE_REVIEWER_CMD（後方互換上書き）、
#      CODEX_REVIEWER_MODEL（既定 gpt-5.6）、CODEX_REVIEWER_REASONING_EFFORT（既定 high）。
launch_gate_reviewer() {
  local report_path="${4:-}"
  if [[ -z "${CODEX_REVIEWER_CMD:-}" && -z "${GATE_REVIEWER_CMD:-}" ]]; then
    if ! command -v codex >/dev/null 2>&1; then
      echo "launch_gate_reviewer: codex CLI が見つかりません。フェイルセーフで human_required へ倒します" >&2
      [[ -n "$report_path" ]] && _asc_cli gate mark-human-required "$report_path" >/dev/null || true
      return 2
    fi
    local model="${CODEX_REVIEWER_MODEL:-gpt-5.6}"
    local effort="${CODEX_REVIEWER_REASONING_EFFORT:-high}"
    GATE_REVIEWER_CMD="codex exec --sandbox read-only --color never -m \"$model\" -c \"model_reasoning_effort=\\\"$effort\\\"\" -"
  elif [[ -n "${CODEX_REVIEWER_CMD:-}" ]]; then
    GATE_REVIEWER_CMD="$CODEX_REVIEWER_CMD"
  fi
  # 認証不成立などの非0は lifecycle の正常な fail-safe 結果である。source 時の
  # `set -e` が呼出元を途中終了させず、launcher が終了コードを処理できるよう明示的に捕捉する。
  set +e
  _codex_gate_lifecycle "$@"
  local rc=$?
  return "$rc"
}

# 引数: <issue_id> <segment>
# env: CODEX_WORKER_CMD（テスト用完全上書き）、WORKER_CMD（後方互換上書き）、
#      CODEX_HIGH_CAPABILITY_MODEL / CODEX_HIGH_CAPABILITY_REASONING_EFFORT、
#      CODEX_IMPLEMENTATION_MODEL / CODEX_IMPLEMENTATION_REASONING_EFFORT。
launch_worker() {
  local segment="${2:-}"
  if [[ -z "${CODEX_WORKER_CMD:-}" && -z "${WORKER_CMD:-}" ]]; then
    if command -v codex >/dev/null 2>&1; then
      local model effort
      model="$(_codex_worker_model "$segment")"
      effort="$(_codex_worker_effort "$segment")"
      WORKER_CMD="codex exec --sandbox workspace-write --color never -m \"$model\" -c \"model_reasoning_effort=\\\"$effort\\\"\" -"
    else
      # lifecycle に lease の取得後で blocked/report/release を一元処理させる。
      WORKER_CMD='false'
    fi
  elif [[ -n "${CODEX_WORKER_CMD:-}" ]]; then
    WORKER_CMD="$CODEX_WORKER_CMD"
  fi
  set +e
  _codex_worker_lifecycle "$@"
  local rc=$?
  return "$rc"
}
