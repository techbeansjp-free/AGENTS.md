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
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify adr` サブコマンドへの薄いラッパーである（使い方は `verify adr -h` 参照）。

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." &>/dev/null && pwd)"

if [[ -f "$REPO_ROOT/bin/agents-md.js" ]]; then
  CLI=(node "$REPO_ROOT/bin/agents-md.js")
elif [[ -x "$REPO_ROOT/node_modules/.bin/agent-skill-chain" ]]; then
  CLI=("$REPO_ROOT/node_modules/.bin/agent-skill-chain")
elif command -v agent-skill-chain >/dev/null 2>&1; then
  CLI=(agent-skill-chain)
else
  echo "agent-skill-chain CLI が見つかりません（bin/agents-md.js 未ビルド、node_modules/.bin/agent-skill-chain 不在、PATH上にも無し）。'npm run build' を実行するか agent-skill-chain を導入してください。" >&2
  exit 1
fi

exec "${CLI[@]}" verify adr "$@"
