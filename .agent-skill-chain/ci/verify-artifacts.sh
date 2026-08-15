#!/usr/bin/env bash
# 正本: AGENTS.md §4セグメント・4ゲート / .agent-skill-chain/config/segments.yaml / .agent-skill-chain/schemas/segments.schema.yaml
#
# 指定 Issue・セグメントについて、.agent-skill-chain/config/segments.yaml が定義する outputs
# （spec: SPEC.md / design: DESIGN.md, ADR, PLAN.md / implementation: code,
# unit_test_results / validation: acceptance_test_results, regression_test_results, pr）
# の必須成果物ファイルが揃っているかを検査する。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify artifacts` サブコマンドへの薄いラッパーである（使い方は `verify artifacts -h` 参照）。

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

exec "${ASC_CLI[@]}" verify artifacts "$@"
