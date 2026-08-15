#!/usr/bin/env bash
# 正本: AGENTS.md §ディレクトリ構成 / ADR-0007
#
# repoRoot直下に SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md（Issueセグメント成果物）が
# 残存していないことのみを確認する。root-cleanup run の事後確認（Issue #208）に加え、
# agent-skill-chain-ci.yml の verify ジョブが「verify-root-clean (merge-ready)」ステップとして
# マージ準備完了状態（draft == false）のPRに対する事前ゲートからも同一ロジックのまま呼び出す
# （ISSUE-590、ADR-0046）。呼び出し元が増えても本スクリプト自体の動作・出力仕様は変更しない。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify root-clean` サブコマンドへの薄いラッパーである（使い方は `verify root-clean -h` 参照）。

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

exec "${ASC_CLI[@]}" verify root-clean "$@"
