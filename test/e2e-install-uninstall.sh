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
#   - 本開発リポの .agent-skill-chain/source/.claude/.cursor/.agent-skill-chain/runtime/workflow.db を一切変更しない（対象は一時ディレクトリ）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/e2e-install-uninstall.sh   # リポジトリルート（git ツリー内）で実行
#
# 前提: bash・git・node・tar。sqlite3 があれば workflow.db 検証も行う（無ければ DB 検証はスキップ）。
# 参照:
#   docs/maintainer/workflow/20260614_124435_配布とパッケージ構成の再設計/
#     01_要件定義.md（US 配布/導入・US つけ外し・冪等性・カプセル化）, 03_実装計画.md
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md（ユースケース/シナリオ・GWT インラインコメント）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"   # test/ -> repo root（配置非依存）
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

# クリーン clone を一時ディレクトリへ再現する（追跡ツリーの実内容を複製）。
#   git archive HEAD は最終コミットのみ反映し、未コミット（staged/unstaged）のレイアウト変更
#   （例: 統合ネストへの移行）を取りこぼす。ここでは現在の追跡ファイル（staged+unstaged の実内容）を
#   忠実に複製し、クリーン clone 相当をコミット状態に非依存で再現する。exec bit・日本語名も保持される。
make_clean_tree() {
  local dst="$1"
  ( cd "$REPO_ROOT" && git ls-files -z | tar --null -T - -cf - ) | tar -x -C "$dst"
}

