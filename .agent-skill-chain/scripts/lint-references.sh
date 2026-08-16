#!/usr/bin/env bash
# 正本: AGENTS.md §参照・コメントの陳腐化防止
#
# 規範文書・ソースコードコメントに含まれるセクション番号参照（例: 「§3.2を参照」）・
# ファイルパス＋行番号参照（例: `src/foo.ts:123`）を検査する。対象は生きたファイル
# （AGENTS.md・.agent-skill-chain/standards/・.agent-skill-chain/templates/・.agent-skill-chain/config/・.agent-skill-chain/schemas/・.agent-skill-chain/scripts/・.agent-skill-chain/ci/等）であり、
# memo/等の非追跡scratchは対象外。`related_adrs:` 等の構造化フィールド経由の参照は
# AGENTS.md §成果物の自己完結性 により対象外。機械処理用manifest・テスト証跡・
# エラー出力での使用は許可する。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `lint references` サブコマンドへの薄いラッパーである（使い方は `lint references -h` 参照）。

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

exec "${ASC_CLI[@]}" lint references "$@"
