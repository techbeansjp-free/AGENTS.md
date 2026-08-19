#!/usr/bin/env bash
# 正本: AGENTS.md §GitHub配布・マルチAI対応 / .agent-skill-chain/config/roles.yaml
#
# ベンダー中立の role contract（.agent-skill-chain/config/roles.yaml）を実行系（Claude Code / Claude Agent SDK 経由の起動）へ
# 変換するアダプタ。lease・commit・test・report等の状態操作系関数は .agent-skill-chain/scripts/*.sh
# （agent-skill-chain CLIへの薄いラッパー）へ結線済み。ゲートレビュアの起動は launch_gate_reviewer、
# セグメント作業ワーカー（spec/design/implementation/validation）の起動は launch_worker として
# いずれも実装済み（#166）。

set -euo pipefail

ADAPTER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SCRIPTS_DIR="$ADAPTER_DIR/../scripts"
REPO_ROOT="$(cd -- "$ADAPTER_DIR/../.." &>/dev/null && pwd)"

# >>> agent-skill-chain CLI resolver preamble >>>
_ASC_WRAPPER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
_ASC_CLI_RESOLVE_PATH="$_ASC_WRAPPER_DIR/../scripts/cli-resolve.sh"
if [[ ! -r "$_ASC_CLI_RESOLVE_PATH" ]]; then
  echo "agent-skill-chain CLI の共有実装を解決できません（探索パス: ${_ASC_CLI_RESOLVE_PATH}）。" >&2
  return 1
fi
if ! source "$_ASC_CLI_RESOLVE_PATH"; then
  echo "agent-skill-chain CLI の共有実装を読み込めません（探索パス: ${_ASC_CLI_RESOLVE_PATH}）。" >&2
  return 1
fi
if ! declare -F asc_resolve_cli >/dev/null; then
  echo "agent-skill-chain CLI の共有実装に公開関数がありません（探索パス: ${_ASC_CLI_RESOLVE_PATH}）。" >&2
  return 1
fi
# <<< agent-skill-chain CLI resolver preamble <<<

# launch_worker の既定起動系（WORKER_CMD 未指定時）が claude CLI へ渡す --allowed-tools の既定値
# （ワーカーの正規責務範囲——自worktree内ファイル編集、自branchへのcommit/push、Draft PR作成
# （specセグメントのみ想定）、テスト実行、report/lease/checkpoint 各スクリプト実行——
# のみに限定したallowlist）。列挙外はヘッドレスで拒否される（安全側 fail）。無制限自動承認
# （--permission-mode bypassPermissions）は既定に用いない。env WORKER_ALLOWED_TOOLS で完全上書き可能
# （grep可能な名前付き変数として定義。採用理由・却下案との比較は DESIGN.md（ISSUE-183）
# 「権限付与方式の設計判断」参照）。
#
# Issue #188 AC-5/AC-6: `Bash(gh pr create:*)` は既定allowlistから除外している。Draft PR作成の
# 正規経路は `.agent-skill-chain/scripts/pr-create.sh`（agent-skill-chain CLI `pr create`
# サブコマンド）であり、PRテンプレート各節を自動充填したうえで `gh pr create` を実行する
# （src/commands/pr.ts buildIssueBody）。このラッパーは `Bash(.agent-skill-chain/scripts/*)` /
# `Bash(node bin/agents-md.js:*)` で既に許可された単一のBash呼び出しの中でNode子プロセスとして
# `gh` を直接起動するため、allowlistから生 `gh pr create` を除いてもラッパー自身のPR作成は
# 影響を受けない（DESIGN.md「論点3」参照）。生 `gh pr create` を残すと、ワーカーがテンプレート
# 充填を経由しない素のPR本文でDraft PRを作成できてしまい、PRテンプレートの実効的な徹底
# （AC-5/AC-6）を損なうため除外する。`gh pr view/edit/comment` はPR作成ではなく更新・参照用途
# のため引き続き許可する。
WORKER_ALLOWED_TOOLS_DEFAULT='Read Grep Glob Edit Write MultiEdit Bash(git add:*) Bash(git commit:*) Bash(git push:*) Bash(git status:*) Bash(git diff:*) Bash(git rev-parse:*) Bash(git log:*) Bash(git show:*) Bash(git fetch:*) Bash(git restore:*) Bash(gh pr view:*) Bash(gh pr edit:*) Bash(gh pr comment:*) Bash(gh issue comment:*) Bash(.agent-skill-chain/scripts/*) Bash(bash .agent-skill-chain/scripts/*) Bash(node bin/agents-md.js:*) Bash(npm run:*) Bash(npm test:*) Bash(npm ci:*) Bash(mkdir:*) Bash(ls:*)'

# Issue #185: launch_worker/launch_gate_reviewer 共通の認証チェック（2段化）。
# (a) 高速パス: ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN のいずれかが非空なら authed とみなす
#     （従来どおり実値は非ログ）。
# (b) フォールバック: いずれのenvも無い場合のみ、claudeが実際に認証済みかを軽量に確認する実疎通確認
#     （既定 `claude auth status`。非対話・認証状態のみ確認・モデル呼び出しなし・トークン消費なし）を
#     行い、終了コード0を authed とみなす。CLAUDE_AUTH_PROBE_CMD で完全上書き可能（テストのモック境界。
#     WORKER_CMD/GATE_REVIEWER_CMDと同型）。claude 不在かつ CLAUDE_AUTH_PROBE_CMD 未指定なら
#     真の認証欠如として1を返す。プローブの出力（`auth status --json`はアカウント情報を含みうる）は
#     stdout/stderrとも非ログ（呼び出し元で2>/dev/null等により捨てる）。
# 採用理由・却下案との比較はDESIGN.md（ISSUE-185）「認証チェック修正方式の設計判断」参照。
# env: ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN（高速パス）、
#      CLAUDE_AUTH_PROBE_CMD（フォールバックプローブの上書き。既定は`claude auth status`）、
#      CLAUDE_AUTH_PROBE_TIMEOUT_SEC（プローブのtimeout秒数、既定20）。
# 終了コード: 0=authed / 1=真の認証欠如（env無し・プローブ失敗またはclaude不在）。
_claude_auth_ok() {
  if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
    return 0
  fi
  local probe="${CLAUDE_AUTH_PROBE_CMD:-}"
  if [[ -z "$probe" ]]; then
    if command -v claude >/dev/null 2>&1; then
      probe='claude auth status'
    else
      return 1
    fi
  fi
  local t="${CLAUDE_AUTH_PROBE_TIMEOUT_SEC:-20}"
  if command -v timeout >/dev/null 2>&1; then
    timeout "$t" bash -c "$probe" >/dev/null 2>&1
  else
    bash -c "$probe" >/dev/null 2>&1
  fi
}

# Issue #448: Agent tool dispatchを許可できるClaude Code CLIセッションかを安全側に判定する。
# テスト用overrideは既知の値claude_code_cliだけを真とし、それ以外は判定不能を含めて偽へ倒す。
_orchestrator_is_claude_code_cli_session() {
  if [[ -n "${ASC_ORCHESTRATOR_SESSION_OVERRIDE:-}" ]]; then
    [[ "$ASC_ORCHESTRATOR_SESSION_OVERRIDE" == "claude_code_cli" ]]
    return
  fi
  [[ "${CLAUDECODE:-}" == "1" ]]
}

# agent-skill-chain CLI を解決して実行する（.agent-skill-chain/scripts/gate-*.sh と同じ優先順位）。
_asc_cli() {
  asc_resolve_cli || return $?
  "${ASC_CLI[@]}" "$@"
}

# Issue #727: reviewerのPATH探索範囲は固定値から広げない。script形式CLIのinterpreterは
# _reviewer_resolve_executable_command がcaller環境で絶対パスへ解決して起動列へ埋め込む。
_reviewer_sanitized_path() {
  printf '%s\n' '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
}

