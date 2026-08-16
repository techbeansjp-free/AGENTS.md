#!/usr/bin/env bash
# 正本: AGENTS.md §4セグメント・4ゲート / .agent-skill-chain/standards/GIT_CONVENTIONS.md
#
# 進行役がPRをマージする際に `gh pr merge` を直接呼ぶ代わりに使うべきラッパー。
# `gh pr merge` へ受け取った引数をそのまま透過する（--squash・--admin・--delete-branch等、
# 既存のマージ方式・オプションをそのまま利用できる）うえで、マージ成功後に main worktree
# （defaultブランチをチェックアウトしている共通作業ツリー）のローカルブランチを
# origin/<default-branch> へ fast-forward 同期する。
#
# これにより、進行役が短時間に複数PRを連続マージした際にローカルmainが古いまま残り、
# 後続PRのCIがbase branchをfetchできず恒久失敗する・進行役自身が古いビルド済み
# bin/agents-md.jsのままdoctor等を実行し誤った判定結果を得る、という2つの実害を防ぐ。
#
# マージ・ローカル同期の成功後、既存の root-cleanup run（Issue #208）を同一プロセス内で呼び出し、
# repoRoot直下に残存するIssueセグメント成果物（SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md）を検出時
# のみ自動削除する（ISSUE-590、ADR-0046）。agent-skill-chain-ci.yml の必須check
# 「verify-root-clean (merge-ready)」は、draftでないPRのrepoRoot直下にこれら4ファイルが存在する
# 限り常に失敗する設計であるため、validation-gateまで正常に完了したPRであっても本コマンドの
# 呼び出しには `--admin`（必須checkのbypass）を明示する必要がある。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `pr merge` サブコマンドへの薄いラッパーである（使い方は `pr merge -h` 参照）。

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

exec "${ASC_CLI[@]}" pr merge "$@"
