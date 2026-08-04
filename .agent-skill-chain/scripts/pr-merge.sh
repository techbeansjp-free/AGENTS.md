#!/usr/bin/env bash
# 正本: AGENTS.md §4セグメント・4ゲート / .agent-skill-chain/standards/GIT_CONVENTIONS.md
#
# 進行役がPRをマージする際に `gh pr merge` を直接呼ぶ代わりに使うべきラッパー。
# `gh pr merge` へ受け取った引数をそのまま透過する（--squash・--admin・--delete-branch等、
# 既存のマージ方式・オプションをそのまま利用できる）うえで、マージ成功後に main worktree
# （defaultブランチをチェックアウトしている共通作業ツリー）のローカルブランチを
# origin/<default-branch> へ fast-forward 同期する。
#
# これにより、進行役が短時間に複数PRを連続マージした際にローカルmainが古いまま残り、
# 後続PRのCIがbase branchをfetchできず恒久失敗する・進行役自身が古いビルド済み
# bin/agents-md.jsのままdoctor等を実行し誤った判定結果を得る、という2つの実害を防ぐ。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `pr merge` サブコマンドへの薄いラッパーである（使い方は `pr merge -h` 参照）。

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

exec "${CLI[@]}" pr merge "$@"
