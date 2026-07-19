#!/usr/bin/env bash
# 正本: AGENTS.md §GitHub配布・マルチAI対応
#
# GitHub配布物（.github/）の展開・同期を起動する。sync-templates.sh・setup-labels.sh・
# setup-ruleset.sh を束ねて呼び出す入口。
#
# スタブ: 実処理は将来 `agent-skill-chain setup github`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: setup-github.sh [target_dir]

target_dir: 導入先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。

出力:
  成功時: 終了コード0。sync-templates.sh・setup-labels.sh・setup-ruleset.sh の実行結果を標準出力へ。
  失敗時: 終了コード1以上。どの下位処理で失敗したかを標準エラー出力に明示。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain setup github（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
