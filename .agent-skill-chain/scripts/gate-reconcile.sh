#!/usr/bin/env bash
# 正本: AGENTS.md §ゲートの継承・無効化 / schemas/gate-report.schema.yaml 無効化ルール
#
# pushごとにapproved_artifactsのdigestを照合し、変化なしなら最新SHAへ成功を再発行、
# 変化ありなら当該ゲートと全下流ゲートを無効化する
# （対応表はschemas/gate-report.schema.yaml末尾の無効化ルールを参照）。
#
# スタブ: 実処理は将来 `agent-skill-chain gate reconcile`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: gate-reconcile.sh <issue_id> <target_sha>

issue_id:   ISSUE-<番号> 形式のIssue ID
target_sha: 照合対象のcommit SHA

出力:
  成功時: 終了コード0。再発行または無効化したゲートIDの一覧を標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain gate reconcile（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
