#!/usr/bin/env bash
# close-move-issue.sh — 単一 issue ディレクトリを close/ 配下へ移動する（追跡=git mv / 非追跡=mv）
#
# 目的（GitHub Issue #137・ADR-137-3）:
#   完了した単一 issue ディレクトリを、配下ファイルの git 追跡状態でファイル単位に使い分けて
#   `<workflow>/close/<issue>/` へ機械的に移動する Command。追跡ファイルは `git mv`（履歴 move 保持）、
#   非追跡ファイル（github_native の 00〜04・04_review ドラフト・memo 等）は素の `mv` で移動する。
#
# 守備範囲（単一責務・境界）:
#   本スクリプトは「メインツリーにのみ実在する非追跡ドラフトを含むディレクトリを、メインツリーで移動する」
#   機械部分に限定する。リンク補正・完了判断・`gh issue` 操作・PR 作成・commit は含まない（呼び出し側責務）。
#   追跡ファイルの close 移動を PR で確定する経路（feature branch→PR→マージ）は呼び出し側の worktree+PR
#   フローが担う。混在ディレクトリでは本スクリプトを whole-dir で使わず、追跡分は worktree+PR、非追跡分のみ
#   本スクリプト（または素の mv）で扱う運用を推奨する（.agent-skill-chain/project 具体手順・分岐 C 参照）。
#
# 使い方:
#   .agent-skill-chain/source/scripts/close-move-issue.sh <issue-dir>
#   例: .agent-skill-chain/source/scripts/close-move-issue.sh docs/maintainer/workflow/20260717_124638_xxx
#
# 事前条件（呼び出し側責務）:
#   (1) リンク補正・移動前検証が完結していること、(2) 対象 GitHub Issue が CLOSED（人間関与点を経ている）
#   こと、(3) メインツリーで実行すること（worktree 実行は下記ガードで拒否）。
#
# ガード:
#   - メインツリー実行ガード: worktree 内実行（`--git-dir` != `--git-common-dir`）・非 git・解決失敗は
#     安全側にエラー終了（ADR-132-1 の sentinel パターンと一貫＝解決先 root 直下に `.agent-skill-chain/`
#     が実在することを要求）。非追跡ドラフトはメインツリーにのみ実在し worktree では空振りするため。
#   - workflow root 制限ガード（ADR-137-5）: 移動対象の親ディレクトリが、許可された workflow root
#     （`<main_root>/docs/maintainer/workflow` または `<main_root>/.agent-skill-chain/runtime`）の直下で
#     あることを絶対パス照合で要求する。無関係なディレクトリ（例: `.agent-skill-chain/source`）を誤って
#     渡してフレームワーク本体を移動する事故を防ぐ（close/ 直下も root 不一致で自然に拒否される）。
#   - 衝突ガード: 移動先 `close/<issue>/` が既存ならエラー終了（上書きしない）。
#
# 出力: 移動したファイルのパス一覧（stdout）。exit 0=成功 / 非 0=ガード発火・失敗。
#   close/ 配下は読まない（`git status` のパスのみで確認する。移動後の内容読取に依存しない）。

set -euo pipefail

die() { printf 'close-move-issue: ERROR: %s\n' "$*" >&2; exit 1; }

