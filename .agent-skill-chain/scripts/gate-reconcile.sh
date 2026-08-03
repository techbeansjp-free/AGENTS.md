#!/usr/bin/env bash
# 正本: AGENTS.md §ゲートの継承・無効化 / .agent-skill-chain/schemas/gate-report.schema.yaml 無効化ルール
#
# pushごとにapproved_artifactsのdigestを照合し、変化なしなら最新SHAへ成功を再発行、
# 変化ありなら当該ゲートと全下流ゲートを無効化する
# （対応表は.agent-skill-chain/schemas/gate-report.schema.yaml末尾の無効化ルールを参照）。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `gate reconcile <issue_id> <target_sha> [pr_number]` サブコマンドへの薄いラッパーである
# （使い方は `gate reconcile -h` 参照）。

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

exec "${CLI[@]}" gate reconcile "$@"
