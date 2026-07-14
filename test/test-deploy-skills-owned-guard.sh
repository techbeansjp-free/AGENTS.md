#!/usr/bin/env bash
# test-deploy-skills-owned-guard.sh — スキル配備の由来判定・衝突ガードの単体テスト。
#
# ユースケース（このテストファイル全体）:
#   .agent-skill-chain/source/scripts/lib/deploy-skills.sh の由来判定（is_owned_skill_dir）・
#   所有エントリ列挙（list_owned_skill_entries / list_owned_skill_names）・単一エントリ配備＋
#   マーカー書込み（deploy_skills_impl）・選択的同期の衝突ガード（sync_skills_selective）が、
#   「パッケージ配備物のみを削除・上書きし、同名のユーザー自作スキルは保持する」契約
#   （02_設計 ADR-1・03_実装計画 T1/T2）を満たすことを検証する。
#
# 方針（破壊禁止・tmp 隔離）:
#   - 全シナリオを mktemp -d で完全隔離した一時ディレクトリ内で実行する。
#   - 本開発リポの .agent-skill-chain/source/・.claude/・.cursor/・.agent-skill-chain/runtime/ を
#     一切変更しない（対象パスは必ず /tmp 配下であることを assert_tmp_target で保証する）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-deploy-skills-owned-guard.sh   # リポジトリルート（git ツリー内）で実行
#   npm test                                       # run-all.sh 経由
#
# 前提: bash のみ（正本 lib を source して関数を直呼びする。tmp 隔離フィクスチャで検証）。
# 参照:
#   .agent-skill-chain/source/scripts/lib/deploy-skills.sh（単一正本）
#   docs/maintainer/workflow/close/20260714_185358_npmアップデートで無関係スキル消失/02_設計.md（ADR-1・§6）
#   docs/maintainer/workflow/close/20260714_185358_npmアップデートで無関係スキル消失/03_実装計画.md（T1・T2）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
LIB_SH="$REPO_ROOT/.agent-skill-chain/source/scripts/lib/deploy-skills.sh"

PASS=0
FAIL=0
FAILED_NAMES=()

