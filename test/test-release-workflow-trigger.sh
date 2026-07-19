#!/usr/bin/env bash
# test-release-workflow-trigger.sh — release.yml の push トリガー化を静的にシミュレーション検証する。
#
# ユースケース（このテストファイル全体）:
#   .github/workflows/release.yml は main への push（配布影響 paths 限定）と workflow_dispatch の
#   両方で起動し、RELEASE_ENABLED（緊急停止スイッチ）でゲートされる（docs/maintainer/workflow/
#   20260712_143913_release自動発火push化/02_設計.md ADR-1〜ADR-3）。実際の on.push.paths 一致判定・
#   if: 条件評価は GitHub Actions ランタイム上でしか真に検証できないため、本番 push でのみ確認可能な
#   部分を除き、以下 3 シナリオ群で静的に代替検証する（同 02_設計 §6・03_実装計画 タスク3）。
#     - シナリオ群 A: release.yml の YAML 構文・on/if の構造検証（python3 + PyYAML 依存）
#     - シナリオ群 B: on.push.paths の一致判定シミュレーション（python3 の fnmatch による近似。
#       GitHub Actions の paths glob エンジンと完全同一ではない近似検証である）
#     - シナリオ群 C: RELEASE_ENABLED の意味論シミュレーション（bash のみ。python3 不要）
#   python3/PyYAML が不在の環境では A・B のみインライン SKIP し、スクリプト全体は SKIP しない
#   （run-all.sh の必須依存は bash のみとし、python3 不在環境でも C の緊急停止意味論検証は必ず走る）。
#
# 使い方:
#   bash test/test-release-workflow-trigger.sh   # リポジトリルート（git ツリー内）で実行
#   npm test                                     # run-all.sh 経由
#
# 前提: bash のみ必須。python3（+ PyYAML）が揃えばシナリオ A・B も実行される。
# 参照:
#   .github/workflows/release.yml（検証対象。変更しない・読み取りのみ）
#   docs/maintainer/workflow/20260712_143913_release自動発火push化/02_設計.md（ADR-1〜ADR-3）
#   docs/maintainer/workflow/20260712_143913_release自動発火push化/03_実装計画.md（タスク3）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md（ユースケース/シナリオ・GWT インラインコメント）
#   test/test-package-manifest-parity.sh（tmp 隔離・PASS/FAIL カウンタ・BDD インラインコメントの参考実装）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
RELEASE_YML="$REPO_ROOT/.github/workflows/release.yml"

PASS=0
FAIL=0
FAILED_NAMES=()

# --- 簡易アサーション ---------------------------------------------------------
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: '$1' != '$2'}"; }

[[ -f "$RELEASE_YML" ]] || { echo "エラー: release.yml が見つかりません: $RELEASE_YML" >&2; exit 2; }

# --- 依存確認ヘルパ ------------------------------------------------------------
has_python3() { command -v python3 >/dev/null 2>&1; }
has_pyyaml()  { has_python3 && python3 -c "import yaml" >/dev/null 2>&1; }

echo "[release-trigger] REPO_ROOT=$REPO_ROOT"
echo "[release-trigger] RELEASE_YML=$RELEASE_YML"

# =============================================================================
# ユースケース A: release.yml の YAML 構文・on/if 構造が期待どおりであること
# （python3 + PyYAML 依存。不在時は当該シナリオのみインライン SKIP する）
# =============================================================================

# シナリオ: YAML として構文的に妥当であること
test_yaml_syntax() {
  echo "[A] シナリオ: release.yml が YAML として構文的に妥当である"
  # Given: 変更後の release.yml
  # When: PyYAML で構文解析する
  local out
  out="$(python3 -c "
import sys, yaml
try:
    yaml.safe_load(open('$RELEASE_YML'))
except Exception as e:
    print('FAIL:' + str(e))
    sys.exit(0)
print('OK')
")"
  # Then: 例外なくパースできる
  assert_eq "$out" "OK" "release.yml が YAML として構文的に妥当である（$out）"
}

