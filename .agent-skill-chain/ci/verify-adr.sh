#!/usr/bin/env bash
# 正本: AGENTS.md §ADR・テンプレート・テスト適用性 / .agent-skill-chain/templates/adr/ADR.md
#       §accepted後の不変項目・可変項目・§ライフサイクル・§related_adrs参照ルール
#
# ADR のライフサイクル（proposed → accepted → superseded/deprecated）遵守と
# accepted 後の不変項目（id、Context、Decision、Consequences、supersedes）が
# 変更されていないことを検査する。可変項目は status・superseded-by・
# deprecated-reason・tags のみ。related_adrs の stale 参照（accepted 以外の
# ADR への参照、実在しない ADR への参照）も禁止する。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify adr` サブコマンドへの薄いラッパーである（使い方は `verify adr -h` 参照）。

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

exec "${ASC_CLI[@]}" verify adr "$@"
