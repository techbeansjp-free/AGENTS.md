#!/usr/bin/env bash
# 正本: AGENTS.md §役割・権限・writer lease / standards/SECURITY_POLICY.md writer leaseによる同時書込み制御
#
# 期限切れwriter leaseを検出し、成果物のpush状態を確認したうえで回収するか、
# 人間判断へ昇格する。
#
# スタブ: 実処理は将来 `agent-skill-chain reconcile`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: reconcile.sh

引数なし。全Issueを走査する。

出力:
  成功時: 終了コード0。回収したlease・人間判断へ昇格した件の一覧を標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain reconcile（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
