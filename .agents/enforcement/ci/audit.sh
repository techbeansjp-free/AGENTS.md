#!/usr/bin/env bash
# audit.sh — 証跡・CONTRACT 違反の検出
# 判定ルール・差し戻し先: 親ディレクトリ enforcement/README.md §失敗条件と差し戻し に従う。
# 証跡の原則: 本則は workflow.db、memo は過渡的・例外運用のみ（scribe/CONTRACT 参照）。
#
# 必須チェック:
#   (1) 必須ファイル存在
#   (2) 04_review 未更新（verify-and-close 未実行）
#   (3) テスト観点未記載
#   (4) docs 更新要否未記載
#   (5) memo プレフィックス・timestamp 乖離
#   (6) PR 内部参照禁止
#   (7) 重要パス内の TODO/FIXME 残存（下記）
#   (8) workflow.db 品質監査
#   (9) 成果物と証跡の対応
#   (10) workflow.db の WAL/SHM sidecar が Git 追跡されていないこと
#   (11) workflow.db 整合性チェック（存在する場合。PRAGMA integrity_check）
#   (12) actor_role は scribe のみ（新スキーマ時）
#   (13) delegated_by_role は必須 orchestrator（新スキーマ時）
#   (14) implement-feature に changed_files_json 必須（新スキーマ時）
#   (15) verify-and-close に review_path 必須（新スキーマ時）
#   (16) verify-and-close に parent_entry_id 必須（新スキーマ時）
#   (17) verify-and-close の親は implement-feature または design-feature（新スキーマ時）
#   (18) 04_review.md 変更時に verify-and-close ログ存在（Git 時）
#   (19) 成果物変更時に implement/design/verify ログ存在（Git 時）
#
# 失敗とみなす条件（enforcement/README と一致）:
#   1. 必須ファイル未参照（本 script では必須ファイル存在で代用）
#   2. メインが許可されないツール経路で成果物を生成した場合の扱い: 03 が存在するのに 04 が無い場合は
#      「verify-and-close 未実行」または「実装のみでレビューを飛ばした」とみなし reject（#3 で検出）。
#      メインの直接 Write/Edit は hooks でブロックする仕様であり、本 script では 04_review 未更新で事後検知する。
#   3. 04_review 未更新（実装後 verify-and-close 未実行）
#   4. テスト観点未記載（03_実装計画 に テスト観点/単体テスト/BDD の記載があるか）
#   5. docs 更新要否未記載（04_review に docs/仕様書 更新の言及があるか）
#   6. 内部参照禁止の PR テンプレ違反（PR 本文は CI 側で $PR_BODY を渡して検証可能）
#   7. 重要パスに TODO または FIXME が残っている（*.md に限定、下記で検出）
#   8. workflow.db 品質違反（許可 command 外・summary 空・ts_utc 形式異常）。sqlite3 が無い場合はスキップ。
#   9. 04_review が存在するが workflow.db に該当証跡がない。workflow.db が無い場合はスキップ。
#  10. workflow.db の WAL/SHM sidecar が Git 追跡されていないこと（追跡されていたら FAIL）。
#  11. workflow.db が存在する場合、PRAGMA integrity_check が ok であること。
#  12–17. 新スキーマ時: actor_role=scribe, delegated_by 必須 orchestrator, implement に changed_files_json, verify に review_path/parent 且つ親が implement/design。
#  18–19. Git 時: 04 変更なら verify ログ、成果物変更なら implement/design/verify のいずれかログが存在すること。
# 差し戻し先: 失敗時は 04_review に戻さず、03_実装計画.md または該当 issue ドキュメント。
#
# 以下で実施: #8 workflow.db 品質監査、#9 成果物と証跡の対応、#10 sidecar 追跡禁止、#11 DB 整合性（sqlite3 が無い環境では #8/#9/#11 はスキップ）。

