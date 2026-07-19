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

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." &>/dev/null && pwd)"

if [[ -f "$REPO_ROOT/bin/agents-md.js" ]]; then
  CLI=(node "$REPO_ROOT/bin/agents-md.js")
elif [[ -x "$REPO_ROOT/node_modules/.bin/agent-skill-chain" ]]; then
  CLI=("$REPO_ROOT/node_modules/.bin/agent-skill-chain")
elif command -v agent-skill-chain >/dev/null 2>&1; then
  CLI=(agent-skill-chain)
else
  echo "agent-skill-chain CLI が見つかりません（bin/agents-md.js 未ビルド、node_modules/.bin/agent-skill-chain 不在、PATH上にも無し）。'npm run build' を実行するか agent-skill-chain を導入してください。" >&2
  exit 1
fi

exec "${CLI[@]}" verify worktree-path "$@"
