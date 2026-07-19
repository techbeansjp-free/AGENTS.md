#!/usr/bin/env bash
# build-plugin-claude.sh — 後方互換ラッパ。
#
# Claude プラグイン生成は build-adapters.sh に一般化された。本スクリプトは既存の呼び出し
# （npm scripts.build:claude / marketplace 手順 / docs/maintainer/adapters.md の記述）を
# 壊さないため、build-adapters.sh claude を呼ぶ薄いラッパとして残す。
# 参照: .agent-skill-chain/source/scripts/build-adapters.sh, docs/maintainer/adapters.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/build-adapters.sh" claude
