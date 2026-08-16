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

# git が返す管理ディレクトリを、symlink を含まない実在する絶対パスへ解決する。
# Issue #682: 解決できない値のまま Codex を起動すると commit 時まで失敗が遅延するため、
# 起動コマンドの組み立て段階で日本語エラーにする。
_codex_resolve_git_metadata_dir() {
  local selector="$1" label="$2" resolved=''
  resolved="$(git rev-parse --path-format=absolute "$selector" 2>/dev/null || true)"
  # --path-format を持たない Git との互換性を保ち、相対値は cwd を基準に絶対化する。
  if [[ -z "$resolved" ]]; then
    resolved="$(git rev-parse "$selector" 2>/dev/null || true)"
    if [[ -n "$resolved" && "$resolved" != /* ]]; then
      resolved="$PWD/$resolved"
    fi
  fi
  if [[ -z "$resolved" || ! -d "$resolved" ]]; then
    echo "_codex_worker_sandbox_opts: ${label}の絶対パスを解決できませんでした" >&2
    return 1
  fi
  if ! resolved="$(cd -- "$resolved" >/dev/null 2>&1 && pwd -P)" || [[ -z "$resolved" ]]; then
    echo "_codex_worker_sandbox_opts: ${label}の実体パスを解決できませんでした" >&2
    return 1
  fi
  printf '%s\n' "$resolved"
}

# linked worktree の `.git` は gitfile であり、index.lock は共有 git ディレクトリとは別の
# worktree 専用メタデータディレクトリへ作られる。Codex の writable_roots は親 root の指定だけで
# その子孫を同じ権限にはしないため、共有領域と worktree 専用領域をそれぞれ明示する。
# 通常の作業ツリーでは両者が同じ実体パスになるので重複させない。push のネットワーク通信は許可するが、
# HOME や一時ディレクトリ等を追加の書込み root にはしない。
_codex_worker_sandbox_opts() {
  local common_dir git_dir root toml quoted roots_toml=''
  if ! common_dir="$(_codex_resolve_git_metadata_dir --git-common-dir '共有 git メタデータディレクトリ')"; then
    return 1
  fi
  if ! git_dir="$(_codex_resolve_git_metadata_dir --git-dir '起動対象作業ツリーの git メタデータディレクトリ')"; then
    return 1
  fi

  local -a writable_roots=("$common_dir")
  if [[ "$git_dir" != "$common_dir" ]]; then
    writable_roots+=("$git_dir")
  fi
  for root in "${writable_roots[@]}"; do
    # TOML文字列リテラル層のescape（\ と "）と、bash -c で再解釈されるshell層のquote（%q）は
    # 別物なので順に適用する。どちらか一方だけでは空白・記号を含むパスで壊れる。
    toml="${root//\\/\\\\}"
    toml="${toml//\"/\\\"}"
    if [[ -n "$roots_toml" ]]; then
      roots_toml+=','
    fi
    roots_toml+="\"$toml\""
  done
  printf -v quoted '%q' "sandbox_workspace_write.writable_roots=[$roots_toml]"
  printf '%s -c sandbox_workspace_write.network_access=true' "-c $quoted"
}

# role_contract が Codex CLI の stdin UTF-8 境界破損に対する安全閾値を超える場合は、
# prompt を位置引数へ移し、外側の prompt_file redirect を /dev/null で明示的に上書きする。
# 引数: <segment> <contract>
_worker_default_cmd() {
  local segment="${1:-}" contract="${2:-}"
  local threshold="${CODEX_STDIN_SAFE_THRESHOLD_BYTES:-32768}"

  if [[ ! "$threshold" =~ ^[1-9][0-9]*$ ]]; then
    echo "_worker_default_cmd: CODEX_STDIN_SAFE_THRESHOLD_BYTES は正の整数である必要があります" >&2
    return 1
  fi
  if [[ -n "${ASC_WORKER_MODEL_TIER:-}" && -z "${ASC_WORKER_MODEL:-}" ]]; then
    echo "_worker_default_cmd: モデルティア（ASC_WORKER_MODEL_TIER=${ASC_WORKER_MODEL_TIER}）が指定されているのに解決済みモデル（ASC_WORKER_MODEL）が届いていません" >&2
    return 1
  fi
  # launch_gate_reviewer と同じ解決順序（Issue #550: ここだけ codex 固定参照だと
  # CODEX_EXECUTABLE のみでPATH上に codex が無い環境で worker だけ非対称に blocked へ倒れる）。
  local codex_executable="${CODEX_EXECUTABLE:-codex}"
  if ! command -v "$codex_executable" >/dev/null 2>&1; then
    return 1
  fi

  local model effort sandbox_opts base contract_bytes quoted_contract quoted_executable
  model="$(_codex_worker_model "$segment")"
  effort="$(_codex_worker_effort "$segment")"
  if ! sandbox_opts="$(_codex_worker_sandbox_opts)"; then
    return 1
  fi
  printf -v quoted_executable '%q' "$codex_executable"
  base="$quoted_executable exec --sandbox workspace-write $sandbox_opts --color never -m \"$model\" -c \"model_reasoning_effort=\\\"$effort\\\"\""
  contract_bytes="$(printf '%s' "$contract" | wc -c)"
  contract_bytes="${contract_bytes//[[:space:]]/}"

  if ((contract_bytes > threshold)); then
    printf -v quoted_contract '%q' "$contract"
    printf '%s -- %s </dev/null\n' "$base" "$quoted_contract"
  else
    printf '%s -\n' "$base"
  fi
}

# 引数: <issue_id> <segment>
# env: CODEX_WORKER_CMD（テスト用完全上書き、最優先）、WORKER_CMD（後方互換上書き）、
#      CODEX_IMPLEMENTATION_MODEL / CODEX_HIGH_CAPABILITY_MODEL（個別上書き）、
#      CODEX_IMPLEMENTATION_REASONING_EFFORT / CODEX_HIGH_CAPABILITY_REASONING_EFFORT（個別上書き）、
#      ASC_WORKER_MODEL / ASC_WORKER_REASONING_EFFORT（worker-launch.sh が worker.model_tiers から
#      解決済みの値として export する、ISSUE-307）、ASC_WORKER_MODEL_TIER（同、防御的検査専用）。
launch_worker() {
  if [[ -n "${CODEX_WORKER_CMD:-}" ]]; then
    WORKER_CMD="$CODEX_WORKER_CMD"
  fi
  set +e
  _codex_worker_lifecycle "$@"
  local rc=$?
  return "$rc"
}
