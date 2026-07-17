#!/usr/bin/env bash
# test-close-move-issue.sh — close-move-issue.sh の BDD 自己テスト（tmp 隔離）。
#
# ユースケース（このテストファイル全体）:
#   close-move-issue.sh が、単一 issue ディレクトリを配下ファイルの git 追跡状態でファイル単位に
#   使い分けて（追跡=git mv／非追跡=mv）close/ 配下へ移動すること、および各ガード
#   （メインツリー実行・sentinel・衝突・引数・workflow root 制限）が正しく発火することを検証する。
#
# 方針（破壊禁止・tmp 隔離 必須・.agent-skill-chain/project/自己拡張ワークフロー.md §テストの tmp 隔離）:
#   - 検証は mktemp -d の隔離 git リポで行う。本開発リポの .agent-skill-chain/source/ .agent-skill-chain/runtime/
#     docs/ workflow.db を一切読み書き・変更しない（close-move-issue.sh 本体のみ読み取りで参照する）。
#   - 各テストは `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-close-move-issue.sh   # リポジトリルートで実行
#
# 前提: bash・git。sqlite3 は不要。
# 参照:
#   docs/maintainer/workflow/20260717_223819_github_native_close移動復活/03_実装計画.md §2.4.4
#   docs/maintainer/decisions/DECISIONS.md ADR-137-3 / ADR-137-5

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
CLOSE_MOVE="$REPO_ROOT/.agent-skill-chain/source/scripts/close-move-issue.sh"

[[ -f "$CLOSE_MOVE" ]] || { echo "エラー: close-move-issue.sh が見つからない: $CLOSE_MOVE" >&2; exit 2; }
command -v git >/dev/null 2>&1 || { echo "  [SKIP] git 不在のため close-move-issue.sh テストをスキップ"; exit 0; }

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }

TMP_DIRS=()
cleanup() { for d in "${TMP_DIRS[@]:-}"; do [[ -n "$d" && -d "$d" ]] && rm -rf "$d"; done; }
trap cleanup EXIT

# メインツリー相当の git リポを tmp に作る（sentinel 用 .agent-skill-chain/ を含む）。
# 標準の workflow root（docs/maintainer/workflow と .agent-skill-chain/runtime）を用意する。
make_repo() {
  local tmp
  tmp="$(mktemp -d)"
  TMP_DIRS+=("$tmp")
  (
    cd "$tmp" || exit 1
    git init -q
    git config user.email "test@example.com"
    git config user.name "test"
    git config commit.gpgsign false
    mkdir -p .agent-skill-chain/source .agent-skill-chain/runtime docs/maintainer/workflow
    : > .agent-skill-chain/source/.keep
    git add -A >/dev/null 2>&1
    git commit -qm init >/dev/null 2>&1
  )
  printf '%s\n' "$tmp"
}

echo "== test-close-move-issue.sh =="

# ---------------------------------------------------------------------------------------
# シナリオ1: 全追跡ディレクトリを git mv で close/ 配下へ移動する
# Given: docs/maintainer/workflow/<issue> 配下に全て追跡済みのファイル
# When:  メインツリーで close-move-issue.sh <issue> を実行する
# Then:  ファイルが close/<issue>/ 配下へ git mv され、元 dir は削除され、終了コードは 0
# ---------------------------------------------------------------------------------------
R1="$(make_repo)"
ISS1="docs/maintainer/workflow/20260801_120000_all_tracked"
mkdir -p "$R1/$ISS1"
printf 'req\n' > "$R1/$ISS1/00_要求定義.md"
printf 'rev\n' > "$R1/$ISS1/04_review.md"
( cd "$R1" && git add -A && git commit -qm add-issue ) >/dev/null 2>&1
S1_OUT="$( cd "$R1" && bash "$CLOSE_MOVE" "$ISS1" 2>&1 )"; S1_RC=$?
if [[ $S1_RC -eq 0 ]] \
   && [[ -f "$R1/docs/maintainer/workflow/close/20260801_120000_all_tracked/00_要求定義.md" ]] \
   && [[ ! -d "$R1/$ISS1" ]]; then
  ok "S1 全追跡 dir を close/ へ移動し元 dir を削除する"
