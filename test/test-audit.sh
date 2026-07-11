#!/usr/bin/env bash
# test-audit.sh — audit.sh の後方互換・自己テスト（DB 不採用・非 git ツリーで SKIP→PASS）。
#
# ユースケース（このテストファイル全体）:
#   audit.sh が、workflow.db を採用しない環境・.git の無い非 git ツリーでも
#   エラー終了せず、DB 依存 check（#8/#9/#11/#12–#21/#29）・git 依存 check（#18/#19/#25/#27/#28）が
#   SKIP し、必須ファイルが揃った最小 issue ツリーで「Audit passed.」（exit 0）すること。
#   判定ロジックは変更しないため、本テストは挙動不変の回帰として機能する。
#
# 方針（破壊禁止・tmp 隔離 必須・.agent-skill-chain/project/自己拡張ワークフロー.md §テストの tmp 隔離）:
#   - 検証は mktemp -d の隔離ツリーで行う。本開発リポの .agent-skill-chain/source/ .claude/ .cursor/ .agent-skill-chain/runtime/ workflow.db を
#     一切読み書き・変更しない（audit.sh 本体のみ読み取りで参照する）。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-audit.sh   # リポジトリルートで実行
#
# 前提: bash。sqlite3・git は任意（無くても SKIP として通る）。
# 参照:
#   docs/maintainer/workflow/20260614_235244_enforcement宣言と実装の乖離是正/02_設計.md, 03_実装計画.md（T4）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"   # test/ -> repo root（配置非依存）
AUDIT="$REPO_ROOT/.agent-skill-chain/source/enforcement/ci/audit.sh"

[[ -f "$AUDIT" ]] || { echo "エラー: audit.sh が見つからない: $AUDIT" >&2; exit 2; }

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }

# 隔離ツリーをまとめて掃除する
TMP_DIRS=()
cleanup() { for d in "${TMP_DIRS[@]:-}"; do [[ -n "$d" && -d "$d" ]] && rm -rf "$d"; done; }
trap cleanup EXIT

# 最小 issue ツリーを tmp に作る（必須ファイル＋.workflow 走査基点）。DB も .git も作らない。
make_min_tree() {
  local tmp
  tmp="$(mktemp -d)"
  TMP_DIRS+=("$tmp")
  mkdir -p "$tmp/.agent-skill-chain/source/boot" "$tmp/.agent-skill-chain/source/workflow" "$tmp/.agent-skill-chain/runtime"
  : > "$tmp/.agent-skill-chain/source/boot/CORE.md"
  : > "$tmp/.agent-skill-chain/source/boot/LOAD_POLICY.md"
  : > "$tmp/.agent-skill-chain/source/workflow/PHASES.md"
  : > "$tmp/.agent-skill-chain/source/workflow/TEMPLATES.md"
  printf '%s\n' "$tmp"
}

echo "== test-audit.sh =="

# シナリオ1: DB 不採用・非 git ツリーで audit が SKIP し成功する
# Given: workflow.db が存在せず .git も存在しない最小 issue ツリー（tmp 隔離）
# When:  audit.sh <tmp> を実行する
# Then:  終了コードが 0（Audit passed）であり、出力に "Audit passed." を含む
T1_TREE="$(make_min_tree)"
T1_OUT="$(bash "$AUDIT" "$T1_TREE" 2>&1)"; T1_RC=$?
if [[ $T1_RC -eq 0 ]]; then ok "DB 不採用・非 git ツリーで exit 0"; else ng "DB 不採用・非 git ツリーで exit 0（実際 rc=$T1_RC）"; fi
if grep -q "Audit passed." <<< "$T1_OUT"; then ok "出力に Audit passed. を含む"; else ng "出力に Audit passed. が無い: $T1_OUT"; fi

# シナリオ2: 非 git ツリーで git 依存 check がエラー終了しない（FAIL を出さない）
# Given: 内容を満たす 04_review.md を含む最小ツリー（.git 無し）— 通常 #18/#27/#28 等の git 依存 check の対象
#        （04 の内容系 check（#3/#4/#27）を満たすので、残るのは git 依存 check のみ）
# When:  audit.sh <tmp> を実行する
# Then:  git 依存 check は SKIP され FAIL: を出さず exit 0
T2_TREE="$(make_min_tree)"
mkdir -p "$T2_TREE/.agent-skill-chain/runtime/20260101_000000_dummy"
cat > "$T2_TREE/.agent-skill-chain/runtime/20260101_000000_dummy/04_review.md" <<'EOF'
# 04_review

## 敵対的観点
- ダミーの敵対的観点

## must-preserve（不変条件）
- ダミーの不変条件

## docs 更新
- 要否: 不要
- 対象: なし
- 理由: 文書のみ
EOF
T2_OUT="$(bash "$AUDIT" "$T2_TREE" 2>&1)"; T2_RC=$?
if [[ $T2_RC -eq 0 ]]; then ok "非 git ツリー＋04 存在でも git 依存 check SKIP し exit 0"; else ng "非 git ツリーで exit 0（実際 rc=$T2_RC）: $T2_OUT"; fi
if ! grep -q "^FAIL:" <<< "$T2_OUT"; then ok "非 git ツリーで FAIL: 行が出ない"; else ng "非 git ツリーで FAIL: 行が出た: $T2_OUT"; fi

