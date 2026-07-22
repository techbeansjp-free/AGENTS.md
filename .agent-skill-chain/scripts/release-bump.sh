#!/usr/bin/env bash
# 正本: ADR-0005 / .github/workflows/agent-skill-chain-release.yml
#
# package.json（および存在すれば package-lock.json）の version を対象版数へ書き換え、短命ブランチ
# release/bump-v<target> 上に 'chore(release): v<target> [skip ci]' としてcommit・pushし、
# 機械生成の版数台帳更新PRを作成、'gh pr merge --admin --squash --subject' でmainへマージする
# （bumpブランチ・PR作成／admin merge器、Issue #196）。マージ直前にheadブランチ名・変更ファイル
# 集合のスコープ検査を行い、逸脱時は自動admin mergeを行わず human_required として停止する。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `release bump` サブコマンドへの薄いラッパーである（使い方は `release bump -h` 参照）。

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

exec "${CLI[@]}" release bump "$@"
