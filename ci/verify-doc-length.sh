#!/usr/bin/env bash
# 正本: AGENTS.md §ADR・テンプレート・テスト適用性
#
# 引き算の機械的強制。AGENTS.md は150行、templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md
# ・templates/adr/ADR.md 等のテンプレートは各100行を上限とし、超過をCIで検査する。
#
# スタブ: 実処理は将来 `agent-skill-chain verify doc-length`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する
# （CI上で「検査未実装なのに緑」という誤った安全信号を出さないため、終了コード1で失敗する）。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: verify-doc-length.sh

AGENTS.md（150行上限）および templates/ 配下の各テンプレート（100行上限）の
行数を検査する。対象ファイル一覧・上限値は将来のCLI実装が
config/agent-skill-chain.yaml 相当の設定から決定する。

終了コード:
  0: 全対象ファイルが上限以内
  1: いずれかが上限超過、またはスタブ未実装
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain verify doc-length（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
