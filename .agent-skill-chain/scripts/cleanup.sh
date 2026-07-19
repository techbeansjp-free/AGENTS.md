#!/usr/bin/env bash
# 正本: AGENTS.md §ブランチ・worktree / .agent-skill-chain/standards/GIT_CONVENTIONS.md worktreeの削除
#
# worktreeを削除する。.agent-skill-chain/standards/GIT_CONVENTIONS.mdの削除条件（writer lease不在・
# 未commit変更なし・未push commitなし・PR/Integration Record完了済み）を検査してから
# git worktree remove → git worktree prune を実行する。直接rm -rfしない。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `cleanup` サブコマンドへの薄いラッパーである（使い方は `cleanup -h` 参照）。

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

exec "${CLI[@]}" cleanup "$@"
