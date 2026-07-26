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
  local probe="${CODEX_AUTH_PROBE_CMD:-}"
  if [[ -z "$probe" ]]; then
    if command -v codex >/dev/null 2>&1; then
      probe='codex login status'
    else
      return 1
    fi
  fi
  local timeout_sec="${CODEX_AUTH_PROBE_TIMEOUT_SEC:-20}"
  _run_provider_probe_sanitized "$probe" "$timeout_sec"
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
# env: CODEX_REVIEWER_CMD（通常レビュー用のテスト完全上書き）、GATE_REVIEWER_CMD（通常レビューの後方互換上書き）、
#      CODEX_EXECUTABLE（既定 codex。実行バイナリの明示指定）、
#      CODEX_REVIEWER_MODEL（通常既定 gpt-5.6）、CODEX_REVIEWER_REASONING_EFFORT（通常既定 high）。
# core reviewでは任意command文字列を検証不能なため、両完全上書きを無条件拒否する。
launch_gate_reviewer() {
  local report_path="${4:-}"
  local core_codex_review="${ASC_CORE_REVIEW_REQUIRED:-false}"
  local model="${CODEX_REVIEWER_MODEL:-gpt-5.6}"
  local effort="${CODEX_REVIEWER_REASONING_EFFORT:-high}"

  _codex_fail_safe() {
    echo "launch_gate_reviewer: $1（フェイルセーフで human_required へ倒します）" >&2
    [[ -n "$report_path" ]] && _asc_cli gate mark-human-required "$report_path" >/dev/null || true
    return 2
  }

  if [[ "$core_codex_review" == "true" ]]; then
    if [[ -n "${CODEX_REVIEWER_CMD:-}" || -n "${GATE_REVIEWER_CMD:-}" ]]; then
      _codex_fail_safe "Codex core reviewer では検証不能な完全command上書きを許可しません"
      return
    fi
    model="${CODEX_REVIEWER_MODEL:-${ASC_CODEX_REQUIRED_MODEL:-}}"
    effort="${CODEX_REVIEWER_REASONING_EFFORT:-${ASC_CODEX_REQUIRED_REASONING_EFFORT:-}}"
    if [[ -z "${ASC_CODEX_REQUIRED_MODEL:-}" || "$model" != "$ASC_CODEX_REQUIRED_MODEL" ]]; then
      _codex_fail_safe "Codex core reviewer のmodelが project policy と一致しません"
      return
    fi
    if [[ -z "${ASC_CODEX_REQUIRED_REASONING_EFFORT:-}" || "$effort" != "$ASC_CODEX_REQUIRED_REASONING_EFFORT" ]]; then
      _codex_fail_safe "Codex core reviewer のreasoning effortが project policy と一致しません"
      return
    fi
  fi
  ASC_REVIEW_MODEL="$model"
  ASC_REVIEW_REASONING="$effort"
  export ASC_REVIEW_MODEL ASC_REVIEW_REASONING

  local original_home="${HOME:-}"
  ASC_REVIEWER_ORIGINAL_HOME="$original_home"
  export ASC_REVIEWER_ORIGINAL_HOME

  if [[ -z "${CODEX_REVIEWER_CMD:-}" && -z "${GATE_REVIEWER_CMD:-}" ]]; then
    local codex_executable="${CODEX_EXECUTABLE:-codex}"
    if ! command -v "$codex_executable" >/dev/null 2>&1; then
      _codex_fail_safe "Codex CLI が見つかりません"
      return
    fi
    local quoted_executable
    local denied_home
    printf -v quoted_executable '%q' "$codex_executable"
    denied_home="${original_home//\\/\\\\}"
    denied_home="${denied_home//\"/\\\"}"
    GATE_REVIEWER_CMD="$quoted_executable exec --sandbox read-only --ask-for-approval never --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check -C \"\$ASC_REVIEWER_SANITIZED_ROOT/workspace\" --color never -m \"$model\" -c \"model_reasoning_effort=\\\"$effort\\\"\" -c 'shell_environment_policy.inherit=\"none\"' -c 'shell_environment_policy.include_only=[\"PATH\"]' -c 'default_permissions=\"review\"' -c 'permissions.review.filesystem={\":workspace_roots\"={\".\"=\"read\"},\"$denied_home\"=\"deny\"}' -"
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
