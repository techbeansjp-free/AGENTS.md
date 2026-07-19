#!/usr/bin/env bash
# 正本: AGENTS.md §GitHub配布・マルチAI対応 / config/agent-skill-chain.yaml の
#       templates.github_source・templates.github_target・templates.verify_sync
#
# templates/github/.github/（配布元の正本）と対象リポジトリの .github/（展開結果）が
# 同期しているかを検査する。
#
# スタブ: 実処理は将来 `agent-skill-chain verify template-sync`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する
# （CI上で「検査未実装なのに緑」という誤った安全信号を出さないため、終了コード1で失敗する）。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: verify-template-sync.sh [repo_root]

repo_root: 検査対象リポジトリのルートパス。省略時はカレントディレクトリを対象とする。

config/agent-skill-chain.yaml の templates.github_source（配布元の正本）と
templates.github_target（対象リポジトリ側の展開結果）を比較し、両者が
同期しているかを検査する。

終了コード:
  0: .github/ は templates/github/.github/ と同期
  1: .github/ は未同期（差分あり）、またはスタブ未実装
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain verify template-sync（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