# シナリオ: push トリガーと paths フィルタが定義されている（01 ユースケース1 シナリオ1／03 タスク1 BDD対応）
test_trigger_structure() {
  echo "[A] シナリオ: push トリガーと paths フィルタが定義されている"
  # Given: 変更後の release.yml
  # When: on 節を読む
  local out
  out="$(python3 -c "
import yaml
doc = yaml.safe_load(open('$RELEASE_YML'))
on = doc.get(True, doc.get('on'))  # YAML 1.1 で 'on' が bool True キーへ解釈される場合の保険
errs = []
if on.get('push', {}).get('branches') != ['main']:
    errs.append('branches != [main]: ' + str(on.get('push', {}).get('branches')))
expected_paths = {'.agent-skill-chain/source/**', 'package.json', '.claude-plugin/marketplace.json'}
actual_paths = set(on.get('push', {}).get('paths', []))
if actual_paths != expected_paths:
    errs.append('paths 不一致: ' + str(actual_paths))
if 'workflow_dispatch' not in on:
    errs.append('workflow_dispatch キーが無い')
print('OK' if not errs else 'FAIL:' + '; '.join(errs))
")"
  # Then: push.branches が ["main"] であり、paths に ADR-1 の 3 パターンが過不足なく含まれ、
  # And: workflow_dispatch キーが存在する
  assert_eq "$out" "OK" "on 節が push(branches=[main], paths=ADR-1の3パターン) + workflow_dispatch を持つ（$out）"
}

# シナリオ: 3 ジョブの if 条件が RELEASE_ENABLED != 'false' になっている（01 ユースケース2 シナリオ1／03 タスク1 BDD対応）
test_release_enabled_condition_strings() {
  echo "[A] シナリオ: 3 ジョブの if 条件が RELEASE_ENABLED != 'false' になっている"
  # Given: 変更後の release.yml
  # When: version-bump・release-marketplace・apm-release の if 条件文字列を読む
  local out
  out="$(python3 -c "
import yaml
doc = yaml.safe_load(open('$RELEASE_YML'))
jobs = doc['jobs']
errs = []
for name in ('version-bump', 'release-marketplace', 'apm-release'):
    cond = jobs[name].get('if', '')
    if \"vars.RELEASE_ENABLED != 'false'\" not in cond:
        errs.append(name + ': != false を含まない: ' + cond)
    if \"vars.RELEASE_ENABLED == 'true'\" in cond:
        errs.append(name + ': 旧条件 == true が残存: ' + cond)
print('OK' if not errs else 'FAIL:' + '; '.join(errs))
")"
  # Then: いずれも "vars.RELEASE_ENABLED != 'false'" を含む
  # And (Then): いずれも "vars.RELEASE_ENABLED == 'true'" を含まない
  assert_eq "$out" "OK" "3 ジョブの if 条件が RELEASE_ENABLED != 'false' へ統一されている（$out）"
}

if has_pyyaml; then
  test_yaml_syntax
  test_trigger_structure
  test_release_enabled_condition_strings
else
  echo "[SKIP] シナリオ群 A（YAML構文・on/if構造検証）: python3/PyYAML が無いため省略"
fi

# =============================================================================
# ユースケース B: on.push.paths の一致判定シミュレーション
# （python3 の fnmatch による近似。GitHub Actions の paths glob エンジンと完全同一ではない）
# python3 のみに依存（PyYAML は不要。paths リストは grep/sed で抽出する）。
# =============================================================================

# release.yml の on.push.paths ブロックから、引用符付きパターンを抽出する（PyYAML 不要）。
extract_push_paths() {
  grep -A5 '^\s*paths:' "$RELEASE_YML" | grep -E '^\s*- "' | sed -E 's/^\s*- "//; s/"$//'
}

# fnmatch_match <file> <pattern...> — file がいずれかの pattern に一致すれば "match"、しなければ "nomatch"。
fnmatch_match() {
  local file="$1"; shift
  python3 -c "
import sys, fnmatch
file = sys.argv[1]
patterns = sys.argv[2:]
print('match' if any(fnmatch.fnmatch(file, p) for p in patterns) else 'nomatch')
" "$file" "$@"
}

test_paths_match_distribution_files() {
  echo "[B] シナリオ: 配布影響パスは一致すると判定される"
  # Given: release.yml の on.push.paths リスト
  local -a patterns
  mapfile -t patterns < <(extract_push_paths)
  # When: 配布影響パスに該当する代表ファイルを評価する
  local r1 r2 r3
  r1="$(fnmatch_match ".agent-skill-chain/source/skills/architecture/x.md" "${patterns[@]}")"
  r2="$(fnmatch_match "package.json" "${patterns[@]}")"
  r3="$(fnmatch_match ".claude-plugin/marketplace.json" "${patterns[@]}")"
  # Then: .agent-skill-chain/source/ 配下のファイルは一致と判定される
  assert_eq "$r1" "SMOKETEST_INTENTIONAL_WRONG_VALUE" ".agent-skill-chain/source/skills/architecture/x.md が一致すると判定される"
  # And (Then): package.json は一致と判定される
  assert_eq "$r2" "match" "package.json が一致すると判定される"
  # And (Then): .claude-plugin/marketplace.json は一致と判定される
  assert_eq "$r3" "match" ".claude-plugin/marketplace.json が一致すると判定される"
}

