#!/usr/bin/env bash
# 正本: AGENTS.md §ADR・テンプレート・テスト適用性 / .agent-skill-chain/templates/adr/ADR.md
#       §accepted後の不変項目・可変項目・§ライフサイクル・§related_adrs参照ルール
#
# ADR のライフサイクル（proposed → accepted → superseded/deprecated）遵守と
# accepted 後の不変項目（id、Context、Decision、Consequences、supersedes）が
# 変更されていないことを検査する。可変項目は status・superseded-by・
# deprecated-reason・tags のみ。related_adrs の stale 参照（accepted 以外の
# ADR への参照、実在しない ADR への参照）も禁止する。
#
# スタブ: 実処理は将来 `agent-skill-chain verify adr`（src/agents-md.ts のCLI再実装後）
# として実装され、本スクリプトはそれを呼び出す薄いラッパーに置き換わる。
# 現時点ではサイレントに成功したふりをせず、明確なプレースホルダとして失敗する
# （CI上で「検査未実装なのに緑」という誤った安全信号を出さないため、終了コード1で失敗する）。

set -euo pipefail

usage() {
  cat <<'USAGE'
使い方: verify-adr.sh <adr_path>

adr_path: 検査対象の ADR ファイルパス（docs/adr/ 配下、.agent-skill-chain/templates/adr/ADR.md 準拠）。

status が accepted 以降の場合、id・Context・Decision・Consequences・supersedes が
過去バージョンから変更されていないか、related_adrs が accepted の ADR のみを
指しているか（stale 参照でないか）を検査する。

終了コード:
  0: ADR はライフサイクル・不変項目を遵守
  1: 不変項目の変更、stale 参照、またはスタブ未実装
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "not implemented: agent-skill-chain verify adr（src/agents-md.ts CLI再実装待ち）" >&2
exit 1
