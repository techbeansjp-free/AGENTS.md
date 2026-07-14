#!/usr/bin/env bash
# test-model-tier-gate.sh — audit.sh #38（check_model_tier_recorded）の隔離回帰テスト。
#
# ユースケース（このテストファイル全体）:
#   モデルティア明記義務の機械検証（#38）が、workflow_log の行単位でティア未明記・根拠未明記・
#   無申告 fable を FAIL し、明記済み行・fable 申告あり行を PASS とし、対象外環境（トグル off・
#   カラム不在・DB 不在・tier 全 NULL）では SKIP してロックアウトしないこと、および grandfather
#   （発効日未満・非プレフィックス issue_path）で遡及 FAIL しないことを検証する。判定ロジックは
#   audit.sh 側を再実装せず、audit.sh を隔離 DB に対して実行した結果（PASS/FAIL/SKIP・EXIT_CODE）
#   を確認する。
#
# 方針（破壊禁止・tmp 隔離 必須・.agent-skill-chain/project/自己拡張ワークフロー.md §テストの tmp 隔離）:
#   - 検証は mktemp -d の隔離ツリー（workflow.db を隔離ツリー配下に新規作成）で行う。本開発リポの
#     .agent-skill-chain/source/ .agent-skill-chain/runtime/ workflow.db を一切読み書き・変更しない
#     （audit.sh 本体のみ読み取りで参照する）。
#   - 各 workflow_log は「#38 が参照する列のみ」を持つ最小テーブルとして作成する（#12〜#17 等の
#     列依存チェックは対象列が存在しないため自動的に SKIP し、#38 以外の判定と非交差になる。
#     既存 test-audit.sh の #34/#35 シナリオと同型の手法）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 既存チェックとの非交差・回帰確認について:
#   #38 追加が既存チェック（#3/#8/#12-#37）の挙動を変えていないことは、本ファイルではなく
#   既存の test/test-audit.sh（判定ロジック不変の回帰スイート）を実行して確認する
#   （単一正本・二重実装しない）。本ファイルは #38 固有の判定・grandfather・fail-open のみを扱う。
#
# 使い方:
#   bash test/test-model-tier-gate.sh   # リポジトリルートで実行
#
# 前提: bash・sqlite3（sqlite3 が無い場合は exit 2 で SKIP。run-all.sh の依存規約に合わせる）。
# 参照:
#   docs/maintainer/workflow/20260714_204451_モデルティア明記義務の機械強制欠如/02_設計.md（ADR-3〜ADR-8）, 03_実装計画.md（T4・§2.4）
#   .agent-skill-chain/source/enforcement/ci/audit.sh（check_model_tier_recorded・#38）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

# 呼び出し元シェルの環境変数汚染からテストを隔離する（#38 が参照する env のうち、
# テストが呼び出しごとに設定しないものを unset して既定解決を保証する）。
unset AGENTS_ROOT WORKFLOW_DIR WORKFLOW_DIRS MODEL_TIER_GATE_ENABLED MODEL_TIER_GATE_EFFECTIVE_FROM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"   # test/ -> repo root（配置非依存）
AUDIT="$REPO_ROOT/.agent-skill-chain/source/enforcement/ci/audit.sh"

[[ -f "$AUDIT" ]] || { echo "エラー: audit.sh が見つからない: $AUDIT" >&2; exit 2; }

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "[SKIP] test-model-tier-gate.sh: 必須依存 sqlite3 なし" >&2
  exit 2
fi

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_grep() { grep -q -- "$1" <<<"$2" && ok "${3:-出力に '$1'}" || ng "${3:-出力に '$1' が無い}: $2"; }
assert_no_grep() { grep -q -- "$1" <<<"$2" && ng "${3:-出力に '$1' があってはならない}: $2" || ok "${3:-出力に '$1' なし}"; }

# 隔離ツリーをまとめて掃除する
TMP_DIRS=()
cleanup() { for d in "${TMP_DIRS[@]:-}"; do [[ -n "$d" && -d "$d" ]] && rm -rf "$d"; done; }
trap cleanup EXIT

# .agent-skill-chain/runtime のみを持つ最小ツリーを作る（.agent-skill-chain/source は作らないため
# 必須ファイル存在チェック（audit.sh #2）は AGENTS_ROOT 不在で自然に非発火となる）。
make_db_tree() {
  local tmp
  tmp="$(mktemp -d)"
  TMP_DIRS+=("$tmp")
  mkdir -p "$tmp/.agent-skill-chain/runtime"
  printf '%s\n' "$tmp"
}

echo "== test-model-tier-gate.sh =="

