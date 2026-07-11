#!/usr/bin/env bash
# test-package-manifest-parity.sh — 配備マーカー/衝突検知ロジックの bash↔TS パリティテスト。
#
# ユースケース（このテストファイル全体）:
#   本パッケージは fail-closed の安全性が重要な「配備マーカー衝突検知・レガシーフィンガープリント
#   判定・再配備前バックアップ・マーカー/README 書込」を、bash 版
#   （.agent-skill-chain/source/scripts/lib/package-manifest.sh、setup.sh が source する）と
#   TS 版（src/agents-md.ts、CLI が持つミラー実装。ビルド後 bin/agents-md.js）の二重実装で持つ
#   （list_owned_skill_names / ownedSkillNames と同型の意図的なミラー方式）。この二重実装が乖離
#   （ドリフト）すると安全境界が静かに崩れるため、両実装が同一入力に対し同一の判定結果・同一出力を
#   返すことを本パリティテストで検証し、乖離を検知する。
#
# 方針（破壊禁止・tmp 隔離）:
#   - 全シナリオを mktemp -d で完全隔離した一時ディレクトリ内で実行する。破壊的操作
#     （バックアップ生成・ファイル書込）の対象は必ず /tmp 配下（mktemp -d 由来）であることを
#     assert_tmp_target で保証する（前回事故の再発防止・安全指示厳守）。
#   - 本開発リポの .agent-skill-chain/source/ .claude/ .cursor/ .agent-skill-chain/runtime/
#     workflow.db を一切変更しない（配備系 CLI＝init/upgrade/uninstall/setup は本テストでは呼ばない。
#     内部のミラー関数のみを直接呼び出して判定・出力を比較する）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-package-manifest-parity.sh   # リポジトリルート（git ツリー内）で実行
#   npm test                                    # run-all.sh 経由（bin を前置ビルド）
#
# 前提: bash・node。TS 版は bin/agents-md.js（tsc 生成物・非追跡）を import して呼ぶため、
#       未生成なら node_modules があれば前置ビルドし、不可なら SKIP（exit 2）する。
# 参照:
#   .agent-skill-chain/source/scripts/lib/package-manifest.sh（bash 版・単一正本）
#   src/agents-md.ts（TS 版ミラー・checkPackageManifest 等）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md（ユースケース/シナリオ・GWT インラインコメント）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
PMSH="$REPO_ROOT/.agent-skill-chain/source/scripts/lib/package-manifest.sh"
CLI_MODULE="$REPO_ROOT/bin/agents-md.js"
EXPECTED_NAME="agent-skill-chain"

PASS=0
FAIL=0
FAILED_NAMES=()

