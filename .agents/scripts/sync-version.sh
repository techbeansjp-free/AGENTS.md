#!/usr/bin/env bash
# sync-version.sh — package.json と plugin.json の version 整合を 1 か所で担保する。
#
# 責務（単一）: version の「正本」を package.json とし、Claude プラグインの手書き正本
#   .agents/platforms/claude/plugin.json の version と一致させる/検証する。
#
# モード:
#   --check （既定）: 両 version を比較し、一致で 0・不一致で 1 を返す（CI のゲート用）。
#   --write          : package.json の version を plugin.json に注入して揃える（保守者用の補助）。
#
# 設計上の不変条件:
#   - version の正本は package.json 1 か所。plugin.json は従属。
#   - build-adapters.sh は plugin.json を「そのままコピー」して .adapters/claude へ出すため、
#     plugin.json を本スクリプトで揃えておけば「同一入力→同一出力」の決定性は保たれる
#     （build 側に version 注入ロジックを持ち込まない＝差分ゼロ検証と両立する）。
#
# 依存: node（JSON の読み書き）。package.json/plugin.json は本リポの既定配置を前提とする。
# 参照: docs/maintainer/workflow/20260614_124435_配布とパッケージ構成の再設計/03_実装計画.md §2.5(3)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"   # .agents/scripts -> repo root
PKG_JSON="$REPO_ROOT/package.json"
PLUGIN_JSON="$REPO_ROOT/.agents/platforms/claude/plugin.json"

command -v node >/dev/null 2>&1 || { echo "エラー: node が必要です（version の読み書きに使用）" >&2; exit 2; }
[[ -f "$PKG_JSON" ]]    || { echo "エラー: package.json が見つかりません: $PKG_JSON" >&2; exit 2; }
[[ -f "$PLUGIN_JSON" ]] || { echo "エラー: plugin.json が見つかりません: $PLUGIN_JSON" >&2; exit 2; }

read_version() {
  node -e 'const fs=require("fs");process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version||""))' "$1"
}

MODE="${1:---check}"

PKG_VER="$(read_version "$PKG_JSON")"
PLUGIN_VER="$(read_version "$PLUGIN_JSON")"

case "$MODE" in
  --check)
    echo "[sync-version] package.json: $PKG_VER / plugin.json: $PLUGIN_VER"
    if [[ "$PKG_VER" != "$PLUGIN_VER" ]]; then
      echo "エラー: version が一致しません（正本=package.json）。'.agents/scripts/sync-version.sh --write' で揃えてください。" >&2
      exit 1
    fi
    echo "[sync-version] OK: version 一致（$PKG_VER）"
    ;;
  --write)
    if [[ "$PKG_VER" == "$PLUGIN_VER" ]]; then
      echo "[sync-version] 既に一致（$PKG_VER）。変更なし。"
      exit 0
    fi
    node -e '
      const fs=require("fs");
      const p=process.argv[1], v=process.argv[2];
      const j=JSON.parse(fs.readFileSync(p,"utf8"));
      j.version=v;
      fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
    ' "$PLUGIN_JSON" "$PKG_VER"
    echo "[sync-version] plugin.json の version を $PLUGIN_VER -> $PKG_VER に更新しました。"
    ;;
  *)
    echo "使い方: sync-version.sh [--check|--write]" >&2
    exit 2
    ;;
esac
