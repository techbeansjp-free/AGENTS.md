#!/usr/bin/env bash
# package-manifest.sh — 配備マーカー(.package-manifest)の生成・検証・
#                        再配備前バックアップ・README 警告の共通ロジック（単一正本）。
#
# 責務: 統合ルート .agent-skill-chain/ の配備マーカー確認（fail-closed 衝突検知）、
#       source/・runtime/templates/ の再配備前タイムスタンプ付きバックアップ、
#       README.md 警告文の生成・最新化、旧 3 ディレクトリからの統合移行の関数を提供する。
#       setup.sh はこの 1 ファイルを source する。src/agents-md.ts は同一の判定規則・
#       警告文をミラーする（list_owned_skill_names / ownedSkillNames と同型の単一定義ミラー方式。
#       drift を避けるため、判定規則・警告文を変えるときは agents-md.ts 側も合わせて更新すること）。
#       この二重実装（bash 版 = 本ファイル / TS 版 = agents-md.ts）が同一の判定結果・同一出力を返す
#       ことは test/test-package-manifest-parity.sh がパリティテストで検証し、ドリフトを検知する。
#
# fail-closed 方針: 衝突検知は判定できない場合に必ず処理を中止する（既存 enforcement の
# fail-open 方針とは対称的に異なる。SETUP.md 参照）。

# manifest_path <root>
#   統合ルート直下の配備マーカーの絶対パスを返す。
manifest_path() {
  echo "$1/.agent-skill-chain/.package-manifest"
}

# check_package_manifest <root> <expected_name> [<package_root>]
#   判定結果を標準出力へ返す:
#     "own"   — <root> がパッケージ自身のインストール元（<package_root>）と実パス一致する
#               自己適用（PACKAGE_ROOT=PROJECT_ROOT）。マーカー検査をスキップして続行する。
#     "new"   — <root>/.agent-skill-chain/ が存在しない（新規配備）。
#     "match" — 配備マーカーが存在し name が <expected_name> と一致する（本パッケージ由来）。
#   本パッケージ由来と確認できない場合（.agent-skill-chain/ は存在するがマーカー不在、
#   または name 不一致）は、fail-closed でエラーメッセージを stderr に出し非ゼロで終了する
#   （呼び出し元で分岐する必要はない。set -e 環境でも本関数の exit がそのまま伝播する）。
#
#   自己適用（own）の根拠: 本パッケージ自身のリポジトリに対して setup を実行すると
#   （<root> と <package_root> が一致）、配備先の .agent-skill-chain/ はパッケージ正本そのもの
#   だが、配備マーカー（.package-manifest）は生成物として gitignore 対象のため存在しない。
#   この状態でマーカー不在を「本パッケージ由来と確認できない」と誤判定すると fail-closed で
#   中止してしまう。<root> と <package_root> の**実パス一致**は「配備先がパッケージ自身」で
#   あることを確実に示すため、この一致時のみマーカー検査を省いて続行する。他人の無関係な
#   ディレクトリは実パスが一致しないためこの分岐に入らず、fail-closed の境界は弱まらない。
#   本関数は agents-md.ts の checkPackageManifest のミラーであり、両者が同一の判定（own/new/match/
#   abort）を返すことを test/test-package-manifest-parity.sh が検証している。
check_package_manifest() {
  local root="$1" expected_name="$2" package_root="${3:-}"
  local dir="$root/.agent-skill-chain"
  local manifest
  manifest="$(manifest_path "$root")"

  # 自己適用（PACKAGE_ROOT=PROJECT_ROOT）判定を最優先で行う（マーカー有無より前）。
  if [[ -n "$package_root" ]]; then
    local root_real pkg_real
    root_real="$(cd "$root" 2>/dev/null && pwd -P)" || root_real=""
    pkg_real="$(cd "$package_root" 2>/dev/null && pwd -P)" || pkg_real=""
    if [[ -n "$root_real" && "$root_real" == "$pkg_real" ]]; then
      echo "own"
      return 0
    fi
  fi

  if [[ ! -d "$dir" ]]; then
    echo "new"
    return 0
  fi

  if [[ ! -f "$manifest" ]]; then
    echo "エラー: $dir は存在しますが配備マーカー（.package-manifest）が見つかりません。" >&2
    echo "        本パッケージ（$expected_name）由来と確認できないため、破壊的操作（再配備）を中止します。" >&2
    echo "        意図した配備先であれば、内容を確認のうえ手動で退避してから再実行してください。" >&2
    exit 1
  fi

  local actual_name
  actual_name="$(grep -m1 '^name=' "$manifest" | cut -d= -f2-)"
  if [[ "$actual_name" != "$expected_name" ]]; then
    echo "エラー: $manifest の name（'$actual_name'）が本パッケージ（'$expected_name'）と一致しません。" >&2
    echo "        本パッケージ由来と確認できないため、破壊的操作（再配備）を中止します。" >&2
    exit 1
  fi

  echo "match"
}