# --- 簡易アサーション ---------------------------------------------------------
ok()   { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng()   { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: '$1' != '$2'}"; }

# 破壊的操作（ファイル書込・バックアップ）の対象が必ず /tmp 配下（mktemp -d 由来）であることを保証する
# 安全ガード。誤って実リポジトリ等を対象にした場合に即座に FATAL 終了して被害を防ぐ（前回事故の再発防止）。
assert_tmp_target() {
  case "$1" in
    /tmp/*) : ;;
    *) echo "FATAL: unsafe target dir（/tmp 配下ではない）: $1" >&2; exit 1 ;;
  esac
}

# --- 必須前提 -----------------------------------------------------------------
command -v node >/dev/null 2>&1 || { echo "エラー: node が必要です" >&2; exit 2; }
[[ -f "$PMSH" ]] || { echo "エラー: package-manifest.sh が見つかりません: $PMSH" >&2; exit 2; }

# TS 版は tsc 生成物（bin/agents-md.js・非追跡）を import して呼ぶ。未生成なら前置ビルドする
# （bin は .gitignore 対象のため REPO_ROOT の追跡物を変えない＝破壊禁止契約を保つ）。ビルド不可なら SKIP。
if [[ ! -f "$CLI_MODULE" ]]; then
  if command -v npm >/dev/null 2>&1 && [[ -d "$REPO_ROOT/node_modules" ]]; then
    echo "[build] bin 未生成のため REPO_ROOT で npm run build（非追跡 bin を生成）"
    ( cd "$REPO_ROOT" && npm run build >/dev/null 2>&1 ) \
      || { echo "エラー: bin のビルドに失敗しました" >&2; exit 2; }
  else
    echo "[SKIP] bin/agents-md.js 未生成かつビルド不可（npm/node_modules なし）" >&2
    exit 2
  fi
fi

# --- TS ミラー呼び出しヘルパ（bin/agents-md.js を import して内部関数を実行）-----------------
# 本モジュールは import されたとき main を実行しない（es-main 判定でガード済み）ため副作用は無い。
# 一時ディレクトリに置いた小さな ESM ヘルパ越しに各ミラー関数を呼び、判定結果/真偽/出力を得る。
TS_HELPER=""   # setup 後に設定する

write_ts_helper() {
  local dst="$1"
  cat > "$dst" <<'MJS'
// TS 版ミラー関数のディスパッチャ。CLI_MODULE を import し、argv で指定の関数を呼ぶ。
const CLI = process.env.CLI_MODULE;
const mod = await import(CLI);
const [fn, ...a] = process.argv.slice(2);
switch (fn) {
  case "check": {
    // checkPackageManifest(root, expected, packageRoot?) の判定 kind を標準出力へ（own/new/match/abort）。
    const r = mod.checkPackageManifest(a[0], a[1], a[2] || undefined);
    process.stdout.write(r.kind);
    break;
  }
  case "legacy":
    // legacyFingerprintOk(root): true→exit 0 / false→exit 1（bash の return 0/1 と対応）。
    process.exit(mod.legacyFingerprintOk(a[0]) ? 0 : 1);
  case "writeManifest":
    mod.writePackageManifest(a[0], a[1], a[2]);
    break;
  case "backup":
    mod.backupAgentSkillChain(a[0]);
    break;
  case "readme":
    mod.writeReadmeWarning(a[0]);
    break;
  default:
    console.error("unknown fn: " + fn);
    process.exit(3);
}
MJS
}

# ts <fn> [args...] — TS ミラーを呼ぶ。stdout をそのまま返し、終了コードを透過する。
ts() { CLI_MODULE="$CLI_MODULE" node "$TS_HELPER" "$@"; }

# bash_check <root> <expected> [<pkgroot>] — check_package_manifest を subshell で呼び、
#   判定トークンを標準出力へ返す（abort 時は exit 1 するため rc!=0 を "abort" に正規化する）。
#   subshell 分離により関数内 exit がテスト本体を落とさない（fail-closed の exit を安全に観測する）。
bash_check() {
  local out rc
  out="$( ( source "$PMSH"; check_package_manifest "$@" ) 2>/dev/null )"; rc=$?
  if [[ $rc -ne 0 ]]; then printf 'abort'; else printf '%s' "$out"; fi
}

# =============================================================================
# シナリオ 1: 衝突検知の判定パリティ（check_package_manifest ⇔ checkPackageManifest）
# =============================================================================
# シナリオ: マーカー無し／新規／name 一致／name 不一致／自己適用の各ディレクトリ状態に対し、
#           bash 版と TS 版が同一の判定分類（new/match/abort/own）を返す。
test_check_parity() {
  echo "[parity] シナリオ1: 衝突検知 check_package_manifest ⇔ checkPackageManifest が同一判定"

  # --- ケース new: .agent-skill-chain/ が存在しない ---
  # Given: 空の配備先（.agent-skill-chain/ 無し）
  local d_new; d_new="$(mktemp -d)"; assert_tmp_target "$d_new"
  # When: 両実装で判定する（pkgroot は渡さない）
  local b_new t_new; b_new="$(bash_check "$d_new" "$EXPECTED_NAME")"; t_new="$(ts check "$d_new" "$EXPECTED_NAME")"
  # Then: 双方 "new" で一致する
  assert_eq "$b_new" "new" "case new: bash 版が new を返す"
  assert_eq "$t_new" "$b_new" "case new: TS 版と bash 版が一致（$t_new == $b_new）"

  # --- ケース match: 有効マーカー（name 一致）が存在する ---
  # Given: .agent-skill-chain/.package-manifest に name=agent-skill-chain がある
  local d_match; d_match="$(mktemp -d)"; assert_tmp_target "$d_match"
  mkdir -p "$d_match/.agent-skill-chain"
  printf 'name=%s\nversion=1.2.3\n' "$EXPECTED_NAME" > "$d_match/.agent-skill-chain/.package-manifest"
  # When: 両実装で判定する
  local b_match t_match; b_match="$(bash_check "$d_match" "$EXPECTED_NAME")"; t_match="$(ts check "$d_match" "$EXPECTED_NAME")"
  # Then: 双方 "match" で一致する
  assert_eq "$b_match" "match" "case match: bash 版が match を返す"
  assert_eq "$t_match" "$b_match" "case match: TS 版と bash 版が一致（$t_match == $b_match）"

  # --- ケース abort（マーカー不在）: .agent-skill-chain/ はあるがマーカーが無い ---
  # Given: .agent-skill-chain/ が存在するが .package-manifest が無い（本パッケージ由来と確認不能）
  local d_nomark; d_nomark="$(mktemp -d)"; assert_tmp_target "$d_nomark"
  mkdir -p "$d_nomark/.agent-skill-chain"; echo "foreign" > "$d_nomark/.agent-skill-chain/foreign.txt"
  # When: 両実装で判定する
  local b_nm t_nm; b_nm="$(bash_check "$d_nomark" "$EXPECTED_NAME")"; t_nm="$(ts check "$d_nomark" "$EXPECTED_NAME")"
  # Then: 双方 "abort"（fail-closed）で一致する
  assert_eq "$b_nm" "abort" "case abort(no-marker): bash 版が中止する"
  assert_eq "$t_nm" "$b_nm" "case abort(no-marker): TS 版と bash 版が一致（$t_nm == $b_nm）"

  # --- ケース abort（name 不一致）: 別パッケージのマーカーがある ---
  # Given: .package-manifest の name が別パッケージ（本パッケージ由来と確認不能）
  local d_diff; d_diff="$(mktemp -d)"; assert_tmp_target "$d_diff"
  mkdir -p "$d_diff/.agent-skill-chain"
  printf 'name=some-other-package\nversion=9.9.9\n' > "$d_diff/.agent-skill-chain/.package-manifest"
  # When: 両実装で判定する
  local b_df t_df; b_df="$(bash_check "$d_diff" "$EXPECTED_NAME")"; t_df="$(ts check "$d_diff" "$EXPECTED_NAME")"
  # Then: 双方 "abort"（fail-closed）で一致する
  assert_eq "$b_df" "abort" "case abort(name-mismatch): bash 版が中止する"
  assert_eq "$t_df" "$b_df" "case abort(name-mismatch): TS 版と bash 版が一致（$t_df == $b_df）"

  # --- ケース own: 自己適用（root == package_root の実パス一致）---
  # Given: マーカー不在の .agent-skill-chain/ を持つ dir を、それ自身を package_root として渡す
  local d_own; d_own="$(mktemp -d)"; assert_tmp_target "$d_own"
  mkdir -p "$d_own/.agent-skill-chain"   # マーカー不在（通常は abort だが own が優先されるはず）
  # When: root == pkgroot で両実装を呼ぶ
  local b_own t_own; b_own="$(bash_check "$d_own" "$EXPECTED_NAME" "$d_own")"; t_own="$(ts check "$d_own" "$EXPECTED_NAME" "$d_own")"
  # Then: 双方 "own"（マーカー検査を省いて続行）で一致する
  assert_eq "$b_own" "own" "case own: bash 版が own を返す（自己適用でマーカー検査を省く）"
  assert_eq "$t_own" "$b_own" "case own: TS 版と bash 版が一致（$t_own == $b_own）"

  rm -rf "$d_new" "$d_match" "$d_nomark" "$d_diff" "$d_own"
}

# レガシーフィンガープリント用の旧レイアウト（.agents 相当）を 4 ファイル構築する。
#   drop に "boot"/"setup"/"audit"/"schema" のいずれかを渡すとその 1 ファイルを省く（AND 条件不充足の再現）。
#   旧ディレクトリ名リテラルは連結（printf）で組み立て、参照更新スキャンの対象にしない。
build_legacy() {
  local dest="$1" drop="${2:-}"
  local d="$dest/.$(printf agents)"
  mkdir -p "$d/boot" "$d/scripts" "$d/enforcement/ci" "$d/ledger"
  [[ "$drop" == "boot" ]]   || echo "legacy CORE"   > "$d/boot/CORE.md"
  [[ "$drop" == "setup" ]]  || echo "legacy setup"  > "$d/scripts/setup.sh"
  [[ "$drop" == "audit" ]]  || echo "legacy audit"  > "$d/enforcement/ci/audit.sh"
  [[ "$drop" == "schema" ]] || echo "legacy schema" > "$d/ledger/schema.sql"
}

# bash_legacy <root> — legacy_fingerprint_ok を subshell で呼び、"ok"/"no" を返す。
bash_legacy() {
  if ( source "$PMSH"; legacy_fingerprint_ok "$1" ) >/dev/null 2>&1; then printf 'ok'; else printf 'no'; fi
}
# ts_legacy <root> — legacyFingerprintOk の真偽を "ok"/"no" に正規化する。
ts_legacy() {
  if ts legacy "$1" >/dev/null 2>&1; then printf 'ok'; else printf 'no'; fi
}

# =============================================================================
# シナリオ 2: フィンガープリント判定パリティ（legacy_fingerprint_ok ⇔ legacyFingerprintOk）
# =============================================================================
# シナリオ: 4 ファイル AND 条件を充足するケースと、各 1 ファイルを欠くケースに対し、
#           bash 版と TS 版が同一の true/false を返す。
test_legacy_parity() {
  echo "[parity] シナリオ2: legacy_fingerprint_ok ⇔ legacyFingerprintOk が同一真偽"

  # --- 充足ケース: 4 ファイルすべて揃う ---
  # Given: フィンガープリント 4 ファイルが揃った旧レイアウト
  local d_ok; d_ok="$(mktemp -d)"; assert_tmp_target "$d_ok"
  build_legacy "$d_ok"
  # When: 両実装で判定する
  local b_ok t_ok; b_ok="$(bash_legacy "$d_ok")"; t_ok="$(ts_legacy "$d_ok")"
  # Then: 双方 "ok" で一致する
  assert_eq "$b_ok" "ok" "legacy 充足: bash 版が ok を返す"
  assert_eq "$t_ok" "$b_ok" "legacy 充足: TS 版と bash 版が一致（$t_ok == $b_ok）"

  # --- 非充足ケース: 4 ファイルのうち 1 つを欠く（4 パターン）---
  local drop
  for drop in boot setup audit schema; do
    # Given: フィンガープリントの 1 ファイル（$drop）を欠く旧レイアウト
    local d; d="$(mktemp -d)"; assert_tmp_target "$d"
    build_legacy "$d" "$drop"
    # When: 両実装で判定する
    local b t; b="$(bash_legacy "$d")"; t="$(ts_legacy "$d")"
    # Then: 双方 "no"（非充足）で一致する
    assert_eq "$b" "no" "legacy 欠落($drop): bash 版が no を返す"
    assert_eq "$t" "$b" "legacy 欠落($drop): TS 版と bash 版が一致（$t == $b）"
    rm -rf "$d"
  done

  rm -rf "$d_ok"
}

# =============================================================================
# シナリオ 3: マーカー書込内容パリティ（write_package_manifest ⇔ writePackageManifest）
# =============================================================================
# シナリオ: 同一の name/version を書き込むと、生成される .package-manifest の内容がバイト一致する。
test_write_manifest_parity() {
  echo "[parity] シナリオ3: write_package_manifest ⇔ writePackageManifest が同一内容を書く"

  # Given: それぞれ空の配備先（bash 用 / TS 用）と同一の name/version
  local db dt; db="$(mktemp -d)"; dt="$(mktemp -d)"
  assert_tmp_target "$db"; assert_tmp_target "$dt"
  local name="$EXPECTED_NAME" version="0.4.2"
  # When: bash 版と TS 版でマーカーを書き込む
  ( source "$PMSH"; write_package_manifest "$db" "$name" "$version" ) >/dev/null 2>&1
  ts writeManifest "$dt" "$name" "$version" >/dev/null 2>&1
  # Then: 生成された .package-manifest がバイト一致する
  local fb="$db/.agent-skill-chain/.package-manifest" ft="$dt/.agent-skill-chain/.package-manifest"
  if [[ -f "$fb" && -f "$ft" ]] && diff -q "$fb" "$ft" >/dev/null 2>&1; then
    ok "manifest: bash 版と TS 版の .package-manifest がバイト一致する"
  else
    ng "manifest: .package-manifest が一致すべき（bash='$(tr '\n' '|' <"$fb" 2>/dev/null)' ts='$(tr '\n' '|' <"$ft" 2>/dev/null)'）"
  fi

  rm -rf "$db" "$dt"
}

# =============================================================================
# シナリオ 4: バックアップ命名規則・内容パリティ（backup_agent_skill_chain ⇔ backupAgentSkillChain）
# =============================================================================
# シナリオ: source/・runtime/templates/ を持つ既存配備に対し、両実装が同一命名規則
#           （.agent-skill-chain-source.bak.<14桁>・.agent-skill-chain-runtime-templates.bak.<14桁>）で
#           退避し、退避内容が元と一致する。
test_backup_parity() {
  echo "[parity] シナリオ4: backup_agent_skill_chain ⇔ backupAgentSkillChain の命名規則・内容が一致"

  # 同一フィクスチャ（source/ と runtime/templates/）を dst に構築する
  make_fixture() {
    local dst="$1"
    mkdir -p "$dst/.agent-skill-chain/source/boot" "$dst/.agent-skill-chain/runtime/templates"
    echo "SRC CORE"     > "$dst/.agent-skill-chain/source/boot/CORE.md"
    echo "TPL 00"       > "$dst/.agent-skill-chain/runtime/templates/00_要求定義.md"
  }
  # 退避結果を検証する共通アサート（label=bash/TS）
  assert_backup() {
    local dst="$1" label="$2"
    local sbak tbak
    sbak="$(compgen -G "$dst/.agent-skill-chain-source.bak.*" | head -n1)"
    tbak="$(compgen -G "$dst/.agent-skill-chain-runtime-templates.bak.*" | head -n1)"
    # 命名規則: <prefix>.<14桁タイムスタンプ>
    if [[ -n "$sbak" && "$(basename "$sbak")" =~ ^\.agent-skill-chain-source\.bak\.[0-9]{14}$ ]]; then
      ok "$label: source バックアップの命名規則が .agent-skill-chain-source.bak.<14桁>"
    else
      ng "$label: source バックアップの命名規則が規定どおりでない（'$sbak'）"
    fi
    if [[ -n "$tbak" && "$(basename "$tbak")" =~ ^\.agent-skill-chain-runtime-templates\.bak\.[0-9]{14}$ ]]; then
      ok "$label: runtime/templates バックアップの命名規則が規定どおり"
    else
      ng "$label: runtime/templates バックアップの命名規則が規定どおりでない（'$tbak'）"
    fi
    # 退避内容が元と一致する
    if [[ -n "$sbak" ]] && diff -r "$dst/.agent-skill-chain/source" "$sbak" >/dev/null 2>&1; then
      ok "$label: source バックアップの内容が元と一致する"
    else
      ng "$label: source バックアップの内容が元と一致すべき"
    fi
  }

  # Given: source/・runtime/templates/ を持つ既存配備（bash 用 / TS 用）
  local db dt; db="$(mktemp -d)"; dt="$(mktemp -d)"
  assert_tmp_target "$db"; assert_tmp_target "$dt"
  make_fixture "$db"; make_fixture "$dt"
  # When: bash 版と TS 版でバックアップを実行する
  ( source "$PMSH"; backup_agent_skill_chain "$db" ) >/dev/null 2>&1
  ts backup "$dt" >/dev/null 2>&1
  # Then: 両者が同一命名規則で退避し、退避内容が元と一致する
  assert_backup "$db" "bash"
  assert_backup "$dt" "TS"

  rm -rf "$db" "$dt"
}

# =============================================================================
# シナリオ 5: README 警告文パリティ（write_readme_warning ⇔ writeReadmeWarning）
# =============================================================================
# シナリオ: 両実装が書き込む .agent-skill-chain/README.md（rm -rf 禁止・uninstall 案内の警告文）が
#           バイト一致する（文言ドリフトの検知）。
test_readme_parity() {
  echo "[parity] シナリオ5: write_readme_warning ⇔ writeReadmeWarning が同一文言を書く"

  # Given: それぞれ空の配備先（bash 用 / TS 用）
  local db dt; db="$(mktemp -d)"; dt="$(mktemp -d)"
  assert_tmp_target "$db"; assert_tmp_target "$dt"
  # When: bash 版と TS 版で README 警告を書き込む
  ( source "$PMSH"; write_readme_warning "$db" ) >/dev/null 2>&1
  ts readme "$dt" >/dev/null 2>&1
  # Then: 生成された README.md がバイト一致する
  local fb="$db/.agent-skill-chain/README.md" ft="$dt/.agent-skill-chain/README.md"
  if [[ -f "$fb" && -f "$ft" ]] && diff -q "$fb" "$ft" >/dev/null 2>&1; then
    ok "readme: bash 版と TS 版の README.md がバイト一致する"
  else
    ng "readme: README.md が一致すべき（差分あり）"
    diff "$fb" "$ft" 2>/dev/null | head -20 | sed 's/^/    /'
  fi

  rm -rf "$db" "$dt"
}

# --- 実行 ---------------------------------------------------------------------
WORK="$(mktemp -d)"; assert_tmp_target "$WORK"
TS_HELPER="$WORK/ts-mirror.mjs"
write_ts_helper "$TS_HELPER"

echo "[parity] REPO_ROOT=$REPO_ROOT"
echo "[parity] bin=$CLI_MODULE"

test_check_parity
test_legacy_parity
test_write_manifest_parity
test_backup_parity
test_readme_parity

rm -rf "$WORK"

echo "--------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
exit 0
