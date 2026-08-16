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

exec "${ASC_CLI[@]}" release bump "$@"
