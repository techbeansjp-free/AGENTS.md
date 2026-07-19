#!/usr/bin/env bash
# 正本: AGENTS.md §GitHub配布・マルチAI対応 / .agent-skill-chain/config/agent-skill-chain.yaml templates.*
#
# .agent-skill-chain/templates/github/.github/（配布元の正本）を対象リポジトリの .github/ へ同期する。
# .agent-skill-chain/config/agent-skill-chain.yaml の templates.github_source / templates.github_target /
# templates.verify_sync を参照する。
#
# スタブ: 実処理は将来 `agent-skill-chain sync templates`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: sync-templates.sh [target_dir]

target_dir: 同期先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。

出力:
  成功時: 終了コード0。同期したファイル一覧を標準出力へ。
  失敗時: 終了コード1以上。差分検知失敗等の理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain sync templates（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
