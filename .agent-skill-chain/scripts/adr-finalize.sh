#!/usr/bin/env bash
# 正本: AGENTS.md §ADR・テンプレート・テスト適用性 / .agent-skill-chain/config/roles.yaml adr_finalization_worker /
#      .agent-skill-chain/templates/adr/ADR.md ライフサイクル
#
# 設計ゲート承認後、進行役が起動する。ADR finalizationワーカーがwriter leaseを取得のうえ
# ADRのstatusをacceptedへ更新してcommit・push する
# （.agent-skill-chain/config/roles.yaml の adr_finalization_worker、scope: adr_status_only）。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `adr finalize` サブコマンドへの薄いラッパーである（使い方は `adr finalize -h` 参照）。

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

exec "${ASC_CLI[@]}" adr finalize "$@"
