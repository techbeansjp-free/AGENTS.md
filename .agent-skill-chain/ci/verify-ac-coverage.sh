#!/usr/bin/env bash
# 正本: AGENTS.md §不変条件I7 / .agent-skill-chain/standards/TEST_POLICY.md §不変条件I7（仕様⇔検証の追跡）
#       / .agent-skill-chain/schemas/validation-report.schema.yaml
#
# 全 AC-ID（SPEC.md、正規表現 ^AC-[0-9]+$）に検証方法（verification.mode:
# automated|manual|hybrid）と証跡（evidence）が対応しているかを検査する。
# 孤児 AC（検証記録の無い AC-ID）・孤児テスト参照（存在しない AC-ID を指す証跡）を禁止する（I7）。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify ac-coverage` サブコマンドへの薄いラッパーである（使い方は `verify ac-coverage -h` 参照）。

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

exec "${ASC_CLI[@]}" verify ac-coverage "$@"
