#!/usr/bin/env bash
# coverage-check.sh — bash カバレッジ計測オーケストレータ（kcov ラップ＋fail-under 判定）。
#
# ユースケース（このスクリプト全体）:
#   本リポジトリの保守者（自己拡張・ドッグフーディング）が、テスト一括 runner（run-all.sh）を
#   kcov でラップ実行して bash 本体のカバレッジを計測し、cobertura レポートを後処理して
#   fail-under 閾値（既定 100）で矯正する。テスト駆動・隔離ロジックは再実装せず、本スクリプトは
#   「kcov 実行 → cobertura 解析 → fail-under 判定 → 終了コード決定」の薄いオーケストレーションのみ。
#
# 方針（破壊禁止・非破壊契約・正本 1 か所）:
#   - 開発リポの .agents/ .claude/ .cursor/ .workflow/ workflow.db を変更しない。
#     kcov 出力は .gitignore 済みパス（COV_OUT 既定 .coverage/）のみ。
#   - 計測対象・除外・閾値の定義は本ファイルの正本変数 1 か所に集約する（CI・ローカルで二重化しない）。
#   - 除外は kcov のパス指定（A）＋ 例外台帳 .agents-project/COVERAGE_EXCEPTIONS.md（B）の二重化。
#     行単位 ignore は bash に公式手段が無いため使わない（COVERAGE_AND_EXCEPTIONS.md §1.1 / 1）。
#   - 閾値は緩めない（段階導入は分母を絞って fail-under=100 を維持。不足はテスト追加 or 台帳除外）。
#
# 使い方:
#   bash test/coverage-check.sh              # リポジトリルートで実行（kcov ラップ＋判定）
#   bash test/coverage-check.sh --judge-only # cobertura 解析・判定のみ（kcov を起動しない）
#                                                            # ※ $COV_OUT/cobertura.xml を入力に使う（テスト用）
#
# 前提（依存マトリクス）:
#   | モード        | 必須依存                                          |
#   | 通常（ラップ）| kcov（不在は exit 2 SKIP・クラッシュしない）, bash |
#   | --judge-only  | bash のみ（解析・判定の単体テスト入口）            |
#
# 終了コード契約（02_設計 §5・runner I/F と整合）:
#   0 = カバレッジ率 >= 閾値（達成）。計測・判定成功。
#   1 = カバレッジ率 < 閾値（未達・矯正 fail）、または kcov 実行・cobertura 解析失敗。
#   2 = kcov 不在（必須依存欠如・SKIP）。runner I/F の exit 2 = SKIP 規約に合わせる。
#
# 出力（規約）:
#   - 標準出力に `全体カバレッジ率 = NN.N% (閾値 TT)` と、未達時は `[UNCOVERED] <file>: NN.N%`。
#   - cobertura XML（$COV_OUT/cobertura.xml）＋ HTML を $COV_OUT に生成（.gitignore 済み）。
#
# 参照:
#   docs/maintainer/workflow/20260615_054810_カバレッジ計測の自リポ適用/02_設計.md（§5 I/F）, 03_実装計画.md（T1〜T5）
#   .agents/COVERAGE_AND_EXCEPTIONS.md（§1 方針・§3 台帳必須列）
#   .agents-project/COVERAGE_EXCEPTIONS.md（除外の二重化 B）
#   test/run-all.sh（被ラップ対象・前提 issue）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"   # test/ -> repo root（配置非依存）

# ============================================================================
# 正本変数（計測対象・除外・閾値・出力先を 1 か所に集約。CI・ローカルで二重化しない）
# ============================================================================

# 計測対象（分母）= 実行ロジックを持つ bash 本体。
INCLUDE_PATHS="${INCLUDE_PATHS:-.agents/scripts}"

# 除外（分母から外す）= 台帳一致分（.agents-project/COVERAGE_EXCEPTIONS.md の「適用手段」列と一致）。
#   ',' 区切り。各値は kcov の --exclude-path に渡る。台帳（B）と必ず一致させること。
#   ※ 自己テスト一式（test/）は INCLUDE_PATHS（.agents/scripts）の配下ではない＝分母外のため除外指定は不要。
EXCLUDE_PATHS="${EXCLUDE_PATHS:-.agents/scripts/lib/deploy-skills.sh}"

