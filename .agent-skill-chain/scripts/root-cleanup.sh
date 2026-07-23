#!/usr/bin/env bash
# 正本: ADR-0007 / .github/workflows/agent-skill-chain-root-cleanup.yml
#
# repoRoot直下に恒久混入したIssueセグメント成果物（SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md）を
# 検出し、0件ならno-op、1件以上あれば短命ブランチ chore/root-cleanup-<UTC timestamp> 上で
# git rm・commit・pushし、機械生成のPRを作成、'gh pr merge --admin --squash --subject' でmainへ
# マージする（main post-merge cleanup自動化、Issue #208）。マージ直前にheadブランチ名・変更内容の
# スコープ検査を行い、逸脱時は自動admin mergeを行わず human_required として停止する。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `root-cleanup run` サブコマンドへの薄いラッパーである（使い方は `root-cleanup run -h` 参照）。

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

exec "${CLI[@]}" root-cleanup run "$@"
