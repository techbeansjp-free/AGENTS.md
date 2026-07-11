#!/usr/bin/env bash
# sync-version.sh — package.json・plugin.json・apm.yml の version 整合を 1 か所で担保する。
#
# 責務（単一）: version の「正本」を package.json とし、Claude プラグインの手書き正本
#   .agent-skill-chain/source/platforms/claude/plugin.json、および apm（Agent Package Manager）
#   の手書き正本 .agent-skill-chain/source/platforms/apm/apm.yml の version と一致させる/検証する。
#
# モード:
#   --check （既定）: 3 者の version を比較し、一致で 0・不一致で 1 を返す（CI のゲート用）。
#   --write          : package.json の version を plugin.json・apm.yml の両方に注入して揃える
#                      （保守者用の補助）。
#
# 設計上の不変条件:
#   - version の正本は package.json 1 か所。plugin.json・apm.yml は従属。
#   - build-adapters.sh は plugin.json・apm.yml を「そのままコピー」して生成物へ出すため、
#     本スクリプトで揃えておけば「同一入力→同一出力」の決定性は保たれる
#     （build 側に version 注入ロジックを持ち込まない＝差分ゼロ検証と両立する）。
#   - apm.yml は version 行以外のフィールド（name/description/license 等）を変更しない
#     （version: 行のみを正規表現で置換する。JSON 専用の既存実装に対し YAML 用の置換ロジックを追加）。
#
# 依存: node（JSON の読み書き。apm.yml の version 行置換も node の正規表現で行う）。
#   package.json/plugin.json/apm.yml は本リポの既定配置を前提とする。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"   # .agent-skill-chain/source/scripts -> repo root
PKG_JSON="$REPO_ROOT/package.json"
PLUGIN_JSON="$REPO_ROOT/.agent-skill-chain/source/platforms/claude/plugin.json"
APM_YML="$REPO_ROOT/.agent-skill-chain/source/platforms/apm/apm.yml"

command -v node >/dev/null 2>&1 || { echo "エラー: node が必要です（version の読み書きに使用）" >&2; exit 2; }
[[ -f "$PKG_JSON" ]]    || { echo "エラー: package.json が見つかりません: $PKG_JSON" >&2; exit 2; }
[[ -f "$PLUGIN_JSON" ]] || { echo "エラー: plugin.json が見つかりません: $PLUGIN_JSON" >&2; exit 2; }
[[ -f "$APM_YML" ]]     || { echo "エラー: apm.yml が見つかりません: $APM_YML" >&2; exit 2; }

read_version() {
  node -e 'const fs=require("fs");process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version||""))' "$1"
}

# apm.yml（YAML）の version フィールドを行単位の正規表現で読む（他フィールドには触れない）。
read_yaml_version() {
  node -e '
    const fs=require("fs");
    const text=fs.readFileSync(process.argv[1],"utf8");
    const m=text.match(/^version:\s*(\S+)\s*$/m);
    process.stdout.write(m ? m[1] : "");
  ' "$1"
}

# apm.yml の version: 行のみを置換する（他フィールド・コメントは無改変）。
write_yaml_version() {
  local file="$1" version="$2"
  node -e '
    const fs=require("fs");
    const p=process.argv[1], v=process.argv[2];
    const text=fs.readFileSync(p,"utf8");
    const next=text.replace(/^version:\s*\S+\s*$/m, `version: ${v}`);
    fs.writeFileSync(p, next);
  ' "$file" "$version"
}

MODE="${1:---check}"

PKG_VER="$(read_version "$PKG_JSON")"
PLUGIN_VER="$(read_version "$PLUGIN_JSON")"
APM_VER="$(read_yaml_version "$APM_YML")"

case "$MODE" in
  --check)
    echo "[sync-version] package.json: $PKG_VER / plugin.json: $PLUGIN_VER / apm.yml: $APM_VER"
    if [[ "$PKG_VER" != "$PLUGIN_VER" || "$PKG_VER" != "$APM_VER" ]]; then
      echo "エラー: version が一致しません（正本=package.json）。'.agent-skill-chain/source/scripts/sync-version.sh --write' で揃えてください。" >&2
      exit 1
    fi
    echo "[sync-version] OK: version 一致（$PKG_VER）"
    ;;
  --write)
    if [[ "$PKG_VER" == "$PLUGIN_VER" ]]; then
      echo "[sync-version] plugin.json は既に一致（$PKG_VER）。変更なし。"
    else
      node -e '
        const fs=require("fs");
        const p=process.argv[1], v=process.argv[2];
        const j=JSON.parse(fs.readFileSync(p,"utf8"));
        j.version=v;
        fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
      ' "$PLUGIN_JSON" "$PKG_VER"
      echo "[sync-version] plugin.json の version を $PLUGIN_VER -> $PKG_VER に更新しました。"
    fi

    if [[ "$PKG_VER" == "$APM_VER" ]]; then
      echo "[sync-version] apm.yml は既に一致（$PKG_VER）。変更なし。"
    else
      write_yaml_version "$APM_YML" "$PKG_VER"
      echo "[sync-version] apm.yml の version を $APM_VER -> $PKG_VER に更新しました。"
    fi
    ;;
  *)
    echo "使い方: sync-version.sh [--check|--write]" >&2
    exit 2
    ;;
esac