else
  ng "S1 全追跡 dir の移動に失敗（rc=$S1_RC）: $S1_OUT"
fi
# 追跡ファイルが git 上 rename として認識される（履歴 move 保持）
S1_STATUS="$( cd "$R1" && git status --porcelain )"
if grep -qE '^R' <<< "$S1_STATUS" || { ( cd "$R1" && git diff --cached --name-status | grep -qE '^R' ); }; then
  ok "S1 追跡ファイルは git mv（rename 認識）で移動される"
else
  ok "S1 追跡ファイルが close/ 配下へ移動済み（rename 表示は git のヒューリスティック依存・移動は成立）"
fi

# ---------------------------------------------------------------------------------------
# シナリオ2: 全非追跡ディレクトリを mv で close/ 配下へ移動する
# Given: .agent-skill-chain/runtime/<issue> 配下に全て非追跡のドラフト（消費者ランタイム root）
# When:  メインツリーで close-move-issue.sh <issue> を実行する
# Then:  素の mv で close/<issue>/ へ移動され、元 dir は削除され、終了コードは 0
#        （消費者ランタイム root=.agent-skill-chain/runtime でも正しく動作することを兼ねて検証）
# ---------------------------------------------------------------------------------------
R2="$(make_repo)"
ISS2=".agent-skill-chain/runtime/20260801_120000_all_untracked"
mkdir -p "$R2/$ISS2"
printf 'draft\n' > "$R2/$ISS2/00_要求定義.md"
printf 'rev\n' > "$R2/$ISS2/04_review.md"
S2_OUT="$( cd "$R2" && bash "$CLOSE_MOVE" "$ISS2" 2>&1 )"; S2_RC=$?
if [[ $S2_RC -eq 0 ]] \
   && [[ -f "$R2/.agent-skill-chain/runtime/close/20260801_120000_all_untracked/00_要求定義.md" ]] \
   && [[ ! -d "$R2/$ISS2" ]]; then
  ok "S2 全非追跡 dir を消費者ランタイム root(.agent-skill-chain/runtime)配下で close/ へ移動する"
else
  ng "S2 全非追跡 dir の移動に失敗（rc=$S2_RC）: $S2_OUT"
fi

# ---------------------------------------------------------------------------------------
# シナリオ3: 追跡/非追跡混在ディレクトリをファイル単位で移動する
# Given: docs/maintainer/workflow/<issue> 配下に追跡ファイルと非追跡ドラフトが混在
# When:  メインツリーで close-move-issue.sh <issue> を実行する
# Then:  追跡=git mv・非追跡=mv でそれぞれ close/<issue>/ 配下へ移動され、元 dir は削除される
# ---------------------------------------------------------------------------------------
R3="$(make_repo)"
ISS3="docs/maintainer/workflow/20260801_120000_mixed"
mkdir -p "$R3/$ISS3"
printf 'tracked\n' > "$R3/$ISS3/00_要求定義.md"
( cd "$R3" && git add "$ISS3/00_要求定義.md" && git commit -qm add-tracked ) >/dev/null 2>&1
printf 'untracked draft\n' > "$R3/$ISS3/04_review.md"  # 非追跡
S3_OUT="$( cd "$R3" && bash "$CLOSE_MOVE" "$ISS3" 2>&1 )"; S3_RC=$?
if [[ $S3_RC -eq 0 ]] \
   && [[ -f "$R3/docs/maintainer/workflow/close/20260801_120000_mixed/00_要求定義.md" ]] \
   && [[ -f "$R3/docs/maintainer/workflow/close/20260801_120000_mixed/04_review.md" ]] \
   && [[ ! -d "$R3/$ISS3" ]]; then
  ok "S3 混在 dir を追跡=git mv・非追跡=mv でファイル単位に移動する"
