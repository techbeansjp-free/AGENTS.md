#!/usr/bin/env bash
# test-check-comment-refs.sh — check-comment-refs.sh の単体/結合テスト（tmp 隔離）。
#
# ユースケース（このテストファイル全体）:
#   コメント外部参照禁止規約の検出ロジック単一正本（check-comment-refs.sh）が、禁止パターン
#   （章節番号・追跡番号・ドキュメント名。全角名を含む）を含むコメント行を検出して非 0 で終了し、
#   許可される参照（コードパス・シンボル・import 行）を誤検出せず、走査対象 0 件で 0 終了すること。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - 検証は mktemp -d の隔離ツリーで行う。本開発リポの追跡物を一切読み書き・変更しない
#     （検証対象スクリプト本体のみ読み取りで参照する）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-check-comment-refs.sh   # リポジトリルートで実行
#
# 前提: bash・awk・grep（find は coreutils/findutils 前提）。
# 参照:
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
REFS="$REPO_ROOT/.agent-skill-chain/source/enforcement/ci/check-comment-refs.sh"

[[ -f "$REFS" ]] || { echo "エラー: check-comment-refs.sh が見つからない: $REFS" >&2; exit 2; }

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }

TMP_DIRS=()
cleanup() { for d in "${TMP_DIRS[@]:-}"; do [[ -n "$d" && -d "$d" ]] && rm -rf "$d"; done; }
trap cleanup EXIT

mk() { local t; t="$(mktemp -d)"; TMP_DIRS+=("$t"); printf '%s\n' "$t"; }

echo "== test-check-comment-refs.sh =="

# シナリオ: 引数なしは使用方法エラー（exit 2）
# Given: 引数を 1 つも渡さない
# When:  check-comment-refs.sh を実行する
# Then:  終了コードが 2
bash "$REFS" >/dev/null 2>&1; rc=$?
if [[ $rc -eq 2 ]]; then ok "引数なしで exit 2"; else ng "引数なしで exit 2（実際 rc=$rc）"; fi

# シナリオ: 実在しないパスは警告して読み飛ばし exit 0
# Given: 実在しないパスのみを渡す
# When:  check-comment-refs.sh を実行する
# Then:  終了コードが 0（違反なし扱い）
out="$(bash "$REFS" /nonexistent/xyz 2>/dev/null)"; rc=$?
if [[ $rc -eq 0 && -z "$out" ]]; then ok "実在しないパスのみで exit 0（違反出力なし）"; else ng "実在しないパスで exit 0 でない（rc=$rc, out=$out）"; fi

# シナリオ: 全角名で終わるドキュメント名を含む YAML コメントを検出（ADR-6）
# Given: tmp 隔離ディレクトリに "# 正本: docs/x/02_設計.md" を含む a.yml
# When:  check-comment-refs.sh に当該ディレクトリを渡す
# Then:  終了コードが 1 であり、標準出力に "a.yml:1" が含まれる
T="$(mk)"
printf '%s\n' '# 正本: docs/x/02_設計.md' > "$T/a.yml"
out="$(bash "$REFS" "$T" 2>/dev/null)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q "a.yml:1" <<< "$out"; then ok "全角名ドキュメント参照を検出（exit 1・a.yml:1）"; else ng "全角名ドキュメント参照を検出できない（rc=$rc, out=$out）"; fi

# シナリオ: 章節番号・追跡番号を各々検出
# Given: "# §3.2 参照" の b.yml と "# Issue #42 対応" の c.yml
# When:  各ファイルを渡す
# Then:  いずれも exit 1
T="$(mk)"
printf '%s\n' '# §3.2 参照' > "$T/b.yml"
printf '%s\n' '# Issue #42 対応' > "$T/c.yml"
bash "$REFS" "$T/b.yml" >/dev/null 2>&1; rc=$?
if [[ $rc -eq 1 ]]; then ok "章節番号（§3.2）を検出（exit 1）"; else ng "章節番号を検出できない（rc=$rc）"; fi
bash "$REFS" "$T/c.yml" >/dev/null 2>&1; rc=$?
if [[ $rc -eq 1 ]]; then ok "追跡番号（Issue #42）を検出（exit 1）"; else ng "追跡番号を検出できない（rc=$rc）"; fi

