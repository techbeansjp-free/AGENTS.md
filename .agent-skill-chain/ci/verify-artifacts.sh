#!/usr/bin/env bash
# 正本: AGENTS.md §4セグメント・4ゲート / .agent-skill-chain/config/segments.yaml / .agent-skill-chain/schemas/segments.schema.yaml
#
# 指定 Issue・セグメントについて、.agent-skill-chain/config/segments.yaml が定義する outputs
# （spec: SPEC.md / design: DESIGN.md, ADR, PLAN.md / implementation: code,
# unit_test_results / validation: acceptance_test_results, regression_test_results, pr）
# の必須成果物ファイルが揃っているかを検査する。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify artifacts` サブコマンドへの薄いラッパーである（使い方は `verify artifacts -h` 参照）。

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

exec "${CLI[@]}" verify artifacts "$@"
