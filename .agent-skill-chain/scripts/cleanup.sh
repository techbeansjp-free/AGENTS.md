#!/usr/bin/env bash
# 正本: AGENTS.md §ブランチ・worktree / .agent-skill-chain/standards/GIT_CONVENTIONS.md worktreeの削除
#
# worktreeを削除する。.agent-skill-chain/standards/GIT_CONVENTIONS.mdの削除条件（writer lease不在・
# 未commit変更なし・未push commitなし・PR/Integration Record完了済み）を検査してから
# git worktree remove → git worktree prune を実行する。直接rm -rfしない。
#
# スタブ: 実処理は将来 `agent-skill-chain cleanup`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: cleanup.sh <issue_id>

issue_id: ISSUE-<番号> 形式のIssue ID

出力:
  成功時: 終了コード0。削除したworktreeパスを標準出力へ。
  失敗時: 終了コード1以上。削除条件を満たさない理由（未完了PR等）を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain cleanup（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
