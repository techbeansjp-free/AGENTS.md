#!/usr/bin/env bash
# test-build-adapters-apm.sh — build-adapters.sh apm（adapter_apm()）・.gitignore の回帰テスト。
#
# ユースケース（このテストファイル全体）:
#   npm 公開中止・APM 転換 issue（03_実装計画 タスク2・タスク3）で追加した adapter_apm() が、
#   (1) 正本 .agent-skill-chain/source/skills/ のスキル件数と .apm/skills/ の配備件数が一致すること、
#   (2) 同一入力に対して再生成しても .apm/ の内容が bit-for-bit 一致する（決定性）こと、
#   (3) .apm/skills/agent-skill-chain-full/SKILL.md が存在し frontmatter name が正しいこと、
#   (4) 既存 .adapters/claude・.adapters/cursor が adapter_apm() 実行前後で変化しないこと（境界の遵守）、
#   (5) agent-skill-chain-full の同梱物に保守/導入専用スクリプトが含まれないこと（除外規則の踏襲）、
#   (6) apm.yml・.apm/ が .gitignore により追跡候補に入らないこと、
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
#   - 本開発リポの .agent-skill-chain/source/ .claude/ .cursor/ .adapters/
#     .agent-skill-chain/runtime/ workflow.db を一切変更しない。
#
# 使い方:
#   bash test/test-build-adapters-apm.sh   # リポジトリルート（git ツリー内。HEAD に対象コミット必須）
#   npm test                               # run-all.sh 経由
#
# 前提: bash・git・tar。
# 参照:
#   docs/maintainer/workflow/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/
#     20260711_024021_npm公開中止_APM転換/03_実装計画.md §2.2, §2.3
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"

command -v git >/dev/null 2>&1 || { echo "エラー: git が必要です" >&2; exit 2; }
command -v tar >/dev/null 2>&1 || { echo "エラー: tar が必要です" >&2; exit 2; }

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

BUILD_SH="$TMP/.agent-skill-chain/source/scripts/build-adapters.sh"
[[ -f "$BUILD_SH" ]] || { echo "エラー: 隔離環境に build-adapters.sh がありません（未追跡？）" >&2; exit 2; }

# =====================================================================================
echo "== シナリオ: 正本スキル件数と apm 配備件数が一致する =="
# Given: .agent-skill-chain/source/skills 配下の SKILL.md 件数を数える
N=$(find "$TMP/.agent-skill-chain/source/skills" -name SKILL.md | wc -l | tr -d ' ')

# When: bash build-adapters.sh apm を実行する
( cd "$TMP" && bash "$BUILD_SH" apm ) >"$TMP/build1.log" 2>&1
RC=$?
[[ $RC -eq 0 ]] && ok "build-adapters.sh apm が exit 0 で完了する" || ng "build-adapters.sh apm が非 0 終了（$RC）"

# Then: {domain}__{capability} 形式のディレクトリが N 件生成される（agent-skill-chain-full を除く）
M=$(find "$TMP/.apm/skills" -mindepth 1 -maxdepth 1 -type d ! -name agent-skill-chain-full 2>/dev/null | wc -l | tr -d ' ')
[[ "$N" -eq "$M" ]] && ok "配備件数が正本件数と一致（N=$N M=$M）" || ng "配備件数が不一致（N=$N M=$M）"

# And: .apm/skills/agent-skill-chain-full/SKILL.md が存在し frontmatter name が正しい
BUNDLE_SKILL="$TMP/.apm/skills/agent-skill-chain-full/SKILL.md"
[[ -f "$BUNDLE_SKILL" ]] && ok "agent-skill-chain-full/SKILL.md が存在する" || ng "agent-skill-chain-full/SKILL.md が存在しない"
if [[ -f "$BUNDLE_SKILL" ]]; then
  grep -q '^name: agent-skill-chain-full$' "$BUNDLE_SKILL" && ok "frontmatter name が agent-skill-chain-full" || ng "frontmatter name が不正"
fi

# =====================================================================================
echo "== シナリオ: 再生成の決定性（diff ゼロ） =="
# Given: build-adapters.sh apm を1回実行済み（上記）である
find "$TMP/.apm" "$TMP/apm.yml" -type f -exec sha256sum {} \; 2>/dev/null | sed "s|$TMP/||" | sort > "$TMP/hash1.txt"

