#!/usr/bin/env bash
# worktree_record_guard.sh — worktree 削除前の「記録 commit・push 漏れ検知」共有ライブラリ。
#
# 責務（02_設計 §2.2.1・§3・ADR-1〜4）:
#   当該 worktree の issue 記録（00_要求定義.md〜04_review.md・90_issues.md）に「未 commit の差分」
#   または「未 push のユニークコミット」があるかを、ローカル git 状態のみ（fetch を伴わない）で判定する。
#   既存 R8（worktree_untracked_rescue・物理退避）とは別レイヤーの「記録の commit・push 規律」検知であり、
#   R8 を参照・置換しない（独立・併存）。
#
# 2 経路共有（bash 関数と markdown skill chain の共有・02 §2.2.1）:
#   (A) 削除前ゲート（PreToolUse.sh の R9 / 失敗条件 #41）: 本ファイルを `source` し worktree_record_scan を
#       同一プロセス内で呼ぶ。ファイル不在・関数未定義は R9 を SKIP（fail-open）。
#   (B) 終了時契約（verify-and-close）: `bash worktree_record_guard.sh <close 対象 worktree>` で直接実行し、
#       終了コード（0＝漏れなし／非 0＝記録漏れ）と stdout レポートを close 可否判定に用いる。
#   本ファイルは `source` 時は関数定義のみ（副作用ゼロ）、直接実行時のみ末尾ガードで main を起動する。
#
# 全経路 fail-safe（02 §3 冒頭・共通エラー方針）:
#   非 git・git コマンド不在・R7 命名規則非準拠パス・判定不能・内部エラーは対象外として SKIP（allow 側へ）。
#   block へ倒すのは「記録漏れが確証できた」場合に限る（過剰 block による作業停止を避ける）。
#
# バイパス（ADR-4）:
#   環境変数 ASC_WORKTREE_CLOSE_BYPASS を A・B 双方が同一参照する。設定時は block を解除しつつ、
#   バイパス使用を stderr へ明示ログ出力する（監査痕跡）。
#   残余リスク（ADR-4）: 単発のつもりの `export ASC_WORKTREE_CLOSE_BYPASS=1` はそのセッションの全操作で
#   ガードを恒常無効化する（機構上防げない受容リスク）。単発は必ず `ASC_WORKTREE_CLOSE_BYPASS=1 <cmd>` の
#   インライン指定を推奨し、`export` は避けること。バイパス通過ごとの stderr 警告で各操作時に可視化する。
#
# 走査ルート（02 §3.2）: 既定は docs/maintainer/workflow。環境変数 ASC_RECORD_SCAN_ROOT で上書き可。

# ---------------------------------------------------------------------------
# 出力グローバル変数（呼び出し側が参照する）:
#   IN_SCOPE            環境判定結果（1＝検知対象／0＝対象外・SKIP）
#   RECORD_DIRTY        検知結果（1＝未 commit または未 push あり／0＝漏れなし・SKIP）
#   RECORD_UNCOMMITTED  未 commit の記録ファイル一覧（"<code> <path>" を改行区切り。空＝漏れなし）
#   RECORD_UNPUSHED     未 push ユニークコミットの短 SHA 一覧（改行区切り。空＝漏れなし）
#   RECORD_WARN         stale 等の警告文（無ければ空）
# ---------------------------------------------------------------------------

_wt_record_scan_root() {
  printf '%s' "${ASC_RECORD_SCAN_ROOT:-docs/maintainer/workflow}"
}