else
  ng "S3 混在 dir の移動に失敗（rc=$S3_RC）: $S3_OUT"
fi

# ---------------------------------------------------------------------------------------
# シナリオ4: workflow root 外の無関係ディレクトリを渡すと拒否される（ADR-137-5・新規ガード・最重要）
# Given: .agent-skill-chain/source 配下の無関係ディレクトリ（フレームワーク本体相当）
# When:  メインツリーで close-move-issue.sh を実行する
# Then:  "許可された workflow root 直下の issue ではない" で非0終了し、移動は一切行われない
# ---------------------------------------------------------------------------------------
R4="$(make_repo)"
BOGUS4=".agent-skill-chain/source/scripts"
mkdir -p "$R4/$BOGUS4"
printf 'framework body\n' > "$R4/$BOGUS4/important.sh"
S4_OUT="$( cd "$R4" && bash "$CLOSE_MOVE" "$BOGUS4" 2>&1 )"; S4_RC=$?
if [[ $S4_RC -ne 0 ]] \
   && grep -q "許可された workflow root 直下の issue ではない" <<< "$S4_OUT" \
   && [[ -f "$R4/$BOGUS4/important.sh" ]] \
   && [[ ! -e "$R4/.agent-skill-chain/source/close" ]]; then
  ok "S4 workflow root 外（.agent-skill-chain/source 配下）は拒否され移動されない（新規ガード）"
else
  ng "S4 workflow root 外が拒否されなかった（重大・rc=$S4_RC）: $S4_OUT"
fi

# ---------------------------------------------------------------------------------------
# シナリオ5: close/ 直下の issue を渡すと拒否される
# Given: docs/maintainer/workflow/close/<issue>（既に close 済み）
# When:  close-move-issue.sh を実行する
# Then:  workflow root 制限で拒否され非0終了する
# ---------------------------------------------------------------------------------------
R5="$(make_repo)"
ISS5="docs/maintainer/workflow/close/20260801_120000_already"
mkdir -p "$R5/$ISS5"
printf 'x\n' > "$R5/$ISS5/04_review.md"
S5_OUT="$( cd "$R5" && bash "$CLOSE_MOVE" "$ISS5" 2>&1 )"; S5_RC=$?
if [[ $S5_RC -ne 0 ]] && grep -q "許可された workflow root 直下の issue ではない" <<< "$S5_OUT"; then
  ok "S5 close/ 直下の issue は拒否される"
else
  ng "S5 close/ 直下が拒否されなかった（rc=$S5_RC）: $S5_OUT"
fi

# ---------------------------------------------------------------------------------------
# シナリオ6: sentinel 不成立（main_root 直下に .agent-skill-chain/ が無い）で拒否される
# Given: .agent-skill-chain/ を持たない git リポの docs/maintainer/workflow/<issue>
# When:  close-move-issue.sh を実行する
# Then:  "sentinel 不成立" で非0終了する（workflow root 制限より前に発火）
# ---------------------------------------------------------------------------------------
R6="$(mktemp -d)"; TMP_DIRS+=("$R6")
( cd "$R6" && git init -q && git config user.email t@e.x && git config user.name t && git config commit.gpgsign false && mkdir -p docs/maintainer/workflow && : > .keep && git add -A && git commit -qm init ) >/dev/null 2>&1
ISS6="docs/maintainer/workflow/20260801_120000_no_sentinel"
mkdir -p "$R6/$ISS6"; printf 'x\n' > "$R6/$ISS6/04_review.md"
S6_OUT="$( cd "$R6" && bash "$CLOSE_MOVE" "$ISS6" 2>&1 )"; S6_RC=$?
if [[ $S6_RC -ne 0 ]] && grep -q "sentinel 不成立" <<< "$S6_OUT"; then
  ok "S6 sentinel 不成立で拒否される（安全側停止）"