# --- 簡易アサーション ---------------------------------------------------------
ok()   { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng()   { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq()     { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: '$1' != '$2'}"; }
assert_exists() { [[ -e "$1" ]] && ok "${2:-存在: $1}" || ng "${2:-存在すべき: $1}"; }
assert_absent() { [[ ! -e "$1" ]] && ok "${2:-不在: $1}" || ng "${2:-不在すべき: $1}"; }

# 破壊的操作の対象が必ず /tmp 配下（mktemp -d 由来）であることを保証する安全ガード。
# 誤って実リポジトリ等を対象にした場合に即座に FATAL 終了して被害を防ぐ（前回事故の再発防止）。
assert_tmp_target() {
  case "$1" in
    /tmp/*) : ;;
    *) echo "FATAL: unsafe target dir（/tmp 配下ではない）: $1" >&2; exit 1 ;;
  esac
}

# --- 必須前提 -----------------------------------------------------------------
[[ -f "$LIB_SH" ]] || { echo "エラー: deploy-skills.sh が見つかりません: $LIB_SH" >&2; exit 2; }

# shellcheck source=../.agent-skill-chain/source/scripts/lib/deploy-skills.sh
. "$LIB_SH"

echo "[test-deploy-skills-owned-guard] REPO_ROOT=$REPO_ROOT"

# 正本 skills ツリーを模した最小フィクスチャを $1 に構築する。
#   - agent/SKILL.md              … ドメイン直下（所有名 agent・frontmatter name: run-command）
#   - architecture/define-boundaries/SKILL.md … capability（所有名 architecture__define-boundaries）
build_fixture_src() {
  local src="$1"
  mkdir -p "$src/agent" "$src/architecture/define-boundaries"
  printf -- '---\nname: run-command\n---\nsrc body\n'       > "$src/agent/SKILL.md"
  printf -- '---\nname: define-boundaries\n---\nsrc body\n' > "$src/architecture/define-boundaries/SKILL.md"
}

# =============================================================================
# シナリオ 1: 由来判定 is_owned_skill_dir が 4 区分を正しく返す
# =============================================================================
test_is_owned_skill_dir_verdicts() {
  echo "[unit] シナリオ1: is_owned_skill_dir が absent/owned/legacy_owned/collision を正しく返す"
  # シナリオ: 配備先 agent ディレクトリの状態に応じて由来 4 区分が判定される。
  local tmp; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  local src="$tmp/src"; build_fixture_src "$src"
  local dest="$tmp/dest"; mkdir -p "$dest"
  local skmd="$src/agent/SKILL.md"

  # Given/When/Then: 配備先が不在 → absent
  assert_eq "$(is_owned_skill_dir "$dest/agent" "$skmd")" "absent" "不在 → absent"

  # Given: マーカー無し・name 不一致（自作スキル）
  mkdir -p "$dest/agent"; printf -- '---\nname: my-totally-unrelated-skill\n---\n' > "$dest/agent/SKILL.md"
  # When/Then: collision（保持側）
  assert_eq "$(is_owned_skill_dir "$dest/agent" "$skmd")" "collision" "name 不一致 → collision"

  # Given: マーカー無し・name が配備ディレクトリ名と同値だが正本 name（run-command）とは不一致
  printf -- '---\nname: agent\n---\n' > "$dest/agent/SKILL.md"
  # When/Then: ディレクトリ名の偶然一致では誤削除しない（正本 frontmatter name と比較） → collision
  assert_eq "$(is_owned_skill_dir "$dest/agent" "$skmd")" "collision" "ディレクトリ名の偶然一致 → collision（保護性質）"

  # Given: マーカー無し・name が正本と二重一致（受容済み残余リスク r1）
  printf -- '---\nname: run-command\n---\n' > "$dest/agent/SKILL.md"
  # When/Then: legacy_owned（backfill 対象）
  assert_eq "$(is_owned_skill_dir "$dest/agent" "$skmd")" "legacy_owned" "正本 name 一致 → legacy_owned"

  # Given: 所有マーカーを付与
  : > "$dest/agent/$ASC_SKILL_OWNED_MARKER"
  # When/Then: owned（高速パス）
  assert_eq "$(is_owned_skill_dir "$dest/agent" "$skmd")" "owned" "マーカー有り → owned"

  # Given: SKILL.md 無し（マーカーも無し）
  rm -rf "$dest/agent"; mkdir -p "$dest/agent"
  # When/Then: 判定不能は破壊しない側 → collision
  assert_eq "$(is_owned_skill_dir "$dest/agent" "$skmd")" "collision" "SKILL.md 欠落 → collision（保持側）"

  rm -rf "$tmp"
}

# =============================================================================
# シナリオ 2: list_owned_skill_entries の第1列 == 従来の list_owned_skill_names
# =============================================================================
test_entries_first_column_matches_names() {
  echo "[unit] シナリオ2: list_owned_skill_entries の第1列が list_owned_skill_names と完全一致する"
  # シナリオ: 命名の単一正本を保つため、エントリ列挙の第1列と名前列挙が回帰なく一致する。
  local tmp; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  local src="$tmp/src"; build_fixture_src "$src"

  # When: 両者を取得する
  local names entries_col1
  names="$(list_owned_skill_names "$src")"
  entries_col1="$(list_owned_skill_entries "$src" | cut -f1)"

  # Then: 完全一致（回帰防止）
  assert_eq "$entries_col1" "$names" "第1列 == list_owned_skill_names"

  # And (Then): agent（ドメイン直下）と architecture__define-boundaries（capability）を含む
  assert_eq "$(printf '%s\n' "$names" | grep -c '^agent$')" "1" "所有名に agent を含む"
  assert_eq "$(printf '%s\n' "$names" | grep -c '^architecture__define-boundaries$')" "1" "所有名に architecture__define-boundaries を含む"

  rm -rf "$tmp"
}

# =============================================================================
# シナリオ 3: deploy_skills_impl の単一エントリ絞り込み＋マーカー書込み／2 引数の後方互換
# =============================================================================
test_deploy_impl_single_entry_and_marker() {
  echo "[unit] シナリオ3: deploy_skills_impl が単一エントリ＋マーカーを配備し、2 引数ではマーカー無し"
  # シナリオ: only_name/write_marker 指定で当該エントリのみ配備＋マーカー付与。省略時は全件・マーカー無し。
  local tmp; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  local src="$tmp/src"; build_fixture_src "$src"

  # Given: 空の配備先
  local dest="$tmp/dest"; mkdir -p "$dest"
  # When: deploy_skills_impl src dest agent 1（単一エントリ＋マーカー）
  local n; n="$(deploy_skills_impl "$src" "$dest" agent 1)"
  # Then: agent のみ配備され SKILL.md とマーカーが生成される（他エントリは触らない）
  assert_eq "$n" "1" "配備件数=1（agent のみ）"
  assert_exists "$dest/agent/SKILL.md"                    "agent/SKILL.md が配備される"
  assert_exists "$dest/agent/$ASC_SKILL_OWNED_MARKER"     "agent にマーカーが書き込まれる"
  assert_absent "$dest/architecture__define-boundaries"   "他エントリ（__）は配備されない"

  # Given: 別の空の配備先（アダプタ経路を模擬）
  local out="$tmp/out"; mkdir -p "$out"
  # When: 2 引数（従来呼び出し。build-adapters.sh 相当）
  deploy_skills_impl "$src" "$out" >/dev/null
  # Then: 全件配備されるがマーカーは書き込まれない（カプセル混入防止・後方互換）
  assert_exists "$out/agent/SKILL.md"                                  "2 引数: agent が配備される"
  assert_exists "$out/architecture__define-boundaries/SKILL.md"        "2 引数: __ エントリが配備される"
  assert_absent "$out/agent/$ASC_SKILL_OWNED_MARKER"                   "2 引数: agent にマーカーを書かない"
  assert_absent "$out/architecture__define-boundaries/$ASC_SKILL_OWNED_MARKER" "2 引数: __ にマーカーを書かない"

  rm -rf "$tmp"
}

# =============================================================================
# シナリオ 4: sync_skills_selective が同名の自作スキルを保持し警告する（upgrade 相当）
# =============================================================================
test_sync_preserves_collision() {
  echo "[unit] シナリオ4: sync_skills_selective が同名の自作 agent を保持し stderr に警告する"
  # シナリオ: マーカー無し・name 不一致の自作 agent と unrelated.txt が upgrade で保持され警告が出る。
  local tmp; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  local src="$tmp/src"; build_fixture_src "$src"
  local dest="$tmp/dest"; mkdir -p "$dest"

  # Given: 同名の自作スキル（マーカー無し・name 不一致）と付随ファイルを配置する
  mkdir -p "$dest/agent"; printf -- '---\nname: my-totally-unrelated-skill\n---\n' > "$dest/agent/SKILL.md"
  : > "$dest/agent/unrelated.txt"

  # When: 選択的同期を実行する（upgrade 相当）
  local err="$tmp/err"
  sync_skills_selective "$src" "$dest" 2> "$err"

  # Then: 自作物が保持され、マーカーは書かれず、警告が stderr に出る
  assert_exists "$dest/agent/unrelated.txt"                   "自作 unrelated.txt が保持される"
  assert_eq "$(grep -c my-totally-unrelated "$dest/agent/SKILL.md")" "1" "自作 SKILL.md が上書きされない"
  assert_absent "$dest/agent/$ASC_SKILL_OWNED_MARKER"         "非所有エントリにマーカーを書かない"
  [[ -s "$err" ]] && grep -q '警告' "$err" && ok "collision で stderr に警告が出る" || ng "collision で警告を出すべき"

  # And (Then): 別ドメインの所有エントリは通常どおり配備＋マーカー付与される（部分 fail-open）
  assert_exists "$dest/architecture__define-boundaries/SKILL.md"                    "所有 __ エントリは配備される"
  assert_exists "$dest/architecture__define-boundaries/$ASC_SKILL_OWNED_MARKER"     "所有 __ エントリにマーカーが付与される"

  rm -rf "$tmp"
}

# =============================================================================
# シナリオ 5: sync_skills_selective がレガシー所有を backfill し、所有は最新化する
# =============================================================================
test_sync_legacy_backfill_and_owned_refresh() {
  echo "[unit] シナリオ5: マーカー無し・name 一致の旧配備物を backfill し、所有は再同期で最新化する"
  # シナリオ: 旧配備物（マーカー無し・name 一致）が更新＋マーカー backfill され、以後の同期でも最新化される。
  local tmp; tmp="$(mktemp -d)"; assert_tmp_target "$tmp"
  local src="$tmp/src"; build_fixture_src "$src"
  local dest="$tmp/dest"; mkdir -p "$dest"

  # Given: マーカー無し・正本 name 一致（run-command）の旧配備物（古い本文）
  mkdir -p "$dest/agent"; printf -- '---\nname: run-command\n---\nOLD BODY\n' > "$dest/agent/SKILL.md"

  # When: 選択的同期を実行する（初回 upgrade 相当）
  sync_skills_selective "$src" "$dest" 2>/dev/null

  # Then: マーカーが backfill され、SKILL.md が正本内容へ最新化される（OLD BODY が消える）
  assert_exists "$dest/agent/$ASC_SKILL_OWNED_MARKER"                 "レガシー所有にマーカーが backfill される"
  assert_eq "$(grep -c 'OLD BODY' "$dest/agent/SKILL.md")" "0"        "SKILL.md が正本内容へ最新化される"

  # And (When/Then): 以降の同期でも所有（マーカー有）として最新化され、マーカーが維持される
  printf -- '---\nname: run-command\n---\nEDITED\n' > "$dest/agent/SKILL.md"  # in-place 改変を模擬
  sync_skills_selective "$src" "$dest" 2>/dev/null
  assert_exists "$dest/agent/$ASC_SKILL_OWNED_MARKER"          "所有エントリはマーカーを維持する"
  assert_eq "$(grep -c 'EDITED' "$dest/agent/SKILL.md")" "0"  "所有エントリは毎回削除→再配備で最新化される（stale 化しない）"

  rm -rf "$tmp"
}

# --- 実行 ---------------------------------------------------------------------
test_is_owned_skill_dir_verdicts
test_entries_first_column_matches_names
test_deploy_impl_single_entry_and_marker
test_sync_preserves_collision
test_sync_legacy_backfill_and_owned_refresh

echo "--------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
exit 0