# When: 同一正本に対してもう一度実行する
( cd "$TMP" && bash "$BUILD_SH" apm ) >"$TMP/build2.log" 2>&1

# Then: .apm/ ツリーの内容（ファイル一覧・各ファイルのハッシュ）が前回と完全一致する
find "$TMP/.apm" "$TMP/apm.yml" -type f -exec sha256sum {} \; 2>/dev/null | sed "s|$TMP/||" | sort > "$TMP/hash2.txt"
if diff -q "$TMP/hash1.txt" "$TMP/hash2.txt" >/dev/null 2>&1; then
  ok "再生成しても .apm/ の内容が完全一致（決定性）"
else
  ng "再生成で .apm/ の内容に差分あり（非決定性）"
fi

# =====================================================================================
echo "== シナリオ: agent-skill-chain-full の同梱物に保守/導入専用スクリプトが含まれない =="
# Given/When: 上記で生成済みの reference/.agent-skill-chain/source/scripts/ を確認する
REF_SCRIPTS="$TMP/.apm/skills/agent-skill-chain-full/reference/.agent-skill-chain/source/scripts"
for excluded in setup.sh build-plugin-claude.sh build-adapters.sh sync-version.sh verify-npm-pack.sh; do
  if [[ -f "$REF_SCRIPTS/$excluded" ]]; then
    ng "除外漏れ: $excluded が同梱されている"
  else
    ok "除外規則どおり: $excluded は同梱されない"
  fi
done
if [[ -d "$REF_SCRIPTS/lib" ]]; then
  ng "除外漏れ: scripts/lib/ が同梱されている"
else
  ok "除外規則どおり: scripts/lib/ は同梱されない"
fi

# =====================================================================================
echo "== シナリオ: .adapters/claude・.adapters/cursor が adapter_apm() 実行前後で変化しない =="
# Given: claude/cursor アダプタを先に生成する
( cd "$TMP" && bash "$BUILD_SH" claude cursor ) >"$TMP/build_cc.log" 2>&1
find "$TMP/.adapters" -type f -exec sha256sum {} \; 2>/dev/null | sed "s|$TMP/||" | sort > "$TMP/adapters_hash_before.txt"

# When: apm アダプタを実行する
( cd "$TMP" && bash "$BUILD_SH" apm ) >"$TMP/build3.log" 2>&1

# Then: .adapters/ の内容が変化しない（境界の遵守）
find "$TMP/.adapters" -type f -exec sha256sum {} \; 2>/dev/null | sed "s|$TMP/||" | sort > "$TMP/adapters_hash_after.txt"
if diff -q "$TMP/adapters_hash_before.txt" "$TMP/adapters_hash_after.txt" >/dev/null 2>&1; then
  ok ".adapters/claude・.adapters/cursor は apm 実行前後で不変"
else
  ng ".adapters/ が apm 実行により変化した（境界違反）"
fi

# 複合実行（claude cursor apm）も動作することを確認する。
( cd "$TMP" && bash "$BUILD_SH" claude cursor apm ) >"$TMP/build_combo.log" 2>&1
RC=$?
[[ $RC -eq 0 ]] && ok "複合実行 'claude cursor apm' が exit 0 で完了する" || ng "複合実行が非 0 終了（$RC）"

# =====================================================================================
echo "== シナリオ: apm.yml と .apm/ が git 追跡対象に入らない（.gitignore） =="
# Given: tmp隔離クローン（git archive には .git が無いため git init して .gitignore を有効化する）で
#        build-adapters.sh apm を実行済みにする（上記で実行済み）
( cd "$TMP" && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init )

# When: git status を確認する
STATUS="$( cd "$TMP" && git status --porcelain --ignored=no )"

# Then: apm.yml/.apm/ が追跡候補に含まれないことを確認する
if echo "$STATUS" | grep -q "apm\.yml"; then
  ng "apm.yml が追跡候補に現れる（.gitignore 未反映）"
else
  ok "apm.yml は追跡候補に現れない（.gitignore 反映済み）"
fi
if echo "$STATUS" | grep -q "\.apm/"; then
  ng ".apm/ が追跡候補に現れる（.gitignore 未反映）"
else
  ok ".apm/ は追跡候補に現れない（.gitignore 反映済み）"
fi

# --- サマリ -----------------------------------------------------------------------
echo "--------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
exit 0