# ============================================================================
# シナリオ群 A: #38 固有の判定（未明記/明記/fable申告/根拠欠落/~値/大文字fable/grandfather/非プレフィックス）
#   9 シナリオを 1 つの DB・1 回の audit 実行にまとめ、各 entry_id の FAIL 有無で判定する
#   （#38 は行単位の独立判定のため、同一 DB 内の複数行を 1 回の SELECT 走査で検証できる）。
# ============================================================================
echo "-- シナリオ群 A: #38 判定（未明記/明記/fable申告/根拠欠落/~値/大文字fable/grandfather/非プレフィックス） --"

A_TREE="$(make_db_tree)"
A_DB="$A_TREE/.agent-skill-chain/runtime/workflow.db"
sqlite3 "$A_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, model_tier TEXT NULL, tier_rationale TEXT NULL, tier_exception TEXT NULL);"

# シナリオ1（UC1-S1・未明記 FAIL）
# Given: cutoff（既定 20260714_000000）以降の issue_path で model_tier が NULL の行
sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e_unmarked', 'implement-feature', 'docs/maintainer/workflow/20260715_000000_scenario', NULL, NULL, NULL);"

# シナリオ2（UC1-S2・明記 PASS）
# Given: model_tier=opus・tier_rationale 非空の行
sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e_marked', 'design-feature', 'docs/maintainer/workflow/20260715_000000_scenario', 'opus', '設計・レビュー・監査 | opus | 常に opus', NULL);"

# シナリオ3（UC2-S1・fable 申告あり PASS）
# Given: model_tier=fable・tier_rationale 非空・tier_exception 非空の行
sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e_fable_ok', 'implement-feature', 'docs/maintainer/workflow/20260715_000000_scenario', 'fable', 'ユーザー最重要指定', 'ユーザーが当該issueを最重要と明示指定');"

# シナリオ4（UC2-S2・fable 無申告 FAIL）
# Given: model_tier=fable・tier_rationale 非空・tier_exception 空の行
sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e_fable_ng', 'implement-feature', 'docs/maintainer/workflow/20260715_000000_scenario', 'fable', 'ユーザー最重要指定', NULL);"

# シナリオ5（大文字 FABLE・無申告 FAIL・大小文字不問の確認）
# Given: model_tier=FABLE（大文字）・tier_exception 空の行
sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e_fable_upper_ng', 'implement-feature', 'docs/maintainer/workflow/20260715_000000_scenario', 'FABLE', '根拠', NULL);"

# シナリオ5b（大文字 FABLE・申告あり PASS）
# Given: model_tier=FABLE（大文字）・tier_exception 非空の行
sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e_fable_upper_ok', 'implement-feature', 'docs/maintainer/workflow/20260715_000000_scenario', 'FABLE', '根拠', '例外理由あり');"

# シナリオ6（根拠欠落 FAIL）
# Given: model_tier=sonnet（非空）・tier_rationale 空の行
sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e_no_rationale', 'implement-feature', 'docs/maintainer/workflow/20260715_000000_scenario', 'sonnet', NULL, NULL);"

# シナリオ7（~ 値 FAIL・未明記同型）
# Given: model_tier が YAML null 相当の '~' の行
sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e_tilde', 'implement-feature', 'docs/maintainer/workflow/20260715_000000_scenario', '~', NULL, NULL);"

# シナリオ12（grandfather 素通り）
# Given: issue_path basename の日時プレフィックスが既定 cutoff（20260714_000000）未満の未明記行
sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e_grandfather', 'implement-feature', 'docs/maintainer/workflow/20260710_000000_old_scenario', NULL, NULL, NULL);"

# シナリオ13（非プレフィックス issue_path 素通り）
# Given: issue_path の basename が YYYYMMDD_HHMMSS_ プレフィックス形式でない未明記行
sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e_nonprefixed', 'implement-feature', 'docs/maintainer/workflow/close/legacy_issue_no_prefix', NULL, NULL, NULL);"

# When: audit.sh を実行する（既定 env・トグル既定 true・cutoff 既定 20260714_000000）
A_OUT="$(bash "$AUDIT" "$A_TREE" 2>&1)"

