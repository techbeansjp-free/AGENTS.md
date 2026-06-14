#!/usr/bin/env bash
# test-coverage-check.sh — coverage-check.sh（カバレッジ計測オーケストレータ）の単体/結合テスト。
#
# ユースケース（このテストファイル全体）:
#   coverage-check.sh が 02_設計 §5 の終了コード契約（0=達成 / 1=未達・解析失敗 / 2=kcov 不在 SKIP）と
#   出力規約（全体率・[UNCOVERED] 行）に従うことを検証する。判定部は擬似 cobertura XML を tmp 隔離で
#   食わせ（kcov 実行を伴わない --judge-only）、kcov 不在 SKIP・除外の二重化整合・既定閾値 100 も確認する。
#   kcov 導入環境ではラップ実行で cobertura が生成され除外が分母から外れることも結合検証する（無ければ SKIP）。
#
# 方針（破壊禁止・tmp 隔離 必須・.agents-project/自己拡張ワークフロー.md §テストの tmp 隔離）:
#   - 擬似 cobertura XML は mktemp -d 配下に置き COV_OUT をそこに向ける。本番 DB・開発リポを変更しない。
#   - 本開発リポの .agents/ .claude/ .cursor/ .workflow/ workflow.db を一切変更しない。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash .agents/scripts/test/test-coverage-check.sh   # リポジトリルートで実行
#
# 前提: bash。kcov はラップ結合テストでのみ任意（無ければ当該のみ SKIP）。
# 参照:
#   docs/maintainer/workflow/20260615_054810_カバレッジ計測の自リポ適用/02_設計.md（§6）, 03_実装計画.md（T1〜T5）
#   .agents/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"   # .agents/scripts/test -> repo root
TARGET="$SCRIPT_DIR/coverage-check.sh"
LEDGER="$REPO_ROOT/.agents-project/COVERAGE_EXCEPTIONS.md"

[[ -f "$TARGET" ]] || { echo "エラー: coverage-check.sh が見つからない: $TARGET" >&2; exit 2; }

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: 期待 '$1' 実際 '$2'}"; }
assert_grep() { grep -q -- "$1" <<<"$2" && ok "${3:-出力に '$1'}" || ng "${3:-出力に '$1' が無い}"; }
assert_no_grep() { grep -q -- "$1" <<<"$2" && ng "${3:-出力に '$1' があってはならない}" || ok "${3:-出力に '$1' なし}"; }

TMP_DIRS=()
cleanup() { for d in "${TMP_DIRS[@]:-}"; do [[ -n "$d" && -d "$d" ]] && rm -rf "$d"; done; }
trap cleanup EXIT

# 擬似 cobertura XML を tmp に書き出し、その tmp ディレクトリ（=COV_OUT）を返す。
#   $1=全体 line-rate, $2..=「filename:rate」のクラス行（任意）。
make_cobertura() {
  local overall="$1"; shift
  local tmp; tmp="$(mktemp -d)"; TMP_DIRS+=("$tmp")
  {
    printf '<?xml version="1.0" ?>\n'
    printf '<coverage line-rate="%s" branch-rate="0.0" version="1.0">\n' "$overall"
    printf '  <packages><package name="root" line-rate="%s"><classes>\n' "$overall"
    local entry fn rt
    for entry in "$@"; do
      fn="${entry%%:*}"; rt="${entry##*:}"
      printf '    <class name="%s" filename="%s" line-rate="%s"><lines/></class>\n' "$fn" "$fn" "$rt"
    done
    printf '  </classes></package></packages>\n'
    printf '</coverage>\n'
  } > "$tmp/cobertura.xml"
  printf '%s' "$tmp"
}

# ============================================================================
# ユースケース1: 閾値判定（--judge-only・擬似 cobertura・kcov 実行を伴わない）
# ============================================================================

# シナリオ: 全体率 100% で達成（exit 0）
test_judge_full_pass() {
  # Given: 全体率 1.0（100%）の擬似 cobertura を用意し、閾値 100 を設定する
  local cov; cov="$(make_cobertura 1.0 ".agents/scripts/foo.sh:1.0")"
  # When: --judge-only で判定する
  local out code=0
  out="$(FAIL_UNDER=100 COV_OUT="$cov" bash "$TARGET" --judge-only 2>&1)" || code=$?
  # Then: exit 0・全体率 100.0% 表示・未達なし
  assert_eq 0 "$code" "全体率100%で exit 0"
  assert_grep "全体カバレッジ率 = 100.0% (閾値 100)" "$out" "全体率 100.0% を表示"
  assert_no_grep "\[UNCOVERED\]" "$out" "未達ファイルが出ない"
}

