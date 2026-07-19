#!/usr/bin/env bash
# 正本: AGENTS.md §GitHub配布・マルチAI対応 / .agent-skill-chain/config/roles.yaml
#
# ベンダー中立の role contract（.agent-skill-chain/config/roles.yaml）を実行系（Claude Code / Claude Agent SDK 経由の起動）へ
# 変換するアダプタ。lease・commit・test・report等の状態操作系関数は .agent-skill-chain/scripts/*.sh
# （agent-skill-chain CLIへの薄いラッパー）へ結線済み。ゲートレビュアの起動は launch_gate_reviewer
# として実装済み（ワーカー起動 launch_worker 相当は別途設計・実装が必要なため対象外）。

set -euo pipefail

ADAPTER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SCRIPTS_DIR="$ADAPTER_DIR/../scripts"
REPO_ROOT="$(cd -- "$ADAPTER_DIR/../.." &>/dev/null && pwd)"

# agent-skill-chain CLI を解決して実行する（.agent-skill-chain/scripts/gate-*.sh と同じ優先順位）。
_asc_cli() {
  if [[ -f "$REPO_ROOT/bin/agents-md.js" ]]; then
    node "$REPO_ROOT/bin/agents-md.js" "$@"
  elif [[ -x "$REPO_ROOT/node_modules/.bin/agent-skill-chain" ]]; then
    "$REPO_ROOT/node_modules/.bin/agent-skill-chain" "$@"
  elif command -v agent-skill-chain >/dev/null 2>&1; then
    agent-skill-chain "$@"
  else
    echo "agent-skill-chain CLI が見つかりません（bin/agents-md.js 未ビルド、node_modules/.bin/agent-skill-chain 不在、PATH上にも無し）。" >&2
    return 1
  fi
}

# writer lease を取得する。.agent-skill-chain/config/agent-skill-chain.yaml の lease.ttl_seconds を用いる。
# 引数: issue_id, segment
acquire_lease() {
  "$SCRIPTS_DIR/lease-acquire.sh" "$@"
}

# 保持中の writer lease を延長する。.agent-skill-chain/config/agent-skill-chain.yaml の lease.renewal_interval_seconds を用いる。
# 引数: issue_id, token
renew_lease() {
  "$SCRIPTS_DIR/lease-renew.sh" "$@"
}

# 保持中の writer lease を解放する。
# 引数: issue_id, token
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
# I8 安全側ラチェット: 認証未設定・CLI 不在・起動失敗・timeout・verdict 空・結線失敗はいずれも
#   final=human_required を書いて非ゼロ（!=3）で返す（決して approve/success へ倒さない）。
# 認証情報（ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN）は実値をログ・stdout に出さない。
#
# 引数: <issue_id> <gate_id> <profile> <gate_report_path> <target_sha>
# 終了コード: 0=判定完了 / 2（!=0,!=3）=error（final=human_required 書込み後）。
# env: ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN（認証）、GATE_REVIEWER_CMD（レビュア実行系の上書き）、
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

  # 認証（実値はログ・stdout に出さない）。未設定はフェイルセーフ。
  if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
    _fail_safe "認証情報（ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN）が未設定です"
    return
  fi

  # レビュア実行系。GATE_REVIEWER_CMD で上書き可能。既定は claude CLI headless（無ツール＝read-only）。
  local reviewer_cmd="${GATE_REVIEWER_CMD:-}"
  if [[ -z "$reviewer_cmd" ]]; then
    if command -v claude >/dev/null 2>&1; then
      reviewer_cmd="claude -p --output-format text --allowed-tools ''"
    else
      _fail_safe "claude CLI が見つからず GATE_REVIEWER_CMD も未設定です"
      return
    fi
  fi

  # 判定プロンプト（ルーブリック・出力契約）を組み立てる。
  local prompt
  if ! prompt="$(_asc_cli gate reviewer-prompt "$issue_id" "$gate_id" "$target_sha")"; then
    _fail_safe "判定プロンプトの生成に失敗しました"
    return
  fi

  # 判定対象成果物の base_dir を解決（approved_artifacts の digest 算出に使う）。
  local base_dir
  base_dir="$(_asc_cli gate reviewer-context "$issue_id" | sed -n 's/^base_dir=//p')"

  local timeout_sec="${GATE_REVIEWER_TIMEOUT_SEC:-900}"
  local retries="${GATE_REVIEWER_RETRIES:-3}"
  local interval="${GATE_REVIEWER_RETRY_INTERVAL_SEC:-30}"

  # read-only レビュア起動（プロンプトは stdin）。一時障害はリトライ、timeout は打ち切り。
  local attempt=1 verdict rc
  while ((attempt <= retries)); do
    verdict=""
    rc=0
    if command -v timeout >/dev/null 2>&1; then
      verdict="$(printf '%s' "$prompt" | timeout "$timeout_sec" bash -c "$reviewer_cmd" 2>/dev/null)" || rc=$?
    else
      verdict="$(printf '%s' "$prompt" | bash -c "$reviewer_cmd" 2>/dev/null)" || rc=$?
    fi
    if [[ $rc -eq 0 && -n "$verdict" ]]; then
      break
    fi
    ((attempt++))
    if ((attempt <= retries)); then sleep "$interval"; fi
  done

  if [[ ${rc:-1} -ne 0 || -z "${verdict:-}" ]]; then
    _fail_safe "レビュア起動に失敗しました（rc=${rc:-1}, attempts=$retries）"
    return
  fi

  # verdict を gate-report へ結線（書込みは trusted CLI のみ）。
  if ! printf '%s' "$verdict" | _asc_cli gate record-verdict "$report_path" "$base_dir" >/dev/null; then
    _fail_safe "verdict の gate-report への結線に失敗しました"
    return
  fi
  return 0
}
