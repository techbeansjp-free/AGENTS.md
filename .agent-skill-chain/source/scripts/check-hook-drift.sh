#!/usr/bin/env bash
# check-hook-drift.sh — 配備済み .claude/hooks/* が正本 enforcement/claude/* と一致するかを検知する（read-only）。
#
# 背景: 採用先の .claude/ は setup/upgrade による生成物であり各採用先で .gitignore 対象である。
#   正本（.agent-skill-chain/source/enforcement/claude/）を修正しても、採用先で upgrade を再実行しない
#   限り配備済みファイルへは反映されない。旧版のまま放置されると、正本側で修正済みの既知バグ
#   （例: allowlist 未追従による orchestrator 完全ロックアウト）を配備環境で再現しうる。
#   本スクリプトはこの乖離を検知して警告するのみであり、実際の同期（upgrade 実行）は行わない。
#
# 使い方:
#   bash .agent-skill-chain/source/scripts/check-hook-drift.sh [project_root]
#     project_root 省略時は cwd。
#
# 比較対象: enforcement/claude/ 配下のトップレベル通常ファイル（.gitkeep 除く。setup.sh の
#   copy_owned_files と同一規則）と、<project_root>/.claude/hooks/ 配下の同名ファイル。
#   一覧はハードコードせず enforcement/claude/ の実体から動的に導出する（正本の構成変更に追従）。
#
# 終了コード:
#   0: 乖離なし。または <project_root>/.claude/hooks/ が未配備（enforcement 未 opt-in の正常状態のため
#      乖離扱いしない）。
#   1: 乖離あり（内容不一致、または hooks/ は存在するが正本にあるファイルが配備先に無い）。
#   2: 実行前提エラー（正本ディレクトリが見つからない等）。
#
# 対応する運用ルール（.agent-skill-chain/source/enforcement/README.md 参照）:
#   正本 enforcement/claude/ 配下を修正した場合、配備済み環境では `agents-md upgrade`
#   （または setup.sh 再実行）で .claude/hooks/ を同期させること。本スクリプトの実行だけでは
#   同期されない（検知のみ。次の一手として upgrade 実行を促すに留める）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/../enforcement/claude"

PROJECT_ROOT="${1:-$(pwd)}"
DEPLOY_DIR="$PROJECT_ROOT/.claude/hooks"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "エラー: 正本ディレクトリが見つかりません: $SOURCE_DIR" >&2
  exit 2
fi
SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"

# hash_of: 引数のファイルの sha256 を返す（sha256sum が無い環境では shasum -a 256 にフォールバック）。
hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

if [[ ! -d "$DEPLOY_DIR" ]]; then
  echo "[INFO] $DEPLOY_DIR が存在しません（enforcement 未配備、または opt-in 前の環境）。乖離チェック対象外として終了します。"
  exit 0
fi

exit_code=0
checked=0

for f in "$SOURCE_DIR"/*; do
  [[ -f "$f" ]] || continue
  base="$(basename "$f")"
  [[ "$base" == ".gitkeep" ]] && continue
  checked=$((checked + 1))
  deployed="$DEPLOY_DIR/$base"

  if [[ ! -f "$deployed" ]]; then
    echo "[DRIFT] $base: 配備先に存在しません（$deployed）。upgrade 未実行の可能性があります。"
    exit_code=1
    continue
  fi

  src_hash="$(hash_of "$f")"
  dep_hash="$(hash_of "$deployed")"
  if [[ "$src_hash" != "$dep_hash" ]]; then
    echo "[DRIFT] $base: 正本と配備済みファイルの内容が一致しません。"
    echo "        正本   : $f"
    echo "        配備先 : $deployed"
    exit_code=1
  else
    echo "[OK]    $base: 正本と一致"
  fi
done

if [[ "$checked" -eq 0 ]]; then
  echo "[WARN] 比較対象ファイルが見つかりませんでした（$SOURCE_DIR が空です）。"
fi

echo
if [[ "$exit_code" -eq 0 ]]; then
  echo "check-hook-drift: 乖離なし。"
else
  echo "check-hook-drift: 乖離を検知しました（上記 [DRIFT] を参照）。"
  echo "  正本を確認のうえ、対象環境で 'agents-md upgrade'（または setup.sh 再実行）を"
  echo "  実行して .claude/hooks/ を同期してください（本スクリプトは検知のみで同期は行いません）。"
  echo "  稼働中の他セッションに影響する可能性があるため、実行タイミングはユーザーの許可を得て判断してください。"
fi

exit "$exit_code"
