#!/usr/bin/env bash
# test-audit.sh — audit.sh の後方互換・自己テスト（DB 不採用・非 git ツリーで SKIP→PASS）。
#
# ユースケース（このテストファイル全体）:
#   audit.sh が、workflow.db を採用しない環境・.git の無い非 git ツリーでも
#   エラー終了せず、DB 依存 check（#8/#9/#11/#12–#21/#29）・git 依存 check（#18/#19/#25/#27/#28）が
#   SKIP し、必須ファイルが揃った最小 issue ツリーで「Audit passed.」（exit 0）すること。
#   判定ロジックは変更しないため、本テストは挙動不変の回帰として機能する。
#
# 方針（破壊禁止・tmp 隔離 必須・.agents-project/自己拡張ワークフロー.md §テストの tmp 隔離）:
#   - 検証は mktemp -d の隔離ツリーで行う。本開発リポの .agents/ .claude/ .cursor/ .workflow/ workflow.db を
#     一切読み書き・変更しない（audit.sh 本体のみ読み取りで参照する）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash .agents/scripts/test/test-audit.sh   # リポジトリルートで実行
#
# 前提: bash。sqlite3・git は任意（無くても SKIP として通る）。
# 参照:
#   docs/maintainer/workflow/20260614_235244_enforcement宣言と実装の乖離是正/02_設計.md, 03_実装計画.md（T4）
#   .agents/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"   # .agents/scripts/test -> repo root
AUDIT="$REPO_ROOT/.agents/enforcement/ci/audit.sh"

[[ -f "$AUDIT" ]] || { echo "エラー: audit.sh が見つからない: $AUDIT" >&2; exit 2; }

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }

# 隔離ツリーをまとめて掃除する
TMP_DIRS=()
cleanup() { for d in "${TMP_DIRS[@]:-}"; do [[ -n "$d" && -d "$d" ]] && rm -rf "$d"; done; }
trap cleanup EXIT

# 最小 issue ツリーを tmp に作る（必須ファイル＋.workflow 走査基点）。DB も .git も作らない。
make_min_tree() {
  local tmp
  tmp="$(mktemp -d)"
  TMP_DIRS+=("$tmp")
  mkdir -p "$tmp/.agents/boot" "$tmp/.agents/workflow" "$tmp/.workflow"
  : > "$tmp/.agents/boot/CORE.md"
  : > "$tmp/.agents/boot/LOAD_POLICY.md"
  : > "$tmp/.agents/workflow/PHASES.md"
  : > "$tmp/.agents/workflow/TEMPLATES.md"
  printf '%s\n' "$tmp"
}

echo "== test-audit.sh =="

# シナリオ1: DB 不採用・非 git ツリーで audit が SKIP し成功する
# Given: workflow.db が存在せず .git も存在しない最小 issue ツリー（tmp 隔離）
# When:  audit.sh <tmp> を実行する
# Then:  終了コードが 0（Audit passed）であり、出力に "Audit passed." を含む
T1_TREE="$(make_min_tree)"
T1_OUT="$(bash "$AUDIT" "$T1_TREE" 2>&1)"; T1_RC=$?
if [[ $T1_RC -eq 0 ]]; then ok "DB 不採用・非 git ツリーで exit 0"; else ng "DB 不採用・非 git ツリーで exit 0（実際 rc=$T1_RC）"; fi
if grep -q "Audit passed." <<< "$T1_OUT"; then ok "出力に Audit passed. を含む"; else ng "出力に Audit passed. が無い: $T1_OUT"; fi

# シナリオ2: 非 git ツリーで git 依存 check がエラー終了しない（FAIL を出さない）
# Given: 内容を満たす 04_review.md を含む最小ツリー（.git 無し）— 通常 #18/#27/#28 等の git 依存 check の対象
#        （04 の内容系 check（#3/#4/#27）を満たすので、残るのは git 依存 check のみ）
# When:  audit.sh <tmp> を実行する
# Then:  git 依存 check は SKIP され FAIL: を出さず exit 0
T2_TREE="$(make_min_tree)"
mkdir -p "$T2_TREE/.workflow/20260101_000000_dummy"
cat > "$T2_TREE/.workflow/20260101_000000_dummy/04_review.md" <<'EOF'
# 04_review

## 敵対的観点
- ダミーの敵対的観点

## must-preserve（不変条件）
- ダミーの不変条件

## docs 更新
- 要否: 不要
- 対象: なし
- 理由: 文書のみ
EOF
T2_OUT="$(bash "$AUDIT" "$T2_TREE" 2>&1)"; T2_RC=$?
if [[ $T2_RC -eq 0 ]]; then ok "非 git ツリー＋04 存在でも git 依存 check SKIP し exit 0"; else ng "非 git ツリーで exit 0（実際 rc=$T2_RC）: $T2_OUT"; fi
if ! grep -q "^FAIL:" <<< "$T2_OUT"; then ok "非 git ツリーで FAIL: 行が出ない"; else ng "非 git ツリーで FAIL: 行が出た: $T2_OUT"; fi

# シナリオ3: 必須ファイル欠落は従来どおり FAIL する（判定ロジック不変の確認）
# Given: 必須ファイル CORE.md を欠いた最小ツリー
# When:  audit.sh <tmp> を実行する
# Then:  必須ファイル未参照で FAIL し exit 0 以外
T3_TREE="$(make_min_tree)"
rm -f "$T3_TREE/.agents/boot/CORE.md"
T3_OUT="$(bash "$AUDIT" "$T3_TREE" 2>&1)"; T3_RC=$?
if [[ $T3_RC -ne 0 ]]; then ok "必須ファイル欠落で exit != 0（判定不変）"; else ng "必須ファイル欠落でも exit 0 になった: $T3_OUT"; fi
if grep -q "Missing required file" <<< "$T3_OUT"; then ok "必須ファイル未参照の FAIL メッセージを出す"; else ng "必須ファイル未参照メッセージが無い: $T3_OUT"; fi

echo
echo "== 結果: PASS=$PASS FAIL=$FAIL =="
if [[ $FAIL -gt 0 ]]; then
  printf '  失敗: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
exit 0