# fail-under 閾値（最終目標 100。閾値は恒久的に下げない＝COVERAGE_AND_EXCEPTIONS.md §1）。
FAIL_UNDER="${FAIL_UNDER:-100}"

# kcov 出力先（.gitignore 済みパス。差分ゼロ・npm pack リーク検査を破らない）。
COV_OUT="${COV_OUT:-.coverage}"

# 被ラップ対象 runner（前提 issue の成果物。本 issue は変更しない）。
RUNNER="${RUNNER:-$REPO_ROOT/test/run-all.sh}"

# ============================================================================
# ユーティリティ
# ============================================================================

# 率（0.0〜1.0 の小数）を百分率（小数 1 桁）に整形する。整数演算のみ（bc 非依存）。
#   入力: "0.834" → 出力: "83.4"
rate_to_pct() {
  local r="$1"
  # 小数を 1000 倍した整数（per-mille）に変換し、百分率（×0.1）へ。
  local permille
  permille="$(awk -v v="$r" 'BEGIN { printf "%d", (v * 1000) + 0.5 }')"
  printf '%d.%d' "$((permille / 10))" "$((permille % 10))"
}

# 率（小数）が閾値（百分率の整数）以上か判定する。整数比較のみ。
#   rate_ge_threshold 0.834 100 → 非 0（未達）/ rate_ge_threshold 1.0 100 → 0（達成）
rate_ge_threshold() {
  local rate="$1" threshold_pct="$2"
  # 率を per-mille 整数へ、閾値を per-mille 整数（×10）へそろえて比較する。
  local rate_pm threshold_pm
  rate_pm="$(awk -v v="$rate" 'BEGIN { printf "%d", (v * 1000) + 0.5 }')"
  threshold_pm=$(( threshold_pct * 10 ))
  [[ "$rate_pm" -ge "$threshold_pm" ]]
}

# ============================================================================
# cobertura 解析・判定（--judge-only でも使う中核。kcov 実行を伴わない）
# ============================================================================

