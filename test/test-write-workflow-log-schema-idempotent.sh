#!/usr/bin/env bash
# test-write-workflow-log-schema-idempotent.sh — write-workflow-log.sh のスキーマ移行 ADD COLUMN
# 冪等性是正（ensure_column ヘルパー導入）の回帰テスト。
#
# ユースケース（このテストファイル全体）:
#   スキーマ移行検知ブロック（document_id/issue_id/review_id/document_path の ADD COLUMN）が
#   Check-Then-Act の非アトミック性により `duplicate column name` で失敗しても、
#   ensure_column の try-then-recheck（ALTER 失敗後に PRAGMA table_info を再確認）で冪等に
#   収束し、INSERT まで到達することを保証する。
#   (i) 既存カラムは fast-path で skip し ALTER を試行しない（T-1）、
#   (ii) 不足カラムは通常追加経路で 1 回で成功する（T-2）、
#   (iii) 並列実行＋flock 無効化で ADD COLUMN 競合を発火させても recovery で全 exit 0（T-3）、
#   (iv) 真に書込不可な場合は exit≠0 で fail-fast し INSERT が実行されない（T-4）、
#   (v) 4 カラム不在の旧スキーマからの初回移行は 4 カラム＋インデックスが作成され INSERT が成功する（T-5）、
#   (vi) 本リポの本番 workflow.db を一切変更・破壊しない（T-6）、ことを保証する。
#
# 方針（破壊禁止・tmp 隔離 必須）:
#   - 全シナリオを mktemp -d の一時 DB／クリーン環境で実行する（.agent-skill-chain/project/自己拡張ワークフロー.md §テストの tmp 隔離）。
#   - 本開発リポの .agent-skill-chain/runtime/workflow.db を一切読み書き・変更しない（PROJECT_ROOT を一時ディレクトリに向ける）。
#   - write-workflow-log.sh は read のみ（一時 DB に対して呼び出すのみ・無改造）。
#   - 各シナリオは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-write-workflow-log-schema-idempotent.sh   # リポジトリルートで実行
#
# 前提: bash・sqlite3。
# 参照:
#   docs/maintainer/workflow/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/20260712_004218_write-workflow-logスキーマ移行冪等性是正/
#     00_要求定義.md・01_要件定義.md・02_設計.md・03_実装計画.md（T-1〜T-6）
#   .agent-skill-chain/source/scripts/write-workflow-log.sh（ensure_column・スキーマ移行検知ブロック）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md
#   test/test-write-workflow-log-ts-utc.sh（隔離・BDD 記法・本番 DB 非破壊の型）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"   # test/ -> repo root（配置非依存）
WWL="$REPO_ROOT/.agent-skill-chain/source/scripts/write-workflow-log.sh"
SCHEMA="$REPO_ROOT/.agent-skill-chain/source/ledger/schema.sql"

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: '$1' != '$2'}"; }

command -v sqlite3 >/dev/null 2>&1 || { echo "エラー: sqlite3 が必要です" >&2; exit 2; }
[[ -f "$WWL" && -f "$SCHEMA" ]] || { echo "エラー: 対象スクリプト/スキーマが見つかりません" >&2; exit 2; }

# 新スキーマ（entry_id あり）の workflow_log テーブルを最小構成で作る共通ヘルパー。
# extra_cols に "document_id" "issue_id" 等を渡すと、それらのカラムも最初から存在させる
# （= その分は fast-path skip 対象になる）。
create_new_schema_table() {
  local db="$1"; shift
  local extra_sql=""
  local c
  for c in "$@"; do
    extra_sql="${extra_sql}, ${c} TEXT NULL"
  done
  sqlite3 "$db" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, ts_utc TEXT NOT NULL, created_at TEXT NOT NULL, actor_role TEXT NOT NULL, delegated_by_role TEXT NOT NULL, command TEXT NOT NULL, issue_path TEXT NULL, review_path TEXT NULL, changed_files_json TEXT NULL, summary TEXT NOT NULL, dod_met INTEGER NOT NULL, prev_hash TEXT NULL, entry_hash TEXT NOT NULL${extra_sql});"
}

