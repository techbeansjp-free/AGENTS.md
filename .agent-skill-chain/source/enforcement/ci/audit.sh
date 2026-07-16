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
#   (25) メインが実作業を直接行った（成果物変更に委譲・証跡の対応がない・対象差分と時系列的に対応しない古い証跡のみの場合も含む）
#   (26) コメント外部参照禁止違反（CODE_COMMENT_RULES §2 の grep 検出）
#   (27) 04_review 両リスト欠落（REVIEW_DUAL_LENS: 敵対的観点 ＋ must-preserve）
#   (28) issue ドキュメントが gitignore 配下のパスに存在（誤配置）
#   (29) 実装前 04（DB 採用時・issue_path スコープで implement/verify ログ 0 件かつ 04 存在）
#   (31) システム仕様書レビュー証跡欠落（DB・docs/ 採用時・実装変更ログありの 04_review に要=docs/00_review参照/不要=根拠 の内容が無い場合 FAIL）
#   (32) 実装前 review-docs 未実行検知（DB 採用時・issue_path スコープで implement-feature ログ 1 件以上かつ review-docs ログ 0 件なら FAIL。#29 と非交差。発効日 grandfather あり）
#   (33) close 移動未実施検知（DB 採用時・verify-and-close 証跡ありかつ close/ 未移動のトップレベル issue が、発効日以降・猶予超過なら FAIL。#32 と非交差）
#   (34) 実装前 GitHub Issue 起票ゲート未通過検知（DB 採用時・issue_path スコープで implement-feature ログ 1 件以上かつ 00 frontmatter github_issue が null/欠落なら FAIL。#32 と非交差。close/templates/90_issues 配下・GitHub 非採用環境・発効日 grandfather は SKIP）
#   (35) 実装前ブランチ紐づけ未記録検知（DB 採用時・issue_path スコープで implement-feature ログ 1 件以上かつ 00 frontmatter branch が空/null/~/欠落なら FAIL。#34 の写像だが declined 概念なし・github.com remote 不要。close/templates/90_issues 配下・非 git・発効日 grandfather は SKIP）
#   (36) PR 紐づけ未記録検知（CI で PR_BODY が渡されたときのみ・PR 本文に有効な Closes/Refs #<番号> が 1 件以上あれば PASS。無い場合は差分内 workflow issue のうち実 Issue 参照を持つ非 declined・非 grandfather の issue が残れば FAIL。PR_BODY 未設定＝ローカル/push は SKIP。#6 の写像・#34 と非交差）
#   (37) システム仕様書の作業用 issue フォルダ参照禁止（docs/ 配下の仕様書が作業用 issue フォルダ＝.agent-skill-chain/runtime/{issue}/ または docs/maintainer/workflow/{issue}/ へのパス参照を含むと FAIL。DOCS_NOISE_RULES (iv-b)。close/ は対象外）
#
# 失敗とみなす条件（1 行/チェックの索引。判定ルール・SKIP 条件・差し戻し先の正本は
# enforcement/README.md §失敗条件と差し戻し の失敗条件対応表・共通前提ノートを参照。
# 番号は上記「必須チェック:」と同一。README の #N 番号と一部ずれる箇所のみ矢印で明示する）:
#   (1)  必須ファイル未参照 → README #1
#   (2)  04_review 未更新（verify-and-close 未実行） → README #3
#   (3)  テスト観点未記載 → README #2
#   (4)  docs 更新要否未記載 → README #4
#   (5)  memo プレフィックス・timestamp 乖離 → README §矯正するもの「timestamp 付き memo ファイルの作成経路の固定」
#   (6)  内部参照禁止の PR テンプレ違反 → README #6
#   (7)  重要パス TODO/FIXME 残存 → README #7
#   (8)  workflow.db 品質違反 → README #8
#   (9)  04_review と証跡の不整合 → README #9
#  (10)  workflow.db sidecar Git 追跡 → README #10
#  (11)  workflow.db 整合性不良 → README #11
#  (12)–(17) 新スキーマ因果（actor_role/delegated_by/changed_files_json/review_path/parent/verify 親） → README #12–#17
#  (18)–(19) 04 変更・成果物変更時のログ有無 → README #18–#19
#  (20)/(20+) document_id 紐付け・不変 → README #20/#20+
#  (25) メイン直接作業（時系列突合・許容窓既定 48h） → README #25
#  (26) コメント外部参照禁止違反 → README #26
#  (27) 04_review 両リスト欠落 → README #27
#  (28) issue ドキュメント誤配置（gitignore 配下） → README #28
#  (29) 実装前 04 → README #29
#  (31) システム仕様書レビュー証跡欠落 → README #31
#  (32) 実装前 review-docs 未実行 → README #32
#  (33) close 移動未実施 → README #33
#  (34) 実装前 GitHub Issue 起票ゲート未通過 → README #34
#  (35) 実装前ブランチ紐づけ未記録 → README #35
#  (36) PR 紐づけ未記録 → README #36
#  (37) システム仕様書の作業用 issue フォルダ参照禁止 → README #37
#  (38) モデルティア明記義務の機械検証未通過 → README #38
#  (39) ルート起点 unbounded find の .worktree prune 欠落（ベストエフォート lint） → README #39
#  (40) 非準拠ブランチ名の事後検知（grandfather baseline 救済・Tier2） → README #40
# 差し戻し先: 失敗時は 04_review に戻さず、03_実装計画.md または該当 issue ドキュメント。
#
# 以下で実施: #8 workflow.db 品質監査、#9 成果物と証跡の対応、#10 sidecar 追跡禁止、#11 DB 整合性（sqlite3 が無い環境では #8/#9/#11 はスキップ）。

set -e
PROJECT_ROOT="${1:-.}"
# Git 差分範囲。CI で PR base や push イベントの before..after 等を渡す想定。例: main..HEAD, HEAD~1..HEAD, <before>..<after>
# push イベントで複数コミットをまとめて push した場合の監査漏れ対策として、呼び出し元（消費者テンプレート
# .agent-skill-chain/runtime/templates/github/workflows/audit.yml）は github.event.before/after から動的に
# AUDIT_GIT_RANGE を組み立てて渡すことを想定する（before が新規ブランチ作成等で全ゼロ SHA の場合は、
# テンプレート側で AUDIT_GIT_RANGE を設定せず、本スクリプトの既定 HEAD~1..HEAD にフォールバックさせる）。
GIT_RANGE="${AUDIT_GIT_RANGE:-${2:-HEAD~1..HEAD}}"
# GIT_RANGE は unquoted で `git diff $GIT_RANGE` に展開されるため、git オプション注入（--output= 等）や
# 単語分割による任意引数注入を遮断する。許可は revision / range 構文に限定する:
#   先頭は英数（- 始まりのオプション混入を排除）、以降に英数・_ . / ~ ^ - を許し、
#   任意で ..（2 点）または ...（3 点）で 2 リビジョンを結ぶ形のみ。各リビジョンも先頭は英数に固定。
# 不正な値（空白・--option・; 等・先頭 -）は既定 HEAD~1..HEAD へ無害化し、警告する（既存の正当 range は素通り）。
# 追加の防御: 全ゼロ SHA（40 桁の 0）を起点/終点に含む場合も解決不能な参照のため既定へフォールバックする
# （push イベントの before が全ゼロになる新規ブランチ作成時等、呼び出し元が誤ってそのまま渡した場合の保険）。
if [[ "$GIT_RANGE" =~ ^0{40}(\.\.\.?.*)?$ ]] || [[ "$GIT_RANGE" =~ \.\.\.?0{40}$ ]]; then
  echo "[audit] WARN: GIT_RANGE の起点/終点が全ゼロ SHA (新規ブランチ作成時等) のため既定 (HEAD~1..HEAD) にフォールバックします: '$GIT_RANGE'" >&2
  GIT_RANGE="HEAD~1..HEAD"
