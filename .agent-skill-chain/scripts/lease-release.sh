#!/usr/bin/env bash
# 正本: .agent-skill-chain/schemas/lease.schema.yaml / AGENTS.md §役割・権限・writer lease
#
# 保持中のwriter leaseを解放する。
#
# スタブ: 実処理は将来 `agent-skill-chain lease release`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: lease-release.sh <issue_id> <token>

issue_id: ISSUE-<番号> 形式のIssue ID
token:    lease-acquire.sh取得時に発行されたcompare-and-set用トークン

出力:
  成功時: 終了コード0。解放したissue_idを標準出力へ。
  失敗時: 終了コード1以上。token不一致等の理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain lease release（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
