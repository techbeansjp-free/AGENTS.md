#!/usr/bin/env bash
# S-1 audit.sh モード分岐 BDD テスト（S1-BDD-1〜10）。
# tmp 隔離（mktemp -d ＋ git archive）で本番リポ・本番 workflow.db を一切変更しない。
# 実装計画 03_実装計画.md §テスト観点/§BDD に対応。
#
# 注: git archive HEAD は「コミット済みツリー」を抽出するため、未コミットの
#     audit.sh 変更を反映するよう、抽出後に「作業ツリーの audit.sh」で上書きする。
set -u

FAILS=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: ${2:-}"; FAILS=$((FAILS+1)); }

# この worktree（テスト対象の作業ツリー）を基点にする。
REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
WT_AUDIT="$REPO_ROOT/.agent-skill-chain/source/enforcement/ci/audit.sh"

# ---- 共通 fixture（§2.1）----
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$REPO_ROOT" archive --format=tar HEAD | tar -x -C "$TMP"
AUDIT="$TMP/.agent-skill-chain/source/enforcement/ci/audit.sh"
# 未コミットの実装を反映（作業ツリーの audit.sh で上書き）。
cp "$WT_AUDIT" "$AUDIT"

git -C "$TMP" init -q
git -C "$TMP" add -A && git -C "$TMP" -c user.email=t@e -c user.name=t commit -qm init
git -C "$TMP" remote add origin https://github.com/example/repo.git   # ダミー・fetch しない

# ---- §2.2 #33 FAIL 再現 fixture（close 未移動・猶予超過）----
ISSUE_DIR="$TMP/docs/maintainer/workflow/20260715_000000_s1test"
mkdir -p "$ISSUE_DIR"
printf '# review\n\n## docs 更新\n- 要否: 不要\n- 対象: なし\n- 理由: テスト fixture\n' > "$ISSUE_DIR/04_review.md"
DBDIR="$TMP/.agent-skill-chain/runtime"; mkdir -p "$DBDIR"; DB="$DBDIR/workflow.db"
OLD_TS="$(date -u -d '10 days ago' +%Y-%m-%dT%H:%M:%SZ)"
IP="docs/maintainer/workflow/20260715_000000_s1test"
sqlite3 "$DB" "CREATE TABLE workflow_log(entry_id INTEGER PRIMARY KEY, command TEXT, issue_path TEXT, ts_utc TEXT, summary TEXT);"
sqlite3 "$DB" "INSERT INTO workflow_log(command,issue_path,ts_utc,summary) VALUES('verify-and-close','$IP','$OLD_TS','close test');"

# ---- §2.3 #34/#35/#36 発火 fixture（回帰・モード非依存確認用）----
GATE_ISSUE="$TMP/docs/maintainer/workflow/20260715_010000_gatetest"
mkdir -p "$GATE_ISSUE"
printf -- '---\ndocument_id: "x"\n---\n# 00\n' > "$GATE_ISSUE/00_要求定義.md"
sqlite3 "$DB" "INSERT INTO workflow_log(command,issue_path,ts_utc,summary) VALUES('implement-feature','docs/maintainer/workflow/20260715_010000_gatetest','$OLD_TS','impl');"
PR_ISSUE="$TMP/docs/maintainer/workflow/20260715_020000_prtest"
mkdir -p "$PR_ISSUE"
printf -- '---\ndocument_id: "y"\ngithub_issue: "#999"\nbranch: "feature/x"\n---\n# 00\n' > "$PR_ISSUE/00_要求定義.md"
git -C "$TMP" add "docs/maintainer/workflow/20260715_020000_prtest"
git -C "$TMP" -c user.email=t@e -c user.name=t commit -qm prissue

# ---- resolve 関数を抽出して単体で source ----
awk '/^resolve_issue_tracking_mode\(\) \{/,/^\}/' "$AUDIT" > "$TMP/_resolve.sh"
run_resolve() { ( set -e; PROJECT_ROOT="$TMP"; source "$TMP/_resolve.sh"; resolve_issue_tracking_mode ); }

