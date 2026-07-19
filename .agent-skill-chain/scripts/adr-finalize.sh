#!/usr/bin/env bash
# 正本: AGENTS.md §ADR・テンプレート・テスト適用性 / .agent-skill-chain/config/roles.yaml adr_finalization_worker /
#      .agent-skill-chain/templates/adr/ADR.md ライフサイクル
#
# 設計ゲート承認後、進行役が起動する。ADR finalizationワーカーがwriter leaseを取得のうえ
# ADRのstatusをacceptedへ更新してcommit・push する
# （.agent-skill-chain/config/roles.yaml の adr_finalization_worker、scope: adr_status_only）。
#
# スタブ: 実処理は将来 `agent-skill-chain adr finalize`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: adr-finalize.sh <issue_id> <adr_id>

issue_id: ISSUE-<番号> 形式のIssue ID
adr_id:   ADR-<番号> 形式のADR ID（docs/adr/ 配下）

出力:
  成功時: 終了コード0。status: accepted へ更新したcommit SHAを標準出力へ。
  失敗時: 終了コード1以上。content digest不一致等の理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain adr finalize（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
