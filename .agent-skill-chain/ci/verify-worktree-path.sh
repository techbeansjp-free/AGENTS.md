#!/usr/bin/env bash
# 正本: AGENTS.md §ブランチ・worktree / .agent-skill-chain/standards/GIT_CONVENTIONS.md §worktreeパス規則・§worktreeの正本
#       / .agent-skill-chain/config/agent-skill-chain.yaml の worktree.path_pattern・worktree.timestamp
#
# worktree パスが .agent-skill-chain/config/agent-skill-chain.yaml の worktree.path_pattern
# （".worktrees/<YYYYMMDD_HHMMSS>-<type>-<issue-id>-<slug>/"、timestamp は Issue 起票日時 Asia/Tokyo）
# に適合するか検査する。正本は `git worktree list --porcelain` であり、
# .worktrees/ 配下のディレクトリ走査ではない。I4（分離）の検査手段の一つ。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify worktree-path` サブコマンドへの薄いラッパーである（使い方は `verify worktree-path -h` 参照）。

set -euo pipefail

# >>> agent-skill-chain CLI resolver preamble >>>
_ASC_WRAPPER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
_ASC_CLI_RESOLVE_PATH="$_ASC_WRAPPER_DIR/../scripts/cli-resolve.sh"
if [[ ! -r "$_ASC_CLI_RESOLVE_PATH" ]]; then
  echo "agent-skill-chain CLI の共有実装を解決できません（探索パス: ${_ASC_CLI_RESOLVE_PATH}）。" >&2
  exit 1
fi
if ! source "$_ASC_CLI_RESOLVE_PATH"; then
  echo "agent-skill-chain CLI の共有実装を読み込めません（探索パス: ${_ASC_CLI_RESOLVE_PATH}）。" >&2
  exit 1
fi
if ! declare -F asc_resolve_cli >/dev/null; then
  echo "agent-skill-chain CLI の共有実装に公開関数がありません（探索パス: ${_ASC_CLI_RESOLVE_PATH}）。" >&2
  exit 1
fi
# <<< agent-skill-chain CLI resolver preamble <<<

asc_resolve_cli || exit $?

exec "${ASC_CLI[@]}" verify worktree-path "$@"