# CLIとshebang interpreterをcaller環境で決定的に絶対パスへ解決し、隔離PATH探索を
# 必要としないshell-quoted起動列を返す。失敗時のstdoutは解決不能だった対象名である。
# env -Sは空白区切りのinterpreter引数を保持する。直接shebangの引数はkernelと同じく
# ひとつの引数として保持する。多段shimは最終native実体まで再帰して解決する。
_reviewer_resolve_executable_command() {
  local requested="${1:-}" depth="${2:-0}"
  if [[ -z "$requested" || ! "$depth" =~ ^[0-9]+$ || "$depth" -ge 8 ]]; then
    printf '%s\n' "${requested:-不明な実行対象}"
    return 126
  fi

  local executable_path=''
  if [[ "$requested" == /* ]]; then
    executable_path="$requested"
  else
    executable_path="$(command -v -- "$requested" 2>/dev/null || true)"
  fi
  if [[ "$executable_path" != /* ]]; then
    printf '%s\n' "$requested"
    return 127
  fi
  if [[ ! -e "$executable_path" ]]; then
    printf '%s\n' "$executable_path"
    return 127
  fi
  if [[ ! -f "$executable_path" || ! -r "$executable_path" || ! -x "$executable_path" ]]; then
    printf '%s\n' "$executable_path"
    return 126
  fi

  local first_line=''
  IFS= read -r first_line <"$executable_path" || true
  first_line="${first_line%$'\r'}"
  if [[ "$first_line" != '#!'* ]]; then
    local quoted_native
    printf -v quoted_native '%q' "$executable_path"
    printf '/usr/bin/env -- %s' "$quoted_native"
    return 0
  fi

  local shebang="${first_line#\#!}"
  shebang="${shebang#"${shebang%%[![:space:]]*}"}"
  local shebang_interpreter="${shebang%%[[:space:]]*}" shebang_arg=''
  if [[ "$shebang" != "$shebang_interpreter" ]]; then
    shebang_arg="${shebang#"$shebang_interpreter"}"
    shebang_arg="${shebang_arg#"${shebang_arg%%[![:space:]]*}"}"
  fi
  if [[ -z "$shebang_interpreter" ]]; then
    printf '%s\n' "$executable_path"
    return 126
  fi

  local interpreter_request="$shebang_interpreter"
  local -a interpreter_args=()
  if [[ "${shebang_interpreter##*/}" == 'env' ]]; then
    if [[ "$shebang_arg" == '-S '* ]]; then
      local split_string="${shebang_arg#-S }"
      local -a split_parts=()
      read -r -a split_parts <<<"$split_string"
      if ((${#split_parts[@]} == 0)); then
        printf '%s\n' "$executable_path"
        return 126
      fi
      interpreter_request="${split_parts[0]}"
      interpreter_args=("${split_parts[@]:1}")
    elif [[ -n "$shebang_arg" && "$shebang_arg" != -* && "$shebang_arg" != *[[:space:]]* ]]; then
      interpreter_request="$shebang_arg"
    else
      printf '%s\n' "${shebang_arg:-$executable_path}"
      return 127
    fi
  elif [[ -n "$shebang_arg" ]]; then
    interpreter_args=("$shebang_arg")
  fi

  local resolved_interpreter='' resolve_rc=0
  resolved_interpreter="$(_reviewer_resolve_executable_command "$interpreter_request" "$((depth + 1))")" || resolve_rc=$?
  if ((resolve_rc != 0)); then
    printf '%s\n' "$resolved_interpreter"
    return "$resolve_rc"
  fi

  local arg quoted_script
  for arg in "${interpreter_args[@]}"; do
    printf -v arg '%q' "$arg"
    resolved_interpreter+=" $arg"
  done
  printf -v quoted_script '%q' "$executable_path"
  printf '%s %s' "$resolved_interpreter" "$quoted_script"
}

_reviewer_launch_failure_message() {
  local target="${1:-不明な実行対象}" rc="${2:-127}"
  local sanitized_path
  sanitized_path="$(_reviewer_sanitized_path)"
  if [[ "$rc" == '126' ]]; then
    printf '%s\n' "レビュア実行系の起動に失敗しました。対象: ${target}。実行権限不足（EACCES）または実行形式不正（ENOEXEC）を確認してください。隔離環境の固定PATH: ${sanitized_path}。対象を呼び出し元環境で実行可能な状態にしてください"
  else
    printf '%s\n' "レビュア実行系の起動に失敗しました。解決できなかった対象: ${target}。隔離環境の固定PATH: ${sanitized_path}。対象を呼び出し元環境のPATHへ導入するか実行ファイル設定を確認してください"
  fi
}

_reviewer_execution_failure_message() {
  local target="${1:-不明な実行対象}" rc="${2:-1}"
  local sanitized_path
  sanitized_path="$(_reviewer_sanitized_path)"
  printf '%s\n' "レビュア実行系の起動に失敗しました。解決済み対象: ${target}（rc=${rc}）。実行権限不足（EACCES）または実行形式不正（ENOEXEC）、もしくは多段shim内の未解決interpreterを確認してください。隔離環境の固定PATH: ${sanitized_path}。対象を呼び出し元環境で単独起動して実行可能性を確認してください"
}

# --- Issue #758: 外部資格情報ストア限定構成（分類C）の資格情報取り込み ---
#
# 認証情報の所在は分類A（環境変数トークン）・分類B（呼び出し元設定ディレクトリの通常ファイル）・
# 分類C（外部資格情報ストア限定。macOS Keychain等）の3つに限られる。分類A・分類Bのいずれからも
# 認証素材を用意できなかった場合に限り、呼び出し元プロセス上で資格情報ストアへ問い合わせ、その
# 標準出力をシェルのリダイレクトで隔離設定ディレクトリの認証ファイルのみへ接続する。
#
# 実値が通る経路をこの1本だけに保つため、取得結果を保持する変数・コマンド引数・隔離設定
# ディレクトリ外のファイル・分岐を伴うパイプ中継はいずれも作らない。取得コマンドの標準エラーは
# 資格情報ストア由来の診断が実値やその一部を含み得るため破棄する。取得後の検査も値を出力しない
# 構造検査に限り、認証成否の判定点は隔離環境の認証probe1つに保つ（取得可否を判定点にしない）。
#
# env（いずれも呼び出し元プロセスの環境変数であり、隔離サブプロセスの基底環境集合へは加えない）:
#   CLAUDE_CREDENTIAL_STORE_CMD          取得コマンドの完全上書き（テストのモック境界。
#                                        WORKER_CMD/GATE_REVIEWER_CMD/CLAUDE_AUTH_PROBE_CMDと同型）。
#                                        空文字を明示した場合は取得手段なしとして扱う。
#   CLAUDE_CREDENTIAL_STORE_TIMEOUT_SEC  取得の時間上限（正整数、既定20）。

# 取得結果状態。not_attempted|command_unavailable|timeout|command_failed|malformed|staged。
# export しないため隔離サブプロセスへは渡らず、値も状態名だけで資格情報を含まない。
ASC_CREDENTIAL_STORE_STATE='not_attempted'

# 取得コマンド文字列を解決する。既定値は主要な分類C環境（macOS）で既定の問い合わせコマンドが
# 実行可能な場合に限り与える。解決できない場合は非零で返す。
_claude_credential_store_command() {
  if [[ -n "${CLAUDE_CREDENTIAL_STORE_CMD+set}" ]]; then
    [[ -n "$CLAUDE_CREDENTIAL_STORE_CMD" ]] || return 1
    printf '%s' "$CLAUDE_CREDENTIAL_STORE_CMD"
    return 0
  fi
  [[ -x /usr/bin/security ]] || return 1
  [[ "$(/usr/bin/uname -s 2>/dev/null || true)" == 'Darwin' ]] || return 1
  printf '%s' "/usr/bin/security find-generic-password -s 'Claude Code-credentials' -w"
}

# 取得の時間上限を解決する。不正値は取得手段なしとして扱うため非零で返す（既定値へ黙って
# 落とすと、利用者が指定した上限が効かないまま待ち続ける経路ができるため）。
_claude_credential_store_timeout() {
  local t="${CLAUDE_CREDENTIAL_STORE_TIMEOUT_SEC:-20}"
  [[ "$t" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s' "$t"
}

# 取得結果の構造検査。非空であること・先頭の非空白文字が { であること・末尾の非空白文字が }
# であることだけを判定し、内容は変数・stdout・stderr・ログのいずれへも書き出さない。
_claude_credential_structure_ok() {
  local file="${1:-}" awk_bin='/usr/bin/awk'
  [[ -n "$file" && -s "$file" ]] || return 1
  [[ -x "$awk_bin" ]] || awk_bin="$(command -v awk 2>/dev/null || true)"
  [[ -n "$awk_bin" && -x "$awk_bin" ]] || return 1
  "$awk_bin" '
    {
      head = $0
      sub(/^[ \t\r]+/, "", head)
      if (seen == 0 && head != "") { seen = 1; first = substr(head, 1, 1) }
      tail = $0
      sub(/[ \t\r]+$/, "", tail)
      if (tail != "") last = substr(tail, length(tail), 1)
    }
    END { exit (seen == 1 && first == "{" && last == "}") ? 0 : 1 }
  ' "$file" >/dev/null 2>&1
}

# 取得結果状態に対応する診断行。実値・その一部・認証ファイルの内容・取得コマンドの標準エラーは
# いずれも含めない。_reviewer_auth_failure_message と取得直後の診断で同じ文言を使う。
_claude_credential_store_state_message() {
  case "${ASC_CREDENTIAL_STORE_STATE:-not_attempted}" in
    not_attempted)
      printf '%s\n' "- 外部資格情報ストア: 分類A・分類Bで認証素材を用意できたため問い合わせていません。"
      ;;
    command_unavailable)
      printf '%s\n' "- 外部資格情報ストア: 取得手段を解決できません。macOS Keychainなどへ問い合わせる既定コマンドを実行できないか、CLAUDE_CREDENTIAL_STORE_CMDが空、またはCLAUDE_CREDENTIAL_STORE_TIMEOUT_SECが正整数ではありません。"
      ;;
    timeout)
      printf '%s\n' "- 外部資格情報ストア: 取得が時間上限内に完了しなかったため打ち切りました。対話的な承認要求が出ていないかを確認し、必要ならCLAUDE_CREDENTIAL_STORE_TIMEOUT_SECを延ばしてください。"
      ;;
    command_failed)
      printf '%s\n' "- 外部資格情報ストア: 取得コマンドが失敗したか出力が空でした（取得コマンドの標準エラーは実値を含み得るため破棄しています）。呼び出し元で同じコマンドを単独実行して確認してください。"
      ;;
    malformed)
      printf '%s\n' "- 外部資格情報ストア: 取得結果が想定の形式ではありません（内容は表示しません）。"
      ;;
    staged)
      printf '%s\n' "- 外部資格情報ストア: 資格情報を取得して隔離設定ディレクトリへ配置しました。"
      ;;
    *)
      printf '%s\n' "- 外部資格情報ストア: 取得結果状態を判定できません。"
      ;;
  esac
}

# 分類Cの資格情報を取得し、隔離設定ディレクトリの認証ファイルへ配置する。
# 引数: <隔離設定ディレクトリ> <作業用ファイルの置き場（隔離領域直下。隔離設定ディレクトリの
#       内容を認証ファイル1点に保つため、作業用ファイルは設定ディレクトリ外へ置く）>
# 呼び出し側へは失敗を返さず、結末は ASC_CREDENTIAL_STORE_STATE の記録にとどめる。
#
# 削除対象は本関数が配置した認証ファイルに限る。分類Bの複製が既にある構成では、D-CLASS-SELECT
# 側の判定により本関数は起動しないが、経路が増えても既存ファイルを消さないよう入口でも検査する。
_claude_credential_store_stage() {
  local staged_config_dir="${1:-}" work_dir="${2:-}"
  ASC_CREDENTIAL_STORE_STATE='not_attempted'
  [[ -n "$staged_config_dir" && -n "$work_dir" ]] || return 0
  local target="$staged_config_dir/.credentials.json"
  if [[ -e "$target" ]]; then
    return 0
  fi

  local store_cmd store_timeout
  store_cmd="$(_claude_credential_store_command)" || {
    ASC_CREDENTIAL_STORE_STATE='command_unavailable'
    _claude_credential_store_stage_diagnostic
    return 0
  }
  store_timeout="$(_claude_credential_store_timeout)" || {
    ASC_CREDENTIAL_STORE_STATE='command_unavailable'
    _claude_credential_store_stage_diagnostic
    return 0
  }

  # 作成マスクを制限した状態で空ファイルとして先行作成する。作成から権限設定までの間に
  # 緩い権限で認証ファイルが存在する窓を作らないため。
  local previous_umask
  previous_umask="$(umask)"
  umask 077
  if ! : >"$target"; then
    umask "$previous_umask"
    ASC_CREDENTIAL_STORE_STATE='command_failed'
    _claude_credential_store_stage_diagnostic
    return 0
  fi
  umask "$previous_umask"
  /bin/chmod 600 "$target"

  local marker="$work_dir/credential-store-timed-out"
  local ready="$work_dir/credential-store-watchdog-ready"
  local armed="$work_dir/credential-store-watchdog-armed"
  local pid_file="$work_dir/credential-store-pid"
  /bin/rm -f -- "$marker" "$ready" "$armed" "$pid_file"

  local watchdog_pid store_pid rc=0 wait_i timed_out=false monitor_was_enabled=false
  # 時間上限は外部のtimeoutコマンドへ委ねず自前の監視プロセスで強制する。当該コマンドは主要な
  # 分類C環境に既定で存在せず、有無で経路が分かれると実機とCIで別経路を走らせることになる。
  (
    active_sleep_pid=''
    trap '[[ -z "$active_sleep_pid" ]] || kill -TERM "$active_sleep_pid" 2>/dev/null || true; exit 0' TERM
    : >"$ready" || exit 1
    while [[ ! -s "$pid_file" ]]; do
      /bin/sleep 0.01 2>/dev/null || exit 1
    done
    IFS= read -r watched_pid <"$pid_file" || exit 1
    [[ "$watched_pid" =~ ^[1-9][0-9]*$ ]] || exit 1
    /bin/sleep "$store_timeout" 2>/dev/null &
    active_sleep_pid=$!
    : >"$armed" || {
      kill -TERM "$active_sleep_pid" 2>/dev/null || true
      exit 1
    }
    wait "$active_sleep_pid" 2>/dev/null || true
    active_sleep_pid=''
    : >"$marker"
    kill -TERM -- "-$watched_pid" 2>/dev/null || true
    /bin/sleep 1 2>/dev/null &
    active_sleep_pid=$!
    wait "$active_sleep_pid" 2>/dev/null || true
    active_sleep_pid=''
    if kill -0 -- "-$watched_pid" 2>/dev/null; then
      kill -KILL -- "-$watched_pid" 2>/dev/null || true
    fi
  ) &
  watchdog_pid=$!

  for ((wait_i = 0; wait_i < 100; wait_i++)); do
    [[ ! -f "$ready" ]] || break
    kill -0 "$watchdog_pid" 2>/dev/null || break
    /bin/sleep 0.01 2>/dev/null || break
  done
  if [[ ! -f "$ready" ]] || ! kill -0 "$watchdog_pid" 2>/dev/null; then
    kill -TERM "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
    /bin/rm -f -- "$target"
    ASC_CREDENTIAL_STORE_STATE='command_failed'
    _claude_credential_store_stage_diagnostic
    return 0
  fi

  # 取得ステップは独自のプロセスグループで起動し、標準出力は隔離設定ディレクトリの認証ファイル
  # のみへ接続する。実値はここから認証ファイルへ直接流れ、起動列にも環境変数にも現れない。
  [[ $- == *m* ]] && monitor_was_enabled=true
  set -m
  (
    exec /bin/bash -c "$store_cmd" >"$target" 2>/dev/null
  ) &
  store_pid=$!
  [[ "$monitor_was_enabled" == "true" ]] || set +m
  printf '%s\n' "$store_pid" >"$pid_file"

  for ((wait_i = 0; wait_i < 100; wait_i++)); do
    [[ ! -f "$armed" ]] || break
    kill -0 "$watchdog_pid" 2>/dev/null || break
    /bin/sleep 0.01 2>/dev/null || break
  done
  if [[ ! -f "$armed" ]] || ! kill -0 "$watchdog_pid" 2>/dev/null; then
    kill -TERM -- "-$store_pid" 2>/dev/null || true
    /bin/sleep 0.1 2>/dev/null || true
    kill -KILL -- "-$store_pid" 2>/dev/null || true
    wait "$store_pid" 2>/dev/null || true
    kill -TERM "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
    /bin/rm -f -- "$target"
    ASC_CREDENTIAL_STORE_STATE='command_failed'
    _claude_credential_store_stage_diagnostic
    return 0
  fi

  wait "$store_pid" || rc=$?
  [[ ! -f "$marker" ]] || timed_out=true
  if [[ "$timed_out" == 'true' ]]; then
    wait "$watchdog_pid" 2>/dev/null || true
  elif kill -0 "$watchdog_pid" 2>/dev/null; then
    kill -TERM "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
  fi
  # 取得ステップの子孫が隔離領域の削除後まで認証ファイルへ書き続けないよう、終了を確認する。
  if kill -0 -- "-$store_pid" 2>/dev/null; then
    kill -TERM -- "-$store_pid" 2>/dev/null || true
    /bin/sleep 0.1 2>/dev/null || true
    kill -KILL -- "-$store_pid" 2>/dev/null || true
  fi
  /bin/rm -f -- "$marker" "$ready" "$armed" "$pid_file"

  if [[ "$timed_out" == 'true' ]]; then
    ASC_CREDENTIAL_STORE_STATE='timeout'
  elif ((rc != 0)) || [[ ! -s "$target" ]]; then
    ASC_CREDENTIAL_STORE_STATE='command_failed'
  elif _claude_credential_structure_ok "$target"; then
    ASC_CREDENTIAL_STORE_STATE='staged'
  else
    ASC_CREDENTIAL_STORE_STATE='malformed'
  fi
  # 打ち切り時までに書かれ得る部分的な内容を隔離probeへ渡さないため、staged以外では削除する。
  # 削除するのは本関数が先行作成した認証ファイルだけである。
  if [[ "$ASC_CREDENTIAL_STORE_STATE" != 'staged' ]]; then
    /bin/rm -f -- "$target"
  fi
  _claude_credential_store_stage_diagnostic
  return 0
}

