#!/usr/bin/env bash
# 正本: AGENTS.md 不変条件I3
#
# 中断したIssueの状態をGit（push済みの状態）から完全復元して再開する（I3）。
#
# スタブ: 実処理は将来 `agent-skill-chain issue resume`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: issue-resume.sh <issue_id>

issue_id: ISSUE-<番号> 形式のIssue ID。

出力:
  成功時: 終了コード0。復元したworktreeパス・segment・gate状態を標準出力へ。
  失敗時: 終了コード1以上。push済み状態が存在しない等の理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain issue resume（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
