#!/usr/bin/env bash
# test-worktree-discipline.sh — worktree 運用規律（命名規則 Tier1 強制・削除前 untracked 退避・
#   CI audit #39/#40）の単体/結合テスト。
#
# ユースケース（このテストファイル全体）:
#   PreToolUse.sh に追加した worktree-discipline lib（git_subcommand_of / validate_name /
#   validate_branch_ref / validate_worktree_path / _wt_extract_creation / is_worktree_destroy /
#   worktree_untracked_rescue）と R7（命名 Tier1）・R8（削除前退避）、および audit.sh の
#   #39（find prune 規約）・#40（非準拠ブランチ名事後検知）が仕様どおり動作すること。
#   fail-open/fail-closed の非対称（listing 誤 block ゼロ・作成形の違反のみ block・退避は block しない）を検証する。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - 純関数は hook の `# >>> worktree-discipline lib (BEGIN/END)` マーカ間を sed 抽出して source する。
#   - R7/R8 結合は正本 hook を stdin JSON で駆動する（AGENTS_ROOT は本リポ source を read-only 参照、
#     WORKTREE_TRASH_ROOT は $TMP に固定して本リポ .claude/ を汚さない）。
#   - audit #39/#40 は $TMP の隔離 git リポ・フィクスチャで正本 audit.sh を駆動する。
#   - 本リポの .agent-skill-chain/source/ .claude/ .worktree/ workflow.db を一切書き換えない。
#
# 使い方: bash test/test-worktree-discipline.sh   # リポジトリルートで実行
# 前提: bash・git。

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
HOOK="$REPO_ROOT/.agent-skill-chain/source/enforcement/claude/PreToolUse.sh"
AUDIT="$REPO_ROOT/.agent-skill-chain/source/enforcement/ci/audit.sh"
REPO_SRC="$REPO_ROOT/.agent-skill-chain/source"
command -v git >/dev/null 2>&1 || { echo "エラー: git が必要です" >&2; exit 2; }
[[ -f "$HOOK" && -f "$AUDIT" ]] || { echo "エラー: hook/audit が見つかりません" >&2; exit 2; }

