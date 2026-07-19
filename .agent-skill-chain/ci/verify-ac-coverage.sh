#!/usr/bin/env bash
# 正本: AGENTS.md §不変条件I7 / .agent-skill-chain/standards/TEST_POLICY.md §不変条件I7（仕様⇔検証の追跡）
#       / .agent-skill-chain/schemas/validation-report.schema.yaml
#
# 全 AC-ID（SPEC.md、正規表現 ^AC-[0-9]+$）に検証方法（verification.mode:
# automated|manual|hybrid）と証跡（evidence）が対応しているかを検査する。
# 孤児 AC（検証記録の無い AC-ID）・孤児テスト参照（存在しない AC-ID を指す証跡）を禁止する（I7）。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify ac-coverage` サブコマンドへの薄いラッパーである（使い方は `verify ac-coverage -h` 参照）。

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

exec "${CLI[@]}" verify ac-coverage "$@"