fi
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

# 0. DB 系チェックの SKIP 状況を CI ログ上で明示する（#3, #8-#25, #29, #31-#35 が対象）。
#   workflow.db は Git 非追跡（ローカルの累積証跡ストア）であるため、CI のクリーンな checkout には
#   実体が存在せず、DB 系チェックは構造的に SKIP される（バグではなく意図された設計上の帰結）。
#   詳細・実効的な検知経路（ローカル pre-push）は enforcement/README.md「workflow.db の扱い」を参照。
#   本ブロックは検知結果の要約表示のみを担い、各チェック本体の SKIP 条件・判定ロジックは
#   単一正本（各 check 関数）に委ねる（判定ロジックの二重化はしない）。
_audit_db_probe_path="$PROJECT_ROOT/$WORKFLOW_DIR/workflow.db"
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "SKIP-SUMMARY: sqlite3 コマンドが見つかりません。DB 系チェック（#3, #8-#25, #29, #31-#35）はすべて SKIP されます。実効的な検知経路はローカル pre-push フックです（enforcement/ci/pre-push.example を .git/hooks/pre-push へ導入）。" >&2
elif [[ ! -f "$_audit_db_probe_path" ]]; then
  echo "SKIP-SUMMARY: workflow.db が見つかりません ($_audit_db_probe_path)。DB 系チェック（#3, #8-#25, #29, #31-#35）はすべて SKIP されます。CI のクリーンな checkout では workflow.db は Git 非追跡のため常にこの状態になります（意図的な設計。詳細は enforcement/README.md「workflow.db の扱い」を参照）。実効的な検知経路はローカル pre-push フックです（enforcement/ci/pre-push.example を .git/hooks/pre-push へ導入）。" >&2
else
  echo "[audit] INFO: workflow.db が見つかりました ($_audit_db_probe_path)。DB 系チェック（#3, #8-#25, #29, #31-#35）を評価します。" >&2
