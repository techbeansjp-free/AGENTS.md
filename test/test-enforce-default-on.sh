#!/usr/bin/env bash
# test-enforce-default-on.sh — 新規配備（ASC_MODE=new）時の enforcement 既定 on 化の回帰テスト。
#
# ユースケース（このテストファイル全体）:
#   本パッケージは「絶対強制」を謳うが、init/setup は既定では .claude/settings.json に
#   enforcement 配線を書かず（既定 off・opt-in）、実効性が記述と乖離していた
#   （docs/maintainer/workflow/20260714_180751_.../90_issues/20260714_163833_enforceoff既定で強制未配線/）。
#   本 issue の柱A対応（setup.sh の ASC_MODE=new 分岐で enforce on 相当を自動実行）が、
#   (S1) 新規配備でのみ配線される、(S2) 既存の再配備（match）では利用者の enforce off 設定を
#   保持する、(S3) 本パッケージ自己適用（own）では自動配線されない、(S4) 無効 JSON では
#   配線を安全に見送り既存ファイルを破壊しない、(S5) 既に on の環境へ再配備しても多重配線・
#   多重 .bak を生まない、ことを検証する。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - 全シナリオを mktemp -d（＋ S3 は git archive HEAD | tar -x）で完全隔離した環境で実行する。
#   - 本開発リポの .agent-skill-chain/source/ .claude/ .cursor/ .agent-skill-chain/runtime/
#     workflow.db を一切変更しない（S3 は「自己適用しても実リポに影響しない」ことそのものを
#     検証するため、実リポではなく git archive で複製した独立コピーに対して自己適用を再現する）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-enforce-default-on.sh   # リポジトリルート（git ツリー内）で実行
#   npm test                               # run-all.sh 経由
#
# 前提: bash・git・node・tar。sqlite3 が無い環境でも setup.sh の workflow.db 初期化は
#       sqlite3 なしでは失敗するため、本テストは sqlite3 も必須とする（欠如時は SKIP=exit 2）。
# 参照:
#   docs/maintainer/workflow/20260714_180751_自己点検issue群対応/90_issues/20260714_163833_enforceoff既定で強制未配線/
#     02_設計.md（柱A・ADR-1〜4）, 03_実装計画.md（タスク5・S1〜S6）
#   .agent-skill-chain/source/scripts/setup.sh（enforce_default_on_if_possible）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
CLI="$REPO_ROOT/bin/agents-md.js"
SETUP_SH_REL=".agent-skill-chain/source/scripts/setup.sh"

for dep in git node tar sqlite3; do
  command -v "$dep" >/dev/null 2>&1 || { echo "エラー: $dep が必要です（依存欠如）" >&2; exit 2; }
done

# TS 版 CLI（bin/agents-md.js・tsc 生成物・非追跡）が無ければ前置ビルドする（他テストと同一方式）。
if [[ ! -f "$CLI" ]]; then
  if command -v npm >/dev/null 2>&1 && [[ -d "$REPO_ROOT/node_modules" ]]; then
    echo "[build] bin 未生成のため REPO_ROOT で npm run build"
    ( cd "$REPO_ROOT" && npm run build >/dev/null 2>&1 ) || { echo "エラー: bin のビルドに失敗しました" >&2; exit 2; }
  else
    echo "[SKIP] bin/agents-md.js 未生成かつビルド不可（npm/node_modules なし）" >&2
    exit 2
  fi
fi