set -e
PROJECT_ROOT="${1:-.}"
# Git 差分範囲。CI で PR base 等を渡す想定。例: main..HEAD または HEAD~1..HEAD
GIT_RANGE="${AUDIT_GIT_RANGE:-${2:-HEAD~1..HEAD}}"
WORKFLOW_DIR="${WORKFLOW_DIR:-.workflow}"
AGENTS_ROOT="${AGENTS_ROOT:-.agents}"
EXIT_CODE=0
ROLLBACK_MSG="ROLLBACK: Fix in 03_実装計画.md or the issue doc under .workflow/{issue}/ then re-run verify-and-close. See .agents/enforcement/README.md §失敗条件と差し戻し."

# 補助関数: タイムスタンプ文字列（YYYYMMDD_HHMMSS）を epoch 秒に変換できる場合のみ返す
ts_to_epoch() {
  local ts="$1"
  local epoch=""
  # GNU date
  if epoch="$(date -d "$ts" +%s 2>/dev/null)"; then
    printf '%s\n' "$epoch"
    return 0
  fi
  # BSD/macOS date
  if epoch="$(date -j -f "%Y%m%d_%H%M%S" "$ts" "+%s" 2>/dev/null)"; then
    printf '%s\n' "$epoch"
    return 0
  fi
  return 1
}

# 補助関数: ファイルの mtime を epoch 秒で取得（macOS/Linux 両対応）。取得できなければ 1 を返す。
file_mtime_epoch() {
  local f="$1"
  local m=""
  if m="$(stat -f %m "$f" 2>/dev/null)"; then
    printf '%s\n' "$m"
    return 0
  fi
  if m="$(stat -c %Y "$f" 2>/dev/null)"; then
    printf '%s\n' "$m"
    return 0
  fi
  return 1
}

echo "=== Audit: contract and evidence (enforcement/README §失敗条件と差し戻し) ==="