# シナリオ3: 必須ファイル欠落は従来どおり FAIL する（判定ロジック不変の確認）
# Given: 必須ファイル CORE.md を欠いた最小ツリー
# When:  audit.sh <tmp> を実行する
# Then:  必須ファイル未参照で FAIL し exit 0 以外
T3_TREE="$(make_min_tree)"
rm -f "$T3_TREE/.agent-skill-chain/source/boot/CORE.md"
T3_OUT="$(bash "$AUDIT" "$T3_TREE" 2>&1)"; T3_RC=$?
if [[ $T3_RC -ne 0 ]]; then ok "必須ファイル欠落で exit != 0（判定不変）"; else ng "必須ファイル欠落でも exit 0 になった: $T3_OUT"; fi
if grep -q "Missing required file" <<< "$T3_OUT"; then ok "必須ファイル未参照の FAIL メッセージを出す"; else ng "必須ファイル未参照メッセージが無い: $T3_OUT"; fi

# シナリオ4: #17 close ガードが issue_path のファイル粒度記録でも close 完了 issue を除外する
# Given: close 配下に実在する issue ディレクトリ <C> と、workflow.db に「親が implement/design でない
#        verify-and-close 行」が 2 件（issue_path がディレクトリ粒度 .../<C>/ と ファイル粒度 .../<C>/04_review.md）
# When:  audit.sh <tmp> を実行する（DB 同梱・close 配下のため #17 は対象外であるべき）
# Then:  #17 ERROR（verify-and-close parent must be ...）を発火しない（basename 限定漏れの回帰防止）
if command -v sqlite3 >/dev/null 2>&1; then
  T4_TREE="$(make_min_tree)"
  C="20260101_000000_closed_issue"
  mkdir -p "$T4_TREE/docs/maintainer/workflow/close/$C"
  : > "$T4_TREE/docs/maintainer/workflow/close/$C/04_review.md"
  T4_DB="$T4_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$T4_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  # 親 (orphan) verify-and-close 行: issue_path はディレクトリ粒度（close 前パス）。basename 一致で除外される従来ケース。
  sqlite3 "$T4_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'verify-and-close', 'docs/maintainer/workflow/$C/');" 2>/dev/null
  # 親 (orphan) verify-and-close 行: issue_path はファイル粒度（close 前パス）。basename='04_review.md' で従来は誤発火していたケース。
  sqlite3 "$T4_DB" "INSERT INTO workflow_log VALUES ('e2', NULL, 'verify-and-close', 'docs/maintainer/workflow/$C/04_review.md');" 2>/dev/null
  T4_OUT="$(bash "$AUDIT" "$T4_TREE" 2>&1)"
  if ! grep -q "verify-and-close parent must be" <<< "$T4_OUT"; then
    ok "#17 close ガードがファイル粒度 issue_path でも close 完了 issue を除外（誤 #17 ERROR 無し）"
  else
    ng "#17 close 完了 issue でも ERROR 発火（basename 限定漏れ回帰）: $T4_OUT"
  fi

  # シナリオ4b: close 外の正当な #17 は維持される（過剰除外していないことの確認）
  # Given: close 在籍 issue 名に一致しない in-progress issue の orphan verify-and-close 行
  # When:  audit.sh <tmp> を実行する
  # Then:  #17 ERROR を発火する（close ガードが close 外の正当な違反まで握り潰さない）
  sqlite3 "$T4_DB" "INSERT INTO workflow_log VALUES ('e3', NULL, 'verify-and-close', 'docs/maintainer/workflow/20260202_000000_inprogress/04_review.md');" 2>/dev/null
  T4B_OUT="$(bash "$AUDIT" "$T4_TREE" 2>&1)"
  if grep -q "verify-and-close parent must be" <<< "$T4B_OUT"; then
    ok "#17 は close 外の正当な親違反を維持（過剰除外なし）"
  else
    ng "#17 が close 外の正当な違反まで除外している（過剰除外）: $T4B_OUT"
  fi
else
  echo "  [SKIP] #17 close ガード回帰（sqlite3 不在）"
fi

# =============================================================================
# #7 残骸・マーカ系チェックの偽陽性是正（回帰テスト）
#   tmp 隔離（mktemp -d）で実行し、本リポ本番ファイルは読み取りのみ（make_min_tree が tmp を作る）。
#   #7 は WORKFLOW_SCAN_DIRS 配下の *.md を走査し、フェンス除去→インラインコード除去→
#   実マーカ構文アンカー（(TODO|FIXME)[[:space:]]*[:：(]）で判定する。
#   実マーカは FAIL（偽陰性ゼロ）、散文の言及・例示は PASS（偽陽性除去）であること。
# =============================================================================