# 取得直後の診断。隔離probeの構成時は本関数の標準エラーが呼び出し元で破棄されるため、この診断が
# 実際に届くのはレビュア本体の構成時——すなわち隔離probeが成立した後に取得が失敗した経路——に
# 限られる。その経路では認証不成立の診断が出ないまま verdict 空で human_required へ倒れるため、
# ここで原因を提示しないと原因を特定できない（Issue #758）。実値は含めない。
_claude_credential_store_stage_diagnostic() {
  [[ "${ASC_CREDENTIAL_STORE_STATE:-not_attempted}" != 'staged' ]] || return 0
  [[ "${ASC_CREDENTIAL_STORE_STATE:-not_attempted}" != 'not_attempted' ]] || return 0
  printf '%s\n' "launch_gate_reviewer: 分類C（外部資格情報ストア）の資格情報を隔離設定ディレクトリへ用意できませんでした。" >&2
  _claude_credential_store_state_message >&2
}

# Issue #744: reviewer stderrをrawのまま保持せず、固定grammarの有限状態だけへ畳み込む。
# 入力はstdin、出力は隔離領域内のstate_fileであり、元のbyte・行・文字列断片は書き出さない。
_reviewer_classify_stderr() {
  local state_file="$1" byte='' pending_cr=false line_has_data=false line_invalid=false
  local inspected_bytes=0 truncated=false model_seen=false auth_seen=false
  local max_bytes=65536
  local -a auth_patterns=(
    'error: authentication failed'
    'error: unauthorized'
    'error: not authenticated'
    'error: login required'
    'error: not logged in'
    'error: http 401'
    'error: http 403'
  )
  local -a auth_pos=(0 0 0 0 0 0 0)
  local -a model_prefixes=("error: model '" "error: model '" "error: model '" "error: unknown model '")
  local -a model_suffixes=("' is not available" "' is not supported" "' does not exist" "'")
  local -a model_phase=(prefix prefix prefix prefix)
  local -a model_pos=(0 0 0 0)
  local -a model_id_len=(0 0 0 0)

  _reviewer_dfa_reset_line() {
    auth_pos=(0 0 0 0 0 0 0)
    model_phase=(prefix prefix prefix prefix)
    model_pos=(0 0 0 0)
    model_id_len=(0 0 0 0)
    line_has_data=false
    line_invalid=false
    pending_cr=false
  }

  _reviewer_dfa_feed_byte() {
    local current="$1" i expected phase prefix suffix pos id_len active=false
    line_has_data=true
    if [[ "$line_invalid" == 'true' ]]; then return 0; fi
    if [[ -z "$current" ]]; then
      line_invalid=true
      return
    fi
    for i in "${!auth_patterns[@]}"; do
      pos="${auth_pos[$i]}"
      ((pos >= 0)) || continue
      expected="${auth_patterns[$i]:$pos:1}"
      if [[ -n "$expected" && "$current" == "$expected" ]]; then
        auth_pos[$i]=$((pos + 1))
      else
        auth_pos[$i]=-1
      fi
    done
    for i in "${!model_prefixes[@]}"; do
      phase="${model_phase[$i]}"
      [[ "$phase" != 'invalid' ]] || continue
      pos="${model_pos[$i]}"
      case "$phase" in
        prefix)
          prefix="${model_prefixes[$i]}"
          expected="${prefix:$pos:1}"
          if [[ -n "$expected" && "$current" == "$expected" ]]; then
            pos=$((pos + 1))
            model_pos[$i]="$pos"
            if ((pos == ${#prefix})); then
              model_phase[$i]='identifier'
              model_pos[$i]=0
            fi
          else
            model_phase[$i]='invalid'
          fi
          ;;
        identifier)
          id_len="${model_id_len[$i]}"
          if [[ "$current" == "'" && "$id_len" -ge 1 ]]; then
            model_phase[$i]='suffix'
            model_pos[$i]=1
          elif [[ "$current" == [a-z0-9._-] && "$id_len" -lt 128 ]]; then
            model_id_len[$i]=$((id_len + 1))
          else
            model_phase[$i]='invalid'
          fi
          ;;
        suffix)
          suffix="${model_suffixes[$i]}"
          expected="${suffix:$pos:1}"
          if [[ -n "$expected" && "$current" == "$expected" ]]; then
            model_pos[$i]=$((pos + 1))
          else
            model_phase[$i]='invalid'
          fi
          ;;
        *) model_phase[$i]='invalid' ;;
      esac
    done
    for i in "${!auth_patterns[@]}"; do
      if ((${auth_pos[$i]} >= 0)); then active=true; fi
    done
    for i in "${!model_prefixes[@]}"; do
      if [[ "${model_phase[$i]}" != 'invalid' ]]; then active=true; fi
    done
    [[ "$active" == 'true' ]] || line_invalid=true
  }

  _reviewer_dfa_finish_line() {
    local i
    if [[ "$line_invalid" == 'false' ]]; then
      for i in "${!auth_patterns[@]}"; do
        if ((${auth_pos[$i]} == ${#auth_patterns[$i]})); then
          auth_seen=true
        fi
      done
      for i in "${!model_prefixes[@]}"; do
        if [[ "${model_phase[$i]}" == 'suffix' ]] && ((${model_pos[$i]} == ${#model_suffixes[$i]})); then
          model_seen=true
        fi
      done
    fi
    _reviewer_dfa_reset_line
  }

  shopt -s nocasematch
  _reviewer_dfa_reset_line
  LC_ALL=C
  while IFS= read -r -n 1 -d '' byte; do
    if ((inspected_bytes >= max_bytes)); then
      truncated=true
      # 上限直後にもbyteがあるため、上限位置を行末と誤認して完全一致を成立させない。
      line_invalid=true
      /bin/cat >/dev/null
      break
    fi
    inspected_bytes=$((inspected_bytes + 1))
    if [[ "$pending_cr" == 'true' ]]; then
      if [[ "$byte" == $'\n' ]]; then
        _reviewer_dfa_finish_line
        continue
      fi
      pending_cr=false
      line_invalid=true
    fi
    if [[ "$byte" == $'\n' ]]; then
      _reviewer_dfa_finish_line
    elif [[ "$byte" == $'\r' ]]; then
      pending_cr=true
    else
      _reviewer_dfa_feed_byte "$byte"
    fi
  done
  if [[ "$line_has_data" == 'true' || "$pending_cr" == 'true' || "$line_invalid" == 'true' ]]; then
    _reviewer_dfa_finish_line
  fi

  local classification='EXECUTION_FAILURE'
  if [[ "$model_seen" == 'true' && "$auth_seen" == 'false' ]]; then
    classification='MODEL_UNAVAILABLE'
  elif [[ "$auth_seen" == 'true' && "$model_seen" == 'false' ]]; then
    classification='AUTHENTICATION_FAILURE'
  fi
  printf 'classification=%s\nstderr_bytes=%s\nstderr_truncated=%s\n' \
    "$classification" "$inspected_bytes" "$truncated" >"$state_file"
}

_reviewer_internal_diagnostic() {
  local classification="${1:-EXECUTION_FAILURE}" truncated="${2:-false}"
  case "$classification" in
    MODEL_UNAVAILABLE | AUTHENTICATION_FAILURE | TIMEOUT | EXECUTION_FAILURE) ;;
    *) classification='EXECUTION_FAILURE' ;;
  esac
  [[ "$truncated" == 'true' || "$truncated" == 'false' ]] || truncated=false
  printf 'classification=%s;stderr_truncated=%s' "$classification" "$truncated"
}

# 外部診断はallowlist値だけから再構成する。検証不能時はclassificationとrcだけへ縮退する。
_reviewer_failure_envelope() {
  local internal="${1:-}" rc="${2:-1}" attempts="${3:-1}"
  local classification='EXECUTION_FAILURE' truncated=false code='REVIEWER_EXECUTION_FAILURE'
  if [[ "$internal" =~ ^classification=(MODEL_UNAVAILABLE|AUTHENTICATION_FAILURE|TIMEOUT|EXECUTION_FAILURE)\;stderr_truncated=(true|false)$ ]]; then
    classification="${BASH_REMATCH[1]}"
    truncated="${BASH_REMATCH[2]}"
  else
    [[ "$rc" =~ ^[0-9]+$ ]] || rc=1
    printf 'classification=EXECUTION_FAILURE rc=%s' "$rc"
    return
  fi
  if [[ ! "$rc" =~ ^[0-9]+$ || ! "$attempts" =~ ^[1-9][0-9]*$ ]]; then
    [[ "$rc" =~ ^[0-9]+$ ]] || rc=1
    printf 'classification=%s rc=%s' "$classification" "$rc"
    return
  fi
  case "$classification" in
    MODEL_UNAVAILABLE)
      code='REVIEWER_MODEL_UNAVAILABLE'
      if [[ "${ASC_REVIEW_ADAPTER:-claude}" == 'codex' && "${ASC_CORE_REVIEW_REQUIRED:-false}" != 'true' && "${ASC_CODEX_MODEL_SOURCE:-}" == 'default' ]]; then
        code='NONCORE_DEFAULT_MODEL_UNAVAILABLE'
      fi
      ;;
    AUTHENTICATION_FAILURE) code='REVIEWER_AUTHENTICATION_FAILURE' ;;
    TIMEOUT) code='REVIEWER_TIMEOUT' ;;
  esac
  printf 'code=%s classification=%s rc=%s attempts=%s stderr_truncated=%s' \
    "$code" "$classification" "$rc" "$attempts" "$truncated"
}

