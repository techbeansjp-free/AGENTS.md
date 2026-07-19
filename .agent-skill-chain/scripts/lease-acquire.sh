#!/usr/bin/env bash
# 正本: schemas/lease.schema.yaml / AGENTS.md §役割・権限・writer lease
#
# writer leaseを取得する（schemas/lease.schema.yaml準拠、Coordination Backendの
# compare-and-set相当の原子的処理）。1 Issueにつき同時1つの制約を強制する。
# config/agent-skill-chain.yaml の lease.ttl_seconds を用いる。
#
# スタブ: 実処理は将来 `agent-skill-chain lease acquire`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: lease-acquire.sh <issue_id> <segment>

issue_id: ISSUE-<番号> 形式のIssue ID
segment:  spec|design|implementation|validation|adr_finalization

出力:
  成功時: 終了コード0。schemas/lease.schema.yaml準拠のwriter_lease（token含む）を標準出力へ。
  失敗時: 終了コード1以上。既存leaseと競合した場合はholder・expires_atを標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain lease acquire（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
