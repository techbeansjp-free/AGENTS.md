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
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_sec" bash -c "$probe" >/dev/null 2>&1
  else
    bash -c "$probe" >/dev/null 2>&1
  fi
}

# 取り込んだ lifecycle が呼ぶ認証フックを Codex 用に差し替える。トークン値・probe の出力は
# 一切ログに流さない。
_claude_auth_ok() { _codex_auth_ok; }

# モデル決定順序（ISSUE-307 / ADR-0015、テスト用完全上書き CODEX_WORKER_CMD・WORKER_CMD は
# launch_worker 側で最優先判定済み）:
#   (1) アダプタ固有の個別上書き環境変数（CODEX_IMPLEMENTATION_MODEL / CODEX_HIGH_CAPABILITY_MODEL）
#   (2) 設定由来の解決済み値（ASC_WORKER_MODEL。worker.model_tiers からの解決は worker context
#       （CLI）側で完結しており、本アダプタはティア名から具体名を導く処理を持たない）
#   (3) 従来のフォールバック（implementation: gpt-5.6-terra、それ以外: gpt-5.6）
# 各層を明示的に評価する（個別上書きの既定値展開と設定由来の値を同一式に混在させない）。
_codex_worker_model() {
  local segment="$1" override_var fallback
  if [[ "$segment" == "implementation" ]]; then
    override_var="${CODEX_IMPLEMENTATION_MODEL:-}"
    fallback='gpt-5.6-terra'
  else
    override_var="${CODEX_HIGH_CAPABILITY_MODEL:-}"
    fallback='gpt-5.6'
  fi
  if [[ -n "$override_var" ]]; then
    printf '%s\n' "$override_var"
  elif [[ -n "${ASC_WORKER_MODEL:-}" ]]; then
    printf '%s\n' "$ASC_WORKER_MODEL"
  else
    printf '%s\n' "$fallback"
  fi
}

# reasoning effort 決定順序は model と同一の3層（個別上書き→設定由来→従来フォールバック）。
_codex_worker_effort() {
  local segment="$1" override_var fallback
  if [[ "$segment" == "implementation" ]]; then
    override_var="${CODEX_IMPLEMENTATION_REASONING_EFFORT:-}"
    fallback='medium'
  else
    override_var="${CODEX_HIGH_CAPABILITY_REASONING_EFFORT:-}"
    fallback='high'
  fi
  if [[ -n "$override_var" ]]; then
    printf '%s\n' "$override_var"
  elif [[ -n "${ASC_WORKER_REASONING_EFFORT:-}" ]]; then
    printf '%s\n' "$ASC_WORKER_REASONING_EFFORT"
  else
    printf '%s\n' "$fallback"
  fi
}