# シナリオ: 言及のみの散文は PASS（SC1）
# Given: .workflow 配下 .md に「TODO/FIXME 残骸チェック」「残骸タグ（TODO 等）0件」のみ（実マーカ構文なし）
# When:  audit.sh <tmp> を実行する
# Then:  終了コード 0 で「重要パスに TODO/FIXME が残存」を出力しない
SC1_TREE="$(make_min_tree)"
mkdir -p "$SC1_TREE/.agent-skill-chain/runtime/20260101_000000_x"
printf '本 issue では「TODO/FIXME 残骸チェック」の偽陽性を是正する。\nレビュー証跡: 残骸タグ（TODO 等）0件を確認した。\n' \
  > "$SC1_TREE/.agent-skill-chain/runtime/20260101_000000_x/00_要求定義.md"
SC1_OUT="$(bash "$AUDIT" "$SC1_TREE" 2>&1)"; SC1_RC=$?
if [[ $SC1_RC -eq 0 ]] && ! grep -q '重要パスに TODO/FIXME が残存' <<< "$SC1_OUT"; then
  ok "C-SC1 言及のみの散文は PASS"
else
  ng "C-SC1 言及のみで FAIL した（rc=$SC1_RC）: $SC1_OUT"
fi

# シナリオ: 実マーカは従来どおり FAIL（SC2・偽陰性ゼロ）— 散文/箇条書きの各形態
# Given: コードブロック外・バッククォート外の散文として実マーカが書かれた .md（各形態を別ツリーで）
# When:  audit.sh <tmp> を実行する
# Then:  #7 が「重要パスに TODO/FIXME が残存」で FAIL する
sc2_case() {
  # $1=ラベル $2=ファイル内容 $3=期待（fail|pass）
  local label="$1" content="$2" expect="$3" tree out
  tree="$(make_min_tree)"
  mkdir -p "$tree/.agent-skill-chain/runtime/20260101_000000_m"
  printf '%b' "$content" > "$tree/.agent-skill-chain/runtime/20260101_000000_m/00_要求定義.md"
  out="$(bash "$AUDIT" "$tree" 2>&1)"
  if grep -q '重要パスに TODO/FIXME が残存' <<< "$out"; then
    if [[ "$expect" == fail ]]; then ok "$label"; else ng "$label（FAIL すべきでないのに FAIL）: $out"; fi
  else
    if [[ "$expect" == pass ]]; then ok "$label"; else ng "$label（FAIL すべきが PASS=偽陰性）: $out"; fi
  fi
}
sc2_case "C-SC2a 実マーカ // TODO: x は FAIL"        '// TODO: fix this later\n'      fail
sc2_case "C-SC2b 実マーカ <!-- FIXME: y --> は FAIL" '<!-- FIXME: fix this later -->\n' fail
sc2_case "C-SC2c 実マーカ 箇条書き - TODO: z は FAIL" '- TODO: 残対応\n'                 fail
sc2_case "C-SC2d 実マーカ TODO(owner): w は FAIL"     'TODO(alice): refactor\n'         fail
# 全角コロン形: 環境（ロケール）で揺れうるが LC_ALL=C 採用で安定（02 §5・バリデーション観点）。
sc2_case "C-SC2e 実マーカ 全角 TODO：v は FAIL"       'TODO：全角コロンの未処理\n'       fail

# シナリオ: バッククォート例示は PASS（SC4a・00/01 自己言及型）
# Given: .md に `TODO:` `FIXME:` がバッククォート例示として日本語散文中に含まれる（実マーカ構文なし）
# When:  audit.sh <tmp> を実行する
# Then:  #7 は FAIL しない（インラインコードスパン除去段で例示が落ちる）
SC4A_TREE="$(make_min_tree)"
mkdir -p "$SC4A_TREE/.agent-skill-chain/runtime/20260101_000000_a"
printf 'マーカ語の直後に `TODO:` や `FIXME:` が続く形を実マーカとみなす。\nこれは例示であり実際の積み残しではない。\n' \
  > "$SC4A_TREE/.agent-skill-chain/runtime/20260101_000000_a/01_要件定義.md"
SC4A_OUT="$(bash "$AUDIT" "$SC4A_TREE" 2>&1)"; SC4A_RC=$?
if [[ $SC4A_RC -eq 0 ]] && ! grep -q '重要パスに TODO/FIXME が残存' <<< "$SC4A_OUT"; then
  ok "C-SC4a バッククォート例示は PASS"
else
  ng "C-SC4a バッククォート例示で FAIL した（rc=$SC4A_RC）: $SC4A_OUT"
fi

# シナリオ: フェンスドコードブロック内の例示は PASS（SC4b・02/03 自己言及型）
# Given: .md に gherkin/bash のフェンスドコードブロックがあり、その中に例示マーカ // TODO: fix・TODO(owner): が含まれる
#        And コードブロック外の散文には実マーカ構文が無い
# When:  audit.sh <tmp> を実行する
# Then:  #7 は FAIL しない（フェンス除去段で例示が落ちる）
SC4B_TREE="$(make_min_tree)"
mkdir -p "$SC4B_TREE/.agent-skill-chain/runtime/20260101_000000_b"
cat > "$SC4B_TREE/.agent-skill-chain/runtime/20260101_000000_b/02_設計.md" <<'EOF'
本書では実マーカと例示を判別する。以下はテストコード例（コードブロック内＝例示）。

