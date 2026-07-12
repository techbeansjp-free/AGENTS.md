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
#   (20) document_id 紐付け: frontmatter に document_id がある成果ドキュメントについて、workflow_log にその document_id が 1 件以上存在すること
#   (20+) document_id 不変: 同一 document_path に過去記録された document_id と現在の frontmatter が異なる場合は FAIL（RULES.md §document_id 不変）
#   (25) メインが実作業を直接行った（成果物変更に委譲・証跡の対応がない）
#   (26) コメント外部参照禁止違反（CODE_COMMENT_RULES §2 の grep 検出）
#   (27) 04_review 両リスト欠落（REVIEW_DUAL_LENS: 敵対的観点 ＋ must-preserve）
#   (28) issue ドキュメントが gitignore 配下のパスに存在（誤配置）
#   (29) 実装前 04（DB 採用時・issue_path スコープで implement/verify ログ 0 件かつ 04 存在）
#   (31) システム仕様書レビュー証跡欠落（DB・docs/ 採用時・実装変更ログありの 04_review に要=docs/00_review参照/不要=根拠 の内容が無い場合 FAIL）
#   (32) 実装前 review-docs 未実行検知（DB 採用時・issue_path スコープで implement-feature ログ 1 件以上かつ review-docs ログ 0 件なら FAIL。#29 と非交差。発効日 grandfather あり）
#   (33) close 移動未実施検知（DB 採用時・verify-and-close 証跡ありかつ close/ 未移動のトップレベル issue が、発効日以降・猶予超過なら FAIL。#32 と非交差）
#   (34) 実装前 GitHub Issue 起票ゲート未通過検知（DB 採用時・issue_path スコープで implement-feature ログ 1 件以上かつ 00 frontmatter github_issue が null/欠落なら FAIL。#32 と非交差。close/templates/90_issues 配下・GitHub 非採用環境・発効日 grandfather は SKIP）
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
#  26. コメント/docstring に外部参照（章節番号・PR/issue/タスク番号・仕様ドキュメント名）があれば FAIL。コード参照は誤検出しない。
#  27. 04_review に「敵対的観点」リストと「must-preserve（不変条件）」リストの両方が無ければ FAIL（片欠落も FAIL）。
#  28. issue ドキュメント(00〜04)が git 追跡対象外（gitignore 配下）のパスに存在したら FAIL。非 git ツリーは SKIP、exit 0 のみ FAIL。
#  29. workflow.db 採用時のみ・issue_path スコープで implement/verify ログ 0 件かつ 04_review.md 存在なら FAIL（#3 の逆方向・非交差）。
#  31. workflow.db・docs/ 採用時のみ・当該 issue に implement/verify ログがある（実装変更を伴う）04_review.md について、
#      「## docs 更新」に要=docs/00_review の実タイムスタンプ参照 or 不要=プレースホルダでない理由 のいずれの内容も無ければ FAIL。
#      既存 #5（記載の有無のみ検査）とは非交差（#31 は記載の内容を検査する）。
#  32. workflow.db 採用時のみ・issue_path スコープ前方一致で、implement-feature ログが 1 件以上あるのに
#      review-docs ログが 0 件（＝実装前レビューを飛ばした）なら FAIL。既存 #29（04 のみ・impl 0 件）とは
#      implement ログ件数（0 件 vs 1 件以上）で排他・非交差。issue ディレクトリ名の YYYYMMDD_HHMMSS_
#      プレフィックスが REVIEWDOCS_GATE_EFFECTIVE_FROM（既定 20260712_000000・env 上書き可）未満なら
#      grandfather として SKIP（遡及適用しない）。存在監査のみで review-docs と implement の厳密な
#      時刻順序は監査しない。
#  33. workflow.db 採用時のみ・issue_path スコープ前方一致で、verify-and-close ログの最新 ts_utc があるのに
#      close/ 配下へ未移動（04_review.md が close/・templates/・90_issues/ 配下以外に find される）なら FAIL。
#      発効日 grandfather（CLOSE_MOVE_GATE_EFFECTIVE_FROM・既定 20260712_000000）と猶予日数
#      （CLOSE_MOVE_GRACE_DAYS・既定 3・ts_utc からの経過日数）のいずれも満たす場合のみ FAIL。ts_utc 解析
#      不能・証跡なしは fail-open（SKIP）。既存 #32（review-docs 未実行）とは走査対象・判定内容で非交差。
#  34. workflow.db 採用時のみ・issue_path スコープ前方一致で、implement-feature ログが 1 件以上あるのに
#      00_要求定義.md frontmatter の github_issue が null/欠落（＝GitHub Issue 起票ゲート未通過）なら
#      FAIL。既存 #32（review-docs ログの有無）とは検知対象が異なり非交差。issue ディレクトリ名の
#      YYYYMMDD_HHMMSS_ プレフィックスが GITHUB_ISSUE_GATE_EFFECTIVE_FROM（既定 20260712_000000・env
#      上書き可）未満なら grandfather として SKIP。close/templates/90_issues 配下・DB 非採用・git remote
#      に github.com を含まない（GitHub 非採用環境）は SKIP（fail-open）。
# 差し戻し先: 失敗時は 04_review に戻さず、03_実装計画.md または該当 issue ドキュメント。
#
# 以下で実施: #8 workflow.db 品質監査、#9 成果物と証跡の対応、#10 sidecar 追跡禁止、#11 DB 整合性（sqlite3 が無い環境では #8/#9/#11 はスキップ）。

set -e
PROJECT_ROOT="${1:-.}"
# Git 差分範囲。CI で PR base 等を渡す想定。例: main..HEAD または HEAD~1..HEAD
GIT_RANGE="${AUDIT_GIT_RANGE:-${2:-HEAD~1..HEAD}}"
# GIT_RANGE は unquoted で `git diff $GIT_RANGE` に展開されるため、git オプション注入（--output= 等）や
# 単語分割による任意引数注入を遮断する。許可は revision / range 構文に限定する:
#   先頭は英数（- 始まりのオプション混入を排除）、以降に英数・_ . / ~ ^ - を許し、
#   任意で ..（2 点）または ...（3 点）で 2 リビジョンを結ぶ形のみ。各リビジョンも先頭は英数に固定。
# 不正な値（空白・--option・; 等・先頭 -）は既定 HEAD~1..HEAD へ無害化し、警告する（既存の正当 range は素通り）。
if [[ -n "$GIT_RANGE" ]] && ! [[ "$GIT_RANGE" =~ ^[A-Za-z0-9][A-Za-z0-9_./~^-]*(\.\.\.?[A-Za-z0-9][A-Za-z0-9_./~^-]*)?$ ]]; then
  echo "[audit] WARN: GIT_RANGE が不正なため既定 (HEAD~1..HEAD) に無害化します: '$GIT_RANGE'" >&2
  GIT_RANGE="HEAD~1..HEAD"
