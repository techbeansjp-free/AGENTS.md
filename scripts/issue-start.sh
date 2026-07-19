#!/usr/bin/env bash
# 正本: AGENTS.md §ブランチ・worktree / standards/GIT_CONVENTIONS.md / config/agent-skill-chain.yaml
#      （branch.pattern, worktree.path_pattern, worktree.timestamp, issue.allowed_types）
#
# Issue起票時に、config/agent-skill-chain.yaml の branch.pattern・worktree.path_pattern 規約に
# 従いブランチ名・worktreeパスを機械的に生成し、worktreeを作成する
# （standards/GIT_CONVENTIONS.md 4層構造の「3. 正しい名前の生成」層）。
#
# スタブ: 実処理は将来 `agent-skill-chain issue start`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: issue-start.sh <issue_id> <type> <slug> <issue_created_at>

issue_id:         ISSUE-<番号> 形式のIssue ID
type:             config/agent-skill-chain.yaml issue.allowed_types のいずれか
                   （feature|bugfix|hotfix|refactor|docs|process）
slug:             ブランチ名・worktreeパスに用いるslug（worktree.slug_max_length以下）
issue_created_at: Issue起票日時（Asia/Tokyo、worktree.timestamp.format に従う）

出力:
  成功時: 終了コード0。生成したブランチ名・worktreeパスを標準出力へ。
  失敗時: 終了コード1以上。規約違反の理由を標準エラー出力へ。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain issue start（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