# $COV_OUT/cobertura.xml を解析し、全体率と未達ファイルを判定する。
#   戻り値: 0=達成 / 1=未達 or 解析失敗。
judge_cobertura() {
  local xml="$COV_OUT/cobertura.xml"

  if [[ ! -f "$xml" ]]; then
    echo "ERROR: cobertura レポートが見つからない: $xml（計測失敗）" >&2
    return 1
  fi

  # ルート <coverage ... line-rate="X" ...> から全体率を抽出する。
  local overall
  overall="$(grep -oE 'line-rate="[0-9.]+"' "$xml" | head -1 | grep -oE '[0-9.]+')"
  if [[ -z "$overall" ]]; then
    echo "ERROR: cobertura の line-rate を解析できない（XML 不正・空）: $xml" >&2
    return 1
  fi

  local overall_pct
  overall_pct="$(rate_to_pct "$overall")"
  echo "全体カバレッジ率 = ${overall_pct}% (閾値 ${FAIL_UNDER})"

  # ファイル別率（<class ... filename="F" ... line-rate="R">）から未達を列挙する。
  #   閾値未満のファイルを [UNCOVERED] 形式で出す（診断目的・判定は全体率で行う）。
  local line fname frate fpct
  while IFS= read -r line; do
    fname="$(printf '%s' "$line" | grep -oE 'filename="[^"]*"' | head -1 | sed -E 's/filename="//; s/"$//')"
    frate="$(printf '%s' "$line" | grep -oE 'line-rate="[0-9.]+"' | head -1 | grep -oE '[0-9.]+')"
    [[ -z "$fname" || -z "$frate" ]] && continue
    if ! rate_ge_threshold "$frate" "$FAIL_UNDER"; then
      fpct="$(rate_to_pct "$frate")"
      echo "[UNCOVERED] ${fname}: ${fpct}%"
    fi
  done < <(grep -oE '<class[^>]*filename="[^"]*"[^>]*line-rate="[0-9.]+"[^>]*>' "$xml")

  if rate_ge_threshold "$overall" "$FAIL_UNDER"; then
    echo "PASS: 全体率 ${overall_pct}% >= 閾値 ${FAIL_UNDER}"
    return 0
  else
    echo "FAIL: 全体率 ${overall_pct}% < 閾値 ${FAIL_UNDER}（テスト追加 or 台帳除外で解消する）"
    return 1
  fi
}

# ============================================================================
# kcov ラップ実行（通常モード）
# ============================================================================

# kcov の存在を確認する。無ければ SKIP（exit 2）案内を出す。
ensure_kcov() {
  if ! command -v kcov >/dev/null 2>&1; then
    echo "[SKIP] kcov が見つかりません（必須依存欠如）。CI では apt-get install -y kcov で導入されます。" >&2
    echo "       ローカル任意実行ではインストール不要・クラッシュしません（exit 2）。" >&2
    return 1
  fi
  return 0
}

# kcov の --exclude-path に渡す除外引数を組み立てる（',' 区切りをそのまま使う）。
#   kcov は --exclude-path に ',' 区切りの複数パスを受け付ける。
run_kcov() {
  local outdir="$COV_OUT"

  if [[ ! -f "$RUNNER" ]]; then
    echo "ERROR: 被ラップ対象 runner が見つからない: $RUNNER" >&2
    return 1
  fi

  # 出力先を初期化する（.gitignore 済みパス。既存生成物の混入を防ぐ）。
  rm -rf "$outdir"
  mkdir -p "$outdir"

  echo "== kcov ラップ計測 (coverage-check.sh) =="
  echo "  INCLUDE_PATHS=$INCLUDE_PATHS"
  echo "  EXCLUDE_PATHS=$EXCLUDE_PATHS"
  echo "  COV_OUT=$outdir  FAIL_UNDER=$FAIL_UNDER"

  # runner を kcov でラップ実行する。runner の子プロセス（bash <script>）も追跡される。
  #   runner の失敗（テスト FAIL）は計測結果を不完全にするため診断のうえ fail させる。
  local kcode=0
  kcov \
    --include-path="$INCLUDE_PATHS" \
    --exclude-path="$EXCLUDE_PATHS" \
    "$outdir" \
    bash "$RUNNER" || kcode=$?

  if [[ "$kcode" -ne 0 ]]; then
    echo "WARN: kcov 配下の runner が非 0 (exit $kcode) で終了。計測結果が不完全な可能性があり fail させます。" >&2
  fi

  # kcov は出力ディレクトリ配下にサブディレクトリを掘り cobertura.xml を置く場合がある。
  #   $COV_OUT 直下に cobertura.xml が無ければ、配下から最初の 1 件を引き上げる。
  if [[ ! -f "$outdir/cobertura.xml" ]]; then
    local found
    found="$(find "$outdir" -name cobertura.xml -type f 2>/dev/null | head -1)"
    if [[ -n "$found" ]]; then
      cp "$found" "$outdir/cobertura.xml"
    fi
  fi

  [[ "$kcode" -eq 0 ]] || return 1
  return 0
}

# ============================================================================
# メイン
# ============================================================================

main() {
  local judge_only=0
  case "${1:-}" in
    --judge-only) judge_only=1 ;;
    "") : ;;
    *) echo "ERROR: 未知の引数: $1（使い方は本スクリプト冒頭コメント参照）" >&2; exit 1 ;;
  esac

  # COV_OUT を REPO_ROOT 基準の絶対パスに正規化する（相対は REPO_ROOT 起点）。
  case "$COV_OUT" in
    /*) : ;;
    *) COV_OUT="$REPO_ROOT/$COV_OUT" ;;
  esac

  if [[ "$judge_only" -eq 1 ]]; then
    # 解析・判定のみ（kcov を起動しない）。既存 $COV_OUT/cobertura.xml を入力に使う。
    if judge_cobertura; then exit 0; else exit 1; fi
  fi

  # 通常モード: kcov 存在チェック → ラップ実行 → 判定。
  if ! ensure_kcov; then
    exit 2   # kcov 不在 = SKIP（必須依存欠如）。クラッシュしない。
  fi

  if ! run_kcov; then
    # kcov 実行失敗。cobertura が生成されていれば率も出すが、計測失敗として fail させる。
    judge_cobertura || true
    exit 1
  fi

  if judge_cobertura; then exit 0; else exit 1; fi
}

main "$@"