# シナリオ: 全体率 80%・閾値 100 で未達 fail（exit 1）・未達ファイル列挙
test_judge_under_fail() {
  # Given: 全体率 0.80（80%）の擬似 cobertura（未達クラスを含む）、閾値 100
  local cov; cov="$(make_cobertura 0.80 ".agents/scripts/foo.sh:0.80" ".agents/scripts/bar.sh:1.0")"
  # When: --judge-only で判定する
  local out code=0
  out="$(FAIL_UNDER=100 COV_OUT="$cov" bash "$TARGET" --judge-only 2>&1)" || code=$?
  # Then: exit 1・全体率 80.0%・未達 foo.sh を [UNCOVERED] で列挙（達成 bar.sh は出ない）
  assert_eq 1 "$code" "率<閾値で exit 1"
  assert_grep "全体カバレッジ率 = 80.0% (閾値 100)" "$out" "全体率 80.0% を表示"
  assert_grep "\[UNCOVERED\] .agents/scripts/foo.sh: 80.0%" "$out" "未達 foo.sh を列挙"
  assert_no_grep "\[UNCOVERED\] .agents/scripts/bar.sh" "$out" "達成 bar.sh は列挙しない"
}

# シナリオ: 率＝閾値ちょうど（境界値）で達成（exit 0）
test_judge_boundary_equal() {
  # Given: 全体率 0.90（90%）で閾値も 90（ちょうど一致）
  local cov; cov="$(make_cobertura 0.90 ".agents/scripts/foo.sh:0.90")"
  # When: --judge-only で判定する
  local out code=0
  out="$(FAIL_UNDER=90 COV_OUT="$cov" bash "$TARGET" --judge-only 2>&1)" || code=$?
  # Then: 率=閾値は達成として exit 0（境界値）
  assert_eq 0 "$code" "率=閾値（境界）で exit 0"
  assert_grep "全体カバレッジ率 = 90.0% (閾値 90)" "$out" "境界の率を表示"
}

# シナリオ: 閾値直下（境界値の反対側）で fail（exit 1）
test_judge_boundary_just_under() {
  # Given: 全体率 0.899（89.9%）で閾値 90（わずかに下回る）
  local cov; cov="$(make_cobertura 0.899 ".agents/scripts/foo.sh:0.899")"
  # When: --judge-only で判定する
  local out code=0
  out="$(FAIL_UNDER=90 COV_OUT="$cov" bash "$TARGET" --judge-only 2>&1)" || code=$?
  # Then: 閾値直下は未達 exit 1
  assert_eq 1 "$code" "閾値直下で exit 1"
}

# シナリオ: cobertura が空・不正のとき診断して fail（exit 1。計測失敗を握りつぶさない）
test_judge_invalid_xml() {
  # Given: line-rate を持たない不正な cobertura を置く
  local tmp; tmp="$(mktemp -d)"; TMP_DIRS+=("$tmp")
  printf '<coverage>broken</coverage>\n' > "$tmp/cobertura.xml"
  # When: --judge-only で判定する
  local out code=0
  out="$(FAIL_UNDER=100 COV_OUT="$tmp" bash "$TARGET" --judge-only 2>&1)" || code=$?
  # Then: 解析失敗で exit 1・診断出力
  assert_eq 1 "$code" "解析失敗で exit 1"
  assert_grep "line-rate" "$out" "解析失敗の診断を出す"
}

# シナリオ: cobertura が存在しないとき fail（exit 1）
test_judge_missing_xml() {
  # Given: cobertura.xml が存在しない空ディレクトリを COV_OUT に向ける
  local tmp; tmp="$(mktemp -d)"; TMP_DIRS+=("$tmp")
  # When: --judge-only で判定する
  local out code=0
  out="$(FAIL_UNDER=100 COV_OUT="$tmp" bash "$TARGET" --judge-only 2>&1)" || code=$?
  # Then: レポート不在で exit 1
  assert_eq 1 "$code" "レポート不在で exit 1"
  assert_grep "cobertura レポートが見つからない" "$out" "不在を診断"
}

