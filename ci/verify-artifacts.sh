#!/usr/bin/env bash
# 正本: AGENTS.md §4セグメント・4ゲート / config/segments.yaml / schemas/segments.schema.yaml
#
# 指定 Issue・セグメントについて、config/segments.yaml が定義する outputs
# （spec: SPEC.md / design: DESIGN.md, ADR, PLAN.md / implementation: code,
# unit_test_results / validation: acceptance_test_results, regression_test_results, pr）
# の必須成果物ファイルが揃っているかを検査する。
#
# スタブ: 実処理は将来 `agent-skill-chain verify artifacts`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する
# （CI上で「検査未実装なのに緑」という誤った安全信号を出さないため、終了コード1で失敗する）。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: verify-artifacts.sh <issue_id> <segment>

issue_id: 検査対象の Issue ID（例: ISSUE-123）。
segment:  検査対象セグメント（spec | design | implementation | validation）。
          config/segments.yaml の segments[].id に対応する。

指定セグメントの config/segments.yaml 定義 outputs が全て存在するかを検査する。

終了コード:
  0: 当該セグメントの必須成果物は全て存在
  1: 必須成果物の欠落、不正な segment 指定、またはスタブ未実装
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain verify artifacts（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
