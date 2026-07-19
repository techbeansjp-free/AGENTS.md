#!/usr/bin/env bash
# test-worktree-record-guard.sh — worktree 削除前の記録 commit・push 漏れ検知（R9 / 失敗条件 #41）の
#   単体/結合/E2E テスト。
#
# ユースケース（このテストファイル全体）:
#   共有ライブラリ enforcement/lib/worktree_record_guard.sh（環境判定 _wt_record_env_gate／絞り込み
#   _wt_record_scope／未 commit _wt_record_uncommitted／未 push _wt_record_unpushed／検知コア
#   worktree_record_scan／reporter worktree_record_reject／直接実行 main）と、正本 PreToolUse.sh の
#   アダプタ A（R9・削除前ゲート）が 02_設計 §3・03_実装計画 T1〜T7 の契約どおり動作すること。
#   fail-open の非対称（非 git／R7 命名非準拠パス／判定不能は SKIP・過剰 block ゼロ）と、未 commit／未 push の
#   スコープ対称（finding-2）・未追跡ディレクトリの個別展開（finding-1）・90_issues.md 取りこぼし防止
#   （finding-3）・パスベースのスコープ（finding-5）を検証する。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - 純関数は共有 lib を直接 source して呼ぶ（PreToolUse.sh の sed 抽出は不要＝独立スクリプト）。
#   - B 経路（終了時契約）は `bash <lib> <target>` の終了コード＋stdout レポートをアサートする。
#   - A 経路（R9 結合）は正本 hook を stdin JSON で駆動する（AGENTS_ROOT は本リポ source を read-only 参照、
#     WORKTREE_TRASH_ROOT は $TMP に固定して本リポ .claude/ を汚さない）。
#   - 未 push は $TMP のローカル bare リポを origin に見立て、`git fetch` を伴わずに検証する（ネットワーク非依存）。
#   - 本リポの .agent-skill-chain/source/ .claude/ .worktree/ workflow.db を一切書き換えない。
#
# 使い方: bash test/test-worktree-record-guard.sh   # リポジトリルートで実行
# 前提: bash・git。

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
HOOK="$REPO_ROOT/.agent-skill-chain/source/enforcement/claude/PreToolUse.sh"
REPO_SRC="$REPO_ROOT/.agent-skill-chain/source"
LIB_RG="$REPO_SRC/enforcement/lib/worktree_record_guard.sh"
command -v git >/dev/null 2>&1 || { echo "エラー: git が必要です" >&2; exit 2; }
[[ -f "$HOOK" && -f "$LIB_RG" ]] || { echo "エラー: hook/lib が見つかりません" >&2; exit 2; }

PASS=0; FAIL=0; FAILED_NAMES=()
ok() { PASS=$((PASS+1)); }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
TRASH="$TMP/trash"
ERR="$TMP/err.txt"

# ---- 共有 lib を直接 source（純関数の単体テスト用） ----
# shellcheck disable=SC1090
source "$LIB_RG"

