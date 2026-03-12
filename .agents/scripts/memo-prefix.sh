#!/usr/bin/env bash
# memo-prefix.sh — memo ファイル名用 YYYYMMDD_HHMMSS_ プレフィックスの専用取得経路
#
# 目的:
# - memo 用プレフィックスを **実行時のシステム時計（JST）のみ** から取得する。
# - 手入力・固定値・AI の推測によるプレフィックス生成を排除する。
#
# 使い方:
#   prefix=$(./AGENTS-spec/.agents/scripts/memo-prefix.sh)
#   例: .workflow/{issue}/memo/${prefix}証跡.md
#
# 出力: YYYYMMDD_HHMMSS 形式の 1 行（末尾に _ は付けない。呼び出し側で付与可）。
#
# 禁止: 本スクリプトに日時文字列を引数で渡してはならない。プレフィックスはこのスクリプトまたは
#       TZ=Asia/Tokyo date +%Y%m%d_%H%M%S の実行でのみ取得すること。

set -euo pipefail

if [[ "${TZ:-}" == "" ]]; then
  export TZ="Asia/Tokyo"
fi

date +%Y%m%d_%H%M%S
