#!/usr/bin/env bash
# run-all.sh — テスト一括 runner（既存テストスクリプトを順に呼ぶ薄いラッパ）。
#
# ユースケース（このスクリプト全体）:
#   本リポジトリの開発者（自己拡張・ドッグフーディングを行う保守者）が、ローカルで全テストを
#   1 コマンドで実行し結果を集約して確認できるようにする。各テストの検証ロジックは再実装せず
#   （single source of truth＝各テストスクリプト）、本 runner は「列挙・必須依存の事前確認・
#   逐次呼び出し・終了コード集約・サマリ出力・全体終了コード決定」のみを担う。
#
# 方針（破壊禁止・非破壊契約）:
#   - runner は開発リポの .agent-skill-chain/source/ .claude/ .cursor/ .agent-skill-chain/runtime/ workflow.db を読み書き・変更しない。
#     tmp 隔離・破壊的操作の安全性は各テストスクリプトの責務（02 §2.1.2）。
#   - 個別テスト呼び出しは if/|| でラップし、非 0 でも runner が即終了しない（set -e 由来の中断を避ける）。
#
# 使い方:
#   bash test/run-all.sh        # リポジトリルートで実行
#   npm test                                    # 同上（package.json scripts.test に配線）
#   個別実行は従来どおり: bash test/<name>.sh
#
# 前提（依存マトリクス。正本は各スクリプト冒頭「前提」）:
#   | テスト                              | runner が事前確認する必須依存 |
#   | test-run-all.sh                     | bash のみ（runner 自体の単体/結合テスト・stub は tmp 隔離） |
#   | test-coverage-check.sh              | bash のみ（coverage-check.sh の判定/SKIP は擬似 cobertura で tmp 隔離。kcov ラップ結合は kcov 無で SKIP） |
#   | test-audit.sh                       | bash のみ（sqlite3/git はスクリプト内で任意 SKIP→PASS） |
#   | test-pretooluse-hook.sh             | bash・git・tar（jq はスクリプト内で任意系統検証） |
#   | test-write-workflow-log-prevhash.sh | bash・sqlite3 |
#   | test-write-workflow-log-multidoc.sh | bash・sqlite3 |
#   | test-write-workflow-log-glob.sh     | bash・sqlite3（to_json_array の glob 展開是正・noglob 回帰・tmp 隔離） |
#   | test-write-workflow-log-schema-idempotent.sh | bash・sqlite3（ensure_column によるスキーマ移行 ADD COLUMN の冪等性・並列 recovery 再現・tmp 隔離） |
#   | test-workflow-db-guard.sh           | bash のみ（workflow.db 由来検知の軽量警告。sqlite3 不在時は関数内で沈黙 return 0 として検証・tmp 隔離） |
#   | test-c4-bypass-resistance.sh        | bash・git・tar（C-4 パス正規化・AGENT_ROLE 出所制御の回帰・tmp 隔離） |
#   | test-package-manifest-parity.sh     | bash・node（package-manifest.sh↔agents-md.ts ミラー同期のパリティ・tmp 隔離） |
#   | test-cli-audit-doctor.sh            | bash・git・tar・node・sqlite3（C-5 audit 透過・doctor hash/integrity・tmp 隔離） |
#   | test-export-ndjson.sh               | bash・git・tar・node・sqlite3・python3（C-7 NDJSON export 検証・tmp 隔離） |
#   | e2e-claude-hook.sh                  | bash・git・tar・node・python3（C-3 settings 配線経由 hook E2E・tmp 隔離） |
#   | e2e-install-uninstall.sh            | bash・git・node・tar（sqlite3 はスクリプト内で任意 SKIP） |
#   | test-build-adapters-apm.sh          | bash・git・tar（apm 配備件数一致・決定性・.adapters/ 非改変・除外規則・gitignore・tmp 隔離） |
#   | test-sync-version-apm.sh            | bash・git・tar・node（apm.yml 3 者 version 同期・--write/--check・tmp 隔離） |
#
# I/F（02_設計 §5 の正本に従う・後続のカバレッジ issue が相乗りする）:
#   - 終了コード契約: 全テストが PASS/SKIP で FAIL=0 のとき exit 0、1 件以上 FAIL なら exit 1。
#   - 個別テストの終了コード解釈: 0→PASS / 2→SKIP（必須依存欠如の既存規約）/ その他→FAIL。
#   - SKIP は失敗扱いにしない（終了コードに影響しない）。
#   - テスト一覧の正本は本ファイルの TESTS 配列 1 箇所（追加・削除はここのみ変更）。
#   - テスト容易性: 環境変数 RUN_ALL_TESTS_OVERRIDE に "name|path|deps;..." を渡すと一覧を差し替えられる
#     （runner 自体のテスト＝test-run-all.sh が stub を tmp 隔離で並べて検証するための入口）。
# 参照:
#   docs/maintainer/workflow/20260615_054806_テスト実行基盤の整備/02_設計.md（§5 runner I/F）, 03_実装計画.md（T1）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- テスト一覧の正本（順序付き）------------------------------------------------
# 各要素は "テスト名|スクリプトパス|必須依存(空白区切り)"。
# スクリプトパスが絶対でなければ SCRIPT_DIR 基準とみなす。実行順は固定。
default_tests() {
  cat <<'EOF'
test-run-all|test-run-all.sh|bash
test-coverage-check|test-coverage-check.sh|bash
test-audit|test-audit.sh|bash
test-pretooluse-hook|test-pretooluse-hook.sh|bash git tar
test-write-workflow-log-prevhash|test-write-workflow-log-prevhash.sh|bash sqlite3
test-write-workflow-log-multidoc|test-write-workflow-log-multidoc.sh|bash sqlite3
test-write-workflow-log-glob|test-write-workflow-log-glob.sh|bash sqlite3
test-write-workflow-log-schema-idempotent|test-write-workflow-log-schema-idempotent.sh|bash sqlite3
test-workflow-db-guard|test-workflow-db-guard.sh|bash
test-c4-bypass-resistance|test-c4-bypass-resistance.sh|bash git tar
test-package-manifest-parity|test-package-manifest-parity.sh|bash node
test-cli-audit-doctor|test-cli-audit-doctor.sh|bash git tar node sqlite3
test-export-ndjson|test-export-ndjson.sh|bash git tar node sqlite3 python3
e2e-claude-hook|e2e-claude-hook.sh|bash git tar node python3
e2e-install-uninstall|e2e-install-uninstall.sh|bash git node tar
test-build-adapters-apm|test-build-adapters-apm.sh|bash git tar
test-sync-version-apm|test-sync-version-apm.sh|bash git tar node
EOF
}

