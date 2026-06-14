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

# =============================================================================
# シナリオ R1: 再インストール保持 — 再 init でユーザー資産が保持され正本は最新化される
# =============================================================================
# ユースケース:
#   利用者が install 済み dir に個人の project 固有ルール・自作エディタルール・issue・workflow.db を
#   作成した状態で再インストール（再 init = setup.sh 相当）しても、それらが破壊されず保持され、
#   かつパッケージ正本（.agents・agents-core.mdc・skills）は最新化される。
test_reinstall_preserves_user_assets() {
  echo "[e2e] シナリオR1: 再インストールでユーザー資産が保持され正本は最新化される"
  # シナリオ: install 済み dir にユーザー資産（.agents-project/custom-rule.md・.cursor/rules/my-team.mdc・
  #           .claude/settings.json・.workflow/<issue>/00.md・workflow.db）を作成し、再 init すると、
  #           それらが全て保持され、かつパッケージ正本（.agents・agents-core.mdc・skills）は最新化される。

  # Given: install 済み dir にユーザーが自作ルール・project 固有ルール・issue・設定を作成する
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agents-project" "$dest/.cursor/rules" "$dest/.claude" \
           "$dest/.workflow/20990101_000000_user_issue"
  echo "custom project rule"           > "$dest/.agents-project/custom-rule.md"
  echo "team cursor rule"              > "$dest/.cursor/rules/my-team.mdc"
  echo '{"userValue":true}'            > "$dest/.claude/settings.json"
  echo "user issue body"              > "$dest/.workflow/20990101_000000_user_issue/00.md"
  [[ $HAS_SQLITE -eq 0 ]] && : > "$dest/.workflow/workflow.db"
  # And (Given): パッケージ所有物を改変し、再 init で最新化されることを検出できるようにする
  echo "STALE" > "$dest/.cursor/agents-core.mdc"
  rm -rf "$dest/.cursor/skills" "$dest/.agents/boot/CORE.md"

  # When: 再度 init（= setup.sh / upgrade 相当）を実行する
  node "$CLI" init "$dest" >/dev/null 2>&1

  # Then: ユーザー資産が全て保持される（破壊されない）
  assert_exists "$dest/.agents-project/custom-rule.md"                       "R1: .agents-project の自作ルールが保持される"
  assert_exists "$dest/.cursor/rules/my-team.mdc"                            "R1: .cursor の自作ルールが保持される"
  assert_exists "$dest/.claude/settings.json"                               "R1: .claude のユーザー設定が保持される"
  assert_exists "$dest/.workflow/20990101_000000_user_issue/00.md"          "R1: ユーザー issue が保持される"
  assert_exists "$dest/.workflow/workflow.db"                               "R1: workflow.db が保持される"
  assert_eq "$(cat "$dest/.claude/settings.json")" '{"userValue":true}'     "R1: ユーザー設定の中身が改変されない"
  assert_eq "$(cat "$dest/.cursor/rules/my-team.mdc")" "team cursor rule"   "R1: 自作ルールの中身が改変されない"

  # And (Then): パッケージ正本は最新化される（agents-core.mdc は正本に戻り、.agents・skills は復元）
  assert_exists "$dest/.agents/boot/CORE.md"                                "R1: .agents 正本が再配備で復元される"
  if compgen -G "$dest/.cursor/skills/*__*" >/dev/null; then
    ok "R1: .cursor/skills がパッケージ正本から再生成される"
  else
    ng "R1: .cursor/skills がパッケージ正本から再生成されるべき"
  fi
  if [[ "$(cat "$dest/.cursor/agents-core.mdc")" != "STALE" ]]; then
    ok "R1: agents-core.mdc がパッケージ正本で最新化される"
  else
    ng "R1: agents-core.mdc はパッケージ正本で最新化されるべき（STALE のまま残ってはならない）"
  fi

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ R2: upgrade 保持 — agents-md upgrade でもユーザー資産が保持される
# =============================================================================
# ユースケース:
#   利用者が install 済み dir で upgrade サブコマンドを実行しても、R1 と同様に
#   個人資産（project 固有ルール・自作エディタルール・ユーザー設定・issue・workflow.db）が保持される。
test_upgrade_preserves_user_assets() {
  echo "[e2e] シナリオR2: upgrade でもユーザー資産が保持される"
  # シナリオ: install 済み dir にユーザー資産を作成し、agents-md upgrade を実行すると、
  #           それらが保持され、かつパッケージ正本は最新化される。

  # Given: install 済み dir にユーザー資産を作成する
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agents-project" "$dest/.cursor/rules" "$dest/.claude"
  echo "custom project rule" > "$dest/.agents-project/custom-rule.md"
  echo "team cursor rule"    > "$dest/.cursor/rules/my-team.mdc"
  echo '{"userValue":true}'  > "$dest/.claude/settings.json"

  # When: upgrade サブコマンドを実行する
  node "$CLI" upgrade "$dest" >/dev/null 2>&1

  # Then: ユーザー資産が保持される
  assert_exists "$dest/.agents-project/custom-rule.md"  "R2: upgrade 後も .agents-project の自作ルールが保持される"
  assert_exists "$dest/.cursor/rules/my-team.mdc"       "R2: upgrade 後も .cursor の自作ルールが保持される"
  assert_exists "$dest/.claude/settings.json"           "R2: upgrade 後も .claude のユーザー設定が保持される"

  # And (Then): パッケージ正本は最新化される
  assert_exists "$dest/.agents/boot/CORE.md"            "R2: upgrade で .agents 正本が最新化される"
  assert_exists "$dest/.cursor/agents-core.mdc"         "R2: upgrade で agents-core.mdc が配備される"

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ R3: uninstall 保持 — 既定 uninstall でユーザー作成物・project 固有ルールが残る
# =============================================================================
# ユースケース:
#   利用者が .cursor/.claude にユーザー作成物を同居させた状態で uninstall（既定）しても、
#   パッケージ配備分のみが除去され、ユーザー作成物（.cursor/rules/my-team.mdc 等）と
#   .agents-project/ は保持される。
test_uninstall_preserves_cohabiting_user_assets() {
  echo "[e2e] シナリオR3: uninstall がユーザー作成物と project 固有ルールを保持する"
  # シナリオ: .cursor/rules/my-team.mdc・.claude/settings.json・.agents-project/ がある install 済み dir で
  #           uninstall --yes すると、パッケージ配備分（agents-core.mdc・skills・hooks・.agents 等）のみ除去され、
  #           ユーザー作成物と .agents-project は保持される。

  # Given: install 済み dir にユーザー作成物が同居している
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agents-project" "$dest/.cursor/rules" "$dest/.claude"
  echo "custom project rule" > "$dest/.agents-project/custom-rule.md"
  echo "team cursor rule"    > "$dest/.cursor/rules/my-team.mdc"
  echo '{"userValue":true}'  > "$dest/.claude/settings.json"

  # When: 既定 uninstall を実行する
  node "$CLI" uninstall "$dest" --yes >/dev/null 2>&1

  # Then: ユーザー作成物・project 固有ルールが保持される
  assert_exists "$dest/.cursor/rules/my-team.mdc"      "R3: .cursor の自作ルールが uninstall で保持される"
  assert_exists "$dest/.claude/settings.json"          "R3: .claude のユーザー設定が uninstall で保持される"
  assert_exists "$dest/.agents-project/custom-rule.md" "R3: .agents-project が uninstall で保持される"

  # And (Then): パッケージ配備分のみが除去される（.cursor/.claude は丸ごと消えない）
  assert_absent "$dest/.cursor/agents-core.mdc"        "R3: パッケージ所有の agents-core.mdc は除去される"
  assert_absent "$dest/.cursor/skills"                 "R3: パッケージ生成 .cursor/skills は除去される"
  assert_absent "$dest/.claude/hooks"                  "R3: パッケージ生成 .claude/hooks は除去される"
  assert_absent "$dest/.claude/skills"                 "R3: パッケージ生成 .claude/skills は除去される"
  assert_absent "$dest/.agents"                        "R3: .agents 正本は除去される"

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ R4: skills/hooks 自作物の再インストール保持
# =============================================================================
# ユースケース:
#   Claude Code では .claude/skills/ はユーザーが自作スキルを置く一般的な場所であり、.claude/hooks/ に
#   独自フックを置くこともある。.cursor/skills/ も同様。利用者がこれらに自作物を置いた状態で再インストール
#   （再 init = setup.sh / upgrade 相当）しても、自作スキル/フックが破壊されず保持され、かつパッケージ配備分
#   （{domain}__{capability}・ドメイン直下 {domain}・所有フック）は最新化される。
test_reinstall_preserves_user_skills_and_hooks() {
  echo "[e2e] シナリオR4: 再インストールで自作スキル/フックが保持されパッケージ配備分は最新化される"
  # シナリオ: install 済み dir に .claude/skills/my-user-skill/SKILL.md・.claude/hooks/my-user-hook.sh・
  #           .cursor/skills/my-user-skill/SKILL.md を作成し、パッケージ配備分を改変してから再 init すると、
  #           自作物が全て保持され、かつパッケージ skill（agent・{domain}__{capability}）と所有フックは最新化される。

  # Given: install 済み dir にユーザーが自作スキル/フックを作成する
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.claude/skills/my-user-skill" "$dest/.cursor/skills/my-user-skill"
  echo "user skill (claude)" > "$dest/.claude/skills/my-user-skill/SKILL.md"
  echo "user skill (cursor)" > "$dest/.cursor/skills/my-user-skill/SKILL.md"
  echo "#!/usr/bin/env bash"  > "$dest/.claude/hooks/my-user-hook.sh"
  echo "echo my-user-hook"   >> "$dest/.claude/hooks/my-user-hook.sh"
  # And (Given): パッケージ配備分を改変し、再 init で最新化されることを検出できるようにする
  echo "STALE" > "$dest/.claude/hooks/PreToolUse.sh"
  rm -rf "$dest/.claude/skills/agent" "$dest/.cursor/skills/agent"

  # When: 再度 init（= setup.sh / upgrade 相当）を実行する
  node "$CLI" init "$dest" >/dev/null 2>&1

  # Then: ユーザー自作スキル/フックが全て保持される（破壊されない）
  assert_exists "$dest/.claude/skills/my-user-skill/SKILL.md" "R4: .claude の自作スキルが保持される"
  assert_exists "$dest/.cursor/skills/my-user-skill/SKILL.md" "R4: .cursor の自作スキルが保持される"
  assert_exists "$dest/.claude/hooks/my-user-hook.sh"         "R4: .claude の独自フックが保持される"
  assert_eq "$(cat "$dest/.claude/skills/my-user-skill/SKILL.md")" "user skill (claude)" "R4: 自作スキルの中身が改変されない"
  assert_eq "$(cat "$dest/.claude/hooks/my-user-hook.sh" | tail -n1)" "echo my-user-hook" "R4: 独自フックの中身が改変されない"

  # And (Then): パッケージ配備分は最新化される（所有 skill 再生成・所有フックが正本に戻る）
  assert_exists "$dest/.claude/skills/agent/SKILL.md"        "R4: パッケージ skill（ドメイン直下 agent）が再生成される"
  if compgen -G "$dest/.claude/skills/*__*" >/dev/null; then
    ok "R4: パッケージ skill（{domain}__{capability}）が再生成される"
  else
    ng "R4: パッケージ skill（{domain}__{capability}）が再生成されるべき"
  fi
  if compgen -G "$dest/.cursor/skills/*__*" >/dev/null; then
    ok "R4: .cursor の パッケージ skill が再生成される"
  else
    ng "R4: .cursor の パッケージ skill が再生成されるべき"
  fi
  if [[ "$(cat "$dest/.claude/hooks/PreToolUse.sh")" != "STALE" ]]; then
    ok "R4: 所有フック PreToolUse.sh がパッケージ正本で最新化される"
  else
    ng "R4: 所有フック PreToolUse.sh はパッケージ正本で最新化されるべき（STALE のまま残ってはならない）"
  fi

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ R5: uninstall 時の自作スキル/フック保持
# =============================================================================
# ユースケース:
#   利用者が .claude/skills・.cursor/skills に自作スキル、.claude/hooks に独自フックを同居させた状態で
#   uninstall（既定）しても、パッケージ所有分（所有 skill エントリ・所有フック）のみが除去され、
#   自作スキル/フックは保持される。除去後に空になった skills/hooks のみ片付ける。
test_uninstall_preserves_user_skills_and_hooks() {
  echo "[e2e] シナリオR5: uninstall が自作スキル/フックを保持しパッケージ所有分のみ除去する"
  # シナリオ: .claude/skills/my-user-skill・.cursor/skills/my-user-skill・.claude/hooks/my-user-hook.sh がある
  #           install 済み dir で uninstall --yes すると、パッケージ所有 skill/フックのみ除去され、自作物は保持される。

  # Given: install 済み dir に自作スキル/フックが同居している
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.claude/skills/my-user-skill" "$dest/.cursor/skills/my-user-skill"
  echo "user skill (claude)" > "$dest/.claude/skills/my-user-skill/SKILL.md"
  echo "user skill (cursor)" > "$dest/.cursor/skills/my-user-skill/SKILL.md"
  echo "echo my-user-hook"    > "$dest/.claude/hooks/my-user-hook.sh"

  # When: 既定 uninstall を実行する
  node "$CLI" uninstall "$dest" --yes >/dev/null 2>&1

  # Then: ユーザー自作スキル/フックが保持される
  assert_exists "$dest/.claude/skills/my-user-skill/SKILL.md" "R5: .claude の自作スキルが uninstall で保持される"
  assert_exists "$dest/.cursor/skills/my-user-skill/SKILL.md" "R5: .cursor の自作スキルが uninstall で保持される"
  assert_exists "$dest/.claude/hooks/my-user-hook.sh"         "R5: .claude の独自フックが uninstall で保持される"

  # And (Then): パッケージ所有分（所有 skill エントリ・所有フック）のみが除去される
  assert_absent "$dest/.claude/skills/agent"        "R5: パッケージ所有 skill（agent）は除去される"
  assert_absent "$dest/.cursor/skills/agent"        "R5: パッケージ所有 skill（.cursor agent）は除去される"
  assert_absent "$dest/.claude/hooks/PreToolUse.sh" "R5: パッケージ所有フック PreToolUse.sh は除去される"
  if compgen -G "$dest/.claude/skills/*__*" >/dev/null; then
    ng "R5: パッケージ所有 skill（{domain}__{capability}）は除去されるべき"
  else
    ok "R5: パッケージ所有 skill（{domain}__{capability}）が除去される"
  fi

  # And (Then): 自作物が残るため skills/hooks ディレクトリ自体は保持される（空でないので片付かない）
  assert_exists "$dest/.claude/skills"  "R5: 自作スキルが残るため .claude/skills は保持される"
  assert_exists "$dest/.claude/hooks"   "R5: 独自フックが残るため .claude/hooks は保持される"

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ R6: enforcement opt-in — 既定 off／enforce on で配線・off で解除（ユーザー値保持）
# =============================================================================
# ユースケース:
#   利用者がドッグフーディング時にだけ enforcement フックを opt-in できる。既定 install では
#   .claude/settings.json に enforcement を書き込まず（off）、`enforce on` で正本テンプレートから
#   妥当な settings.json を生成/マージし（既存ユーザー値は破壊しない）、`enforce off` で配線のみ外す。
#   `status` が on/off を正しく表示し、hooks の command は実在する .claude/hooks/PreToolUse.sh 等を指す。
test_enforcement_optin() {
  echo "[e2e] シナリオR6: enforcement opt-in（既定 off／on 配線・off 解除・ユーザー値保持）"
  # シナリオ: 既定 install では settings.json に enforcement が書かれず、enforce on で妥当 JSON が生成され
  #           hooks が実在 hook を指し、AGENT_ROLE=orchestrator が設定される。既存ユーザー settings があれば
  #           マージで破壊せず .bak を退避し、enforce off で配線のみ外れてユーザー値が残る。status が on/off を表示する。

  # Given: クリーン clone を隔離 dir へ install する
  local src dest settings
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  settings="$dest/.claude/settings.json"

  # Then: 既定 install では enforcement が書かれない（off）
  assert_absent "$settings"                                 "R6: 既定 install では settings.json に enforcement を書かない（off）"

  # And (When): enforce status は off を表示する
  if node "$CLI" enforce status "$dest" 2>&1 | grep -q "off"; then
    ok "R6: status が off を表示する（配線前）"
  else
    ng "R6: status は off を表示すべき（配線前）"
  fi

  # When: enforce on で opt-in する
  node "$CLI" enforce on "$dest" >/dev/null 2>&1

  # Then: settings.json が妥当 JSON である（無効 JSON での Claude 起動エラーを防ぐ）
  assert_cmd_ok node -e "JSON.parse(require('fs').readFileSync('$settings','utf8'))"

  # And (Then): hooks の command が実在する .claude/hooks/PreToolUse.sh を指し、AGENT_ROLE=orchestrator が設定される
  assert_exists "$dest/.claude/hooks/PreToolUse.sh"         "R6: 配線先 PreToolUse.sh が実在する"
  assert_exists "$dest/.claude/hooks/PostToolUse.sh"        "R6: 配線先 PostToolUse.sh が実在する"
  if node -e '
      const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      const pre=(s.hooks&&s.hooks.PreToolUse||[]).find(e=>e.__agentsMdEnforce);
      const cmd=pre&&pre.hooks&&pre.hooks[0]&&pre.hooks[0].command||"";
      process.exit((cmd.includes("PreToolUse.sh") && s.env && s.env.AGENT_ROLE==="orchestrator")?0:1);
    ' "$settings"; then
    ok "R6: hooks が PreToolUse.sh を指し AGENT_ROLE=orchestrator が設定される"
  else
    ng "R6: hooks が実在 hook を指し AGENT_ROLE=orchestrator を設定すべき"
  fi

  # And (When): enforce status は on を表示する
  if node "$CLI" enforce status "$dest" 2>&1 | grep -q "on"; then
    ok "R6: status が on を表示する（配線後）"
  else
    ng "R6: status は on を表示すべき（配線後）"
  fi

  # And (When): enforce off で配線を外す
  node "$CLI" enforce off "$dest" >/dev/null 2>&1

  # And (Then): enforcement 配線が外れ、status が off に戻る
  if node "$CLI" enforce status "$dest" 2>&1 | grep -q "off"; then
    ok "R6: enforce off で配線が外れ status が off に戻る"
  else
    ng "R6: enforce off 後は status が off に戻るべき"
  fi

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ R7: enforcement opt-in がユーザー settings.json を破壊しない（マージ・退避）
# =============================================================================
# ユースケース:
#   利用者が既に .claude/settings.json に独自の env・hooks・permissions を持っている状態で
#   enforce on しても、それらが破壊されずマージされ、上書き前に .bak へ退避される。enforce off で
#   enforcement 由来の配線（managed env キー・managed hook エントリ）のみが外れ、ユーザー値は残る。
test_enforcement_preserves_user_settings() {
  echo "[e2e] シナリオR7: enforce on/off がユーザー settings.json を破壊しない"
  # シナリオ: ユーザー env(MY_USER_VAR)・ユーザー hook・permissions を持つ settings.json に enforce on すると、
  #           ユーザー値が保持され .bak が退避され、enforce off で enforcement 配線のみ外れユーザー値が残る。

  # Given: install 済み dir にユーザー独自の settings.json を用意する
  local src dest settings
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  settings="$dest/.claude/settings.json"
  mkdir -p "$dest/.claude"
  cat > "$settings" <<'JSON'
{
  "env": { "MY_USER_VAR": "keepme" },
  "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "echo user-hook" } ] } ] },
  "permissions": { "allow": ["Read"] }
}
JSON

  # When: enforce on でマージする
  node "$CLI" enforce on "$dest" >/dev/null 2>&1

  # Then: 既存 settings の退避 .bak が作成される
  assert_exists "$settings.bak"                            "R7: enforce on で settings.json.bak が退避される"

  # And (Then): ユーザー値が保持されつつ enforcement が追加される
  if node -e '
      const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      const userVar=s.env&&s.env.MY_USER_VAR==="keepme";
      const role=s.env&&s.env.AGENT_ROLE==="orchestrator";
      const perm=s.permissions&&Array.isArray(s.permissions.allow)&&s.permissions.allow[0]==="Read";
      const userHook=(s.hooks.PreToolUse||[]).some(e=>!e.__agentsMdEnforce&&e.hooks[0].command==="echo user-hook");
      const managed=(s.hooks.PreToolUse||[]).some(e=>e.__agentsMdEnforce===true);
      process.exit((userVar&&role&&perm&&userHook&&managed)?0:1);
    ' "$settings"; then
    ok "R7: ユーザー env/hook/permissions を保持しつつ enforcement を追加する"
  else
    ng "R7: ユーザー値を破壊せず enforcement を追加すべき"
  fi

  # And (When): enforce off で配線のみ外す
  node "$CLI" enforce off "$dest" >/dev/null 2>&1

  # And (Then): enforcement 配線のみ外れ、ユーザー値は残る
  if node -e '
      const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      const userVar=s.env&&s.env.MY_USER_VAR==="keepme";
      const noRole=!(s.env&&s.env.AGENT_ROLE);
      const perm=s.permissions&&s.permissions.allow[0]==="Read";
      const pre=s.hooks&&s.hooks.PreToolUse||[];
      const userHookKept=pre.length===1&&pre[0].hooks[0].command==="echo user-hook";
      process.exit((userVar&&noRole&&perm&&userHookKept)?0:1);
    ' "$settings"; then
    ok "R7: enforce off で enforcement 配線のみ外れユーザー値が残る"
  else
    ng "R7: enforce off は enforcement 配線のみ外しユーザー値を残すべき"
  fi

  rm -rf "$src" "$dest"
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
test_reinstall_preserves_user_assets
test_upgrade_preserves_user_assets
test_uninstall_preserves_cohabiting_user_assets
test_reinstall_preserves_user_skills_and_hooks
test_uninstall_preserves_user_skills_and_hooks
test_enforcement_optin
test_enforcement_preserves_user_settings

echo ""
echo "[e2e] 結果: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "[e2e] 失敗したアサーション:"
  for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
  exit 1
fi
echo "[e2e] 全シナリオ pass"