# _wt_record_abspath <path> — 絶対パス化（realpath -m 優先・cd+pwd フォールバック）。解決不能は空。
_wt_record_abspath() {
  local p="$1" d b
  [[ -z "$p" ]] && return 0
  if command -v realpath >/dev/null 2>&1 && realpath -m -- "." >/dev/null 2>&1; then
    realpath -m -- "$p" 2>/dev/null; return 0
  fi
  d="$(dirname -- "$p" 2>/dev/null)"; b="$(basename -- "$p" 2>/dev/null)"
  if [[ -d "$d" ]]; then printf '%s/%s' "$(cd "$d" 2>/dev/null && pwd -P)" "$b"
  elif [[ "$p" == /* ]]; then printf '%s' "$p"
  else printf '%s/%s' "$(pwd -P)" "$p"; fi
}

# _wt_record_bypass_active — ASC_WORKTREE_CLOSE_BYPASS が有効か（非空かつ "0" 以外）。
_wt_record_bypass_active() {
  [[ -n "${ASC_WORKTREE_CLOSE_BYPASS:-}" && "${ASC_WORKTREE_CLOSE_BYPASS}" != "0" ]]
}

# _wt_record_bypass_warn <target> — バイパス使用の明示警告を stderr へ（監査痕跡・ADR-4）。
_wt_record_bypass_warn() {
  echo "[enforcement:warn] worktree record guard bypassed via ASC_WORKTREE_CLOSE_BYPASS — records may remain uncommitted/unpushed / ASC_WORKTREE_CLOSE_BYPASS によりガードがバイパスされました（記録が未 commit・未 push のまま失われる可能性があります）: target=${1:-.}" >&2
}

# _wt_record_env_gate <target> — fail-safe gate ＋ R7 命名規則準拠パスのパスベースのスコープ（ADR-3）。
#   IN_SCOPE を設定する。作成時刻・baseline は一切参照しない（パス構造のみ・finding-5）。
_wt_record_env_gate() {
  IN_SCOPE=0
  local target="$1" abspath rest type ts name r2
  [[ -z "$target" ]] && return 0
  command -v git >/dev/null 2>&1 || return 0
  git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  abspath="$(_wt_record_abspath "$target")"
  [[ -z "$abspath" ]] && return 0
  abspath="${abspath%/}"
  # パスフィルタ: 最も内側の .worktree/ 以降が <type>/<YYYYMMDD_HHMMSS>-<name> か。
  #   既存 R7 validate_worktree_path（PreToolUse.sh）と同一の type 集合・timestamp 形式・区切りをミラーする
  #   （<type> と ts の間は `/`、ts と <name> の間は `-`。ts に `-` は無いため最初の `-` が区切りに一意対応）。
  case "$abspath" in
    */.worktree/*) rest="${abspath##*/.worktree/}" ;;   # 最後の .worktree/ 以降（ネスト耐性）
    *) return 0 ;;
  esac
  type="${rest%%/*}"; r2="${rest#*/}"
  [[ "$r2" == "$rest" ]] && return 0            # type 区切り（/）無し
  ts="${r2%%-*}"; name="${r2#*-}"
  [[ "$name" == "$r2" ]] && return 0            # ts と固有名の区切り（-）無し
  case "$name" in */*) return 0 ;; esac         # name に / があれば非準拠（余分な階層）
  [[ -n "$name" ]] || return 0
  case "$type" in feature|bugfix|hotfix|release|chore) ;; *) return 0 ;; esac
  [[ "$ts" =~ ^[0-9]{8}_[0-9]{6}$ ]] || return 0
  IN_SCOPE=1
  return 0
}

# _wt_record_scope <path> — scope 述語（追跡状態を問わない・02 §3.2・finding-1/finding-3）。
#   真（return 0）: basename が記録ファイル名パターン（closed set: 0[0-4]_*.md ／ 90_issues.md）に一致し、
#   かつ memo/ 配下でない。パスが走査ルート配下かは呼び出し側の `git status -- <root>` で担保する。
_wt_record_scope() {
  local p="$1" base
  [[ -z "$p" ]] && return 1
  case "$p" in memo/*|*/memo/*) return 1 ;; esac        # memo/ は非追跡・transient（対象外）
  base="${p##*/}"
  case "$base" in
    0[0-4]_*.md) return 0 ;;                             # 00_要求定義.md 〜 04_review.md
    90_issues.md) return 0 ;;                            # 親ワークフロー記録（独立併記・finding-3）
    *) return 1 ;;
  esac
}

# _wt_record_uncommitted <target> — 記録対象ファイルの未 commit 差分を判定（02 §3.3・finding-1）。
#   RECORD_UNCOMMITTED に "<code> <path>" を改行区切りで収集（空なら漏れなし）。
#   `--untracked-files=all`（-uall）で未追跡ディレクトリを個別ファイルまで展開し、一度も commit されていない
#   新規記録ファイル（`??`）を取りこぼさない。`--ignored=no` で ignored は除外。core.quotepath=false で
#   日本語ファイル名を非エスケープのまま得る（basename パターン照合のため）。
_wt_record_uncommitted() {
  RECORD_UNCOMMITTED=""
  local target="$1" root line code path status_out
  root="$(_wt_record_scan_root)"
  status_out="$(git -C "$target" -c core.quotepath=false status --porcelain --untracked-files=all --ignored=no -- "$root" 2>/dev/null)" || return 0
  [[ -z "$status_out" ]] && return 0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    code="${line:0:2}"
    path="${line:3}"
    case "$path" in *" -> "*) path="${path##* -> }" ;; esac   # rename 表記は新パスを採る
    if _wt_record_scope "$path"; then
      RECORD_UNCOMMITTED+="${code} ${path}"$'\n'
    fi
  done <<< "$status_out"
  RECORD_UNCOMMITTED="${RECORD_UNCOMMITTED%$'\n'}"
  return 0
}

