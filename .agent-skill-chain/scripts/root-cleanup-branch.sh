#!/usr/bin/env bash
# 正本: AGENTS.md §ディレクトリ構成 / .agent-skill-chain/config/roles.yaml root_artifact_cleanup_worker /
#      docs/adr/ADR-0080-root-artifact-pre-merge-cleanup-scoped-role-and-deterministic-command.md
#
# PRをReadyへ移す前に、進行役が起動する。root成果物クリーンアップワーカーがwriter leaseを取得の
# うえ、Issueブランチ上のroot直下 SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md の削除だけで構成された
# commitを作りpushする（.agent-skill-chain/config/roles.yaml の root_artifact_cleanup_worker、
# scope: root_artifacts_only）。commitの主体は進行役ではなく当該ロールである。
#
# 入力は対象Issueの識別子1個のみで、ファイル内容・commitメッセージ本文・任意テキストを与える
# 引数も標準入力経路も持たない。既定ブランチへのpushを契機とする事後清掃自動化
# （root-cleanup.sh）とは契機・対象ブランチ・実行主体が異なる別機構であり、置き換えない。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `root-cleanup branch` サブコマンドへの薄いラッパーである（使い方は `root-cleanup branch -h` 参照）。

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

exec "${ASC_CLI[@]}" root-cleanup branch "$@"