# ---- フィクスチャ helper ----
# 安全ガード（データロス防止・重要）: fixture パスが空・$TMP 配下でない場合は即異常終了する。
#   `git -C "" ...` は cwd（＝本リポ作業ツリー）に対して実行され、誤って本リポへ commit する事故を招くため
#   （実際にこの実装中、空パスバグで "code only" 誤 commit が発生した）、全 git 操作の前段で必ず検証する。
_assert_tmp() { [[ -n "$1" && "$1" == "$TMP"/* ]] || { echo "FATAL: fixture path is empty or outside TMP: '$1'（本リポへの誤操作防止のため中断）" >&2; exit 3; }; }
# mk_wt <rel> — $TMP/.worktree/<rel> に隔離 git リポを作る（R7 命名準拠パス）。作成した絶対パスを返す。
mk_wt() { local p="$TMP/.worktree/$1"; _assert_tmp "$p"; mkdir -p "$p"; git -C "$p" init -q; git -C "$p" config user.email t@t; git -C "$p" config user.name t; printf '%s' "$p"; }
# mk_plain <rel> — $TMP/<rel> に R7 命名非準拠パスの隔離 git リポを作る。絶対パスを返す。
mk_plain() { local p="$TMP/$1"; _assert_tmp "$p"; mkdir -p "$p"; git -C "$p" init -q; printf '%s' "$p"; }
# add_rec <W> <issue_dir> <file...> — 記録ファイルを作る（未追跡のまま）。
add_rec() { local W="$1" id="$2"; shift 2; _assert_tmp "$W"; local d="$W/docs/maintainer/workflow/$id"; mkdir -p "$d"; local f; for f in "$@"; do : > "$d/$f"; done; }
# setup_wt_with_origin <rel> — ローカル bare を origin に見立てた準拠 worktree。初期 commit を push 済み
#   （upstream 設定）にして返す。以降の commit は未 push。`git fetch` は使わない（オフライン）。
setup_wt_with_origin() {
  local rel="$1"
  local W="$TMP/.worktree/$rel"
  local bare="$TMP/origin_${rel//\//_}.git"
  local br
  _assert_tmp "$W"; _assert_tmp "$bare"
  git init -q --bare "$bare"
  mkdir -p "$W"; git -C "$W" init -q; git -C "$W" config user.email t@t; git -C "$W" config user.name t
  git -C "$W" remote add origin "$bare"
  echo init > "$W/README"; git -C "$W" add -A; git -C "$W" commit -qm init
  br="$(git -C "$W" rev-parse --abbrev-ref HEAD)"
  git -C "$W" push -q -u origin "$br" 2>/dev/null
  printf '%s' "$W"
}

# ---- A 経路（R9 結合）: 正本 hook を stdin JSON で駆動 ----
run_hook() { local cmd="$1" cwd="${2:-}" json
  json="{\"tool_name\":\"Bash\",\"agent_id\":\"sub-1\",\"tool_input\":{\"command\":\"$cmd\"}}"
  : > "$ERR"
  if [[ -n "$cwd" ]]; then
    ( cd "$cwd" && echo "$json" | env AGENTS_ROOT="$REPO_SRC" AGENT_ROLE="worker" WORKTREE_TRASH_ROOT="$TRASH" bash "$HOOK" >/dev/null 2>"$ERR" ); RC=$?
  else
    echo "$json" | env AGENTS_ROOT="$REPO_SRC" AGENT_ROLE="worker" WORKTREE_TRASH_ROOT="$TRASH" bash "$HOOK" >/dev/null 2>"$ERR"; RC=$?
  fi
}
assert_rc() { [[ "$RC" == "$1" ]] && ok || ng "$2 (rc=$RC exp=$1)"; }
assert_err() { grep -q "$1" "$ERR" && ok || ng "$2 (stderr に '$1' が無い)"; }
assert_nerr() { grep -q "$1" "$ERR" && ng "$2 (stderr に '$1' が現れた)" || ok; }

# =====================================================================================
# 単体: 環境判定・パスベースのスコープ（§3.5・ADR-3／finding-5）
# =====================================================================================
# ユースケース: R7 命名規則準拠パスのみを検知対象とし、作成時刻・baseline を一切参照せず、
#   非 git・非準拠パスは fail-safe に SKIP する（過去のロックアウト事故の教訓＝過剰 block 回避）。
echo "== 単体: _wt_record_env_gate（パスベースのスコープ） =="

# シナリオ: R7準拠パスは作成時期を問わず対象  # RG-T1b ← 01 シナリオ8-G(a)
# Given: target が .worktree/feature/20260716_143000-x/ 形式の git ツリー
W=$(mk_wt "feature/20260716_143000-x")
# When: _wt_record_env_gate を呼ぶ（baseline・作成時刻を一切参照しない）
_wt_record_env_gate "$W"
# Then: IN_SCOPE=1（時期ベースの「新規のみ」ではない）
[[ "$IN_SCOPE" == "1" ]] && ok || ng "RG-T1b 準拠パスは IN_SCOPE=1"

# シナリオ: 準拠パスだが state を一切持たない（導入前相当）でも対象  # RG-T1b2 ← 01 シナリオ8-G(a)
# Given: 別の準拠パス（新しい state を持たない）
W2=$(mk_wt "bugfix/20250101_000000-legacy")
# When: env gate を評価する
_wt_record_env_gate "$W2"
# Then: 時期を判定しないため IN_SCOPE=1
[[ "$IN_SCOPE" == "1" ]] && ok || ng "RG-T1b2 導入前相当でも時期非依存で IN_SCOPE=1"

# シナリオ: 非準拠パスは新旧問わず対象外  # RG-T1c ← 01 シナリオ8-G(b)
# Given: target が R7 命名規則を外れるパスの git ツリー
N=$(mk_plain "plain/x")
# When: env gate を評価する
_wt_record_env_gate "$N"
# Then: IN_SCOPE=0
[[ "$IN_SCOPE" == "0" ]] && ok || ng "RG-T1c 非準拠パスは IN_SCOPE=0"

# シナリオ: type が 5 種以外の準拠風パスは対象外  # RG-T1d ← 境界値
# Given: type=feat（5 種外）の準拠風パス
BAD=$(mk_wt "feat/20260716_143000-x")
# When: env gate を評価する
_wt_record_env_gate "$BAD"
# Then: IN_SCOPE=0（type 集合 feature|bugfix|hotfix|release|chore に不一致）
[[ "$IN_SCOPE" == "0" ]] && ok || ng "RG-T1d type 5 種外は IN_SCOPE=0"

# シナリオ: 非gitツリーはSKIP  # RG-T1a ← 01 シナリオ8
# Given: target が git ツリーでない一時ディレクトリ
NG="$TMP/.worktree/feature/20260716_143000-notgit"; mkdir -p "$NG"
# When: env gate を評価する
_wt_record_env_gate "$NG"
# Then: IN_SCOPE=0（rev-parse --is-inside-work-tree 偽）
[[ "$IN_SCOPE" == "0" ]] && ok || ng "RG-T1a 非 git ツリーは IN_SCOPE=0"

# シナリオ: git コマンド不在をシミュレートすると SKIP  # RG-T1e ← 境界値・fail-safe
# Given: PATH を空にして git を解決不能にする
# When: env gate を評価する（サブシェルで PATH を落とす）
( PATH=""; _wt_record_env_gate "$W"; [[ "$IN_SCOPE" == "0" ]] ) && ok || ng "RG-T1e git 不在は IN_SCOPE=0（fail-safe）"

# =====================================================================================
# 単体: 記録対象ファイル絞り込み + 未 commit 判定（§3.2・§3.3・finding-1／finding-3）
# =====================================================================================
# ユースケース: 追跡状態を問わず記録ファイル名パターンに一致する未 commit 差分を検知し、未追跡
#   ディレクトリを個別ファイルまで展開し、親ワークフロー 90_issues.md を取りこぼさず、memo/・ignored を
#   誤検知しない。
echo "== 単体: _wt_record_scope / _wt_record_uncommitted =="

# シナリオ: 記録対象ファイルの未commit差分を検知  # RG-T2a ← 01 シナリオ1
# Given: 追跡済み 02_設計.md に未ステージ変更がある準拠 worktree
W=$(mk_wt "feature/20260716_143000-rec2a"); d="$W/docs/maintainer/workflow/20260101_000000_x"
mkdir -p "$d"; echo v1 > "$d/02_設計.md"; git -C "$W" add -A; git -C "$W" commit -qm init; echo v2 >> "$d/02_設計.md"
# When: 未 commit 判定を呼ぶ
_wt_record_uncommitted "$W"
# Then: RECORD_UNCOMMITTED に 02_設計.md が載る
grep -q "02_設計.md" <<<"$RECORD_UNCOMMITTED" && ok || ng "RG-T2a 追跡済み記録の未ステージ変更を検知"

# シナリオ: 一度も commit されていない未追跡ディレクトリを個別展開  # RG-T2b ← 01 シナリオ1（finding-1・SC-5同型）
# Given: issue ディレクトリ一式が一度も add されていない未追跡状態
W=$(mk_wt "feature/20260716_143000-rec2b"); add_rec "$W" 20260101_000000_x 00_要求定義.md 04_review.md
# When: -uall で status 走査する（未 commit 判定）
_wt_record_uncommitted "$W"
# Then: 00_要求定義.md〜04_review.md が個別に RECORD_UNCOMMITTED へ載る
grep -q "00_要求定義.md" <<<"$RECORD_UNCOMMITTED" && grep -q "04_review.md" <<<"$RECORD_UNCOMMITTED" \
  && ok || ng "RG-T2b 未追跡 issue 一式を -uall で個別展開して検知"

# シナリオ: 既定 -unormal では畳まれ空振りする（対照確認）  # RG-T2b2 ← 境界値（finding-1 の実証）
# Given: 同じ未追跡ディレクトリ状態
# When: 既定 -unormal で status を走らせる（対照）
collapsed="$(git -C "$W" -c core.quotepath=false status --porcelain -- docs/maintainer/workflow 2>/dev/null)"
# Then: 未追跡ディレクトリが畳まれ（末尾 / のディレクトリ行）、個別記録ファイル名は現れない
[[ -n "$collapsed" ]] && { ! grep -q "00_要求定義.md" <<<"$collapsed"; } && grep -q "/$" <<<"$collapsed" \
  && ok || ng "RG-T2b2 -unormal は未追跡ディレクトリを畳み空振りする（-uall の必要性）"

# シナリオ: 親ワークフローの 90_issues.md を取りこぼさない  # RG-T2c ← 01 シナリオ1（finding-3）
# Given: 未commit（新規 ??）の 90_issues.md がある準拠 worktree
W=$(mk_wt "feature/20260716_143000-rec2c"); pd="$W/docs/maintainer/workflow/20260101_000000_x"; mkdir -p "$pd"; : > "$pd/90_issues.md"
# When: 未 commit 判定を呼ぶ
_wt_record_uncommitted "$W"
# Then: RECORD_UNCOMMITTED に 90_issues.md が載る（0[0-4]_*.md 単独では不一致・独立併記が効く）
grep -q "90_issues.md" <<<"$RECORD_UNCOMMITTED" && ok || ng "RG-T2c 90_issues.md を独立パターンで検知"

# シナリオ: 記録対象外の変更のみでは検知しない  # RG-T2d ← 01 シナリオ1 の And 節
# Given: memo/ 配下・非追跡 transient のみ変更がある準拠 worktree
W=$(mk_wt "feature/20260716_143000-rec2d"); md="$W/docs/maintainer/workflow/20260101_000000_x/memo"; mkdir -p "$md"; : > "$md/20260101_000000_note.md"
# When: 未 commit 判定を呼ぶ
_wt_record_uncommitted "$W"
# Then: RECORD_UNCOMMITTED は空（memo/ は対象外・誤検知しない）
[[ -z "$RECORD_UNCOMMITTED" ]] && ok || ng "RG-T2d memo/ のみ変更は誤検知しない"

# シナリオ: scope 述語が basename パターンを正しく判定  # RG-T2e ← 単体（述語）
# Given/When/Then: 記録名パターンは真、それ以外・memo/ は偽
_wt_record_scope "docs/maintainer/workflow/x/00_要求定義.md" && _wt_record_scope "docs/x/90_issues.md" \
  && ! _wt_record_scope "docs/x/README.md" && ! _wt_record_scope "docs/x/memo/00_要求定義.md" \
  && ok || ng "RG-T2e scope 述語（記録名 真・README/memo 偽）"

# =====================================================================================
# 単体: 未 push 判定（§3.4・ADR-2・finding-2 スコープ対称）
# =====================================================================================
# ユースケース: 記録格納ルートを変更した未 push ユニークコミットのみを pathspec で数え、記録に無関係な
#   コード変更のみの未 push は検知せず、`git fetch` を伴わず、stale は警告付きで許容する。
echo "== 単体: _wt_record_unpushed =="

# シナリオ: 記録に無関係なコード変更のみの未pushは検知しない  # RG-T3b ← 01 シナリオ4-N（finding-2）
# Given: ローカル bare を origin にした準拠 worktree で、記録に無関係なコミットのみ未push
W=$(setup_wt_with_origin "feature/20260716_143000-up3b")
mkdir -p "$W/enforcement"; echo x >> "$W/enforcement/dummy.sh"; git -C "$W" add -A; git -C "$W" commit -qm "code only"
# When: 未 push 判定を呼ぶ
_wt_record_unpushed "$W"
# Then: 記録格納ルート外のみのため RECORD_UNPUSHED は空（未 commit 判定とスコープ対称・過剰 block しない）
[[ -z "$RECORD_UNPUSHED" ]] && ok || ng "RG-T3b 記録無関係の未 push は検知しない（finding-2 対称）"

# シナリオ: 記録対象を変更した未pushユニークコミットを検知  # RG-T3a ← 01 シナリオ4
# Given: 同 worktree に記録対象ファイルを変更した未 push コミットを加える
d="$W/docs/maintainer/workflow/20260101_000000_x"; mkdir -p "$d"; echo y >> "$d/00_要求定義.md"
git -C "$W" add -A; git -C "$W" commit -qm "record change"
# When: 未 push 判定を呼ぶ（@{u}..HEAD -- <走査ルート>・fetch なし）
_wt_record_unpushed "$W"
# Then: RECORD_UNPUSHED に未 push コミットが載る
[[ -n "$RECORD_UNPUSHED" ]] && ok || ng "RG-T3a 記録変更の未 push を検知（@{u} pathspec）"

# シナリオ: fetchを伴わないstale判定は警告付きで許容  # RG-T3c ← 01 シナリオ5
# Given: 未 push 検知が成立した状態（上の W）
# When: 判定を継続する
# Then: RECORD_WARN に乖離可能性の警告が添う（黙って握り潰さない）
[[ -n "$RECORD_WARN" ]] && ok || ng "RG-T3c stale 警告 RECORD_WARN が付与される"

# シナリオ: upstream未設定でも origin/<branch> フォールバックで検知継続  # RG-T3d ← 01 シナリオ4（フォールバック）
# Given: origin/<branch> は在るが upstream 未設定の準拠 worktree
W=$(setup_wt_with_origin "feature/20260716_143000-up3d")
git -C "$W" branch --unset-upstream 2>/dev/null
d="$W/docs/maintainer/workflow/20260101_000000_x"; mkdir -p "$d"; echo z >> "$d/01_要件定義.md"
git -C "$W" add -A; git -C "$W" commit -qm "record change no upstream"
# When: 未 push 判定を呼ぶ
_wt_record_unpushed "$W"
# Then: origin/<branch> フォールバックで RECORD_UNPUSHED が非空
[[ -n "$RECORD_UNPUSHED" ]] && ok || ng "RG-T3d upstream 未設定は origin/<branch> フォールバックで検知"

# シナリオ: origin未解決（remote不在）はSKIP＋警告  # RG-T3e ← 境界値・fail-open
# Given: remote を持たない準拠 worktree（origin 未解決）
W=$(mk_wt "feature/20260716_143000-up3e"); d="$W/docs/maintainer/workflow/20260101_000000_x"; mkdir -p "$d"; echo a > "$d/00_要求定義.md"; git -C "$W" add -A; git -C "$W" commit -qm c
# When: 未 push 判定を呼ぶ
_wt_record_unpushed "$W"
# Then: 判定不能として RECORD_UNPUSHED 空・RECORD_WARN 非空（過剰 block しない）
[[ -z "$RECORD_UNPUSHED" && -n "$RECORD_WARN" ]] && ok || ng "RG-T3e origin 未解決は SKIP＋警告"

# =====================================================================================
# 単体/結合: 検知コア + reporter + バイパス（§3.1・§3.8・ADR-4）
# =====================================================================================
# ユースケース: 検知コアが env gate → 未 commit → 未 push を統合して RECORD_DIRTY を返し、reporter が
#   解消手順つきの日英併記メッセージを生成し、ASC_WORKTREE_CLOSE_BYPASS で block を解除して痕跡を残す。
echo "== 単体/結合: worktree_record_scan / worktree_record_reject / main（B 経路契約） =="

# シナリオ: 未commitありで検知コアが RECORD_DIRTY=1  # RG-T4core ← 01 シナリオ1
# Given: 未 commit ありの準拠 worktree
W=$(mk_wt "feature/20260716_143000-scan"); add_rec "$W" 20260101_000000_x 00_要求定義.md
# When: 検知コアを呼ぶ
worktree_record_scan "$W"
# Then: RECORD_DIRTY=1
[[ "$RECORD_DIRTY" == "1" ]] && ok || ng "RG-T4core 未 commit ありで RECORD_DIRTY=1"

# シナリオ: env gate 対象外は即 SKIP  # RG-T4skip ← 01 シナリオ8-G(b)
# Given: 非準拠パスに未 commit 記録がある
P="$TMP/plain/scan"; mkdir -p "$P/docs/maintainer/workflow/20260101_000000_x"; git -C "$P" init -q; : > "$P/docs/maintainer/workflow/20260101_000000_x/00_要求定義.md"
# When: 検知コアを呼ぶ
worktree_record_scan "$P"
# Then: RECORD_DIRTY=0（即 SKIP・過剰 block 回避）
[[ "$RECORD_DIRTY" == "0" ]] && ok || ng "RG-T4skip 非準拠パスは RECORD_DIRTY=0（即 SKIP）"

# シナリオ: reporter が解消手順つき日英併記を生成  # RG-T4rep ← §3.8
# Given: 未 commit を検知した状態（上の scan で RECORD_UNCOMMITTED 設定）
worktree_record_scan "$W"
# When: reporter を呼ぶ
rep="$(worktree_record_reject)"
# Then: [enforcement:block] プレフィックス・未 commit ファイル名・git commit／git push 解消例を含む
grep -q "enforcement:block" <<<"$rep" && grep -q "00_要求定義.md" <<<"$rep" \
  && grep -q "git commit" <<<"$rep" && grep -q "git push" <<<"$rep" \
  && ok || ng "RG-T4rep reporter に block プレフィックス・ファイル名・解消手順"

# シナリオ: 検知時は既定でblock（B 経路 main）  # RG-T4a ← 01 シナリオ2
# Given: 未commit差分ありの準拠 worktree、ASC_WORKTREE_CLOSE_BYPASS 未設定
W=$(mk_wt "feature/20260716_143000-blk"); add_rec "$W" 20260101_000000_x 00_要求定義.md
# When: main（B 経路）を bash 直接実行する
out=$(bash "$LIB_RG" "$W"); rc=$?
# Then: 非0終了し、stdout に解消手順つきレポートを出す
[[ $rc -ne 0 ]] && grep -q "enforcement:block" <<<"$out" && ok || ng "RG-T4a 既定 block（非 0＋stdout レポート）"

# シナリオ: 明示バイパスで通過し痕跡を残す  # RG-T4b ← 01 シナリオ3
# Given: 同じ検知条件で ASC_WORKTREE_CLOSE_BYPASS=1
# When: main を bash 実行する
err=$(ASC_WORKTREE_CLOSE_BYPASS=1 bash "$LIB_RG" "$W" 2>&1 >/dev/null); rc=$?
# Then: 終了コード0で通過し、stderr にバイパス使用の明示警告ログが出る
[[ $rc -eq 0 ]] && grep -qi "bypass" <<<"$err" && ok || ng "RG-T4b バイパス通過（exit 0＋警告ログ）"

# シナリオ: 漏れなしなら終了コード0（B 経路合格）  # RG-T4clean ← 01 シナリオ1-B 対偶
# Given: 記録漏れなしの準拠 worktree（記録を commit 済み）
C=$(mk_wt "feature/20260716_143000-clean"); cd_="$C/docs/maintainer/workflow/20260101_000000_x"; mkdir -p "$cd_"; echo ok > "$cd_/00_要求定義.md"; git -C "$C" add -A; git -C "$C" commit -qm rec
# When: main を bash 実行する
bash "$LIB_RG" "$C" >/dev/null 2>&1; rc=$?
# Then: 終了コード0（合格・close 続行可）
[[ $rc -eq 0 ]] && ok || ng "RG-T4clean 漏れなしは終了コード 0"

# =====================================================================================
# 結合: アダプタ A（削除前ゲート R9 / #41・正本 hook を stdin JSON で駆動）（§3.6）
# =====================================================================================
# ユースケース: 削除形コマンド検知時に対象 worktree の記録漏れを R9 が block（exit 2）し、非削除形・対象外・
#   非準拠パス・バイパスは fail-open で exit 0（正当な削除を過剰 block しない）。既存 R8 と併存する。
echo "== 結合: R9 削除前ゲート（正本 hook・stdin JSON） =="

# シナリオ: 削除コマンドの実行前に未commitを検知しblock  # RG-T5a ← 01 シナリオ1-A
# Given: 準拠 worktree の記録対象ファイルに未commit差分がある
W=$(mk_wt "feature/20260716_143000-gate5a"); add_rec "$W" 20260101_000000_x 00_要求定義.md
# When: git worktree remove <path> を stdin JSON で hook に渡す
run_hook "git worktree remove $W"
# Then: hook が R9 で exit 2（block）し stderr に解消手順を出す
assert_rc 2 "RG-T5a 削除前に未 commit を検知し block"
assert_err "enforcement:block" "RG-T5a block メッセージ"
assert_err "解消手順" "RG-T5a 解消手順の提示"

# シナリオ: 2026-07-15事故同型の削除が防止される  # RG-T5b ← 01 シナリオ7（SC-5・E2E）
# Given: 未commit の 00〜03 一式（未追跡）を含む準拠 worktree
W=$(mk_wt "feature/20260716_143000-e2e5b"); add_rec "$W" 20260101_000000_x 00_要求定義.md 01_要件定義.md 02_設計.md 03_実装計画.md
# When: バイパス無しで git worktree remove --force <path> を hook に渡す（CWD=$W）
run_hook "git worktree remove --force $W" "$W"
# Then: exit 2 で block され、明示フラグ無しでは記録が失われない
assert_rc 2 "RG-T5b 事故同型（未追跡 00〜03 の remove --force）が block される"
assert_err "enforcement:block" "RG-T5b 解消手順メッセージ"

# シナリオ: 削除形だが記録漏れなしは素通り  # RG-T5c ← 01 シナリオ1-A 対偶
# Given: 記録を commit 済みの準拠 worktree
W=$(mk_wt "feature/20260716_143000-gate5c"); gd="$W/docs/maintainer/workflow/20260101_000000_x"; mkdir -p "$gd"; echo ok > "$gd/00_要求定義.md"; git -C "$W" add -A; git -C "$W" commit -qm rec
# When: remove を stdin JSON で渡す
run_hook "git worktree remove $W"
# Then: R9 は発火せず exit 0（allow）
assert_rc 0 "RG-T5c 記録漏れなしの削除は exit 0"

# シナリオ: 非削除形は素通り  # RG-T5d ← 01 シナリオ1-A 対偶
# Given: 未 commit ありの準拠 worktree（発火要因は無し・非削除形コマンド）
W=$(mk_wt "feature/20260716_143000-gate5d"); add_rec "$W" 20260101_000000_x 00_要求定義.md
# When: git worktree list（非削除形）を渡す
run_hook "git worktree list"
# Then: R9 は発火せず exit 0（fail-open）
assert_rc 0 "RG-T5d 非削除形（worktree list）は exit 0"

# シナリオ: 非準拠パスの削除は対象外  # RG-T5e ← 01 シナリオ8-G(b)・fail-open
# Given: R7 命名非準拠パスに未 commit 記録がある git ツリー
P="$TMP/plain/gate5e"; mkdir -p "$P/docs/maintainer/workflow/20260101_000000_x"; git -C "$P" init -q; : > "$P/docs/maintainer/workflow/20260101_000000_x/00_要求定義.md"
# When: remove を渡す
run_hook "git worktree remove $P"
# Then: env gate 対象外で exit 0（fail-open・グランドファザリング）
assert_rc 0 "RG-T5e 非準拠パス削除は exit 0（env gate 対象外）"

# シナリオ: バイパス下では未commitありでも通過し痕跡を残す  # RG-T5f ← 01 シナリオ3（A 経路）
# Given: 未 commit ありの準拠 worktree ＋ ASC_WORKTREE_CLOSE_BYPASS=1
W=$(mk_wt "feature/20260716_143000-gate5f"); add_rec "$W" 20260101_000000_x 00_要求定義.md
json="{\"tool_name\":\"Bash\",\"agent_id\":\"sub-1\",\"tool_input\":{\"command\":\"git worktree remove --force $W\"}}"
: > "$ERR"
echo "$json" | env AGENTS_ROOT="$REPO_SRC" AGENT_ROLE="worker" WORKTREE_TRASH_ROOT="$TRASH" ASC_WORKTREE_CLOSE_BYPASS=1 bash "$HOOK" >/dev/null 2>"$ERR"; RC=$?
# Then: exit 0＋stderr にバイパス警告（監査痕跡）
assert_rc 0 "RG-T5f バイパス下は exit 0"
assert_err "bypassed" "RG-T5f バイパス使用の監査警告"

# =====================================================================================
# 結合: アダプタ B（終了時契約・bash <lib> <target> の終了コード＋stdout 契約）（§3.7）
# =====================================================================================
# ユースケース: verify-and-close が共有 lib を bash 直接実行し、終了コード非 0＋stdout レポートで close を
#   止め、0 で合格させる（A と同一 lib を 2 経路から共有）。
echo "== 結合: アダプタ B（bash <lib> <target> 契約） =="

# シナリオ: close終了条件判定時に記録漏れで不成立  # RG-T6a ← 01 シナリオ1-B
# Given: close 対象 worktree の記録対象ファイルに未commit差分がある
W=$(mk_wt "feature/20260716_143000-close6a"); add_rec "$W" 20260101_000000_x 02_設計.md
# When: B 経路と同じく bash 直接実行する
out=$(bash "$LIB_RG" "$W"); rc=$?
# Then: 終了コード非0＋stdoutレポートを受け、完了条件不成立として close を止められる
[[ $rc -ne 0 ]] && grep -q "02_設計.md" <<<"$out" && ok || ng "RG-T6a close 不成立契約（非 0＋レポート）"

# シナリオ: 漏れなしなら合格しcloseを続行  # RG-T6b ← 01 シナリオ1-B 対偶
# Given: 記録漏れなしの close 対象 worktree
C=$(mk_wt "feature/20260716_143000-close6b"); ccd="$C/docs/maintainer/workflow/20260101_000000_x"; mkdir -p "$ccd"; echo ok > "$ccd/02_設計.md"; git -C "$C" add -A; git -C "$C" commit -qm rec
# When: 同スクリプトを実行する
bash "$LIB_RG" "$C" >/dev/null 2>&1; rc=$?
# Then: 終了コード0で合格し close 続行可
[[ $rc -eq 0 ]] && ok || ng "RG-T6b 漏れなしは終了コード 0（合格）"

# シナリオ: 非git・対象外は終了コード0で合格扱い  # RG-T6c ← 境界値・過剰阻害回避
# Given: 非 git ツリーの target
NGT="$TMP/nongit6c"; mkdir -p "$NGT"
# When: 同スクリプトを実行する
bash "$LIB_RG" "$NGT" >/dev/null 2>&1; rc=$?
# Then: 終了コード0（SKIP＝合格扱い・過剰阻害しない）
[[ $rc -eq 0 ]] && ok || ng "RG-T6c 非 git 対象は終了コード 0（合格扱い）"

# =====================================================================================
# 結合: 失敗条件登録 + 一般 fail-open（§6.3・SC-4／SC-6）
# =====================================================================================
# ユースケース: #41 が enforcement/README.md に登録され、対象外・判定不能・remote 解決不能で fail-open へ
#   倒れ、既存機構（R7/R8）を非破壊に保つ（回帰は別途 test-worktree-discipline.sh で担保）。
echo "== 結合: 失敗条件 #41 登録・一般 fail-open =="

# シナリオ: #41 が README のレジストリに登録される  # RG-T7reg ← 03 T7-1
# Given: enforcement/README.md
# When: #41 行を grep する
# Then: #41 行が存在し、#40 が最大でなくなる
grep -q "^| #41 " "$REPO_SRC/enforcement/README.md" && ok || ng "RG-T7reg #41 行が README に登録される"

# シナリオ: 対象外・判定不能・内部エラーはfail-openでallow  # RG-T7b ← 01 シナリオ9
# Given: remote-tracking 解決不能な準拠 worktree（origin 不在）
N=$(mk_wt "feature/20260716_143000-noremote"); nd="$N/docs/maintainer/workflow/20260101_000000_x"; mkdir -p "$nd"; echo a > "$nd/00_要求定義.md"; git -C "$N" add -A; git -C "$N" commit -qm rec
# When: bash 直接実行する（記録は commit 済み・未 push は origin 未解決で SKIP）
bash "$LIB_RG" "$N" >/dev/null 2>&1; rc=$?
# Then: fail-safe 原則に従い SKIP/allow へ倒れる（過剰 block 回避・exit 0）
[[ $rc -eq 0 ]] && ok || ng "RG-T7b remote 解決不能＋記録 commit 済みは fail-open（exit 0）"

# シナリオ: 未追跡記録があっても非準拠パスなら発火しない（グランドファザリング）  # RG-T7c ← 01 シナリオ8-G
# Given: 非準拠パス（導入前の既存 worktree 相当）に未 commit 記録
P="$TMP/legacy/wt"; mkdir -p "$P/docs/maintainer/workflow/20260101_000000_x"; git -C "$P" init -q; : > "$P/docs/maintainer/workflow/20260101_000000_x/00_要求定義.md"
# When: bash 直接実行する
bash "$LIB_RG" "$P" >/dev/null 2>&1; rc=$?
# Then: 対象外で exit 0（グランドファザリング・過剰 block しない）
[[ $rc -eq 0 ]] && ok || ng "RG-T7c 非準拠パスの未 commit はグランドファザリングで exit 0"

echo ""
echo "==================== 結果 ===================="
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "失敗:"; for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
  exit 1
fi
echo "全テスト PASS"
exit 0