# write_package_manifest <root> <name> <version>
#   配備マーカーへ name/version を書き込む（新規配備・再配備のいずれでも呼び出す）。
#   agents-md.ts の writePackageManifest のミラー。生成される .package-manifest の内容が一致する
#   ことを test/test-package-manifest-parity.sh が検証している。
write_package_manifest() {
  local root="$1" name="$2" version="$3"
  local dir="$root/.agent-skill-chain"
  mkdir -p "$dir"
  printf 'name=%s\nversion=%s\n' "$name" "$version" > "$dir/.package-manifest"
}

# backup_agent_skill_chain <root>
#   本パッケージ由来と確認できた場合の再配備前に、source/・runtime/templates/ を
#   タイムスタンプ付きバックアップへ退避する（存在するものだけ。無ければ何もしない）。
#   バックアップ自体の書き込みに失敗した場合は上書きの前提条件を満たさないため処理を中止する
#   （バックアップの成立を上書きの前提条件とする）。
#   命名: <root>/.agent-skill-chain-source.bak.<timestamp>/ ・
#         <root>/.agent-skill-chain-runtime-templates.bak.<timestamp>/
#         （プロジェクトルート直下に統合ルートと同名衝突しないようハイフン連結で退避する）。
#   agents-md.ts の backupAgentSkillChain のミラー。退避先の命名規則と退避内容が一致することを
#   test/test-package-manifest-parity.sh が検証している。
backup_agent_skill_chain() {
  local root="$1"
  local dir="$root/.agent-skill-chain"
  local ts
  ts="$(date +%Y%m%d%H%M%S)"

  if [[ -d "$dir/source" ]]; then
    if ! cp -R "$dir/source" "$root/.agent-skill-chain-source.bak.$ts"; then
      echo "エラー: .agent-skill-chain/source/ のバックアップに失敗しました。上書きを中止します。" >&2
      exit 1
    fi
    echo "source/ をバックアップしました: $root/.agent-skill-chain-source.bak.$ts"
  fi

  if [[ -d "$dir/runtime/templates" ]]; then
    if ! cp -R "$dir/runtime/templates" "$root/.agent-skill-chain-runtime-templates.bak.$ts"; then
      echo "エラー: .agent-skill-chain/runtime/templates/ のバックアップに失敗しました。上書きを中止します。" >&2
      exit 1
    fi
    echo "runtime/templates/ をバックアップしました: $root/.agent-skill-chain-runtime-templates.bak.$ts"
  fi
}

# legacy_fingerprint_ok <root>
#   旧レイアウト（統合ネスト前のルート直下 source 相当ディレクトリ）配下に本パッケージ配備物の
#   フィンガープリント（構造的に安定した 4 ファイルの AND 条件）が揃っているかを判定する。
#   揃っていれば 0、1 つでも欠ければ 1 を返す。統合移行を安全に行える「本パッケージの旧バージョン
#   配備」であることの確認に使う。旧ディレクトリ名リテラルは連結で組み立て、参照更新スキャンの
#   対象にしない（下記 legacy_source。旧 source 名は連結で構成する）。
#   agents-md.ts の legacyFingerprintOk のミラー。同一の旧ディレクトリ状態に対し両者が同一の
#   0/1（true/false）を返すことを test/test-package-manifest-parity.sh が検証している。
legacy_fingerprint_ok() {
  local legacy_source="$1/.agents"
  [[ -f "$legacy_source/boot/CORE.md" ]] || return 1
  [[ -f "$legacy_source/scripts/setup.sh" ]] || return 1
  [[ -f "$legacy_source/enforcement/ci/audit.sh" ]] || return 1
  [[ -f "$legacy_source/ledger/schema.sql" ]] || return 1
  return 0
}

