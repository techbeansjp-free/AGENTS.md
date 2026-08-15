#!/usr/bin/env bash
# 正本: AGENTS.md §不変条件I2（セグメントゲート）・§ゲートの継承・無効化 / .agent-skill-chain/schemas/gate-report.schema.yaml
#
# gate-report が .agent-skill-chain/schemas/gate-report.schema.yaml（schema_version:
# agent-skill-chain/gate-report/v1）に適合し、gate.conformance と gate.falsification の
# 両方（立証・反証の2観点）が記録されているかを検査する。gate.id は
# spec|design|implementation|validation のいずれか、blockers の各要素は
# origin（specification|design|implementation|validation）を必須とする。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify gate-report` サブコマンドへの薄いラッパーである（使い方は `verify gate-report -h` 参照）。

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

exec "${ASC_CLI[@]}" verify gate-report "$@"