# シナリオ: 許可参照（コードパス・シンボル・import 行）は誤検出しない
# Given: コードパス参照/シンボル参照/import 行のみを含むファイル群
# When:  当該ディレクトリを渡す
# Then:  終了コードが 0・違反 0 件
T="$(mk)"
printf '%s\n' '# 詳細は scripts/sync-version.sh を参照' > "$T/d.sh"
printf '%s\n' '# build_index() を呼ぶ' > "$T/e.sh"
printf '%s\n' 'import foo  # from spec.md' > "$T/f.py"
out="$(bash "$REFS" "$T" 2>/dev/null)"; rc=$?
if [[ $rc -eq 0 && -z "$out" ]]; then ok "許可参照（コードパス/シンボル/import 行）を誤検出しない（exit 0）"; else ng "許可参照を誤検出した（rc=$rc, out=$out）"; fi

# シナリオ: 別拡張子（.mdc）を .md と誤認しない（拡張子境界）
# Given: ".cursor/rules/*.mdc を参照" のように .mdc を含むが .md 参照ではないコメントの h.sh
# When:  当該ファイルを渡す
# Then:  終了コードが 0（.mdc は .md 拡張子ではないため誤検出しない）
T="$(mk)"
printf '%s\n' '# .cursor/rules/*.mdc・.claude/settings.json を保持する' > "$T/h.sh"
out="$(bash "$REFS" "$T/h.sh" 2>/dev/null)"; rc=$?
if [[ $rc -eq 0 && -z "$out" ]]; then ok "別拡張子 .mdc を .md と誤認しない（exit 0）"; else ng ".mdc を誤検出した（rc=$rc, out=$out）"; fi

# シナリオ: .yml と .sh の混在ツリーで違反ファイルのみ列挙（結合）
# Given: 違反を含む a.yml/g.sh と、違反を含まない ok.sh が同一ツリーにある
# When:  当該ディレクトリを渡す
# Then:  a.yml と g.sh のみが列挙され ok.sh は列挙されない・exit 1
T="$(mk)"
printf '%s\n' '# 正本: docs/y/03_実装計画.md' > "$T/a.yml"
printf '%s\n' '# 第4節 を参照' > "$T/g.sh"
printf '%s\n' '# scripts/build.sh を呼ぶ' > "$T/ok.sh"
out="$(bash "$REFS" "$T" 2>/dev/null)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q "a.yml:1" <<< "$out" && grep -q "g.sh:1" <<< "$out" && ! grep -q "ok.sh" <<< "$out"; then
  ok "混在ツリーで違反ファイルのみ列挙（a.yml/g.sh のみ・ok.sh 非列挙）"
else
  ng "混在ツリーの列挙が期待と異なる（rc=$rc, out=$out）"
fi

# シナリオ: 走査対象 0 件（空ディレクトリ）で exit 0
# Given: 対象拡張子のファイルが 1 つも無い空ディレクトリ
# When:  当該ディレクトリを渡す
# Then:  終了コードが 0
T="$(mk)"
out="$(bash "$REFS" "$T" 2>/dev/null)"; rc=$?
if [[ $rc -eq 0 && -z "$out" ]]; then ok "空ディレクトリで exit 0（走査対象 0 件）"; else ng "空ディレクトリで exit 0 でない（rc=$rc, out=$out）"; fi

echo
echo "== 結果: PASS=$PASS FAIL=$FAIL =="
if [[ $FAIL -gt 0 ]]; then
  printf '  失敗: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
exit 0