fi
WORKFLOW_DIR="${WORKFLOW_DIR:-.agent-skill-chain/runtime}"
# AGENTS_ROOT が呼び出し元で明示的に（非空で）設定されているかを、既定値へのフォールバック前に捕捉する。
# 未設定時のみを既定値扱いとし、既定値置換後には判別できなくなるため事前に記録しておく。
if [[ -n "${AGENTS_ROOT:-}" ]]; then AGENTS_ROOT_EXPLICIT=1; else AGENTS_ROOT_EXPLICIT=0; fi
AGENTS_ROOT="${AGENTS_ROOT:-.agent-skill-chain/source}"
EXIT_CODE=0
ROLLBACK_MSG="ROLLBACK: Fix in 03_実装計画.md or the issue doc under .agent-skill-chain/runtime/{issue}/ then re-run verify-and-close. See .agent-skill-chain/source/enforcement/README.md §失敗条件と差し戻し."

# 補助関数: 走査対象の workflow ディレクトリ「リスト」を解決して 1 行 1 ディレクトリ（PROJECT_ROOT 相対）で出力する。
#
# WORKFLOW_DIRS 解釈の確定仕様（N1 レビュー L-3）:
#   - 環境変数 WORKFLOW_DIRS（コロン区切り）が**設定されている**場合は、その値を**そのまま採用（置換）**する。
#     既定リスト（WORKFLOW_DIR・docs/maintainer/workflow）とは union しない。明示指定が最優先で、消費者が
#     走査基点を完全に固定できる。WORKFLOW_DIRS が設定されていれば WORKFLOW_DIR の値は無視される。
#   - WORKFLOW_DIRS が**未設定**の場合の既定リストは次の順で構成する（union ではなく既定の組み立て）:
#       (1) WORKFLOW_DIR（既定 .agent-skill-chain/runtime）を必ず含む。
#       (2) docs/maintainer/workflow が PROJECT_ROOT 配下に**実在する場合のみ**追加する（.agent-skill-chain/project 上書きの
#           実 issue 配置を #28/#29 が走査できるようにするため。★N-1）。実在しなければ追加しない＝汎用消費者では
#           .agent-skill-chain/runtime のみ＝標準の走査挙動。
#   - いずれの経路でも、PROJECT_ROOT 配下に**実在しない**ディレクトリはリストから除外し、**重複は 1 回**に正規化する
#     （同一 issue を二重判定しない）。
# 出力は PROJECT_ROOT からの相対パス（各 section が "$PROJECT_ROOT/$d" として使える形）。
resolve_workflow_dirs() {
  local raw_list=()
  if [[ -n "${WORKFLOW_DIRS:-}" ]]; then
    # コロン区切りを分解（置換セマンティクス）
    local IFS=':'
    read -r -a raw_list <<< "$WORKFLOW_DIRS"
  else
    raw_list=("$WORKFLOW_DIR")
    if [[ -d "$PROJECT_ROOT/docs/maintainer/workflow" ]]; then
      raw_list+=("docs/maintainer/workflow")
    fi
  fi
  # 実在のみ・重複排除（出現順を保つ）
  local seen=""
  local d
  for d in "${raw_list[@]}"; do
    [[ -z "$d" ]] && continue
    [[ ! -d "$PROJECT_ROOT/$d" ]] && continue
    case ":$seen:" in
      *":$d:"*) continue ;;
    esac
    seen="$seen:$d"
    printf '%s\n' "$d"
  done
}

# 解決済みの走査ディレクトリリスト（PROJECT_ROOT 相対）。各 section はこれをループ基点に使う。
WORKFLOW_SCAN_DIRS=()
while IFS= read -r _wf_dir; do
  [[ -n "$_wf_dir" ]] && WORKFLOW_SCAN_DIRS+=("$_wf_dir")