# ============================================================
# ユースケース:
# 実効モード解決（resolve_issue_tracking_mode）。ISSUE_TRACKING_MODE env と
# git remote の github.com 有無の 2 因子から、実効モードが一意かつ
# 決定論的に定まることを検証する（01_要件定義.md §2.2 ユースケース1）。
# ============================================================

# シナリオ: github_native かつ GitHub remote あり → github_native を返す
# （01 シナリオ1 / G1・CO-1）
# ===================== S1-BDD-1（G1/CO-1）=====================
# Given: ISSUE_TRACKING_MODE=github_native であり、git remote に github.com が含まれる（共通 fixture の origin）
# When: resolve_issue_tracking_mode を呼ぶ
out="$(ISSUE_TRACKING_MODE=github_native run_resolve)"
# Then: 標準出力に github_native を返す
[[ "$out" == "github_native" ]] && pass S1-BDD-1 || fail S1-BDD-1 "got '$out'"

# シナリオ: ISSUE_TRACKING_MODE 未設定 → local_tracked（既定・後方互換）
# （01 シナリオ2 / G2・CO-2）
# ===================== S1-BDD-2〜5（G2/CO-2）=====================
# Given: ISSUE_TRACKING_MODE を設定しない
# When: resolve_issue_tracking_mode を呼ぶ
out="$(unset ISSUE_TRACKING_MODE; run_resolve)"
# Then: 標準出力に local_tracked を返す
[[ "$out" == "local_tracked" ]] && pass S1-BDD-2 || fail S1-BDD-2 "got '$out'"

# シナリオ: 不明値（例 foo）→ local_tracked（fail-safe）
# （01 シナリオ3 Scenario Outline 1行目 / G2・CO-2）
# Given: ISSUE_TRACKING_MODE=foo（不明値）
# When: resolve_issue_tracking_mode を呼ぶ
out="$(ISSUE_TRACKING_MODE=foo run_resolve)"
# Then: 標準出力に local_tracked を返す（例外・エラーで停止しない）
[[ "$out" == "local_tracked" ]] && pass S1-BDD-3 || fail S1-BDD-3 "got '$out'"

# シナリオ: github_native だが git remote に github.com が無い → local_tracked（fail-safe）
# （01 シナリオ3 Scenario Outline 2行目 / G2・CO-2）
# S1-BDD-4: github_native だが非 GitHub remote
# Given: 別 tmp リポジトリを用意し、git remote を github.com ではない値（gitlab.com）にする
NG="$(mktemp -d)"; git -C "$NG" init -q; git -C "$NG" remote add origin https://gitlab.com/a/b.git
awk '/^resolve_issue_tracking_mode\(\) \{/,/^\}/' "$AUDIT" > "$NG/_r.sh"
# When: ISSUE_TRACKING_MODE=github_native を指定して resolve_issue_tracking_mode を呼ぶ
out="$( set -e; PROJECT_ROOT="$NG"; source "$NG/_r.sh"; ISSUE_TRACKING_MODE=github_native resolve_issue_tracking_mode )"
# Then: 標準出力に local_tracked を返す（例外・エラーで停止しない）
[[ "$out" == "local_tracked" ]] && pass S1-BDD-4 || fail S1-BDD-4 "got '$out'"

# シナリオ: github_native だが非 git ツリーで実行 → local_tracked（fail-safe）
# （01 シナリオ3 Scenario Outline 3行目 / G2・CO-2）
# S1-BDD-5: github_native だが非 git ツリー
# Given: 非 git ツリー（git init していない tmp ディレクトリ）を用意する
NOGIT="$(mktemp -d)"; awk '/^resolve_issue_tracking_mode\(\) \{/,/^\}/' "$AUDIT" > "$NOGIT/_r.sh"
# When: ISSUE_TRACKING_MODE=github_native を指定して resolve_issue_tracking_mode を呼ぶ
out="$( set -e; PROJECT_ROOT="$NOGIT"; source "$NOGIT/_r.sh"; ISSUE_TRACKING_MODE=github_native resolve_issue_tracking_mode )"
# Then: 標準出力に local_tracked を返す（例外・エラーで停止しない）
[[ "$out" == "local_tracked" ]] && pass S1-BDD-5 || fail S1-BDD-5 "got '$out'"
rm -rf "$NG" "$NOGIT"