# migrate_legacy_dirs <root>
#   旧 3 ディレクトリ（統合ネスト前にルート直下へ個別配置されていた source 相当・project 相当・
#   runtime 相当）を .agent-skill-chain/{source,project,runtime}/ へ統合移行する
#   （.agent-skill-chain/ 未配備が前提）。
#   手順: (1) 存在する各旧ディレクトリを独立にタイムスタンプ付きバックアップへ退避する。
#             fail-closed: 3 つのうち 1 つでもバックアップに失敗すれば、移動を一切行わず処理を中止する
#             （部分移行による不整合を避け、原本を保護する）。
#         (2) 旧 source→source/、旧 project(存在時)→project/、旧 runtime(存在時)→runtime/ へ移動する。
#   旧ディレクトリ名リテラルは連結で組み立て、参照更新スキャンの対象にしない（下記 legacy_* 変数。
#   旧 project 名は旧 source 名 + "-project" で構成する）。
#   配備マーカー・README 生成と最新内容の再配備は呼び出し元が後続で行う（同一実行内で最新化まで完了させる）。
migrate_legacy_dirs() {
  local root="$1"
  local dir="$root/.agent-skill-chain"
  local ts
  ts="$(date +%Y%m%d%H%M%S)"

  local legacy_source="$root/.agents"
  local legacy_project="${legacy_source}-project"
  local legacy_runtime="$root/.workflow"

  if ! cp -R "$legacy_source" "${legacy_source}.bak.$ts"; then
    echo "エラー: 旧 source ディレクトリのバックアップに失敗しました。統合移行を中止します。" >&2
    exit 1
  fi
  if [[ -d "$legacy_project" ]]; then
    if ! cp -R "$legacy_project" "${legacy_project}.bak.$ts"; then
      echo "エラー: 旧 project ディレクトリのバックアップに失敗しました。統合移行を中止します。" >&2
      exit 1
    fi
  fi
  if [[ -d "$legacy_runtime" ]]; then
    if ! cp -R "$legacy_runtime" "${legacy_runtime}.bak.$ts"; then
      echo "エラー: 旧 runtime ディレクトリのバックアップに失敗しました。統合移行を中止します。" >&2
      exit 1
    fi
  fi

  mkdir -p "$dir"
  mv "$legacy_source" "$dir/source"
  echo "旧 source ディレクトリを .agent-skill-chain/source/ へ移行しました（バックアップ: ${legacy_source}.bak.$ts）。"
  if [[ -d "$legacy_project" ]]; then
    mv "$legacy_project" "$dir/project"
    echo "旧 project ディレクトリを .agent-skill-chain/project/ へ移行しました（バックアップ: ${legacy_project}.bak.$ts）。"
  fi
  if [[ -d "$legacy_runtime" ]]; then
    mv "$legacy_runtime" "$dir/runtime"
    echo "旧 runtime ディレクトリを .agent-skill-chain/runtime/ へ移行しました（バックアップ: ${legacy_runtime}.bak.$ts）。"
  fi
}

# readme_warning_text
#   .agent-skill-chain/README.md の警告文本体を標準出力へ返す（setup.sh・SETUP.md 転記の単一正本）。
readme_warning_text() {
  cat <<'EOF'
# ⚠️ このフォルダを直接 rm -rf しないでください

`.agent-skill-chain/` には、パッケージ本体（source/）だけでなく、
このプロジェクト固有の設定（project/）と監査履歴・issue 記録（runtime/）が同居しています。

- `rm -rf .agent-skill-chain/` を実行すると、プロジェクト固有の設定・監査履歴・
  issue 記録がすべて失われます。これは公式なアンインストール手順ではありません。
- 安全にアンインストールするには次のコマンドを使用してください:

    npx agent-skill-chain uninstall

  既定ではパッケージ所有物（source/ と再生成可能な runtime/templates/）のみを削除し、
  project/ と runtime/ のユーザー資産（issue 記録・監査履歴）は保持します。
  監査履歴・issue 記録も含めて完全に削除する場合は --purge --yes を指定してください。
EOF
}

# write_readme_warning <root>
#   .agent-skill-chain/README.md を上記警告文で最新化する（新規配備・再配備のいずれでも呼ぶ）。
#   agents-md.ts の writeReadmeWarning（本文は readmeWarningText）のミラー。書き込まれる
#   README 警告文ファイルの内容が一致することを test/test-package-manifest-parity.sh が検証している。
write_readme_warning() {
  local root="$1"
  local dir="$root/.agent-skill-chain"
  mkdir -p "$dir"
  readme_warning_text > "$dir/README.md"
}
