#!/usr/bin/env bash
# 正本: AGENTS.md §GitHub配布・マルチAI対応 / .agent-skill-chain/config/roles.yaml
#
# ベンダー中立の role contract（.agent-skill-chain/config/roles.yaml）を実行系（人間オペレータへの通知・手動報告待ち）へ
# 変換するアダプタ。lease・commit・test・report等の状態操作系関数はgit/gh状態への機械操作であり
# 人間オペレータが実行する場合もclaude.sh/codex.shと同じ.agent-skill-chain/scripts/*.sh
# （agent-skill-chainCLIへの薄いラッパー）へ結線する。人間固有の差分が生じるのは launch_gate_reviewer
# （実際の判定を人間へ委ねる部分）であり、これは「自動実行」ではなく「人間への通知発行・非同期の
# 手動報告待ち」へ結線される（launch_worker 相当は別途設計が必要なため対象外）。

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

# --- human.sh 固有の差分: ゲートレビュア起動（非同期・deferred） ---
#
# 人間レビュアは同期起動できない。GitHub Actions の job 内で人間判断を無期限にブロックすると
# runner を占有しタイムアウトで赤になるため、本アダプタは (1) 人間へ通知を発行し、(2) gate-report を
# final=human_required にして、(3) deferred として exit 3 を返す（CI は同期待ちしない）。
# 呼び出し側（gate.yml 判定ステップ）は exit 3 を受けて action_required を発行し merge をブロックする。
# 人間が out-of-band でレビューし verdict を提出→workflow を re-dispatch すると success/failure へ反転する。
# I8: silent pass しない（未通知でも final=human_required＝approve へ倒さない）。
#
# 引数: <issue_id> <gate_id> <profile> <gate_report_path> <target_sha>
# 終了コード: 3=deferred（正常系。error ではない）/ 1=引数・前提エラー。
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

  # backend / issue 番号を解決する。
  local ctx backend issue_number
  ctx="$(_asc_cli gate reviewer-context "$issue_id")" || {
    echo "launch_gate_reviewer: reviewer-context の解決に失敗しました" >&2
    return 1
  }
  backend="$(sed -n 's/^backend=//p' <<<"$ctx")"
  issue_number="$(sed -n 's/^issue_number=//p' <<<"$ctx")"

  # 通知本文（必須フィールド: issue / gate / target_sha / report_path / レビュー手順 / verdict 提出方法）。
  local body
  body="$(
    cat <<EOF
[agent-skill-chain] ${gate_id} ゲートは人間レビューを待っています（awaiting-human）。

- issue: ${issue_id}
- gate: ${gate_id}
- profile: ${profile}
- target_sha: ${target_sha}
- gate_report_path: ${report_path}

レビュー手順:
  1. 対象セグメントの成果物を read-only で確認する。
  2. conformance（立証: 全 AC-ID の証跡）と falsification（反証: 反例探索）を判定する。
  3. verdict（conformance/falsification/blockers[origin付き]）を確定する。

verdict 提出方法:
  判定済み gate-report を書き込み（agent-skill-chain gate record-verdict "${report_path}" に verdict JSON を stdin で渡す）、
  この PR へ再度 push するか workflow を re-dispatch する。ゲートは verdict 提出まで action_required（merge blocked）のまま。
EOF
  )"

  if [[ "$backend" == "github" ]] && command -v gh >/dev/null 2>&1; then
    # 通知ラベルを用意し（冪等）、コメントで人間へ通知する。ラベル付与・失敗は非致命（best-effort）。
    gh label create "gate:${gate_id}:awaiting-human" >/dev/null 2>&1 || true
    gh issue edit "$issue_number" --add-label "gate:${gate_id}:awaiting-human" >/dev/null 2>&1 || true
    if ! gh issue comment "$issue_number" --body "$body" >/dev/null 2>&1; then
      echo "launch_gate_reviewer: gh issue comment に失敗しました（通知未達）。silent pass せず human_required のまま deferred します" >&2
    fi
  else
    # ローカルモード（または gh 不在）: pending マーカー + 指示を出力する。
    local marker="${report_path%.yaml}.awaiting-human"
    printf '%s\n' "$body" >"$marker"
    printf '%s\n' "$body"
  fi

  # gate-report を final=human_required にし（silent pass 禁止）、deferred(exit 3) を返す。
  _asc_cli gate mark-human-required "$report_path" >/dev/null || {
    echo "launch_gate_reviewer: final=human_required の書込みに失敗しました" >&2
    return 1
  }
  return 3
}
