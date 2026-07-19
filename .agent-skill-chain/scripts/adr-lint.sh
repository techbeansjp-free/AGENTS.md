#!/usr/bin/env bash
# 正本: templates/adr/ADR.md §related_adrs参照ルール / AGENTS.md §ADR・テンプレート・テスト適用性
#
# ADRのstale参照検査（related_adrs:の参照先が実在しaccepted状態か）、
# supersedes⇔superseded-byの対称性検査を行う（templates/adr/ADR.md「related_adrs参照ルール」節）。
#
# スタブ: 実処理は将来 `agent-skill-chain lint adr`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: adr-lint.sh check

check: 検査を実行するサブコマンド（他のサブコマンドは将来拡張）。

出力:
  成功時（違反なし）: 終了コード0。
  失敗時（違反あり）: 終了コード1以上。違反ADR ID・理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain lint adr（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