# Then: 各行の期待どおりの PASS/FAIL
assert_grep "entry_id=e_unmarked" "$A_OUT" "#38 未明記行(e_unmarked)は FAIL する"
assert_no_grep "entry_id=e_marked" "$A_OUT" "#38 明記済み行(e_marked)は FAIL しない"
assert_no_grep "entry_id=e_fable_ok" "$A_OUT" "#38 fable申告あり行(e_fable_ok)は FAIL しない"
assert_grep "entry_id=e_fable_ng" "$A_OUT" "#38 fable無申告行(e_fable_ng)は FAIL する"
assert_grep "entry_id=e_fable_upper_ng" "$A_OUT" "#38 大文字FABLE無申告行(e_fable_upper_ng)は FAIL する（大小文字不問）"
assert_no_grep "entry_id=e_fable_upper_ok" "$A_OUT" "#38 大文字FABLE申告あり行(e_fable_upper_ok)は FAIL しない（大小文字不問）"
assert_grep "entry_id=e_no_rationale" "$A_OUT" "#38 根拠欠落行(e_no_rationale)は FAIL する"
assert_grep "entry_id=e_tilde" "$A_OUT" "#38 ~値行(e_tilde)は未明記として FAIL する"
assert_no_grep "entry_id=e_grandfather" "$A_OUT" "#38 grandfather対象行(e_grandfather)は遡及 FAIL しない"
assert_no_grep "entry_id=e_nonprefixed" "$A_OUT" "#38 非プレフィックスissue_path行(e_nonprefixed)は判定不能として素通りする"

# ============================================================================
# シナリオ8（UC3-S1・全 NULL SKIP）
# ============================================================================
echo "-- シナリオ8: 非空 model_tier 行が皆無なら SKIP（ロックアウトしない） --"

# Given: model_tier カラムは存在するが全行 NULL（tier 未使用環境）
B_TREE="$(make_db_tree)"
B_DB="$B_TREE/.agent-skill-chain/runtime/workflow.db"
sqlite3 "$B_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, model_tier TEXT NULL, tier_rationale TEXT NULL, tier_exception TEXT NULL);"
sqlite3 "$B_DB" "INSERT INTO workflow_log VALUES ('e_b1', 'implement-feature', 'docs/maintainer/workflow/20260715_000000_allnull', NULL, NULL, NULL);"
sqlite3 "$B_DB" "INSERT INTO workflow_log VALUES ('e_b2', 'design-feature', 'docs/maintainer/workflow/20260715_000000_allnull', NULL, NULL, NULL);"

# When: audit.sh を実行する
B_OUT="$(bash "$AUDIT" "$B_TREE" 2>&1)"; B_RC=$?

# Then: SKIP メッセージが出て、#38 由来の FAIL は出ず、exit 0 を保つ
assert_grep "SKIP:.*非空 model_tier 行が皆無" "$B_OUT" "全 NULL は SKIP メッセージを出す"
assert_no_grep "entry_id=e_b1" "$B_OUT" "全 NULL では未明記 FAIL を出さない（tier 未使用環境の誤検知防止）"
if [[ $B_RC -eq 0 ]]; then ok "全 NULL でも exit 0（ロックアウトしない）"; else ng "全 NULL で exit != 0 になった（実際 rc=$B_RC）: $B_OUT"; fi

# ============================================================================
# シナリオ9（model_tier カラム不在 SKIP）
# ============================================================================
echo "-- シナリオ9: model_tier カラム不在（スキーマ未マイグレーション）なら SKIP --"

# Given: workflow_log は存在するが model_tier/tier_rationale/tier_exception カラムを持たない旧スキーマ
C_TREE="$(make_db_tree)"
C_DB="$C_TREE/.agent-skill-chain/runtime/workflow.db"
sqlite3 "$C_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL);"
sqlite3 "$C_DB" "INSERT INTO workflow_log VALUES ('e_c1', 'implement-feature', 'docs/maintainer/workflow/20260715_000000_nocolumn');"

# When: audit.sh を実行する
C_OUT="$(bash "$AUDIT" "$C_TREE" 2>&1)"; C_RC=$?

# Then: カラム不在の SKIP メッセージが出て、exit 0 を保つ（未採用環境をロックアウトしない）
assert_grep "SKIP:.*model_tier カラム不在" "$C_OUT" "カラム不在は SKIP メッセージを出す"
if [[ $C_RC -eq 0 ]]; then ok "カラム不在でも exit 0（ロックアウトしない）"; else ng "カラム不在で exit != 0 になった（実際 rc=$C_RC）: $C_OUT"; fi

# ============================================================================
# シナリオ10（MODEL_TIER_GATE_ENABLED=false によるトグル off SKIP）
# ============================================================================
echo "-- シナリオ10: MODEL_TIER_GATE_ENABLED=false で最優先 SKIP（他のどのガードよりも先） --"

# Given: 本来なら未明記 FAIL になるはずの行を含む DB
D_TREE="$(make_db_tree)"
D_DB="$D_TREE/.agent-skill-chain/runtime/workflow.db"
sqlite3 "$D_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, model_tier TEXT NULL, tier_rationale TEXT NULL, tier_exception TEXT NULL);"
sqlite3 "$D_DB" "INSERT INTO workflow_log VALUES ('e_d1', 'implement-feature', 'docs/maintainer/workflow/20260715_000000_toggleoff', NULL, NULL, NULL);"
sqlite3 "$D_DB" "INSERT INTO workflow_log VALUES ('e_d2', 'design-feature', 'docs/maintainer/workflow/20260715_000000_toggleoff', 'opus', '根拠', NULL);"

