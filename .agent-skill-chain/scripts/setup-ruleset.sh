#!/usr/bin/env bash
# 正本: AGENTS.md §GitHub配布・マルチAI対応 / templates/github/provisioning/rulesets/main.json
#
# templates/github/provisioning/rulesets/main.json の定義を GitHub Rulesets API（gh api 経由）へ適用する。
#
# スタブ: 実処理は将来 `agent-skill-chain setup ruleset`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: setup-ruleset.sh [owner/repo]

owner/repo: 適用先リポジトリ（省略時は gh の既定リポジトリを使用）。

出力:
  成功時: 終了コード0。適用したrulesetの内容を標準出力へ。
  失敗時: 終了コード1以上。gh api のエラーを標準エラー出力に転記。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain setup ruleset（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