echo "== 本番 DB 非破壊の事前計測 =="
BEFORE_DB="$REPO_ROOT/.agent-skill-chain/runtime/workflow.db"
before_rows="$(sqlite3 "$BEFORE_DB" 'SELECT COUNT(*) FROM workflow_log;' 2>/dev/null || echo NA)"
before_mtime="$(stat -c %Y "$BEFORE_DB" 2>/dev/null || echo NA)"

# --- T-1: 既存カラム skip（fast-path・単一プロセスで決定的） -------------------
echo "== T-1: 対象カラムが既存の状態で移行ブロックを通過する（fast-path skip） =="
# シナリオ: 移行対象 4 カラムがすべて存在する（＝移行済みの）workflow.db に対しては、
#           ensure_column は fast-path で return 0 し ALTER を試行せず、スクリプトは exit 1 せず
#           INSERT まで到達する。review_id カラムは 1 つだけのまま。
t1_skip_existing_column() {
  # Given: 移行済み(全カラム存在)の隔離 DB を用意する（fast-path skip 経路を通す）
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.agent-skill-chain/runtime/workflow.db"; mkdir -p "$(dirname "$DB")"
  sqlite3 "$DB" < "$SCHEMA"                                  # 新スキーマ正本(4 カラム込み)を流す＝全カラム存在

  # When: write-workflow-log.sh を呼び、移行ブロックを通過させる（各 ensure_column は fast-path skip）
  local rc=0
  PROJECT_ROOT="$TMP" AGENT_ROLE=scribe \
    DOCUMENT_ID="11111111-1111-1111-1111-111111111111" \
    DOCUMENT_PATH=".agent-skill-chain/runtime/x/02_設計.md" \
    "$WWL" design-feature "skip 経路テスト" 1 "2026-07-12T00:00:00Z" >/dev/null 2>&1 || rc=$?

  # Then: exit 0 で INSERT まで到達し、review_id カラムは 1 つだけ（ALTER は試行されない）
  assert_eq "$rc" "0" "T-1 既存カラムでも exit 0（skip）"
  local col_cnt
  col_cnt="$(sqlite3 -separator $'\t' "$DB" "PRAGMA table_info(workflow_log);" | awk -F '\t' '$2=="review_id"' | wc -l)"
  assert_eq "$col_cnt" "1" "T-1 review_id カラムは 1 つだけ"
  rm -rf "$TMP"
}
t1_skip_existing_column

# --- T-2: 不足カラムの通常追加経路（単一プロセスで決定的） ---------------------
echo "== T-2: 対象カラムが不足する状態での通常追加経路（recovery 分岐に入らない） =="
# シナリオ: document_id/issue_id/review_id は既存だが document_path のみ不足する DB に対しては、
#           ensure_column の ALTER が 1 回で成功し return 0（recovery 分岐には入らない）。
#           document_path カラム＋対応インデックスが 1 つずつ作成される。
t2_add_missing_column() {
  # Given: document_path のみ不足する新スキーマ(entry_id あり)の隔離 DB を用意する
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.agent-skill-chain/runtime/workflow.db"; mkdir -p "$(dirname "$DB")"
  create_new_schema_table "$DB" document_id issue_id review_id

  # When: write-workflow-log.sh を実行し、不足する document_path を追加させる
  local rc=0
  PROJECT_ROOT="$TMP" AGENT_ROLE=scribe \
    DOCUMENT_ID="66666666-6666-6666-6666-666666666666" \
    DOCUMENT_PATH=".agent-skill-chain/runtime/x/02_設計.md" \
    "$WWL" design-feature "通常追加経路テスト" 1 "2026-07-12T00:00:00Z" >/dev/null 2>&1 || rc=$?

  # Then: exit 0 で、document_path カラム＋インデックスが 1 つずつ作成される
  assert_eq "$rc" "0" "T-2 不足カラムの通常追加は exit 0"
  local col_cnt idx_cnt
  col_cnt="$(sqlite3 -separator $'\t' "$DB" "PRAGMA table_info(workflow_log);" | awk -F '\t' '$2=="document_path"' | wc -l)"
  assert_eq "$col_cnt" "1" "T-2 document_path カラムが 1 つ作成される"
  idx_cnt="$(sqlite3 "$DB" "PRAGMA index_list(workflow_log);" | grep -c "idx_workflow_log_document_path" || true)"
  assert_eq "$idx_cnt" "1" "T-2 idx_workflow_log_document_path インデックスが 1 つ作成される"
  rm -rf "$TMP"
}
t2_add_missing_column

