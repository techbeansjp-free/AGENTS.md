#!/usr/bin/env bash
# 正本: AGENTS.md §4セグメント・4ゲート / config/roles.yaml role_contracts
#
# 進行役が次セグメントのワーカーを起動する。config/roles.yaml の role_contracts に基づく
# 入出力契約（inputs/outputs/rules/completion/forbidden）をワーカーへ渡す。
#
# スタブ: 実処理は将来 `agent-skill-chain segment start`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: segment-start.sh <issue_id> <segment>

issue_id: ISSUE-<番号> 形式のIssue ID
segment:  spec|design|implementation|validation

出力:
  成功時: 終了コード0。起動したワーカーの役割名・role_contractを標準出力へ。
  失敗時: 終了コード1以上。writer lease未取得等の理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain segment start（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
