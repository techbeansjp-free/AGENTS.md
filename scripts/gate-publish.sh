#!/usr/bin/env bash
# 正本: schemas/gate-report.schema.yaml / config/agent-skill-chain.yaml coordination.backend, checks.*
#
# gate-reportをCheck Run（GitHubモード、agent-skill-chain/<gate>-gate）または
# ローカルモード reviews/<gate>.yaml へ発行する。
#
# スタブ: 実処理は将来 `agent-skill-chain gate publish`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: gate-publish.sh <issue_id> <gate_report_path>

issue_id:         ISSUE-<番号> 形式のIssue ID
gate_report_path: schemas/gate-report.schema.yaml準拠のgate-reportファイルパス

出力:
  成功時: 終了コード0。発行先（Check Run URLまたはreviews/<gate>.yamlパス）を標準出力へ。
  失敗時: 終了コード1以上。スキーマ不適合等の理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain gate publish（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