# --- T-3: 競合 recovery の実行時再現（並列＋flock 無効化） --------------------
echo "== T-3: 並列実行＋flock 無効化による ADD COLUMN 競合 recovery の再現 =="
# シナリオ: 新規作成された旧スキーマの workflow.db に対し、flock を無効化した状態で
#           同一のセットアップ INSERT を N 並列 × M ラウンドで実行し ADD COLUMN 競合を発火させる。
#           recovery（ALTER 失敗→table_info 再確認→存在すれば return 0）により、
#           すべての呼び出しが exit 0 となり duplicate column name による失敗は 0 件、
#           workflow.db には総投入件数と一致する記録が過不足なく残る。
t3_parallel_recovery() {
  # Given: no-op の flock シムを PATH 先頭に置き、移行ブロックの直列化を無効化する（競合窓を開く）
  #   ※ 実バイナリは温存しつつ flock だけ無効化できるため PATH 全体の張り替えより堅牢。
  #   あわせて sqlite3 に `.timeout` を強制する薄いシムも置く。sqlite3 CLI は接続ごとに
  #   busy_timeout=0（既定）であり、flock 無効化下で真の同時 ALTER が起きると「database is
  #   locked」で即失敗し、本 issue のスコープ外（移行ブロック以外の既存 PRAGMA/INSERT 経路）
  #   をノイズとして拾ってしまう。`.timeout` はドットコマンドで PRAGMA と異なり結果行を
  #   返さない（`PRAGMA busy_timeout=N;` は値を stdout に返してしまい呼び出し側の SQL 結果を
  #   汚染するため不採用）。これにより ALTER 実行順が真に競合しても待機後に「一方が成功・
  #   他方が duplicate column name」という本来のレースへ収束させ、ensure_column の recovery
  #   分岐（try-then-recheck）を実行時に確実に発火させられる（実測: 本シムありで document_id
  #   等 4 カラム全てで recovery 分岐のヒットを計測済み）。
  local SHIM; SHIM="$(mktemp -d)"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$SHIM/flock"; chmod +x "$SHIM/flock"
  local real_sqlite3; real_sqlite3="$(command -v sqlite3)"
  cat > "$SHIM/sqlite3" <<SQLITE3SHIM
#!/usr/bin/env bash
exec "$real_sqlite3" -cmd ".timeout 8000" "\$@"
SQLITE3SHIM
  chmod +x "$SHIM/sqlite3"
  local fail=0
  # When: M ラウンド × N 並列で同一セットアップ INSERT を実行する
  local round
  for round in 1 2 3 4 5; do
    local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.agent-skill-chain/runtime/workflow.db"; mkdir -p "$(dirname "$DB")"
    sqlite3 "$DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, ts_utc TEXT NOT NULL, created_at TEXT NOT NULL, actor_role TEXT NOT NULL, delegated_by_role TEXT NOT NULL, command TEXT NOT NULL, issue_path TEXT NULL, review_path TEXT NULL, changed_files_json TEXT NULL, summary TEXT NOT NULL, dod_met INTEGER NOT NULL, prev_hash TEXT NULL, entry_hash TEXT NOT NULL);"
    local pids=(); local errf="$TMP/err"; mkdir -p "$errf"
    local i
    for i in $(seq 1 12); do                 # N=12 並列
      ( PATH="$SHIM:$PATH" PROJECT_ROOT="$TMP" AGENT_ROLE=scribe \
          DOCUMENT_ID="$(printf '3333333%d-3333-3333-3333-3333333333%02d' "$round" "$i")" \
          DOCUMENT_PATH=".agent-skill-chain/runtime/x/02_設計_${round}_${i}.md" \
          "$WWL" design-feature "並列 $round-$i" 1 "2026-07-12T00:00:00Z" 2>"$errf/$i" 1>/dev/null ) &
      pids+=($!)
    done
    local pid
    for pid in "${pids[@]}"; do wait "$pid" || fail=1; done   # いずれか非0なら fail
    grep -rqi "duplicate column" "$errf" && fail=1            # duplicate 失敗は 0 件であること
    local cnt
    cnt="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM workflow_log;')"
    assert_eq "$cnt" "12" "T-3 ラウンド $round は 12 件記録"
    rm -rf "$TMP"
  done
  # Then: 全 exit 0・duplicate 0 件（フィックス版では競合が発火しても recovery で吸収）
  assert_eq "$fail" "0" "T-3 並列反復で失敗・duplicate なし"
  rm -rf "$SHIM"
}
t3_parallel_recovery