# --- 引数検証 ---
[[ $# -eq 1 ]] || die "引数は <issue-dir> の 1 つ（渡された数: $#）。使い方: close-move-issue.sh <issue-dir>"
issue_arg="$1"
[[ -d "$issue_arg" ]] || die "issue-dir が存在しないかディレクトリでない: $issue_arg"

# 絶対パス化（末尾スラッシュ除去）
issue_dir="$(cd "$issue_arg" && pwd)"
issue_name="$(basename "$issue_dir")"
workflow_dir="$(dirname "$issue_dir")"

# --- メインツリー実行ガード（worktree 実行拒否・非 git/解決失敗は安全側エラー） ---
#   workflow root 制限（下記）は main_root を基準にした絶対パス照合で行うため、main_root の解決
#   （git 解決・worktree 拒否・sentinel）を workflow root 制限より前に済ませる（ADR-137-5）。
git_dir="$(git -C "$issue_dir" rev-parse --path-format=absolute --git-dir 2>/dev/null)" \
  || die "git リポジトリとして解決できない（非 git ツリー等）。メインツリーで実行すること: $issue_arg"
common_dir="$(git -C "$issue_dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
  || die "git-common-dir を解決できない。メインツリーで実行すること: $issue_arg"
if [[ "$git_dir" != "$common_dir" ]]; then
  die "worktree 内での実行を検知した（非追跡ドラフトは worktree に実在せず空振りする）。メインツリーで実行すること。"
fi
main_root="$(dirname "$common_dir")"
# sentinel: メインツリー root 直下に .agent-skill-chain/ が実在すること（ADR-132-1 と一貫）
[[ -d "$main_root/.agent-skill-chain" ]] \
  || die "メインツリー root（$main_root）直下に .agent-skill-chain/ が見つからない（sentinel 不成立・安全側停止）。"

# --- workflow root 制限（許可された workflow root 直下の issue に限定・ADR-137-5） ---
#   従来は「workflow_dir の basename が close でない」ことしか見ておらず、無関係なディレクトリ
#   （例: .agent-skill-chain/source）を誤って渡すと全ガード（メインツリー判定・sentinel）を通過し
#   フレームワーク本体を close/<basename>/ へ移動してしまう危険があった（CodeRabbit 指摘・Major）。
#   対策として、移動対象の親ディレクトリ（workflow_dir）が、許可された workflow root の**直下**である
#   ことを絶対パスで照合する。許可 root は 2 つに固定する（過剰な一般化はしない・安全側）:
#     (1) 本リポ（自己拡張元）の docs/maintainer/workflow
#     (2) 消費者ランタイムの既定 .agent-skill-chain/runtime（本スクリプトは配布物のため消費者環境でも使われる）
#   これにより close/ 直下（親が <root>/close で不一致）や workflow root 外の任意ディレクトリは拒否される。
case "$workflow_dir" in
  "$main_root/docs/maintainer/workflow"|"$main_root/.agent-skill-chain/runtime")
    ;;
  *)
    die "許可された workflow root 直下の issue ではない（許可: <main_root>/docs/maintainer/workflow または <main_root>/.agent-skill-chain/runtime。close/ 直下や無関係ディレクトリは拒否）: $issue_arg"
    ;;
esac

target_parent="$workflow_dir/close"
target_dir="$target_parent/$issue_name"

# --- 衝突ガード ---
[[ ! -e "$target_dir" ]] || die "移動先が既に存在する（上書きしない）: ${target_dir#"$main_root"/}"

# --- ファイル単位移動（追跡=git mv / 非追跡=mv） ---
# E-4: 途中で git mv/mv が失敗すると set -e で即終了し、一部は close/ 側・残りは元位置という
# 分裂状態が残りうる。全自動ロールバックは git mv の逆再生自体が失敗し得るため採用せず、
# 既存の fail-closed 哲学（バックアップ不成立＝上書き中止）に合わせ「失敗時レポート＋人手解決」とする。
moved_list=()
on_move_fail() {
  printf 'close-move-issue: ERROR: 移動が途中で失敗しました。以下は移動済み（未ロールバック）:\n' >&2
  printf '  %s\n' "${moved_list[@]:-(なし)}" >&2
  printf '手動で close/ 側と元位置の分裂を解消してください（自動ロールバックはしません）。\n' >&2
}
trap on_move_fail ERR

mkdir -p "$target_parent"
moved=0
while IFS= read -r -d '' f; do
  rel="${f#"$issue_dir"/}"
  dest="$target_dir/$rel"
  dest_parent="$(dirname "$dest")"
  mkdir -p "$dest_parent"
  if git -C "$main_root" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    git -C "$main_root" mv "$f" "$dest"
  else
    mv "$f" "$dest"
  fi
  moved_list+=("${f#"$main_root"/} -> ${dest#"$main_root"/}")
  printf '%s -> %s\n' "${f#"$main_root"/}" "${dest#"$main_root"/}"
  moved=$((moved + 1))
done < <(find "$issue_dir" \( -type f -o -type l \) -print0)
trap - ERR

# --- 空になった元ディレクトリを削除 ---
# （git mv はディレクトリを残す・mv はファイルのみ移すため、空ディレクトリを掃除する）
if [[ -d "$issue_dir" ]]; then
  find "$issue_dir" -type d -empty -delete 2>/dev/null || true
  rmdir "$issue_dir" 2>/dev/null || true
fi

if [[ "$moved" -eq 0 ]]; then
  die "移動対象ファイルが 0 件だった（空ディレクトリ？）: $issue_arg"
fi

# --- 移動確認（パスのみ・close/ 配下の内容は読まない） ---
printf 'close-move-issue: %d ファイルを %s へ移動しました。\n' "$moved" "${target_dir#"$main_root"/}"
printf '確認は `git status`（パス一覧のみ）で行い、close/ 配下の内容は読まないこと。\n'
git -C "$main_root" status --porcelain -- "${target_dir#"$main_root"/}" 2>/dev/null | sed 's/^/  /' || true
exit 0