# _wt_record_unpushed <target> — 未 push ユニークコミット判定（02 §3.4・ADR-2・finding-2）。
#   RECORD_UNPUSHED に短 SHA を改行区切りで収集。RECORD_WARN に stale 警告文。
#   優先: `git rev-list @{u}..HEAD -- <root>`。@{u} 未設定は `origin/<branch>` へフォールバック。
#   pathspec `-- <root>` により記録格納ルートを変更したユニークコミットのみを数える（未 commit 判定と
#   スコープ対称・finding-2）。`git fetch` は行わない（オフライン・ローカル remote-tracking 参照のみ）。
_wt_record_unpushed() {
  RECORD_UNPUSHED=""; RECORD_WARN=""
  local target="$1" root base branch shas
  root="$(_wt_record_scan_root)"
  command -v git >/dev/null 2>&1 || return 0
  git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  if git -C "$target" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    base='@{u}'
  else
    branch="$(git -C "$target" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    if [[ -n "$branch" && "$branch" != "HEAD" ]] \
       && git -C "$target" rev-parse --verify --quiet "origin/$branch" >/dev/null 2>&1; then
      base="origin/$branch"
    else
      # upstream・origin/<branch> ともに未解決（origin 以外の remote・参照不在）→ SKIP＋警告（過剰 block 回避）。
      RECORD_WARN="unpushed check skipped: cannot resolve upstream or origin/<branch> (remote-tracking ref absent) / 未 push 判定を SKIP: upstream も origin/<branch> も解決できません（remote-tracking 参照が無い）"
      return 0
    fi
  fi
  shas="$(git -C "$target" rev-list --abbrev-commit "${base}..HEAD" -- "$root" 2>/dev/null)" || return 0
  if [[ -n "$shas" ]]; then
    RECORD_UNPUSHED="$shas"
    # fetch を伴わないため remote-tracking が stale の可能性を常に明示する（黙って握り潰さない・ADR-2）。
    RECORD_WARN="unpushed judgment does not run 'git fetch'; the remote-tracking ref may be stale and diverge from reality / 未 push 判定は 'git fetch' を伴わないため、remote-tracking 参照が stale で実際と乖離している可能性があります"
  fi
  return 0
}

# worktree_record_scan <target> — 検知コア（純関数・02 §3.1）。env gate → 未 commit → 未 push を統合し
#   RECORD_DIRTY を設定する。副作用なし（グローバル変数の設定のみ）。
worktree_record_scan() {
  RECORD_DIRTY=0; RECORD_UNCOMMITTED=""; RECORD_UNPUSHED=""; RECORD_WARN=""; IN_SCOPE=0
  local target="${1:-.}"
  _wt_record_env_gate "$target"
  [[ "$IN_SCOPE" == "1" ]] || return 0          # 対象外は即 SKIP（RECORD_DIRTY=0）
  _wt_record_uncommitted "$target"
  _wt_record_unpushed "$target"
  if [[ -n "$RECORD_UNCOMMITTED" || -n "$RECORD_UNPUSHED" ]]; then
    RECORD_DIRTY=1
  fi
  return 0
}

# worktree_record_reject — reporter 本文を stdout へ生成（02 §3.8）。
#   メッセージ本文（block 見出し・未 commit 一覧・未 push 一覧・解消手順・stale 警告）を本関数に集約し、
#   A（stderr へ流し exit 2）・B（stdout をそのまま提示）で同一文面を共有する（transport のみ差異）。
#   RECORD_UNCOMMITTED / RECORD_UNPUSHED / RECORD_WARN を参照する。
worktree_record_reject() {
  local l
  echo "[enforcement:block] worktree deletion blocked: issue records are uncommitted/unpushed / worktree 削除をブロック: issue 記録が未 commit・未 push です"
  if [[ -n "$RECORD_UNCOMMITTED" ]]; then
    echo "  uncommitted records / 未 commit の記録ファイル:"
    while IFS= read -r l; do [[ -n "$l" ]] && echo "    $l"; done <<< "$RECORD_UNCOMMITTED"
  fi
  if [[ -n "$RECORD_UNPUSHED" ]]; then
    echo "  unpushed commits touching records / 記録に触れる未 push コミット:"
    while IFS= read -r l; do [[ -n "$l" ]] && echo "    $l"; done <<< "$RECORD_UNPUSHED"
  fi
  echo "  fix / 解消手順:"
  echo "    git add <files> && git commit -m \"...\"   # commit the records / 記録を commit する"
  echo "    git push                                    # push to origin / origin へ push する"
  echo "    bypass (single use; avoid 'export') / バイパス（単発・export は避ける）: ASC_WORKTREE_CLOSE_BYPASS=1 <cmd>"
  [[ -n "$RECORD_WARN" ]] && echo "  warn / 警告: $RECORD_WARN"
}

# _wt_record_main <target> — 直接実行（B 経路）のエントリ（02 §3.7・T4-4）。
#   scan → RECORD_DIRTY=1 かつ非バイパスなら reporter を stdout へ出し非 0 終了、それ以外は 0 終了。
_wt_record_main() {
  local target="${1:-.}"
  worktree_record_scan "$target"
  if [[ "${RECORD_DIRTY:-0}" == "1" ]]; then
    if _wt_record_bypass_active; then
      _wt_record_bypass_warn "$target"
      [[ -n "$RECORD_WARN" ]] && echo "[enforcement:warn] $RECORD_WARN" >&2
      return 0
    fi
    worktree_record_reject
    return 1
  fi
  # 漏れなし／SKIP。stale 等の警告があれば合格でも stderr へ併記する（§3.7）。
  [[ -n "$RECORD_WARN" ]] && echo "[enforcement:warn] $RECORD_WARN" >&2
  return 0
}

# 直接実行時のみ main を起動（source 時は関数定義のみ・副作用ゼロ・02 §2.2.1）。
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  _wt_record_main "$@"
  exit $?
fi