# AI reviewerへは隔離領域へ複製したmodel providerのログインファイルと、呼び出し元環境の
# ANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKENだけを渡す。GitHub credential・gh/git設定・caller HOME・
# callerのprovider設定ディレクトリは渡さない。判定対象はpromptへ埋込み済みなので、隔離workspace
# 以外の読取りは不要。実値はログ・stdout/stderrに出さない（Issue #691）。
_run_reviewer_sanitized() {
  local prompt="$1" reviewer_cmd="$2" timeout_sec="$3"
  # Issue #691: 不正な値でwatchdogのsleepが失敗すると時間制限が無効になるため、起動前に拒否する。
  if [[ ! "$timeout_sec" =~ ^[1-9][0-9]*$ ]]; then
    printf '%s\n' "_run_reviewer_sanitized: timeout秒数は正整数で指定してください（value=${timeout_sec}）" >&2
    return 64
  fi
  local isolated_root
  isolated_root="$(/usr/bin/mktemp -d /tmp/agent-skill-chain-reviewer.XXXXXX)"
  /bin/mkdir -p "$isolated_root/home" "$isolated_root/workspace" "$isolated_root/xdg" \
    "$isolated_root/auth/claude" "$isolated_root/auth/codex"
  /bin/chmod 700 "$isolated_root" "$isolated_root/home" "$isolated_root/workspace" \
    "$isolated_root/xdg" "$isolated_root/auth" "$isolated_root/auth/claude" "$isolated_root/auth/codex"

  local original_home="${HOME:-}"
  local codex_home="${CODEX_HOME:-${original_home:+$original_home/.codex}}"
  local claude_config="${CLAUDE_CONFIG_DIR:-${original_home:+$original_home/.claude}}"
  local staged_codex_home="$isolated_root/auth/codex"
  local staged_claude_config="$isolated_root/auth/claude"
  local review_adapter="${ASC_REVIEW_ADAPTER:-claude}"
  local sanitized_path
  sanitized_path="$(_reviewer_sanitized_path)"
  # Issue #691: 設定ディレクトリ全体やsymlinkを持ち込むとcaller HOMEや任意パスへの読取り経路に
  # なるため、認証に必要な既知の通常ファイルだけを隔離領域へ複製する。
  if [[ "$review_adapter" == "codex" && -n "$codex_home" && -f "$codex_home/auth.json" && ! -L "$codex_home/auth.json" ]]; then
    /bin/cp "$codex_home/auth.json" "$staged_codex_home/auth.json"
    /bin/chmod 600 "$staged_codex_home/auth.json"
  fi
  local class_b_staged=false
  if [[ "$review_adapter" == "claude" && -n "$claude_config" && -f "$claude_config/.credentials.json" && ! -L "$claude_config/.credentials.json" ]]; then
    /bin/cp "$claude_config/.credentials.json" "$staged_claude_config/.credentials.json"
    /bin/chmod 600 "$staged_claude_config/.credentials.json"
    class_b_staged=true
  fi
  # Issue #758: 分類判定は呼び出し元の状態だけに依存させる。分類A（環境変数トークンが非空）
  # または分類B（複製できた通常ファイル）が成立した構成では資格情報ストアへ問い合わせない。
  # 分類Cの取得はこの分岐でのみ起動するため、分類Bの複製が取得側で削除されることはない。
  ASC_CREDENTIAL_STORE_STATE='not_attempted'
  if [[ "$review_adapter" == "claude" && "$class_b_staged" == 'false' && -z "${ANTHROPIC_API_KEY:-}" && -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
    _claude_credential_store_stage "$staged_claude_config" "$isolated_root"
  fi
  local -a clean_env=(
    /usr/bin/env -i
    "PATH=$sanitized_path"
    "HOME=$isolated_root/home"
    "XDG_CONFIG_HOME=$isolated_root/xdg"
    "GH_CONFIG_DIR=$isolated_root/xdg/gh"
    "GIT_CONFIG_GLOBAL=/dev/null"
    "GIT_CONFIG_SYSTEM=/dev/null"
    "GIT_TERMINAL_PROMPT=0"
    "TMPDIR=/tmp"
    "LANG=${LANG:-C.UTF-8}"
    "LC_ALL=${LC_ALL:-}"
  )
  if [[ "$review_adapter" == "codex" ]]; then
    clean_env+=("CODEX_HOME=$staged_codex_home")
  else
    clean_env+=("CLAUDE_CONFIG_DIR=$staged_claude_config")
    # ISSUE-562: 呼び出し元のprovider tokenが設定されている場合は隔離サブプロセスへ引き継ぐ。
    # Issue #691: tokenの存在だけでは認証済みとせず、下流のprobeで実際の成立を検証する。
    [[ -n "${ANTHROPIC_API_KEY:-}" ]] && clean_env+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
    [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]] && clean_env+=("CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN")
  fi

  local prompt_file="$isolated_root/prompt" output_file="$isolated_root/output"
  local stderr_pipe="$isolated_root/reviewer-stderr" stderr_state="$isolated_root/reviewer-stderr-state"
  local timeout_marker="$isolated_root/timed-out" watchdog_ready="$isolated_root/watchdog-ready"
  local watchdog_armed="$isolated_root/watchdog-armed" reviewer_pid_file="$isolated_root/reviewer-pid"
  local reviewer_pid watchdog_pid classifier_pid='' stderr_fifo_fd='' rc=0 output="" monitor_was_enabled=false
  printf '%s' "$prompt" >"$prompt_file"
  # Issue #691: reviewerより先にwatchdogを起動し、準備完了を確認する。期限後は独立した
  # reviewerプロセスグループ全体へTERMを送り、1秒の猶予後も残るプロセスをKILLする。
  (
    active_sleep_pid=''
    trap '[[ -z "$active_sleep_pid" ]] || kill -TERM "$active_sleep_pid" 2>/dev/null || true; exit 0' TERM
    : >"$watchdog_ready" || exit 1
    while [[ ! -s "$reviewer_pid_file" ]]; do
      /bin/sleep 0.01 2>/dev/null || exit 1
    done
    IFS= read -r watched_pid <"$reviewer_pid_file" || exit 1
    [[ "$watched_pid" =~ ^[1-9][0-9]*$ ]] || exit 1
    /bin/sleep "$timeout_sec" 2>/dev/null &
    active_sleep_pid=$!
    : >"$watchdog_armed" || {
      kill -TERM "$active_sleep_pid" 2>/dev/null || true
      exit 1
    }
    wait "$active_sleep_pid" 2>/dev/null || true
    active_sleep_pid=''
    : >"$timeout_marker"
    kill -TERM -- "-$watched_pid" 2>/dev/null || true
    /bin/sleep 1 2>/dev/null &
    active_sleep_pid=$!
    wait "$active_sleep_pid" 2>/dev/null || true
    active_sleep_pid=''
    if kill -0 -- "-$watched_pid" 2>/dev/null; then
      kill -KILL -- "-$watched_pid" 2>/dev/null || true
    fi
  ) &
  watchdog_pid=$!

  local watchdog_wait
  for ((watchdog_wait = 0; watchdog_wait < 100; watchdog_wait++)); do
    [[ ! -f "$watchdog_ready" ]] || break
    kill -0 "$watchdog_pid" 2>/dev/null || break
    /bin/sleep 0.01 2>/dev/null || break
  done
  if [[ ! -f "$watchdog_ready" ]] || ! kill -0 "$watchdog_pid" 2>/dev/null; then
    kill -TERM "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
    /bin/rm -rf -- "$isolated_root"
    printf '%s\n' "_run_reviewer_sanitized: watchdogを起動できないためレビュアを起動しません" >&2
    return 70
  fi

  if ! /usr/bin/mkfifo "$stderr_pipe" || ! exec {stderr_fifo_fd}<>"$stderr_pipe"; then
    kill -TERM "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
    /bin/rm -rf -- "$isolated_root"
    _reviewer_internal_diagnostic EXECUTION_FAILURE false
    return 70
  fi
  (
    # classifier自身が親のread/write descriptorを保持するとEOFを観測できないため先に閉じる。
    exec {stderr_fifo_fd}>&-
    _reviewer_classify_stderr "$stderr_state" <"$stderr_pipe"
  ) &
  classifier_pid=$!

  [[ $- == *m* ]] && monitor_was_enabled=true
  set -m
  (
    cd -- "$isolated_root/workspace" &&
      exec "${clean_env[@]}" /bin/bash -c "$reviewer_cmd" <"$prompt_file" >"$output_file" 2>"$stderr_pipe"
  ) &
  reviewer_pid=$!
  [[ "$monitor_was_enabled" == "true" ]] || set +m
  printf '%s\n' "$reviewer_pid" >"$reviewer_pid_file"

  for ((watchdog_wait = 0; watchdog_wait < 100; watchdog_wait++)); do
    [[ ! -f "$watchdog_armed" ]] || break
    kill -0 "$watchdog_pid" 2>/dev/null || break
    /bin/sleep 0.01 2>/dev/null || break
  done
  if [[ ! -f "$watchdog_armed" ]] || ! kill -0 "$watchdog_pid" 2>/dev/null; then
    kill -TERM -- "-$reviewer_pid" 2>/dev/null || true
    /bin/sleep 0.1 2>/dev/null || true
    kill -KILL -- "-$reviewer_pid" 2>/dev/null || true
    wait "$reviewer_pid" 2>/dev/null || true
    exec {stderr_fifo_fd}>&-
    wait "$classifier_pid" 2>/dev/null || true
    kill -TERM "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
    /bin/rm -rf -- "$isolated_root"
    printf '%s\n' "_run_reviewer_sanitized: watchdogを準備できないためレビュアを停止しました" >&2
    return 70
  fi

  wait "$reviewer_pid" || rc=$?
  if [[ -f "$timeout_marker" ]]; then
    wait "$watchdog_pid" 2>/dev/null || true
  elif kill -0 "$watchdog_pid" 2>/dev/null; then
    kill -TERM "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
  fi
  # reviewer本体が正常終了しても子孫だけが残る場合に、隔離プロセスを残さない。
  if kill -0 -- "-$reviewer_pid" 2>/dev/null; then
    kill -TERM -- "-$reviewer_pid" 2>/dev/null || true
    /bin/sleep 0.1 2>/dev/null || true
    kill -KILL -- "-$reviewer_pid" 2>/dev/null || true
  fi
  exec {stderr_fifo_fd}>&-
  local classifier_rc=0
  wait "$classifier_pid" || classifier_rc=$?
  if [[ -f "$timeout_marker" ]]; then
    rc=124
  fi
  if ((rc == 0)); then
    [[ ! -f "$output_file" ]] || output="$(<"$output_file")"
  else
    local classification='EXECUTION_FAILURE' stderr_truncated=false state_key state_value
    if ((classifier_rc == 0)) && [[ -f "$stderr_state" ]]; then
      while IFS='=' read -r state_key state_value; do
        case "$state_key" in
          classification)
            case "$state_value" in
              MODEL_UNAVAILABLE | AUTHENTICATION_FAILURE | EXECUTION_FAILURE) classification="$state_value" ;;
            esac
            ;;
          stderr_truncated)
            [[ "$state_value" == 'true' || "$state_value" == 'false' ]] && stderr_truncated="$state_value"
            ;;
        esac
      done <"$stderr_state"
    fi
    [[ "$rc" != '124' ]] || classification='TIMEOUT'
    output="$(_reviewer_internal_diagnostic "$classification" "$stderr_truncated")"
  fi
  /bin/rm -rf -- "$isolated_root"
  printf '%s' "$output"
  return "$rc"
}

# Issue #691: レビュアの認証プローブも実際のレビュアと同じ隔離環境で実行する。
# caller HOMEに紐づくKeychain認証を利用可能と誤判定せず、決定的な認証不成立は再試行前に検出する。
_claude_reviewer_auth_ok() {
  local probe="${CLAUDE_AUTH_PROBE_CMD:-}"
  if [[ -z "$probe" ]]; then
    local claude_executable="${CLAUDE_EXECUTABLE:-claude}"
    if [[ -z "${reviewer_executable_cmd:-}" ]]; then
      local resolve_rc=0
      reviewer_executable_cmd="$(_reviewer_resolve_executable_command "$claude_executable")" || resolve_rc=$?
      ((resolve_rc == 0)) || return "$resolve_rc"
    fi
    probe="$reviewer_executable_cmd auth status"
  fi
  local t="${CLAUDE_AUTH_PROBE_TIMEOUT_SEC:-20}"
  _run_reviewer_sanitized "" "$probe" "$t" >/dev/null 2>&1
}

_reviewer_auth_failure_message() {
  local original_home="${HOME:-}"
  local claude_config="${CLAUDE_CONFIG_DIR:-${original_home:+$original_home/.claude}}"
  local portable_auth_found=false

  printf '%s\n' "隔離環境でClaude Codeの認証probeに失敗しました。"
  if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
    printf '%s\n' "- 環境変数による資格情報: 設定されています（実値は表示しません）。"
    portable_auth_found=true
  else
    printf '%s\n' "- 環境変数による資格情報: ANTHROPIC_API_KEYとCLAUDE_CODE_OAUTH_TOKENは未設定です。"
  fi
  if [[ -n "$claude_config" && -f "$claude_config/.credentials.json" && ! -L "$claude_config/.credentials.json" ]]; then
    printf '%s\n' "- 設定ディレクトリ配下のログイン情報: 隔離領域へ複製可能な通常ファイルが見つかりました。"
    portable_auth_found=true
  else
    printf '%s\n' "- 設定ディレクトリ配下のログイン情報: 隔離領域へ複製可能な通常ファイルが見つかりません。"
  fi
  # Issue #758: 分類Cの検出結果は取得結果状態を根拠に提示する。取得できたが隔離probeが不成立の
  # 場合（staged）は、持ち込み可能な認証情報が有った場合と同じ結語へ集約する。
  _claude_credential_store_state_message
  [[ "${ASC_CREDENTIAL_STORE_STATE:-not_attempted}" != 'staged' ]] || portable_auth_found=true
  printf '%s\n' "- 設定ディレクトリの扱い: CLAUDE_CONFIG_DIRは常に隔離領域内の制御されたパスを指し、呼び出し元の設定ディレクトリを解決先にしません（未設定にもしません）。"
  if [[ "$portable_auth_found" == "true" ]]; then
    printf '%s\n' "持ち込み可能な認証情報は検出されましたが、隔離環境の認証probeが失敗しています。資格情報の有効性と権限を確認してください。"
  else
    printf '%s\n' "隔離環境へ持ち込める認証情報がありません。上の分類ごとの検出結果から原因を特定してください。"
  fi
  # Issue #691: 値を表示しないtestコマンドとcaller側のprobeを組み合わせ、資格情報ストア限定構成を判別可能にする。
  printf '%s\n' '資格情報ストア限定構成の判定方法: 呼び出し元で `claude auth status` が成功し、次の両方が失敗する場合はmacOS Keychainなどの資格情報ストア限定構成です。'
  printf '%s\n' '  test -n "${ANTHROPIC_API_KEY:-}${CLAUDE_CODE_OAUTH_TOKEN:-}"'
  printf '%s\n' '  test -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json" && test ! -L "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json"'
  printf '%s\n' "回避するには、ANTHROPIC_API_KEYまたはCLAUDE_CODE_OAUTH_TOKEN、もしくは設定ディレクトリ配下の通常ファイルとしてログイン情報を設定してください。資格情報ストア限定構成では、CLAUDE_CREDENTIAL_STORE_CMDへ資格情報を標準出力へ返すコマンドを指定することでも解消できます。"
}

# writer lease を取得する。.agent-skill-chain/config/agent-skill-chain.yaml の lease.ttl_seconds を用いる。
# 引数: issue_id, segment
acquire_lease() {
  "$SCRIPTS_DIR/lease-acquire.sh" "$@"
}

# 保持中の writer lease を延長する。.agent-skill-chain/config/agent-skill-chain.yaml の lease.renewal_interval_seconds を用いる。
# 引数: issue_id（tokenはGit管理外credentialから暗黙に取得）
renew_lease() {
  "$SCRIPTS_DIR/lease-renew.sh" "$@"
}

# 保持中の writer lease を解放する。
# 引数: issue_id（tokenはGit管理外credentialから暗黙に取得）
release_lease() {
  "$SCRIPTS_DIR/lease-release.sh" "$@"
}

# 自ブランチへ commit・push する（自ブランチ以外への書込みは禁止）。
# 引数: message
commit_and_push() {
  "$SCRIPTS_DIR/checkpoint.sh" "$@"
}

# テストを実行する（常時必須／変更内容別必須のテストは .agent-skill-chain/standards/TEST_POLICY.md 参照）。
run_tests() {
  "$SCRIPTS_DIR/run-tests.sh" "$@"
}

# Integration Record / Draft PR を新規作成する（SPECワーカーの最初のcheckpoint push直後のみ）。
# 既存レコードへの更新（design/implementation/validationワーカーによるgatesフィールド反映等）は
# 現時点でCLI側に実装が無く、spec以外のセグメントから呼び出すと失敗する
# （pr-create.sh・.agent-skill-chain/schemas/integration.schema.yaml参照。GitHubモードでは
# 後続のcommit_and_pushによるpushがPRへ自動反映されるため、実害は無い）。
# 引数: issue_id, branch
update_integration_record() {
  "$SCRIPTS_DIR/pr-create.sh" "$@"
}