# --- T-4: 真のエラー fail-fast（書込不可 DB） ---------------------------------
echo "== T-4: 書込不可な DB で fail-fast する（exit≠0・INSERT 未実行・行数不変） =="
# シナリオ: 対象カラムが存在しない旧スキーマの workflow.db が読み取り専用（書き込み不可）のとき、
#           write-workflow-log.sh は exit≠0 で停止し INSERT 処理は実行されない（行数不変）。
#           ※ 実測（sqlite3 3.45.1）では読み取り専用 DB は移行ブロック手前の
#              PRAGMA journal_mode=WAL（290 行目付近）で先に停止するため、
#              ensure_column の "マイグレーションに失敗しました。" 分岐の実行時再現は要求しない
#              （当該分岐の妥当性はコードレビューで担保。02_設計 §6.2・03 §2.1.3 参照）。
t4_readonly_db_failfast() {
  # Given: 対象カラム無しの旧スキーマ DB を読み取り専用にする
  local TMP; TMP="$(mktemp -d)"; local WFDIR="$TMP/.agent-skill-chain/runtime"; mkdir -p "$WFDIR"; local DB="$WFDIR/workflow.db"
  sqlite3 "$DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, ts_utc TEXT NOT NULL, created_at TEXT NOT NULL, actor_role TEXT NOT NULL, delegated_by_role TEXT NOT NULL, command TEXT NOT NULL, issue_path TEXT NULL, review_path TEXT NULL, changed_files_json TEXT NULL, summary TEXT NOT NULL, dod_met INTEGER NOT NULL, prev_hash TEXT NULL, entry_hash TEXT NOT NULL);"
  local before; before="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM workflow_log;')"
  chmod 444 "$DB"                            # DB ファイルを読み取り専用に（書込を失敗させる）

  # When: 実行する
  local rc=0
  if [[ "$(id -u)" == "0" ]]; then
    # root 実行では chmod 444 の書込制限が効かないため、この環境依存ケースは SKIP 扱いで記録する
    ok "T-4 SKIP: root 実行のため chmod 444 が効かず fail-fast 検証を割愛"
    rm -rf "$TMP"
    return 0
  fi
  PROJECT_ROOT="$TMP" AGENT_ROLE=scribe \
    DOCUMENT_ID="44444444-4444-4444-4444-444444444444" \
    DOCUMENT_PATH=".agent-skill-chain/runtime/x/02_設計.md" \
    "$WWL" design-feature "真のエラーテスト" 1 "2026-07-12T00:00:00Z" >/dev/null 2>&1 || rc=$?
  chmod 644 "$DB"                            # 後片付けのため権限を戻す
  local after; after="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM workflow_log;')"

  # Then: exit≠0 で停止し、行数不変（INSERT 未実行）
  [[ "$rc" -ne 0 ]] && ok "T-4 書込不可は fail-fast（exit≠0）" || ng "T-4 fail-fast しなかった（rc=$rc）"
  assert_eq "$after" "$before" "T-4 行数不変（INSERT 未実行）"
  rm -rf "$TMP"
}
t4_readonly_db_failfast