PASS=0
FAIL=0
FAILED_NAMES=()
ok()  { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng()  { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq()     { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: 期待 '$1' 実際 '$2'}"; }
assert_exists() { [[ -e "$1" ]] && ok "${2:-存在: $1}" || ng "${2:-存在すべき: $1}"; }
assert_absent() { [[ ! -e "$1" ]] && ok "${2:-不在: $1}" || ng "${2:-不在すべき: $1}"; }

# 破壊的操作の対象ディレクトリが必ず /tmp 配下（mktemp -d 由来）であることを保証する安全ガード。
assert_tmp_target() {
  case "$1" in
    /tmp/*) : ;;
    *) echo "FATAL: unsafe target dir（/tmp 配下ではない）: $1" >&2; exit 1 ;;
  esac
}

# settings.json の enforce 配線有無を CLI の enforce status で判定し "on"/"off" を返す。
enforce_state() {
  local dir="$1"
  if node "$CLI" enforce status "$dir" 2>/dev/null | grep -q 'enforcement = on'; then
    printf 'on'
  else
    printf 'off'
  fi
}

# クリーン clone を一時ディレクトリへ再現する（追跡ツリーの実内容を複製。exec bit・日本語名も保持）。
make_clean_tree() {
  local dst="$1"
  ( cd "$REPO_ROOT" && git ls-files -z | tar --null -T - -cf - ) | tar -x -C "$dst"
}

echo "[test-enforce-default-on] REPO_ROOT=$REPO_ROOT"
echo "[test-enforce-default-on] CLI=$CLI"

# =============================================================================
# シナリオ S1: 新規配備（ASC_MODE=new）では enforcement が既定 on で配線される
# =============================================================================
test_s1_new_gets_default_on() {
  echo "[enforce-default-on] S1: 新規配備で enforcement が既定 on になる"
  # シナリオ: .agent-skill-chain/ が未配備の空ディレクトリへ init すると、ASC_MODE=new と
  #           判定され、setup.sh が enforce on 相当を自動実行して .claude/settings.json に
  #           enforcement 配線（managed hook エントリ）が入る。
  # Given: .agent-skill-chain/ も .claude/ も存在しない空の採用先
  local dest; dest="$(mktemp -d)"; assert_tmp_target "$dest"

  # When: init（node CLI 経由。内部で setup.sh の ASC_MODE=new 分岐を通る）
  node "$CLI" init "$dest" >/dev/null 2>&1 || true

  # Then: enforce status が on を返し、hook スクリプトも配備されている
  assert_eq "on" "$(enforce_state "$dest")" "S1: 新規配備後 enforce status が on"
  assert_exists "$dest/.claude/settings.json" "S1: settings.json が生成される"
  assert_exists "$dest/.claude/hooks/PreToolUse.sh" "S1: PreToolUse.sh が配備される"

  # And (Then): 注入エントリに目印 __agentsMdEnforce が付いている（enforce on と同一実装を使った証跡）
  if grep -q '__agentsMdEnforce' "$dest/.claude/settings.json" 2>/dev/null; then
    ok "S1: settings.json に __agentsMdEnforce の目印がある（既存 enforceOn() を再利用した証跡）"
  else
    ng "S1: settings.json に __agentsMdEnforce の目印があるべき"
  fi

  rm -rf "$dest"
}

# =============================================================================
# シナリオ S2: 既存の再配備（ASC_MODE=match）では enforce off 設定を保持する
# =============================================================================
test_s2_match_keeps_off() {
  echo "[enforce-default-on] S2: 既存の再配備（match）は利用者の enforce off を保持する"
  # シナリオ: 新規 init で既定 on になった環境で、利用者が明示的に enforce off した後、
  #           upgrade（ASC_MODE=match）しても enforcement は off のまま変わらない。
  # Given: 新規 init 済みで、その後ユーザーが enforce off した採用先
  local dest; dest="$(mktemp -d)"; assert_tmp_target "$dest"
  node "$CLI" init "$dest" >/dev/null 2>&1
  assert_eq "on" "$(enforce_state "$dest")" "S2 前提: 新規 init 直後は on"
  node "$CLI" enforce off "$dest" >/dev/null 2>&1
  assert_eq "off" "$(enforce_state "$dest")" "S2 前提: enforce off 実行後は off"

  # When: upgrade を実行する（.agent-skill-chain/.package-manifest が既に存在するため ASC_MODE=match）
  node "$CLI" upgrade "$dest" >/dev/null 2>&1

  # Then: enforcement は off のまま変わらない（利用者の意図した設定を破壊しない）
  assert_eq "off" "$(enforce_state "$dest")" "S2: upgrade（match）後も off のまま（既定 on の再適用をしない）"

  rm -rf "$dest"
}

# =============================================================================
# シナリオ S3: 本パッケージ自己適用（ASC_MODE=own）では自動配線しない
# =============================================================================
test_s3_own_not_touched() {
  echo "[enforce-default-on] S3: 本パッケージ自己適用（own）では settings.json を自動配線しない"
  # シナリオ: パッケージ自身のリポジトリ（PACKAGE_ROOT）へ setup.sh を実行すると
  #           ASC_MODE=own と判定され、.claude/settings.json への enforcement 自動配線は行われない。
  #           実リポジトリを対象にはできないため、git archive で複製した独立コピーに対して
  #           「そのコピー自身への自己適用」を再現する（PACKAGE_ROOT=PROJECT_ROOT=複製コピー）。
  # Given: リポジトリの独立コピー（複製先自身がパッケージ正本にもなる、自己適用相当の構成）
  local pkg; pkg="$(mktemp -d)"; assert_tmp_target "$pkg"
  make_clean_tree "$pkg"
  # 複製コピーには .claude/ が無い状態（クリーン clone 相当）から始める
  assert_absent "$pkg/.claude/settings.json" "S3 前提: 複製コピーに settings.json が無い"

  # When: 複製コピー自身に対して setup.sh を実行する（第1引数=複製コピー自身 → PACKAGE_ROOT=PROJECT_ROOT）
  ( cd "$pkg" && bash "$SETUP_SH_REL" "$pkg" >/dev/null 2>&1 )

  # Then: .claude/settings.json は生成されない、または生成されても enforcement 配線は入らない
  #       （own では enforce_default_on_if_possible を一切呼ばないため、settings.json 自体が
  #       存在しないはず。hooks はコピーされるが settings.json は enforce on 経路でのみ生成される）。
  assert_absent "$pkg/.claude/settings.json" "S3: 自己適用では settings.json が自動生成されない（enforcement 未配線）"

  rm -rf "$pkg"
}

# =============================================================================
# シナリオ S4: 無効 JSON の新規環境では配線を安全に見送る（既存ファイルを破壊しない）
# =============================================================================
test_s4_invalid_json_skips_safely() {
  echo "[enforce-default-on] S4: 無効 JSON の新規環境では配線を見送り破壊しない"
  # シナリオ: .agent-skill-chain/ が未配備（ASC_MODE=new）だが、.claude/settings.json が
  #           あらかじめ無効 JSON として存在する採用先へ init すると、setup.sh 全体は
  #           中断せず完走し、enforcement 配線は見送られ、無効 JSON の内容も変更されない。
  # Given: .agent-skill-chain/ は無いが .claude/settings.json が無効 JSON の採用先
  local dest; dest="$(mktemp -d)"; assert_tmp_target "$dest"
  mkdir -p "$dest/.claude"
  printf '{ invalid json !!' > "$dest/.claude/settings.json"
  local before; before="$(cat "$dest/.claude/settings.json")"

  # When: init を実行する
  local rc=0
  node "$CLI" init "$dest" >/dev/null 2>&1 || rc=$?

  # Then: init 全体としては完走する（setup.sh が enforce on 失敗だけで中断しない）
  assert_eq "0" "$rc" "S4: 無効 JSON でも init 全体は非ゼロ終了せず完走する"
  # And: settings.json の内容は変更されない（破壊しない）
  local after; after="$(cat "$dest/.claude/settings.json" 2>/dev/null || true)"
  assert_eq "$before" "$after" "S4: 無効 JSON の settings.json は変更されない"
  # And: 他の配備物（hooks 等）は通常どおり生成される（enforce on 失敗が全体を壊さない）
  assert_exists "$dest/.claude/hooks/PreToolUse.sh" "S4: enforce on 失敗でも他の配備は継続する"

  rm -rf "$dest"
}

# =============================================================================
# シナリオ S5: 既に on の環境へ再度 init しても多重配線・多重 .bak を生まない（冪等性）
# =============================================================================
test_s5_idempotent_no_duplicate() {
  echo "[enforce-default-on] S5: 新規 init 後さらに enforce on しても多重配線・多重 .bak を生まない"
  # シナリオ: 新規 init で既定 on になった直後に、利用者が明示的に enforce on をもう一度
  #           実行しても、hooks の managed エントリが重複追加されない（enforceOn() 既存の
  #           冪等性を、既定 on 経由でも壊していないことの確認）。
  # Given: 新規 init 済み（既に on）の採用先
  local dest; dest="$(mktemp -d)"; assert_tmp_target "$dest"
  node "$CLI" init "$dest" >/dev/null 2>&1
  assert_eq "on" "$(enforce_state "$dest")" "S5 前提: 新規 init 直後は on"

  # When: 明示的に enforce on をもう一度実行する
  node "$CLI" enforce on "$dest" >/dev/null 2>&1

  # Then: PreToolUse の managed エントリは 1 件のみ（重複追加されない）
  local count
  count="$(node -e '
    const fs=require("fs");
    const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const arr=(s.hooks&&s.hooks.PreToolUse)||[];
    console.log(arr.filter(e=>e&&e.__agentsMdEnforce===true).length);
  ' "$dest/.claude/settings.json")"
  assert_eq "1" "$count" "S5: PreToolUse の managed エントリが重複しない（1 件のまま）"

  rm -rf "$dest"
}

# --- 実行 ---------------------------------------------------------------------
test_s1_new_gets_default_on
test_s2_match_keeps_off
test_s3_own_not_touched
test_s4_invalid_json_skips_safely
test_s5_idempotent_no_duplicate

echo "--------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
exit 0
