#!/usr/bin/env bash
# 正本: AGENTS.md §コーディネーションバックエンド / config/agent-skill-chain.yaml
#
# 環境診断（git・gh・Coordination Backend用の認証状態等、必要な外部依存の有無）を検査する。
#
# スタブ: 実処理は将来 `agent-skill-chain doctor`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: doctor.sh

引数なし。

出力:
  成功時: 終了コード0。検査項目ごとのOK/NGを標準出力へ。
  失敗時（必須依存が欠落）: 終了コード1以上。不足している依存を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain doctor（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
