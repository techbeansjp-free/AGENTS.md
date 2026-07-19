#!/usr/bin/env bash
# test-sync-version-apm.sh — sync-version.sh の apm.yml 拡張（3 者 version 同期）の回帰テスト。
#
# ユースケース（このテストファイル全体）:
#   npm 公開中止・APM 転換 issue（03_実装計画 タスク4）で拡張した sync-version.sh が、
#   (1) --write で package.json の version を plugin.json・apm.yml の両方へ同期すること、
#   (2) apm.yml は version: 行のみを置換し、他フィールド（name/description/license 等）が
#       変化しないこと、
#   (3) 3 者が一致している状態で --check が exit 0 になること、
#   (4) apm.yml だけ不一致にした状態で --check が非 0 で終了すること、
#   を検証する。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - mktemp -d ＋ git ls-files -z | tar のクリーン clone で実行する（自己拡張ワークフロー.md
#     §テストの tmp 隔離）。git archive HEAD ではなく git ls-files（tar は追跡ファイルを作業ツリーの
#     現在の内容で読む）を使うことで、未コミット（staged/unstaged）の変更を含めて再現する
#     （参考パターン: test/e2e-install-uninstall.sh・test/test-cli-audit-doctor.sh・
#     test/test-c4-bypass-resistance.sh・test/test-pretooluse-hook.sh）。ただし git ls-files は
#     未追跡（新規 `git add` 前）ファイルを含まないため、新設の
#     .agent-skill-chain/source/platforms/apm/ は明示的にオーバーレイする。
#   - 本開発リポの package.json・.agent-skill-chain/source/platforms/ を一切変更しない。
#
# 使い方:
#   bash test/test-sync-version-apm.sh   # リポジトリルート（git ツリー内。HEAD に対象コミット必須）
#   npm test                             # run-all.sh 経由
#
# 前提: bash・git・tar・node（version の読み書きに使用）。
# 参照:
#   docs/maintainer/workflow/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/
#     20260711_024021_npm公開中止_APM転換/03_実装計画.md §2.4
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"

command -v git >/dev/null 2>&1  || { echo "エラー: git が必要です" >&2; exit 2; }
command -v tar >/dev/null 2>&1  || { echo "エラー: tar が必要です" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "エラー: node が必要です" >&2; exit 2; }

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }

# --- tmp 隔離環境（クリーン clone 再現・作業ツリーの未コミット変更をオーバーレイ）--------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
( cd "$REPO_ROOT" && git ls-files -z | tar --null -T - -cf - ) | tar -x -C "$TMP"
# 新設（未追跡）の apm プラットフォーム定義を明示的にオーバーレイする（git ls-files は
# `git add` 前の新規ファイルを含まないため）。
mkdir -p "$TMP/.agent-skill-chain/source/platforms/apm"
cp -a "$REPO_ROOT/.agent-skill-chain/source/platforms/apm/." "$TMP/.agent-skill-chain/source/platforms/apm/"

SYNC_SH="$TMP/.agent-skill-chain/source/scripts/sync-version.sh"
APM_YML="$TMP/.agent-skill-chain/source/platforms/apm/apm.yml"
PLUGIN_JSON="$TMP/.agent-skill-chain/source/platforms/claude/plugin.json"
PKG_JSON="$TMP/package.json"
[[ -f "$SYNC_SH" ]] || { echo "エラー: 隔離環境に sync-version.sh がありません（未追跡？）" >&2; exit 2; }
[[ -f "$APM_YML" ]] || { echo "エラー: 隔離環境に apm.yml がありません（オーバーレイ失敗？）" >&2; exit 2; }

# =====================================================================================
echo "== シナリオ: 3 者が一致している初期状態で --check が exit 0 =="
# Given/When: 初期状態（package.json = plugin.json = apm.yml）で --check する
( cd "$TMP" && bash "$SYNC_SH" --check ) >/dev/null 2>&1
RC=$?
[[ $RC -eq 0 ]] && ok "初期状態で --check が exit 0" || ng "初期状態で --check が非 0 終了（$RC）"

# =====================================================================================
echo "== シナリオ: --write で apm.yml の version が同期される =="
# Given: package.json の version を変更する
BEFORE_APM_NAME="$(grep '^name:' "$APM_YML")"
BEFORE_APM_LICENSE="$(grep '^license:' "$APM_YML")"
BEFORE_APM_DESC="$(grep '^description:' "$APM_YML")"
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1]));p.version='9.9.9';fs.writeFileSync(process.argv[1],JSON.stringify(p,null,2)+'\n');" "$PKG_JSON"

# When: --write を実行する
( cd "$TMP" && bash "$SYNC_SH" --write ) >"$TMP/write.log" 2>&1
RC=$?
[[ $RC -eq 0 ]] && ok "--write が exit 0" || ng "--write が非 0 終了（$RC）"

# Then: apm.yml の version フィールドが同期される
if grep -q '^version: 9.9.9$' "$APM_YML"; then
  ok "apm.yml の version が package.json と同期された"
else
  ng "apm.yml の version が同期されていない: $(grep '^version:' "$APM_YML")"
fi

# And: plugin.json の version も同期される
if grep -q '"version": "9.9.9"' "$PLUGIN_JSON"; then
  ok "plugin.json の version が package.json と同期された"
else
  ng "plugin.json の version が同期されていない"
fi

# And: apm.yml の他フィールドは変化しない（version: 行のみを置換）
AFTER_APM_NAME="$(grep '^name:' "$APM_YML")"
AFTER_APM_LICENSE="$(grep '^license:' "$APM_YML")"
AFTER_APM_DESC="$(grep '^description:' "$APM_YML")"
[[ "$BEFORE_APM_NAME" == "$AFTER_APM_NAME" ]] && ok "apm.yml の name フィールドは不変" || ng "apm.yml の name フィールドが変化した"
[[ "$BEFORE_APM_LICENSE" == "$AFTER_APM_LICENSE" ]] && ok "apm.yml の license フィールドは不変" || ng "apm.yml の license フィールドが変化した"
[[ "$BEFORE_APM_DESC" == "$AFTER_APM_DESC" ]] && ok "apm.yml の description フィールドは不変" || ng "apm.yml の description フィールドが変化した"

# =====================================================================================
echo "== シナリオ: 3 者一致後の --check が exit 0 =="
( cd "$TMP" && bash "$SYNC_SH" --check ) >/dev/null 2>&1
RC=$?
[[ $RC -eq 0 ]] && ok "--write 後の --check が exit 0" || ng "--write 後の --check が非 0 終了（$RC）"

# =====================================================================================
echo "== シナリオ: apm.yml のみ不一致にすると --check が非 0 で終了する =="
# Given: apm.yml の version だけを package.json と異なる値にする
node -e '
  const fs=require("fs");
  const p=process.argv[1];
  const text=fs.readFileSync(p,"utf8");
  fs.writeFileSync(p, text.replace(/^version:\s*\S+\s*$/m, "version: 1.2.3"));
' "$APM_YML"

# When: --check を実行する
( cd "$TMP" && bash "$SYNC_SH" --check ) >/dev/null 2>&1
RC=$?

# Then: 終了コードが非 0 である
[[ $RC -ne 0 ]] && ok "apm.yml のみ不一致で --check が非 0 終了（RC=$RC）" || ng "不一致にもかかわらず --check が exit 0"

# --- サマリ -----------------------------------------------------------------------
echo "--------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
exit 0