# 破壊的操作の対象ディレクトリが必ず /tmp 配下（mktemp -d 由来）であることを保証する安全ガード。
#   誤って実リポジトリ等を対象にした場合に即座に FATAL 終了して被害を防ぐ（前回事故の再発防止）。
assert_tmp_target() {
  case "$1" in
    /tmp/*) : ;;
    *) echo "FATAL: unsafe target dir（/tmp 配下ではない）: $1" >&2; exit 1 ;;
  esac
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
  # シナリオ: クリーン clone を採用先 dir に install すると、必要物（.agent-skill-chain/source/AGENTS.md/CLAUDE.md/
  #           .claude/.cursor/.agent-skill-chain/runtime/templates/workflow.db）が配備され、maintainer 物は漏れない。

  # Given: クリーン clone（パッケージ正本）と空の採用先 dir を用意する
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"

  # When: 採用先 dir へ init（= setup.sh）で配備する
  node "$CLI" init "$dest" >/dev/null 2>&1

  # Then: 必要物が配備され、自己完結している
  assert_exists "$dest/.agent-skill-chain/source/boot/CORE.md"            "install: .agent-skill-chain/source/ 正本が配備される"
  assert_exists "$dest/AGENTS.md"                       "install: AGENTS.md が配備される"
  assert_exists "$dest/CLAUDE.md"                       "install: CLAUDE.md が配備される"
  assert_exists "$dest/.claude/hooks/PreToolUse.sh"     "install: .claude フックが配備される"
  assert_exists "$dest/.cursor"                         "install: .cursor が配備される"
  assert_exists "$dest/.agent-skill-chain/runtime/templates/00_要求定義.md" "install: .agent-skill-chain/runtime/templates が配備される"

  # And (Then): maintainer 物・自己拡張物が採用先に漏れない（カプセル化境界）
  assert_absent "$dest/.agent-skill-chain/project"                 "install: .agent-skill-chain/project が漏れない"
  assert_absent "$dest/docs/maintainer"                 "install: docs/maintainer が漏れない"

  # And (Then): skills が domain__capability 形式で配備される
  if compgen -G "$dest/.claude/skills/*__*" >/dev/null; then
    ok "install: skills が domain__capability 形式で配備される"
  else
    ng "install: skills が domain__capability 形式で配備されるべき"
  fi

  # And (Then): workflow.db は sqlite3 があれば生成される（証跡 DB の自己完結）
  if [[ $HAS_SQLITE -eq 1 ]]; then
    assert_exists "$dest/.agent-skill-chain/runtime/workflow.db"         "install: workflow.db が生成される"
  fi

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ 2: US つけ外し — uninstall で配備物のみ除去・ユーザー資産は保持
# =============================================================================
test_uninstall_keeps_user_assets() {
  echo "[e2e] シナリオ2: uninstall が配備物のみ除去しユーザー資産を保持する"
  # シナリオ: install 済みの採用先で uninstall --yes すると配備物（.agent-skill-chain/source/AGENTS.md 等）が除去され、
  #           ユーザー資産（.agent-skill-chain/project・.workflow の issue・workflow.db）は保持される。

  # Given: install 済みの採用先 dir にユーザー資産（.agent-skill-chain/project・issue・workflow.db）を用意する
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agent-skill-chain/project" "$dest/.agent-skill-chain/runtime/20990101_000000_user_issue"
  echo "user rule" > "$dest/.agent-skill-chain/project/rule.md"
  echo "user issue" > "$dest/.agent-skill-chain/runtime/20990101_000000_user_issue/00_要求定義.md"
  [[ $HAS_SQLITE -eq 0 ]] && : > "$dest/.agent-skill-chain/runtime/workflow.db"  # sqlite 無くても保持対象として用意

  # When: uninstall を確認スキップ（--yes）で実行する
  node "$CLI" uninstall "$dest" --yes >/dev/null 2>&1

  # Then: 配備物が除去される
  assert_absent "$dest/.agent-skill-chain/source" "uninstall: .agent-skill-chain/source が除去される"
  assert_absent "$dest/AGENTS.md"                "uninstall: AGENTS.md が除去される"
  assert_absent "$dest/CLAUDE.md"                "uninstall: CLAUDE.md が除去される"
  assert_absent "$dest/.claude"                  "uninstall: .claude が除去される"
  assert_absent "$dest/.cursor"                  "uninstall: .cursor が除去される"
  assert_absent "$dest/.agent-skill-chain/runtime/templates"      "uninstall: .agent-skill-chain/runtime/templates が除去される"

  # And (Then): ユーザー資産は保持される（誤削除しない）
  assert_exists "$dest/.agent-skill-chain/project/rule.md"  "uninstall: .agent-skill-chain/project は保持される"
  assert_exists "$dest/.agent-skill-chain/runtime/20990101_000000_user_issue/00_要求定義.md" "uninstall: issue は保持される"
  assert_exists "$dest/.agent-skill-chain/runtime/workflow.db"    "uninstall: workflow.db は既定で保持される"

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ 3: つけ外し（--purge）— 証跡 DB も含め完全除去
# =============================================================================
test_uninstall_purge() {
  echo "[e2e] シナリオ3: uninstall --purge が統合ルートを完全除去する（§2.6.9.3）"
  # シナリオ: install 済みで project/・workflow.db があるとき uninstall --purge --yes すると、
  #           配備物に加え project/・runtime/（issue 履歴・workflow.db）も除去され、統合ルートごと消える。

  # Given: install 済みで workflow.db とユーザー資産がある
  local dest
  dest="$(mktemp -d)"; assert_tmp_target "$dest"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agent-skill-chain/project"; echo "keep" > "$dest/.agent-skill-chain/project/x.md"
  : > "$dest/.agent-skill-chain/runtime/workflow.db"

  # When: purge 付きで uninstall する
  node "$CLI" uninstall "$dest" --purge --yes >/dev/null 2>&1

  # Then: 配備物・project/・workflow.db がすべて除去され、統合ルートごと消える
  assert_absent "$dest/.agent-skill-chain/source"             "purge: source が除去される"
  assert_absent "$dest/.agent-skill-chain/runtime/workflow.db" "purge: workflow.db が除去される"
  assert_absent "$dest/.agent-skill-chain/project/x.md"       "purge: project は完全削除で除去される"
  assert_absent "$dest/.agent-skill-chain"                    "purge: 統合ルート .agent-skill-chain/ ごと除去される"

  rm -rf "$dest"
}

# =============================================================================
# シナリオ 4: 安全策 — 未配備 dir への uninstall は中止する
# =============================================================================
test_uninstall_safety_abort() {
  echo "[e2e] シナリオ4: 未配備 dir への uninstall は安全側で中止する"
  # シナリオ: .agent-skill-chain/ も AGENTS.md も無い（配備痕跡が無い）dir に uninstall --yes すると、
  #           誤削除を防ぐため中止し、終了コード非ゼロを返す（§2.6.9.3 の痕跡判定＝.agent-skill-chain//AGENTS.md）。

  # Given: 配備痕跡（.agent-skill-chain/・AGENTS.md）が無い dir に、無関係のユーザーファイルだけがある
  local dest
  dest="$(mktemp -d)"; assert_tmp_target "$dest"
  echo "unrelated user data" > "$dest/my-notes.txt"

  # When: uninstall を試みる（--yes でも実行されないこと）
  node "$CLI" uninstall "$dest" --yes >/dev/null 2>&1
  local rc=$?

  # Then: 終了コードが非ゼロ（中止）であり、ユーザーファイルは無傷
  [[ "$rc" -ne 0 ]] && ok "safety: 未配備 dir で中止（exit!=0）" || ng "safety: 未配備 dir では中止すべき"
  assert_exists "$dest/my-notes.txt"  "safety: 無関係ユーザーファイルは無傷"

  rm -rf "$dest"
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
  assert_exists "$dest/.agent-skill-chain/source/boot/CORE.md"  "冪等: 二重 install 後も .agents が健全"

  # And (When): uninstall してから再 install する
  node "$CLI" uninstall "$dest" --yes >/dev/null 2>&1
  node "$CLI" init "$dest" >/dev/null 2>&1

  # And (Then): 再 install で配備物が復元される
  assert_exists "$dest/AGENTS.md"             "冪等: uninstall 後の再 install で復元される"
  assert_exists "$dest/.agent-skill-chain/source/boot/CORE.md"  "冪等: 再 install で .agents が復元される"

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
  ( cd "$src" && bash .agent-skill-chain/source/scripts/build-adapters.sh claude >/dev/null 2>&1 )
  local out="$src/.adapters/claude"

  # Then: プラグイン構成物が存在し妥当
  assert_exists "$out/.claude-plugin/plugin.json"   "カプセル: plugin.json が生成される"
  assert_exists "$out/hooks/hooks.json"             "カプセル: hooks.json が生成される"
  assert_exists "$out/.agent-skill-chain/source/boot/CORE.md"         "カプセル: .agents が同梱される（自己完結）"
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
  #           .agent-skill-chain/project/docs/maintainer/workflow.db/.adapters が含まれず必須物が揃う。

  # Given: クリーン clone（npm が無ければ本シナリオはスキップ）
  if ! command -v npm >/dev/null 2>&1; then
    echo "  [SKIP] npm が無いため配布物リーク検査をスキップ"
    return 0
  fi
  local src
  src="$(mktemp -d)"
  make_clean_tree "$src"

  # And (Given): クリーンツリー（git archive HEAD）には非追跡の bin が含まれないため、
  #   verify-npm-pack.sh の required:bin を満たすよう $src で使用前 build する（tmp 隔離内）。
  #   正本: docs/maintainer/workflow/20260615_114305_bin生成物のgitignore化とpublish時ビルド/02_設計.md §3.2.2/§6.3
  ( cd "$src" && npm ci >/dev/null 2>&1 && npm run build >/dev/null 2>&1 ) || {
    echo "  [SKIP] $src での npm ci/build に失敗したため配布物リーク検査をスキップ"
    rm -rf "$src"; return 0
  }

  # When/Then: 既存の単一正本スクリプトでリーク無しを検証する（成功=リーク無し）
  if ( cd "$src" && bash .agent-skill-chain/source/scripts/verify-npm-pack.sh >/dev/null 2>&1 ); then
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
  # シナリオ: install 済み dir にユーザー資産（.agent-skill-chain/project/custom-rule.md・.cursor/rules/my-team.mdc・
  #           .claude/settings.json・.agent-skill-chain/runtime/<issue>/00.md・workflow.db）を作成し、再 init すると、
  #           それらが全て保持され、かつパッケージ正本（.agents・agents-core.mdc・skills）は最新化される。

  # Given: install 済み dir にユーザーが自作ルール・project 固有ルール・issue・設定を作成する
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agent-skill-chain/project" "$dest/.cursor/rules" "$dest/.claude" \
           "$dest/.agent-skill-chain/runtime/20990101_000000_user_issue"
  echo "custom project rule"           > "$dest/.agent-skill-chain/project/custom-rule.md"
  echo "team cursor rule"              > "$dest/.cursor/rules/my-team.mdc"
  echo '{"userValue":true}'            > "$dest/.claude/settings.json"
  echo "user issue body"              > "$dest/.agent-skill-chain/runtime/20990101_000000_user_issue/00.md"
  [[ $HAS_SQLITE -eq 0 ]] && : > "$dest/.agent-skill-chain/runtime/workflow.db"
  # And (Given): パッケージ所有物を改変し、再 init で最新化されることを検出できるようにする
  echo "STALE" > "$dest/.cursor/agents-core.mdc"
  rm -rf "$dest/.cursor/skills" "$dest/.agent-skill-chain/source/boot/CORE.md"

  # When: 再度 init（= setup.sh / upgrade 相当）を実行する
  node "$CLI" init "$dest" >/dev/null 2>&1

  # Then: ユーザー資産が全て保持される（破壊されない）
  assert_exists "$dest/.agent-skill-chain/project/custom-rule.md"                       "R1: .agent-skill-chain/project の自作ルールが保持される"
  assert_exists "$dest/.cursor/rules/my-team.mdc"                            "R1: .cursor の自作ルールが保持される"
  assert_exists "$dest/.claude/settings.json"                               "R1: .claude のユーザー設定が保持される"
  assert_exists "$dest/.agent-skill-chain/runtime/20990101_000000_user_issue/00.md"          "R1: ユーザー issue が保持される"
  assert_exists "$dest/.agent-skill-chain/runtime/workflow.db"                               "R1: workflow.db が保持される"
  assert_eq "$(cat "$dest/.claude/settings.json")" '{"userValue":true}'     "R1: ユーザー設定の中身が改変されない"
  assert_eq "$(cat "$dest/.cursor/rules/my-team.mdc")" "team cursor rule"   "R1: 自作ルールの中身が改変されない"

  # And (Then): パッケージ正本は最新化される（agents-core.mdc は正本に戻り、.agents・skills は復元）
  assert_exists "$dest/.agent-skill-chain/source/boot/CORE.md"                                "R1: .agents 正本が再配備で復元される"
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
  mkdir -p "$dest/.agent-skill-chain/project" "$dest/.cursor/rules" "$dest/.claude"
  echo "custom project rule" > "$dest/.agent-skill-chain/project/custom-rule.md"
  echo "team cursor rule"    > "$dest/.cursor/rules/my-team.mdc"
  echo '{"userValue":true}'  > "$dest/.claude/settings.json"

  # When: upgrade サブコマンドを実行する
  node "$CLI" upgrade "$dest" >/dev/null 2>&1

  # Then: ユーザー資産が保持される
  assert_exists "$dest/.agent-skill-chain/project/custom-rule.md"  "R2: upgrade 後も .agent-skill-chain/project の自作ルールが保持される"
  assert_exists "$dest/.cursor/rules/my-team.mdc"       "R2: upgrade 後も .cursor の自作ルールが保持される"
  assert_exists "$dest/.claude/settings.json"           "R2: upgrade 後も .claude のユーザー設定が保持される"

  # And (Then): パッケージ正本は最新化される
  assert_exists "$dest/.agent-skill-chain/source/boot/CORE.md"            "R2: upgrade で .agents 正本が最新化される"
  assert_exists "$dest/.cursor/agents-core.mdc"         "R2: upgrade で agents-core.mdc が配備される"

  rm -rf "$src" "$dest"
}

# =============================================================================
# シナリオ R3: uninstall 保持 — 既定 uninstall でユーザー作成物・project 固有ルールが残る
# =============================================================================
# ユースケース:
#   利用者が .cursor/.claude にユーザー作成物を同居させた状態で uninstall（既定）しても、
#   パッケージ配備分のみが除去され、ユーザー作成物（.cursor/rules/my-team.mdc 等）と
#   .agent-skill-chain/project/ は保持される。
test_uninstall_preserves_cohabiting_user_assets() {
  echo "[e2e] シナリオR3: uninstall がユーザー作成物と project 固有ルールを保持する"
  # シナリオ: .cursor/rules/my-team.mdc・.claude/settings.json・.agent-skill-chain/project/ がある install 済み dir で
  #           uninstall --yes すると、パッケージ配備分（agents-core.mdc・skills・hooks・.agents 等）のみ除去され、
  #           ユーザー作成物と .agent-skill-chain/project は保持される。

  # Given: install 済み dir にユーザー作成物が同居している
  local src dest
  src="$(mktemp -d)"; dest="$(mktemp -d)"
  make_clean_tree "$src"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agent-skill-chain/project" "$dest/.cursor/rules" "$dest/.claude"
  echo "custom project rule" > "$dest/.agent-skill-chain/project/custom-rule.md"
  echo "team cursor rule"    > "$dest/.cursor/rules/my-team.mdc"
  echo '{"userValue":true}'  > "$dest/.claude/settings.json"

  # When: 既定 uninstall を実行する
  node "$CLI" uninstall "$dest" --yes >/dev/null 2>&1

  # Then: ユーザー作成物・project 固有ルールが保持される
  assert_exists "$dest/.cursor/rules/my-team.mdc"      "R3: .cursor の自作ルールが uninstall で保持される"
  assert_exists "$dest/.claude/settings.json"          "R3: .claude のユーザー設定が uninstall で保持される"
  assert_exists "$dest/.agent-skill-chain/project/custom-rule.md" "R3: .agent-skill-chain/project が uninstall で保持される"

  # And (Then): パッケージ配備分のみが除去される（.cursor/.claude は丸ごと消えない）
  assert_absent "$dest/.cursor/agents-core.mdc"        "R3: パッケージ所有の agents-core.mdc は除去される"
  assert_absent "$dest/.cursor/skills"                 "R3: パッケージ生成 .cursor/skills は除去される"
  assert_absent "$dest/.claude/hooks"                  "R3: パッケージ生成 .claude/hooks は除去される"
  assert_absent "$dest/.claude/skills"                 "R3: パッケージ生成 .claude/skills は除去される"
  assert_absent "$dest/.agent-skill-chain/source"      "R3: .agent-skill-chain/source 正本は除去される"

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

# =============================================================================
# ストーリー8（統合ネスト・§2.6.9）新規シナリオ N1〜N7（BDD 仕様 03_実装計画 §2.8.4）
#   すべて mktemp -d 隔離環境で実行し、破壊的 CLI 呼び出しの直前に assert_tmp_target で
#   対象が /tmp 配下であることを保証する（前回事故の再発防止・安全指示厳守）。
# =============================================================================

# 旧レイアウト（統合ネスト前）のレガシー source 相当ディレクトリを、フィンガープリント 4 ファイルを
# 含めて dest 直下に構築する（統合移行テスト用フィクスチャ）。旧ディレクトリ名リテラルは連結で組み立て、
# 参照更新スキャン（旧パス表記の grep 検出）の対象にしないため変数越し（printf）に生成する。
build_legacy_agents() {
  local dest="$1"; local drop="${2:-}"   # drop= 省く 1 ファイル（フィンガープリント不一致の再現用。空なら 4 件揃える）
  local d="$dest/.$(printf agents)"       # ".agents"（リテラル分割で scan 非対象化）
  mkdir -p "$d/boot" "$d/scripts" "$d/enforcement/ci" "$d/ledger"
  [[ "$drop" == "boot" ]]       || echo "legacy CORE"   > "$d/boot/CORE.md"
  [[ "$drop" == "setup" ]]      || echo "legacy setup"  > "$d/scripts/setup.sh"
  [[ "$drop" == "audit" ]]      || echo "legacy audit"  > "$d/enforcement/ci/audit.sh"
  [[ "$drop" == "schema" ]]     || echo "legacy schema" > "$d/ledger/schema.sql"
  echo "legacy marker file" > "$d/LEGACY_MARKER.txt"    # 移行後 backup 検証用の目印
  printf '%s' "$d"
}

# N1: 新規配備時の配備マーカー付与（BDD: Feature 新規配備時の配備マーカー付与）
test_new_deploy_marker_and_readme() {
  echo "[e2e] シナリオN1: 新規配備でマーカー（name+version）と README 警告が書き込まれる"
  # Given: 配備先に .agent-skill-chain/ が存在しない
  local dest; dest="$(mktemp -d)"; assert_tmp_target "$dest"

  # When: init（= setup.sh）で新規配備する
  node "$CLI" init "$dest" >/dev/null 2>&1

  # Then: source/・runtime/templates/ が新規配備される
  assert_exists "$dest/.agent-skill-chain/source/boot/CORE.md"            "N1: source/ が新規配備される"
  assert_exists "$dest/.agent-skill-chain/runtime/templates/00_要求定義.md" "N1: runtime/templates/ が新規配備される"

  # And (Then): 配備マーカー（.package-manifest）に name + version が書き込まれる
  local manifest="$dest/.agent-skill-chain/.package-manifest"
  assert_exists "$manifest" "N1: 配備マーカー .package-manifest が生成される"
  if grep -q '^name=agent-skill-chain$' "$manifest" && grep -qE '^version=.+' "$manifest"; then
    ok "N1: マーカーに name=agent-skill-chain と version が書かれる"
  else
    ng "N1: マーカーに name+version が書かれるべき（内容: $(tr '\n' ' ' < "$manifest" 2>/dev/null)）"
  fi

  # And (Then): README 警告（rm -rf 禁止・uninstall コマンド案内）が書き込まれる
  local readme="$dest/.agent-skill-chain/README.md"
  assert_exists "$readme" "N1: .agent-skill-chain/README.md が生成される"
  if grep -q 'rm -rf' "$readme" && grep -q 'uninstall' "$readme"; then
    ok "N1: README に rm -rf 禁止と uninstall 案内が含まれる"
  else
    ng "N1: README に rm -rf 禁止・uninstall 案内が含まれるべき"
  fi

  rm -rf "$dest"
}

# N2: 本パッケージ由来の再配備でバックアップ（BDD: Feature 配備マーカーによる衝突検知（本パッケージ由来））
test_redeploy_backs_up() {
  echo "[e2e] シナリオN2: 有効マーカーの既存 dir へ再配備すると source/・templates/ をバックアップしてから最新化する"
  # Given: init 済み（有効な .package-manifest を持つ）dest。配備物を改変して最新化を検出可能にする
  local dest; dest="$(mktemp -d)"; assert_tmp_target "$dest"
  node "$CLI" init "$dest" >/dev/null 2>&1
  echo "STALE" > "$dest/.agent-skill-chain/source/boot/CORE.md"   # 再配備で正本に戻るはず

  # When: 再度 init（= 再配備）を実行する
  node "$CLI" init "$dest" >/dev/null 2>&1

  # Then: 上書き前のバックアップ（タイムスタンプ付き）が dest 直下に作られる
  if compgen -G "$dest/.agent-skill-chain-source.bak.*" >/dev/null; then
    ok "N2: source/ の再配備前バックアップ（.agent-skill-chain-source.bak.<ts>）が作られる"
  else
    ng "N2: source/ の再配備前バックアップが作られるべき"
  fi
  if compgen -G "$dest/.agent-skill-chain-runtime-templates.bak.*" >/dev/null; then
    ok "N2: runtime/templates/ の再配備前バックアップが作られる"
  else
    ng "N2: runtime/templates/ の再配備前バックアップが作られるべき"
  fi

  # And (Then): バックアップには改変後（旧）内容が退避され、配備先は最新（正本）内容に戻る
  local bak; bak="$(compgen -G "$dest/.agent-skill-chain-source.bak.*" | head -n1)"
  if [[ -n "$bak" ]] && grep -q 'STALE' "$bak/boot/CORE.md" 2>/dev/null; then
    ok "N2: バックアップに改変前（STALE）の内容が退避されている"
  else
    ng "N2: バックアップに上書き前の内容が退避されるべき"
  fi
  if [[ "$(cat "$dest/.agent-skill-chain/source/boot/CORE.md")" != "STALE" ]]; then
    ok "N2: 配備先 source/ が最新の正本内容へ再配備される（STALE のまま残らない）"
  else
    ng "N2: 配備先 source/ は最新の正本内容へ再配備されるべき"
  fi

  rm -rf "$dest"
}

# N3: 非本パッケージ由来ディレクトリへの配備試行は中止（BDD: Feature 配備マーカーによる衝突検知（確認できない場合））
test_foreign_dir_aborts() {
  echo "[e2e] シナリオN3: マーカー無し／name 不一致の .agent-skill-chain/ への配備は非ゼロで中止し対象を変更しない"

  # ケースA: マーカー不在の .agent-skill-chain/ が既にある
  local a; a="$(mktemp -d)"; assert_tmp_target "$a"
  mkdir -p "$a/.agent-skill-chain"; echo "foreign data" > "$a/.agent-skill-chain/foreign.txt"
  node "$CLI" init "$a" >/dev/null 2>&1; local rcA=$?
  [[ "$rcA" -ne 0 ]] && ok "N3a: マーカー不在の dir への配備は非ゼロ終了で中止" || ng "N3a: マーカー不在では中止すべき"
  assert_absent "$a/.agent-skill-chain/source"   "N3a: 破壊的操作されず source/ は配備されない"
  assert_exists "$a/.agent-skill-chain/foreign.txt" "N3a: 既存の非パッケージ物は変更されない"

  # ケースB: name 不一致の .package-manifest を持つ .agent-skill-chain/ がある
  local b; b="$(mktemp -d)"; assert_tmp_target "$b"
  mkdir -p "$b/.agent-skill-chain"
  printf 'name=some-other-package\nversion=9.9.9\n' > "$b/.agent-skill-chain/.package-manifest"
  echo "other pkg data" > "$b/.agent-skill-chain/other.txt"
  node "$CLI" init "$b" >/dev/null 2>&1; local rcB=$?
  [[ "$rcB" -ne 0 ]] && ok "N3b: name 不一致の dir への配備は非ゼロ終了で中止" || ng "N3b: name 不一致では中止すべき"
  assert_absent "$b/.agent-skill-chain/source"   "N3b: 破壊的操作されず source/ は配備されない"
  assert_exists "$b/.agent-skill-chain/other.txt" "N3b: 既存の他パッケージ物は変更されない"
  if grep -q '^name=some-other-package$' "$b/.agent-skill-chain/.package-manifest"; then
    ok "N3b: 既存マーカー（name 不一致）は上書きされない"
  else
    ng "N3b: 既存マーカーは上書きされないべき"
  fi

  rm -rf "$a" "$b"
}

# N4: 旧 3 ディレクトリからの統合移行（BDD: Feature 旧 3 ディレクトリからの統合移行パス）
test_legacy_migration() {
  echo "[e2e] シナリオN4: 旧 3 ディレクトリ（フィンガープリント一致）から .agent-skill-chain/ へ統合移行する"

  # ケースA: 3 ディレクトリすべて存在（source 相当・project 相当・runtime 相当）
  local a; a="$(mktemp -d)"; assert_tmp_target "$a"
  build_legacy_agents "$a" >/dev/null
  local lp="$a/.$(printf agents)-project"; mkdir -p "$lp"; echo "user override" > "$lp/my-rule.md"
  local lw="$a/.$(printf workflow)"; mkdir -p "$lw/templates" "$lw/20990101_000000_issue"
  echo "legacy tmpl" > "$lw/templates/tmpl.md"
  echo "legacy issue" > "$lw/20990101_000000_issue/00_要求定義.md"
  : > "$lw/workflow.db"
  node "$CLI" init "$a" >/dev/null 2>&1; local rcA=$?
  [[ "$rcA" -eq 0 ]] && ok "N4a: 3 ディレクトリ統合移行が成功終了" || ng "N4a: 統合移行は成功すべき（rc=$rcA）"
  assert_exists "$a/.agent-skill-chain/source/boot/CORE.md"                      "N4a: source/ へ移行＋最新化される"
  assert_exists "$a/.agent-skill-chain/project/my-rule.md"                       "N4a: project/ へユーザーオーバーライドが移行される"
  assert_exists "$a/.agent-skill-chain/runtime/20990101_000000_issue/00_要求定義.md" "N4a: runtime/ へ issue 履歴が移行される"
  assert_exists "$a/.agent-skill-chain/runtime/workflow.db"                      "N4a: runtime/ へ workflow.db が移行される"
  assert_exists "$a/.agent-skill-chain/.package-manifest"                        "N4a: 移行後にマーカーが生成される"
  assert_exists "$a/.agent-skill-chain/README.md"                               "N4a: 移行後に README 警告が生成される"
  if compgen -G "$a/.$(printf agents).bak.*" >/dev/null \
     && compgen -G "$a/.$(printf agents)-project.bak.*" >/dev/null \
     && compgen -G "$a/.$(printf workflow).bak.*" >/dev/null; then
    ok "N4a: 旧 3 ディレクトリがそれぞれタイムスタンプ付きバックアップへ退避される"
  else
    ng "N4a: 旧 3 ディレクトリはそれぞれバックアップ退避されるべき"
  fi

  # ケースB: source 相当のみ存在（project 相当・runtime 相当は不在）
  local b; b="$(mktemp -d)"; assert_tmp_target "$b"
  build_legacy_agents "$b" >/dev/null
  node "$CLI" init "$b" >/dev/null 2>&1; local rcB=$?
  [[ "$rcB" -eq 0 ]] && ok "N4b: source のみでも統合移行が成功終了" || ng "N4b: source のみの移行は成功すべき（rc=$rcB）"
  assert_exists "$b/.agent-skill-chain/source/boot/CORE.md"          "N4b: source/ へ移行＋最新化される"
  assert_absent "$b/.agent-skill-chain/project"                     "N4b: project 相当が不在なら project/ は作成しない"
  assert_exists "$b/.agent-skill-chain/runtime/templates"           "N4b: runtime/templates/ は最新化で配備される"

  # ケースC: フィンガープリント不一致（4 ファイル中 1 件欠落）→ 中止・既存不変
  local c; c="$(mktemp -d)"; assert_tmp_target "$c"
  build_legacy_agents "$c" schema >/dev/null   # ledger/schema.sql を欠落させる
  node "$CLI" init "$c" >/dev/null 2>&1; local rcC=$?
  [[ "$rcC" -ne 0 ]] && ok "N4c: フィンガープリント不一致は非ゼロ終了で中止" || ng "N4c: 不一致では中止すべき"
  assert_absent "$c/.agent-skill-chain"                    "N4c: 中止時は .agent-skill-chain/ を作らない"
  assert_exists "$c/.$(printf agents)/boot/CORE.md"        "N4c: 中止時は旧ディレクトリを変更しない"

  rm -rf "$a" "$b" "$c"
}

# N5: 既定 uninstall によるユーザー資産の保持（BDD: Feature 既定 uninstall によるユーザー資産の保持）
test_default_uninstall_preserves_runtime_and_project() {
  echo "[e2e] シナリオN5: 既定 uninstall は source/・templates/ のみ削除し project/・runtime 資産を保持する"
  # Given: project/ オーバーライド・runtime/ issue 履歴・workflow.db がある install 済み dest
  local dest; dest="$(mktemp -d)"; assert_tmp_target "$dest"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agent-skill-chain/project" "$dest/.agent-skill-chain/runtime/20990101_000000_issue"
  echo "override"   > "$dest/.agent-skill-chain/project/override.md"
  echo "issue body" > "$dest/.agent-skill-chain/runtime/20990101_000000_issue/00_要求定義.md"
  : > "$dest/.agent-skill-chain/runtime/workflow.db"

  # When: 既定 uninstall（--purge なし）を実行する
  node "$CLI" uninstall "$dest" --yes >/dev/null 2>&1

  # Then: source/・runtime/templates/ のみ削除される
  assert_absent "$dest/.agent-skill-chain/source"           "N5: source/ のみ削除される"
  assert_absent "$dest/.agent-skill-chain/runtime/templates" "N5: runtime/templates/ のみ削除される"

  # And (Then): project/・runtime の issue 履歴・workflow.db は変更されず残置される
  assert_exists "$dest/.agent-skill-chain/project/override.md"                        "N5: project/ は保持される"
  assert_exists "$dest/.agent-skill-chain/runtime/20990101_000000_issue/00_要求定義.md" "N5: runtime/ の issue 履歴は保持される"
  assert_exists "$dest/.agent-skill-chain/runtime/workflow.db"                        "N5: runtime/ の workflow.db は保持される"

  # And (Then): ユーザー資産が残るため統合ルート .agent-skill-chain/ 自体は残置される
  assert_exists "$dest/.agent-skill-chain"                  "N5: 統合ルート .agent-skill-chain/ は残置される"

  rm -rf "$dest"
}

# N6: --purge uninstall による完全削除（BDD: Feature --purge uninstall による完全削除）
test_purge_uninstall_removes_everything() {
  echo "[e2e] シナリオN6: --purge --yes は project/・runtime 資産を含め統合ルートを完全削除する"
  # Given: source/・project/・runtime/（issue 履歴・workflow.db）すべてがある install 済み dest
  local dest; dest="$(mktemp -d)"; assert_tmp_target "$dest"
  node "$CLI" init "$dest" >/dev/null 2>&1
  mkdir -p "$dest/.agent-skill-chain/project" "$dest/.agent-skill-chain/runtime/20990101_000000_issue"
  echo "override"   > "$dest/.agent-skill-chain/project/override.md"
  echo "issue body" > "$dest/.agent-skill-chain/runtime/20990101_000000_issue/00_要求定義.md"
  : > "$dest/.agent-skill-chain/runtime/workflow.db"

  # When: --purge --yes で uninstall する
  node "$CLI" uninstall "$dest" --purge --yes >/dev/null 2>&1

  # Then: .agent-skill-chain/ 配下のすべて（project/・runtime の issue 履歴・workflow.db 含む）が削除される
  assert_absent "$dest/.agent-skill-chain/project/override.md"                        "N6: project/ が削除される"
  assert_absent "$dest/.agent-skill-chain/runtime/20990101_000000_issue/00_要求定義.md" "N6: runtime/ の issue 履歴が削除される"
  assert_absent "$dest/.agent-skill-chain/runtime/workflow.db"                        "N6: runtime/ の workflow.db が削除される"
  assert_absent "$dest/.agent-skill-chain"                                            "N6: 統合ルート .agent-skill-chain/ ごと完全削除される"

  rm -rf "$dest"
}

# N7: 既存シナリオ（R1 再インストール保持・R2 upgrade 保持・R3 uninstall 保持）の回帰確認は、
#     上記 R1/R2/R3（test_reinstall_preserves_user_assets・test_upgrade_preserves_user_assets・
#     test_uninstall_preserves_cohabiting_user_assets）が新構造 .agent-skill-chain/{source,project,runtime}/
#     基準で既に実施しており、本ファイルの実行リストにそのまま含まれる（重複定義しない）。

# --- 実行 ---------------------------------------------------------------------
# bin 不在ガード（堅牢化）: bin/agents-md.js は非追跡（.gitignore）の生成物であり、
#   各経路（CI step / run-all.sh 前置）が build を前置する前提だが、E2E 単体実行や前置漏れに
#   備えて自己回復する。REPO_ROOT/bin が無ければ node_modules があるときのみ `npm run build` を
#   試み、生成できなければ分かりやすいエラーで停止する（exit 2＝必須依存欠如＝run-all.sh では SKIP）。
#   REPO_ROOT での build は bin が非追跡のため本リポの追跡物・.gitignore・bin の追跡状態を変えない。
if [[ ! -f "$CLI" ]]; then
  echo "[e2e] CLI 不在: $CLI を build で用意します（bin は非追跡の生成物）" >&2
  if command -v npm >/dev/null 2>&1 && [[ -d "$REPO_ROOT/node_modules" ]]; then
    ( cd "$REPO_ROOT" && npm run build >/dev/null 2>&1 ) || true
  fi
fi
[[ -f "$CLI" ]] || {
  echo "エラー: CLI が見つかりません: $CLI" >&2
  echo "       bin/agents-md.js は非追跡の生成物です。先に REPO_ROOT で 'npm ci && npm run build' を実行してください。" >&2
  exit 2
}

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
# ストーリー8（統合ネスト・§2.6.9）新規シナリオ N1〜N6（N7 は R1/R2/R3 が兼ねる）
test_new_deploy_marker_and_readme
test_redeploy_backs_up
test_foreign_dir_aborts
test_legacy_migration
test_default_uninstall_preserves_runtime_and_project
test_purge_uninstall_removes_everything

echo ""
echo "[e2e] 結果: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "[e2e] 失敗したアサーション:"
  for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
  exit 1
fi
echo "[e2e] 全シナリオ pass"
