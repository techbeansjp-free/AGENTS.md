#!/usr/bin/env bash
# 正本: AGENTS.md §ADR・テンプレート・テスト適用性
#
# 引き算の機械的強制。AGENTS.md は150行、.agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md
# ・.agent-skill-chain/templates/adr/ADR.md 等のテンプレートは各100行を上限とし、超過をCIで検査する。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify doc-length` サブコマンドへの薄いラッパーである（使い方は `verify doc-length -h` 参照）。

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

exec "${CLI[@]}" verify doc-length "$@"