# 完了・blocked を固定スキーマ（.agent-skill-chain/schemas/worker-report.schema.yaml）で進行役へ報告する。
# 引数: issue_id, role, segment, status, target_sha, [blocked_reason]
report_status() {
  "$SCRIPTS_DIR/report-status.sh" "$@"
}

# --- claude.sh 固有の差分: ゲートレビュア起動 ---
#
# ゲートレビュア（read-only）を Claude Code CLI headless（既定）または GATE_REVIEWER_CMD で指定した
# 実行系で起動し、構造化 verdict を gate-report へ結線する。
#
# read-only 契約（ADR-1 / AGENTS.md §役割・権限）: レビュアには書込みツールを一切与えない
#   （claude CLI は `--allowed-tools ''` で無ツール起動）。gate-report への書込みは trusted な
#   `agent-skill-chain gate record-verdict`（本アダプタ経由）のみが行う。
# I8 安全側ラチェット: 認証未設定（かつ実疎通確認も失敗）・CLI 不在・起動失敗・timeout・verdict 空・
#   結線失敗はいずれも final=human_required を書いて非ゼロ（!=3）で返す（決して approve/success へ倒さない）。
# 認証情報（ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN）・実疎通確認（claude auth status）の出力は
#   実値をログ・stdout に出さない（Issue #185 _claude_auth_ok）。
#
# 引数: <issue_id> <gate_id> <profile> <gate_report_path> <target_sha>
# 終了コード: 0=判定完了 / 2（!=0,!=3）=error（final=human_required 書込み後）。
# env: ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN（認証、高速パス）、
#      CLAUDE_AUTH_PROBE_CMD | CLAUDE_AUTH_PROBE_TIMEOUT_SEC（認証の実疎通フォールバック、_claude_auth_ok参照）、
#      CLAUDE_CREDENTIAL_STORE_CMD | CLAUDE_CREDENTIAL_STORE_TIMEOUT_SEC（分類C＝外部資格情報ストア限定構成での
#      資格情報取得。分類A・分類Bのいずれからも用意できない場合のみ使う。Issue #758）、
#      GATE_REVIEWER_CMD（通常レビューの実行系上書き）、CLAUDE_REVIEWER_MODEL（通常レビューの明示model）、
#      CLAUDE_CORE_REVIEW_MODEL / CLAUDE_CORE_REVIEW_MODEL_TIER /
#      CLAUDE_CORE_REVIEW_REASONING_TIER / CLAUDE_CORE_REVIEW_REASONING_PROBE_CMD（コアレビュー能力証明）、
#      GATE_REVIEWER_TIMEOUT_SEC（既定900）、GATE_REVIEWER_RETRIES（既定3）、GATE_REVIEWER_RETRY_INTERVAL_SEC（既定30）。
launch_gate_reviewer() {
  local issue_id="${1:-}" gate_id="${2:-}" profile="${3:-}" report_path="${4:-}" target_sha="${5:-}"

  if [[ -z "$issue_id" || -z "$gate_id" || -z "$profile" || -z "$report_path" || -z "$target_sha" ]]; then
    echo "launch_gate_reviewer: 引数 <issue_id> <gate_id> <profile> <gate_report_path> <target_sha> が必要です" >&2
    return 1
  fi
  case "$gate_id" in
    spec | design | implementation | validation) ;;
    *)
      echo "launch_gate_reviewer: gate_id は spec|design|implementation|validation のいずれかである必要があります: $gate_id" >&2
      return 1
      ;;
  esac
  if [[ ! -f "$report_path" ]]; then
    echo "launch_gate_reviewer: gate-report が存在しません（gate review 未実行）: $report_path" >&2
    return 1
  fi

  # フェイルセーフ書込み（I8）: final=human_required を書いて error を返す共通処理。
  _fail_safe() {
    echo "launch_gate_reviewer: $1（フェイルセーフで human_required へ倒します）" >&2
    _asc_cli gate mark-human-required "$report_path" >/dev/null || true
    return 2
  }

  local core_claude_review=false
  if [[ "${ASC_CORE_REVIEW_REQUIRED:-false}" == "true" && "${ASC_REVIEW_ADAPTER:-claude}" == "claude" ]]; then
    core_claude_review=true
    if [[ "${CLAUDE_CORE_REVIEW_MODEL_TIER:-}" != "${ASC_CORE_MODEL_TIER:-frontier_coding}" ]]; then
      _fail_safe "Claude core reviewer の model tier を frontier_coding と検証できません"
      return
    fi
    if [[ "${CLAUDE_CORE_REVIEW_REASONING_TIER:-}" != "${ASC_CORE_REASONING_TIER:-maximum_reasoning}" ]]; then
      _fail_safe "Claude core reviewer の reasoning tier を maximum_reasoning と検証できません"
      return
    fi
    if [[ -z "${CLAUDE_CORE_REVIEW_MODEL:-}" || "${CLAUDE_CORE_REVIEW_MODEL:-}" == gpt-* ]]; then
      _fail_safe "Claude core reviewer の実在modelが未指定、またはprovider不一致です"
      return
    fi
    local reasoning_probe="${CLAUDE_CORE_REVIEW_REASONING_PROBE_CMD:-}"
    if [[ -z "$reasoning_probe" ]]; then
      _fail_safe "Claude core reviewer の最大利用可能reasoningを検証するprobeが未設定です"
      return
    fi
    local reasoning_probe_timeout="${CLAUDE_CORE_REVIEW_REASONING_PROBE_TIMEOUT_SEC:-20}"
    if command -v timeout >/dev/null 2>&1; then
      if ! timeout "$reasoning_probe_timeout" bash -c "$reasoning_probe" >/dev/null 2>&1; then
        _fail_safe "Claude core reviewer のreasoning probeに失敗しました"
        return
      fi
    elif ! bash -c "$reasoning_probe" >/dev/null 2>&1; then
      _fail_safe "Claude core reviewer のreasoning probeに失敗しました"
      return
    fi
    ASC_CAPABILITY_PROBE_PASSED=true
    export ASC_CAPABILITY_PROBE_PASSED
    if [[ -n "${GATE_REVIEWER_CMD:-}" ]]; then
      _fail_safe "コアレビューではmodel指定を検証できない汎用GATE_REVIEWER_CMD上書きを許可しません"
      return
    fi
  fi

  # Issue #727: default認証probeまたはdefault reviewerがCLIを使う場合は、認証判定より前に
  # CLIと全shebang interpreterをcaller環境で絶対パスへ解決する。解決不能を認証失敗へ
  # 誤分類せず、固定PATHを明示した起動失敗として安全側へ倒す。
  local reviewer_executable_cmd="${reviewer_executable_cmd:-}"
  local reviewer_executable_name='' resolve_rc=0 needs_default_executable=false
  if [[ "${ASC_REVIEW_ADAPTER:-claude}" == 'codex' ]]; then
    reviewer_executable_name="${CODEX_EXECUTABLE:-codex}"
    if [[ -z "${CODEX_AUTH_PROBE_CMD:-}" || ( -z "${CODEX_REVIEWER_CMD:-}" && -z "${GATE_REVIEWER_CMD:-}" ) ]]; then
      needs_default_executable=true
    fi
  else
    reviewer_executable_name="${CLAUDE_EXECUTABLE:-claude}"
    if [[ -z "${CLAUDE_AUTH_PROBE_CMD:-}" || -z "${GATE_REVIEWER_CMD:-}" ]]; then
      needs_default_executable=true
    fi
  fi
  if [[ "$needs_default_executable" == 'true' && -z "$reviewer_executable_cmd" ]]; then
    reviewer_executable_cmd="$(_reviewer_resolve_executable_command "$reviewer_executable_name")" || resolve_rc=$?
    if ((resolve_rc != 0)); then
      _fail_safe "$(_reviewer_launch_failure_message "$reviewer_executable_cmd" "$resolve_rc")"
      return
    fi
  fi

  # 認証（実値はログ・stdout に出さない）。tokenや隔離領域へ複製した認証ファイルの有無だけで
  # 成功扱いせず、実際のレビュア環境内でprobeが成功した場合だけ起動へ進む（Issue #691）。
  local auth_rc=0
  _claude_reviewer_auth_ok || auth_rc=$?
  if ((auth_rc != 0)); then
    if [[ "$auth_rc" == '126' || "$auth_rc" == '127' ]]; then
      _fail_safe "$(_reviewer_execution_failure_message "$reviewer_executable_name" "$auth_rc")"
      return
    fi
    _fail_safe "$(_reviewer_auth_failure_message)"
    return
  fi

  # レビュア実行系。コア時は公式 --model と能力証明を必須化する。通常時だけ汎用上書きを許可する。
  local reviewer_cmd="${GATE_REVIEWER_CMD:-}"
  if [[ -z "$reviewer_cmd" ]]; then
    if [[ -n "$reviewer_executable_cmd" ]]; then
      reviewer_cmd="$reviewer_executable_cmd -p --output-format text --allowed-tools ''"
      local selected_model=""
      if [[ "$core_claude_review" == "true" ]]; then
        selected_model="$CLAUDE_CORE_REVIEW_MODEL"
      elif [[ -n "${CLAUDE_REVIEWER_MODEL:-}" ]]; then
        selected_model="$CLAUDE_REVIEWER_MODEL"
      fi
      if [[ -n "$selected_model" ]]; then
        local quoted_model
        printf -v quoted_model '%q' "$selected_model"
        reviewer_cmd+=" --model $quoted_model"
      fi
    else
      _fail_safe "Claude Code CLI が見つからず利用可能な実行系も未設定です"
      return
    fi
  fi

  # 判定プロンプト（ルーブリック・出力契約）を組み立てる。
  local prompt prompt_digest prompt_hash
  if ! prompt="$(_asc_cli gate reviewer-prompt "$issue_id" "$gate_id" "$target_sha" "${ASC_EVIDENCE_BASE_SHA:-}" "${ASC_EVIDENCE_PR_NUMBER:-}" "${ASC_REVIEW_ATTEMPT_ID:-}")"; then
    _fail_safe "判定プロンプトの生成に失敗しました"
    return
  fi
  if ! prompt_hash="$(printf '%s' "$prompt" | _sha256_digest)" || [[ ! "$prompt_hash" =~ ^[0-9a-f]{64}$ ]]; then
    _fail_safe "レビュアへ渡す判定プロンプトのdigest生成に失敗しました"
    return
  fi
  prompt_digest="sha256:$prompt_hash"

  # backendと判定対象成果物のbase_dirを解決する。GitHub modeではreviewerはPR review evidenceだけを
  # 投稿し、CIのprotected-base verifierがgate-reportへ結線する。
  local reviewer_context base_dir backend
  reviewer_context="$(_asc_cli gate reviewer-context "$issue_id")"
  base_dir="$(sed -n 's/^base_dir=//p' <<<"$reviewer_context")"
  backend="$(sed -n 's/^backend=//p' <<<"$reviewer_context")"

  local timeout_sec="${GATE_REVIEWER_TIMEOUT_SEC:-900}"
  local retries="${GATE_REVIEWER_RETRIES:-3}"
  local interval="${GATE_REVIEWER_RETRY_INTERVAL_SEC:-30}"

  # Issue #691: 不正値は決定的で再試行しても直らず、watchdogを無効化し得るため起動前に停止する。
  if [[ ! "$timeout_sec" =~ ^[1-9][0-9]*$ ]]; then
    _fail_safe "GATE_REVIEWER_TIMEOUT_SEC は正整数で指定してください（value=${timeout_sec}）"
    return
  fi

  # read-only レビュア起動（プロンプトは stdin）。一時障害はリトライ、timeout は打ち切り。
  local attempt=1 completed_attempts=0 verdict rc internal_diagnostic=''
  while ((attempt <= retries)); do
    verdict=""
    rc=0
    verdict="$(_run_reviewer_sanitized "$prompt" "$reviewer_cmd" "$timeout_sec")" || rc=$?
    completed_attempts="$attempt"
    if [[ $rc -eq 0 && -n "$verdict" ]]; then
      break
    fi
    internal_diagnostic="$verdict"
    ((attempt++))
    if ((attempt <= retries)); then sleep "$interval"; fi
  done

  if [[ ${rc:-1} -ne 0 || -z "${verdict:-}" ]]; then
    if [[ "${rc:-1}" == '126' || "${rc:-1}" == '127' ]]; then
      _fail_safe "$(_reviewer_execution_failure_message "${reviewer_executable_name:-レビュア実行系CLI}" "${rc:-1}")"
      return
    fi
    local safe_diagnostic
    safe_diagnostic="$(_reviewer_failure_envelope "$internal_diagnostic" "${rc:-1}" "${completed_attempts:-1}")"
    _fail_safe "レビュア起動に失敗しました（${safe_diagnostic}）"
    return
  fi

  if [[ "$backend" == "github" ]]; then
    for required in ASC_EVIDENCE_BASE_SHA ASC_TRUSTED_BASE_SHA ASC_EVIDENCE_PR_NUMBER ASC_REVIEW_ATTEMPT_ID ASC_REVIEW_EXPECTED_COUNT ASC_LAUNCHER_TOKEN_FILE ASC_REVIEWER_RUN_ID ASC_REVIEWER_SLOT; do
      if [[ -z "${!required:-}" ]]; then
        _fail_safe "GitHub review evidence投稿に必要な $required がありません"
        return
      fi
    done
    local evidence_model="${ASC_REVIEW_MODEL:-${CLAUDE_CORE_REVIEW_MODEL:-${CLAUDE_REVIEWER_MODEL:-default}}}"
    local evidence_reasoning="${ASC_REVIEW_REASONING:-${CLAUDE_CORE_REVIEW_REASONING_TIER:-explicit_selection}}"
    if ! printf '%s' "$verdict" | _asc_cli gate submit-evidence \
      "$issue_id" "$gate_id" "$profile" "$target_sha" "$ASC_EVIDENCE_BASE_SHA" "$ASC_TRUSTED_BASE_SHA" \
      "$ASC_EVIDENCE_PR_NUMBER" "$ASC_REVIEW_ATTEMPT_ID" "$ASC_REVIEW_EXPECTED_COUNT" \
      "$ASC_REVIEWER_RUN_ID" "$ASC_REVIEWER_SLOT" \
      "${ASC_REVIEW_ADAPTER:-claude}" "$evidence_model" "$evidence_reasoning" "$prompt_digest" >/dev/null; then
      _fail_safe "verdict のGitHub PR review evidence投稿に失敗しました"
      return
    fi
  elif ! printf '%s' "$verdict" | _asc_cli gate record-verdict "$report_path" "$base_dir" >/dev/null; then
    _fail_safe "verdict のgate-reportへの結線に失敗しました"
    return
  fi
  return 0
}

