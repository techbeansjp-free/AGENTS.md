#!/usr/bin/env bash
# 正本: AGENTS.md §ディレクトリ構成 / ADR-0007
#
# repoRoot直下に SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md（Issueセグメント成果物）が
# 残存していないことのみを確認する。root-cleanup run の事後確認（Issue #208）に加え、
# agent-skill-chain-ci.yml の verify ジョブが「verify-root-clean (merge-ready)」ステップとして
# マージ準備完了状態（draft == false）のPRに対する事前ゲートからも同一ロジックのまま呼び出す
# （ISSUE-590、ADR-0046）。呼び出し元が増えても本スクリプト自体の動作・出力仕様は変更しない。
#
# 本スクリプトは agent-skill-chain CLI（src/agents-md.ts、ビルド後 bin/agents-md.js）の
# `verify root-clean` サブコマンドへの薄いラッパーである（使い方は `verify root-clean -h` 参照）。

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

exec "${CLI[@]}" verify root-clean "$@"
