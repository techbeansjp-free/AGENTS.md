#!/usr/bin/env bash
# 正本: AGENTS.md §用語
#
# 禁止語彙（旧システム名称等）の混入を検査する。対象は生きたファイル
# （AGENTS.md・.agent-skill-chain/standards/・.agent-skill-chain/ci/等）であり、
# memo/等の非追跡scratchは対象外。禁止語・許容語の一覧はdocs/GLOSSARY.mdを正本とする。
#
# docs/GLOSSARY.md自体は対象外（禁止同義語列で禁止語を文字通り列挙する構造上、恒久的に
# 自分自身を誤検出するため）。
#
# .agent-skill-chain/{templates,config,schemas,scripts}/ は対象に含む（識別子・YAMLキー・
# CLIサブコマンド文脈としての正当利用と散文中の誤用を区別するスキャナを実装済み。
# src/commands/lint.ts の isIdentifierContext 参照）。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `lint vocab` サブコマンドへの薄いラッパーである（使い方は `lint vocab -h` 参照）。

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

exec "${ASC_CLI[@]}" lint vocab "$@"