```bash
# Given: 実マーカを含む tmp ツリー
printf '// TODO: fix\n' > "$f"
TODO(alice): refactor
```

~~~gherkin
Scenario: 実マーカは FAIL する
  Given "// TODO: fix" が含まれる
~~~

コードブロック外の散文には実マーカ構文を書かないこと。
EOF
SC4B_OUT="$(bash "$AUDIT" "$SC4B_TREE" 2>&1)"; SC4B_RC=$?
if [[ $SC4B_RC -eq 0 ]] && ! grep -q '重要パスに TODO/FIXME が残存' <<< "$SC4B_OUT"; then
  ok "C-SC4b フェンスドコードブロック内の例示は PASS"
else
  ng "C-SC4b フェンス内例示で FAIL した（rc=$SC4B_RC）: $SC4B_OUT"
fi

# シナリオ: 既存ガード重畳（templates / close 除外不変）
# Given: templates 配下 または /close/ 配下の .md に実マーカ // TODO: x が含まれる
# When:  audit.sh <tmp> を実行する
# Then:  #7 は当該パスを検知しない（既存除外ガードを撤去・変更していない）
GUARD_TREE="$(make_min_tree)"
mkdir -p "$GUARD_TREE/.agent-skill-chain/runtime/templates" "$GUARD_TREE/docs/maintainer/workflow/close/20260101_000000_c"
printf '// TODO: in templates\n' > "$GUARD_TREE/.agent-skill-chain/runtime/templates/00_要求定義.md"
printf '// TODO: in close\n'     > "$GUARD_TREE/docs/maintainer/workflow/close/20260101_000000_c/00_要求定義.md"
GUARD_OUT="$(bash "$AUDIT" "$GUARD_TREE" 2>&1)"; GUARD_RC=$?
if [[ $GUARD_RC -eq 0 ]] && ! grep -q '重要パスに TODO/FIXME が残存' <<< "$GUARD_OUT"; then
  ok "C-guard templates/close 配下の実マーカは除外（既存ガード不変）"
else
  ng "C-guard templates/close 除外が効いていない（rc=$GUARD_RC）: $GUARD_OUT"
fi

# シナリオ: 未閉フェンス直後の実マーカは FAIL（SC2・偽陰性ゼロ／フォールバック保険）
# Given: .md にフェンス行が奇数個（未閉フェンス）あり、最後の開きフェンス以降の散文に実マーカ // TODO: が含まれる
# When:  audit.sh <tmp> を実行する
# Then:  #7 が FAIL する（EOF 時に未閉ならバッファ行を救済出力＝抑制されない）
EDGE_TREE="$(make_min_tree)"
mkdir -p "$EDGE_TREE/.agent-skill-chain/runtime/20260101_000000_e"
cat > "$EDGE_TREE/.agent-skill-chain/runtime/20260101_000000_e/03_実装計画.md" <<'EOF'
ここで未閉フェンスを開く（閉じない）。

