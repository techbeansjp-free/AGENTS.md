#!/usr/bin/env bash
# test-run-all.sh — run-all.sh（一括 runner）の単体/結合テスト。
#
# ユースケース（このテストファイル全体）:
#   一括 runner run-all.sh が、各テストの終了コードを 02_設計 §5 の規約（0=PASS / 2=SKIP / その他=FAIL）で
#   集約し、(1) 1 件でも FAIL なら非 0 で終了、(2) SKIP は失敗扱いにせず継続・全成功なら 0、
#   (3) 必須依存欠如時はクラッシュせず当該を SKIP 案内し残りを実行、(4) 既存 4 本の個別実行が
#   runner 導入前と変わらず可能、であることを検証する。検証ロジックは再実装せず runner の振る舞いを確認する。
#
# 方針（破壊禁止・tmp 隔離 必須・.agents-project/自己拡張ワークフロー.md §テストの tmp 隔離）:
#   - 集約ロジックの検証は exit 0/1/2 を返す stub を mktemp -d 配下に並べ、RUN_ALL_TESTS_OVERRIDE で
#     一覧を差し替えて実行する（高速・決定的）。本番 DB・開発リポを一切読み書き・変更しない。
#   - 必須依存欠如シナリオは PATH から依存を除いた擬似環境で実行する。
#   - 本開発リポの .agents/ .claude/ .cursor/ .workflow/ workflow.db を一切変更しない。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-run-all.sh   # リポジトリルートで実行
#
# 前提: bash。
# 参照:
#   docs/maintainer/workflow/20260615_054806_テスト実行基盤の整備/02_設計.md（§5）, 03_実装計画.md（T3）
#   .agents/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"   # test/ -> repo root（配置非依存）
RUNNER="$SCRIPT_DIR/run-all.sh"

[[ -f "$RUNNER" ]] || { echo "エラー: run-all.sh が見つからない: $RUNNER" >&2; exit 2; }

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: 期待 '$1' 実際 '$2'}"; }
assert_grep() { grep -q -- "$1" <<<"$2" && ok "${3:-出力に '$1'}" || ng "${3:-出力に '$1' が無い}"; }
assert_no_grep() { grep -q -- "$1" <<<"$2" && ng "${3:-出力に '$1' があってはならない}" || ok "${3:-出力に '$1' なし}"; }

# 隔離ツリーをまとめて掃除する
TMP_DIRS=()
cleanup() { for d in "${TMP_DIRS[@]:-}"; do [[ -n "$d" && -d "$d" ]] && rm -rf "$d"; done; }
trap cleanup EXIT

# exit <code> を返す stub を tmp に作り、絶対パスを返す
make_stub() {
  local dir="$1" name="$2" code="$3" f
  f="$dir/$name.sh"
  printf '#!/usr/bin/env bash\nexit %s\n' "$code" > "$f"
  chmod +x "$f"
  printf '%s' "$f"
}

# OVERRIDE 文字列を組み立てる（"name|path|deps" を ';' で連結）
mk_override() { local IFS=';'; printf '%s' "$*"; }

# ============================================================================
# ユースケース1: 終了コードの集約（stub 群を tmp 隔離で並べる）
# ============================================================================

# シナリオ: 全 stub が exit 0 のとき FAIL=0・exit 0
test_all_pass() {
  # Given: 成功(exit 0)を返す stub を tmp に 3 つ並べ、一覧を override で差し替える
  local tmp; tmp="$(mktemp -d)"; TMP_DIRS+=("$tmp")
  local a b c
  a="$(make_stub "$tmp" t1 0)"; b="$(make_stub "$tmp" t2 0)"; c="$(make_stub "$tmp" t3 0)"
  local ov; ov="$(mk_override "t1|$a|bash" "t2|$b|bash" "t3|$c|bash")"

  # When: runner を override 付きで実行する
  local out code=0
  out="$(RUN_ALL_TESTS_OVERRIDE="$ov" bash "$RUNNER" 2>&1)" || code=$?

  # Then: FAIL=0・exit 0・3 件 PASS
  assert_eq 0 "$code" "全成功で exit 0"
  assert_grep "合計=3 PASS=3 FAIL=0 SKIP=0" "$out" "サマリが 3 PASS"
}

# シナリオ: 1 件が exit 1（FAIL）のとき非 0・継続して後続も実行
test_one_fail_continues() {
  # Given: 成功・失敗(exit 1)・成功 の順で stub を並べる
  local tmp; tmp="$(mktemp -d)"; TMP_DIRS+=("$tmp")
  local a b c
  a="$(make_stub "$tmp" t1 0)"; b="$(make_stub "$tmp" t2 1)"; c="$(make_stub "$tmp" t3 0)"
  local ov; ov="$(mk_override "t1|$a|bash" "t2|$b|bash" "t3|$c|bash")"

  # When: runner を実行する
  local out code=0
  out="$(RUN_ALL_TESTS_OVERRIDE="$ov" bash "$RUNNER" 2>&1)" || code=$?

  # Then: exit 1・FAIL=1・失敗名 t2 表示・3 件すべて実行（PASS=2 で継続が確認できる）
  assert_eq 1 "$code" "1 件 FAIL で exit 1"
  assert_grep "合計=3 PASS=2 FAIL=1 SKIP=0" "$out" "サマリが FAIL=1"
  assert_grep "失敗: t2" "$out" "失敗名 t2 を列挙"
  assert_grep "\[RUN\] t3" "$out" "FAIL 後も後続 t3 を実行（継続）"
}

