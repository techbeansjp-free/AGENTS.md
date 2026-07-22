#!/usr/bin/env bash
# 正本: AGENTS.md §GitHub配布・マルチAI対応 / .agent-skill-chain/config/roles.yaml
#
# ベンダー中立の role contract（.agent-skill-chain/config/roles.yaml）を実行系（OpenAI Codex CLI 等経由の起動）へ
# 変換するアダプタ。lease・commit・test・report等の状態操作系関数は .agent-skill-chain/scripts/*.sh
# （agent-skill-chain CLIへの薄いラッパー）へ結線済み。ゲートレビュアの起動 launch_gate_reviewer・
# セグメント作業ワーカーの起動 launch_worker（#166）はいずれも claude/human と同一シグネチャの
# I/F のみ実装済み（Codex 実行系の具体起動は要別途決定。未構成時は fail-safe deferral を返す）。

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

# --- codex.sh 固有の差分: ゲートレビュア起動（I/F パリティ・fail-safe deferral） ---
#
# claude/human と同一シグネチャの launch_gate_reviewer を提供する。ただし Codex 実行系の具体起動
# （CLI/API・認証 OPENAI_API_KEY・read-only ツール制約）は要別途決定のため未実装であり、現時点では
# 未構成として扱う。
# I8 安全側ラチェット: 未構成は決して silent pass（approve/success）しない。必ず final=human_required を
# 書いて非ゼロ（!=3）で返す＝action_required（merge blocked・要人間確認）へ倒す。
#
# 【将来の拡張ポイント】Codex 実行系を結線する際は、この関数内の「未構成 fail-safe」ブロックを、
# claude.sh:launch_gate_reviewer と同じ「read-only レビュア起動→verdict を record-verdict へ結線」
# 構造へ置き換える（レビュアには書込みツールを与えず、gate-report 書込みは trusted CLI に限定する）。
#
# 引数: <issue_id> <gate_id> <profile> <gate_report_path> <target_sha>
# 終了コード: 2（!=0,!=3）=error（final=human_required 書込み後）/ 1=引数・前提エラー。
# env: OPENAI_API_KEY（Codex 認証。将来の具体起動で使用）。
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

  # 未構成 fail-safe（I8）: Codex 実行系が未確定のため必ず human_required へ倒す（silent pass 禁止）。
  echo "launch_gate_reviewer: codex レビュア実行系は未構成です（要別途決定）。フェイルセーフで human_required へ倒します" >&2
  _asc_cli gate mark-human-required "$report_path" >/dev/null || true
  return 2
}

# --- codex.sh 固有の差分: セグメント作業ワーカー起動（launch_worker、fail-safe deferral、#166・AC-5） ---
#
# claude/human と同一シグネチャの launch_worker を提供する。ただし Codex 実行系の具体起動
# （CLI/API・認証 OPENAI_API_KEY・書込み許可の範囲）は要別途決定のため未実装であり、現時点では
# 未構成として扱う。
#
# 【lease取得を一切試みない】: Codex 実行系は未構成で必ず失敗するとわかっているため、
# writer lease を取得してから失敗させると（a) WIP枠（wip.limit）を無駄に消費し、
# (b) 解放処理が余計に発生するだけで得るものが無い。よって claude.sh/human.sh と異なり
# acquire_lease を呼ばず、引数検証の直後に即座に未構成であることを表明して return する
# （DESIGN.md「codex adapter」節参照）。
#
# I8 安全側ラチェット: 未構成は決して silent pass（0 や 3 を装う）しない。必ず非ゼロ（!=0,!=3）で
# 返す＝呼び出し側（進行役）が機械的に「起動できていない」と判別できる状態にする。
#
# 【将来の拡張ポイント】Codex 実行系を結線する際は、この関数内の「未構成 fail-safe」ブロックを、
# claude.sh:launch_worker と同じ「lease取得→segment start→起動（timeout+renewループ）→
# 完了確認（report-status直近レコードとtarget_sha突合）→解放/blocked報告」構造へ置き換える
# （書込み許可の範囲・認証 OPENAI_API_KEY の扱いは実装時に確定する）。
#
# 引数: <issue_id> <segment>
# 終了コード: 2（!=0,!=3）=error（未構成。lease取得前のため report_status/release_lease 対象無し）/
#             1=引数エラー。
# env: OPENAI_API_KEY（Codex 認証。将来の具体起動で使用）。
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

  echo "launch_worker: codex ワーカー実行系は未構成です（要別途決定）。lease取得前にフェイルセーフで倒します（silent passしません）" >&2
  return 2
}
