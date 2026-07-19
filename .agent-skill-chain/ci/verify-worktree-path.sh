#!/usr/bin/env bash
# 正本: AGENTS.md §ブランチ・worktree / .agent-skill-chain/standards/GIT_CONVENTIONS.md §worktreeパス規則・§worktreeの正本
#       / .agent-skill-chain/config/agent-skill-chain.yaml の worktree.path_pattern・worktree.timestamp
#
# worktree パスが .agent-skill-chain/config/agent-skill-chain.yaml の worktree.path_pattern
# （".worktrees/<YYYYMMDD_HHMMSS>-<type>-<issue-id>-<slug>/"、timestamp は Issue 起票日時 Asia/Tokyo）
# に適合するか検査する。正本は `git worktree list --porcelain` であり、
# .worktrees/ 配下のディレクトリ走査ではない。I4（分離）の検査手段の一つ。
#
# スタブ: 実処理は将来 `agent-skill-chain verify worktree-path`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する
# （CI上で「検査未実装なのに緑」という誤った安全信号を出さないため、終了コード1で失敗する）。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: verify-worktree-path.sh [worktree_path...]

worktree_path: 検査対象の worktree パス（複数可）。省略時は
               `git worktree list --porcelain` の全エントリを対象とする。

.agent-skill-chain/config/agent-skill-chain.yaml の worktree.path_pattern に適合するかを検査する。
ディレクトリの存在有無ではなく `git worktree list --porcelain` の出力を正本として使う。

終了コード:
  0: worktree パスは規約に適合
  1: worktree パスは規約に違反、またはスタブ未実装
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain verify worktree-path（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
