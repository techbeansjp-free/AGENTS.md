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

exec "${ASC_CLI[@]}" root-cleanup run "$@"
