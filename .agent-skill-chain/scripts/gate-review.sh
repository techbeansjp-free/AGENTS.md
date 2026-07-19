#!/usr/bin/env bash
# 正本: AGENTS.md §4セグメント・4ゲート / .agent-skill-chain/config/agent-skill-chain.yaml review.* / .agent-skill-chain/schemas/gate-report.schema.yaml
#
# ゲートレビュア（conformance/falsification、Standardは1体・Strictは専任2体）を起動し、
# .agent-skill-chain/schemas/gate-report.schema.yaml準拠のgate-reportを出力させる。
#
# スタブ: 実処理は将来 `agent-skill-chain gate review`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: gate-review.sh <issue_id> <gate_id> <profile>

issue_id: ISSUE-<番号> 形式のIssue ID
gate_id:  spec|design|implementation|validation
profile:  standard|strict（.agent-skill-chain/config/agent-skill-chain.yaml review.*参照）

出力:
  成功時: 終了コード0。.agent-skill-chain/schemas/gate-report.schema.yaml準拠のgate-reportパスを標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain gate review（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
