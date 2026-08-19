#!/usr/bin/env bash
# 次回が解決済み最終roundとなるreject状態遷移で、不変宣言をCoordination Backendへ耐久化する。

set -euo pipefail

_ASC_WRAPPER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
_ASC_CLI_RESOLVE_PATH="$_ASC_WRAPPER_DIR/cli-resolve.sh"
if [[ ! -r "$_ASC_CLI_RESOLVE_PATH" ]]; then
  echo "agent-skill-chain CLI の共有実装を解決できません（探索パス: ${_ASC_CLI_RESOLVE_PATH}）。" >&2
  exit 1
fi
source "$_ASC_CLI_RESOLVE_PATH"
asc_resolve_cli || exit $?

exec "${ASC_CLI[@]}" gate declare-final-round "$@"
