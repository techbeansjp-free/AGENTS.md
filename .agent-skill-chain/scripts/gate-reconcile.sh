#!/usr/bin/env bash
# 正本: AGENTS.md §ゲートの継承・無効化 / .agent-skill-chain/schemas/gate-report.schema.yaml 無効化ルール
#
# pushごとにapproved_artifactsのdigestを照合し、変化なしなら最新SHAへ成功を再発行、
# 変化ありなら当該ゲートと全下流ゲートを無効化する
# （対応表は.agent-skill-chain/schemas/gate-report.schema.yaml末尾の無効化ルールを参照）。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `gate reconcile <issue_id> <target_sha> [pr_number]` サブコマンドへの薄いラッパーである
# （使い方は `gate reconcile -h` 参照）。

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

exec "${ASC_CLI[@]}" gate reconcile "$@"