# 1. 証跡 memo のファイル名プレフィックス（YYYYMMDD_HHMMSS_）および実時間との整合性検証
if [[ -d "$PROJECT_ROOT/$WORKFLOW_DIR" ]]; then
  while IFS= read -r -d '' f; do
    base=$(basename "$f")
    parent=$(dirname "$f")
    if [[ "$parent" == *"/memo" ]] && [[ "$base" == *.md ]]; then
      if [[ ! "$base" =~ ^[0-9]{8}_[0-9]{6}_ ]]; then
        echo "FAIL: Memo file must have YYYYMMDD_HHMMSS_ prefix: $f" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
        continue
      fi

      # 1-1. 明らかなプレースホルダ（000000 等）や不自然な年の検出
      ts_date="${base:0:8}"
      ts_time="${base:9:6}"
      ts_year="${base:0:4}"

      if [[ "$ts_date" == "00000000" || "$ts_time" == "000000" ]]; then
        echo "FAIL: Memo timestamp prefix must not use placeholder values like 000000: $f" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi

      # 年が極端に過去/未来（2000〜2100 以外）の場合は違反扱い
      if [[ "$ts_year" =~ ^[0-9]{4}$ ]]; then
        year_num=$((10#$ts_year))
        if (( year_num < 2000 || year_num > 2100 )); then
          echo "FAIL: Memo timestamp year must be between 2000 and 2100 (got: $ts_year): $f" >&2
          echo "$ROLLBACK_MSG" >&2
          EXIT_CODE=1
        fi
      fi

      # 1-2. 可能であれば prefix とファイル mtime の乖離をチェック（環境差で誤判定しやすいため WARN のみ）
      if ts_epoch="$(ts_to_epoch "${ts_date}_${ts_time}")" && m_epoch="$(file_mtime_epoch "$f")"; then
        diff=$(( ts_epoch - m_epoch ))
        if (( diff > 600 )); then
          echo "WARN: Memo timestamp prefix (${ts_date}_${ts_time}) is more than 10 minutes newer than file mtime (env-dependent; not FAIL): $f" >&2
        fi
      fi
    fi
  done < <(find "$PROJECT_ROOT/$WORKFLOW_DIR" -name "*.md" -type f -print0 2>/dev/null || true)
else
  echo "SKIP: $WORKFLOW_DIR not found." >&2
fi

# 2. .agents 必須ファイルの存在
if [[ -d "$PROJECT_ROOT/$AGENTS_ROOT" ]]; then
  for rel in boot/CORE.md boot/LOAD_POLICY.md workflow/PHASES.md workflow/TEMPLATES.md; do
    if [[ ! -f "$PROJECT_ROOT/$AGENTS_ROOT/$rel" ]]; then
      echo "FAIL: Missing required file (必須ファイル未参照): $AGENTS_ROOT/$rel" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
  done
fi

# 3. 実装後 verify-and-close 未実行: workflow.db に implement-feature または verify-and-close が記録されている issue_path のディレクトリには 04_review.md が存在すること
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$PROJECT_ROOT/$WORKFLOW_DIR/workflow.db" ]]; then
  WF_DB_3="$PROJECT_ROOT/$WORKFLOW_DIR/workflow.db"
  if sqlite3 "$WF_DB_3" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then
    while IFS= read -r -d '' issue_path; do
      [[ -z "$issue_path" ]] && continue
      issue_dir="$PROJECT_ROOT/$issue_path"
      [[ ! -d "$issue_dir" ]] && continue
      if [[ ! -f "$issue_dir/04_review.md" ]]; then
        echo "FAIL: 04_review 未更新 (workflow.db に implement-feature/verify-and-close がある issue には 04_review.md 必須; run verify-and-close): $issue_path" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    done < <(sqlite3 "$WF_DB_3" "SELECT DISTINCT issue_path FROM workflow_log WHERE command IN ('implement-feature','verify-and-close') AND issue_path IS NOT NULL AND trim(issue_path) != '';" 2>/dev/null | while IFS= read -r p; do printf '%s\0' "$p"; done)
  fi
fi

# 4. テスト観点未記載: 03_実装計画.md に固定セクション「## テスト観点」「## 単体テスト」「## BDD」のいずれかが存在し、該当セクションに空でない行が1行以上あること（見出しのみは FAIL）
if [[ -d "$PROJECT_ROOT/$WORKFLOW_DIR" ]]; then
  while IFS= read -r -d '' f; do
    [[ "$f" == *"/templates/"* ]] && continue
    if ! grep -qE '^## (テスト観点|単体テスト|BDD)$' "$f" 2>/dev/null; then
      echo "FAIL: テスト観点未記載 (03 must have section ## テスト観点 or ## 単体テスト or ## BDD): $f" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    elif ! awk '/^## (テスト観点|単体テスト|BDD)$/{section=1; inblock=1; next} inblock && /^## /{inblock=0} inblock && /[^[:space:]]/{content=1} END{exit !(section && content)}' "$f" 2>/dev/null; then
      echo "FAIL: テスト観点セクションに内容がありません (03 section must have at least one non-empty line): $f" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
  done < <(find "$PROJECT_ROOT/$WORKFLOW_DIR" -name "03_実装計画.md" -type f -print0 2>/dev/null || true)
fi

# 5. docs 更新要否未記載: 04_review.md に固定セクション「## docs 更新」および「- 要否:」「- 対象:」「- 理由:」のキーがあること（templates は除外）
if [[ -d "$PROJECT_ROOT/$WORKFLOW_DIR" ]]; then
  while IFS= read -r -d '' f; do
    [[ "$f" == *"/templates/"* ]] && continue
    if grep -qE '^## docs 更新$' "$f" 2>/dev/null && grep -qE '^- 要否:' "$f" 2>/dev/null; then
      : # OK（対象・理由はテンプレで推奨、要否は必須）
    else
      echo "FAIL: docs 更新要否未記載 (04 must have ## docs 更新 and - 要否:): $f" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
  done < <(find "$PROJECT_ROOT/$WORKFLOW_DIR" -name "04_review.md" -type f -print0 2>/dev/null || true)
fi

# 6. 内部参照禁止: PR 本文が渡された場合に .workflow/ や docs/ へのリンクを検出（CI で PR_BODY を渡す想定）
if [[ -n "${PR_BODY:-}" ]]; then
  if echo "$PR_BODY" | grep -qE '\]\([^)]*\.workflow/|\]\([^)]*/docs/|\.workflow/[^)\s]+\)|/docs/[^)\s]+\)'; then
    echo "FAIL: 内部参照禁止の PR テンプレ違反 (PR body must not link to .workflow/ or docs/). See 99_PR.md." >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
fi

# 7. 重要パスに TODO または FIXME が残っていないか（*.md に限定、誤検知を抑える）
if [[ -d "$PROJECT_ROOT/$WORKFLOW_DIR" ]]; then
  todo_found=""
  while IFS= read -r -d '' f; do
    [[ "$f" == *"/templates/"* ]] && continue
    if grep -qE 'TODO|FIXME' "$f" 2>/dev/null; then
      if [[ -z "$todo_found" ]]; then
        echo "FAIL: 重要パスに TODO/FIXME が残存 (resolve or move out of .workflow):" >&2
        todo_found=1
      fi
      echo "  $f" >&2
    fi
  done < <(find "$PROJECT_ROOT/$WORKFLOW_DIR" -name "*.md" -type f -print0 2>/dev/null || true)
  if [[ -n "$todo_found" ]]; then
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
fi

# 8. workflow.db 品質監査（.workflow/workflow.db が存在し workflow_log テーブルがある場合のみ。sqlite3 が無い場合はスキップ）
WF_DB="$PROJECT_ROOT/$WORKFLOW_DIR/workflow.db"
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$WF_DB" ]]; then
  if sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then
    # 許可されていない command 名
    bad_cmd=$(sqlite3 "$WF_DB" "SELECT command FROM workflow_log WHERE command NOT IN ('requirement-discovery','design-feature','implement-feature','verify-and-close') LIMIT 1;" 2>/dev/null || true)
    if [[ -n "$bad_cmd" ]]; then
      echo "FAIL: 許可されていない command 名が workflow_log に含まれています: $bad_cmd" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
    # summary が空または NULL
    empty_summary=$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE summary IS NULL OR trim(coalesce(summary,''))='' LIMIT 1;" 2>/dev/null || true)
    if [[ -n "$empty_summary" ]]; then
      echo "FAIL: workflow_log に summary が空の行が含まれています。" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
    # ts_utc が明らかに壊れた形式（数字を全く含まない、または空）
    bad_ts=$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE ts_utc IS NULL OR trim(coalesce(ts_utc,''))='' OR ts_utc NOT GLOB '*[0-9]*' LIMIT 1;" 2>/dev/null || true)
    if [[ -n "$bad_ts" ]]; then
      echo "FAIL: workflow_log に ts_utc が不正な形式の行が含まれています。" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
  fi
fi

# 9. 成果物と証跡の対応（04_review が存在する issue について workflow_log に該当 issue_path の行または verify-and-close が 1 件以上あること）
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$WF_DB" ]]; then
  if [[ -d "$PROJECT_ROOT/$WORKFLOW_DIR" ]]; then
    any_verify=$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE command = 'verify-and-close' LIMIT 1;" 2>/dev/null || true)
    while IFS= read -r -d '' f; do
      [[ "$f" == *"/templates/"* ]] && continue
      issue_dir="$(dirname "$f")"
      issue_path_rel="${issue_dir#$PROJECT_ROOT/}"
      issue_path_esc="${issue_path_rel//\'/\'\'}"
      has_issue_row=$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE issue_path = '$issue_path_esc' LIMIT 1;" 2>/dev/null || true)
      if [[ -z "$has_issue_row" && -z "$any_verify" ]]; then
        echo "FAIL: 04_review が存在するが、workflow.db に verify-and-close または該当 issue の記録がありません: $issue_dir" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    done < <(find "$PROJECT_ROOT/$WORKFLOW_DIR" -name "04_review.md" -type f -print0 2>/dev/null || true)
  fi
fi

# 10. workflow.db の WAL/SHM sidecar が Git 追跡されていないこと（証跡の信頼性・別環境での破損を防ぐ）
check_sqlite_sidecar() {
  echo "[audit] checking sqlite sidecar files" >&2
  if [[ ! -d "$PROJECT_ROOT/.git" ]]; then
    return 0
  fi
  if (cd "$PROJECT_ROOT" && git ls-files --error-unmatch "$WORKFLOW_DIR/workflow.db-wal" >/dev/null 2>&1); then
    echo "[audit] ERROR: workflow.db-wal must not be tracked by git" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
  if (cd "$PROJECT_ROOT" && git ls-files --error-unmatch "$WORKFLOW_DIR/workflow.db-shm" >/dev/null 2>&1); then
    echo "[audit] ERROR: workflow.db-shm must not be tracked by git" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 11. workflow.db 整合性チェック（存在する場合のみ。証跡破損の検出）
check_db_integrity() {
  local db="$PROJECT_ROOT/$WORKFLOW_DIR/workflow.db"
  if [[ ! -f "$db" ]]; then
    return 0
  fi
  echo "[audit] checking workflow.db integrity" >&2
  if ! command -v sqlite3 >/dev/null 2>&1; then
    return 0
  fi
  if ! sqlite3 "$db" "PRAGMA integrity_check;" 2>/dev/null | grep -q "ok"; then
    echo "[audit] ERROR: workflow.db integrity failed" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

check_sqlite_sidecar
check_db_integrity

# 新スキーマ（entry_id / parent_entry_id / actor_role 等）がある場合のみ順序・因果監査を実行（カラム名のみで判定、PRAGMA 出力形式に依存しない）
audit_has_column() {
  [[ ! -f "$WF_DB" ]] && return 1
  sqlite3 -separator $'\t' "$WF_DB" "PRAGMA table_info(workflow_log);" 2>/dev/null | awk -F '\t' '{print $2}' | grep -qx "$1" || return 1
}

# 12. actor_role は scribe のみ（ログを書くのは書記のみ）
check_actor_role_is_scribe() {
  if ! audit_has_column "actor_role"; then return 0; fi
  echo "[audit] checking actor_role is scribe" >&2
  local invalid_count
  invalid_count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log WHERE actor_role != 'scribe';" 2>/dev/null || echo "0")"
  if [[ "${invalid_count:-0}" -gt 0 ]]; then
    echo "[audit] ERROR: only scribe may write workflow_log" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 13. delegated_by_role は必須 orchestrator
check_delegated_by_role() {
  if ! audit_has_column "delegated_by_role"; then return 0; fi
  echo "[audit] checking delegated_by_role" >&2
  local invalid_count
  invalid_count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log WHERE delegated_by_role NOT IN ('orchestrator');" 2>/dev/null || echo "0")"
  if [[ "${invalid_count:-0}" -gt 0 ]]; then
    echo "[audit] ERROR: workflow_log must be delegated by orchestrator" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 14. implement-feature には changed_files_json が必須（空でないこと）
check_implement_has_changed_files() {
  if ! audit_has_column "changed_files_json"; then return 0; fi
  echo "[audit] checking implement-feature has changed_files_json" >&2
  local invalid_count
  invalid_count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log WHERE command = 'implement-feature' AND (changed_files_json IS NULL OR trim(coalesce(changed_files_json,'')) = '' OR trim(changed_files_json) = '[]');" 2>/dev/null || echo "0")"
  if [[ "${invalid_count:-0}" -gt 0 ]]; then
    echo "[audit] ERROR: implement-feature log requires changed_files_json" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 15. verify-and-close には review_path が必須
check_verify_has_review_path() {
  if ! audit_has_column "review_path"; then return 0; fi
  echo "[audit] checking verify-and-close has review_path" >&2
  local invalid_count
  invalid_count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log WHERE command = 'verify-and-close' AND (review_path IS NULL OR length(trim(coalesce(review_path,''))) = 0);" 2>/dev/null || echo "0")"
  if [[ "${invalid_count:-0}" -gt 0 ]]; then
    echo "[audit] ERROR: verify-and-close log requires review_path" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 16. verify-and-close には parent_entry_id が必須（単独出現禁止）
check_verify_has_parent() {
  if ! audit_has_column "parent_entry_id"; then return 0; fi
  echo "[audit] checking verify-and-close has parent" >&2
  local invalid_count
  invalid_count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log WHERE command = 'verify-and-close' AND (parent_entry_id IS NULL OR length(trim(coalesce(parent_entry_id,''))) = 0);" 2>/dev/null || echo "0")"
  if [[ "${invalid_count:-0}" -gt 0 ]]; then
    echo "[audit] ERROR: verify-and-close log without parent_entry_id" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 17. verify-and-close の親は implement-feature または design-feature
check_verify_parent_command() {
  if ! audit_has_column "parent_entry_id"; then return 0; fi
  echo "[audit] checking verify-and-close parent command" >&2
  local invalid_count
  invalid_count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log v LEFT JOIN workflow_log p ON v.parent_entry_id = p.entry_id WHERE v.command = 'verify-and-close' AND (p.entry_id IS NULL OR p.command NOT IN ('implement-feature', 'design-feature'));" 2>/dev/null || echo "0")"
  if [[ "${invalid_count:-0}" -gt 0 ]]; then
    echo "[audit] ERROR: verify-and-close parent must be implement-feature or design-feature" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 18. 04_review.md 変更があるのに verify-and-close ログが無いなら FAIL（Git リポジトリ。差分範囲は AUDIT_GIT_RANGE または第2引数、未指定時は HEAD~1..HEAD）
check_review_file_has_verify_log() {
  [[ ! -d "$PROJECT_ROOT/.git" ]] && return 0
  if ! git -C "$PROJECT_ROOT" rev-parse HEAD &>/dev/null; then return 0; fi
  if ! git -C "$PROJECT_ROOT" diff --name-only $GIT_RANGE 2>/dev/null | grep -qE '(^|/)\.workflow/.*/04_review\.md$|(^|/)\.workflow/04_review\.md$'; then return 0; fi
  if ! [[ -f "$WF_DB" ]] || ! command -v sqlite3 &>/dev/null; then return 0; fi
  local count
  count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log WHERE command = 'verify-and-close';" 2>/dev/null || echo "0")"
  if [[ "${count:-0}" -eq 0 ]]; then
    echo "[audit] ERROR: 04_review.md changed but no verify-and-close log found" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 19. 成果物変更があるのに implement/design/verify ログが無いなら FAIL（Git リポジトリ。差分範囲は GIT_RANGE）
check_artifact_change_has_implement_log() {
  [[ ! -d "$PROJECT_ROOT/.git" ]] && return 0
  if ! git -C "$PROJECT_ROOT" rev-parse HEAD &>/dev/null; then return 0; fi
  if ! git -C "$PROJECT_ROOT" diff --name-only $GIT_RANGE 2>/dev/null | grep -qE '(^|/)\.workflow/.*\.md$|(^|/)docs/.*\.md$'; then return 0; fi
  if ! [[ -f "$WF_DB" ]] || ! command -v sqlite3 &>/dev/null; then return 0; fi
  local count
  count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log WHERE command IN ('implement-feature', 'design-feature', 'verify-and-close');" 2>/dev/null || echo "0")"
  if [[ "${count:-0}" -eq 0 ]]; then
    echo "[audit] ERROR: artifacts changed but no workflow log found" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

check_actor_role_is_scribe
check_delegated_by_role
check_implement_has_changed_files
check_verify_has_review_path
check_verify_has_parent
check_verify_parent_command
check_review_file_has_verify_log
check_artifact_change_has_implement_log

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "Audit passed."
fi
exit $EXIT_CODE