# シナリオ: exit 2 は SKIP に分類され FAIL に数えず exit 0
test_exit2_is_skip() {
  # Given: 成功・SKIP(exit 2)・成功 の順で stub を並べる
  local tmp; tmp="$(mktemp -d)"; TMP_DIRS+=("$tmp")
  local a b c
  a="$(make_stub "$tmp" t1 0)"; b="$(make_stub "$tmp" t2 2)"; c="$(make_stub "$tmp" t3 0)"
  local ov; ov="$(mk_override "t1|$a|bash" "t2|$b|bash" "t3|$c|bash")"

  # When: runner を実行する
  local out code=0
  out="$(RUN_ALL_TESTS_OVERRIDE="$ov" bash "$RUNNER" 2>&1)" || code=$?

  # Then: exit 0・SKIP=1・FAIL=0（SKIP を失敗扱いしない／SC-6）
  assert_eq 0 "$code" "SKIP のみなら exit 0"
  assert_grep "合計=3 PASS=2 FAIL=0 SKIP=1" "$out" "サマリが SKIP=1・FAIL=0"
  assert_grep "\[SKIP\] t2" "$out" "t2 が SKIP 表示"
}

# ============================================================================
# ユースケース2: 必須依存欠如の事前チェック（SKIP 案内・非クラッシュ・継続・非破壊）
# ============================================================================

# シナリオ: 必須依存が無いテストを SKIP し残りを実行する（本番 DB 不変）
test_missing_dep_skips_and_continues() {
  # Given: 実在しない必須依存を要する stub を中間に挟む。本番 DB の現状を記録する
  local tmp; tmp="$(mktemp -d)"; TMP_DIRS+=("$tmp")
  local a b c
  a="$(make_stub "$tmp" t1 0)"; b="$(make_stub "$tmp" t2 0)"; c="$(make_stub "$tmp" t3 0)"
  local ov; ov="$(mk_override "t1|$a|bash" "t2|$b|__no_such_tool__xyz__" "t3|$c|bash")"

  local db="$REPO_ROOT/.workflow/workflow.db"
  local before_sum=""; [[ -f "$db" ]] && before_sum="$(cksum "$db" 2>/dev/null)"

  # When: runner を実行する
  local out code=0
  out="$(RUN_ALL_TESTS_OVERRIDE="$ov" bash "$RUNNER" 2>&1)" || code=$?

  # Then: t2 は SKIP・不足ツール名案内・残り継続・exit 0（FAIL=0）・本番 DB は不変
  assert_eq 0 "$code" "必須依存欠如でもクラッシュせず exit 0"
  assert_grep "\[SKIP\] t2: 必須依存 __no_such_tool__xyz__ なし" "$out" "不足ツール名を案内"
  assert_grep "\[RUN\] t3" "$out" "SKIP 後も後続 t3 を実行（継続）"
  assert_grep "PASS=2 FAIL=0 SKIP=1" "$out" "SKIP=1・FAIL=0"
  local after_sum=""; [[ -f "$db" ]] && after_sum="$(cksum "$db" 2>/dev/null)"
  assert_eq "$before_sum" "$after_sum" "本番 workflow.db が runner 実行で不変"
}

# ============================================================================
# ユースケース3: 個別実行の維持（既存 4 本の呼び出し方が runner 導入前と不変）
# ============================================================================

# シナリオ: 既存 4 本が個別に bash 実行可能（実行可能ファイルとして存在する）
test_individual_scripts_intact() {
  # Given: 既存 4 本の想定パス
  local names=(test-audit.sh test-pretooluse-hook.sh test-write-workflow-log-prevhash.sh e2e-install-uninstall.sh)

  # When/Then: 各スクリプトが存在し、bash -n で構文が通る（個別 bash 実行の前提が崩れていない）
  for n in "${names[@]}"; do
    local f="$SCRIPT_DIR/$n"
    if [[ -f "$f" ]] && bash -n "$f" 2>/dev/null; then
      ok "個別実行可能（存在＋構文OK）: $n"
    else
      ng "個別実行できない: $n"
    fi
  done
}

# ============================================================================
# ユースケース4: 出力フォーマット規約（SKIP 表現・サマリ書式）
# ============================================================================

# シナリオ: サマリが `合計=N PASS=p FAIL=f SKIP=s` 形式である
test_summary_format() {
  # Given: 0/1/2 を 1 つずつ返す stub を並べる
  local tmp; tmp="$(mktemp -d)"; TMP_DIRS+=("$tmp")
  local a b c
  a="$(make_stub "$tmp" t1 0)"; b="$(make_stub "$tmp" t2 1)"; c="$(make_stub "$tmp" t3 2)"
  local ov; ov="$(mk_override "t1|$a|bash" "t2|$b|bash" "t3|$c|bash")"

  # When: runner を実行する
  local out code=0
  out="$(RUN_ALL_TESTS_OVERRIDE="$ov" bash "$RUNNER" 2>&1)" || code=$?

  # Then: サマリ書式が規約どおりで、FAIL>0 のため exit 1
  assert_eq 1 "$code" "FAIL を含むため exit 1"
  assert_grep "合計=3 PASS=1 FAIL=1 SKIP=1" "$out" "サマリ書式 合計/PASS/FAIL/SKIP"
}

# ---- 実行 ---------------------------------------------------------------------
echo "== test-run-all.sh =="
test_all_pass
test_one_fail_continues
test_exit2_is_skip
test_missing_dep_skips_and_continues
test_individual_scripts_intact
test_summary_format

echo "--------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
echo "test-run-all.sh: すべて PASS"
exit 0