# ============================================================
# ユースケース:
# #33（check_close_move_pending）のモードガード。github_native 実効時に
# close 未移動の督促を SKIP し、local_tracked（既定）では従来どおり検知する
# ことを検証する（01_要件定義.md §2.2 ユースケース2）。
# ============================================================

# シナリオ: github_native 実効時は close 未移動を督促しない（SKIP・FAIL を出さない）
# （01 シナリオ4 / G3・CO-3）
# ===================== S1-BDD-6（G3/CO-3）: github_native で #33 SKIP =====================
# Given: ISSUE_TRACKING_MODE=github_native で git remote に github.com があり、
#        verify-and-close 済み・close/ 未移動・猶予超過の issue が存在する（共通 fixture）
# When: audit.sh を実行し #33 が評価される
err="$(ISSUE_TRACKING_MODE=github_native bash "$AUDIT" "$TMP" 2>&1 1>/dev/null || true)"
# Then: #33 は SKIP ログを出し、EXIT_CODE を 1 に上げる close 移動未実施 FAIL は出さない
if grep -q 'SKIP.*#33' <<<"$err" && ! grep -q 'close 移動未実施' <<<"$err"; then
  pass S1-BDD-6
else
  fail S1-BDD-6 "SKIP#33 present=$(grep -qc 'SKIP.*#33' <<<"$err"); close-move fired=$(grep -q 'close 移動未実施' <<<"$err" && echo yes || echo no)"
fi

# シナリオ: 既定（local_tracked）は従来どおり close 未移動を検知する（回帰）
# （01 シナリオ5 / G4・CO-4）
# ===================== S1-BDD-7（G4/CO-4・回帰）: local_tracked で #33 FAIL =====================
# Given: ISSUE_TRACKING_MODE を設定しない（実効 local_tracked）で、
#        verify-and-close 済み・close/ 未移動・猶予超過の issue が存在する（共通 fixture）
# When: audit.sh を実行し #33 が評価される
err="$(unset ISSUE_TRACKING_MODE; bash "$AUDIT" "$TMP" 2>&1 1>/dev/null || true)"
# Then: #33 は従来どおり close 移動未実施 FAIL を出し EXIT_CODE=1 になる
grep -q 'close 移動未実施' <<<"$err" && pass S1-BDD-7 || fail S1-BDD-7 "#33 did not fire under local_tracked"

# ============================================================
# ユースケース:
# 他チェックの回帰（不変性）。モード分岐の追加が #34/#35/#36 の PASS/FAIL 結果を
# 変えないこと（モード非依存）を検証する（01_要件定義.md §2.2 ユースケース3）。
# ============================================================

# シナリオ: #34/#35/#36 はモード追加の前後で PASS/FAIL が不変である
# （01 シナリオ6 / G5・CO-5）
# ===================== S1-BDD-8（G5/CO-5・回帰）: #34/#35/#36 はモード非依存 =====================
sig() {
  local mode="$1" e
  e="$(env ISSUE_TRACKING_MODE="$mode" PR_BODY="PR without issue ref" bash "$AUDIT" "$TMP" 2>&1 1>/dev/null || true)"
  printf '%s %s %s' \
    "$(grep -q '実装前 GitHub Issue 起票ゲート未通過' <<<"$e" && echo 1 || echo 0)" \
    "$(grep -q 'ブランチ紐づけ未記録' <<<"$e" && echo 1 || echo 0)" \
    "$(grep -q 'PR 紐づけ未記録' <<<"$e" && echo 1 || echo 0)"
}
# Given: 同一 fixture（PR_BODY に issue 参照なし・00 に branch/github_issue 未記録の入力源）を用いる
base="$(sig local_tracked)"
bdd8_ok=1
# When: ISSUE_TRACKING_MODE を github_native / 未設定 / foo と変えて #34/#35/#36 相当の FAIL 行有無を取得する
for m in github_native "" foo; do
  got="$(sig "$m")"
  # Then: local_tracked 基準の結果と完全一致する（モード非依存）
  [[ "$got" == "$base" ]] || { fail S1-BDD-8 "#34/#35/#36 differ for mode='$m' (got '$got' vs '$base')"; bdd8_ok=0; }