```bash
echo "このブロックは閉じられていない"
// TODO: after unclosed fence
EOF
EDGE_OUT="$(bash "$AUDIT" "$EDGE_TREE" 2>&1)"
if grep -q '重要パスに TODO/FIXME が残存' <<< "$EDGE_OUT"; then
  ok "C-edge 未閉フェンス直後の実マーカは FAIL（フォールバック保険）"
else
  ng "C-edge 未閉フェンス以降の実マーカを見逃した（偽陰性）: $EDGE_OUT"
fi

# =====================================================================================
# GIT_RANGE インジェクション是正（MEDIUM）: 不正 range の無害化・正当 range の非破壊
# =====================================================================================
echo "== GIT_RANGE 検証（git オプション注入の無害化・正当 range 非破壊） =="

# git tree を作るヘルパー（最小 issue ツリー＋初期コミット 2 つ）。
make_git_tree() {
  local tmp
  tmp="$(make_min_tree)"
  ( cd "$tmp" && git init -q && git config user.email t@e.x && git config user.name t \
      && git add -A && git commit -qm init >/dev/null \
      && echo x > marker.txt && git add -A && git commit -qm c2 >/dev/null )
  printf '%s\n' "$tmp"
}

if command -v git >/dev/null 2>&1; then
  # シナリオ: 正当な GIT_RANGE（HEAD~1..HEAD）は従来どおり動き exit 0（非破壊）
  # Given: git tree、AUDIT_GIT_RANGE=HEAD~1..HEAD（正当）
  # When:  audit.sh を実行する
  # Then:  exit 0（正当 range は素通り・WARN 無し）
  GR_TREE="$(make_git_tree)"
  GR_OUT="$(AUDIT_GIT_RANGE='HEAD~1..HEAD' bash "$AUDIT" "$GR_TREE" 2>&1)"; GR_RC=$?
  if [[ $GR_RC -eq 0 ]] && ! grep -q 'GIT_RANGE が不正' <<< "$GR_OUT"; then
    ok "GIT_RANGE: 正当 range は非破壊（exit 0・WARN 無し）"
  else
    ng "GIT_RANGE: 正当 range が壊れた（rc=$GR_RC）: $GR_OUT"
  fi

  # シナリオ: git オプション注入（--output=）を含む GIT_RANGE は無害化され、攻撃ファイルが生成されない
  # Given: git tree、AUDIT_GIT_RANGE="HEAD --output=<file>"（注入）
  # When:  audit.sh を実行する
  # Then:  WARN を出して既定へ無害化し、--output 先のファイルが作られない（git に option が渡らない）
  GR_TREE2="$(make_git_tree)"
  PWNED="$GR_TREE2/PWNED.txt"
  GR_OUT2="$(AUDIT_GIT_RANGE="HEAD --output=$PWNED" bash "$AUDIT" "$GR_TREE2" 2>&1)"
  if grep -q 'GIT_RANGE が不正' <<< "$GR_OUT2" && [[ ! -f "$PWNED" ]]; then
    ok "GIT_RANGE: --output 注入は無害化（WARN・攻撃ファイル未生成）"
  else
    ng "GIT_RANGE: --output 注入が無害化されない（PWNED 存在=$( [[ -f "$PWNED" ]] && echo yes || echo no )）: $GR_OUT2"
  fi

  # シナリオ: シェルメタ文字（;）を含む GIT_RANGE も無害化される（単語分割・任意引数の遮断）
  # Given: AUDIT_GIT_RANGE="HEAD; echo INJECTED"
  # When:  audit.sh を実行する
  # Then:  WARN を出して既定へ無害化（注入文字列は range として扱われない）
  GR_TREE3="$(make_git_tree)"
  GR_OUT3="$(AUDIT_GIT_RANGE='HEAD; echo INJECTED' bash "$AUDIT" "$GR_TREE3" 2>&1)"; GR_RC3=$?
  if grep -q 'GIT_RANGE が不正' <<< "$GR_OUT3" && [[ $GR_RC3 -ne 2 || $GR_RC3 -eq 0 ]]; then
    ok "GIT_RANGE: メタ文字（;）注入は無害化（WARN）"
  else
    ng "GIT_RANGE: メタ文字注入が無害化されない: $GR_OUT3"
  fi
else
  ok "GIT_RANGE: git 不在のため SKIP（環境依存）"
fi

# =====================================================================================
# #32 実装前 review-docs 未実行検知（check_reviewdocs_before_implement）の回帰テスト
#   tmp 隔離（mktemp -d）。本開発リポの .agent-skill-chain/source/ .agent-skill-chain/runtime/ workflow.db は変更しない。
#   参照: docs/maintainer/workflow/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/20260711_194044_review-docs必須化/03_実装計画.md §2.3
# =====================================================================================
echo "== #32 実装前 review-docs 未実行検知 =="

if command -v sqlite3 >/dev/null 2>&1; then
  # シナリオ1: 正常系 pass（発効日以降・implement-feature と review-docs 両ログ）
  # Given: 発効日以降(20260801)の issue に 03_実装計画.md と implement-feature・review-docs 両ログ
  # When:  audit.sh <tmp> を実行する
  # Then:  "実装前 review-docs 未実行" の FAIL が出ない
  S32_1_TREE="$(make_min_tree)"
  S32_1_ISS="docs/maintainer/workflow/20260801_000000_ok"
  mkdir -p "$S32_1_TREE/$S32_1_ISS"
  : > "$S32_1_TREE/$S32_1_ISS/03_実装計画.md"
  S32_1_DB="$S32_1_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S32_1_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S32_1_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S32_1_ISS');" 2>/dev/null
  sqlite3 "$S32_1_DB" "INSERT INTO workflow_log VALUES ('e2', NULL, 'review-docs', '$S32_1_ISS');" 2>/dev/null
  S32_1_OUT="$(bash "$AUDIT" "$S32_1_TREE" 2>&1)"
  if ! grep -q "実装前 review-docs 未実行" <<< "$S32_1_OUT"; then
    ok "#32 正常系（impl＋review-docs 両ログ）は FAIL しない"
  else
    ng "#32 正常系で誤って FAIL した: $S32_1_OUT"
  fi

  # シナリオ2: 違反系 FAIL（発効日以降・implement-feature ログのみ）
  # Given: 発効日以降の issue に implement-feature ログのみ（review-docs 無し）
  # When:  audit.sh <tmp> を実行する
  # Then:  "実装前 review-docs 未実行" の FAIL が出る
  S32_2_TREE="$(make_min_tree)"
  S32_2_ISS="docs/maintainer/workflow/20260801_000000_ng"
  mkdir -p "$S32_2_TREE/$S32_2_ISS"
  : > "$S32_2_TREE/$S32_2_ISS/03_実装計画.md"
  S32_2_DB="$S32_2_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S32_2_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S32_2_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S32_2_ISS');" 2>/dev/null
  S32_2_OUT="$(bash "$AUDIT" "$S32_2_TREE" 2>&1)"
  if grep -q "実装前 review-docs 未実行" <<< "$S32_2_OUT"; then
    ok "#32 違反系（impl のみ）で FAIL する"
  else
    ng "#32 違反系で FAIL しなかった（見逃し）: $S32_2_OUT"
  fi

  # シナリオ3: grandfather SKIP（発効日前）
  # Given: 発効日前(20260101)の issue に implement-feature ログのみ
  # When:  audit.sh <tmp> を実行する
  # Then:  #32 の FAIL は出ない（遡及適用なし）
  S32_3_TREE="$(make_min_tree)"
  S32_3_ISS="docs/maintainer/workflow/20260101_000000_old"
  mkdir -p "$S32_3_TREE/$S32_3_ISS"
  : > "$S32_3_TREE/$S32_3_ISS/03_実装計画.md"
  S32_3_DB="$S32_3_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S32_3_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S32_3_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S32_3_ISS');" 2>/dev/null
  S32_3_OUT="$(bash "$AUDIT" "$S32_3_TREE" 2>&1)"
  if ! grep -q "実装前 review-docs 未実行" <<< "$S32_3_OUT"; then
    ok "#32 grandfather SKIP（発効日前 issue は FAIL しない）"
  else
    ng "#32 grandfather が機能せず遡及 FAIL した: $S32_3_OUT"
  fi

  # シナリオ4: close SKIP
  # Given: close/ 配下の issue に implement-feature ログのみ
  # When:  audit.sh <tmp> を実行する
  # Then:  #32 の FAIL は出ない
  S32_4_TREE="$(make_min_tree)"
  S32_4_ISS="docs/maintainer/workflow/close/20260801_000000_closed"
  mkdir -p "$S32_4_TREE/$S32_4_ISS"
  : > "$S32_4_TREE/$S32_4_ISS/03_実装計画.md"
  S32_4_DB="$S32_4_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S32_4_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S32_4_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S32_4_ISS');" 2>/dev/null
  S32_4_OUT="$(bash "$AUDIT" "$S32_4_TREE" 2>&1)"
  if ! grep -q "実装前 review-docs 未実行" <<< "$S32_4_OUT"; then
    ok "#32 close SKIP（close 配下 issue は FAIL しない）"
  else
    ng "#32 close 除外が効いていない: $S32_4_OUT"
  fi

  # シナリオ6: #29 と #32 の非交差確認
  # Given: 同一 DB に (a) 04 のみ・impl 0 件の issue（#29 対象）と (b) impl のみ・review-docs 無しの発効日以降 issue（#32 対象）
  # When:  audit.sh <tmp> を実行する
  # Then:  #29 は (a) で、#32 は (b) でそれぞれ個別に FAIL する（排他・非交差）
  S32_6_TREE="$(make_min_tree)"
  S32_6_A="docs/maintainer/workflow/20260801_000000_29case"
  S32_6_B="docs/maintainer/workflow/20260801_000000_32case"
  mkdir -p "$S32_6_TREE/$S32_6_A" "$S32_6_TREE/$S32_6_B"
  : > "$S32_6_TREE/$S32_6_B/03_実装計画.md"
  cat > "$S32_6_TREE/$S32_6_A/04_review.md" <<'EOF'
# 04_review

## 敵対的観点
- ダミー

## must-preserve（不変条件）
- ダミー

## docs 更新
- 要否: 不要
- 対象: なし
- 理由: 文書のみ
EOF
  S32_6_DB="$S32_6_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S32_6_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S32_6_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S32_6_B');" 2>/dev/null
  S32_6_OUT="$(bash "$AUDIT" "$S32_6_TREE" 2>&1)"
  if grep -q "実装前に 04_review.md が作成されています" <<< "$S32_6_OUT" && grep -q "実装前 review-docs 未実行" <<< "$S32_6_OUT"; then
    ok "#29/#32 非交差: 各々の対象 issue で個別に FAIL する"
  else
    ng "#29/#32 非交差の確認に失敗: $S32_6_OUT"
  fi

  # シナリオ7: サブ issue（深さ4）違反系 FAIL（回帰防止・maxdepth 撤廃 lock）
  # Given: docs/maintainer/workflow/<親>/90_issues/<sub>/（scan dir から深さ4）・発効日以降の issue に
  #        03_実装計画.md と implement-feature ログのみ（review-docs 無し）
  # When:  audit.sh <tmp> を実行する
  # Then:  #32 が FAIL する（-maxdepth 再導入による取りこぼし回帰を防ぐ）
  S32_7_TREE="$(make_min_tree)"
  S32_7_ISS="docs/maintainer/workflow/20260801_000000_parent/90_issues/20260801_000000_sub"
  mkdir -p "$S32_7_TREE/$S32_7_ISS"
  : > "$S32_7_TREE/$S32_7_ISS/03_実装計画.md"
  S32_7_DB="$S32_7_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S32_7_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S32_7_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S32_7_ISS');" 2>/dev/null
  S32_7_OUT="$(bash "$AUDIT" "$S32_7_TREE" 2>&1)"
  if grep -q "実装前 review-docs 未実行" <<< "$S32_7_OUT"; then
    ok "#32 サブ issue（深さ4）違反系で FAIL する（maxdepth 撤廃 lock）"
  else
    ng "#32 サブ issue（深さ4）で FAIL しなかった（取りこぼし回帰）: $S32_7_OUT"
  fi
else
  echo "  [SKIP] #32 review-docs 未実行検知の回帰（sqlite3 不在）"
fi

# シナリオ5: DB 非採用 SKIP（sqlite3/DB 無し）
# Given: workflow.db を作らない最小ツリー（impl ログも review-docs ログも存在しえない）
# When:  audit.sh <tmp> を実行する
# Then:  #32 の FAIL は出ない（DB 非採用は SKIP）
S32_5_TREE="$(make_min_tree)"
S32_5_ISS="docs/maintainer/workflow/20260801_000000_nodb"
mkdir -p "$S32_5_TREE/$S32_5_ISS"
: > "$S32_5_TREE/$S32_5_ISS/03_実装計画.md"
S32_5_OUT="$(bash "$AUDIT" "$S32_5_TREE" 2>&1)"
if ! grep -q "実装前 review-docs 未実行" <<< "$S32_5_OUT"; then
  ok "#32 DB 非採用 SKIP（sqlite3/DB 無しで FAIL しない）"
else
  ng "#32 DB 非採用でも FAIL した: $S32_5_OUT"
fi

# =====================================================================================
# #31 システム仕様書レビュー証跡欠落検知（check_docs_review_evidence）の tmp 隔離回帰テスト
#   tmp 隔離（mktemp -d）。本開発リポの .agent-skill-chain/source/ .agent-skill-chain/runtime/ workflow.db は変更しない。
#   参照: docs/maintainer/workflow/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/
#         20260712_004252_audit監査31番tmp隔離検証恒久テスト化/03_実装計画.md
# =====================================================================================
echo "== #31 システム仕様書レビュー証跡欠落検知 =="

# Given: sqlite3 の有無で分岐するガード（sqlite3 不在ではケース A〜G を再現できないため SKIP）
if command -v sqlite3 >/dev/null 2>&1; then
  # シナリオA: 要否プレースホルダの 04 で #31 は FAIL・#5 は非FAIL（非交差、ADR-3）
  # Given: docs/ 実在・workflow_log に implement-feature 行・04_review の要否が （要 / 不要）
  # When:  audit.sh <隔離パス> を実行する
  # Then:  stderr に "FAIL: システム仕様書レビュー証跡欠落" を含み、"FAIL: docs 更新要否未記載" を含まない
  A_TREE="$(make_min_tree)"
  A_ISS="docs/maintainer/workflow/20260101_000000_a31"
  mkdir -p "$A_TREE/$A_ISS"
  cat > "$A_TREE/$A_ISS/04_review.md" <<'EOF'
## docs 更新
- 要否: （要 / 不要）
- 対象: （...）
- 理由: （...）
EOF
  A_DB="$A_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$A_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$A_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$A_ISS');" 2>/dev/null
  A_OUT="$(bash "$AUDIT" "$A_TREE" 2>&1)"
  if grep -q 'FAIL: システム仕様書レビュー証跡欠落' <<< "$A_OUT"; then ok "#31-A 要否プレースホルダで FAIL"; else ng "#31-A FAIL せず: $A_OUT"; fi
  if ! grep -q 'FAIL: docs 更新要否未記載' <<< "$A_OUT"; then ok "#31/#5 非交差（同一フィクスチャで #5 は非発火）"; else ng "#5 が誤発火（非交差崩れ）: $A_OUT"; fi

  # シナリオB: 要=実タイムスタンプ参照では #31 は FAIL しない（誤検知なし）
  # Given: docs/ 実在・implement ログあり・04_review の要否=要 + docs/00_review/実タイムスタンプ 参照
  # When:  audit.sh <隔離パス> を実行する
  # Then:  stderr に #31 由来の "FAIL: システム仕様書レビュー証跡欠落" を含まない
  B_TREE="$(make_min_tree)"; B_ISS="docs/maintainer/workflow/20260101_000000_b31"
  mkdir -p "$B_TREE/$B_ISS"
  cat > "$B_TREE/$B_ISS/04_review.md" <<'EOF'
## docs 更新
- 要否: 要
- 対象: docs/00_review/20260101_000000_review.md
- 理由: 指摘 N→0 の反復を実施
EOF
  B_DB="$B_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$B_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$B_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$B_ISS');" 2>/dev/null
  B_OUT="$(bash "$AUDIT" "$B_TREE" 2>&1)"
  if ! grep -q 'FAIL: システム仕様書レビュー証跡欠落' <<< "$B_OUT"; then ok "#31-B 要=実TS参照で非FAIL"; else ng "#31-B 誤 FAIL: $B_OUT"; fi

  # シナリオC: 不要=実質理由では #31 は FAIL しない（誤検知なし）
  # Given: docs/ 実在・implement ログあり・04_review の要否=不要 + 理由が非プレースホルダの実質内容
  # When:  audit.sh <隔離パス> を実行する
  # Then:  stderr に #31 由来の "FAIL: システム仕様書レビュー証跡欠落" を含まない
  C_TREE="$(make_min_tree)"; C_ISS="docs/maintainer/workflow/20260101_000000_c31"
  mkdir -p "$C_TREE/$C_ISS"
  cat > "$C_TREE/$C_ISS/04_review.md" <<'EOF'
## docs 更新
- 要否: 不要
- 対象: なし
- 理由: 変更が仕様に影響しないため
EOF
  C_DB="$C_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$C_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$C_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$C_ISS');" 2>/dev/null
  C_OUT="$(bash "$AUDIT" "$C_TREE" 2>&1)"
  if ! grep -q 'FAIL: システム仕様書レビュー証跡欠落' <<< "$C_OUT"; then ok "#31-C 不要=実質理由で非FAIL"; else ng "#31-C 誤 FAIL: $C_OUT"; fi

  # シナリオD: docs/ 不在で #31 は SKIP（非FAIL）
  # Given: docs/ を作らず issue を .agent-skill-chain/runtime/ 配下に配置（04 はプレースホルダ・implement ログあり）
  # When:  audit.sh <隔離パス> を実行する
  # Then:  stderr に #31 由来の "FAIL: システム仕様書レビュー証跡欠落" を含まない
  D_TREE="$(make_min_tree)"; D_ISS=".agent-skill-chain/runtime/20260101_000000_d31"
  mkdir -p "$D_TREE/$D_ISS"
  cat > "$D_TREE/$D_ISS/04_review.md" <<'EOF'
## docs 更新
- 要否: （要 / 不要）
EOF
  D_DB="$D_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$D_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$D_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$D_ISS');" 2>/dev/null
  D_OUT="$(bash "$AUDIT" "$D_TREE" 2>&1)"
  if ! grep -q 'FAIL: システム仕様書レビュー証跡欠落' <<< "$D_OUT"; then ok "#31-D docs/ 不在 SKIP"; else ng "#31-D docs/ 不在でも FAIL: $D_OUT"; fi

  # シナリオE: implement/verify ログ 0件で #31 は continue（非FAIL）
  # Given: docs/ 実在・04 はプレースホルダだが workflow_log は design-feature のみ（implement/verify 0件）
  # When:  audit.sh <隔離パス> を実行する
  # Then:  stderr に #31 由来の "FAIL: システム仕様書レビュー証跡欠落" を含まない
  E_TREE="$(make_min_tree)"; E_ISS="docs/maintainer/workflow/20260101_000000_e31"
  mkdir -p "$E_TREE/$E_ISS"
  cat > "$E_TREE/$E_ISS/04_review.md" <<'EOF'
## docs 更新
- 要否: （要 / 不要）
EOF
  E_DB="$E_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$E_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$E_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'design-feature', '$E_ISS');" 2>/dev/null
  E_OUT="$(bash "$AUDIT" "$E_TREE" 2>&1)"
  if ! grep -q 'FAIL: システム仕様書レビュー証跡欠落' <<< "$E_OUT"; then ok "#31-E implement/verify ログ 0件で SKIP"; else ng "#31-E ログ0件でも FAIL: $E_OUT"; fi

  # シナリオF: workflow.db 不在で #31 は SKIP（非FAIL）
  # Given: workflow.db を作らない（ケースF）
  F_TREE="$(make_min_tree)"; F_ISS="docs/maintainer/workflow/20260101_000000_f31"
  mkdir -p "$F_TREE/$F_ISS"
  cat > "$F_TREE/$F_ISS/04_review.md" <<'EOF'
## docs 更新
- 要否: （要 / 不要）
EOF
  # （workflow.db は作らない）
  # When: audit.sh を実行
  F_OUT="$(bash "$AUDIT" "$F_TREE" 2>&1)"
  # Then: DB 不在ガードで #31 は SKIP（非FAIL）
  if ! grep -q 'FAIL: システム仕様書レビュー証跡欠落' <<< "$F_OUT"; then ok "#31-F DB 不在 SKIP"; else ng "#31-F DB 不在でも FAIL: $F_OUT"; fi

  # シナリオG: 04 が templates/ 配下で #31 は continue（非FAIL）
  # Given: docs/ ディレクトリと workflow_log テーブルを持つ workflow.db のみ用意し、
  #        04_review.md を .agent-skill-chain/runtime/templates/ 配下に配置
  #        （templates 外に #31 を発火させうる 04 は置かない・implement ログは不要）
  # When:  audit.sh <隔離パス> を実行する
  # Then:  stderr に #31 由来の "FAIL: システム仕様書レビュー証跡欠落" を含まない
  G_TREE="$(make_min_tree)"
  mkdir -p "$G_TREE/docs" "$G_TREE/.agent-skill-chain/runtime/templates"
  cat > "$G_TREE/.agent-skill-chain/runtime/templates/04_review.md" <<'EOF'
## docs 更新
- 要否: （要 / 不要）
EOF
  G_DB="$G_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$G_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  G_OUT="$(bash "$AUDIT" "$G_TREE" 2>&1)"
  if ! grep -q 'FAIL: システム仕様書レビュー証跡欠落' <<< "$G_OUT"; then ok "#31-G templates 配下 SKIP"; else ng "#31-G templates 配下でも FAIL: $G_OUT"; fi
else
  # Then: sqlite3 不在は SKIP（集計を汚さない）
  echo "  [SKIP] #31 システム仕様書レビュー証跡欠落検知（sqlite3 不在）"
fi

echo
echo "== 結果: PASS=$PASS FAIL=$FAIL =="
if [[ $FAIL -gt 0 ]]; then
  printf '  失敗: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
exit 0
