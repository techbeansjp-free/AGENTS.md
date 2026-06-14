#!/usr/bin/env bash
# e2e-install-uninstall.sh — install/uninstall・カプセル化の E2E（CI とローカルの単一正本）。
#
# ユースケース（このテストファイル全体）:
#   利用者が本パッケージをクリーン clone から採用先へ install し、必要物が自己完結で配備され
#   （maintainer 物は漏れない）、不要になれば uninstall で配備物のみを除去できる（ユーザー資産は保持）。
#   さらに Claude プラグイン（.adapters/claude）が自己完結したカプセルとして生成されることを確認する。
#
# 方針（破壊禁止）:
#   - 全シナリオを mktemp -d ＋ `git archive HEAD | tar -x` で再現したクリーン作業ツリーに対して実行する。
#   - 本開発リポの .agents/.claude/.cursor/.workflow/workflow.db を一切変更しない（対象は一時ディレクトリ）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash .agents/scripts/test/e2e-install-uninstall.sh   # リポジトリルート（git ツリー内）で実行
#
# 前提: bash・git・node・tar。sqlite3 があれば workflow.db 検証も行う（無ければ DB 検証はスキップ）。
# 参照:
#   docs/maintainer/workflow/20260614_124435_配布とパッケージ構成の再設計/
#     01_要件定義.md（US 配布/導入・US つけ外し・冪等性・カプセル化）, 03_実装計画.md
#   .agents/TEST_BDD_FORMAT.md（ユースケース/シナリオ・GWT インラインコメント）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"   # .agents/scripts/test -> repo root
CLI="$REPO_ROOT/bin/agents-md.js"

PASS=0
FAIL=0
FAILED_NAMES=()

