#!/usr/bin/env bash
# 正本: AGENTS.md §不変条件I2（フェーズゲート）・§ゲートの継承・無効化 / schemas/gate-report.schema.yaml
#
# gate-report が schemas/gate-report.schema.yaml（schema_version:
# agent-skill-chain/gate-report/v1）に適合し、gate.conformance と gate.falsification の
# 両方（立証・反証の2観点）が記録されているかを検査する。gate.id は
# spec|design|implementation|validation のいずれか、blockers の各要素は
# origin（specification|design|implementation|validation）を必須とする。
#
# スタブ: 実処理は将来 `agent-skill-chain verify gate-report`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する
# （CI上で「検査未実装なのに緑」という誤った安全信号を出さないため、終了コード1で失敗する）。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: verify-gate-report.sh <gate_report_path>

gate_report_path: 検査対象の gate-report ファイルパス
                   （GitHubモード: Check Run + PR review 相当、ローカルモード: reviews/<gate>.yaml）。

schemas/gate-report.schema.yaml への適合、gate.conformance / gate.falsification /
gate.final の記録、approved_digest・approved_artifacts の整合性、blockers 各要素の
origin 付与を検査する。

終了コード:
  0: gate-report はスキーマに適合し conformance・falsification とも記録済み
  1: スキーマ違反、conformance/falsification 未記録、またはスタブ未実装
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain verify gate-report（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
