#!/usr/bin/env bash
# memo-prefix.sh — memo ファイル名用 YYYYMMDD_HHMMSS_ プレフィックスの専用取得経路
#
# 目的:
# - memo 用プレフィックスを **実行時のシステム時計（JST）のみ** から取得する。
# - 手入力・固定値・AI の推測によるプレフィックス生成を排除する。
#
# 使い方:
#   prefix=$(.agent-skill-chain/source/scripts/memo-prefix.sh)   # パッケージルートを cwd とする場合
#   例: .agent-skill-chain/runtime/{issue}/memo/${prefix}証跡.md
#
# 出力: YYYYMMDD_HHMMSS 形式の 1 行（末尾に _ は付けない。呼び出し側で付与可）。
#
# 禁止: 本スクリプトに日時文字列を引数で渡してはならない。プレフィックスはこのスクリプトまたは
#       TZ=Asia/Tokyo date +%Y%m%d_%H%M%S の実行でのみ取得すること。

set -euo pipefail

# E-12: memo プレフィックスは JST で一意採番する契約のため、呼び出し環境の TZ に依存させない
# （既存 TZ を尊重すると環境ごとに時系列順序が崩れる）。無条件で JST を強制する。
export TZ="Asia/Tokyo"

date +%Y%m%d_%H%M%S
