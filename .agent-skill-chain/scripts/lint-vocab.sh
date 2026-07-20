#!/usr/bin/env bash
# 正本: AGENTS.md §用語
#
# 禁止語彙（旧システム名称等）の混入を検査する。対象は生きたファイル
# （AGENTS.md・docs/GLOSSARY.md・.agent-skill-chain/standards/・.agent-skill-chain/ci/等）であり、
# memo/等の非追跡scratchは対象外。禁止語・許容語の一覧はdocs/GLOSSARY.mdを正本とする。
#
# .agent-skill-chain/{templates,config,schemas,scripts}/ は一時的に対象外（識別子・YAMLキー・
# CLIサブコマンド名としての"issue"等の正当利用を、現行スキャナが散文の誤用と区別できず大量誤検出
# するため）。識別子対応スキャナ実装後、follow-up issueで対象復帰する。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `lint vocab` サブコマンドへの薄いラッパーである（使い方は `lint vocab -h` 参照）。

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

exec "${CLI[@]}" lint vocab "$@"