# --- claude.sh 固有の差分: セグメント作業ワーカー起動（launch_worker、#166） ---
#
# writer（セグメント作業ワーカー、spec/design/implementation/validation）を Claude Code CLI
# headless（既定）または WORKER_CMD で指定した実行系で起動し、segment start が返す role_contract
# 全文をプロンプトとして stdin 経由で渡す（launch_gate_reviewer と同型）。read-only な
# ゲートレビュアと異なり、書込みツールを許可した非対話フラグで起動する。ワーカー自身が
# checkpoint.sh（＋specのみ pr-create.sh）・report-status.sh・lease-release.sh を呼び出して
# 完了させる。launch_worker自身は「成果物の中身」を判断せず、report-status の直近レコードと
# target_shaの一致だけで完了を機械的に確認する（役割・権限の境界。DESIGN.md参照）。
#
# lease取得→segment start→起動→完了確認→解放/blocked報告の順序（AC-2）:
#   1. lease取得に失敗した場合、まだ何も起動していないため blocked報告は行わず即 return 1。
#   2. segment start（role_contract取得）に失敗した場合も起動前のため worker-report は書かず、
#      lease解放のみ行って return 1。
#   3. 起動後（認証未設定・CLI不在・起動失敗・timeout・完了を騙る＝未報告/target_sha不一致）は
#      すべて report_status blocked(human_escalation_requested扱いの理由メッセージ) + release_lease
#      を行い、0でも3でもない終了コードで返す（I8: silent passしない）。
#   4. 完了確認（worker自身のreport statusがcompletedかつtarget_shaがpush済みHEADと一致）が
#      取れた場合のみ release_lease + return 0。
#
# リトライしない: workerは実際にファイルを書き換える非冪等な操作を行うため、失敗直後の無条件
# リトライは部分書込みの上に二重に作業させる・二重commitを生む実害がある。1回の起動失敗は
# 即座に人間判断（blocked）へ委ねる（I8: 迷ったら安全側）。
#
# Agent tool dispatch中にwriter leaseを更新する独立デーモン。第2引数の一時ディレクトリは
# 起動コマンドラインへそのまま残り、verify側がPID再利用を検知する識別子になる。
_dispatch_lease_renew_daemon() {
  local issue_id="$1" dispatch_temp_dir="$2" renew_interval="$3" max_wait="$4" detach_mode="${5:-}"
  local started=$SECONDS elapsed remaining wait_sec wait_pid=""

  # /dev/nullへのreadはEOFで即時復帰するため待機には使えない。sleepを明示的な子として保持し、
  # verifyからSIGTERMを受けたときは子も停止してrenewal_interval分の孤児待機を残さない。
  trap '
    if [[ -n "$wait_pid" ]]; then
      kill "$wait_pid" >/dev/null 2>&1 || true
      wait "$wait_pid" 2>/dev/null || true
    fi
    exit 0
  ' TERM INT HUP
  # Issue #757: nohupから継承したSIGHUP無視を上の共通cleanup trapで上書きしない。
  # TERM・INTは引き続き子sleepを止めて終了し、setsid・perl経路のHUP動作も維持する。
  if [[ "$detach_mode" == "nohup" ]]; then
    trap '' HUP
  fi

  # 親はこの応答とPIDの一致を確認するまでdispatch_requiredを返さない。launcherが
  # setsid(2)やexecに失敗した場合に、renew無しのleaseをfail-openで残すことを防ぐ。
  printf '%s\n' "$$" >"$dispatch_temp_dir/renew.ready"
  chmod 600 "$dispatch_temp_dir/renew.ready"

  while (( SECONDS - started < max_wait )); do
    elapsed=$((SECONDS - started))
    remaining=$((max_wait - elapsed))
    wait_sec="$renew_interval"
    (( wait_sec > remaining )) && wait_sec="$remaining"
    sleep "$wait_sec" &
    wait_pid=$!
    wait "$wait_pid" || return 0
    wait_pid=""
    (( SECONDS - started >= max_wait )) && break
    renew_lease "$issue_id" >/dev/null 2>&1 || true
  done
}

# dispatch一時ディレクトリをコマンドラインに持つ今回サイクルのrenewプロセスだけを停止する。
# PID単独では再利用時に無関係プロセスを停止し得るため、verify経路と同じ所有判定を行う。
_stop_dispatch_lease_renew_daemon() {
  local renew_pid="$1" dispatch_temp_dir="$2" renew_args="" poll
  [[ "$renew_pid" =~ ^[1-9][0-9]*$ ]] || return 0
  renew_args="$(ps -p "$renew_pid" -o args= 2>/dev/null || true)"
  [[ "$renew_args" == *"$dispatch_temp_dir"* ]] || return 0

  kill "$renew_pid" >/dev/null 2>&1 || true
  wait "$renew_pid" 2>/dev/null || true
  for poll in {1..10}; do
    kill -0 "$renew_pid" >/dev/null 2>&1 || return 0
    sleep 0.2
  done
  kill -9 "$renew_pid" >/dev/null 2>&1 || true
  wait "$renew_pid" 2>/dev/null || true
  for poll in {1..10}; do
    kill -0 "$renew_pid" >/dev/null 2>&1 || return 0
    sleep 0.2
  done
}

# Issue #757: renewデーモンを新しいセッションへ切り離す起動前置詞を解決する。
# setsid(1)はutil-linux由来でmacOSには存在せず、必須にすると当該環境でdispatch経路が
# 一切使えなくなる。一方で「親セッション終了時にデーモンが道連れにならない」性質は、
# 未commitの実装が失われる実害に直結するため捨てられない。そこでsetsid(2)を直接呼べる
# perl（macOSに標準搭載）を次点に置き、どちらも無い環境ではSIGHUPの到達だけを断つnohupを
# 最後の手段とする。perl経路はforkせずexecで自プロセスを置換するため、setsid(1)の非fork
# 経路と同じく $! のPIDと「コマンドラインにdispatch一時ディレクトリが残る」性質
# （renew.pidの所有判定が依存する）を維持する。起動側はjob controlを一時停止し、バック
# グラウンドプロセスがprocess group leaderとなってsetsid(2)をEPERMにしないようにする。
# 解決結果は _ASC_SESSION_DETACH_CMD（起動前置詞の配列）と _ASC_SESSION_DETACH_MODE
# （setsid|perl|nohup）へ格納する。いずれも解決できない場合だけ1を返す。
_ASC_SESSION_DETACH_CMD=()
_ASC_SESSION_DETACH_MODE=""
_resolve_session_detach_launcher() {
  _ASC_SESSION_DETACH_CMD=()
  _ASC_SESSION_DETACH_MODE=""

  if command -v setsid >/dev/null 2>&1; then
    _ASC_SESSION_DETACH_CMD=(setsid)
    _ASC_SESSION_DETACH_MODE=setsid
    return 0
  fi

  if command -v perl >/dev/null 2>&1 && perl -MPOSIX -e 'exit(defined(&POSIX::setsid) ? 0 : 1)' >/dev/null 2>&1; then
    _ASC_SESSION_DETACH_CMD=(
      perl -MPOSIX -e
      'my $sid = POSIX::setsid(); die "setsid: $!\n" if !defined($sid) || $sid < 0; exec { $ARGV[0] } @ARGV; die "exec: $!\n";'
      --
    )
    _ASC_SESSION_DETACH_MODE=perl
    return 0
  fi

  if command -v nohup >/dev/null 2>&1; then
    _ASC_SESSION_DETACH_CMD=(nohup)
    _ASC_SESSION_DETACH_MODE=nohup
    return 0
  fi

  return 1
}

# Issue #757: macOS標準環境にはsha256sumが無いため、標準搭載のshasumへ退避する。
# 引数があればファイル、無ければstdinを処理し、promptとcontractで同じ実装を共有する。
# どちらの出力形式も先頭フィールドだけを取り出し、検証済みの小文字64桁digestへ正規化する。
_sha256_digest() {
  local input_file="${1:-}" output="" digest=""

  if command -v sha256sum >/dev/null 2>&1; then
    if [[ -n "$input_file" ]]; then
      output="$(sha256sum "$input_file")" || return 1
    else
      output="$(sha256sum)" || return 1
    fi
  elif command -v shasum >/dev/null 2>&1; then
    if [[ -n "$input_file" ]]; then
      output="$(shasum -a 256 "$input_file")" || return 1
    else
      output="$(shasum -a 256)" || return 1
    fi
  else
    printf '%s\n' 'SHA-256算出に必要なsha256sumまたはshasumが見つかりません' >&2
    return 1
  fi

  digest="${output%%[[:space:]]*}"
  [[ "$digest" =~ ^[0-9a-fA-F]{64}$ ]] || return 1
  printf '%s\n' "$digest" | tr '[:upper:]' '[:lower:]'
}

# Issue #757: dispatch監査時刻の生成と比較を、GNU/BSD dateの機能差に依存しない
# Node.jsの単一実装へ集約する。epoch-msは許可形式を先に限定し、Dateが別の日付へ
# 正規化する不正な暦日もcanonical表現との一致確認で拒否する。
_dispatch_timestamp() {
  local operation="${1:-}" value="${2:-}"

  command -v node >/dev/null 2>&1 || return 1
  node - "$operation" "$value" <<'NODE'
const operation = process.argv[2];
const value = process.argv[3];

if (operation === 'now') {
  process.stdout.write(new Date().toISOString());
  process.exit(0);
}

if (operation !== 'epoch-ms' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
  process.exit(1);
}

const epoch = Date.parse(value);
if (!Number.isFinite(epoch)) process.exit(1);
const canonical = new Date(epoch).toISOString();
const expected = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
if (canonical !== expected) process.exit(1);
process.stdout.write(String(epoch));
NODE
}