# --- T-5: 正常系初回移行（4 カラム不在の旧スキーマから移行・無回帰） ----------
echo "== T-5: 4 カラムが存在しない旧スキーマから初回移行する =="
# シナリオ: document_id / issue_id / review_id / document_path がいずれも存在しない旧スキーマの
#           workflow.db に対して write-workflow-log.sh を実行すると、4 カラムがすべて追加され
#           対応インデックスが作成され、後続の INSERT が exit 0 で成功する
#           （移行後スキーマは 4 カラム＋4 インデックスで改修前後不変）。
t5_initial_migration() {
  # Given: 4 カラムが無い旧スキーマ(entry_id あり・移行対象カラム無し)の隔離 DB を用意する
  local TMP; TMP="$(mktemp -d)"; local DB="$TMP/.agent-skill-chain/runtime/workflow.db"; mkdir -p "$(dirname "$DB")"
  create_new_schema_table "$DB"

  # When: write-workflow-log.sh を実行し移行→INSERT させる
  local rc=0
  PROJECT_ROOT="$TMP" AGENT_ROLE=scribe \
    DOCUMENT_ID="22222222-2222-2222-2222-222222222222" \
    DOCUMENT_PATH=".agent-skill-chain/runtime/x/02_設計.md" \
    "$WWL" design-feature "初回移行テスト" 1 "2026-07-12T00:00:00Z" >/dev/null 2>&1 || rc=$?

  # Then: exit 0 で 4 カラム＋各インデックスが存在し 1 行 INSERT される
  assert_eq "$rc" "0" "T-5 初回移行は exit 0"
  local c
  for c in document_id issue_id review_id document_path; do
    local has idx
    has="$(sqlite3 -separator $'\t' "$DB" "PRAGMA table_info(workflow_log);" | awk -F '\t' -v c="$c" '$2==c' | wc -l)"
    assert_eq "$has" "1" "T-5 カラム $c が存在"
    idx="$(sqlite3 "$DB" "PRAGMA index_list(workflow_log);" | grep -c "idx_workflow_log_$c" || true)"
    assert_eq "$idx" "1" "T-5 インデックス idx_workflow_log_$c が存在"
  done
  assert_eq "$(sqlite3 "$DB" 'SELECT COUNT(*) FROM workflow_log;')" "1" "T-5 1 行 INSERT される"
  rm -rf "$TMP"
}
t5_initial_migration

# --- T-6: 本番 DB 非破壊の検証 ------------------------------------------------
echo "== 本番 DB 非破壊の事後検証 =="
# シナリオ: 全テスト実行後も本リポの .agent-skill-chain/runtime/workflow.db が変化しない（tmp 隔離の自己検証）。
after_rows="$(sqlite3 "$BEFORE_DB" 'SELECT COUNT(*) FROM workflow_log;' 2>/dev/null || echo NA)"
after_mtime="$(stat -c %Y "$BEFORE_DB" 2>/dev/null || echo NA)"
assert_eq "$after_rows" "$before_rows" "T-6 本番 DB の行数が不変（before=$before_rows after=$after_rows）"
assert_eq "$after_mtime" "$before_mtime" "T-6 本番 DB の mtime が不変"

# --- 集計 -------------------------------------------------------------------
echo ""
echo "== 結果: PASS=$PASS FAIL=$FAIL =="
if [[ "$FAIL" -ne 0 ]]; then
  printf '  失敗: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
exit 0