# ============================================================================
# ユースケース2: kcov 不在 SKIP（exit 2・非クラッシュ）
# ============================================================================

# シナリオ: PATH から kcov を外すと exit 2（SKIP）でクラッシュしない
test_kcov_absent_skip() {
  # Given: kcov を含まない最小 PATH（command -v kcov が失敗する環境）を作る
  local tmp; tmp="$(mktemp -d)"; TMP_DIRS+=("$tmp")
  # bash と awk/grep など最小ツールへのシンボリックリンクだけ置く（kcov は置かない）
  for t in bash awk grep sed find head sort cp rm mkdir cat dirname env printf; do
    src="$(command -v "$t" 2>/dev/null)"; [[ -n "$src" ]] && ln -s "$src" "$tmp/$t" 2>/dev/null || true
  done
  # When: kcov 不在の PATH で（--judge-only を付けず）通常モード起動する
  local out code=0
  out="$(PATH="$tmp" COV_OUT="$tmp/out" "$(command -v bash)" "$TARGET" 2>&1)" || code=$?
  # Then: exit 2（SKIP）・案内出力・クラッシュしない
  assert_eq 2 "$code" "kcov 不在で exit 2 SKIP"
  assert_grep "kcov が見つかりません" "$out" "kcov 不在を案内"
}

# ============================================================================
# ユースケース3: 既定閾値 100（段階導入で閾値を下げない）
# ============================================================================

# シナリオ: FAIL_UNDER 既定値が 100 である（正本変数）
test_default_fail_under_100() {
  # Given/When: coverage-check.sh の FAIL_UNDER 既定値を抽出する
  local val
  val="$(grep -oE 'FAIL_UNDER:-[0-9]+' "$TARGET" | grep -oE '[0-9]+' | head -1)"
  # Then: 既定が 100 であること（閾値を下げない方針）
  assert_eq "100" "$val" "FAIL_UNDER 既定が 100"
}

# シナリオ: 環境変数で渡した COV_OUT 既定が .gitignore 済みパス（.coverage）である
test_default_cov_out_ignored() {
  # Given/When: COV_OUT 既定値を抽出する
  local val
  val="$(grep -oE 'COV_OUT:-[^}]+' "$TARGET" | sed -E 's/COV_OUT:-//' | head -1)"
  # Then: .coverage（.gitignore 済み）であること
  assert_eq ".coverage" "$val" "COV_OUT 既定が .coverage（gitignore 済み）"
  # かつ .gitignore に .coverage が登録されていること
  if grep -qE '(^|/)\.coverage' "$REPO_ROOT/.gitignore"; then
    ok ".coverage が .gitignore に登録されている"
  else
    ng ".coverage が .gitignore に未登録"
  fi
}

# ============================================================================
# ユースケース4: 除外の二重化整合（台帳 B ↔ EXCLUDE_PATHS A）
# ============================================================================

# シナリオ: 台帳「適用手段」列の除外パスがすべて EXCLUDE_PATHS に含まれる（B→A 一致）
test_ledger_exclude_consistency() {
  # Given: 台帳が存在する
  if [[ ! -f "$LEDGER" ]]; then ng "例外台帳が存在しない: $LEDGER"; return; fi
  # 台帳の「適用手段」列から --exclude-path=<path> のパスを抽出する
  local ledger_paths
  ledger_paths="$(grep -oE 'exclude-path=[^ |`]+' "$LEDGER" | sed -E 's/exclude-path=//' | sort -u)"
  if [[ -z "$ledger_paths" ]]; then ng "台帳に --exclude-path の記載が無い"; return; fi
  # EXCLUDE_PATHS 既定値（',' 区切り）を取得する
  local excl
  excl="$(grep -oE 'EXCLUDE_PATHS:-[^}]+' "$TARGET" | sed -E 's/EXCLUDE_PATHS:-//' | head -1)"
  # When/Then: 台帳の各除外パスが EXCLUDE_PATHS に含まれること（片方だけの除外を禁止）
  local p
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    if grep -qF -- "$p" <<<"$excl"; then
      ok "台帳除外 '$p' が EXCLUDE_PATHS に存在（二重化一致）"
    else
      ng "台帳除外 '$p' が EXCLUDE_PATHS に無い（B のみ・不整合）"
    fi
  done <<<"$ledger_paths"
}