# When: MODEL_TIER_GATE_ENABLED=false を指定して audit.sh を実行する
D_OFF_OUT="$(MODEL_TIER_GATE_ENABLED=false bash "$AUDIT" "$D_TREE" 2>&1)"
# 対照: 既定（未設定）では従来どおり FAIL する（トグルの効果が本物であることの確認）
D_DEFAULT_OUT="$(bash "$AUDIT" "$D_TREE" 2>&1)"

# Then: トグル off では FAIL しない。既定では FAIL する（回帰なし）
assert_no_grep "entry_id=e_d1" "$D_OFF_OUT" "MODEL_TIER_GATE_ENABLED=false で未明記行も FAIL しない（最優先 SKIP）"
assert_grep "entry_id=e_d1" "$D_DEFAULT_OUT" "トグル既定（未設定）では従来どおり FAIL する（回帰なし）"

# ============================================================================
# シナリオ11（workflow.db 不在 SKIP）
# ============================================================================
echo "-- シナリオ11: workflow.db 不在なら SKIP（DB 非採用環境をロックアウトしない） --"

# Given: .agent-skill-chain/runtime ディレクトリはあるが workflow.db が存在しない最小ツリー
E_TREE="$(make_db_tree)"

# When: audit.sh を実行する
E_OUT="$(bash "$AUDIT" "$E_TREE" 2>&1)"; E_RC=$?

# Then: #38 の FAIL は出ず、exit 0 を保つ
if ! grep -q "^FAIL:.*モデルティア" <<< "$E_OUT" && ! grep -q "^FAIL:.*ティア選定根拠" <<< "$E_OUT" && ! grep -q "^FAIL:.*無申告 fable" <<< "$E_OUT"; then
  ok "workflow.db 不在で #38 由来の FAIL が出ない"
else
  ng "workflow.db 不在なのに #38 由来の FAIL が出た: $E_OUT"
fi
if [[ $E_RC -eq 0 ]]; then ok "workflow.db 不在でも exit 0（ロックアウトしない）"; else ng "workflow.db 不在で exit != 0 になった（実際 rc=$E_RC）: $E_OUT"; fi

# ============================================================================
# シナリオ14（MODEL_TIER_GATE_EFFECTIVE_FROM の env 上書き）
# ============================================================================
echo "-- シナリオ14: MODEL_TIER_GATE_EFFECTIVE_FROM の env 上書きで grandfather 境界が動く --"

# Given: issue_path prefix が既定 cutoff（20260714_000000）未満（20260710_000000）の未明記行
#        （他に非空 model_tier 行が存在し、#38 の SKIP 段階4を回避する）
F_TREE="$(make_db_tree)"
F_DB="$F_TREE/.agent-skill-chain/runtime/workflow.db"
sqlite3 "$F_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, model_tier TEXT NULL, tier_rationale TEXT NULL, tier_exception TEXT NULL);"
sqlite3 "$F_DB" "INSERT INTO workflow_log VALUES ('e_f1', 'implement-feature', 'docs/maintainer/workflow/20260710_000000_override', NULL, NULL, NULL);"
sqlite3 "$F_DB" "INSERT INTO workflow_log VALUES ('e_f2', 'design-feature', 'docs/maintainer/workflow/20260710_000000_override', 'opus', '根拠', NULL);"

# When(1): 既定 cutoff（20260714_000000）で実行する
F_DEFAULT_OUT="$(bash "$AUDIT" "$F_TREE" 2>&1)"
# When(2): MODEL_TIER_GATE_EFFECTIVE_FROM を行の prefix より前（20260701_000000）へ上書きして実行する
F_OVERRIDE_OUT="$(MODEL_TIER_GATE_EFFECTIVE_FROM=20260701_000000 bash "$AUDIT" "$F_TREE" 2>&1)"

# Then: 既定では cutoff 未満のため grandfather で FAIL しないが、cutoff を前倒しすると対象化され FAIL する
assert_no_grep "entry_id=e_f1" "$F_DEFAULT_OUT" "既定 cutoff では発効日未満の行は grandfather で FAIL しない"
assert_grep "entry_id=e_f1" "$F_OVERRIDE_OUT" "MODEL_TIER_GATE_EFFECTIVE_FROM を前倒しすると同じ行が FAIL する（上書きが効いている）"

# ---- サマリ ---------------------------------------------------------------------
echo "--------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "失敗: ${FAILED_NAMES[*]}"
  exit 1
fi
echo "test-model-tier-gate.sh: すべて PASS"
exit 0
