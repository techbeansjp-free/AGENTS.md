#!/usr/bin/env bash
# 正本: AGENTS.md §用語
#
# 禁止語彙（旧システム名称等）の混入を検査する。対象は生きたファイル
# （AGENTS.md・.agent-skill-chain/standards/・.agent-skill-chain/templates/・.agent-skill-chain/config/・.agent-skill-chain/schemas/・.agent-skill-chain/scripts/・.agent-skill-chain/ci/等）であり、
# memo/等の非追跡scratchは対象外。禁止語・許容語の一覧はdocs/GLOSSARY.mdを正本とする。
#
# スタブ: 実処理は将来 `agent-skill-chain lint vocab`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: lint-vocab.sh [path...]

path: 検査対象パス（省略時はリポジトリ全体）。

出力:
  成功時（違反なし）: 終了コード0。
  失敗時（違反あり）: 終了コード1以上。違反箇所（ファイル:行）を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain lint vocab（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