fi

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
else
  echo "SKIP: #3 04_review 未更新チェックをスキップします（workflow.db 不在または sqlite3 不在）" >&2
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
#   外部サイトの絶対 URL（例: https://example.com/docs/page）まで誤検知しないよう、判定前に
#   http(s):// で始まる絶対 URL トークンを除去してから内部パス（.agent-skill-chain/runtime/・docs/）の
#   有無を検査する。POSIX 移植性のため \s（GNU 拡張）は使わず [[:space:]] を使う（BSD/GNU grep 両対応）。
if [[ -n "${PR_BODY:-}" ]]; then
  _pr_body_no_url="$(printf '%s' "$PR_BODY" | sed -E 's#https?://[^)[:space:]]*##g')"
  if printf '%s' "$_pr_body_no_url" | grep -qE '\]\([^)]*\.agent-skill-chain/runtime/|\]\([^)]*/docs/|\.agent-skill-chain/runtime/[^)[:space:]]+\)|/docs/[^)[:space:]]+\)'; then
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
else
  echo "SKIP: #8 workflow.db 品質監査をスキップします（workflow.db 不在または sqlite3 不在）" >&2
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
else
  echo "SKIP: #9 成果物と証跡の対応チェックをスキップします（workflow.db 不在または sqlite3 不在）" >&2
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
    echo "SKIP: #11 workflow.db 整合性チェックをスキップします（workflow.db 不在）" >&2
    return 0
  fi
  echo "[audit] checking workflow.db integrity" >&2
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "SKIP: #11 workflow.db 整合性チェックをスキップします（sqlite3 不在）" >&2
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
#   時系列突合（is-3163305 是正）: workflow.db は累積型のため、単純な件数（COUNT）判定だと
#   過去のどこかで対象 command が 1 件でも記録されていれば、それ以降のあらゆる差分に対して
#   恒久的に PASS してしまう（対象差分との時系列対応を見ていない不具合）。本改善では、対象差分
#   （GIT_RANGE）に含まれる最古のコミット日時を基準に、workflow_log の該当 command の最新
#   ts_utc がその基準時刻から MAIN_WORK_GATE_TOLERANCE_SECONDS（既定 172800 秒=48 時間。env
#   上書き可）より過去でないことを要求する。許容窓を設けるのは、実装 → ログ記録 → コミット の
#   順序（ログが必ずしもコミットより後とは限らない）を許容しつつ、対象差分と無関係な古いログでの
#   恒久 PASS を防ぐため。コミット日時が取得できない（GIT_RANGE 解決不能等）場合は、従来どおり
#   件数のみの判定にフォールバックする（fail-open 方向の安全側・既存消費者への互換維持）。
check_25_main_did_real_work() {
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then return 0; fi
  if ! git -C "$PROJECT_ROOT" rev-parse HEAD &>/dev/null; then return 0; fi
  if ! [[ -f "$WF_DB" ]] || ! command -v sqlite3 &>/dev/null; then return 0; fi
  changed="$(git -C "$PROJECT_ROOT" diff --name-only $GIT_RANGE 2>/dev/null | grep -E '(^|/)\.agent-skill-chain/runtime/.*\.md$|(^|/)docs/.*\.md$|(^|/)src/|(^|/)app/' || true)"
  if [[ -z "$changed" ]]; then return 0; fi
  local main_work_query="SELECT COUNT(*) FROM workflow_log WHERE command IN ('implement-feature', 'design-feature', 'verify-and-close', 'review-docs', 'create-pr-review-issue');"
  # 対象差分（GIT_RANGE）に含まれる最古コミットの committer date（ISO8601）を取得する。
  # 複数コミットが束ねられた push でも、範囲内で最も古いコミットを基準にすることで、
  # 「その範囲の作業」に対応する証跡の有無を判定する（新しすぎる基準にしない安全側）。
  local oldest_commit_ts oldest_commit_epoch
  oldest_commit_ts="$(git -C "$PROJECT_ROOT" log --format=%cI $GIT_RANGE 2>/dev/null | tail -1 || true)"
  if [[ -z "$oldest_commit_ts" ]] || ! oldest_commit_epoch="$(ts_to_epoch "$oldest_commit_ts")"; then
    # コミット日時が取得できない（GIT_RANGE 解決不能・単一コミットで %cI が空等）場合は、
    # 時系列突合ができないため従来どおり件数のみで判定する（fail-open 寄りの安全側）。
    count="$(sqlite3 "$WF_DB" "$main_work_query" 2>/dev/null || echo "0")"
    if [[ "${count:-0}" -eq 0 ]]; then
      echo "[audit] ERROR: artifact changes present but no delegation/evidence in workflow_log (#25: main may have done real work)" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
    fi
    return 0
  fi
  local tolerance="${MAIN_WORK_GATE_TOLERANCE_SECONDS:-172800}"
  local threshold_epoch=$(( oldest_commit_epoch - tolerance ))
  local latest_log_ts
  latest_log_ts="$(sqlite3 "$WF_DB" "SELECT MAX(ts_utc) FROM workflow_log WHERE command IN ('implement-feature', 'design-feature', 'verify-and-close', 'review-docs', 'create-pr-review-issue');" 2>/dev/null || true)"
  if [[ -z "$latest_log_ts" ]]; then
    echo "[audit] ERROR: artifact changes present but no delegation/evidence in workflow_log (#25: main may have done real work)" >&2
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
    return 0
  fi
  local latest_log_epoch
  if ! latest_log_epoch="$(ts_to_epoch "$latest_log_ts")"; then
    # ts_utc が解析不能な場合は判定不能のため fail-open（既存 #33 と同型の安全側）。
    return 0
  fi
  if (( latest_log_epoch < threshold_epoch )); then
    echo "[audit] ERROR: workflow_log の該当証跡が対象差分に対して古すぎる（最新ログ ts_utc=${latest_log_ts} が対象差分の最古コミット日時=${oldest_commit_ts} より許容窓（${tolerance}秒）を超えて前）。#25: main may have done real work without delegation evidence corresponding to this diff" >&2
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
#   コメント/docstring 行に限定して、章節番号・PR/issue/タスク番号・仕様ドキュメント名・作業用 issue フォルダへの
#   パス参照（.agent-skill-chain/runtime/{issue}/ または docs/maintainer/workflow/{issue}/。日時プレフィックス
#   限定・close/ 対象外。#37 と対称）を grep 検出する。
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
  # 0. モードガード（最優先・02_設計 ADR-S2-1/ADR-S2-2）: 実効モードが github_native なら
  #    ローカル issue ドラフト(00〜04)は意図的に非追跡化されるため、非追跡ドラフトを検知する
  #    本チェックを丸ごと SKIP する（#33 の github_native SKIP ガードと同型・resolve_issue_tracking_mode
  #    を再利用し新規判定を作らない）。非 git ツリー SKIP より前に置いても安全（github_native は
  #    github.com remote 検出を要し非 git では local_tracked へフォールバックする）。
  if [[ "$(resolve_issue_tracking_mode)" == "github_native" ]]; then
    echo "SKIP: #28（gitignore 配下の issue ドキュメント検知）をスキップします（実効モードが github_native のため。ISSUE_TRACKING_MODE=github_native かつ github.com remote 検出・02_設計 ADR-S2-2）" >&2
    return 0
  fi
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
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then echo "SKIP: #29 実装前04チェックをスキップします（workflow.db 不在または sqlite3 不在）" >&2; return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then echo "SKIP: #29 実装前04チェックをスキップします（workflow_log テーブル不在）" >&2; return 0; fi
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
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then echo "SKIP: #31 システム仕様書レビュー証跡欠落検知をスキップします（workflow.db 不在または sqlite3 不在）" >&2; return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then echo "SKIP: #31 システム仕様書レビュー証跡欠落検知をスキップします（workflow_log テーブル不在）" >&2; return 0; fi
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

# mode 信号（00_要求定義.md frontmatter の mode:）を読み取り、正規化（trim・前後クオート除去・
#   小文字化）して返す。quick モードは #32（review-docs）・#34（GitHub Issue 起票）ゲートの免除条件に
#   用いる（#35 branch は mode を一切参照しない・02_設計 ADR-3）。欠落・不明値・00 不在はすべて
#   空文字を返す（呼び出し側で「quick 以外は非免除＝従来判定」として扱う・fail-safe＝ADR-2）。
#   #34 の frontmatter 抽出（awk による --- 〜 --- ブロック抽出）と同型のロジックを流用する。
#   DB/FS への書き込みは一切しない（read-only）。
get_issue_mode() {
  local zero_file="$1"
  [[ -f "$zero_file" ]] || { printf '%s\n' ""; return 0; }
  local fm mode_line mode_val
  fm="$(awk 'NR==1 && $0=="---"{p=1;next} p && $0=="---"{exit} p' "$zero_file" 2>/dev/null)"
  mode_line="$(printf '%s\n' "$fm" | grep -m1 -E '^mode:' || true)"
  mode_val="$(printf '%s' "$mode_line" | sed -E 's/^mode:[[:space:]]*//; s/[[:space:]]+$//')"
  mode_val="${mode_val%\"}"; mode_val="${mode_val#\"}"
  mode_val="${mode_val%\'}"; mode_val="${mode_val#\'}"
  printf '%s\n' "${mode_val,,}"
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
#   ★mode ガード（quick モード免除・163206 issue ADR-2/ADR-5/ADR-6）: 同一 issue_dir の
#   00_要求定義.md frontmatter mode が quick なら SKIP（review-docs 反復を免除する軽量化。記録省略ではない）。
#   mode 欠落・不明値・00 不在は非 quick として素通り（従来判定・fail-safe）。
check_reviewdocs_before_implement() {
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then echo "SKIP: #32（実装前レビュー実行有無の検知）をスキップします（workflow.db 不在または sqlite3 不在）" >&2; return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then echo "SKIP: #32（実装前レビュー実行有無の検知）をスキップします（workflow_log テーブル不在）" >&2; return 0; fi
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
      # mode ガード（quick モードは #32 を免除・163206 issue ADR-2/ADR-5/ADR-6）: 同一 issue_dir の
      # 00_要求定義.md frontmatter mode が quick なら SKIP。00 不在・mode 欠落/不明値は非 quick として
      # 素通り（従来判定・fail-safe）。
      if [[ "$(get_issue_mode "$issue_dir/00_要求定義.md")" == "quick" ]]; then
        continue
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

# 実効モード解決（02_設計 ADR-2/ADR-5・ADR-S1-3）。純関数/Query・副作用なし。
# 既定 local_tracked（fail-safe・後方互換）。ISSUE_TRACKING_MODE=github_native かつ
# git remote に github.com を含むときのみ github_native を返す。未設定・不明値・非 git・
# 非 GitHub はすべて local_tracked（ロックアウト・非追跡データ消失の回避）。github.com 判定は
# #34（GitHub 採用判定・audit.sh:1131）と同一シグナルを再利用し新規判定を作らない。
resolve_issue_tracking_mode() {
  if [[ "${ISSUE_TRACKING_MODE:-}" != "github_native" ]]; then
    printf '%s\n' "local_tracked"; return 0
  fi
  if git -C "$PROJECT_ROOT" remote -v 2>/dev/null | grep -q 'github\.com'; then
    printf '%s\n' "github_native"; return 0
  fi
  printf '%s\n' "local_tracked"
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
  # 0. モードガード（最優先・02_設計 ADR-5/ADR-S1-1）: 実効モードが github_native なら
  #    close 移動運用は廃止済みのため本チェックを丸ごと SKIP する。GITHUB_ISSUE_GATE_ENABLED
  #    の最優先トグル前例（audit.sh:1118-1122）と同型で、既存 DB ガードより前に置く。
  if [[ "$(resolve_issue_tracking_mode)" == "github_native" ]]; then
    echo "SKIP: #33（close ディレクトリ移動状況の検知）をスキップします（実効モードが github_native のため。ISSUE_TRACKING_MODE=github_native かつ github.com remote 検出・02_設計 ADR-5/ADR-S1-2）" >&2
    return 0
  fi
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then echo "SKIP: #33（close ディレクトリ移動状況の検知）をスキップします（workflow.db 不在または sqlite3 不在）" >&2; return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then echo "SKIP: #33（close ディレクトリ移動状況の検知）をスキップします（workflow_log テーブル不在）" >&2; return 0; fi
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
#   ★mode ガード（quick モード免除・163206 issue ADR-2/ADR-5/ADR-6）: 当該 00_要求定義.md frontmatter
#   mode が quick なら SKIP（GitHub Issue 起票を免除する軽量化。記録省略ではない）。mode 欠落・不明値は
#   非 quick として素通り（従来判定・fail-safe）。プロジェクト全体トグル（GITHUB_ISSUE_GATE_ENABLED）の
#   冒頭 SKIP とは独立（本ガードは per-issue ループ内・grandfather 直後）。
check_github_issue_before_implement() {
  # 0. プロジェクト全体でのゲート無効化トグル（ADR-8）: 最優先で評価する最初のガード。
  #    GITHUB_ISSUE_GATE_EFFECTIVE_FROM 等の既存 env 命名パターン（GITHUB_ISSUE_GATE_ 接頭辞）に揃える。
  case "${GITHUB_ISSUE_GATE_ENABLED:-true}" in
    [Ff][Aa][Ll][Ss][Ee]|0|[Nn][Oo]|[Oo][Ff][Ff]) return 0 ;;
  esac
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then echo "SKIP: #34（GitHub Issue 起票の記録有無の検知）をスキップします（workflow.db 不在または sqlite3 不在）" >&2; return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then echo "SKIP: #34（GitHub Issue 起票の記録有無の検知）をスキップします（workflow_log テーブル不在）" >&2; return 0; fi
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
      # mode ガード（quick モードは #34 を免除・163206 issue ADR-2/ADR-5/ADR-6）: 走査中の
      # 00_要求定義.md（$f）frontmatter mode が quick なら SKIP。mode 欠落/不明値は非 quick として
      # 従来判定（fail-safe）。冒頭の GITHUB_ISSUE_GATE_ENABLED トグル SKIP は不変（本ガードより前段）。
      if [[ "$(get_issue_mode "$f")" == "quick" ]]; then
        continue
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

# 35. ブランチ紐づけ未記録検知（check_branch_linkage_before_implement）。
#   workflow.db 採用時のみ・issue_path スコープ前方一致で「implement-feature ログが 1 件以上あるのに
#   00_要求定義.md frontmatter の branch が空/null/~/キー無し＝対応 feature ブランチ名が未記録」なら FAIL。
#   既存 #34（github_issue の記録を検知）の写像だが、以下が差分（02_設計 ADR-2/ADR-7）:
#     (a) branch には declined 概念が無く「非空なら PASS・空/null/~/欠落なら FAIL」の単純判定。
#     (b) github.com remote は要求しない（ブランチは GitHub 非採用でも成立する）。非 git ツリーのみ SKIP。
#   ★無効化トグル: BRANCH_LINK_GATE_ENABLED（既定 true）が false/0/no/off なら最優先で SKIP（fail-open）。
#   ★grandfather: issue basename の YYYYMMDD_HHMMSS_ プレフィックスが BRANCH_LINK_GATE_EFFECTIVE_FROM
#     （既定 20260713_000000・env 上書き可）未満なら SKIP（遡及適用しない）。
#   走査対象は 00_要求定義.md（unbounded find）。close/templates/90_issues 配下・DB 非採用・非 git は SKIP。
check_branch_linkage_before_implement() {
  case "${BRANCH_LINK_GATE_ENABLED:-true}" in
    [Ff][Aa][Ll][Ss][Ee]|0|[Nn][Oo]|[Oo][Ff][Ff]) return 0 ;;
  esac
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then echo "SKIP: #35（ブランチ名記録有無の検知）をスキップします（workflow.db 不在または sqlite3 不在）" >&2; return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then echo "SKIP: #35（ブランチ名記録有無の検知）をスキップします（workflow_log テーブル不在）" >&2; return 0; fi
  [[ ${#WORKFLOW_SCAN_DIRS[@]} -eq 0 ]] && return 0
  # 対象外環境フォールバック: 非 git ツリーは SKIP（github.com remote は要求しない・#34 との差分・ADR-7）。
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then return 0; fi
  echo "[audit] checking branch-linkage-before-implement (#35)" >&2
  local cutoff="${BRANCH_LINK_GATE_EFFECTIVE_FROM:-20260713_000000}"
  local _wfd f issue_dir dir dir_esc base base_esc ts hit_impl fm br_line br_val
  for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
    while IFS= read -r -d '' f; do
      [[ "$f" == *"/templates/"* ]] && continue
      # close 配下（完了 issue）は検知対象外（#34 と同型・安全側）。
      [[ "$f" == *"/close/"* ]] && continue
      # サブ issue（90_issues 配下）は親 issue に集約するため対象外（#34 ADR-6 と同型）。
      [[ "$f" == *"/90_issues/"* ]] && continue
      issue_dir="$(dirname "$f")"
      dir="${issue_dir#$PROJECT_ROOT/}"
      dir_esc="${dir//\'/\'\'}"
      base="$(basename "$issue_dir")"
      base_esc="${base//\'/\'\'}"
      # grandfather: issue basename の日時プレフィックスが cutoff 未満なら遡及適用しない。
      # プレフィックス形式でない issue は判定不能として素通り（誤 FAIL を出さない安全側）。
      if [[ "$base" =~ ^([0-9]{8})_([0-9]{6})_ ]]; then
        ts="${BASH_REMATCH[1]}_${BASH_REMATCH[2]}"
        if [[ "$ts" < "$cutoff" ]]; then
          continue
        fi
      fi
      hit_impl="$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE command='implement-feature' AND (issue_path = '$dir_esc' OR issue_path = '$dir_esc/' OR issue_path LIKE '$dir_esc/%' OR issue_path LIKE '%/$base_esc' OR issue_path LIKE '%/$base_esc/%') LIMIT 1;" 2>/dev/null || true)"
      # implement-feature ログが 0 件＝未実装。#35 の対象外（continue）。
      [[ -z "$hit_impl" ]] && continue
      # frontmatter ブロック（先頭 --- 〜 次の ---）内の branch: 行を抽出する（#34 と同型のパース）。
      fm="$(awk 'NR==1 && $0=="---"{p=1;next} p && $0=="---"{exit} p' "$f" 2>/dev/null)"
      br_line="$(printf '%s\n' "$fm" | grep -m1 -E '^branch:' || true)"
      br_val="$(printf '%s' "$br_line" | sed -E 's/^branch:[[:space:]]*//; s/[[:space:]]+$//')"
      br_val="${br_val%\"}"; br_val="${br_val#\"}"
      # 判定: 空/null/~/キー無し＝未記録＝FAIL。非空＝PASS（declined 分岐は持たない・ADR-2）。
      if [[ -z "$br_val" ]] || [[ "${br_val,,}" == "null" ]] || [[ "$br_val" == "~" ]]; then
        echo "FAIL: ブランチ紐づけ未記録（implement-feature ログはあるが 00 frontmatter の branch が空/null/欠落。対応 feature ブランチ名を記録すること）: $dir" >&2
        echo "$ROLLBACK_MSG" >&2
        EXIT_CODE=1
      fi
    done < <(find "$PROJECT_ROOT/$_wfd" -name "00_要求定義.md" -type f -print0 2>/dev/null || true)
  done
}

# 36. PR 紐づけ未記録検知（check_pr_issue_linkage）。
#   CI で PR_BODY が渡されたとき（PR イベント）に限り、PR 本文へ有効な GitHub Issue 参照
#   （Closes/Fixes/Resolves/Refs/References #<番号> または <owner>/<repo>#<番号>・大小文字不問）が
#   1 件以上含まれることを検証する。既存 #6（PR_BODY を渡して PR 本文を検証する唯一の前例）の写像。
#   PR_BODY 未設定（ローカル・push）は SKIP＝ローカルと CI で挙動が異なる仕様（ADR-4）。
#   本文に有効な参照が無い場合のみ、差分（GIT_RANGE）に含まれる workflow issue を調べ、実 Issue 参照を
#   持つ（＝declined でも grandfather でも null でもない）対象 issue が 1 件以上残れば FAIL。残らなければ
#   （差分に workflow issue が無い／全て除外）SKIP（安全側 fail-open・ADR-6）。
#   ★無効化トグル: PR_LINK_GATE_ENABLED（既定 true）が false/0/no/off なら最優先で SKIP。
#   ★grandfather: 差分内 issue basename プレフィックスが PR_LINK_GATE_EFFECTIVE_FROM
#     （既定 20260713_000000・env 上書き可）未満なら対象外。
#   ★除外: github_issue が declined:／空/null/~/キー無し（実 Issue 番号が無く PR 参照不能＝#34 の責務・非交差）。
check_pr_issue_linkage() {
  case "${PR_LINK_GATE_ENABLED:-true}" in
    [Ff][Aa][Ll][Ss][Ee]|0|[Nn][Oo]|[Oo][Ff][Ff]) return 0 ;;
  esac
  # PR_BODY 未設定（ローカル・push）は SKIP。既存 #6 と同型の PR_BODY ガード（ADR-4）。
  [[ -z "${PR_BODY:-}" ]] && return 0
  echo "[audit] checking pr-issue-linkage (#36)" >&2
  # PR 本文に有効な Closes/Refs 等が 1 件以上あれば PASS（ADR-5 のキーワードパターン・大小文字不問）。
  if printf '%s' "$PR_BODY" | grep -qiE '(clos(e|es|ed)|fix(es|ed)?|resolv(e|es|ed)|refs?|references?)[[:space:]]+([[:alnum:]._-]+/[[:alnum:]._-]+)?#[0-9]+'; then
    return 0
  fi
  # 本文に紐づけが無い場合のみ、差分内の workflow issue を調べて残存対象があれば FAIL。
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then return 0; fi
  [[ ${#WORKFLOW_SCAN_DIRS[@]} -eq 0 ]] && return 0
  local cutoff="${PR_LINK_GATE_EFFECTIVE_FROM:-20260713_000000}"
  local changed rel _wfd sub issue idir base ts f fm gh_line gh_val remaining seen
  # core.quotepath=false: 非 ASCII（日本語）パスを八進エスケープ・二重引用符で囲まずそのまま出力させる
  # （00_要求定義.md のような日本語ファイル名を含む issue パスを正しく照合するため）。
  changed="$(git -C "$PROJECT_ROOT" -c core.quotepath=false diff --name-only $GIT_RANGE 2>/dev/null || true)"
  [[ -z "$changed" ]] && return 0
  # 変更ファイルから WORKFLOW_SCAN_DIRS 配下の issue ディレクトリを抽出（重複排除・出現順）。
  local issue_dirs=()
  seen=""
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
      case "$rel" in
        "$_wfd"/*)
          sub="${rel#$_wfd/}"
          issue="${sub%%/*}"
          [[ -z "$issue" ]] && continue
          idir="$_wfd/$issue"
          case ":$seen:" in *":$idir:"*) continue ;; esac
          seen="$seen:$idir"
          issue_dirs+=("$idir")
          ;;
      esac
    done
  done <<< "$changed"
  [[ ${#issue_dirs[@]} -eq 0 ]] && return 0
  remaining=0
  for idir in "${issue_dirs[@]}"; do
    case "$idir" in
      */templates/*|*/close/*|*/90_issues/*) continue ;;
    esac
    base="$(basename "$idir")"
    # grandfather: 差分内 issue basename プレフィックスが cutoff 未満なら対象外。
    if [[ "$base" =~ ^([0-9]{8})_([0-9]{6})_ ]]; then
      ts="${BASH_REMATCH[1]}_${BASH_REMATCH[2]}"
      [[ "$ts" < "$cutoff" ]] && continue
    fi
    f="$PROJECT_ROOT/$idir/00_要求定義.md"
    [[ ! -f "$f" ]] && continue
    fm="$(awk 'NR==1 && $0=="---"{p=1;next} p && $0=="---"{exit} p' "$f" 2>/dev/null)"
    gh_line="$(printf '%s\n' "$fm" | grep -m1 -E '^github_issue:' || true)"
    gh_val="$(printf '%s' "$gh_line" | sed -E 's/^github_issue:[[:space:]]*//; s/[[:space:]]+$//')"
    gh_val="${gh_val%\"}"; gh_val="${gh_val#\"}"
    # 除外: null/空/~/キー無し（実 Issue 番号が無く PR 参照不能＝#34 の責務・非交差）。
    if [[ -z "$gh_val" ]] || [[ "${gh_val,,}" == "null" ]] || [[ "$gh_val" == "~" ]]; then continue; fi
    # 除外: declined:（起票しない決定＝PR 紐づけ対象外・ADR-6）。
    if [[ "${gh_val,,}" == "declined:"* ]]; then continue; fi
    # 実 Issue 参照を持つ非 declined・非 grandfather の対象 issue が残った＝FAIL。
    remaining=1
    echo "FAIL: PR 紐づけ未記録（PR 本文に Closes/Refs #<番号> が無く、差分内 issue '$base' の github_issue は実 Issue を参照している。PR 本文へ Closes/Refs を追記すること）: $idir" >&2
  done
  if [[ $remaining -eq 1 ]]; then
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 37. システム仕様書の作業用 issue フォルダ参照禁止（check_docs_transient_issue_ref）。
#   docs/ 配下のシステム仕様書（*.md）が、作業用 issue フォルダ（.agent-skill-chain/runtime/{issue}/ または
#   docs/maintainer/workflow/{issue}/）への直接パス参照を含むと FAIL する（DOCS_NOISE_RULES (iv-b)）。
#   git/sqlite3 に非依存の純粋なファイル走査。docs/ 不在は SKIP（docs/ 未採用プロジェクトでは不発動）。
#   検出パターン: (\.agent-skill-chain/runtime|docs/maintainer/workflow)/[0-9]{8}_
#     - issue フォルダ名の日時プレフィックス（YYYYMMDD_）を要求することで、汎用ディレクトリ参照
#       （.agent-skill-chain/runtime/workflow.db・規約説明中の一般記述）や DB 参照を誤検知しない。
#     - close/ 配下（完了後の永続パス）は runtime/ または workflow/ の直後が "close"（非数字）となり
#       構造的に一致しないため、追加の除外なしで機械検出の対象外となる（DOCS_NOISE_RULES §役割分担）。
#   走査対象外（作業用 issue ドキュメント自身。兄弟 issue の正当参照を誤 FAIL しない）:
#     相対パス（PROJECT_ROOT からの相対）が WORKFLOW_SCAN_DIRS のいずれか（本リポでは
#     docs/maintainer/workflow。汎用消費者では WORKFLOW_DIR/WORKFLOW_DIRS で解決される値）で厳密に
#     前方一致するファイル。/workflow/ の部分一致では判定しない（docs/architecture/workflow/... のような
#     正当な仕様書を誤って対象外にしないため）。加えて /templates/ を含むファイル（テンプレの例示パスを
#     誤検知しない防御的除外）。除外パスの正本は WORKFLOW_SCAN_DIRS（#28/#29 等 他チェックと同一基点）。
check_docs_transient_issue_ref() {
  [[ ! -d "$PROJECT_ROOT/docs" ]] && return 0
  echo "[audit] checking docs transient issue-folder refs (#37)" >&2
  local f rel first="" _wfd skip
  while IFS= read -r -d '' f; do
    rel="${f#"$PROJECT_ROOT"/}"
    # 走査対象外: 作業用 issue ドキュメント自身（WORKFLOW_SCAN_DIRS 配下）。相対パスの厳密な前方一致で
    # 判定し、/workflow/ の部分一致で正当な仕様書を巻き込まない（CodeRabbit 指摘2）。
    skip=""
    for _wfd in "${WORKFLOW_SCAN_DIRS[@]}"; do
      [[ "$rel" == "$_wfd/"* ]] && { skip=1; break; }
    done
    [[ -n "$skip" ]] && continue
    [[ "$rel" == *"/templates/"* ]] && continue
    if grep -qE '(\.agent-skill-chain/runtime|docs/maintainer/workflow)/[0-9]{8}_' "$f" 2>/dev/null; then
      if [[ -z "$first" ]]; then
        echo "FAIL: システム仕様書が作業用 issue フォルダを参照しています (DOCS_NOISE_RULES (iv-b); 要約+安定参照へ張り替える。close/ は対象外):" >&2
        first=1
      fi
      echo "  $rel" >&2
    fi
  done < <(find "$PROJECT_ROOT/docs" -name "*.md" -type f -print0 2>/dev/null || true)
  if [[ -n "$first" ]]; then
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 38. モデルティア明記義務の機械検証（check_model_tier_recorded）。
#   workflow_log の各行について、委譲時のモデルティア記録の有無を検査する（Query のみ・DB/FS へ書き込まない）。
#   ★多層ガード（ADR-5・fail-open）: 以下の順で SKIP を評価し、いずれにも該当しないときのみ per-row 検査する。
#     (0) MODEL_TIER_GATE_ENABLED（既定 true）が false/0/no/off → 最優先で SKIP。
#     (1) sqlite3 不在／workflow.db 不在／workflow_log テーブル不在 → SKIP。
#     (2) model_tier カラム不在（audit_has_column）→ SKIP（スキーマ未マイグレーション＝未採用）。
#     (3) 非空 model_tier 行が 1 件も存在しない → SKIP（tier 未使用＝対象外/非 Claude 運用と判定）。
#   ★grandfather: 各行の issue_path basename の YYYYMMDD_HHMMSS_ プレフィックスが MODEL_TIER_GATE_EFFECTIVE_FROM
#     （既定 20260714_000000・env 上書き可）未満なら遡及適用しない。プレフィックス非該当・空 issue_path は
#     判定不能として素通り（誤 FAIL を出さない安全側・ADR-6/ADR-8）。
#   ★判定（明記の有無のみ・MODEL_TIER_TABLE.md とは照合しない・ADR-3）:
#     model_tier が空/null/~ → FAIL（ティア未明記）／tier_rationale が空 → FAIL（根拠未明記）／
#     model_tier=fable（大小文字不問）かつ tier_exception が空 → FAIL（無申告 fable・#34 declined 同型・ADR-4）。
#   フィールド区切りは US（0x1f・非空白）で列崩れ（IFS 空白の連続畳み込み）を防ぎ、値中の改行/タブは空白へ正規化。
check_model_tier_recorded() {
  case "${MODEL_TIER_GATE_ENABLED:-true}" in
    [Ff][Aa][Ll][Ss][Ee]|0|[Nn][Oo]|[Oo][Ff][Ff]) return 0 ;;
  esac
  if ! command -v sqlite3 >/dev/null 2>&1 || [[ ! -f "$WF_DB" ]]; then echo "SKIP: #38（モデルティア記録有無の検知）をスキップします（workflow.db 不在または sqlite3 不在）" >&2; return 0; fi
  if ! sqlite3 "$WF_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_log';" 2>/dev/null | grep -q 'workflow_log'; then echo "SKIP: #38（モデルティア記録有無の検知）をスキップします（workflow_log テーブル不在）" >&2; return 0; fi
  # (2) model_tier カラム不在＝スキーマ未マイグレーション（tier 未採用）は SKIP。
  if ! audit_has_column "model_tier"; then echo "SKIP: #38（モデルティア記録有無の検知）をスキップします（model_tier カラム不在＝tier 未採用）" >&2; return 0; fi
  # (3) 非空 model_tier 行が 1 件も無い＝tier 未使用（非 Claude/未採用運用）は SKIP（安全側 fail-open）。
  local has_tier
  has_tier="$(sqlite3 "$WF_DB" "SELECT 1 FROM workflow_log WHERE model_tier IS NOT NULL AND TRIM(model_tier) != '' LIMIT 1;" 2>/dev/null || true)"
  if [[ -z "$has_tier" ]]; then echo "SKIP: #38（モデルティア記録有無の検知）をスキップします（非空 model_tier 行が皆無＝tier 未使用）" >&2; return 0; fi
  echo "[audit] checking model-tier-recorded (#38)" >&2
  local cutoff="${MODEL_TIER_GATE_EFFECTIVE_FROM:-20260714_000000}"
  local eid ip cmd mt tr te base ts
  # 値中の改行(char(10))/復帰(char(13))/タブ(char(9))を空白へ正規化して 1 行 1 レコードを保証。区切りは US(0x1f)。
  while IFS=$'\x1f' read -r eid ip cmd mt tr te; do
    [[ -z "$eid" ]] && continue
    # issue_path 空は判定不能として素通り（安全側・ADR-8）。
    [[ -z "$ip" ]] && continue
    base="$(basename -- "$ip" 2>/dev/null || echo "")"
    # grandfather: 日時プレフィックスが cutoff 未満なら遡及適用しない。非プレフィックスは判定不能として素通り。
    if [[ "$base" =~ ^([0-9]{8})_([0-9]{6})_ ]]; then
      ts="${BASH_REMATCH[1]}_${BASH_REMATCH[2]}"
      [[ "$ts" < "$cutoff" ]] && continue
    else
      continue
    fi
    # 判定1: ティア未明記（空/null/~）。NULLIF 経由で空文字列は NULL 化されるが両方を安全側で未記録扱い。
    if [[ -z "$mt" ]] || [[ "${mt,,}" == "null" ]] || [[ "$mt" == "~" ]]; then
      echo "FAIL: モデルティア未明記（委譲時の選定ティアが workflow_log に記録されていない。MODEL_TIER を書記へ渡すこと。entry_id=$eid / issue_path=$ip / command=$cmd）" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
      continue
    fi
    # 判定2: 根拠未明記。
    if [[ -z "$tr" ]]; then
      echo "FAIL: ティア選定根拠未明記（model_tier=$mt は記録されているが tier_rationale が空。MODEL_TIER_TABLE.md 該当行の引用 1 行を TIER_RATIONALE で渡すこと。entry_id=$eid / issue_path=$ip / command=$cmd）" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
      continue
    fi
    # 判定3: 無申告 fable（fable かつ tier_exception 空）。理由の内容妥当性は機械検知外＝人手監査（ADR-4）。
    if [[ "${mt,,}" == "fable" ]] && [[ -z "$te" ]]; then
      echo "FAIL: 無申告 fable（model_tier=fable だが tier_exception が空。ユーザーが当該 issue を最重要と明示指定した旨を TIER_EXCEPTION で申告すること。entry_id=$eid / issue_path=$ip / command=$cmd）" >&2
      echo "$ROLLBACK_MSG" >&2
      EXIT_CODE=1
      continue
    fi
  done < <(sqlite3 -separator $'\x1f' "$WF_DB" "SELECT entry_id, COALESCE(issue_path,''), COALESCE(command,''), COALESCE(replace(replace(replace(model_tier, char(9),' '), char(10),' '), char(13),' '),''), COALESCE(replace(replace(replace(tier_rationale, char(9),' '), char(10),' '), char(13),' '),''), COALESCE(replace(replace(replace(tier_exception, char(9),' '), char(10),' '), char(13),' '),'') FROM workflow_log;" 2>/dev/null || true)
}

# 39. find prune 規約検知（check_find_worktree_prune・B'・P2・BR-11・ベストエフォート lint）。
#   追跡対象シェル（enforcement/・scripts/ 配下 *.sh）に**ルート起点の unbounded find**
#   （`find "$PROJECT_ROOT"` 直後が閉じ引用符＝サブディレクトリでスコープされていない）が入り、かつ
#   同一行に `.worktree` の prune 節（`-path '*/.worktree' -prune` 等）を欠く場合を FAIL とする。
#   限界（正直に明記）: 静的 grep のため 1 行 find のみ対象・動的生成/複数行継続 find は検知外
#   （is_sqlite3_invocation と同じベストエフォート）。既存 audit.sh の find は全て $_wfd/$WORKFLOW_DIR/close
#   スコープ（"$PROJECT_ROOT/..."）であり root 起点でないため本検知の対象外（実測確認済み）。
#   SKIP: 非 git ツリー、または対象シェルが無い環境。
check_find_worktree_prune() {
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then
    echo "SKIP: #39 find prune 規約検知をスキップします（非 git ツリー）" >&2
    return 0
  fi
  echo "[audit] checking find .worktree prune convention (#39)" >&2
  local found=0 f line
  local -a targets=()
  while IFS= read -r f; do
    [[ -n "$f" ]] && targets+=("$f")
  done < <(cd "$PROJECT_ROOT" 2>/dev/null && git ls-files 'enforcement/*.sh' 'scripts/*.sh' '.agent-skill-chain/source/enforcement/*.sh' '.agent-skill-chain/source/scripts/*.sh' 2>/dev/null || true)
  # 検索ニードルは部品から組み立て、本 check 自身のソース行に contiguous な検知対象文字列が現れないようにする
  # （self-match 回避）。needle = `find <root> -`（ルート起点＋述語 `-`）の実コマンド形。
  local _root='"$PROJECT_ROOT"'
  local needle="find $_root -"
  local t _trim
  for t in "${targets[@]}"; do
    [[ -f "$PROJECT_ROOT/$t" ]] || continue
    # ルート起点 unbounded find の実コマンド形のみを対象にする。誤検知抑制:
    #   (a) コメント行（trim 後 '#' 始まり）はスキップ（本 check 自身の説明文を誤検知しない）。
    #   (b) 実コマンド形のみ＝ルート直後に述語 `-` が続く（`find <root> -name` 等）。コメント中の言及や
    #       スコープ付き find（`find <root>/<subdir>`）は本 needle に一致しない。
    while IFS= read -r line; do
      _trim="${line#"${line%%[![:space:]]*}"}"
      [[ "$_trim" == \#* ]] && continue
      if [[ "$line" == *"$needle"* ]]; then
        # ルート起点 unbounded find を検知。正しい prune 構造（`.worktree` ＋ `-prune` ＋ `-o` が同一 find
        #   式内に共起し後続処理と分岐している形＝`-path '*/.worktree' -prune -o …`）を伴う場合のみ許容する。
        #   単に `.worktree` 文字列を `-name` 対象や print 対象に含むだけで prune 構造を欠く迂回形は
        #   引き続き FAIL に倒す（finding-1: `.worktree` 存在有無だけの旧判定は迂回可能だった）。
        if [[ "$line" == *'.worktree'* && "$line" == *'-prune'* && "$line" == *'-o'* ]]; then
          :   # 正しい prune 構造あり → 許容
        else
          if [[ "$found" -eq 0 ]]; then
            echo "FAIL: ルート起点 unbounded find が .worktree prune を欠いています（新規 find は -path '*/.worktree' -prune -o … を入れること・#39・BR-11）:" >&2
            found=1
          fi
          echo "  $t: $line" >&2
        fi
      fi
    done < "$PROJECT_ROOT/$t"
  done
  if [[ "$found" -eq 1 ]]; then
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
}

# 40. 非準拠ブランチ名の事後検知（check_worktree_branch_naming・Tier2・BR-14・SC-10）。
#   全ローカルブランチ名を列挙し、grandfather baseline に**無い**新規ブランチ名が命名規則
#   <type>/<YYYYMMDD_HHMMSS>/<固有名>（type=feature|bugfix|hotfix|release|chore）に非準拠なら FAIL
#   （Tier1 hook の網羅バックストップ）。
#   SKIP（多層・fail-open）: 非 git ツリー／WORKTREE_NAMING_AUDIT_ENABLED（既定 true）が false／
#   grandfather baseline ファイル不在（初回導入で既存ブランチを誤 FAIL させない・SC-7 非破壊）。
#   grandfather: baseline（.agent-skill-chain/project/worktree-naming-grandfather.txt・'#'/空行無視）に載る
#   名前は既存＝対象外（Tier3 allowlist としても機能・gh pr checkout 由来等はここへ追記して救済・BR-15）。
check_worktree_branch_naming() {
  case "${WORKTREE_NAMING_AUDIT_ENABLED:-true}" in
    [Ff][Aa][Ll][Ss][Ee]|0|[Nn][Oo]|[Oo][Ff][Ff]) return 0 ;;
  esac
  if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then
    echo "SKIP: #40 非準拠ブランチ名の事後検知をスキップします（非 git ツリー）" >&2
    return 0
  fi
  local baseline="$PROJECT_ROOT/.agent-skill-chain/project/worktree-naming-grandfather.txt"
  if [[ ! -f "$baseline" ]]; then
    echo "SKIP: #40 非準拠ブランチ名の事後検知をスキップします（grandfather baseline 不在＝初回導入前）" >&2
    return 0
  fi
  echo "[audit] checking worktree branch naming (#40)" >&2
  # baseline を連想配列へ（'#'/空行除去・前後空白 trim）。
  declare -A _gf=()
  local gl
  while IFS= read -r gl || [[ -n "$gl" ]]; do
    gl="${gl%%$'\r'}"
    gl="${gl#"${gl%%[![:space:]]*}"}"; gl="${gl%"${gl##*[![:space:]]}"}"
    [[ -z "$gl" || "$gl" == \#* ]] && continue
    _gf["$gl"]=1
  done < "$baseline"
  # ブランチ名妥当性（LC_ALL=C・validate_branch_ref 相当を自己完結で実装）。
  _audit_valid_branch_ref() {
    local LC_ALL=C ref="$1" type ts name rest
    [[ -z "$ref" ]] && return 1
    type="${ref%%/*}"; rest="${ref#*/}"
    [[ "$rest" == "$ref" ]] && return 1
    ts="${rest%%/*}"; name="${rest#*/}"
    [[ "$name" == "$rest" ]] && return 1
    case "$type" in feature|bugfix|hotfix|release|chore) ;; *) return 1 ;; esac
    [[ "$ts" =~ ^[0-9]{8}_[0-9]{6}$ ]] || return 1
    [[ -z "$name" ]] && return 1
    (( ${#name} > 200 )) && return 1              # 長さ上限（LC_ALL=C でバイト数）。Tier1 validate_name と対称（finding-2）
    case "$name" in .*|-*|*..*|*.lock|*/*) return 1 ;; esac
    local danger; danger=$(printf ' \t;&|$`"'\''\\<>(){}[^~:#?*!\177')
    case "$name" in *["$danger"]*) return 1 ;; esac
    case "$name" in *[]]*) return 1 ;; esac
    return 0
  }
  local br found=0
  declare -A _seen=()
  while IFS= read -r br; do
    [[ -z "$br" ]] && continue
    [[ -n "${_seen[$br]:-}" ]] && continue        # 重複除去（GITHUB_HEAD_REF とローカル branch の重なり）
    _seen["$br"]=1
    [[ -n "${_gf[$br]:-}" ]] && continue          # grandfather 救済
    if ! _audit_valid_branch_ref "$br"; then
      if [[ "$found" -eq 0 ]]; then
        echo "FAIL: 命名規則に非準拠なブランチ名（baseline 未登録の新規）が存在します（#40・BR-14。<type>/<YYYYMMDD_HHMMSS>/<name> に是正、または gh pr checkout 由来等なら baseline へ追記して救済）:" >&2
        found=1
      fi
      echo "  $br" >&2
    fi
  done < <(
    # CI（GitHub Actions）では actions/checkout が PR のマージコミットを detached HEAD で checkout するため、
    #   git branch だけでは PR の source branch を拾えない。GITHUB_HEAD_REF（設定時のみ・GitHub Actions 標準）を
    #   列挙対象へ追加する。既存のローカル branch 列挙への追加に留め、無差別な remote 全列挙は行わない
    #   （他者のリモートブランチを誤 FAIL しない）。非 CI（未設定）は従来どおりローカル branch のみ（fail-safe）。
    #   grandfather baseline による救済は GITHUB_HEAD_REF にも同様に効く（上のループの _gf 判定）。
    [[ -n "${GITHUB_HEAD_REF:-}" ]] && printf '%s\n' "$GITHUB_HEAD_REF"
    git -C "$PROJECT_ROOT" branch --format='%(refname:short)' 2>/dev/null || true
  )
  if [[ "$found" -eq 1 ]]; then
    echo "$ROLLBACK_MSG" >&2
    EXIT_CODE=1
  fi
  unset -f _audit_valid_branch_ref 2>/dev/null || true
}

check_code_comment_external_ref
check_review_dual_lists
check_issue_doc_in_gitignored_path
check_review_before_implement
check_docs_review_evidence
check_reviewdocs_before_implement
check_close_move_pending
check_github_issue_before_implement
check_branch_linkage_before_implement
check_pr_issue_linkage
check_docs_transient_issue_ref
check_model_tier_recorded
check_find_worktree_prune
check_worktree_branch_naming

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "Audit passed."
fi
exit $EXIT_CODE
