#!/usr/bin/env bash
# 正本: AGENTS.md §ディレクトリ構成 / §GitHub配布・マルチAI対応 / §設定
#
# 対象リポジトリへの agent-skill-chain 初回導入一式（.agent-skill-chain/templates/github/.github/ の展開、
# .agent-skill-chain/config/ 配置等）を行う入口。setup-github.sh を含む導入手順を束ねる。
#
# スタブ: 実処理は将来 `agent-skill-chain setup`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: setup.sh [target_dir]

target_dir: 導入先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。

出力:
  成功時: 終了コード0。導入した内容の一覧を標準出力へ。
  失敗時: 終了コード1以上。標準エラー出力に理由。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain setup（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