# 引数: <issue_id> <gate_id> <profile> <gate_report_path> <target_sha>
# env: CODEX_REVIEWER_CMD（テスト用完全上書き）、GATE_REVIEWER_CMD（後方互換上書き）、
#      CODEX_EXECUTABLE（既定 codex。実行バイナリの明示指定）、
#      CODEX_REVIEWER_MODEL（通常既定 gpt-5.6）、CODEX_REVIEWER_REASONING_EFFORT（通常既定 high）、
#      CODEX_CORE_REVIEWER_ATTESTED（コア時の完全command上書きがmodel/effort/read-onlyを満たす証明）。
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
    if [[ -n "${CODEX_REVIEWER_CMD:-}" || -n "${GATE_REVIEWER_CMD:-}" ]]; then
      if [[ "${CODEX_CORE_REVIEWER_ATTESTED:-}" != "true" ]]; then
        _codex_fail_safe "Codex core reviewer の完全command上書きに必要なmodel/effort/read-only証明がありません"
        return
      fi
    fi
  fi
  ASC_REVIEW_MODEL="$model"
  ASC_REVIEW_REASONING="$effort"
  export ASC_REVIEW_MODEL ASC_REVIEW_REASONING

  local original_home="${HOME:-}"
  local isolated_root
  isolated_root="$(mktemp -d "${TMPDIR:-/tmp}/agent-skill-chain-reviewer.XXXXXX")"
  ASC_REVIEWER_ORIGINAL_HOME="$original_home"
  ASC_REVIEWER_SANITIZED_ROOT="$isolated_root"
  export ASC_REVIEWER_ORIGINAL_HOME ASC_REVIEWER_SANITIZED_ROOT

  if [[ -z "${CODEX_REVIEWER_CMD:-}" && -z "${GATE_REVIEWER_CMD:-}" ]]; then
    local codex_executable="${CODEX_EXECUTABLE:-codex}"
    if ! command -v "$codex_executable" >/dev/null 2>&1; then
      _codex_fail_safe "Codex CLI が見つかりません"
      local fail_safe_rc=$?
      rm -rf -- "$isolated_root"
      return "$fail_safe_rc"
    fi
    local quoted_executable
    local quoted_root
    local denied_home
    printf -v quoted_executable '%q' "$codex_executable"
    printf -v quoted_root '%q' "$isolated_root/workspace"
    denied_home="${original_home//\\/\\\\}"
    denied_home="${denied_home//\"/\\\"}"
    GATE_REVIEWER_CMD="$quoted_executable exec --sandbox read-only --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check -C $quoted_root --color never -m \"$model\" -c \"model_reasoning_effort=\\\"$effort\\\"\" -c 'approval_policy=\"never\"' -c 'shell_environment_policy.inherit=\"none\"' -c 'shell_environment_policy.include_only=[\"PATH\"]' -c 'default_permissions=\"review\"' -c 'permissions.review.filesystem={\":workspace_roots\"={\".\"=\"read\"},\"$denied_home\"=\"deny\"}' -"
  elif [[ -n "${CODEX_REVIEWER_CMD:-}" ]]; then
    GATE_REVIEWER_CMD="$CODEX_REVIEWER_CMD"
  fi
  # 認証不成立などの非0は lifecycle の正常な fail-safe 結果である。source 時の
  # `set -e` が呼出元を途中終了させず、launcher が終了コードを処理できるよう明示的に捕捉する。
  set +e
  _codex_gate_lifecycle "$@"
  local rc=$?
  rm -rf -- "$isolated_root"
  return "$rc"
}

# 引数: <issue_id> <segment>
# env: CODEX_WORKER_CMD（テスト用完全上書き、最優先）、WORKER_CMD（後方互換上書き）、
#      CODEX_IMPLEMENTATION_MODEL / CODEX_HIGH_CAPABILITY_MODEL（個別上書き）、
#      CODEX_IMPLEMENTATION_REASONING_EFFORT / CODEX_HIGH_CAPABILITY_REASONING_EFFORT（個別上書き）、
#      ASC_WORKER_MODEL / ASC_WORKER_REASONING_EFFORT（worker-launch.sh が worker.model_tiers から
#      解決済みの値として export する、ISSUE-307）、ASC_WORKER_MODEL_TIER（同、防御的検査専用）。
launch_worker() {
  local segment="${2:-}"
  if [[ -z "${CODEX_WORKER_CMD:-}" && -z "${WORKER_CMD:-}" ]]; then
    # 防御的検査（ADR-0015）: ティア名が指定されているのに解決済みモデルが届いていない場合、
    # 従来フォールバックへ黙って落ちず blocked へ倒す。正規経路（worker-launch.sh 経由）では
    # worker context がティア解決失敗を lease 取得前のエラーとして返すためこの状態に至らないが、
    # 本アダプタが単独で呼ばれた場合の「ティアを指定したのに別のモデルで走る」事故を防ぐ。
    if [[ -n "${ASC_WORKER_MODEL_TIER:-}" && -z "${ASC_WORKER_MODEL:-}" ]]; then
      echo "launch_worker: モデルティア（ASC_WORKER_MODEL_TIER=${ASC_WORKER_MODEL_TIER}）が指定されているのに解決済みモデル（ASC_WORKER_MODEL）が届いていません。推測せずblockedへ倒します" >&2
      WORKER_CMD='false'
    elif command -v codex >/dev/null 2>&1; then
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
