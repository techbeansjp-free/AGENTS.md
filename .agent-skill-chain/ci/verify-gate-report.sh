#!/usr/bin/env bash
# 正本: AGENTS.md §不変条件I2（セグメントゲート）・§ゲートの継承・無効化 / .agent-skill-chain/schemas/gate-report.schema.yaml
#
# gate-report が .agent-skill-chain/schemas/gate-report.schema.yaml（schema_version:
# agent-skill-chain/gate-report/v1）に適合し、target_sha・approved_artifacts の digest が
# 正当であるかを検査する。判定の確定は gate.final（単一の権威あるフィールド）のみで判断し、
# final が確定値（approved/rejected/human_required）のときは gate.conformance・
# gate.falsification の個別 pending を検査しない。final がリテラル pending（gate review の
# 白紙スキャフォールド）の場合のみ専用終了コード2を返す（Issue #349）。gate.id は
# spec|design|implementation|validation のいずれか、blockers の各要素は
# origin（specification|design|implementation|validation）を必須とする。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify gate-report` サブコマンドへの薄いラッパーである（使い方は `verify gate-report -h` 参照）。

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

exec "${CLI[@]}" verify gate-report "$@"
