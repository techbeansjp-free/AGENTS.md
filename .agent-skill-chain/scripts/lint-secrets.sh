#!/usr/bin/env bash
# 正本: AGENTS.md §不変条件I1〜I8 / .agent-skill-chain/standards/TEST_POLICY.md「常時必須」区分
#
# secret（認証情報・APIキー等）の混入を検査する。既知のsecretフォーマットの接頭辞
# （AWS/GitHub/Slack/Google/Stripeキー・PEM秘密鍵ヘッダ等）に限定した軽量な自前正規表現
# ベースの検査であり、エントロピーベースの汎用検出は持たない。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `lint secrets` サブコマンドへの薄いラッパーである（使い方は `lint secrets -h` 参照）。

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

exec "${CLI[@]}" lint secrets "$@"
