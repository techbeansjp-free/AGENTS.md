#!/usr/bin/env bash
# 正本: AGENTS.md §ブランチ・worktree / .agent-skill-chain/standards/GIT_CONVENTIONS.md §配置・命名規則の4層構造（層4）
#       / .agent-skill-chain/config/agent-skill-chain.yaml の branch.pattern・issue.allowed_types
#
# ブランチ名が .agent-skill-chain/config/agent-skill-chain.yaml の branch.pattern
# （"{type}/{issue_id}-{slug}"、type は issue.allowed_types のいずれか）に適合するか検査する。
# I4（分離）の検査手段の一つ。
#
# スタブ: 実処理は将来 `agent-skill-chain verify branch-name`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する
# （CI上で「検査未実装なのに緑」という誤った安全信号を出さないため、終了コード1で失敗する）。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: verify-branch-name.sh [branch_name]

branch_name: 検査対象のブランチ名。省略時はカレントブランチ
             （git rev-parse --abbrev-ref HEAD）を対象とする。

.agent-skill-chain/config/agent-skill-chain.yaml の branch.pattern（"{type}/{issue_id}-{slug}"）に
適合するか、および type が issue.allowed_types に含まれるかを検査する。

終了コード:
  0: ブランチ名は規約に適合
  1: ブランチ名は規約に違反、またはスタブ未実装
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain verify branch-name（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
