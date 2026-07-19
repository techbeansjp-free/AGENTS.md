#!/usr/bin/env bash
# 正本: AGENTS.md §4セグメント・4ゲート / schemas/integration.schema.yaml
#
# SPECワーカーが最初のcheckpoint push後にDraft PRを作成する（Closes #<issue-id>）。
# GitHubモードでは実PR、ローカルモードではschemas/integration.schema.yaml準拠の
# Integration Recordを作成する。
#
# スタブ: 実処理は将来 `agent-skill-chain pr create`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: pr-create.sh <issue_id> <branch>

issue_id: ISSUE-<番号> 形式のIssue ID
branch:   Draft PR / Integration Recordの対象ブランチ名

出力:
  成功時: 終了コード0。作成したPR URLまたはIntegration Recordパスを標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain pr create（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