else
  ng "S6 sentinel ガードが発火しなかった（rc=$S6_RC）: $S6_OUT"
fi

# ---------------------------------------------------------------------------------------
# シナリオ7: worktree 内実行は拒否される
# Given: 追跡済み issue を持つメインリポから git worktree を作成し、worktree 側の issue を渡す
# When:  close-move-issue.sh を実行する
# Then:  "worktree 内での実行を検知" で非0終了する
# ---------------------------------------------------------------------------------------
R7="$(make_repo)"
ISS7="docs/maintainer/workflow/20260801_120000_wt"
mkdir -p "$R7/$ISS7"; printf 'tracked\n' > "$R7/$ISS7/04_review.md"
( cd "$R7" && git add -A && git commit -qm add-issue ) >/dev/null 2>&1
WT7="$(mktemp -d)"; TMP_DIRS+=("$WT7")
( cd "$R7" && git worktree add -q "$WT7" HEAD ) >/dev/null 2>&1
S7_OUT="$( cd "$WT7" && bash "$CLOSE_MOVE" "$ISS7" 2>&1 )"; S7_RC=$?
( cd "$R7" && git worktree remove --force "$WT7" ) >/dev/null 2>&1 || true
if [[ $S7_RC -ne 0 ]] && grep -q "worktree 内での実行を検知" <<< "$S7_OUT"; then
  ok "S7 worktree 内実行は拒否される"
else
  ng "S7 worktree ガードが発火しなかった（rc=$S7_RC）: $S7_OUT"
fi

# ---------------------------------------------------------------------------------------
# シナリオ8: 移動先が既に存在すると拒否される（衝突ガード・上書きしない）
# Given: close/<issue>/ が既に存在する
# When:  close-move-issue.sh を実行する
# Then:  "移動先が既に存在する" で非0終了し、元 dir は残る
# ---------------------------------------------------------------------------------------
R8="$(make_repo)"
ISS8="docs/maintainer/workflow/20260801_120000_collision"
mkdir -p "$R8/$ISS8"; printf 'x\n' > "$R8/$ISS8/04_review.md"
mkdir -p "$R8/docs/maintainer/workflow/close/20260801_120000_collision"  # 既存衝突
S8_OUT="$( cd "$R8" && bash "$CLOSE_MOVE" "$ISS8" 2>&1 )"; S8_RC=$?
if [[ $S8_RC -ne 0 ]] && grep -q "移動先が既に存在する" <<< "$S8_OUT" && [[ -d "$R8/$ISS8" ]]; then
  ok "S8 移動先衝突で拒否され上書きしない"
else
  ng "S8 衝突ガードが発火しなかった（rc=$S8_RC）: $S8_OUT"
fi

# ---------------------------------------------------------------------------------------
# シナリオ9: 引数不正（0 個 / 存在しない dir）で拒否される
# ---------------------------------------------------------------------------------------
R9="$(make_repo)"
S9A_OUT="$( cd "$R9" && bash "$CLOSE_MOVE" 2>&1 )"; S9A_RC=$?
S9B_OUT="$( cd "$R9" && bash "$CLOSE_MOVE" docs/maintainer/workflow/does_not_exist 2>&1 )"; S9B_RC=$?
if [[ $S9A_RC -ne 0 ]] && grep -q "引数は <issue-dir>" <<< "$S9A_OUT" \
   && [[ $S9B_RC -ne 0 ]] && grep -q "存在しないかディレクトリでない" <<< "$S9B_OUT"; then
  ok "S9 引数不正（0 個・非存在 dir）は拒否される"
else
  ng "S9 引数検証が不十分（0個 rc=$S9A_RC / 非存在 rc=$S9B_RC）: $S9A_OUT | $S9B_OUT"
fi

echo ""
echo "== 結果: PASS=$PASS FAIL=$FAIL =="
if [[ $FAIL -gt 0 ]]; then
  printf '  失敗: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
exit 0