done
[[ "$bdd8_ok" -eq 1 ]] && pass "S1-BDD-8 (base sig='$base')"

# ============================================================
# ユースケース:
# resolve_issue_tracking_mode の副作用なし性（Query 純粋性）。01 ストーリー1の
# 受け入れ基準「副作用なし（DB/FS へ書き込まない・Query）」および 01 シナリオ1
# の And「DB・FS への書き込みは発生しない」を、全モード網羅で確認する
# （03_実装計画.md VO-1）。
# ============================================================

# シナリオ: 全モードで resolve_issue_tracking_mode を呼んでも DB・作業ツリーは不変
# （01 シナリオ1 And / VO-1）
# ===================== S1-BDD-9（VO-1）: resolve は副作用なし =====================
# Given: 実行前の workflow.db ハッシュと git status を記録する
before="$(sha256sum "$DB")"; st_before="$(git -C "$TMP" status --porcelain)"
# When: github_native / local_tracked / foo / 未設定の全モードで resolve_issue_tracking_mode を繰り返し呼ぶ
for m in github_native local_tracked foo ""; do ISSUE_TRACKING_MODE="$m" run_resolve >/dev/null; done
# Then: 実行前後で workflow.db ハッシュと git status が不変である（副作用なし）
if [[ "$(sha256sum "$DB")" == "$before" && "$(git -C "$TMP" status --porcelain)" == "$st_before" ]]; then
  pass S1-BDD-9
else
  fail S1-BDD-9 "DB or worktree changed"
fi

# ============================================================
# ユースケース:
# 変更の最小性（差分静的検査）。#34/#35/#36・#3/#9/#29/#31/#32 の既存行を
# 一切変更せず、resolve_issue_tracking_mode の新設と #33 冒頭ガードの追加のみで
# あることを機械的に確認する（01 は Gherkin シナリオとして明記していない追加の
# 回帰保証観点。03_実装計画.md VO-3・親 ADR-4「入力源不変」に対応）。
# ============================================================

# シナリオ: audit.sh の差分が挿入のみ（削除・変更行 0 件）であり、
# resolve_issue_tracking_mode の新設行と #33 の github_native SKIP ガード行を含む
# （VO-3）
# ===================== S1-BDD-10（VO-3）: 変更スコープ静的検査 =====================
# Given: main ブランチとの audit.sh の差分を取得する
d="$(git -C "$REPO_ROOT" diff main -- .agent-skill-chain/source/enforcement/ci/audit.sh)"
del="$(grep -E '^-[^-]' <<<"$d" | grep -vE '^--- ' | wc -l)"
bdd10_ok=1
# When/Then: 削除・変更行が0件であることを検査する
[[ "$del" -eq 0 ]] || { fail S1-BDD-10 "found $del deleted/changed lines (expected insert-only)"; bdd10_ok=0; }
# When/Then: resolve_issue_tracking_mode の新設行が追加されていることを検査する
grep -qE '^\+resolve_issue_tracking_mode\(\) \{' <<<"$d" || { fail S1-BDD-10 "resolve not added"; bdd10_ok=0; }
# When/Then: #33 の github_native SKIP ガード行が追加されていることを検査する
grep -qE '^\+.*SKIP.*#33.*github_native' <<<"$d" || { fail S1-BDD-10 "#33 guard not added"; bdd10_ok=0; }
# Then: 上記3条件をすべて満たせば「挿入のみの変更」として PASS する
[[ "$bdd10_ok" -eq 1 ]] && pass "S1-BDD-10 (deleted lines=$del)"

echo "----------------------------------------"
if [[ "$FAILS" -eq 0 ]]; then
  echo "ALL PASS (S1-BDD-1〜10)"
  exit 0
else
  echo "FAILURES: $FAILS"
  exit 1
fi