# テスト一覧を行ベースで取得する。RUN_ALL_TESTS_OVERRIDE があれば ';' 区切りを改行に展開して使う
# （runner 自体のテストが stub 一覧を注入するための入口。本番運用では未設定）。
load_tests() {
  if [[ -n "${RUN_ALL_TESTS_OVERRIDE:-}" ]]; then
    printf '%s\n' "${RUN_ALL_TESTS_OVERRIDE//;/$'\n'}"
  else
    default_tests
  fi
}

# ---- 集約状態 -----------------------------------------------------------------
TOTAL=0
PASS=0
FAIL=0
SKIP=0
FAILED_NAMES=()

# 必須依存がすべて存在するか確認する。欠けている最初のツール名を返す（存在すれば空）。
missing_dep() {
  local deps="$1" dep
  for dep in $deps; do
    command -v "$dep" >/dev/null 2>&1 || { printf '%s' "$dep"; return 0; }
  done
  return 0
}

# ---- メインループ -------------------------------------------------------------
echo "== テスト一括実行 (run-all.sh) =="
while IFS='|' read -r name path deps; do
  # 空行・コメント行はスキップ
  [[ -z "${name// }" ]] && continue
  case "$name" in \#*) continue ;; esac

  TOTAL=$((TOTAL+1))

  # スクリプトパスの正規化（相対なら SCRIPT_DIR 基準）
  local_script="$path"
  case "$path" in /*) : ;; *) local_script="$SCRIPT_DIR/$path" ;; esac

  # 必須依存の事前確認（不足時は実行せず SKIP・継続）
  miss=""
  for d in $deps; do
    if ! command -v "$d" >/dev/null 2>&1; then miss="$d"; break; fi
  done
  if [[ -n "$miss" ]]; then
    echo "[SKIP] $name: 必須依存 $miss なし"
    SKIP=$((SKIP+1))
    continue
  fi

  if [[ ! -f "$local_script" ]]; then
    echo "[FAIL] $name: スクリプトが見つからない ($local_script)"
    FAIL=$((FAIL+1))
    FAILED_NAMES+=("$name")
    continue
  fi

  # E2E build 前置: e2e-install-uninstall.sh は $REPO_ROOT/bin/agents-md.js を起動するが、
  #   bin は非追跡（.gitignore）の生成物のため、E2E を呼ぶ前に REPO_ROOT で bin を用意する。
  #   bin が無い & npm/node_modules があるときのみ build（冪等・最小オーバーヘッド）。build は
  #   bin が非追跡のため REPO_ROOT の追跡物・.gitignore を変えない（破壊禁止契約を保つ）。
  #   正本: docs/maintainer/workflow/20260615_114305_bin生成物のgitignore化とpublish時ビルド/02_設計.md §3.2/§9.4
  # bin（非追跡生成物）を必要とするテスト群は、呼ぶ前に REPO_ROOT で bin を用意する（冪等・最小）。
  #   C-5/C-7/C-3 の CLI/E2E テストおよび e2e-install-uninstall は bin/agents-md.js を起動するため。
  case "$name" in
    e2e-install-uninstall|test-cli-audit-doctor|test-export-ndjson|e2e-claude-hook|test-package-manifest-parity)
      repo_root="$(cd "$SCRIPT_DIR/.." && pwd)"
      if [[ ! -f "$repo_root/bin/agents-md.js" ]] \
         && command -v npm >/dev/null 2>&1 && [[ -d "$repo_root/node_modules" ]]; then
        echo "[build] $name 前置: REPO_ROOT で npm run build（非追跡 bin を生成）"
        ( cd "$repo_root" && npm run build >/dev/null 2>&1 ) || echo "[build] 前置 build 失敗（テスト側ガードに委譲）"
      fi
      ;;
  esac

  echo "---- [RUN] $name ($path) ----"
  code=0
  bash "$local_script" || code=$?
  case "$code" in
    0)
      echo "[PASS] $name"
      PASS=$((PASS+1))
      ;;
    2)
      echo "[SKIP] $name: 必須依存欠如 (exit 2)"
      SKIP=$((SKIP+1))
      ;;
    *)
      echo "[FAIL] $name (exit $code)"
      FAIL=$((FAIL+1))
      FAILED_NAMES+=("$name")
      ;;
  esac
done < <(load_tests)

# ---- サマリと全体終了コード ---------------------------------------------------
echo "================================"
echo "合計=$TOTAL PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
exit 0