PASS=0; FAIL=0; FAILED_NAMES=()
ok() { PASS=$((PASS+1)); }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
ev() { local desc="$1" exp="$2"; shift 2; "$@"; local rc=$?; [[ $rc -eq $exp ]] && ok || ng "$desc (rc=$rc exp=$exp)"; }
ee() { local desc="$1" exp="$2"; shift 2; local out; out=$("$@"); [[ "$out" == "$exp" ]] && ok || ng "$desc (got='$out' exp='$exp')"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
TRASH="$TMP/trash"
ERR="$TMP/err.txt"

# ---- 純関数を hook から抽出して source ----
LIB="$TMP/lib.sh"
{ echo '#!/usr/bin/env bash'; echo 'set +e'; echo 'block(){ echo "[enforcement:block] 違反(BLOCK): $1" >&2; exit 2; }';
  sed -n '/# >>> worktree-discipline lib (BEGIN)/,/# <<< worktree-discipline lib (END)/p' "$HOOK"; } > "$LIB"
[[ $(grep -c '' "$LIB") -gt 30 ]] || { echo "エラー: lib 抽出に失敗（マーカ不一致）" >&2; exit 2; }
# shellcheck disable=SC1090
source "$LIB"

# シナリオ: 固有名（<name> 部分）は日本語を許容し、危険文字・制御文字・先頭./先頭-/../.lock・長さ超過を排除する（03 T-B6 ← 01 ADR-4）。
# Given: hook から抽出した validate_name（LC_ALL=C ブラックリスト＋構造＋200 バイト上限）
# When:  各種の accept/reject 期待値をもつ入力を validate_name に与える
# Then:  日本語・英数は accept、危険文字・構造違反・境界超過は reject
echo "== 単体: validate_name =="
ev "日本語 accept" 0 validate_name "worktree運用規律"
ev "英数 accept" 0 validate_name "my-name_1.2"
ev "/ 混入 reject" 1 validate_name "a/b"
ev ".. reject" 1 validate_name "a..b"
ev "先頭. reject" 1 validate_name ".hidden"
ev "先頭- reject" 1 validate_name "-x"
ev "空 reject" 1 validate_name ""
ev "foo.lock reject" 1 validate_name "foo.lock"
ev "空白 reject" 1 validate_name "a b"
ev "; reject" 1 validate_name "a;b"
ev "] reject" 1 validate_name "a]b"
ev '$ reject' 1 validate_name 'a$b'
N200=$(printf 'a%.0s' $(seq 1 200)); ev "200バイトちょうど accept（境界値）" 0 validate_name "$N200"
N201=$(printf 'a%.0s' $(seq 1 201)); ev "201バイト超 reject（境界値・round2）" 1 validate_name "$N201"

# シナリオ: ブランチ/ref が <type>/<YYYYMMDD_HHMMSS>/<固有名>（type 5 種・3 階層固定）に準拠するか判定する（03 T-B1/T-B6 ← 01 UC1）。
# Given: hook から抽出した validate_branch_ref（type 集合・ts 形式・name は validate_name）
# When:  準拠名・type 違反・ts 違反・name 欠落・bare 名・4 階層を与える
# Then:  準拠のみ accept、他は reject
echo "== 単体: validate_branch_ref =="
ev "準拠 accept" 0 validate_branch_ref "feature/20260716_143000/worktree運用規律"
ev "type違反 reject" 1 validate_branch_ref "feat/20260716_143000/x"
ev "ts違反 reject" 1 validate_branch_ref "feature/2026_143000/x"
ev "name欠落 reject" 1 validate_branch_ref "feature/20260716_143000"
ev "bare名 reject" 1 validate_branch_ref "myname"
ev "4階層 reject" 1 validate_branch_ref "feature/20260716_143000/a/b"

# シナリオ: worktree ディレクトリが .worktree/<type>/<ts>/<name>/ 準拠か、.worktree 外・.. を弾くか判定する（03 T-B6b ← 01 UC1 シナリオ3）。
# Given: hook から抽出した validate_worktree_path（.worktree/ 起点＋validate_branch_ref）
# When:  .worktree 配下の準拠 path・../x・.worktree 外 path を与える
# Then:  準拠のみ accept、親 escape・配下外は reject
echo "== 単体: validate_worktree_path =="
ev ".worktree準拠 accept" 0 validate_worktree_path ".worktree/feature/20260716_143000/x/"
ev ".. reject" 1 validate_worktree_path "../x"
ev ".worktree外 reject" 1 validate_worktree_path "foo/bar"
# finding-5: repo_root 供給時、絶対/ネスト表記の .worktree は <repo_root>/.worktree/ 直下に限定する
ev "root供給: 無関係 /tmp/other/.worktree reject（finding-5）" 1 validate_worktree_path "/tmp/other/.worktree/feature/20260716_143000/x" "$REPO_ROOT"
ev "root供給: repo直下 .worktree accept（finding-5）" 0 validate_worktree_path "$REPO_ROOT/.worktree/feature/20260716_143000/x" "$REPO_ROOT"
ev "root未供給: 従来どおり構造のみで accept（fail-safe）" 0 validate_worktree_path "/tmp/other/.worktree/feature/20260716_143000/x"

# シナリオ: ラッパー・VAR=val・パス付き git・グローバルオプション（space/=/結合形）を跨いでサブコマンドを正しく抽出し、bare --exec-path はサブコマンド無し扱いにする（03 単体・round2 回帰 ← ADR-3）。
# Given: hook から抽出した git_subcommand_of（_wt_effective トークナイザ）
# When:  各種プレフィックス・グローバルオプション・env ラッパー・非 git を与える
# Then:  真のサブコマンドを抽出し、bare --exec-path と非 git は空を返す（allow 側）
echo "== 単体: git_subcommand_of（round2 回帰含む） =="
ee "plain status" "status" git_subcommand_of "git status"
ee "-C space" "status" git_subcommand_of "git -C /path status"
ee "--git-dir space（round2）" "status" git_subcommand_of "git --git-dir /path status"
ee "--namespace space（round2）" "status" git_subcommand_of "git --namespace foo status"
ee "--config-env space（round2）" "status" git_subcommand_of "git --config-env core.editor=X status"
ee "--exec-path bare はサブコマンド抽出しない（round2）" "" git_subcommand_of "git --exec-path status"
ee "--exec-path= 形は抽出する" "status" git_subcommand_of "git --exec-path=/foo status"
ee "env ラッパー" "switch" git_subcommand_of "env FOO=bar git switch -c x"
ee "env -i 引数なしフラグを跨いで git 到達（finding-4）" "switch" git_subcommand_of "env -i git switch -c x"
ee "env --ignore-environment を跨ぐ（finding-4）" "switch" git_subcommand_of "env --ignore-environment git switch -c x"
ee "非 git" "" git_subcommand_of "grep sqlite3 doc.md"

# シナリオ: 作成形（worktree add/switch -c/checkout -b/branch 作成形）のみを検知し、listing/rename は非作成、削除形（remove/clean -x）のみ破壊検知する（03 T-B2/T-B3/T-C3 ← 01 UC1.5/UC2）。
# Given: hook から抽出した _wt_extract_creation / is_worktree_destroy（WT_ARGV 起点の Query）
# When:  作成形・listing・rename・remove・clean の各コマンドを与える
# Then:  作成形のみ WT_CREATE=1＋暗黙 basename 抽出、削除形のみ WT_DESTROY=1、listing/rename/clean -fd は非検知
echo "== 単体: 作成形抽出・is_worktree_destroy =="
_cc(){ local eC="$1" eB="$2" seg="$3"; WT_ARGV=(); _wt_effective "$seg" && _wt_extract_creation || { WT_CREATE=0; WT_CREATE_BRANCH=""; }
  [[ "${WT_CREATE:-0}" == "$eC" && "${WT_CREATE_BRANCH:-}" == "$eB" ]]; }
ev "worktree add -b 抽出" 0 _cc 1 "feature/20260716_143000/x" "git worktree add -b feature/20260716_143000/x .worktree/feature/20260716_143000/x"
ev "-b 無し暗黙 basename" 0 _cc 1 "myname" "git worktree add .worktree/feature/ts/myname"
ev "worktree list 非作成" 0 _cc 0 "" "git worktree list"
ev "switch -c 抽出" 0 _cc 1 "feature/ts/x" "git switch -c feature/ts/x"
ev "branch 作成形抽出" 0 _cc 1 "feature/ts/x" "git branch feature/ts/x"
ev "branch -a 非作成" 0 _cc 0 "" "git branch -a"
ev "branch -m 非作成" 0 _cc 0 "" "git branch -m old new"
ev "switch --create 長形 抽出（finding-4）" 0 _cc 1 "feature/ts/x" "git switch --create feature/ts/x"
ev "switch --create= 形 抽出（finding-4）" 0 _cc 1 "feature/ts/x" "git switch --create=feature/ts/x"
ev "branch --track 作成形抽出（finding-4）" 0 _cc 1 "feature/ts/x" "git branch --track feature/ts/x origin/x"
ev "branch -t 作成形抽出（finding-4）" 0 _cc 1 "feature/ts/x" "git branch -t feature/ts/x origin/x"
# worktree add --detach はブランチを作らない → WT_CREATE=1 だが WT_CREATE_BRANCH は空（basename を検証しない・finding-4）
ev "worktree add --detach はブランチ空（finding-4）" 0 _cc 1 "" "git worktree add --detach .worktree/feature/20260716_143000/x HEAD"
_dd(){ local eD="$1" seg="$2"; WT_ARGV=(); _wt_effective "$seg" && is_worktree_destroy; local d="${WT_DESTROY:-0}"; [[ "$d" == "$eD" ]]; }
ev "worktree remove 検知" 0 _dd 1 "git worktree remove foo"
ev "worktree remove --force 検知" 0 _dd 1 "git worktree remove --force foo"
ev "clean -xf 検知" 0 _dd 1 "git clean -xf"
ev "clean -fd（x無し）非検知" 0 _dd 0 "git clean -fd"
ev "worktree add 非検知" 0 _dd 0 "git worktree add .worktree/x"

# ---- R7/R8 結合（正本 hook を stdin JSON で駆動） ----
run_hook(){ local cmd="$1" role="${2:-worker}" agent="${3:-sub-1}" json
  if [[ -n "$agent" ]]; then json="{\"tool_name\":\"Bash\",\"agent_id\":\"$agent\",\"tool_input\":{\"command\":\"$cmd\"}}"
  else json="{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$cmd\"}}"; fi
  : > "$ERR"
  echo "$json" | env AGENTS_ROOT="$REPO_SRC" AGENT_ROLE="$role" WORKTREE_TRASH_ROOT="$TRASH" bash "$HOOK" >/dev/null 2>"$ERR"
  RC=$?
}
assert_rc(){ [[ "$RC" == "$1" ]] && ok || ng "$2 (rc=$RC exp=$1)"; }
assert_err(){ grep -q "$1" "$ERR" && ok || ng "$2 (stderr に '$1' が無い)"; }

# シナリオ: 正本 hook を stdin JSON で駆動し、作成形の命名違反のみ exit 2、listing/対象外/非 git は exit 0（fail-open）にする（03 T-B1〜B5 ← 01 UC1/UC1.5・SC-2/SC-10）。
# Given: subagent worker として正本 PreToolUse.sh を stdin JSON（tool_input.command）で起動する
# When:  準拠 add・非準拠 switch -c・bad type branch・listing・非 git・path .worktree 外を順に与える
# Then:  違反確定は exit 2＋expected/got/fix メッセージ、listing/対象外/非 git は exit 0
echo "== 結合: R7 命名 Tier1（subagent worker・stdin JSON） =="
run_hook "git worktree add -b feature/20260716_143000/worktree運用規律 .worktree/feature/20260716_143000/worktree運用規律"; assert_rc 0 "準拠 add は exit 0"
run_hook "git switch -c badname"; assert_rc 2 "非準拠 switch -c は exit 2"; assert_err "violates naming rule" "reject メッセージ"; assert_err "expected:" "expected 行"; assert_err "got:" "got 行"
run_hook "git branch feat/x/y"; assert_rc 2 "bad type branch は exit 2"
run_hook "git branch -a"; assert_rc 0 "listing branch -a は exit 0（fail-open）"
run_hook "git branch"; assert_rc 0 "無引数 branch は exit 0"
run_hook "git worktree list"; assert_rc 0 "worktree list は exit 0"
run_hook "git checkout main"; assert_rc 0 "既存 checkout は exit 0"
run_hook "git status"; assert_rc 0 "status は exit 0"
run_hook "ls -la"; assert_rc 0 "非 git は exit 0（fail-safe）"
run_hook "git switch -c release/20260716_143000/x"; assert_rc 0 "準拠 release は exit 0"
run_hook "git worktree add -b feature/20260716_143000/x /tmp/notunderworktree"; assert_rc 2 "path が .worktree 外は exit 2"
# finding-4: env -i / switch --create / branch --track の作成形も命名検証、--detach はブランチ検証しない
run_hook "env -i git switch -c badname"; assert_rc 2 "env -i git switch -c 非準拠は exit 2（finding-4・env -i 迂回防止）"
run_hook "git switch --create badname"; assert_rc 2 "switch --create 非準拠は exit 2（finding-4）"
run_hook "git branch --track badname origin/x"; assert_rc 2 "branch --track 非準拠は exit 2（finding-4）"
run_hook "git worktree add --detach .worktree/feature/20260716_143000/x HEAD"; assert_rc 0 "worktree add --detach は準拠 path なら exit 0（ブランチ検証せず・finding-4）"
# finding-5: 構造は準拠だがリポジトリルート外の .worktree（/tmp/other/.worktree/…）は exit 2（ブランチ名は準拠にして path 判定を分離）
run_hook "git worktree add -b feature/20260716_143000/x /tmp/other/.worktree/feature/20260716_143000/x"; assert_rc 2 "リポジトリルート外の .worktree path は exit 2（finding-5）"
run_hook "git worktree add -b feature/20260716_143000/x $REPO_ROOT/.worktree/feature/20260716_143000/x"; assert_rc 0 "リポジトリルート直下の絶対 .worktree path は exit 0（finding-5）"

# シナリオ: 削除形（remove --force / clean -xf）の前に untracked を退避先へ copy 保全し、原本は残し、untracked 無しは退避せず、いずれも block しない（03 T-C1/T-C2/T-C3 ← 01 UC2・SC-3/SC-4）。
# Given: tmp 隔離の git リポ（untracked あり/なし）と WORKTREE_TRASH_ROOT=$TRASH で正本 hook を起動する
# When:  untracked を含む worktree remove --force・untracked 無し remove・clean -xf を与える
# Then:  untracked は退避先へ copy されて原本も残り exit 0、untracked 無しは退避せず exit 0（保全のみ・block しない）
echo "== 結合: R8 削除前 untracked 退避（tmp git リポ・block しない） =="
mk_repo(){ local d="$1"; mkdir -p "$d"; ( cd "$d" && git init -q && git config user.email t@t && git config user.name t && echo c>c && git add c && git commit -qm i ) >/dev/null 2>&1; }
R1="$TMP/wt1"; mk_repo "$R1"; echo secret > "$R1/00_要求定義.md"
rm -rf "$TRASH"
run_hook "git worktree remove --force $R1"
assert_rc 0 "remove --force は block せず exit 0"
assert_err "rescued" "退避通知 stderr"
[[ -n "$(find "$TRASH" -name '00_要求定義.md' 2>/dev/null)" ]] && ok || ng "untracked が退避先へ copy 保全される"
[[ -f "$R1/00_要求定義.md" ]] && ok || ng "原本は move されず残る（copy）"
R2="$TMP/wt2"; mk_repo "$R2"; rm -rf "$TRASH"
run_hook "git worktree remove $R2"
assert_rc 0 "untracked 無し remove は exit 0"
[[ -d "$TRASH" ]] && ng "untracked 無しでは退避しない" || ok
R3="$TMP/wt3"; mk_repo "$R3"; echo ig > "$R3/ignored.log"; rm -rf "$TRASH"
run_hook "git clean -xf $R3"
assert_rc 0 "clean -xf は block せず exit 0（検知対象）"

# シナリオ: clean -x を path 省略で実行すると target=CWD となり、既定 trash（target 相対）が削除対象の
#   内側に生成され、直後の clean で退避物ごと非可逆消失する（finding-6/7）。退避先を target 外へ解決し、
#   実 clean 後も退避物が生存することを検証する（03 追加ケース ← PR#120 finding-6/7・データ整合性）。
# Given: untracked を含む tmp git リポ（CWD=target）と WORKTREE_TRASH_ROOT 未設定・TMPDIR を制御下に置く
# When:  cwd を target にして `git clean -xfd`（path 省略）で正本 hook を起動し、その後 実 clean を走らせる
# Then:  退避物は target 外（フォールバック先）へ copy され、実 clean 後も生存する（原本は消える）
echo "== 結合: R8 退避先が削除対象の外側に置かれる（finding-6/7・非可逆消失防止） =="
R6="$TMP/wt6"; mk_repo "$R6"; echo secret6 > "$R6/untracked6.md"
FB="$TMP/fallback6"; mkdir -p "$FB"
: > "$ERR"
( cd "$R6" && echo '{"tool_name":"Bash","agent_id":"sub-1","tool_input":{"command":"git clean -xfd"}}' \
    | env AGENTS_ROOT="$REPO_SRC" AGENT_ROLE="worker" TMPDIR="$FB" bash "$HOOK" >/dev/null 2>"$ERR" )
RC=$?
assert_rc 0 "clean -xfd（path省略）は block せず exit 0（保全のみ）"
[[ -n "$(find "$FB" -name 'untracked6.md' 2>/dev/null)" ]] && ok || ng "退避物が target 外（フォールバック先）へ保全される(finding-6/7)"
[[ -z "$(find "$R6/.claude" -name 'untracked6.md' 2>/dev/null)" ]] && ok || ng "退避物は target 配下に置かれない(finding-6/7)"
( cd "$R6" && git clean -xfd >/dev/null 2>&1 )   # 実 clean で target 内 untracked を破壊
[[ -n "$(find "$FB" -name 'untracked6.md' 2>/dev/null)" ]] && ok || ng "実 clean 後も退避物が生存する(finding-6/7・非可逆消失防止)"
[[ ! -f "$R6/untracked6.md" ]] && ok || ng "原本は clean で消える（退避が唯一のコピー）"

# ---- audit #39/#40 ----
run_audit(){ local root="$1"; shift; env "$@" bash "$AUDIT" "$root" 2>"$ERR" >/dev/null; }
# シナリオ: audit.sh #40 が grandfather baseline 未登録の非準拠新規ブランチのみ FAIL、baseline 済み・準拠は救済、gate 無効/baseline 不在は SKIP（03 T-D1 ← 01 UC1.5 シナリオ3・SC-10/SC-7）。
# Given: tmp 隔離 git リポに準拠/grandfathered/非準拠ブランチと baseline ファイルを用意する
# When:  正本 audit.sh を通常・gate 無効・baseline 不在の 3 条件で駆動する
# Then:  非準拠新規のみ FAIL、baseline 済み/準拠は非 FAIL、gate 無効・baseline 不在は SKIP
echo "== 結合: audit #40 非準拠ブランチ名事後検知 =="
A="$TMP/auditrepo"; mkdir -p "$A/.agent-skill-chain/project"
( cd "$A" && git init -q && git config user.email t@t && git config user.name t && echo x>x && git add x && git commit -qm i \
  && git branch "feature/20260716_143000/compliant" \
  && git branch "grandfathered-old-name" \
  && git branch "bogus-new-branch" ) >/dev/null 2>&1
# baseline に既存の grandfathered のみ登録
printf '%s\n' "grandfathered-old-name" > "$A/.agent-skill-chain/project/worktree-naming-grandfather.txt"
run_audit "$A"
grep -q "bogus-new-branch" "$ERR" && ok || ng "#40 baseline 未登録の非準拠新規ブランチを FAIL"
grep -q "grandfathered-old-name" "$ERR" && ng "#40 baseline 登録済みは救済（FAIL しない）" || ok
grep -qE "compliant.*(FAIL|非準拠)" "$ERR" && ng "#40 準拠ブランチは FAIL しない" || ok
# gate 無効化で SKIP
run_audit "$A" WORKTREE_NAMING_AUDIT_ENABLED=false
grep -q "bogus-new-branch" "$ERR" && ng "#40 gate 無効時は検査しない" || ok
# baseline 不在で SKIP（非破壊・初回導入前）
rm -f "$A/.agent-skill-chain/project/worktree-naming-grandfather.txt"
run_audit "$A"
grep -q "grandfather baseline 不在" "$ERR" && ok || ng "#40 baseline 不在時は SKIP"

# シナリオ: audit.sh #39 がルート起点 unbounded find の .worktree prune 欠落のみ FAIL し、scoped find・prune 済み find は誤検知しない（03 T-D2 ← 01 UC1.6 シナリオ5・BR-11）。
# Given: tmp 隔離 git リポに scoped find・root 起点 prune 欠落 find・prune 済み find の各スクリプトを追加する
# When:  各スクリプトを追跡対象に加えて正本 audit.sh を駆動する
# Then:  root 起点 prune 欠落のみ該当ファイルを指摘して FAIL、scoped/prune 済みは非検知
echo "== 結合: audit #39 find prune 規約 =="
B="$TMP/auditfind"; mkdir -p "$B/scripts"
( cd "$B" && git init -q && git config user.email t@t && git config user.name t ) >/dev/null 2>&1
# scoped find（既存作法）は誤検知しない
printf '#!/usr/bin/env bash\nfind "$PROJECT_ROOT/docs" -name "*.md"\n' > "$B/scripts/scoped.sh"
( cd "$B" && git add scripts/scoped.sh && git commit -qm scoped ) >/dev/null 2>&1
run_audit "$B"
grep -q "ルート起点 unbounded find" "$ERR" && ng "#39 scoped find は誤検知しない" || ok
# root 起点 unbounded find（prune 欠落）は FAIL
printf '#!/usr/bin/env bash\nfind "$PROJECT_ROOT" -name "*.md"\n' > "$B/scripts/rootfind.sh"
( cd "$B" && git add scripts/rootfind.sh && git commit -qm rootfind ) >/dev/null 2>&1
run_audit "$B"
grep -q "ルート起点 unbounded find" "$ERR" && ok || ng "#39 root 起点 prune 欠落 find を FAIL"
grep -q "scripts/rootfind.sh" "$ERR" && ok || ng "#39 該当ファイルを指摘"
# prune 節があれば FAIL しない
printf '#!/usr/bin/env bash\nfind "$PROJECT_ROOT" -path "*/.worktree" -prune -o -name "*.md" -print\n' > "$B/scripts/rootfind.sh"
( cd "$B" && git add scripts/rootfind.sh && git commit -qm pruned ) >/dev/null 2>&1
run_audit "$B"
grep -q "rootfind.sh" "$ERR" && ng "#39 prune 節があれば FAIL しない" || ok

echo ""
echo "==================== 結果 ===================="
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "失敗:"; for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
  exit 1
fi
echo "全テスト PASS"
exit 0