done < <(resolve_workflow_dirs)

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
if [[ ${#WORKFLOW_SCAN_DIRS[@]} -gt 0 ]]; then
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
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
  done < <(find "$PROJECT_ROOT/$_wfd" -name "*.md" -type f -print0 2>/dev/null || true)
  done
else
  echo "SKIP: no workflow scan directory found (checked: ${WORKFLOW_DIR}${WORKFLOW_DIRS:+, $WORKFLOW_DIRS})." >&2
fi

# 2. .agent-skill-chain/source 必須ファイルの存在
if [[ -d "$PROJECT_ROOT/$AGENTS_ROOT" ]]; then
  for rel in boot/CORE.md boot/LOAD_POLICY.md workflow/PHASES.md workflow/TEMPLATES.md; do
    if [[ ! -f "$PROJECT_ROOT/$AGENTS_ROOT/$rel" ]]; then
      echo "FAIL: Missing required file (必須ファイル未参照): $AGENTS_ROOT/$rel" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
  done
elif [[ "$AGENTS_ROOT_EXPLICIT" == "1" ]]; then
  echo "WARN: AGENTS_ROOT が明示指定されていますが解決先ディレクトリが存在しません（環境変数の設定ミス/汚染の可能性・必須ファイルチェックをスキップします）: $AGENTS_ROOT (resolved: $PROJECT_ROOT/$AGENTS_ROOT)" >&2
fi

# 2b. サブissue が存在する場合、親ワークフロールートに 90_issues.md が存在すること
if [[ ${#WORKFLOW_SCAN_DIRS[@]} -gt 0 ]]; then
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
  while IFS= read -r -d '' parent_issue_dir; do
    [[ -z "$parent_issue_dir" ]] && continue
    # 完了 issue コンテナ（close 自体）および close 配下は in-progress 前提の 90_issues 要求の対象外（#29 と同型・audit.sh:747 の前例）。
    [[ "$parent_issue_dir" == *"/close" || "$parent_issue_dir" == *"/close/"* ]] && continue
    has_sub_issue=0
    for sub in "$parent_issue_dir"/*/; do
      [[ ! -d "$sub" ]] && continue
      if [[ -f "$sub/00_要求定義.md" ]] || [[ -f "$sub/01_要件定義.md" ]] || [[ -f "$sub/02_設計.md" ]] || [[ -f "$sub/03_実装計画.md" ]] || [[ -f "$sub/04_review.md" ]]; then
        has_sub_issue=1
        break
      fi
    done
    if [[ "$has_sub_issue" -eq 1 ]]; then
      if [[ ! -f "$parent_issue_dir/90_issues.md" ]]; then
        rel="${parent_issue_dir#$PROJECT_ROOT/}"
        echo "FAIL: サブissue を 1 件以上作成した場合、親ワークフロールートに 90_issues.md が必須です（存在しません）: $rel" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    fi
  done < <(find "$PROJECT_ROOT/$_wfd" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null || true)
  done
fi

# 3. 実装後 verify-and-close 未実行: workflow.db に implement-feature または verify-and-close が記録されている issue_path のディレクトリには 04_review.md が存在すること
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$PROJECT_ROOT/$WORKFLOW_DIR/workflow.db" ]]; then
  WF_DB_3="$PROJECT_ROOT/$WORKFLOW_DIR/workflow.db"
  if sqlite3 "$WF_DB_3" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then
    while IFS= read -r -d '' issue_path; do
      [[ -z "$issue_path" ]] && continue
      # 完了 issue（close 配下）は in-progress 前提の 04_review 要求の対象外（#29 と同型・audit.sh:747 の前例）。
      [[ "$issue_path" == *"/close/"* ]] && continue
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
if [[ ${#WORKFLOW_SCAN_DIRS[@]} -gt 0 ]]; then
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
  while IFS= read -r -d '' f; do
    [[ "$f" == *"/templates/"* ]] && continue
    # 完了 issue（close 配下）は in-progress 前提のテスト観点記載要求の対象外（#29/#31/#32 と同型・audit.sh の */close/* ガードと一貫）。
    [[ "$f" == *"/close/"* ]] && continue
    if ! grep -qE '^## (テスト観点|単体テスト|BDD)$' "$f" 2>/dev/null; then
      echo "FAIL: テスト観点未記載 (03 must have section ## テスト観点 or ## 単体テスト or ## BDD): $f" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    elif ! awk '/^## (テスト観点|単体テスト|BDD)$/{section=1; inblock=1; next} inblock && /^## /{inblock=0} inblock && /[^[:space:]]/{content=1} END{exit !(section && content)}' "$f" 2>/dev/null; then
      echo "FAIL: テスト観点セクションに内容がありません (03 section must have at least one non-empty line): $f" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
  done < <(find "$PROJECT_ROOT/$_wfd" -name "03_実装計画.md" -type f -print0 2>/dev/null || true)
  done
fi

# 5. docs 更新要否未記載: 04_review.md に固定セクション「## docs 更新」および「- 要否:」「- 対象:」「- 理由:」のキーがあること（templates は除外）
if [[ ${#WORKFLOW_SCAN_DIRS[@]} -gt 0 ]]; then
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
  while IFS= read -r -d '' f; do
    [[ "$f" == *"/templates/"* ]] && continue
    # 完了 issue（close 配下）は in-progress 前提の docs 更新要否記載要求の対象外（#29/#31/#32 と同型・audit.sh の */close/* ガードと一貫）。
    [[ "$f" == *"/close/"* ]] && continue
    if grep -qE '^## docs 更新$' "$f" 2>/dev/null && grep -qE '^- 要否:' "$f" 2>/dev/null; then
      : # OK（対象・理由はテンプレで推奨、要否は必須）
    else
      echo "FAIL: docs 更新要否未記載 (04 must have ## docs 更新 and - 要否:): $f" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
  done < <(find "$PROJECT_ROOT/$_wfd" -name "04_review.md" -type f -print0 2>/dev/null || true)
  done
fi

# 6. 内部参照禁止: PR 本文が渡された場合に .agent-skill-chain/runtime/ や docs/ へのリンクを検出（CI で PR_BODY を渡す想定）
if [[ -n "${PR_BODY:-}" ]]; then
  if echo "$PR_BODY" | grep -qE '\]\([^)]*\.agent-skill-chain/runtime/|\]\([^)]*/docs/|\.agent-skill-chain/runtime/[^)\s]+\)|/docs/[^)\s]+\)'; then
    echo "FAIL: 内部参照禁止の PR テンプレ違反 (PR body must not link to .agent-skill-chain/runtime/ or docs/). See 99_PR.md." >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
fi

# 7. 重要パスに TODO または FIXME が残っていないか（*.md に限定、誤検知を抑える）
if [[ ${#WORKFLOW_SCAN_DIRS[@]} -gt 0 ]]; then
  todo_found=""
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
  while IFS= read -r -d '' f; do
    [[ "$f" == *"/templates/"* ]] && continue
    # 完了 issue（close 配下）の証跡本文中の TODO/FIXME という「語の言及」は in-progress 前提の積み残し検出の対象外（#29 と同型・audit.sh:747 の前例）。
    [[ "$f" == *"/close/"* ]] && continue
    # 実マーカと散文の言及・例示を構文で判別する（偽陽性除去・偽陰性ゼロ最優先）。
    #   (a) awk: フェンスドコードブロック（行頭の ``` / ~~~・情報文字列付き許容）内の行を除去。
    #       フェンス内行はその場で捨てずバッファし、閉じフェンスで破棄する。EOF 時に未閉なら
    #       バッファ行を救済出力して、未閉フェンス以降の実マーカ見逃し（偽陰性）を防ぐ。
    #   (b) sed: インラインコードスパン（バッククォート対）を除去し、例示マーカを落とす。
    #   (c) grep: マーカ語の直後にコロン（半角/全角）または開きカッコが続く実マーカ構文のみ検知。
    #       LC_ALL=C で全角コロンのロケール依存照合を避ける（ASCII コロン検知は不変・安全側）。
    if awk '
        /^[[:space:]]*(```|~~~)/ {
          if (infence) { infence=0; delete buf; n=0 }
          else         { infence=1; n=0 }
          next
        }
        { if (infence) buf[++n]=$0; else print }
        END { if (infence) for (i=1;i<=n;i++) print buf[i] }
      ' "$f" 2>/dev/null \
         | sed -E 's/`[^`]*`//g' 2>/dev/null \
         | LC_ALL=C grep -qE '(TODO|FIXME)[[:space:]]*[:：(]'; then
      if [[ -z "$todo_found" ]]; then
        echo "FAIL: 重要パスに TODO/FIXME が残存 (resolve or move out of .agent-skill-chain/runtime):" >&2
        todo_found=1
      fi
      echo "  $f" >&2
    fi
  done < <(find "$PROJECT_ROOT/$_wfd" -name "*.md" -type f -print0 2>/dev/null || true)
  done
  if [[ -n "$todo_found" ]]; then
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
fi

# 8. workflow.db 品質監査（.agent-skill-chain/runtime/workflow.db が存在し workflow_log テーブルがある場合のみ。sqlite3 が無い場合はスキップ）
WF_DB="$PROJECT_ROOT/$WORKFLOW_DIR/workflow.db"
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$WF_DB" ]]; then
  if sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then
    # 許可されていない command 名
    bad_cmd=$(sqlite3 "$WF_DB" "SELECT command FROM workflow_log WHERE command NOT IN ('requirement-discovery','design-feature','implement-feature','verify-and-close','review-docs','create-pr-review-issue') LIMIT 1;" 2>/dev/null || true)
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
      # 完了 issue（close 配下）の 04_review は in-progress 前提の証跡対応要求の対象外（防御的・#29 と同型・audit.sh:747 の前例）。
      [[ "$f" == *"/close/"* ]] && continue
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
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then
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
  # 完了 issue（close 配下）の verify-and-close 行は in-progress 前提の親検査の対象外（#29 と同型・audit.sh:747 の前例）。
  # 記録時の issue_path は close 移動前パス（close を含まない）でありうるため、現在 close 配下に実在する
  # issue 名（ディレクトリ名）集合を作り、offending 行を除外する（DB は読み取りのみ）。
  # ★basename 限定だと issue_path がファイル粒度（例 .../<issue>/04_review.md）で記録された行を救えず
  #   close 完了 issue でも誤発火しうる。よって (1)パスに /close/ を含むか、または
  #   (2)issue_path のいずれかのパスコンポーネントが close 在籍 issue 名に一致するか、で除外する
  #   （#2b/#3/#7/#9/#20 の */close/* 文字列照合ガードと一貫）。
  declare -A _close_issue_names=()
  local _cd="$PROJECT_ROOT/docs/maintainer/workflow/close"
  if [[ -d "$_cd" ]]; then
    while IFS= read -r -d '' _cdir; do
      _close_issue_names["$(basename "$_cdir")"]=1
    done < <(find "$_cd" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null || true)
  fi
  # offending 行の issue_path を列挙し、close 相当（/close/ を含む or close 在籍 issue 名を含む）でないものだけを数える。
  local invalid_count=0 _ip _c _matched
  local -a _comps
  while IFS= read -r _ip; do
    [[ -z "$_ip" ]] && continue
    # 既に close 配下パスで記録された行は除外。
    [[ "$_ip" == *"/close/"* || "$_ip" == */close ]] && continue
    # close 移動前パスでファイル粒度・ディレクトリ粒度いずれの記録でも、
    # issue_path のパスコンポーネントが close 在籍 issue 名に一致すれば除外する。
    _matched=0
    IFS='/' read -ra _comps <<< "${_ip%/}"
    for _c in "${_comps[@]}"; do
      [[ -n "${_close_issue_names[$_c]:-}" ]] && { _matched=1; break; }
    done
    [[ "$_matched" -eq 1 ]] && continue
    invalid_count=$((invalid_count + 1))
  done < <(sqlite3 "$WF_DB" "SELECT coalesce(v.issue_path,'') FROM workflow_log v LEFT JOIN workflow_log p ON v.parent_entry_id = p.entry_id WHERE v.command = 'verify-and-close' AND (p.entry_id IS NULL OR p.command NOT IN ('implement-feature', 'design-feature'));" 2>/dev/null || true)
  if [[ "${invalid_count:-0}" -gt 0 ]]; then
    echo "[audit] ERROR: verify-and-close parent must be implement-feature or design-feature" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 18. 04_review.md 変更があるのに verify-and-close ログが無いなら FAIL（Git リポジトリ。差分範囲は AUDIT_GIT_RANGE または第2引数、未指定時は HEAD~1..HEAD）
check_review_file_has_verify_log() {
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then return 0; fi
  if ! git -C "$PROJECT_ROOT" rev-parse HEAD &>/dev/null; then return 0; fi
  if ! git -C "$PROJECT_ROOT" diff --name-only $GIT_RANGE 2>/dev/null | grep -qE '(^|/)\.agent-skill-chain/runtime/.*/04_review\.md$|(^|/)\.agent-skill-chain/runtime/04_review\.md$'; then return 0; fi
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
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then return 0; fi
  if ! git -C "$PROJECT_ROOT" rev-parse HEAD &>/dev/null; then return 0; fi
  if ! git -C "$PROJECT_ROOT" diff --name-only $GIT_RANGE 2>/dev/null | grep -qE '(^|/)\.agent-skill-chain/runtime/.*\.md$|(^|/)docs/.*\.md$'; then return 0; fi
  if ! [[ -f "$WF_DB" ]] || ! command -v sqlite3 &>/dev/null; then return 0; fi
  local count
  count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log WHERE command IN ('implement-feature', 'design-feature', 'verify-and-close', 'review-docs', 'create-pr-review-issue');" 2>/dev/null || echo "0")"
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

# 25. メインが実作業を直接行った（#25）: 成果物変更があるのに委譲・証跡の対応がない場合は FAIL
check_25_main_did_real_work() {
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then return 0; fi
  if ! git -C "$PROJECT_ROOT" rev-parse HEAD &>/dev/null; then return 0; fi
  if ! [[ -f "$WF_DB" ]] || ! command -v sqlite3 &>/dev/null; then return 0; fi
  changed="$(git -C "$PROJECT_ROOT" diff --name-only $GIT_RANGE 2>/dev/null | grep -E '(^|/)\.agent-skill-chain/runtime/.*\.md$|(^|/)docs/.*\.md$|(^|/)src/|(^|/)app/' || true)"
  if [[ -z "$changed" ]]; then return 0; fi
  count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log WHERE command IN ('implement-feature', 'design-feature', 'verify-and-close', 'review-docs', 'create-pr-review-issue');" 2>/dev/null || echo "0")"
  if [[ "${count:-0}" -eq 0 ]]; then
    echo "[audit] ERROR: artifact changes present but no delegation/evidence in workflow_log (#25: main may have done real work)" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}
check_25_main_did_real_work

# frontmatter から document_id を取得（yq → Python → awk の順で試す）
get_document_id_from_file() {
  local f="$1"
  local doc_id=""
  if command -v yq &>/dev/null; then
    doc_id="$(awk '/^---$/{n++} n==1{print} n>1{exit}' "$f" 2>/dev/null | yq -r '.document_id // empty' 2>/dev/null)"
  fi
  if [[ -z "$doc_id" ]] && command -v python3 &>/dev/null; then
    doc_id="$(awk '/^---$/{n++} n==1{print} n>1{exit}' "$f" 2>/dev/null | python3 -c "
import sys
for line in sys.stdin:
    line = line.rstrip()
    if line.startswith('document_id:'):
        v = line.split(':', 1)[1].strip().strip('\"').strip(\"'\")
        if v:
            print(v)
        break
" 2>/dev/null)"
  fi
  if [[ -z "$doc_id" ]]; then
    doc_id="$(awk '/^---$/{n++} n==1 && /document_id:/{sub(/^.*document_id:\s*[\"\047]?/,\"\"); sub(/[\"\047]?\s*$/,\"\"); if(length>0) print; exit}' "$f" 2>/dev/null)"
  fi
  printf '%s\n' "$doc_id"
}

# 20. document_id 紐付け: .agent-skill-chain/runtime 配下の 00/01/02/03/04 の frontmatter から document_id を抽出し、workflow_log にその document_id が 1 件以上存在するか検証。無ければ FAIL。frontmatter に document_id が無いファイルは対象外。
# 20+. document_id 不変: 同一 document_path に過去記録された document_id と現在の frontmatter の値が異なる場合は FAIL（RULES.md §document_id 不変）。
check_document_id_linked() {
  if ! [[ -f "$WF_DB" ]] || ! command -v sqlite3 &>/dev/null; then return 0; fi
  if ! audit_has_column "document_id"; then return 0; fi
  [[ ${#WORKFLOW_SCAN_DIRS[@]} -eq 0 ]] && return 0
  echo "[audit] checking document_id linkage (#20)" >&2
  local uuid_regex='^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
  local _wfd
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
  while IFS= read -r -d '' f; do
    [[ "$f" == *"/templates/"* ]] && continue
    # 完了 issue（close 配下）成果物の document_id 紐付け要求は in-progress 前提のため対象外（#29 と同型・audit.sh:747 の前例）。
    [[ "$f" == *"/close/"* ]] && continue
    doc_id=""
    if [[ -f "$f" ]]; then
      doc_id="$(get_document_id_from_file "$f")"
      if [[ -z "$doc_id" || ! "$doc_id" =~ $uuid_regex ]]; then continue; fi
    fi
    doc_id_esc="${doc_id//\'/\'\'}"
    count="$(sqlite3 "$WF_DB" "SELECT COUNT(*) FROM workflow_log WHERE document_id = '$doc_id_esc';" 2>/dev/null || echo "0")"
    if [[ "${count:-0}" -eq 0 ]]; then
      echo "[audit] ERROR: document has document_id but no workflow_log entry (#20): $f (document_id=$doc_id)" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
    # document_id 不変: 同一パスに既に別の document_id が記録されていれば FAIL
    if audit_has_column "document_path"; then
      f_rel="${f#${PROJECT_ROOT}/}"
      f_rel="${f_rel#./}"
      f_rel_esc="${f_rel//\'/\'\'}"
      prev_id="$(sqlite3 "$WF_DB" "SELECT document_id FROM workflow_log WHERE document_path = '$f_rel_esc' AND document_id IS NOT NULL ORDER BY ts_utc ASC LIMIT 1;" 2>/dev/null || true)"
      if [[ -n "$prev_id" && "$prev_id" != "$doc_id" ]]; then
        echo "[audit] ERROR: document_id was mutated (#20+): $f (stored=$prev_id, current=$doc_id)" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    fi
  done < <(find "$PROJECT_ROOT/$_wfd" -mindepth 1 -maxdepth 3 -type f \( -name "00_*.md" -o -name "01_*.md" -o -name "02_*.md" -o -name "03_*.md" -o -name "04_*.md" \) -print0 2>/dev/null)
  done
}

check_document_id_linked

# 26. コメント/docstring 外部参照禁止違反（CODE_COMMENT_RULES §2）。
#   プロジェクトのソースコード（既定 src/ app/ components/。CODE_COMMENT_SRC_DIRS で上書き可・コロン区切り）の
#   コメント/docstring 行に限定して、章節番号・PR/issue/タスク番号・仕様ドキュメント名を grep 検出する。
#   - 走査対象はソースコードのみ。.agent-skill-chain/source/（フレームワーク基盤スクリプトは正当に仕様名/章節を参照する）と
#     ドキュメント（WORKFLOW_SCAN_DIRS・docs 等。仕様名/章節参照が正当）は対象外＝誤検出させない。
#   - import/require/include 等の行は除外（ファイルパスは §3 で許可）。obj.method() 等のコード参照は
#     パターンがキーワード前置を要求するため FAIL させない。
#   ソースディレクトリが 1 つも実在しない（本リポのような文書/フレームワーク専用パッケージ）場合は何も検出しない。
check_code_comment_external_ref() {
  echo "[audit] checking code comment external refs (#26)" >&2
  # 検出ロジックは同居する check-comment-refs.sh（単一正本）へ委譲する。本 check は
  # 走査対象ディレクトリの決定（CODE_COMMENT_SRC_DIRS の解釈・実在確認）と FAIL 集約のみを担う。
  local script_dir refs_script
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  refs_script="$script_dir/check-comment-refs.sh"
  if [[ ! -f "$refs_script" ]]; then
    echo "[audit] WARN: check-comment-refs.sh が見つからないため #26 を SKIP します: $refs_script" >&2
    return 0
  fi
  local src_dirs=()
  if [[ -n "${CODE_COMMENT_SRC_DIRS:-}" ]]; then
    local IFS=':'
    read -r -a src_dirs <<< "$CODE_COMMENT_SRC_DIRS"
  else
    src_dirs=("src" "app" "components")
  fi
  # 実在するソースディレクトリのみを検知スクリプトへ渡す（実在が 1 つも無ければ何も検出しない）。
  local scan_targets=() d
  for d in "${src_dirs[@]}"; do
    [[ -z "$d" ]] && continue
    [[ -d "$PROJECT_ROOT/$d" ]] && scan_targets+=("$PROJECT_ROOT/$d")
  done
  [[ ${#scan_targets[@]} -eq 0 ]] && return 0
  local out rc=0
  out="$(bash "$refs_script" "${scan_targets[@]}")" || rc=$?
  if [[ $rc -eq 1 && -n "$out" ]]; then
    echo "FAIL: コメント外部参照禁止違反 (CODE_COMMENT_RULES):" >&2
    local line
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      echo "  ${line#$PROJECT_ROOT/}" >&2
    done <<< "$out"
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 27. 04_review 両リスト構造チェック（REVIEW_DUAL_LENS §3）。
#   04_review.md に「敵対的観点」リストと「must-preserve（不変条件）」リストの両方が記載されていること。
#   片方でも欠落していれば FAIL（両方揃えば PASS）。
#   検査対象は Git 差分範囲（AUDIT_GIT_RANGE / 既定 HEAD~1..HEAD）で**変更された** 04_review.md のみ
#   （既存 check_review_file_has_verify_log と同方式）。既存の過去レビューを一律に再判定して誤 FAIL させない。
#   非 git ツリーは SKIP。templates は除外。
check_review_dual_lists() {
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then return 0; fi
  if ! git -C "$PROJECT_ROOT" rev-parse HEAD &>/dev/null; then return 0; fi
  echo "[audit] checking 04_review dual lists (#27)" >&2
  local changed rel f
  changed="$(git -C "$PROJECT_ROOT" diff --name-only $GIT_RANGE 2>/dev/null | grep -E '(^|/)04_review\.md$' || true)"
  [[ -z "$changed" ]] && return 0
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    [[ "$rel" == *"/templates/"* ]] && continue
    f="$PROJECT_ROOT/$rel"
    [[ ! -f "$f" ]] && continue
    local has_adv has_keep
    has_adv=""; has_keep=""
    grep -qE '敵対的観点' "$f" 2>/dev/null && has_adv=1
    grep -qE 'must-preserve|不変条件' "$f" 2>/dev/null && has_keep=1
    if [[ -z "$has_adv" || -z "$has_keep" ]]; then
      echo "FAIL: REVIEW_DUAL 両リスト欠落 (04_review must contain 敵対的観点 and must-preserve): $rel" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
  done <<< "$changed"
}

# 28. gitignore 配下の issue ドキュメント検知（誤配置）。
#   issue ドキュメント(00〜04)が git 追跡対象外（gitignore 配下）のパスに存在したら FAIL。
#   ★H-1': .git 不在/非 git ツリーは冒頭 SKIP。git check-ignore の exit 0 のみ FAIL
#   （exit 1=非 ignore、exit 128=非 git/エラー は FAIL にしない）。templates は二重除外。
#   走査は WORKFLOW_SCAN_DIRS（docs/... は追跡対象なので check-ignore 偽 → pass）。
check_issue_doc_in_gitignored_path() {
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then return 0; fi
  [[ ${#WORKFLOW_SCAN_DIRS[@]} -eq 0 ]] && return 0
  echo "[audit] checking issue docs in gitignored paths (#28)" >&2
  local _wfd f rel
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
    while IFS= read -r -d '' f; do
      [[ "$f" == *"/templates/"* ]] && continue
      rel="${f#$PROJECT_ROOT/}"
      # exit 0（= gitignore 配下）のみ FAIL。条件式中で評価するため set -e 下でも非ゼロは致命化しない。
      if (cd "$PROJECT_ROOT" && git check-ignore -q "$rel"); then
        echo "FAIL: issue ドキュメントが git 追跡対象外（gitignore 配下）のパスに存在します（誤配置）: $rel" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    done < <(find "$PROJECT_ROOT/$_wfd" -type f \( -name "00_*.md" -o -name "01_*.md" -o -name "02_*.md" -o -name "03_*.md" -o -name "04_*.md" \) -print0 2>/dev/null || true)
  done
}

# 29. 実装前 04 検知（実装前に 04_review.md だけが作られている）。
#   workflow.db 採用時のみ・issue_path スコープ前方一致で「implement/verify ログが 1 件も無いのに
#   04_review.md が存在＝実装前 04」を検知。既存 #3（04 欠落）の逆方向で非交差（04 の有無が排他）。
#   ★H-2'/M-1': 完全一致でなく前方一致（= dir OR = dir/ OR LIKE dir/%）で「ログが 1 件でも拾えれば pass」の
#   安全側に倒す（偽陰性＝見逃しを許容し、誤 FAIL を絶対に出さない）。DB 不採用は冒頭 SKIP。
check_review_before_implement() {
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then return 0; fi
  [[ ${#WORKFLOW_SCAN_DIRS[@]} -eq 0 ]] && return 0
  echo "[audit] checking review-before-implement (#29)" >&2
  local _wfd f issue_dir dir dir_esc base base_esc hit
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
    while IFS= read -r -d '' f; do
      [[ "$f" == *"/templates/"* ]] && continue
      # 完了 issue（close 配下）は実装前 04 検知の対象外（完了済みであり、close 移動でディレクトリ名が
      # 変わるため記録時の issue_path と現在パスが一致しない。安全側: 誤 FAIL を出さない）。
      [[ "$f" == *"/close/"* ]] && continue
      issue_dir="$(dirname "$f")"
      dir="${issue_dir#$PROJECT_ROOT/}"
      dir_esc="${dir//\'/\'\'}"
      base="$(basename "$issue_dir")"
      base_esc="${base//\'/\'\'}"
      # 前方一致で「当該 issue に紐づく任意のログ 1 件以上」を判定（安全側: ログがあれば pass）。
      # ディレクトリ相対パスの前方一致に加え、basename（issue ディレクトリ名）末尾一致でも救済し、
      # 走査基点とログ記録時の基点差（例: close 移動・別 clone）でも誤 FAIL を出さない。
      hit="$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE command IN ('implement-feature','verify-and-close') AND (issue_path = '$dir_esc' OR issue_path = '$dir_esc/' OR issue_path LIKE '$dir_esc/%' OR issue_path LIKE '%/$base_esc' OR issue_path LIKE '%/$base_esc/%') LIMIT 1;" 2>/dev/null || true)"
      if [[ -z "$hit" ]]; then
        echo "FAIL: 実装前に 04_review.md が作成されています（implement/verify ログ 0 件）: $dir" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    done < <(find "$PROJECT_ROOT/$_wfd" -name "04_review.md" -type f -print0 2>/dev/null || true)
  done
}

# 31. システム仕様書レビュー証跡欠落検知（check_docs_review_evidence）。
#   workflow.db 採用・docs/ 採用・当該 issue に implement-feature/verify-and-close ログが 1 件以上ある
#   （実装変更を伴う）04_review.md について、「## docs 更新」セクションに次のいずれの内容も
#   確認できない場合に FAIL する。
#     - 要否が「要」: docs/00_review/ への実タイムスタンプ形式（YYYYMMDD_HHMMSS）の参照がある。
#     - 要否が「不要」: 理由がプレースホルダのまま（テンプレート既定文言）ではない。
#   既存 #5（## docs 更新 と - 要否: の記載の**有無**のみ検査）とは非交差（#31 は記載の**内容**を検査する）。
#   SKIP ガード（#29 と同型・安全側）: sqlite3/workflow_log 不在、docs/ 未採用、templates/・close/ 配下、
#   当該 issue に implement/verify ログ 0 件（実装変更を伴わない）。
check_docs_review_evidence() {
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then return 0; fi
  if [[ ! -d "$PROJECT_ROOT/docs" ]]; then return 0; fi
  [[ ${#WORKFLOW_SCAN_DIRS[@]} -eq 0 ]] && return 0
  echo "[audit] checking docs review evidence (#31)" >&2
  local _wfd f issue_dir dir dir_esc base base_esc hit block yohi reason ok
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
    while IFS= read -r -d '' f; do
      [[ "$f" == *"/templates/"* ]] && continue
      [[ "$f" == *"/close/"* ]] && continue
      issue_dir="$(dirname "$f")"
      dir="${issue_dir#$PROJECT_ROOT/}"
      dir_esc="${dir//\'/\'\'}"
      base="$(basename "$issue_dir")"
      base_esc="${base//\'/\'\'}"
      # 前方一致で「当該 issue に implement/verify ログ 1 件以上」を判定（#29 と同型・安全側）。
      # ログが無ければ実装変更を伴わない issue とみなし SKIP（誤 FAIL を出さない）。
      hit="$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE command IN ('implement-feature','verify-and-close') AND (issue_path = '$dir_esc' OR issue_path = '$dir_esc/' OR issue_path LIKE '$dir_esc/%' OR issue_path LIKE '%/$base_esc' OR issue_path LIKE '%/$base_esc/%') LIMIT 1;" 2>/dev/null || true)"
      [[ -z "$hit" ]] && continue

      block="$(awk '/^## docs 更新$/{flag=1; next} /^## /{flag=0} flag' "$f" 2>/dev/null)"
      yohi="$(printf '%s\n' "$block" | grep -m1 -E '^- 要否:' || true)"
      reason="$(printf '%s\n' "$block" | grep -m1 -E '^- 理由:' | sed -E 's/^- 理由:[[:space:]]*//' || true)"

      ok=0
      if [[ -n "$yohi" ]] && ! printf '%s' "$yohi" | grep -qF '要 / 不要'; then
        if printf '%s' "$yohi" | grep -q '不要'; then
          # 不要: 理由がプレースホルダ既定文言（「（要の場合」始まり）でなく、実質的な内容があるか。
          if [[ -n "$reason" ]] && ! printf '%s' "$reason" | grep -qE '^（要の場合'; then
            ok=1
          fi
        else
          # 要: docs/00_review への実タイムスタンプ形式の参照があるか（テンプレートの
          #     「YYYYMMDD_HHMMSS」という文字どおりのプレースホルダでは一致しない）。
          if printf '%s' "$block" | grep -qE 'docs/00_review/[0-9]{8}_[0-9]{6}'; then
            ok=1
          fi
        fi
      fi

      if [[ "$ok" -ne 1 ]]; then
        echo "FAIL: システム仕様書レビュー証跡欠落 (04_review §docs 更新 に 要=docs/00_review参照 or 不要=根拠 の記載が必要): $dir" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    done < <(find "$PROJECT_ROOT/$_wfd" -name "04_review.md" -type f -print0 2>/dev/null || true)
  done
}

# 32. 実装前 review-docs 未実行検知（check_reviewdocs_before_implement）。
#   workflow.db 採用時のみ・issue_path スコープ前方一致で「implement-feature ログが 1 件以上あるのに
#   review-docs ログが 0 件＝実装前レビューを飛ばした」を検知する。既存 #29（04 のみ・impl 0 件）とは
#   implement ログ件数（0 件 vs 1 件以上）で排他・非交差（02_設計 ADR-2）。
#   ★grandfather（ADR-5）: issue ディレクトリ名の YYYYMMDD_HHMMSS_ プレフィックスが
#   REVIEWDOCS_GATE_EFFECTIVE_FROM（既定 20260712_000000・env 上書き可）未満なら SKIP（遡及適用しない）。
#   走査対象は 03_実装計画.md（design/plan 完了の目印。#29 の 04_review.md 走査と同型・unbounded find・
#   maxdepth を付けない。90_issues 配下の深い階層のサブ issue を確実に含めるため）。close/templates 除外。
#   前方一致＋basename 末尾一致の安全側（#29 と同型）。存在監査のみ（review-docs と implement の厳密な
#   時刻順序は監査しない・ADR-3）。
check_reviewdocs_before_implement() {
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then return 0; fi
  [[ ${#WORKFLOW_SCAN_DIRS[@]} -eq 0 ]] && return 0
  echo "[audit] checking reviewdocs-before-implement (#32)" >&2
  local cutoff="${REVIEWDOCS_GATE_EFFECTIVE_FROM:-20260712_000000}"
  local _wfd f issue_dir dir dir_esc base base_esc ts hit_impl hit_rd
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
    while IFS= read -r -d '' f; do
      [[ "$f" == *"/templates/"* ]] && continue
      # close 配下（完了 issue）は実装前レビュー未実行検知の対象外（#29 と同型・安全側）。
      [[ "$f" == *"/close/"* ]] && continue
      issue_dir="$(dirname "$f")"
      dir="${issue_dir#$PROJECT_ROOT/}"
      dir_esc="${dir//\'/\'\'}"
      base="$(basename "$issue_dir")"
      base_esc="${base//\'/\'\'}"
      # grandfather（ADR-5）: issue basename の日時プレフィックスが cutoff 未満なら遡及適用しない。
      # プレフィックス形式でない（規約外の命名の）issue はカットオフ判定できないため素通りさせる
      # （誤 FAIL を出さない安全側。従来どおり implement/review-docs ログの有無で判定する）。
      if [[ "$base" =~ ^([0-9]{8})_([0-9]{6})_ ]]; then
        ts="${BASH_REMATCH[1]}_${BASH_REMATCH[2]}"
        if [[ "$ts" < "$cutoff" ]]; then
          continue
        fi
      fi
      hit_impl="$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE command='implement-feature' AND (issue_path = '$dir_esc' OR issue_path = '$dir_esc/' OR issue_path LIKE '$dir_esc/%' OR issue_path LIKE '%/$base_esc' OR issue_path LIKE '%/$base_esc/%') LIMIT 1;" 2>/dev/null || true)"
      # implement-feature ログが 0 件＝未実装。#32 の対象外（#29 の対象になりうるがここでは無関係・continue）。
      [[ -z "$hit_impl" ]] && continue
      hit_rd="$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE command='review-docs' AND (issue_path = '$dir_esc' OR issue_path = '$dir_esc/' OR issue_path LIKE '$dir_esc/%' OR issue_path LIKE '%/$base_esc' OR issue_path LIKE '%/$base_esc/%') LIMIT 1;" 2>/dev/null || true)"
      if [[ -z "$hit_rd" ]]; then
        echo "FAIL: 実装前 review-docs 未実行（implement-feature ログはあるが review-docs ログが 0 件）: $dir" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    done < <(find "$PROJECT_ROOT/$_wfd" -name "03_実装計画.md" -type f -print0 2>/dev/null || true)
  done
}

# 33. close 移動未実施検知（check_close_move_pending）。
#   workflow.db に verify-and-close 証跡がありながら close/ 未移動のトップレベル issue を、
#   発効日以降・猶予超過時に検知して FAIL する（02_設計 ADR-1〜5）。
#   走査対象は 04_review.md（#29/#31 と同型・unbounded find）。close/・templates/・90_issues/ 配下は
#   除外する（ADR-5・トップレベル近似。close 配下は移動済み、90_issues 配下はサブ issue 単独完了）。
#   証跡は workflow_log の verify-and-close 最新 ts_utc を path-component 照合（#29/#32 と同型）で取得する。
#   grandfather は CLOSE_MOVE_GATE_EFFECTIVE_FROM（既定 20260712_000000・env 上書き可・#32 と同型）。
#   猶予は CLOSE_MOVE_GRACE_DAYS（既定 3・env 上書き可）で、既存 ts_to_epoch ヘルパーによる
#   経過日数判定（ADR-3）。sqlite3/DB/workflow_log 不在・ts_utc 解析不能・証跡なしはすべて
#   fail-open（continue／return 0・ADR-4）。DB・FS への書き込みは一切しない（Query のみ・ADR-CQRS）。
check_close_move_pending() {
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then return 0; fi
  [[ ${#WORKFLOW_SCAN_DIRS[@]} -eq 0 ]] && return 0
  echo "[audit] checking close-move-pending (#33)" >&2
  local cutoff="${CLOSE_MOVE_GATE_EFFECTIVE_FROM:-20260712_000000}"
  local grace_days="${CLOSE_MOVE_GRACE_DAYS:-3}"
  local _wfd f issue_dir dir dir_esc base base_esc ts vc_ts vc_epoch now_epoch
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
    while IFS= read -r -d '' f; do
      [[ "$f" == *"/templates/"* || "$f" == *"/close/"* || "$f" == *"/90_issues/"* ]] && continue
      issue_dir="$(dirname "$f")"
      dir="${issue_dir#$PROJECT_ROOT/}"
      dir_esc="${dir//\'/\'\'}"
      base="$(basename "$issue_dir")"
      base_esc="${base//\'/\'\'}"
      # grandfather（ADR-3）: issue basename の日時プレフィックスが cutoff 未満なら遡及適用しない。
      # プレフィックス形式でない issue はカットオフ判定できないため素通りさせる（誤 FAIL を出さない安全側）。
      if [[ "$base" =~ ^([0-9]{8})_([0-9]{6})_ ]]; then
        ts="${BASH_REMATCH[1]}_${BASH_REMATCH[2]}"
        if [[ "$ts" < "$cutoff" ]]; then
          continue
        fi
      fi
      vc_ts="$(sqlite3 "$WF_DB" "SELECT ts_utc FROM workflow_log WHERE command='verify-and-close' AND (issue_path = '$dir_esc' OR issue_path = '$dir_esc/' OR issue_path LIKE '$dir_esc/%' OR issue_path LIKE '%/$base_esc' OR issue_path LIKE '%/$base_esc/%') ORDER BY ts_utc DESC LIMIT 1;" 2>/dev/null || true)"
      [[ -z "$vc_ts" ]] && continue
      vc_epoch="$(ts_to_epoch "$vc_ts")" || continue
      now_epoch="$(date +%s)"
      if (( now_epoch - vc_epoch > grace_days * 86400 )); then
        echo "FAIL: close 移動未実施（verify-and-close 完了だが close/ 未移動・猶予超過）: $dir" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    done < <(find "$PROJECT_ROOT/$_wfd" -name "04_review.md" -type f -print0 2>/dev/null || true)
  done
}

# 34. 実装前 GitHub Issue 起票ゲート未通過検知（check_github_issue_before_implement）。
#   workflow.db 採用時のみ・issue_path スコープ前方一致で「implement-feature ログが 1 件以上あるのに
#   00_要求定義.md frontmatter の github_issue が有効な記録でない＝実装前 GitHub Issue 起票ゲートを
#   経ずに実装した」を検知する。ゲートの強度は「デフォルト起票＋理由付き記録による代替経路あり」
#   （02_設計 ADR-1）。github_issue の値が (a) 実 Issue 参照（"#<番号>"/URL 等の非空値）、または
#   (b) 理由付き declined（"declined: <非空の理由>"）なら PASS。null/空/~・理由なし declined
#   （"declined:" のみ・理由が空白のみ）は FAIL（意図的スキップの記録を必須化し空虚なバイパスを防ぐ・
#   ADR-7）。既存 #32（review-docs ログの有無を検知）とは検知対象（review-docs ログ vs
#   github_issue 記録）が異なり非交差（02_設計 ADR-3）。
#   ★プロジェクト全体でのゲート無効化トグル（ADR-8）: GITHUB_ISSUE_GATE_ENABLED（既定 true）が
#   false/0/no/off の場合、他のどのガード（DB 採用・GitHub 採用環境・grandfather・declined 等）
#   よりも先に SKIP する（fail-open）。GitHub は使うが Issue 運用自体を採用しないプロジェクト向け。
#   既存の enforce on/off（enforcement 全体の opt-in）とは独立した、本ゲート単体の無効化トグル。
#   ★grandfather（ADR-5 と同型）: issue ディレクトリ名の YYYYMMDD_HHMMSS_ プレフィックスが
#   GITHUB_ISSUE_GATE_EFFECTIVE_FROM（既定 20260712_000000・env 上書き可）未満なら SKIP（遡及適用しない）。
#   ★対象外環境フォールバック（ADR-4）: 非 git ツリー、または git remote に github.com を含まない
#   （GitHub 非採用環境）は SKIP（fail-open・ロックアウト回避）。
#   ★サブ issue 集約（ADR-6）: パスに /90_issues/ を含む場合は SKIP（#32 が 90_issues を含める
#   unbounded find なのとは逆・実装上の差分）。
#   走査対象は 00_要求定義.md（frontmatter を読む目印。unbounded find・maxdepth を付けない）。
#   close/templates 除外。前方一致＋basename 末尾一致の安全側（#32 と同型）。存在監査のみ（ADR-3）。
check_github_issue_before_implement() {
  # 0. プロジェクト全体でのゲート無効化トグル（ADR-8）: 最優先で評価する最初のガード。
  #    GITHUB_ISSUE_GATE_EFFECTIVE_FROM 等の既存 env 命名パターン（GITHUB_ISSUE_GATE_ 接頭辞）に揃える。
  case "${GITHUB_ISSUE_GATE_ENABLED:-true}" in
    [Ff][Aa][Ll][Ss][Ee]|0|[Nn][Oo]|[Oo][Ff][Ff]) return 0 ;;
  esac
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then return 0; fi
  [[ ${#WORKFLOW_SCAN_DIRS[@]} -eq 0 ]] && return 0
  # 対象外環境フォールバック（ADR-4）: 非 git ツリー／git remote に github.com を含まない場合は SKIP。
  # 「git ツリーか」の判定は rev-parse --is-inside-work-tree を正とする（通常リポジトリ・worktree・
  # submodule いずれも正しく true を返す）。`.git` がディレクトリかの検査は worktree では `.git` が
  # gitdir ポインタの「ファイル」になるため false-SKIP を生む（ゲートが worktree で骨抜きになる）ので用いない。
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then return 0; fi
  if ! git -C "$PROJECT_ROOT" remote -v 2>/dev/null | grep -q 'github\.com'; then return 0; fi
  echo "[audit] checking github-issue-gate-before-implement (#34)" >&2
  local cutoff="${GITHUB_ISSUE_GATE_EFFECTIVE_FROM:-20260712_000000}"
  local _wfd f issue_dir dir dir_esc base base_esc ts hit_impl fm gh_line gh_val gate_fail decl_reason
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
    while IFS= read -r -d '' f; do
      [[ "$f" == *"/templates/"* ]] && continue
      # close 配下（完了 issue）は検知対象外（#32 と同型・安全側）。
      [[ "$f" == *"/close/"* ]] && continue
      # サブ issue（90_issues 配下）は親 Issue に集約するためゲート対象外（ADR-6）。
      [[ "$f" == *"/90_issues/"* ]] && continue
      issue_dir="$(dirname "$f")"
      dir="${issue_dir#$PROJECT_ROOT/}"
      dir_esc="${dir//\'/\'\'}"
      base="$(basename "$issue_dir")"
      base_esc="${base//\'/\'\'}"
      # grandfather（ADR-5 と同型）: issue basename の日時プレフィックスが cutoff 未満なら遡及適用しない。
      # プレフィックス形式でない issue は判定不能として素通り（誤 FAIL を出さない安全側）。
      if [[ "$base" =~ ^([0-9]{8})_([0-9]{6})_ ]]; then
        ts="${BASH_REMATCH[1]}_${BASH_REMATCH[2]}"
        if [[ "$ts" < "$cutoff" ]]; then
          continue
        fi
      fi
      hit_impl="$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE command='implement-feature' AND (issue_path = '$dir_esc' OR issue_path = '$dir_esc/' OR issue_path LIKE '$dir_esc/%' OR issue_path LIKE '%/$base_esc' OR issue_path LIKE '%/$base_esc/%') LIMIT 1;" 2>/dev/null || true)"
      # implement-feature ログが 0 件＝未実装。#34 の対象外（continue）。
      [[ -z "$hit_impl" ]] && continue
      # frontmatter ブロック（先頭 --- 〜 次の ---）内の github_issue: 行を抽出する（コメント行 # は
      # 行頭一致の正規表現で自然に除外される）。
      fm="$(awk 'NR==1 && $0=="---"{p=1;next} p && $0=="---"{exit} p' "$f" 2>/dev/null)"
      gh_line="$(printf '%s\n' "$fm" | grep -m1 -E '^github_issue:' || true)"
      gh_val="$(printf '%s' "$gh_line" | sed -E 's/^github_issue:[[:space:]]*//; s/[[:space:]]+$//')"
      gh_val="${gh_val%\"}"; gh_val="${gh_val#\"}"
      # ゲート通過判定（ADR-1・ADR-7）: 値が (a) 実 Issue 参照（"#<番号>"/URL 等の非空値）、または
      # (b) 理由付き declined（"declined: <非空の理由>"）なら PASS。null/空/~、または理由なし declined
      # （"declined:" のみ・理由が空白のみ）は FAIL（意図的スキップの記録を必須化し空虚なバイパスを防ぐ）。
      gate_fail=0
      if [[ -z "$gh_val" ]] || [[ "${gh_val,,}" == "null" ]] || [[ "$gh_val" == "~" ]]; then
        gate_fail=1
      elif [[ "${gh_val,,}" == "declined:"* ]]; then
        # "declined:" 以降の理由を抽出し、前後空白トリム後に空なら理由なし declined＝未通過。
        decl_reason="${gh_val#*:}"
        decl_reason="$(printf '%s' "$decl_reason" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
        [[ -z "$decl_reason" ]] && gate_fail=1
      fi
      if [[ $gate_fail -eq 1 ]]; then
        echo "FAIL: 実装前 GitHub Issue 起票ゲート未通過（implement-feature ログはあるが 00 frontmatter の github_issue が null/欠落、または理由なしの declined。実 Issue 番号/URL または 'declined: <理由>' を記録すること）: $dir" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    done < <(find "$PROJECT_ROOT/$_wfd" -name "00_要求定義.md" -type f -print0 2>/dev/null || true)
  done
}

check_code_comment_external_ref
check_review_dual_lists
check_issue_doc_in_gitignored_path
check_review_before_implement
check_docs_review_evidence
check_reviewdocs_before_implement
check_close_move_pending
check_github_issue_before_implement

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "Audit passed."
fi
exit $EXIT_CODE