# 今回のworker起動サイクルに属する完了報告だけを検証する。
# 成功時は無出力で0、不合格時は呼び出し側がblocked_reasonへ使う理由をstdoutへ出して1を返す。
_verify_worker_completion_report() {
  local issue_id="$1" role="$2" segment="$3" started_at="$4" expected_dispatch_token="$5" started_sha="$6"
  local latest reported_status reported_sha reported_created_at reported_dispatch_token
  local reported_no_change reported_no_change_reason_present
  local current_sha started_epoch reported_epoch
  : "$role"

  if ! latest="$(_asc_cli report latest "$issue_id" "$segment")"; then
    printf '%s\n' 'workerがreportを投稿していません（契約不履行の可能性）'
    return 1
  fi

  reported_status="$(sed -n 's/^status=//p' <<<"$latest")"
  reported_sha="$(sed -n 's/^target_sha=//p' <<<"$latest")"
  reported_created_at="$(sed -n 's/^created_at=//p' <<<"$latest")"
  reported_dispatch_token="$(sed -n 's/^dispatch_token=//p' <<<"$latest")"
  reported_no_change="$(sed -n 's/^no_change=//p' <<<"$latest")"
  reported_no_change_reason_present="$(sed -n 's/^no_change_reason_present=//p' <<<"$latest")"

  if ! started_epoch="$(_dispatch_timestamp epoch-ms "$started_at" 2>/dev/null)" ||
    ! reported_epoch="$(_dispatch_timestamp epoch-ms "$reported_created_at" 2>/dev/null)"; then
    printf '%s\n' 'workerのreport鮮度を確認できませんでした（created_atまたは比較基準時刻が不正です）'
    return 1
  fi
  # Issue #658: GitHubのcreatedAtは秒精度なので、その秒内の投稿順序は確定できない。
  if [[ "$reported_created_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
    reported_epoch=$((reported_epoch + 999))
  fi
  if ((reported_epoch < started_epoch)); then
    printf '%s\n' 'workerがreportを投稿していません（契約不履行の可能性、dispatch開始前の報告のみ検出）'
    return 1
  fi

  current_sha="$(git rev-parse HEAD 2>/dev/null || echo '')"
  if [[ "$reported_status" != "completed" || -z "$reported_sha" || "$reported_sha" != "$current_sha" ]]; then
    printf 'worker完了を確認できませんでした（報告status=%s, 報告target_sha=%s, 現在HEAD=%s）\n' \
      "${reported_status:-無し}" "${reported_sha:-無し}" "${current_sha:-無し}"
    return 1
  fi

  if [[ ! "$started_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
    printf '%s\n' 'dispatch開始時点のHEADを確認できませんでした（着手時SHAが欠落または不正形式です）'
    return 1
  fi
  if [[ "$reported_sha" == "$started_sha" ]]; then
    if [[ "$reported_no_change" != "true" ]]; then
      printf '%s\n' 'dispatch開始後にcommitが追加されておらず、無変更完了も明示されていません'
      return 1
    fi
    if [[ "$reported_no_change_reason_present" != "true" ]]; then
      printf '%s\n' '無変更完了が宣言されていますが、変更不要と判断した具体的理由がありません'
      return 1
    fi
  else
    local ancestor_rc=0
    git merge-base --is-ancestor "$started_sha" "$reported_sha" 2>/dev/null || ancestor_rc=$?
    if [[ "$ancestor_rc" -eq 1 ]]; then
      printf '%s\n' 'dispatch開始時点のHEADが報告target_shaの祖先ではありません（rollback・履歴書き換えの可能性）'
      return 1
    fi
    if [[ "$ancestor_rc" -ne 0 ]]; then
      printf '%s\n' 'dispatch開始時点のHEADと報告target_shaの祖先関係を判定できませんでした'
      return 1
    fi
  fi

  if [[ -z "$expected_dispatch_token" || "$reported_dispatch_token" != "$expected_dispatch_token" ]]; then
    printf '%s\n' 'workerの報告が今回のdispatchサイクルに由来すると確認できませんでした（dispatchトークン不一致、過去サイクルの報告の可能性）'
    return 1
  fi

  return 0
}

# Agent tool呼び出しが必要な場合の前半処理。contract本文は一時ファイルだけへ書き、標準出力には
# 固定の運用指示と不透明な監査メタデータだけを返す。worker完了後の照合・lease解放は
# worker-launch-verify.shが別のBash呼び出しで行う。
_dispatch_via_agent_tool() {
  local issue_id="$1" segment="$2"

  if ! acquire_lease "$issue_id" "$segment" >/dev/null; then
    echo "launch_worker: writer lease の取得に失敗しました（wip.limit超過または既存leaseとの競合）" >&2
    return 1
  fi

  local contract role
  if ! contract="$(_asc_cli segment start "$issue_id" "$segment")"; then
    echo "launch_worker: segment start に失敗しました（role_contract取得不可）" >&2
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi
  role="$(sed -n 's/^role:[[:space:]]*//p' <<<"$contract" | head -n1)"
  if [[ -z "$role" ]]; then
    echo "launch_worker: segment start の出力から role を抽出できませんでした" >&2
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi

  # ASC_WORKER_ADAPTER（worker-launch.sh がworker.segment_overrides.<segment>.adapter →
  # worker.adapter → 既定humanから解決した値をexport、ISSUE-609）を読み、adapter別に固定
  # Claude subagentディスパッチ以外の経路へ分岐させる。claude（既定）は既存動作を変更しない
  # （AC-2、回帰無し）。codexはこの時点で_worker_default_cmdを呼び、失敗（codex CLI不在等）
  # した場合はフェイルセーフとしてlease解放のうえ即座にエラー返却する——固定Claude subagentへ
  # 無条件フォールバックすると「設定と実際の実行系が気づかれずに乖離する」という本Issueの
  # 根本原因を再発させるため（DESIGN.md「障害・ロールバック考慮」）。human・未知値はAgent tool
  # dispatchがAIによる人間判断の自動代替を行わないための防御的フェイルセーフであり、
  # human.sh は本来 claude.sh を source しないため通常この分岐へは到達しない（AC-3）。
  local worker_adapter="${ASC_WORKER_ADAPTER:-claude}"
  local codex_cmd="" codex_worktree_root="" codex_worktree_root_quoted=""
  case "$worker_adapter" in
  claude) ;;
  codex)
    # Issue #647: dispatch指示は後から別cwdで実行されるため、生成時の対象worktreeを
    # コマンド自体へ固定する。物理絶対パスをshell quoteし、空白等を含むパスも安全に扱う。
    if ! codex_worktree_root="$(git rev-parse --show-toplevel 2>/dev/null)" ||
      ! codex_worktree_root="$(cd -- "$codex_worktree_root" 2>/dev/null && pwd -P)" ||
      [[ "$codex_worktree_root" != /* ]]; then
      echo "launch_worker: Codex dispatch対象のworktree rootを絶対パスへ解決できませんでした" >&2
      release_lease "$issue_id" >/dev/null 2>&1 || true
      return 1
    fi
    printf -v codex_worktree_root_quoted '%q' "$codex_worktree_root"
    ;;
  *)
    echo "launch_worker: adapter=${worker_adapter} はAgent tool dispatch経由でAIを自動起動しません（人間判断の自動代替を避けるフェイルセーフ）" >&2
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
    ;;
  esac

  local renew_interval="${WORKER_RENEW_INTERVAL_SEC:-900}"
  local max_wait="${ASC_DISPATCH_MAX_WAIT_SEC:-14400}"
  if [[ ! "$renew_interval" =~ ^[1-9][0-9]*$ || ! "$max_wait" =~ ^[1-9][0-9]*$ ]]; then
    echo "launch_worker: dispatch lease更新間隔と最大待機時間は正の整数である必要があります" >&2
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi
  if ! _resolve_session_detach_launcher; then
    echo "launch_worker: Agent tool dispatchのrenewデーモンを親セッションから切り離す手段（setsid・perl・nohupのいずれか）が見つかりません" >&2
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi
  if [[ "$_ASC_SESSION_DETACH_MODE" == "nohup" ]]; then
    echo "launch_worker: setsid・perlがないためnohupでrenewデーモンを起動します（SIGHUPは遮断しますが新セッションへの分離は行われません）" >&2
  fi

  local temp_base="${TMPDIR:-/tmp}"
  if [[ "$temp_base" != /* ]]; then
    if ! temp_base="$(cd -- "$temp_base" 2>/dev/null && pwd)"; then
      echo "launch_worker: TMPDIRを絶対パスへ解決できませんでした" >&2
      release_lease "$issue_id" >/dev/null 2>&1 || true
      return 1
    fi
  fi

  local dispatch_temp_dir dispatch_token dispatch_started_at started_sha contract_file contract_sha contract_lines
  if ! dispatch_temp_dir="$(mktemp -d "$temp_base/agent-skill-chain-worker-dispatch.XXXXXX")"; then
    echo "launch_worker: dispatch用一時ディレクトリを作成できませんでした" >&2
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi
  if ! started_sha="$(git rev-parse HEAD 2>/dev/null)" || [[ -z "$started_sha" ]]; then
    echo "launch_worker: dispatch開始時点のHEADを取得できませんでした" >&2
    rm -rf -- "$dispatch_temp_dir"
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi
  dispatch_token="$(basename -- "$dispatch_temp_dir")"
  if ! dispatch_started_at="$(_dispatch_timestamp now)"; then
    echo "launch_worker: dispatch開始時刻を生成できませんでした" >&2
    rm -rf -- "$dispatch_temp_dir"
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi
  chmod 700 "$dispatch_temp_dir"
  # Issue #665: contract.md自体を厳密に実行するworkerへdispatchトークンを確実に渡す。
  # 監査digestは、この追記後のcontract_fileから算出する。
  contract+=$'\nworker_completion_dispatch:\n'
  contract+="  dispatch_token: ${dispatch_token}"
  contract+=$'\n'
  contract+="  instruction: 成果物をcommit・pushした後のcompleted投稿では、既存の5引数に空文字2つとdispatchトークンを追加し、report-status.sh <issue_id> <role> <segment> completed <push済みHEAD> '' '' ${dispatch_token} の形で実行する。変更が無い場合のみ、9・10番目の引数として true と具体的理由を追加し、report-status.sh <issue_id> <role> <segment> completed <push済みHEAD> '' '' ${dispatch_token} true '<具体的理由>' の形で実行する。"
  contract+=$'\n'

  contract_file="$dispatch_temp_dir/contract.md"
  printf '%s' "$contract" >"$contract_file"
  chmod 600 "$contract_file"
  if ! contract_sha="$(_sha256_digest "$contract_file")"; then
    echo "launch_worker: contractのSHA-256を算出できませんでした（sha256sumまたはshasumが必要です）" >&2
    rm -rf -- "$dispatch_temp_dir"
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi
  contract_lines="$(wc -l <"$contract_file" | tr -d '[:space:]')"
  printf 'CONTRACT_SHA256=%s\nCONTRACT_LINES=%s\nDISPATCH_STARTED_AT=%s\nDISPATCH_TOKEN=%s\nSTARTED_SHA=%s\n' \
    "$contract_sha" "$contract_lines" "$dispatch_started_at" "$dispatch_token" "$started_sha" \
    >"$dispatch_temp_dir/contract.sha256"
  chmod 600 "$dispatch_temp_dir/contract.sha256"

  local monitor_was_enabled=false renew_pid renew_ready_pid="" renew_poll renew_started=false
  [[ $- == *m* ]] && monitor_was_enabled=true
  [[ "$monitor_was_enabled" == "false" ]] || set +m
  "${_ASC_SESSION_DETACH_CMD[@]}" bash -c \
    'source "$1"; _dispatch_lease_renew_daemon "$2" "$3" "$4" "$5" "$6"' \
    _ "$ADAPTER_DIR/claude.sh" "$issue_id" "$dispatch_temp_dir" "$renew_interval" "$max_wait" \
    "$_ASC_SESSION_DETACH_MODE" \
    </dev/null >/dev/null 2>&1 &
  renew_pid=$!
  [[ "$monitor_was_enabled" == "false" ]] || set -m

  for renew_poll in {1..100}; do
    if [[ -f "$dispatch_temp_dir/renew.ready" ]]; then
      renew_ready_pid="$(tr -d '[:space:]' <"$dispatch_temp_dir/renew.ready")"
      if [[ "$renew_ready_pid" == "$renew_pid" ]] && kill -0 "$renew_pid" >/dev/null 2>&1; then
        renew_started=true
        break
      fi
    fi
    kill -0 "$renew_pid" >/dev/null 2>&1 || break
    sleep 0.02
  done
  rm -f -- "$dispatch_temp_dir/renew.ready"
  if [[ "$renew_started" != "true" ]]; then
    _stop_dispatch_lease_renew_daemon "$renew_pid" "$dispatch_temp_dir"
    echo "launch_worker: Agent tool dispatchのrenewデーモンを安全に起動できませんでした（セッション分離または起動確認に失敗しました）" >&2
    rm -rf -- "$dispatch_temp_dir"
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi
  printf '%s\n' "$renew_pid" >"$dispatch_temp_dir/renew.pid"
  chmod 600 "$dispatch_temp_dir/renew.pid"
  disown "$renew_pid" 2>/dev/null || true

  local contract_file_quoted dispatch_temp_dir_quoted
  printf -v contract_file_quoted '%q' "$contract_file"
  printf -v dispatch_temp_dir_quoted '%q' "$dispatch_temp_dir"

  if [[ "$worker_adapter" == "codex" ]]; then
    # Issue #721: 小さいcontractはstdin redirect、大きいcontractは実行時にcontract.mdを読み込む
    # 位置引数とし、どちらも起動コマンド文字列へ本文を埋め込まない。
    if ! codex_cmd="$(_worker_default_cmd "$segment" "$contract" "$contract_file")"; then
      _stop_dispatch_lease_renew_daemon "$renew_pid" "$dispatch_temp_dir"
      echo "launch_worker: Codex起動コマンドを組み立てられませんでした（codex CLI不在等）。固定Claude subagentへのフォールバックは行いません" >&2
      rm -rf -- "$dispatch_temp_dir"
      release_lease "$issue_id" >/dev/null 2>&1 || true
      return 1
    fi
    codex_cmd="cd ${codex_worktree_root_quoted} && ${codex_cmd}"

    # 提示前の最終防護。失敗時はrenew停止→一時資源削除→lease解放の順で安全側へ倒す。
    if ! bash -n <<<"$codex_cmd"; then
      _stop_dispatch_lease_renew_daemon "$renew_pid" "$dispatch_temp_dir"
      rm -rf -- "$dispatch_temp_dir"
      release_lease "$issue_id" >/dev/null 2>&1 || true
      echo "launch_worker: Codex起動コマンドのシェル構文が妥当でないため、ワーカーを起動せず停止しました" >&2
      return 5
    fi
    printf '%s\n' \
      'AGENT_TOOL_DISPATCH_REQUIRED' \
      'dispatch_mode: bash_direct' \
      'run_in_background: false' \
      "prompt: 固定のAgent tool subagent（agent-skill-chain-worker）へは委譲せず、行頭プレフィックス CODEX_CMD= の唯一の正本行からコマンドを抽出し、Bashツールで直接実行する。workerは成果物をcommit・pushした後、contractに記載されたreport-status.shによるcompleted投稿を実行してから最終応答する。今回のdispatchトークンは ${dispatch_token}。completed投稿では既存の5引数に空文字2つとdispatchトークンを追加し、report-status.sh <issue_id> <role> <segment> completed <push済みHEAD> '' '' ${dispatch_token} の形で実行する。変更が無い場合のみ、9・10番目の引数として true と具体的理由を追加し、report-status.sh <issue_id> <role> <segment> completed <push済みHEAD> '' '' ${dispatch_token} true '<具体的理由>' の形で実行する。最終応答は完了状態・target_sha・簡潔な1文要約のみに限定し、成果物本文・diff・引用等の実質的内容を一切含めない。" \
      "完了後に .agent-skill-chain/scripts/worker-launch-verify.sh ${issue_id} ${dispatch_temp_dir_quoted} をBashツールで実行する。" \
      "ISSUE_ID=${issue_id}" \
      "DISPATCH_TEMP_DIR=${dispatch_temp_dir}" \
      "CONTRACT_SHA256=${contract_sha}" \
      "CONTRACT_LINES=${contract_lines}" \
      "CODEX_CMD=${codex_cmd}"
    return 4
  fi

  printf '%s\n' \
    'AGENT_TOOL_DISPATCH_REQUIRED' \
    'subagent_type: agent-skill-chain-worker' \
    'run_in_background: false' \
    "prompt: 指定ファイルをBashツールで cat -- ${contract_file_quoted} として読み、その標準出力全体を一切要約・改変せず動作契約として厳密に実行する。workerは成果物をcommit・pushした後、contractに記載されたreport-status.shによるcompleted投稿を実行してから最終応答する。今回のdispatchトークンは ${dispatch_token}。completed投稿では既存の5引数に空文字2つとdispatchトークンを追加し、report-status.sh <issue_id> <role> <segment> completed <push済みHEAD> '' '' ${dispatch_token} の形で実行する。変更が無い場合のみ、9・10番目の引数として true と具体的理由を追加し、report-status.sh <issue_id> <role> <segment> completed <push済みHEAD> '' '' ${dispatch_token} true '<具体的理由>' の形で実行する。作業完了後の最終応答は完了状態・target_sha・簡潔な1文要約のみに限定し、成果物本文・diff・引用等の実質的内容を一切含めない。" \
    "完了後に .agent-skill-chain/scripts/worker-launch-verify.sh ${issue_id} ${dispatch_temp_dir_quoted} をBashツールで実行する。" \
    "ISSUE_ID=${issue_id}" \
    "DISPATCH_TEMP_DIR=${dispatch_temp_dir}" \
    "CONTRACT_SHA256=${contract_sha}" \
    "CONTRACT_LINES=${contract_lines}"
  return 4
}

# WORKER_CMD 未指定時の既定起動コマンドを返す。Codex adapter は同名関数を再定義し、
# 取り込んだ共通 lifecycle から動的束縛で Codex 固有のコマンド組み立てへ差し替える。
# 引数: <segment> <contract>
_worker_default_cmd() {
  local _segment="${1:-}" _contract="${2:-}"
  : "$_segment" "$_contract"

  # launch_gate_reviewer と同じ解決順序（Issue #550: ここだけ claude 固定参照だと
  # CLAUDE_EXECUTABLE のみでPATH上に claude が無い環境で worker だけ非対称に blocked へ倒れる）。
  local claude_executable="${CLAUDE_EXECUTABLE:-claude}"
  if ! command -v "$claude_executable" >/dev/null 2>&1; then
    return 1
  fi

  local worker_allowed_tools="${WORKER_ALLOWED_TOOLS:-$WORKER_ALLOWED_TOOLS_DEFAULT}"
  local quoted_executable
  printf -v quoted_executable '%q' "$claude_executable"
  printf '%s -p --output-format text --allowed-tools "%s"\n' "$quoted_executable" "$worker_allowed_tools"
}

# 引数: <issue_id> <segment>
# 終了コード: 0=worker完了 / 2（!=0,!=3）=error（blocked報告・lease解放済み）/
#             1=引数・lease取得前のエラー（lease未取得または解放済み、report未発行）/
#             4=dispatch_required（lease保持中、進行役によるAgent tool呼び出し待ち）。
# env: ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN（認証、高速パス、実値非ログ出力）、
#      CLAUDE_AUTH_PROBE_CMD | CLAUDE_AUTH_PROBE_TIMEOUT_SEC（認証の実疎通フォールバック、_claude_auth_ok参照）、
#      WORKER_CMD（起動系上書き。テストではecho等のモックコマンドに完全差し替え可能）、
#      WORKER_ALLOWED_TOOLS（WORKER_CMD未指定時の既定claude起動が使う --allowed-tools 値の上書き。
#      既定は WORKER_ALLOWED_TOOLS_DEFAULT、ワーカーの正規責務範囲に限定したallowlist）、
#      WORKER_TIMEOUT_SEC（既定1800）、WORKER_RENEW_INTERVAL_SEC（leaseのrenewループ間隔、既定900）。
launch_worker() {
  local issue_id="${1:-}" segment="${2:-}"

  if [[ -z "$issue_id" || -z "$segment" ]]; then
    echo "launch_worker: 引数 <issue_id> <segment> が必要です" >&2
    return 1
  fi
  case "$segment" in
    spec | design | implementation | validation) ;;
    *)
      echo "launch_worker: segment は spec|design|implementation|validation のいずれかである必要があります: $segment" >&2
      return 1
      ;;
  esac

  if [[ "${ASC_AGENT_TOOL_DISPATCH:-false}" == "true" ]] && _orchestrator_is_claude_code_cli_session; then
    _dispatch_via_agent_tool "$issue_id" "$segment"
    return
  fi

  # 1. lease取得。失敗時はまだ何も起動していないため blocked報告なしで即 return 1
  #    （AC-2: wip.limit超過・同issue内他segment競合・同一segment競合はいずれもここで拒否される。
  #    launch_worker自身はWIP判定・コンフリクト判定を独自に持たず lease acquire の結果を信頼する）。
  if ! acquire_lease "$issue_id" "$segment" >/dev/null; then
    echo "launch_worker: writer lease の取得に失敗しました（wip.limit超過または既存leaseとの競合）" >&2
    return 1
  fi

  # 2. segment start（role_contract取得。lease有効性の再検証を兼ねる）。
  #    失敗時は起動前のため worker-report は書かず lease解放のみ行う。
  local contract role
  if ! contract="$(_asc_cli segment start "$issue_id" "$segment")"; then
    echo "launch_worker: segment start に失敗しました（role_contract取得不可）" >&2
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi
  role="$(sed -n 's/^role:[[:space:]]*//p' <<<"$contract" | head -n1)"
  if [[ -z "$role" ]]; then
    echo "launch_worker: segment start の出力から role を抽出できませんでした" >&2
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi

  # 3. 起動後のフェイルセーフ（I8）: blocked報告 + lease解放 + 非0非3で返す共通処理。
  _fail_blocked() {
    local reason="$1" sha
    echo "launch_worker: ${reason}（フェイルセーフでblockedへ倒します）" >&2
    sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
    report_status "$issue_id" "$role" "$segment" blocked "$sha" "$reason" true >/dev/null 2>&1 || true
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 2
  }

  # 認証（実値はログ・stdoutに出さない）。env非空の高速パス→claude auth statusの実疎通フォールバック
  # の2段判定（Issue #185 _claude_auth_ok）。真に認証が欠如している場合のみフェイルセーフする。
  if ! _claude_auth_ok; then
    _fail_blocked "認証情報が未設定かつ実疎通確認にも失敗しました（env未設定・claude auth status失敗/不在）"
    return
  fi

  local dispatch_token_path dispatch_token worker_started_at started_sha
  if ! dispatch_token_path="$(mktemp -u "${TMPDIR:-/tmp}/agent-skill-chain-worker-dispatch.XXXXXX")"; then
    _fail_blocked "dispatchトークンを生成できませんでした"
    return
  fi
  dispatch_token="$(basename -- "$dispatch_token_path")"
  if ! worker_started_at="$(_dispatch_timestamp now)"; then
    _fail_blocked "worker開始時刻を生成できませんでした"
    return
  fi
  if ! started_sha="$(git rev-parse HEAD 2>/dev/null)" || [[ -z "$started_sha" ]]; then
    _fail_blocked "dispatch開始時点のHEADを取得できませんでした"
    return
  fi
  contract+=$'\nworker_completion_dispatch:\n'
  contract+="  dispatch_token: ${dispatch_token}"
  contract+=$'\n'
  contract+="  instruction: 成果物をcommit・pushした後のcompleted投稿では、既存の5引数に空文字2つとdispatchトークンを追加し、report-status.sh <issue_id> <role> <segment> completed <push済みHEAD> '' '' ${dispatch_token} の形で実行する。変更が無い場合のみ、9・10番目の引数として true と具体的理由を追加し、report-status.sh <issue_id> <role> <segment> completed <push済みHEAD> '' '' ${dispatch_token} true '<具体的理由>' の形で実行する。"
  contract+=$'\n'

  # 起動系。WORKER_CMD で上書き可能（テスト用モック境界）。既定は claude CLI headless を
  # --allowed-tools（責務スコープ allowlist、WORKER_ALLOWED_TOOLS）で起動する。無制限自動承認
  # （--permission-mode bypassPermissions）・編集のみ自動承認（acceptEdits、Bashは都度承認＝
  # ヘッドレスで事実上停止）のいずれも既定に用いない——既定は「列挙外は拒否」の安全側 fail を
  # 保ったまま、ワーカーの正規責務範囲（自branchへのcommit/push・Draft PR作成・テスト実行・
  # report/lease/checkpoint各スクリプト実行・自worktree内ファイル編集）だけを非対話で完走できる
  # ようにする（DESIGN.md（ISSUE-183）「採用案 候補A」）。
  local worker_cmd="${WORKER_CMD:-}"
  if [[ -z "$worker_cmd" ]]; then
    if ! worker_cmd="$(_worker_default_cmd "$segment" "$contract")"; then
      _fail_blocked "worker既定起動コマンドを組み立てられず WORKER_CMD も未設定です"
      return
    fi
  fi

  local timeout_sec="${WORKER_TIMEOUT_SEC:-1800}"
  local renew_interval="${WORKER_RENEW_INTERVAL_SEC:-900}"

  # role_contract全文をプロンプトとしてstdin経由で渡す（唯一の正規契約伝達経路。AC-3）。
  # ASC_ISSUE_ID/ASC_SEGMENT/ASC_ROLE/ASC_DISPATCH_TOKEN は worker_cmd 実装（テスト用stub含む）の便宜のためのenvであり、
  # 契約の内容自体はstdinのrole_contractに完全に含まれる。
  local prompt_file
  prompt_file="$(mktemp)"
  printf '%s' "$contract" >"$prompt_file"

  local worker_pid rc
  if command -v timeout >/dev/null 2>&1; then
    ASC_ISSUE_ID="$issue_id" ASC_SEGMENT="$segment" ASC_ROLE="$role" ASC_DISPATCH_TOKEN="$dispatch_token" \
      timeout "$timeout_sec" bash -c "$worker_cmd" <"$prompt_file" &
  else
    ASC_ISSUE_ID="$issue_id" ASC_SEGMENT="$segment" ASC_ROLE="$role" ASC_DISPATCH_TOKEN="$dispatch_token" \
      bash -c "$worker_cmd" <"$prompt_file" &
  fi
  worker_pid=$!

  # renewループ: サブプロセス生存中のみ renewal_interval_seconds ごとに renew_lease を呼ぶ。
  # 待機は sleep を明示的な子プロセスとして起動し wait で待つ（_dispatch_lease_renew_daemon と
  # 同じパターン）。/dev/nullへリダイレクトした read -t はEOFへ即時到達し待機せず返るため、
  # renewal_interval分の待機が働かずbusy-loop化してしまい使えない（Issue #546）。SIGTERM
  # （後述のkill "$renew_pid"）受信時は子のsleepも停止させ、孤児プロセスを残さない。
  (
    trap '
      if [[ -n "$renew_wait_pid" ]]; then
        kill "$renew_wait_pid" >/dev/null 2>&1 || true
        wait "$renew_wait_pid" 2>/dev/null || true
      fi
      exit 0
    ' TERM INT HUP
    renew_wait_pid=""
    while kill -0 "$worker_pid" 2>/dev/null; do
      sleep "$renew_interval" &
      renew_wait_pid=$!
      wait "$renew_wait_pid" || break
      renew_wait_pid=""
      kill -0 "$worker_pid" 2>/dev/null || break
      renew_lease "$issue_id" >/dev/null 2>&1 || true
    done
  ) &
  local renew_pid=$!

  wait "$worker_pid"
  rc=$?
  kill "$renew_pid" >/dev/null 2>&1 || true
  wait "$renew_pid" 2>/dev/null || true
  rm -f "$prompt_file"

  if [[ $rc -ne 0 ]]; then
    _fail_blocked "worker起動が失敗またはtimeoutしました（rc=$rc, timeout=${timeout_sec}s）"
    return
  fi

  # サブプロセスの終了コード0だけでは信頼せず、今回の起動以降に投稿された完了報告を検証する。
  local completion_reason
  if ! completion_reason="$(_verify_worker_completion_report "$issue_id" "$role" "$segment" "$worker_started_at" "$dispatch_token" "$started_sha")"; then
    _fail_blocked "$completion_reason"
    return
  fi

  release_lease "$issue_id" >/dev/null 2>&1 || true
  return 0
}
