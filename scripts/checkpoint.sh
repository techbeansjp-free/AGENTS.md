#!/usr/bin/env bash
# 正本: AGENTS.md 不変条件I3 / config/agent-skill-chain.yaml durability.backend
#
# セグメント完了ごとにcommit+pushし、耐久性（I3）のチェックポイントを作る。
# config/agent-skill-chain.yaml の durability.backend（remote|local_mirror）を参照する。
#
# スタブ: 実処理は将来 `agent-skill-chain checkpoint`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: checkpoint.sh <message>

message: commitメッセージ。

出力:
  成功時: 終了コード0。commitしたSHAを標準出力へ。
  失敗時: 終了コード1以上。durability.backend未設定・push失敗等の理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain checkpoint（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