# シナリオ: EXCLUDE_PATHS の各パスが台帳に記載される（A→B 一致・片方だけ禁止）
test_exclude_in_ledger() {
  if [[ ! -f "$LEDGER" ]]; then ng "例外台帳が存在しない: $LEDGER"; return; fi
  local excl
  excl="$(grep -oE 'EXCLUDE_PATHS:-[^}]+' "$TARGET" | sed -E 's/EXCLUDE_PATHS:-//' | head -1)"
  # ',' 区切りを分解して各パスが台帳に現れることを確認
  local IFS=','
  for p in $excl; do
    [[ -z "$p" ]] && continue
    if grep -qF -- "$p" "$LEDGER"; then
      ok "EXCLUDE_PATHS '$p' が台帳に記載（二重化一致）"
    else
      ng "EXCLUDE_PATHS '$p' が台帳に無い（A のみ・不整合）"
    fi
  done
}

# ============================================================================
# ユースケース5: 例外台帳の様式（必須列・SAMPLE 削除）
# ============================================================================

# シナリオ: 台帳に必須 8 列があり SAMPLE 行が残っていない
test_ledger_format() {
  if [[ ! -f "$LEDGER" ]]; then ng "例外台帳が存在しない: $LEDGER"; return; fi
  local content; content="$(cat "$LEDGER")"
  # Given/When/Then: 必須列（ID/対象/カテゴリ/理由/代替保証/適用手段/承認/有効期限）が揃う
  for col in ID 対象 カテゴリ 理由 代替保証 適用手段 承認 有効期限; do
    assert_grep "$col" "$content" "必須列 '$col' が存在"
  done
  # SAMPLE 行が削除されている（運用開始時に削除）
  assert_no_grep "SAMPLE-001" "$content" "SAMPLE-001 行が削除済み"
}

# ============================================================================
# ユースケース6: kcov ラップ実行（kcov 導入環境のみ・除外が分母から外れる）
# ============================================================================

# シナリオ: 最小 bash を kcov でラップ計測し cobertura が生成され除外が効く（kcov 無は SKIP）
test_kcov_wrap_integration() {
  if ! command -v kcov >/dev/null 2>&1; then
    echo "  [SKIP] kcov 未導入のためラップ結合テストを省略（CI では apt 導入で実行）"
    return
  fi
  # Given: 一部行のみ実行する最小 bash と、除外対象の bash を tmp ツリーに置く
  local tmp; tmp="$(mktemp -d)"; TMP_DIRS+=("$tmp")
  mkdir -p "$tmp/scripts/test"
  cat > "$tmp/scripts/target.sh" <<'EOF'
#!/usr/bin/env bash
x=1
if [[ "$x" == "1" ]]; then echo hit; fi
EOF
  cat > "$tmp/scripts/test/excluded.sh" <<'EOF'
#!/usr/bin/env bash
echo "this is test code, excluded from denominator"
EOF
  chmod +x "$tmp/scripts/target.sh" "$tmp/scripts/test/excluded.sh"
  # When: kcov で target を直接ラップ計測し、test 配下を除外する
  local out cov="$tmp/out"
  kcov --include-path="$tmp/scripts" --exclude-path="$tmp/scripts/test" "$cov" \
    bash "$tmp/scripts/target.sh" >/dev/null 2>&1 || true
  local xml
  xml="$(find "$cov" -name cobertura.xml -type f 2>/dev/null | head -1)"
  # Then: cobertura が生成され、除外パスが分母（filename 一覧）に含まれない
  if [[ -n "$xml" && -f "$xml" ]]; then
    ok "kcov ラップで cobertura.xml が生成された"
    local files; files="$(grep -oE 'filename="[^"]*"' "$xml" || true)"
    assert_no_grep "scripts/test/excluded.sh" "$files" "除外パスが分母に含まれない"
  else
    ng "kcov ラップで cobertura.xml が生成されなかった"
  fi
}

# ---- 実行 ---------------------------------------------------------------------
echo "== test-coverage-check.sh =="
test_judge_full_pass
test_judge_under_fail
test_judge_boundary_equal
test_judge_boundary_just_under
test_judge_invalid_xml
test_judge_missing_xml
test_kcov_absent_skip
test_default_fail_under_100
test_default_cov_out_ignored
test_ledger_exclude_consistency
test_exclude_in_ledger
test_ledger_format
test_kcov_wrap_integration

echo "--------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
echo "test-coverage-check.sh: すべて PASS"
exit 0