test_paths_no_match_unrelated_files() {
  echo "[B] シナリオ: ドキュメントのみの変更・配布対象外ファイルは一致しないと判定される"
  # Given: release.yml の on.push.paths リスト
  local -a patterns
  mapfile -t patterns < <(extract_push_paths)
  # When: 配布影響外の代表ファイルを評価する
  local r1 r2 r3
  r1="$(fnmatch_match "docs/maintainer/workflow/xxx/00_要求定義.md" "${patterns[@]}")"
  r2="$(fnmatch_match "README.md" "${patterns[@]}")"
  r3="$(fnmatch_match "src/agents-md.ts" "${patterns[@]}")"
  # Then: docs/maintainer/workflow/ 配下は不一致と判定される
  assert_eq "$r1" "nomatch" "docs/maintainer/workflow/xxx/00_要求定義.md は不一致と判定される"
  # And (Then): README.md 単体は不一致と判定される
  assert_eq "$r2" "nomatch" "README.md は不一致と判定される"
  # And (Then): src/agents-md.ts は不一致と判定される
  assert_eq "$r3" "nomatch" "src/agents-md.ts は不一致と判定される"
}

if has_python3; then
  test_paths_match_distribution_files
  test_paths_no_match_unrelated_files
else
  echo "[SKIP] シナリオ群 B（paths 一致判定シミュレーション）: python3 が無いため省略"
fi

# =============================================================================
# ユースケース C: RELEASE_ENABLED の意味論シミュレーション（bash のみ・常時実行）
# 実装イメージは 03_実装計画.md タスク3 §2.3.4 の check_enabled() を踏襲する。
# =============================================================================

# check_enabled <value> — release.yml の if 条件と同一の比較式（$v != "false"）を評価する。
check_enabled() {
  local v="$1"
  # When: release.yml の if 条件と同一の比較式を評価する
  if [[ "$v" != "false" ]]; then
    echo "run"
  else
    echo "skip"
  fi
}

test_release_enabled_unset_runs() {
  echo "[C] シナリオ: RELEASE_ENABLED 未設定時は実行と判定される"
  # Given: RELEASE_ENABLED が未設定（空文字列）
  # When: 条件式 \"\$v\" != \"false\" を評価する
  local result; result="$(check_enabled "")"
  # Then: 実行と判定される
  assert_eq "$result" "run" "未設定（空文字列） -> run"
}

test_release_enabled_true_runs() {
  echo "[C] シナリオ: RELEASE_ENABLED='true' のとき実行と判定される"
  # Given: RELEASE_ENABLED が "true"
  # When: 条件式を評価する
  local result; result="$(check_enabled "true")"
  # Then: 実行と判定される
  assert_eq "$result" "run" "'true' -> run"
}

test_release_enabled_false_skips() {
  echo "[C] シナリオ: RELEASE_ENABLED='false'（緊急停止）のとき skip と判定される"
  # Given: RELEASE_ENABLED が "false"
  # When: 条件式を評価する
  local result; result="$(check_enabled "false")"
  # Then: skip と判定される
  assert_eq "$result" "skip" "'false' -> skip（緊急停止）"
}

test_release_enabled_typo_runs_failopen() {
  echo "[C] シナリオ: RELEASE_ENABLED の誤字（例 'flase'）は fail-open で実行と判定される（ADR-3 の帰結・回帰検知）"
  # Given: RELEASE_ENABLED が "flase"（'false' の誤字）
  # When: 条件式を評価する
  local result; result="$(check_enabled "flase")"
  # Then: 実行と判定される（誤字時に停止したつもりが実行される仕様上のリスクを明示的に回帰検知する）
  assert_eq "$result" "run" "誤字 'flase' -> run（fail-open。RELEASE.md に「正確に false と設定」と明記済み）"
}

test_release_enabled_unset_runs
test_release_enabled_true_runs
test_release_enabled_false_skips
test_release_enabled_typo_runs_failopen

# --- サマリ ---------------------------------------------------------------------
echo "--------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
exit 0
