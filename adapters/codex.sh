#!/usr/bin/env bash
# 正本: AGENTS.md §GitHub配布・マルチAI対応 / config/roles.yaml / memo/システム刷新/システム刷新.md §A-4, §A-10
#
# ベンダー中立の role contract（config/roles.yaml）を実行系（OpenAI Codex CLI 等経由の起動）へ
# 変換するアダプタのインターフェース定義。各関数は scripts/*.sh の実スクリプト（未実装）を呼び出す
# スタブであり、実処理は行わない。scripts/*.sh 実装後、各関数の中身をそれらの呼び出しに置き換える。
#
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

# writer lease を取得する。config/agent-skill-chain.yaml の lease.ttl_seconds を用いる想定。
# 引数: issue_id, segment
acquire_lease() {
  echo "not implemented: scripts/lease-acquire.sh" >&2
  exit 1
}

# 保持中の writer lease を延長する。config/agent-skill-chain.yaml の lease.renewal_interval_seconds を用いる想定。
# 引数: issue_id, token
renew_lease() {
  echo "not implemented: scripts/lease-renew.sh" >&2
  exit 1
}

# 保持中の writer lease を解放する。
# 引数: issue_id, token
release_lease() {
  echo "not implemented: scripts/lease-release.sh" >&2
  exit 1
}

# 自ブランチへ commit・push する（自ブランチ以外への書込みは禁止）。
# 引数: message
commit_and_push() {
  echo "not implemented: scripts/commit-and-push.sh" >&2
  exit 1
}

# テストを実行する（常時必須／変更内容別必須のテストは standards/TEST_POLICY.md 参照）。
run_tests() {
  echo "not implemented: scripts/run-tests.sh" >&2
  exit 1
}

# Integration Record を更新する。GitHubモード=Draft PR、ローカルモード=Integration Record
# （schemas/integration.schema.yaml）。
update_integration_record() {
  echo "not implemented: scripts/integration-record-update.sh" >&2
  exit 1
}

# 完了・blocked を固定スキーマ（schemas/worker-report.schema.yaml）で進行役へ報告する。
report_status() {
  echo "not implemented: scripts/report-status.sh" >&2
  exit 1
}

# --- codex.sh 固有の差分 ---
# 本アダプタは OpenAI Codex CLI 等、Claude 系以外の実行系経由でのワーカー・ゲートレビュア起動を想定する。
# 起動系は scripts/*.sh の実装完了後にここへ結線する。
