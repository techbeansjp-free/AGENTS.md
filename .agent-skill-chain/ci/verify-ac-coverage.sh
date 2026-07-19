#!/usr/bin/env bash
# 正本: AGENTS.md §不変条件I7 / .agent-skill-chain/standards/TEST_POLICY.md §不変条件I7（仕様⇔検証の追跡）
#       / .agent-skill-chain/schemas/validation-report.schema.yaml
#
# 全 AC-ID（SPEC.md、正規表現 ^AC-[0-9]+$）に検証方法（verification.mode:
# automated|manual|hybrid）と証跡（evidence）が対応しているかを検査する。
# 孤児 AC（検証記録の無い AC-ID）・孤児テスト参照（存在しない AC-ID を指す証跡）を禁止する（I7）。
#
# スタブ: 実処理は将来 `agent-skill-chain verify ac-coverage`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する
# （CI上で「検査未実装なのに緑」という誤った安全信号を出さないため、終了コード1で失敗する）。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: verify-ac-coverage.sh <issue_id>

issue_id: 検査対象の Issue ID（例: ISSUE-123）。

SPEC.md の全 AC-ID が VALIDATION.md（.agent-skill-chain/schemas/validation-report.schema.yaml 準拠）の
acceptance_criteria に対応し、各エントリに verification.mode・verification.result・
evidence（mode=manual|hybrid の場合は reason・procedure・executor も）が
記録されているかを検査する。孤児 AC・孤児テスト参照は違反として扱う。

終了コード:
  0: 全 AC-ID の検証方法・証跡が対応済み
  1: 孤児AC・孤児テスト参照あり、証跡欠落、またはスタブ未実装
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain verify ac-coverage（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
