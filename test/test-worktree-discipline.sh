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

echo "== 単体: validate_branch_ref =="
ev "準拠 accept" 0 validate_branch_ref "feature/20260716_143000/worktree運用規律"
ev "type違反 reject" 1 validate_branch_ref "feat/20260716_143000/x"
ev "ts違反 reject" 1 validate_branch_ref "feature/2026_143000/x"
ev "name欠落 reject" 1 validate_branch_ref "feature/20260716_143000"
ev "bare名 reject" 1 validate_branch_ref "myname"
ev "4階層 reject" 1 validate_branch_ref "feature/20260716_143000/a/b"

echo "== 単体: validate_worktree_path =="
ev ".worktree準拠 accept" 0 validate_worktree_path ".worktree/feature/20260716_143000/x/"
ev ".. reject" 1 validate_worktree_path "../x"
ev ".worktree外 reject" 1 validate_worktree_path "foo/bar"

echo "== 単体: git_subcommand_of（round2 回帰含む） =="
ee "plain status" "status" git_subcommand_of "git status"
ee "-C space" "status" git_subcommand_of "git -C /path status"
ee "--git-dir space（round2）" "status" git_subcommand_of "git --git-dir /path status"
ee "--namespace space（round2）" "status" git_subcommand_of "git --namespace foo status"
ee "--config-env space（round2）" "status" git_subcommand_of "git --config-env core.editor=X status"
ee "--exec-path bare はサブコマンド抽出しない（round2）" "" git_subcommand_of "git --exec-path status"
ee "--exec-path= 形は抽出する" "status" git_subcommand_of "git --exec-path=/foo status"
ee "env ラッパー" "switch" git_subcommand_of "env FOO=bar git switch -c x"
ee "非 git" "" git_subcommand_of "grep sqlite3 doc.md"

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

# ---- audit #39/#40 ----
run_audit(){ local root="$1"; shift; env "$@" bash "$AUDIT" "$root" 2>"$ERR" >/dev/null; }
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