# --- 簡易アサーション ---------------------------------------------------------
ok()   { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng()   { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_exists()     { [[ -e "$1" ]] && ok "${2:-存在: $1}" || ng "${2:-存在すべき: $1}"; }
assert_absent()     { [[ ! -e "$1" ]] && ok "${2:-不在: $1}" || ng "${2:-不在すべき: $1}"; }
assert_eq()         { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: '$1' != '$2'}"; }
assert_cmd_ok()     { if "$@" >/dev/null 2>&1; then ok "成功: $*"; else ng "成功すべき: $*"; fi; }
assert_cmd_fail()   { if "$@" >/dev/null 2>&1; then ng "失敗すべき: $*"; else ok "失敗（期待通り）: $*"; fi; }

# クリーン clone を一時ディレクトリへ再現する（git archive HEAD | tar -x）。
make_clean_tree() {
  local dst="$1"
  ( cd "$REPO_ROOT" && git archive HEAD | tar -x -C "$dst" )
}

# 必須前提の確認
command -v git  >/dev/null 2>&1 || { echo "エラー: git が必要です" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "エラー: node が必要です" >&2; exit 2; }
command -v tar  >/dev/null 2>&1 || { echo "エラー: tar が必要です" >&2; exit 2; }
HAS_SQLITE=0; command -v sqlite3 >/dev/null 2>&1 && HAS_SQLITE=1

echo "[e2e] REPO_ROOT=$REPO_ROOT"
echo "[e2e] sqlite3=$([[ $HAS_SQLITE -eq 1 ]] && echo あり || echo なし（DB 検証はスキップ）)"

# =============================================================================
# シナリオ 1: US 配布/導入 — クリーン clone から隔離 dir へ install し自己完結する
# =============================================================================
test_install_self_contained() {
  echo "[e2e] シナリオ1: install で必要物が自己完結配備され maintainer 物が漏れない"
  # シナリオ: クリーン clone を採用先 dir に install すると、必要物（.agents/AGENTS.md/CLAUDE.md/
  #           .claude/.cursor/.workflow/templates/workflow.db）が配備され、maintainer 物は漏れない。

  # Given: クリーン clone（パッケージ正本）と空の採用先 dir を用意する
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"

  # When: 採用先 dir へ init（= setup.sh）で配備する
  node "$CLI" init "$dest" >/dev/null 2>&1

  # Then: 必要物が配備され、自己完結している
  assert_exists "$dest/.agents/boot/CORE.md"            "install: .agents/ 正本が配備される"
  assert_exists "$dest/AGENTS.md"                       "install: AGENTS.md が配備される"
  assert_exists "$dest/CLAUDE.md"                       "install: CLAUDE.md が配備される"
  assert_exists "$dest/.claude/hooks/PreToolUse.sh"     "install: .claude フックが配備される"
  assert_exists "$dest/.cursor"                         "install: .cursor が配備される"
  assert_exists "$dest/.workflow/templates/00_要求定義.md" "install: .workflow/templates が配備される"

  # And (Then): maintainer 物・自己拡張物が採用先に漏れない（カプセル化境界）
  assert_absent "$dest/.agents-project"                 "install: .agents-project が漏れない"
  assert_absent "$dest/docs/maintainer"                 "install: docs/maintainer が漏れない"

  # And (Then): skills が domain__capability 形式で配備される
  if compgen -G "$dest/.claude/skills/*__*" >/dev/null; then
    ok "install: skills が domain__capability 形式で配備される"
  else
    ng "install: skills が domain__capability 形式で配備されるべき"
  fi

  # And (Then): workflow.db は sqlite3 があれば生成される（証跡 DB の自己完結）
  if [[ $HAS_SQLITE -eq 1 ]]; then
    assert_exists "$dest/.workflow/workflow.db"         "install: workflow.db が生成される"
  fi

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ 2: US つけ外し — uninstall で配備物のみ除去・ユーザー資産は保持
# =============================================================================
test_uninstall_keeps_user_assets() {
  echo "[e2e] シナリオ2: uninstall が配備物のみ除去しユーザー資産を保持する"
  # シナリオ: install 済みの採用先で uninstall --yes すると配備物（.agents/AGENTS.md 等）が除去され、
  #           ユーザー資産（.agents-project・.workflow の issue・workflow.db）は保持される。

  # Given: install 済みの採用先 dir にユーザー資産（.agents-project・issue・workflow.db）を用意する
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agents-project" "$dest/.workflow/20990101_000000_user_issue"
  echo "user rule" > "$dest/.agents-project/rule.md"
  echo "user issue" > "$dest/.workflow/20990101_000000_user_issue/00_要求定義.md"
  [[ $HAS_SQLITE -eq 0 ]] && : > "$dest/.workflow/workflow.db"  # sqlite 無くても保持対象として用意

  # When: uninstall を確認スキップ（--yes）で実行する
  node "$CLI" uninstall "$dest" --yes >/dev/null 2>&1

  # Then: 配備物が除去される
  assert_absent "$dest/.agents"                  "uninstall: .agents が除去される"
  assert_absent "$dest/AGENTS.md"                "uninstall: AGENTS.md が除去される"
  assert_absent "$dest/CLAUDE.md"                "uninstall: CLAUDE.md が除去される"
  assert_absent "$dest/.claude"                  "uninstall: .claude が除去される"
  assert_absent "$dest/.cursor"                  "uninstall: .cursor が除去される"
  assert_absent "$dest/.workflow/templates"      "uninstall: .workflow/templates が除去される"

  # And (Then): ユーザー資産は保持される（誤削除しない）
  assert_exists "$dest/.agents-project/rule.md"  "uninstall: .agents-project は保持される"
  assert_exists "$dest/.workflow/20990101_000000_user_issue/00_要求定義.md" "uninstall: issue は保持される"
  assert_exists "$dest/.workflow/workflow.db"    "uninstall: workflow.db は既定で保持される"

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ 3: つけ外し（--purge）— 証跡 DB も含め完全除去
# =============================================================================
test_uninstall_purge() {
  echo "[e2e] シナリオ3: uninstall --purge が workflow.db も除去する"
  # シナリオ: install 済みで workflow.db があるとき uninstall --purge --yes すると、
  #           配備物に加え workflow.db も除去される（.agents-project は保持）。

  # Given: install 済みで workflow.db とユーザー資産がある
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agents-project"; echo "keep" > "$dest/.agents-project/x.md"
  : > "$dest/.workflow/workflow.db"

  # When: purge 付きで uninstall する
  node "$CLI" uninstall "$dest" --purge --yes >/dev/null 2>&1

  # Then: 配備物と workflow.db が除去される
  assert_absent "$dest/.agents"               "purge: .agents が除去される"
  assert_absent "$dest/.workflow/workflow.db" "purge: workflow.db が除去される"

  # And (Then): .agents-project は purge でも保持される
  assert_exists "$dest/.agents-project/x.md"  "purge: .agents-project は保持される"

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ 4: 安全策 — 未配備 dir への uninstall は中止する
# =============================================================================
test_uninstall_safety_abort() {
  echo "[e2e] シナリオ4: 未配備 dir への uninstall は安全側で中止する"
  # シナリオ: .agents も AGENTS.md も無い（未配備の）dir に uninstall --yes すると、
  #           誤削除を防ぐため中止し、終了コード非ゼロを返す。

  # Given: 配備痕跡が無い dir に、たまたまユーザー資産だけがある
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  mkdir -p "$dest/.agents-project"; echo "keep" > "$dest/.agents-project/x.md"

  # When: uninstall を試みる（--yes でも実行されないこと）
  node "$CLI" uninstall "$dest" --yes >/dev/null 2>&1
  local rc=$?

  # Then: 終了コードが非ゼロ（中止）であり、ユーザー資産は無傷
  [[ "$rc" -ne 0 ]] && ok "safety: 未配備 dir で中止（exit!=0）" || ng "safety: 未配備 dir では中止すべき"
  assert_exists "$dest/.agents-project/x.md"  "safety: ユーザー資産は無傷"

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ 5: 冪等性 — 二重 install / uninstall 後の再 install が壊れない
# =============================================================================
test_idempotency() {
  echo "[e2e] シナリオ5: 二重 install と uninstall 後の再 install が壊れない"
  # シナリオ: 同一 dir に 2 回 install しても配備が健全で、uninstall 後に再 install しても復元される。

  # Given: クリーン clone と採用先 dir
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"

  # When: install を 2 回連続で実行する（冪等性）
  node "$CLI" init "$dest" >/dev/null 2>&1
  node "$CLI" init "$dest" >/dev/null 2>&1

  # Then: 二重 install 後も配備が健全
  assert_exists "$dest/.agents/boot/CORE.md"  "冪等: 二重 install 後も .agents が健全"

  # And (When): uninstall してから再 install する
  node "$CLI" uninstall "$dest" --yes >/dev/null 2>&1
  node "$CLI" init "$dest" >/dev/null 2>&1

  # And (Then): 再 install で配備物が復元される
  assert_exists "$dest/AGENTS.md"             "冪等: uninstall 後の再 install で復元される"
  assert_exists "$dest/.agents/boot/CORE.md"  "冪等: 再 install で .agents が復元される"

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ 6: プラグインのカプセル化 — .adapters/claude が自己完結する
# =============================================================================
test_plugin_encapsulation() {
  echo "[e2e] シナリオ6: build-adapters.sh claude が自己完結したカプセルを生成する"
  # シナリオ: クリーン clone で build-adapters.sh claude を実行すると .adapters/claude が
  #           自己完結（plugin.json/hooks.json 妥当・${CLAUDE_PLUGIN_ROOT} 参照・絶対パス漏れ無し・
  #           .agents 同梱）したプラグインカプセルとして生成される。

  # Given: クリーン clone（.adapters/ 不在）
  local src
  src="$(mktemp -d)"
  make_clean_tree "$src"

  # When: Claude アダプタを build する
  ( cd "$src" && bash .agents/scripts/build-adapters.sh claude >/dev/null 2>&1 )
  local out="$src/.adapters/claude"

  # Then: プラグイン構成物が存在し妥当
  assert_exists "$out/.claude-plugin/plugin.json"   "カプセル: plugin.json が生成される"
  assert_exists "$out/hooks/hooks.json"             "カプセル: hooks.json が生成される"
  assert_exists "$out/.agents/boot/CORE.md"         "カプセル: .agents が同梱される（自己完結）"
  assert_cmd_ok node -e "JSON.parse(require('fs').readFileSync('$out/.claude-plugin/plugin.json','utf8'))"
  assert_cmd_ok node -e "JSON.parse(require('fs').readFileSync('$out/hooks/hooks.json','utf8'))"

  # And (Then): hooks が ${CLAUDE_PLUGIN_ROOT} 相対で同梱 .agents を参照する（リポ固定パス非依存）
  if grep -q 'CLAUDE_PLUGIN_ROOT' "$out/hooks/hooks.json"; then
    ok "カプセル: hooks.json が \${CLAUDE_PLUGIN_ROOT} を参照する"
  else
    ng "カプセル: hooks.json は \${CLAUDE_PLUGIN_ROOT} を参照すべき"
  fi

  # And (Then): 生成物内にビルド環境の絶対パス（リポ外/一時ディレクトリ）が漏れていない
  if grep -rIq -- "$src" "$out" 2>/dev/null; then
    ng "カプセル: 生成物にビルド時の絶対パスが漏れている"
  else
    ok "カプセル: 生成物にビルド時の絶対パス漏れが無い"
  fi
  # 代表的な絶対パスプレフィックスも走査（/home /Users /tmp/ の素の参照が無いこと）
  if grep -rIqE -- '(^|[^A-Za-z_])(/home/|/Users/|/tmp/)' "$out" 2>/dev/null; then
    ng "カプセル: 生成物に環境依存の絶対パスが含まれる"
  else
    ok "カプセル: 生成物に環境依存の絶対パスが含まれない"
  fi

  rm -rf "$src"
}

# =============================================================================
# シナリオ 7: 配布物リーク — verify-npm-pack.sh を再利用しリーク無しを確認
# =============================================================================
test_no_dist_leak() {
  echo "[e2e] シナリオ7: npm 配布物に maintainer 物が漏れない"
  # シナリオ: クリーン clone で verify-npm-pack.sh を実行すると、配布 tarball に
  #           .agents-project/docs/maintainer/workflow.db/.adapters が含まれず必須物が揃う。

  # Given: クリーン clone（npm が無ければ本シナリオはスキップ）
  if ! command -v npm >/dev/null 2>&1; then
    echo "  [SKIP] npm が無いため配布物リーク検査をスキップ"
    return 0
  fi
  local src
  src="$(mktemp -d)"
  make_clean_tree "$src"

  # When/Then: 既存の単一正本スクリプトでリーク無しを検証する（成功=リーク無し）
  if ( cd "$src" && bash .agents/scripts/verify-npm-pack.sh >/dev/null 2>&1 ); then
    ok "配布物: verify-npm-pack.sh が合格（リーク無し・必須物あり）"
  else
    ng "配布物: verify-npm-pack.sh が失敗（リーク or 必須物欠落）"
  fi

  rm -rf "$src"
}

# --- 実行 ---------------------------------------------------------------------
[[ -f "$CLI" ]] || { echo "エラー: CLI が見つかりません: $CLI" >&2; exit 2; }

test_install_self_contained
test_uninstall_keeps_user_assets
test_uninstall_purge
test_uninstall_safety_abort
test_idempotency
test_plugin_encapsulation
test_no_dist_leak

echo ""
echo "[e2e] 結果: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "[e2e] 失敗したアサーション:"
  for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
  exit 1
fi
echo "[e2e] 全シナリオ pass"
