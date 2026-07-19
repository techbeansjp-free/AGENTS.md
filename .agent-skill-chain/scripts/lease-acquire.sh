#!/usr/bin/env bash
# 正本: .agent-skill-chain/schemas/lease.schema.yaml / AGENTS.md §役割・権限・writer lease
#
# writer leaseを取得する（.agent-skill-chain/schemas/lease.schema.yaml準拠、Coordination Backendの
# compare-and-set相当の原子的処理）。1 Issueにつき同時1つの制約を強制する。
# .agent-skill-chain/config/agent-skill-chain.yaml の lease.ttl_seconds を用いる。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `lease acquire` サブコマンドへの薄いラッパーである（使い方は `lease acquire -h` 参照）。

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

exec "${CLI[@]}" lease acquire "$@"
