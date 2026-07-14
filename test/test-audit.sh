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

# 呼び出し元シェルの環境変数汚染からテストを隔離する（audit.sh の上書き入力のうち、
# テストが呼び出しごとに設定しないものを unset して既定解決を保証する）。
# 背景・根拠: 02_設計 ADR-1（AGENTS_ROOT 汚染で #1 が偽陰性化する既存不具合の是正）。
unset AGENTS_ROOT WORKFLOW_DIR WORKFLOW_DIRS PR_BODY CODE_COMMENT_SRC_DIRS REVIEWDOCS_GATE_EFFECTIVE_FROM \
  BRANCH_LINK_GATE_ENABLED BRANCH_LINK_GATE_EFFECTIVE_FROM PR_LINK_GATE_ENABLED PR_LINK_GATE_EFFECTIVE_FROM

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

# シナリオ ENV-1: audit.sh #1 の「明示指定＋解決先不在」は無条件成功にせず WARN で可視化する
# Given: AGENTS_ROOT が存在しないディレクトリを明示的に指す（必須ファイルは既定パスに存在する最小ツリー）
# When:  audit.sh <tmp> を実行する
# Then:  stderr に "WARN: AGENTS_ROOT が明示指定" を含み、終了コードは 0（非 FAIL・非サイレント）
ENV1_TREE="$(make_min_tree)"
ENV1_OUT="$(AGENTS_ROOT='/nonexistent/xyz' bash "$AUDIT" "$ENV1_TREE" 2>&1)"; ENV1_RC=$?
if grep -q 'WARN: AGENTS_ROOT が明示指定' <<< "$ENV1_OUT"; then ok "明示 AGENTS_ROOT 不在で WARN を可視化"; else ng "明示 AGENTS_ROOT 不在で WARN が出ない: $ENV1_OUT"; fi
if [[ $ENV1_RC -eq 0 ]]; then ok "明示 AGENTS_ROOT 不在でも終了コードは 0（非 FAIL）"; else ng "明示 AGENTS_ROOT 不在で exit != 0 になった（実際 rc=$ENV1_RC）: $ENV1_OUT"; fi

# シナリオ ENV-2: audit.sh #1 の「既定値＋解決先不在」は従来どおり静かに SKIP する（非採用消費者を誤検知しない）
# Given: AGENTS_ROOT を設定せず、.agent-skill-chain/source も存在しない最小ツリー
# When:  audit.sh <tmp> を実行する
# Then:  #1 由来の WARN も FAIL も出ない
ENV2_TREE="$(mktemp -d)"
TMP_DIRS+=("$ENV2_TREE")
mkdir -p "$ENV2_TREE/.agent-skill-chain/runtime"
ENV2_OUT="$(bash "$AUDIT" "$ENV2_TREE" 2>&1)"
if ! grep -q 'WARN: AGENTS_ROOT が明示指定' <<< "$ENV2_OUT" && ! grep -q 'Missing required file' <<< "$ENV2_OUT"; then
  ok "既定値＋解決先不在で #1 由来の WARN/FAIL が出ない（非採用消費者の SKIP 維持）"
else
  ng "既定値＋解決先不在で #1 由来の WARN/FAIL が出た: $ENV2_OUT"
fi

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
# #26 コメント外部参照禁止（check-comment-refs.sh への委譲）の回帰テスト
#   tmp 隔離（make_min_tree が tmp を作る）。本開発リポの追跡物は読み取りのみ。
#   委譲先スクリプトは audit.sh 自身の位置基準（enforcement/ci/ 同居）で解決される。
# =====================================================================================
echo "== #26 コメント外部参照禁止（委譲）回帰 =="

# シナリオ: src 配下のコメント違反を従来どおり FAIL にする
# Given: tmp 隔離ツリーの src/foo.sh に "# DESIGN.md §3 参照" というコメントがある
# When:  audit.sh を当該ツリーに対して実行する
# Then:  出力に "FAIL: コメント外部参照禁止違反" と "src/foo.sh" が含まれ、終了コードが 1
C26_TREE="$(make_min_tree)"
mkdir -p "$C26_TREE/src"
printf '%s\n' '# DESIGN.md §3 参照' > "$C26_TREE/src/foo.sh"
C26_OUT="$(bash "$AUDIT" "$C26_TREE" 2>&1)"; C26_RC=$?
if grep -q 'FAIL: コメント外部参照禁止違反' <<< "$C26_OUT" && grep -q 'src/foo.sh' <<< "$C26_OUT" && [[ $C26_RC -eq 1 ]]; then
  ok "#26 src 配下の違反を委譲経由で FAIL 検出（exit 1）"
else
  ng "#26 委譲経由の FAIL 検出に失敗（rc=$C26_RC）: $C26_OUT"
fi

# シナリオ: src/app/components が無いツリーでは何も検出しない（既定挙動維持）
# Given: ソースディレクトリを一切持たない最小ツリー
# When:  audit.sh を実行する
# Then:  #26 由来の FAIL を出さない
C26B_TREE="$(make_min_tree)"
C26B_OUT="$(bash "$AUDIT" "$C26B_TREE" 2>&1)"
if ! grep -q 'FAIL: コメント外部参照禁止違反' <<< "$C26B_OUT"; then
  ok "#26 ソースディレクトリ不在では無検出（既定挙動維持）"
else
  ng "#26 ソースディレクトリ不在でも FAIL した: $C26B_OUT"
fi

# シナリオ: CODE_COMMENT_SRC_DIRS 上書きが機能する
# Given: custom/bar.py に "# 第3章 を参照" を置き、CODE_COMMENT_SRC_DIRS=custom を指定
# When:  audit.sh を実行する
# Then:  custom/bar.py が違反として検出される
C26C_TREE="$(make_min_tree)"
mkdir -p "$C26C_TREE/custom"
printf '%s\n' '# 第3章 を参照' > "$C26C_TREE/custom/bar.py"
C26C_OUT="$(CODE_COMMENT_SRC_DIRS=custom bash "$AUDIT" "$C26C_TREE" 2>&1)"
if grep -q 'custom/bar.py' <<< "$C26C_OUT"; then
  ok "#26 CODE_COMMENT_SRC_DIRS 上書きで custom 配下を検出"
else
  ng "#26 CODE_COMMENT_SRC_DIRS 上書きが機能しない: $C26C_OUT"
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
# #33 close 移動未実施検知（check_close_move_pending）の回帰テスト
#   tmp 隔離（mktemp -d）。本開発リポの .agent-skill-chain/source/ .agent-skill-chain/runtime/ workflow.db は変更しない。
#   参照: docs/maintainer/workflow/20260712_181917_close移動監査強制/03_実装計画.md §2.2
# =====================================================================================
echo "== #33 close 移動未実施検知 =="

if command -v sqlite3 >/dev/null 2>&1; then
  # シナリオ1: 発効日以降・猶予超過・close 未移動 → FAIL（S1）
  # Given: 発効日以降(20260801)の issue に 04_review.md と、猶予日数(既定3日)より古い verify-and-close ログ
  # When:  audit.sh <tmp> を実行する
  # Then:  "close 移動未実施" の FAIL が出る
  S33_1_TREE="$(make_min_tree)"
  S33_1_ISS="docs/maintainer/workflow/20260801_120000_pending_close"
  mkdir -p "$S33_1_TREE/$S33_1_ISS"
  : > "$S33_1_TREE/$S33_1_ISS/04_review.md"
  S33_1_DB="$S33_1_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S33_1_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S33_1_OLD_TS="$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)"
  sqlite3 "$S33_1_DB" "INSERT INTO workflow_log VALUES ('e1','verify-and-close','$S33_1_ISS/','$S33_1_OLD_TS');" 2>/dev/null
  S33_1_OUT="$(CLOSE_MOVE_GATE_EFFECTIVE_FROM=20260712_000000 CLOSE_MOVE_GRACE_DAYS=3 bash "$AUDIT" "$S33_1_TREE" 2>&1)"
  if grep -q "close 移動未実施" <<< "$S33_1_OUT"; then
    ok "#33 猶予超過・発効日以降・未移動で FAIL する（S1）"
  else
    ng "#33 S1 で FAIL しなかった（見逃し）: $S33_1_OUT"
  fi

  # シナリオ2: 猶予期間内の未移動 → 検知しない（S2）
  # Given: 発効日以降の issue に 04_review.md と、現在時刻に近い verify-and-close ログ
  # When:  audit.sh <tmp> を実行する
  # Then:  "close 移動未実施" の FAIL を出力しない
  S33_2_TREE="$(make_min_tree)"
  S33_2_ISS="docs/maintainer/workflow/20260801_120000_recent_close"
  mkdir -p "$S33_2_TREE/$S33_2_ISS"
  : > "$S33_2_TREE/$S33_2_ISS/04_review.md"
  S33_2_DB="$S33_2_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S33_2_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S33_2_RECENT_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  sqlite3 "$S33_2_DB" "INSERT INTO workflow_log VALUES ('e1','verify-and-close','$S33_2_ISS/','$S33_2_RECENT_TS');" 2>/dev/null
  S33_2_OUT="$(CLOSE_MOVE_GATE_EFFECTIVE_FROM=20260712_000000 CLOSE_MOVE_GRACE_DAYS=3 bash "$AUDIT" "$S33_2_TREE" 2>&1)"
  if ! grep -q "close 移動未実施" <<< "$S33_2_OUT"; then
    ok "#33 猶予内は FAIL しない（S2）"
  else
    ng "#33 S2 で誤って FAIL した: $S33_2_OUT"
  fi

  # シナリオ3: basename prefix が発効日未満 → grandfather SKIP（S3）
  # Given: 発効日未満(20260101)の issue に 04_review.md と猶予超過の verify-and-close ログ
  # When:  audit.sh <tmp> を実行する
  # Then:  "close 移動未実施" の FAIL を出力しない（遡及適用なし）
  S33_3_TREE="$(make_min_tree)"
  S33_3_ISS="docs/maintainer/workflow/20260101_000000_old_issue"
  mkdir -p "$S33_3_TREE/$S33_3_ISS"
  : > "$S33_3_TREE/$S33_3_ISS/04_review.md"
  S33_3_DB="$S33_3_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S33_3_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S33_3_OLD_TS="$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)"
  sqlite3 "$S33_3_DB" "INSERT INTO workflow_log VALUES ('e1','verify-and-close','$S33_3_ISS/','$S33_3_OLD_TS');" 2>/dev/null
  S33_3_OUT="$(CLOSE_MOVE_GATE_EFFECTIVE_FROM=20260712_000000 bash "$AUDIT" "$S33_3_TREE" 2>&1)"
  if ! grep -q "close 移動未実施" <<< "$S33_3_OUT"; then
    ok "#33 grandfather SKIP（発効日未満 issue は FAIL しない・S3）"
  else
    ng "#33 grandfather が機能せず遡及 FAIL した: $S33_3_OUT"
  fi

  # シナリオ4: close/ 配下に在籍（find 対象外）→ 検知しない（S4）
  # Given: close/ 配下の issue に 04_review.md と猶予超過の verify-and-close ログ
  # When:  audit.sh <tmp> を実行する
  # Then:  "close 移動未実施" の FAIL を出力しない
  S33_4_TREE="$(make_min_tree)"
  S33_4_ISS="docs/maintainer/workflow/close/20260801_120000_already_closed"
  mkdir -p "$S33_4_TREE/$S33_4_ISS"
  : > "$S33_4_TREE/$S33_4_ISS/04_review.md"
  S33_4_DB="$S33_4_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S33_4_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S33_4_OLD_TS="$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)"
  sqlite3 "$S33_4_DB" "INSERT INTO workflow_log VALUES ('e1','verify-and-close','$S33_4_ISS/','$S33_4_OLD_TS');" 2>/dev/null
  S33_4_OUT="$(CLOSE_MOVE_GATE_EFFECTIVE_FROM=20260712_000000 CLOSE_MOVE_GRACE_DAYS=3 bash "$AUDIT" "$S33_4_TREE" 2>&1)"
  if ! grep -q "close 移動未実施" <<< "$S33_4_OUT"; then
    ok "#33 close 済み issue は FAIL しない（S4）"
  else
    ng "#33 close 除外が効いていない: $S33_4_OUT"
  fi

  # シナリオ6: 90_issues/ 配下のサブ issue は検知対象外（S6）
  # Given: 90_issues 配下のサブ issue に 04_review.md と猶予超過の verify-and-close ログ
  # When:  audit.sh <tmp> を実行する
  # Then:  "close 移動未実施" の FAIL を出力しない（top-level 近似で除外）
  S33_6_TREE="$(make_min_tree)"
  S33_6_ISS="docs/maintainer/workflow/20260801_120000_parent/90_issues/20260801_120000_sub"
  mkdir -p "$S33_6_TREE/$S33_6_ISS"
  : > "$S33_6_TREE/$S33_6_ISS/04_review.md"
  S33_6_DB="$S33_6_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S33_6_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S33_6_OLD_TS="$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)"
  sqlite3 "$S33_6_DB" "INSERT INTO workflow_log VALUES ('e1','verify-and-close','$S33_6_ISS/','$S33_6_OLD_TS');" 2>/dev/null
  S33_6_OUT="$(CLOSE_MOVE_GATE_EFFECTIVE_FROM=20260712_000000 CLOSE_MOVE_GRACE_DAYS=3 bash "$AUDIT" "$S33_6_TREE" 2>&1)"
  if ! grep -q "close 移動未実施" <<< "$S33_6_OUT"; then
    ok "#33 90_issues 配下のサブ issue は FAIL しない（S6）"
  else
    ng "#33 90_issues 除外が効いていない: $S33_6_OUT"
  fi

  # 回帰: verify-and-close 証跡なし（他 command のみ）→ FAIL しない
  # Given: 発効日以降の issue に 04_review.md と implement-feature ログのみ（verify-and-close 無し）
  # When:  audit.sh <tmp> を実行する
  # Then:  "close 移動未実施" の FAIL を出力しない（未完了）
  S33_7_TREE="$(make_min_tree)"
  S33_7_ISS="docs/maintainer/workflow/20260801_120000_not_reviewed"
  mkdir -p "$S33_7_TREE/$S33_7_ISS"
  : > "$S33_7_TREE/$S33_7_ISS/04_review.md"
  S33_7_DB="$S33_7_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S33_7_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S33_7_OLD_TS="$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)"
  sqlite3 "$S33_7_DB" "INSERT INTO workflow_log VALUES ('e1','implement-feature','$S33_7_ISS/','$S33_7_OLD_TS');" 2>/dev/null
  S33_7_OUT="$(CLOSE_MOVE_GATE_EFFECTIVE_FROM=20260712_000000 CLOSE_MOVE_GRACE_DAYS=3 bash "$AUDIT" "$S33_7_TREE" 2>&1)"
  if ! grep -q "close 移動未実施" <<< "$S33_7_OUT"; then
    ok "#33 verify-and-close 証跡なしは FAIL しない（未完了）"
  else
    ng "#33 証跡なしでも誤って FAIL した: $S33_7_OUT"
  fi

  # 回帰: ts_utc 解析不能（不正文字列）でも誤 FAIL しない（fail-open・ADR-4）
  # Given: 発効日以降の issue に 04_review.md と、ts_utc が不正文字列の verify-and-close ログ
  # When:  audit.sh <tmp> を実行する
  # Then:  "close 移動未実施" の FAIL を出力しない（ts_to_epoch 失敗で continue）
  S33_8_TREE="$(make_min_tree)"
  S33_8_ISS="docs/maintainer/workflow/20260801_120000_bad_ts"
  mkdir -p "$S33_8_TREE/$S33_8_ISS"
  : > "$S33_8_TREE/$S33_8_ISS/04_review.md"
  S33_8_DB="$S33_8_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S33_8_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  sqlite3 "$S33_8_DB" "INSERT INTO workflow_log VALUES ('e1','verify-and-close','$S33_8_ISS/','not-a-valid-timestamp');" 2>/dev/null
  S33_8_OUT="$(CLOSE_MOVE_GATE_EFFECTIVE_FROM=20260712_000000 CLOSE_MOVE_GRACE_DAYS=3 bash "$AUDIT" "$S33_8_TREE" 2>&1)"
  if ! grep -q "close 移動未実施" <<< "$S33_8_OUT"; then
    ok "#33 ts_utc 解析不能は誤 FAIL しない（fail-open）"
  else
    ng "#33 ts_utc 不正でも FAIL した: $S33_8_OUT"
  fi

  # 回帰: prefix 非準拠命名の issue で誤 FAIL しない場合の判定（grandfather スキップし DB＋猶予で判定）
  # Given: basename が YYYYMMDD_HHMMSS_ プレフィックス非準拠・猶予内の verify-and-close ログ
  # When:  audit.sh <tmp> を実行する
  # Then:  grandfather 判定はスキップされるが猶予内のため FAIL を出力しない
  S33_9_TREE="$(make_min_tree)"
  S33_9_ISS="docs/maintainer/workflow/non_standard_name"
  mkdir -p "$S33_9_TREE/$S33_9_ISS"
  : > "$S33_9_TREE/$S33_9_ISS/04_review.md"
  S33_9_DB="$S33_9_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S33_9_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S33_9_RECENT_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  sqlite3 "$S33_9_DB" "INSERT INTO workflow_log VALUES ('e1','verify-and-close','$S33_9_ISS/','$S33_9_RECENT_TS');" 2>/dev/null
  S33_9_OUT="$(CLOSE_MOVE_GATE_EFFECTIVE_FROM=20260712_000000 CLOSE_MOVE_GRACE_DAYS=3 bash "$AUDIT" "$S33_9_TREE" 2>&1)"
  if ! grep -q "close 移動未実施" <<< "$S33_9_OUT"; then
    ok "#33 prefix 非準拠命名でも猶予内は誤 FAIL しない"
  else
    ng "#33 prefix 非準拠命名で誤 FAIL した: $S33_9_OUT"
  fi
else
  echo "  [SKIP] #33 close 移動未実施検知の回帰（sqlite3 不在）"
fi

# シナリオ5: DB 非採用 SKIP（sqlite3/DB 無し）
# Given: workflow.db を作らない最小ツリー（verify-and-close ログが存在しえない）
# When:  audit.sh <tmp> を実行する
# Then:  #33 の FAIL は出ない（DB 非採用は SKIP）
S33_5_TREE="$(make_min_tree)"
S33_5_ISS="docs/maintainer/workflow/20260801_120000_nodb"
mkdir -p "$S33_5_TREE/$S33_5_ISS"
: > "$S33_5_TREE/$S33_5_ISS/04_review.md"
S33_5_OUT="$(CLOSE_MOVE_GATE_EFFECTIVE_FROM=20260712_000000 CLOSE_MOVE_GRACE_DAYS=3 bash "$AUDIT" "$S33_5_TREE" 2>&1)"
if ! grep -q "close 移動未実施" <<< "$S33_5_OUT"; then
  ok "#33 DB 非採用 SKIP（sqlite3/DB 無しで FAIL しない・S5）"
else
  ng "#33 DB 非採用でも FAIL した: $S33_5_OUT"
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

# =====================================================================================
# バグ A（worktree 誤 SKIP 是正）の回帰テスト
#   git worktree ではルートの .git が「ファイル」になるため、旧実装の
#   [[ ! -d "$PROJECT_ROOT/.git" ]] 判定が誤って真になり -d .git 系監査（#10/#18/#19/#25/#27/#28）が
#   静かに SKIP（fail-open＝偽陰性）していた。git rev-parse --is-inside-work-tree 化により worktree でも
#   監査が実行されることを、#27（両リスト欠落）の FAIL 発火・非発火と #28 の実行ログで確認する。
#   tmp 隔離（mktemp -d）。本開発リポの source/DB は変更しない。
# =====================================================================================
echo "== バグA worktree 誤 SKIP 是正（-d .git → is-inside-work-tree） =="

# 親リポ（最小 issue ツリー＋初期コミット）から git worktree を切り出すヘルパー。
# 返すパスは worktree ルート（そこでは .git はディレクトリではなくファイルになる）。
make_worktree() {
  local parent wt
  parent="$(make_min_tree)"
  ( cd "$parent" && git init -q && git config user.email t@e.x && git config user.name t \
      && git add -A && git commit -qm init >/dev/null )
  wt="$(mktemp -d)"
  TMP_DIRS+=("$wt")
  rmdir "$wt"   # git worktree add は対象パス不在（または空）を要求する
  ( cd "$parent" && git worktree add -q -b wtbranch "$wt" >/dev/null 2>&1 )
  printf '%s\n' "$wt"
}

if command -v git >/dev/null 2>&1; then
  # 前提: worktree ルートの .git が「ファイル」であること（フィクスチャの妥当性確認）。
  WT_CHECK="$(make_worktree)"
  if [[ -f "$WT_CHECK/.git" && ! -d "$WT_CHECK/.git" ]]; then
    ok "worktree フィクスチャ: ルート .git がファイル（旧 -d .git 判定が誤発火する条件）"
  else
    ng "worktree フィクスチャ生成に失敗（.git がファイルでない）: $WT_CHECK"
  fi

  # シナリオ W1: worktree で両リスト欠落 04 が #27 で FAIL する（旧実装では SKIP＝見逃していた）
  # Given: worktree ルートで docs 配下 04_review.md を追加コミット。04 に「敵対的観点」「must-preserve」が無い
  #        （#5 は満たすよう ## docs 更新 を入れて #27 を単独発火させる）
  # When:  audit.sh <worktree> を実行する
  # Then:  #27「REVIEW_DUAL 両リスト欠落」が FAIL する（worktree でも #27 が実行されている証拠）
  W1_WT="$(make_worktree)"
  W1_ISS="docs/maintainer/workflow/20260101_000000_wt27"
  mkdir -p "$W1_WT/$W1_ISS"
  # 注意: 本文に #27 が grep するキーワード（敵対的観点 / must-preserve / 不変条件）を
  #       一切含めないこと（含めると欠落を再現できず #27 が誤って PASS する）。
  cat > "$W1_WT/$W1_ISS/04_review.md" <<'EOF'
# 04_review

本レビューには両リストが欠けている。

## docs 更新
- 要否: 不要
- 対象: なし
- 理由: 文書のみ
EOF
  ( cd "$W1_WT" && git add -A && git commit -qm add04 >/dev/null 2>&1 )
  W1_OUT="$(bash "$AUDIT" "$W1_WT" 2>&1)"
  if grep -q 'REVIEW_DUAL 両リスト欠落' <<< "$W1_OUT"; then
    ok "W1 worktree で #27 が実行され両リスト欠落を FAIL（-d .git 誤 SKIP の是正）"
  else
    ng "W1 worktree で #27 が SKIP された（偽陰性の回帰）: $W1_OUT"
  fi

  # シナリオ W2: worktree で両リストが揃った 04 は #27 で FAIL しない（誤 FAIL でないこと）
  # Given: worktree ルートで docs 配下 04_review.md を追加コミット。04 に両リストと ## docs 更新 がある
  # When:  audit.sh <worktree> を実行する
  # Then:  #27「REVIEW_DUAL 両リスト欠落」は出ない（過検知でないことの確認）
  W2_WT="$(make_worktree)"
  W2_ISS="docs/maintainer/workflow/20260101_000000_wt27ok"
  mkdir -p "$W2_WT/$W2_ISS"
  cat > "$W2_WT/$W2_ISS/04_review.md" <<'EOF'
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
  ( cd "$W2_WT" && git add -A && git commit -qm add04 >/dev/null 2>&1 )
  W2_OUT="$(bash "$AUDIT" "$W2_WT" 2>&1)"
  if ! grep -q 'REVIEW_DUAL 両リスト欠落' <<< "$W2_OUT"; then
    ok "W2 worktree で両リスト充足 04 は #27 が誤 FAIL しない（過検知なし）"
  else
    ng "W2 worktree で両リスト充足なのに #27 が誤 FAIL した: $W2_OUT"
  fi

  # シナリオ W3: worktree で #28 の実行ログが出る（-d .git 先行ガード除去の確認）
  # Given: worktree ルートに docs 配下 issue ドキュメント（WORKFLOW_SCAN_DIRS 非空化）
  # When:  audit.sh <worktree> を実行する
  # Then:  "[audit] checking issue docs in gitignored paths (#28)" が出力される
  #        （旧実装は 768 行の -d .git で 769 の is-inside より先に return し echo に到達しなかった）
  W3_WT="$(make_worktree)"
  W3_ISS="docs/maintainer/workflow/20260101_000000_wt28"
  mkdir -p "$W3_WT/$W3_ISS"
  : > "$W3_WT/$W3_ISS/00_要求定義.md"
  ( cd "$W3_WT" && git add -A && git commit -qm add00 >/dev/null 2>&1 )
  W3_OUT="$(bash "$AUDIT" "$W3_WT" 2>&1)"
  if grep -q 'checking issue docs in gitignored paths (#28)' <<< "$W3_OUT"; then
    ok "W3 worktree で #28 が実行される（768 行の冗長 -d .git ガード除去の確認）"
  else
    ng "W3 worktree で #28 が SKIP された（768 行の誤ガード回帰）: $W3_OUT"
  fi
else
  echo "  [SKIP] バグA worktree 回帰（git 不在）"
fi

# =====================================================================================
# バグ B（close 除外漏れ是正）の回帰テスト
#   #4（テスト観点未記載・03_実装計画.md）と #5（docs 更新要否未記載・04_review.md）は
#   従来 */templates/* のみ除外し、close 済み issue を除外していなかったため close 配下が永久 FAIL
#   していた。ループへ */close/* 除外 continue を追加した。close 配下は非 FAIL・close 外 in-progress は
#   従来どおり FAIL（過剰除外なし）を確認する。git 不要（#4/#5 は非 git チェック）。tmp 隔離。
# =====================================================================================
echo "== バグB close 除外漏れ是正（#4 テスト観点・#5 docs 更新要否） =="

# シナリオ B1: close 配下の欠落 03/04 は #4/#5 で FAIL せず、close 外 in-progress の欠落は FAIL する
# Given: close 配下に「テスト観点」欠落 03 と「docs 更新」欠落 04、close 外 in-progress に同様の欠落 03/04
# When:  audit.sh <tmp> を実行する
# Then:  FAIL 出力に close パスは含まれず、in-progress パスは #4/#5 で含まれる
BUGB_TREE="$(make_min_tree)"
BUGB_CLOSE="docs/maintainer/workflow/close/20260101_000000_closed"
BUGB_INPROG="docs/maintainer/workflow/20260101_000000_inprog"
mkdir -p "$BUGB_TREE/$BUGB_CLOSE" "$BUGB_TREE/$BUGB_INPROG"
# テスト観点セクションを欠く 03（#4 対象）
printf '# 実装計画\n\n本文のみ（テスト観点セクション無し）。\n' > "$BUGB_TREE/$BUGB_CLOSE/03_実装計画.md"
printf '# 実装計画\n\n本文のみ（テスト観点セクション無し）。\n' > "$BUGB_TREE/$BUGB_INPROG/03_実装計画.md"
# docs 更新セクションを欠く 04（#5 対象。#27 は非 git ツリーで SKIP のため干渉しない）
printf '# 04_review\n\n本文のみ（docs 更新セクション無し）。\n' > "$BUGB_TREE/$BUGB_CLOSE/04_review.md"
printf '# 04_review\n\n本文のみ（docs 更新セクション無し）。\n' > "$BUGB_TREE/$BUGB_INPROG/04_review.md"
BUGB_OUT="$(bash "$AUDIT" "$BUGB_TREE" 2>&1)"
# close 配下は #4/#5 いずれの FAIL 行にも現れない
if ! grep -E 'FAIL: (テスト観点未記載|docs 更新要否未記載)' <<< "$BUGB_OUT" | grep -q "$BUGB_CLOSE"; then
  ok "B1 close 配下の欠落 03/04 は #4/#5 で FAIL しない（close 除外追加）"
else
  ng "B1 close 配下が #4/#5 で FAIL した（close 除外が効いていない）: $BUGB_OUT"
fi
# close 外 in-progress は従来どおり #4/#5 で FAIL する（過剰除外していない）
if grep -q "FAIL: テスト観点未記載.*$BUGB_INPROG" <<< "$BUGB_OUT" \
   && grep -q "FAIL: docs 更新要否未記載.*$BUGB_INPROG" <<< "$BUGB_OUT"; then
  ok "B1 close 外 in-progress の欠落 03/04 は従来どおり #4/#5 で FAIL（過剰除外なし）"
else
  ng "B1 close 外 in-progress が #4/#5 で FAIL しない（過剰除外の回帰）: $BUGB_OUT"
fi

# シナリオ B2: templates 除外は不変（既存ガードの非回帰）
# Given: templates 配下に「テスト観点」欠落 03 と「docs 更新」欠落 04
# When:  audit.sh <tmp> を実行する
# Then:  templates は #4/#5 で FAIL しない（既存 */templates/* 除外を撤去していない）
BUGB2_TREE="$(make_min_tree)"
mkdir -p "$BUGB2_TREE/.agent-skill-chain/runtime/templates"
printf '# 実装計画\n\n本文のみ。\n' > "$BUGB2_TREE/.agent-skill-chain/runtime/templates/03_実装計画.md"
printf '# 04_review\n\n本文のみ。\n' > "$BUGB2_TREE/.agent-skill-chain/runtime/templates/04_review.md"
BUGB2_OUT="$(bash "$AUDIT" "$BUGB2_TREE" 2>&1)"
if ! grep -E 'FAIL: (テスト観点未記載|docs 更新要否未記載)' <<< "$BUGB2_OUT" | grep -q '/templates/'; then
  ok "B2 templates 配下は #4/#5 で FAIL しない（既存 templates 除外の非回帰）"
else
  ng "B2 templates 除外が壊れた: $BUGB2_OUT"
fi

# #34 実装前 GitHub Issue 起票ゲート未通過検知（check_github_issue_before_implement）の回帰テスト
#   tmp 隔離（mktemp -d）。本開発リポの .agent-skill-chain/source/ .agent-skill-chain/runtime/ workflow.db は変更しない。
#   参照: docs/maintainer/workflow/20260712_175901_GitHubIssue起票ゲート追加/03_実装計画.md §2.3
# =====================================================================================
echo "== #34 実装前 GitHub Issue 起票ゲート未通過検知 =="

# git tree（github.com remote 付き）を作るヘルパー
make_git_tree_github() {
  local tmp
  tmp="$(make_min_tree)"
  ( cd "$tmp" && git init -q && git config user.email t@e.x && git config user.name t \
      && git remote add origin https://github.com/example/repo.git \
      && git add -A && git commit -qm init >/dev/null )
  printf '%s\n' "$tmp"
}

# git tree（github.com 以外の remote）を作るヘルパー（GitHub 非採用環境フォールバック検証用）
make_git_tree_nongithub() {
  local tmp
  tmp="$(make_min_tree)"
  ( cd "$tmp" && git init -q && git config user.email t@e.x && git config user.name t \
      && git remote add origin https://gitlab.com/example/repo.git \
      && git add -A && git commit -qm init >/dev/null )
  printf '%s\n' "$tmp"
}

if command -v sqlite3 >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then
  # シナリオ1: 違反系 FAIL（発効日以降・github remote・implement-feature ログのみ・github_issue null）
  # Given: 発効日以降の issue に implement-feature ログがあり、00 frontmatter の github_issue が null
  # When:  audit.sh <tmp> を実行する
  # Then:  "実装前 GitHub Issue 起票ゲート未通過" の FAIL が出る
  S34_1_TREE="$(make_git_tree_github)"
  S34_1_ISS="docs/maintainer/workflow/20260801_000000_gh_ng"
  mkdir -p "$S34_1_TREE/$S34_1_ISS"
  cat > "$S34_1_TREE/$S34_1_ISS/00_要求定義.md" <<'EOF'
---
document_id: "d1"
issue_id: "i1"
github_issue: null
---
EOF
  S34_1_DB="$S34_1_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_1_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S34_1_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S34_1_ISS');" 2>/dev/null
  S34_1_OUT="$(bash "$AUDIT" "$S34_1_TREE" 2>&1)"
  if grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_1_OUT"; then
    ok "#34 違反系（github_issue null）で FAIL する"
  else
    ng "#34 違反系で FAIL しなかった（見逃し）: $S34_1_OUT"
  fi

  # シナリオ1b: プロジェクト全体でのゲート無効化トグル ON（GITHUB_ISSUE_GATE_ENABLED=false）→ 最優先で SKIP
  # Given: シナリオ1 と同じ状態（本来なら FAIL するはず）だが GITHUB_ISSUE_GATE_ENABLED=false を設定
  # When:  audit.sh <tmp> を実行する
  # Then:  "実装前 GitHub Issue 起票ゲート未通過" の FAIL は出ない（他のどの判定よりも先に SKIP・ADR-8）
  S34_1B_OUT="$(GITHUB_ISSUE_GATE_ENABLED=false bash "$AUDIT" "$S34_1_TREE" 2>&1)"
  if ! grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_1B_OUT"; then
    ok "#34 プロジェクト全体の無効化トグル ON（GITHUB_ISSUE_GATE_ENABLED=false）で SKIP する（最優先ガード）"
  else
    ng "#34 無効化トグル ON でも誤って FAIL した: $S34_1B_OUT"
  fi

  # シナリオ1c: 無効化トグルが既定（未設定）／明示 true の場合は従来どおり動作する（回帰なし）
  # Given: シナリオ1 と同じ状態。GITHUB_ISSUE_GATE_ENABLED は未設定、または明示的に true
  # When:  audit.sh <tmp> を実行する
  # Then:  従来どおり FAIL する
  S34_1C_OUT="$(bash "$AUDIT" "$S34_1_TREE" 2>&1)"
  S34_1C_TRUE_OUT="$(GITHUB_ISSUE_GATE_ENABLED=true bash "$AUDIT" "$S34_1_TREE" 2>&1)"
  if grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_1C_OUT" && grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_1C_TRUE_OUT"; then
    ok "#34 無効化トグル未設定/true は従来どおり FAIL する（回帰なし）"
  else
    ng "#34 無効化トグル未設定/true で挙動が変化した（回帰）: unset=$S34_1C_OUT / true=$S34_1C_TRUE_OUT"
  fi

  # シナリオ2: 正常系 pass（github_issue に番号が記録済み）
  # Given: 発効日以降の issue に implement-feature ログがあり、00 frontmatter の github_issue が非 null
  # When:  audit.sh <tmp> を実行する
  # Then:  "実装前 GitHub Issue 起票ゲート未通過" の FAIL が出ない
  S34_2_TREE="$(make_git_tree_github)"
  S34_2_ISS="docs/maintainer/workflow/20260801_000000_gh_ok"
  mkdir -p "$S34_2_TREE/$S34_2_ISS"
  cat > "$S34_2_TREE/$S34_2_ISS/00_要求定義.md" <<'EOF'
---
document_id: "d1"
issue_id: "i1"
github_issue: "#123"
---
EOF
  S34_2_DB="$S34_2_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_2_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S34_2_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S34_2_ISS');" 2>/dev/null
  S34_2_OUT="$(bash "$AUDIT" "$S34_2_TREE" 2>&1)"
  if ! grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_2_OUT"; then
    ok "#34 正常系（github_issue 記録済み）は FAIL しない"
  else
    ng "#34 正常系で誤って FAIL した: $S34_2_OUT"
  fi

  # シナリオ2b: 正常系 pass（理由付き declined＝意図的に起票しない決定を理由付きで記録）
  # Given: 発効日以降の issue に implement-feature ログがあり、github_issue が "declined: <理由>"（理由あり）
  # When:  audit.sh <tmp> を実行する
  # Then:  #34 の FAIL は出ない（理由付き代替記録は通過・ADR-1/ADR-7）
  S34_2B_TREE="$(make_git_tree_github)"
  S34_2B_ISS="docs/maintainer/workflow/20260801_000000_gh_declined_ok"
  mkdir -p "$S34_2B_TREE/$S34_2B_ISS"
  cat > "$S34_2B_TREE/$S34_2B_ISS/00_要求定義.md" <<'EOF'
---
document_id: "d2b"
issue_id: "i2b"
github_issue: "declined: 設定ファイルの軽微な値修正のみで外部追跡が不要なため"
---
EOF
  S34_2B_DB="$S34_2B_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_2B_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S34_2B_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S34_2B_ISS');" 2>/dev/null
  S34_2B_OUT="$(bash "$AUDIT" "$S34_2B_TREE" 2>&1)"
  if ! grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_2B_OUT"; then
    ok "#34 理由付き declined は FAIL しない（代替記録で通過）"
  else
    ng "#34 理由付き declined で誤って FAIL した: $S34_2B_OUT"
  fi

  # シナリオ2c: 違反系 FAIL（理由なし declined＝空虚なバイパス）
  # Given: 発効日以降の issue に implement-feature ログがあり、github_issue が "declined:"（理由なし）
  # When:  audit.sh <tmp> を実行する
  # Then:  #34 の FAIL が出る（理由なしの declined は弾く・ADR-7）
  S34_2C_TREE="$(make_git_tree_github)"
  S34_2C_ISS="docs/maintainer/workflow/20260801_000000_gh_declined_ng"
  mkdir -p "$S34_2C_TREE/$S34_2C_ISS"
  cat > "$S34_2C_TREE/$S34_2C_ISS/00_要求定義.md" <<'EOF'
---
document_id: "d2c"
issue_id: "i2c"
github_issue: "declined:"
---
EOF
  S34_2C_DB="$S34_2C_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_2C_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S34_2C_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S34_2C_ISS');" 2>/dev/null
  S34_2C_OUT="$(bash "$AUDIT" "$S34_2C_TREE" 2>&1)"
  if grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_2C_OUT"; then
    ok "#34 理由なし declined（\"declined:\" のみ）は FAIL する（空虚バイパス防止）"
  else
    ng "#34 理由なし declined を見逃した: $S34_2C_OUT"
  fi

  # シナリオ2d: 違反系 FAIL（declined の理由が空白のみ）
  # Given: github_issue が "declined:    "（理由が空白のみ）
  # Then:  #34 の FAIL が出る（トリム後に空＝理由なし扱い・ADR-7）
  S34_2D_TREE="$(make_git_tree_github)"
  S34_2D_ISS="docs/maintainer/workflow/20260801_000000_gh_declined_ws"
  mkdir -p "$S34_2D_TREE/$S34_2D_ISS"
  cat > "$S34_2D_TREE/$S34_2D_ISS/00_要求定義.md" <<'EOF'
---
document_id: "d2d"
issue_id: "i2d"
github_issue: "declined:    "
---
EOF
  S34_2D_DB="$S34_2D_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_2D_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S34_2D_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S34_2D_ISS');" 2>/dev/null
  S34_2D_OUT="$(bash "$AUDIT" "$S34_2D_TREE" 2>&1)"
  if grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_2D_OUT"; then
    ok "#34 declined の理由が空白のみは FAIL する（トリム後に空）"
  else
    ng "#34 空白のみ理由の declined を見逃した: $S34_2D_OUT"
  fi

  # シナリオ3: サブ issue（90_issues 配下）は対象外 SKIP
  # Given: 90_issues 配下のサブ issue に implement-feature ログがあり github_issue が欠落
  # When:  audit.sh <tmp> を実行する
  # Then:  #34 の FAIL は出ない（親 Issue に集約・ADR-6）
  S34_3_TREE="$(make_git_tree_github)"
  S34_3_ISS="docs/maintainer/workflow/20260801_000000_parent/90_issues/20260801_000000_sub"
  mkdir -p "$S34_3_TREE/$S34_3_ISS"
  cat > "$S34_3_TREE/$S34_3_ISS/00_要求定義.md" <<'EOF'
---
github_issue: null
---
EOF
  S34_3_DB="$S34_3_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_3_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S34_3_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S34_3_ISS');" 2>/dev/null
  S34_3_OUT="$(bash "$AUDIT" "$S34_3_TREE" 2>&1)"
  if ! grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_3_OUT"; then
    ok "#34 サブ issue（90_issues 配下）SKIP（親 Issue に集約）"
  else
    ng "#34 サブ issue で誤って FAIL した: $S34_3_OUT"
  fi

  # シナリオ4: GitHub 非採用環境（remote が github.com 以外）は非発火 SKIP
  # Given: git remote が gitlab.com。implement-feature ログがあり github_issue が欠落
  # When:  audit.sh <tmp> を実行する
  # Then:  #34 の FAIL は出ない（対象外環境フォールバック・ADR-4）
  S34_4_TREE="$(make_git_tree_nongithub)"
  S34_4_ISS="docs/maintainer/workflow/20260801_000000_nongh"
  mkdir -p "$S34_4_TREE/$S34_4_ISS"
  cat > "$S34_4_TREE/$S34_4_ISS/00_要求定義.md" <<'EOF'
---
github_issue: null
---
EOF
  S34_4_DB="$S34_4_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_4_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S34_4_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S34_4_ISS');" 2>/dev/null
  S34_4_OUT="$(bash "$AUDIT" "$S34_4_TREE" 2>&1)"
  if ! grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_4_OUT"; then
    ok "#34 GitHub 非採用環境 SKIP（remote が github.com 以外）"
  else
    ng "#34 GitHub 非採用環境でも FAIL した: $S34_4_OUT"
  fi

  # シナリオ5: grandfather SKIP（発効日前）
  # Given: 発効日前(20260101)の issue に implement-feature ログのみ・github_issue 欠落
  # When:  audit.sh <tmp> を実行する
  # Then:  #34 の FAIL は出ない（遡及適用なし）
  S34_5_TREE="$(make_git_tree_github)"
  S34_5_ISS="docs/maintainer/workflow/20260101_000000_gh_old"
  mkdir -p "$S34_5_TREE/$S34_5_ISS"
  cat > "$S34_5_TREE/$S34_5_ISS/00_要求定義.md" <<'EOF'
---
github_issue: null
---
EOF
  S34_5_DB="$S34_5_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_5_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S34_5_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S34_5_ISS');" 2>/dev/null
  S34_5_OUT="$(bash "$AUDIT" "$S34_5_TREE" 2>&1)"
  if ! grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_5_OUT"; then
    ok "#34 grandfather SKIP（発効日前 issue は FAIL しない）"
  else
    ng "#34 grandfather が機能せず遡及 FAIL した: $S34_5_OUT"
  fi

  # シナリオ6: close 配下 SKIP
  # Given: close/ 配下の issue に implement-feature ログのみ・github_issue 欠落
  # When:  audit.sh <tmp> を実行する
  # Then:  #34 の FAIL は出ない
  S34_6_TREE="$(make_git_tree_github)"
  S34_6_ISS="docs/maintainer/workflow/close/20260801_000000_gh_closed"
  mkdir -p "$S34_6_TREE/$S34_6_ISS"
  cat > "$S34_6_TREE/$S34_6_ISS/00_要求定義.md" <<'EOF'
---
github_issue: null
---
EOF
  S34_6_DB="$S34_6_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_6_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S34_6_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S34_6_ISS');" 2>/dev/null
  S34_6_OUT="$(bash "$AUDIT" "$S34_6_TREE" 2>&1)"
  if ! grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_6_OUT"; then
    ok "#34 close SKIP（close 配下 issue は FAIL しない）"
  else
    ng "#34 close 除外が効いていない: $S34_6_OUT"
  fi

  # シナリオ7: implement-feature ログ 0 件は対象外（continue）
  # Given: implement-feature ログが無い issue（github_issue も欠落）
  # When:  audit.sh <tmp> を実行する
  # Then:  #34 の FAIL は出ない（#34 の対象外・未実装の issue は関知しない）
  S34_7_TREE="$(make_git_tree_github)"
  S34_7_ISS="docs/maintainer/workflow/20260801_000000_gh_noimpl"
  mkdir -p "$S34_7_TREE/$S34_7_ISS"
  cat > "$S34_7_TREE/$S34_7_ISS/00_要求定義.md" <<'EOF'
---
github_issue: null
---
EOF
  S34_7_DB="$S34_7_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_7_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  S34_7_OUT="$(bash "$AUDIT" "$S34_7_TREE" 2>&1)"
  if ! grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_7_OUT"; then
    ok "#34 implement-feature ログ 0 件は対象外（FAIL しない）"
  else
    ng "#34 impl ログ 0 件でも FAIL した: $S34_7_OUT"
  fi
else
  echo "  [SKIP] #34 GitHub Issue 起票ゲート未通過検知の回帰（sqlite3 または git 不在）"
fi

# シナリオ8: DB 非採用 SKIP（sqlite3/DB 無し）
# Given: workflow.db を作らない最小ツリー（github remote 有りだが DB 無し）
# When:  audit.sh <tmp> を実行する
# Then:  #34 の FAIL は出ない（DB 非採用は SKIP）
if command -v git >/dev/null 2>&1; then
  S34_8_TREE="$(make_git_tree_github)"
  S34_8_ISS="docs/maintainer/workflow/20260801_000000_gh_nodb"
  mkdir -p "$S34_8_TREE/$S34_8_ISS"
  cat > "$S34_8_TREE/$S34_8_ISS/00_要求定義.md" <<'EOF'
---
github_issue: null
---
EOF
  S34_8_OUT="$(bash "$AUDIT" "$S34_8_TREE" 2>&1)"
  if ! grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_8_OUT"; then
    ok "#34 DB 非採用 SKIP（sqlite3/DB 無しで FAIL しない）"
  else
    ng "#34 DB 非採用でも FAIL した: $S34_8_OUT"
  fi
else
  echo "  [SKIP] #34 DB 非採用 SKIP 検証（git 不在）"
fi

# シナリオ9: git worktree 内でも #34 が発火する（.git がファイルでも false-SKIP しない）
# Given: github remote 付きリポの worktree（worktree では .git は gitdir ポインタの「ファイル」）に
#        implement-feature ログ 1 件＋00 frontmatter github_issue: null の issue がある
# When:  audit.sh <worktree> を実行する
# Then:  #34 の FAIL が出る（worktree も git ツリーであり rev-parse で判定する。`.git` のディレクトリ
#        検査に依存すると worktree でゲートが骨抜きになる回帰を防ぐ）
if command -v sqlite3 >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then
  S34_9_MAIN="$(make_git_tree_github)"
  S34_9_WT="$(mktemp -d)"; TMP_DIRS+=("$S34_9_WT")
  ( cd "$S34_9_MAIN" && git worktree add -q -b wt-gate-test "$S34_9_WT" >/dev/null 2>&1 )
  S34_9_ISS="docs/maintainer/workflow/20260801_000000_gh_worktree"
  mkdir -p "$S34_9_WT/$S34_9_ISS" "$S34_9_WT/.agent-skill-chain/runtime"
  cat > "$S34_9_WT/$S34_9_ISS/00_要求定義.md" <<'EOF'
---
document_id: "d9"
issue_id: "i9"
github_issue: null
---
EOF
  S34_9_DB="$S34_9_WT/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S34_9_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$S34_9_DB" "INSERT INTO workflow_log VALUES ('e1', NULL, 'implement-feature', '$S34_9_ISS');" 2>/dev/null
  S34_9_OUT="$(bash "$AUDIT" "$S34_9_WT" 2>&1)"
  if grep -q "実装前 GitHub Issue 起票ゲート未通過" <<< "$S34_9_OUT"; then
    ok "#34 git worktree 内でも FAIL する（.git がファイルでも false-SKIP しない）"
  else
    ng "#34 worktree で false-SKIP した（.git ディレクトリ検査の回帰）: $S34_9_OUT"
  fi
  ( cd "$S34_9_MAIN" && git worktree remove --force "$S34_9_WT" >/dev/null 2>&1 || true )
else
  echo "  [SKIP] #34 worktree 発火検証（sqlite3 または git 不在）"
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

# #37 システム仕様書の作業用 issue フォルダ参照禁止（check_docs_transient_issue_ref）の tmp 隔離回帰テスト。
# 判定は「#37 由来の FAIL 文字列の有無」に加えて「audit 全体の終了コード」でも行う（CodeRabbit 指摘6）。
# make_min_tree は他 check を全て SKIP/PASS させる clean な最小ツリー（シナリオ1 で rc=0 を確認済み）で、
# docs/ 追加で発火しうるのは #37 のみ（#31 は DB 採用時のみ）。よって正例＝rc 非 0・負例/SKIP＝rc 0 を安全に検証できる。
FAIL37='FAIL: システム仕様書が作業用 issue フォルダ'
echo "== #37 システム仕様書の作業用 issue フォルダ参照禁止 =="

# シナリオA: 消費者標準パス（.agent-skill-chain/runtime/{issue}/）への参照で FAIL
# Given: docs/ 配下の仕様書が runtime の issue フォルダ（日時プレフィックス付き）を参照する
# When:  audit.sh <tmp> を実行する
# Then:  stderr に #37 由来の FAIL を含む
A37_TREE="$(make_min_tree)"; mkdir -p "$A37_TREE/docs"
printf 'see .agent-skill-chain/runtime/20260713_075722_foo/02_設計.md\n' > "$A37_TREE/docs/01_システム概要.md"
A37_OUT="$(bash "$AUDIT" "$A37_TREE" 2>&1)"; A37_RC=$?
if grep -qF "$FAIL37" <<< "$A37_OUT"; then ok "#37-A runtime issue 参照で FAIL"; else ng "#37-A runtime issue 参照で FAIL せず: $A37_OUT"; fi
if [[ $A37_RC -ne 0 ]]; then ok "#37-A 正例で終了コード非 0（rc=$A37_RC）"; else ng "#37-A 正例なのに終了コード 0: $A37_OUT"; fi

# シナリオB: 本リポ上書きパス（docs/maintainer/workflow/{issue}/）への参照で FAIL
# Given: docs/ 配下の仕様書が workflow の issue フォルダを参照する
# When:  audit.sh <tmp> を実行する
# Then:  stderr に #37 由来の FAIL を含む
B37_TREE="$(make_min_tree)"; mkdir -p "$B37_TREE/docs/maintainer"
printf 'link docs/maintainer/workflow/20260713_075722_foo/00_要求定義.md\n' > "$B37_TREE/docs/maintainer/adapters.md"
B37_OUT="$(bash "$AUDIT" "$B37_TREE" 2>&1)"; B37_RC=$?
if grep -qF "$FAIL37" <<< "$B37_OUT"; then ok "#37-B workflow issue 参照で FAIL"; else ng "#37-B workflow issue 参照で FAIL せず: $B37_OUT"; fi
if [[ $B37_RC -ne 0 ]]; then ok "#37-B 正例で終了コード非 0（rc=$B37_RC）"; else ng "#37-B 正例なのに終了コード 0: $B37_OUT"; fi

# シナリオC: close/ 配下（完了後の永続パス）への参照は誤検知しない
# Given: docs/ 配下の仕様書が close 済み issue を参照する
# When:  audit.sh <tmp> を実行する
# Then:  stderr に #37 由来の FAIL を含まない
C37_TREE="$(make_min_tree)"; mkdir -p "$C37_TREE/docs"
printf 'docs/maintainer/workflow/close/20260713_foo/04_review.md and .agent-skill-chain/runtime/close/20260713_bar/00_要求定義.md\n' > "$C37_TREE/docs/x.md"
C37_OUT="$(bash "$AUDIT" "$C37_TREE" 2>&1)"; C37_RC=$?
if ! grep -qF "$FAIL37" <<< "$C37_OUT"; then ok "#37-C close 参照は非 FAIL"; else ng "#37-C close 参照で誤 FAIL: $C37_OUT"; fi
if [[ $C37_RC -eq 0 ]]; then ok "#37-C 負例で終了コード 0"; else ng "#37-C 負例なのに終了コード非 0（rc=$C37_RC）: $C37_OUT"; fi

# シナリオD: 汎用ディレクトリ参照・DB 参照は誤検知しない
# Given: docs/ 配下の仕様書が workflow.db や日時プレフィックスなしの一般ディレクトリを参照する
# When:  audit.sh <tmp> を実行する
# Then:  stderr に #37 由来の FAIL を含まない
D37_TREE="$(make_min_tree)"; mkdir -p "$D37_TREE/docs"
printf 'db at .agent-skill-chain/runtime/workflow.db and dir .agent-skill-chain/runtime/ and docs/maintainer/workflow/README.md\n' > "$D37_TREE/docs/y.md"
D37_OUT="$(bash "$AUDIT" "$D37_TREE" 2>&1)"; D37_RC=$?
if ! grep -qF "$FAIL37" <<< "$D37_OUT"; then ok "#37-D 汎用/DB 参照は非 FAIL"; else ng "#37-D 汎用/DB 参照で誤 FAIL: $D37_OUT"; fi
if [[ $D37_RC -eq 0 ]]; then ok "#37-D 負例で終了コード 0"; else ng "#37-D 負例なのに終了コード非 0（rc=$D37_RC）: $D37_OUT"; fi

# シナリオE: 作業用 issue ドキュメント自身（docs/maintainer/workflow/ 配下）は走査対象外
# Given: workflow 配下の issue ドキュメントが別の issue フォルダを参照する
# When:  audit.sh <tmp> を実行する
# Then:  stderr に #37 由来の FAIL を含まない（/workflow/ 除外）
E37_TREE="$(make_min_tree)"; mkdir -p "$E37_TREE/docs/maintainer/workflow/20260713_075722_foo"
printf 'refers .agent-skill-chain/runtime/20260713_x_bar/02_設計.md\n' > "$E37_TREE/docs/maintainer/workflow/20260713_075722_foo/02_設計.md"
E37_OUT="$(bash "$AUDIT" "$E37_TREE" 2>&1)"; E37_RC=$?
if ! grep -qF "$FAIL37" <<< "$E37_OUT"; then ok "#37-E workflow 配下 issue ドキュメントは走査対象外"; else ng "#37-E 走査対象外が効かず誤 FAIL: $E37_OUT"; fi
if [[ $E37_RC -eq 0 ]]; then ok "#37-E 走査対象外で終了コード 0"; else ng "#37-E 走査対象外なのに終了コード非 0（rc=$E37_RC）: $E37_OUT"; fi

# シナリオF: docs/ 不在は SKIP（docs/ 未採用プロジェクトでは不発動）
# Given: docs/ を持たない最小ツリー
# When:  audit.sh <tmp> を実行する
# Then:  stderr に #37 由来の FAIL を含まない
F37_TREE="$(make_min_tree)"
F37_OUT="$(bash "$AUDIT" "$F37_TREE" 2>&1)"; F37_RC=$?
if ! grep -qF "$FAIL37" <<< "$F37_OUT"; then ok "#37-F docs/ 不在 SKIP"; else ng "#37-F docs/ 不在でも FAIL: $F37_OUT"; fi
if [[ $F37_RC -eq 0 ]]; then ok "#37-F docs/ 不在 SKIP で終了コード 0"; else ng "#37-F docs/ 不在なのに終了コード非 0（rc=$F37_RC）: $F37_OUT"; fi

# シナリオG: サブ issue（日付のみプレフィックス）の参照も FAIL（日時プレフィックス検出の下限を lock）
# Given: docs/ 配下の仕様書が YYYYMMDD_ のみのサブ issue ディレクトリを参照する
# When:  audit.sh <tmp> を実行する
# Then:  stderr に #37 由来の FAIL を含む
G37_TREE="$(make_min_tree)"; mkdir -p "$G37_TREE/docs"
printf 'sub docs/maintainer/workflow/20260314_PR4_PR指摘対応/00_要求定義.md\n' > "$G37_TREE/docs/z.md"
G37_OUT="$(bash "$AUDIT" "$G37_TREE" 2>&1)"; G37_RC=$?
if grep -qF "$FAIL37" <<< "$G37_OUT"; then ok "#37-G サブ issue（日付プレフィックス）参照で FAIL"; else ng "#37-G サブ issue 参照で FAIL せず: $G37_OUT"; fi
if [[ $G37_RC -ne 0 ]]; then ok "#37-G 正例で終了コード非 0（rc=$G37_RC）"; else ng "#37-G 正例なのに終了コード 0: $G37_OUT"; fi

# シナリオH: パス文字列に "/workflow/" を含むが WORKFLOW_SCAN_DIRS 配下ではない正当な仕様書は走査対象
#   （CodeRabbit 指摘2 の退行ロック。パス例は説明用の仮想パスで特定のディレクトリ規約に依存しない）。
# Given: 名前にたまたま "workflow" を含む一般ディレクトリ（WORKFLOW_SCAN_DIRS ではない）配下の仕様書が
#        issue フォルダを参照する
# When:  audit.sh <tmp> を実行する
# Then:  "/workflow/" 部分一致では除外されず #37 由来の FAIL を含む（前方一致除外に修正済みであること）
H37_TREE="$(make_min_tree)"; mkdir -p "$H37_TREE/docs/spec/workflow"
printf 'see .agent-skill-chain/runtime/20260713_075722_foo/02_設計.md\n' > "$H37_TREE/docs/spec/workflow/design.md"
H37_OUT="$(bash "$AUDIT" "$H37_TREE" 2>&1)"; H37_RC=$?
if grep -qF "$FAIL37" <<< "$H37_OUT"; then ok "#37-H /workflow/ を含む正当仕様書は走査対象（前方一致除外）で FAIL"; else ng "#37-H /workflow/ 部分一致で誤って走査対象外になり FAIL せず: $H37_OUT"; fi
if [[ $H37_RC -ne 0 ]]; then ok "#37-H 正例で終了コード非 0（rc=$H37_RC）"; else ng "#37-H 正例なのに終了コード 0: $H37_OUT"; fi

# =====================================================================================
# #35 実装前ブランチ紐づけ未記録検知（check_branch_linkage_before_implement）の回帰テスト
#   tmp 隔離（mktemp -d）。本開発リポの .agent-skill-chain/source/ .agent-skill-chain/runtime/ workflow.db は変更しない。
#   参照: docs/maintainer/workflow/20260713_050350_issue紐づけ機械強制/03_実装計画.md §2.1
# =====================================================================================
echo "== #35 実装前ブランチ紐づけ未記録検知 =="

# #35 用 seed ヘルパー: <tree> <issue_path> <00 本文> で issue + implement ログを用意する。
seed_branch_issue() {
  local tree="$1" iss="$2" body="$3"
  mkdir -p "$tree/$iss"
  printf '%s' "$body" > "$tree/$iss/00_要求定義.md"
  local db="$tree/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$db" "CREATE TABLE IF NOT EXISTS workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  sqlite3 "$db" "INSERT INTO workflow_log VALUES ('e_$RANDOM$RANDOM', NULL, 'implement-feature', '$iss');" 2>/dev/null
}

if command -v sqlite3 >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then
  # シナリオ1: 違反系 FAIL（発効日以降・implement ログあり・branch null）。github.com remote 無しの
  #            git tree（gitlab remote）で発火することを確認＝#34 と違い github.com remote を要求しない。
  S35_1_TREE="$(make_git_tree_nongithub)"
  seed_branch_issue "$S35_1_TREE" "docs/maintainer/workflow/20260801_000000_br_ng" \
$'---\ndocument_id: "d1"\nissue_id: "i1"\ngithub_issue: "#1"\nbranch: null\n---\n'
  S35_1_OUT="$(bash "$AUDIT" "$S35_1_TREE" 2>&1)"
  if grep -q "ブランチ紐づけ未記録" <<< "$S35_1_OUT"; then
    ok "#35 違反系（branch null・非 github remote でも発火）で FAIL する"
  else
    ng "#35 違反系で FAIL しなかった（見逃し）: $S35_1_OUT"
  fi

  # シナリオ1b: branch キーが完全に欠落していても FAIL（後方互換パース＝未記録扱い）
  S35_1B_TREE="$(make_git_tree_github)"
  seed_branch_issue "$S35_1B_TREE" "docs/maintainer/workflow/20260801_000000_br_missing" \
$'---\ngithub_issue: "#1"\n---\n'
  S35_1B_OUT="$(bash "$AUDIT" "$S35_1B_TREE" 2>&1)"
  if grep -q "ブランチ紐づけ未記録" <<< "$S35_1B_OUT"; then
    ok "#35 branch キー欠落は未記録扱いで FAIL する"
  else
    ng "#35 branch キー欠落を見逃した: $S35_1B_OUT"
  fi

  # シナリオ2: 正常系 PASS（branch 非空）
  S35_2_TREE="$(make_git_tree_github)"
  seed_branch_issue "$S35_2_TREE" "docs/maintainer/workflow/20260801_000000_br_ok" \
$'---\ngithub_issue: "#1"\nbranch: "feat/some-branch"\n---\n'
  S35_2_OUT="$(bash "$AUDIT" "$S35_2_TREE" 2>&1)"
  if ! grep -q "ブランチ紐づけ未記録" <<< "$S35_2_OUT"; then
    ok "#35 正常系（branch 記録済み）は FAIL しない"
  else
    ng "#35 正常系で誤って FAIL した: $S35_2_OUT"
  fi

  # シナリオ3: 無効化トグル ON（BRANCH_LINK_GATE_ENABLED=false）→ 最優先 SKIP
  S35_3_OUT="$(BRANCH_LINK_GATE_ENABLED=false bash "$AUDIT" "$S35_1_TREE" 2>&1)"
  if ! grep -q "ブランチ紐づけ未記録" <<< "$S35_3_OUT"; then
    ok "#35 無効化トグル ON（BRANCH_LINK_GATE_ENABLED=false）で SKIP する（最優先ガード）"
  else
    ng "#35 無効化トグル ON でも FAIL した: $S35_3_OUT"
  fi

  # シナリオ4: grandfather SKIP（発効日前 prefix）
  S35_4_TREE="$(make_git_tree_github)"
  seed_branch_issue "$S35_4_TREE" "docs/maintainer/workflow/20260101_000000_br_old" \
$'---\nbranch: null\n---\n'
  S35_4_OUT="$(bash "$AUDIT" "$S35_4_TREE" 2>&1)"
  if ! grep -q "ブランチ紐づけ未記録" <<< "$S35_4_OUT"; then
    ok "#35 grandfather SKIP（発効日前 issue は FAIL しない）"
  else
    ng "#35 grandfather が機能せず遡及 FAIL した: $S35_4_OUT"
  fi

  # シナリオ5: implement-feature ログ 0 件は対象外 SKIP
  S35_5_TREE="$(make_git_tree_github)"
  S35_5_ISS="docs/maintainer/workflow/20260801_000000_br_noimpl"
  mkdir -p "$S35_5_TREE/$S35_5_ISS"
  printf '%s' $'---\nbranch: null\n---\n' > "$S35_5_TREE/$S35_5_ISS/00_要求定義.md"
  sqlite3 "$S35_5_TREE/.agent-skill-chain/runtime/workflow.db" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, parent_entry_id TEXT NULL, command TEXT NOT NULL, issue_path TEXT NULL);" 2>/dev/null
  S35_5_OUT="$(bash "$AUDIT" "$S35_5_TREE" 2>&1)"
  if ! grep -q "ブランチ紐づけ未記録" <<< "$S35_5_OUT"; then
    ok "#35 implement-feature ログ 0 件は対象外（FAIL しない）"
  else
    ng "#35 impl ログ 0 件でも FAIL した: $S35_5_OUT"
  fi

  # シナリオ6: close 配下 SKIP
  S35_6_TREE="$(make_git_tree_github)"
  seed_branch_issue "$S35_6_TREE" "docs/maintainer/workflow/close/20260801_000000_br_closed" \
$'---\nbranch: null\n---\n'
  S35_6_OUT="$(bash "$AUDIT" "$S35_6_TREE" 2>&1)"
  if ! grep -q "ブランチ紐づけ未記録" <<< "$S35_6_OUT"; then
    ok "#35 close SKIP（close 配下 issue は FAIL しない）"
  else
    ng "#35 close 除外が効いていない: $S35_6_OUT"
  fi
else
  echo "  [SKIP] #35 ブランチ紐づけ未記録検知の回帰（sqlite3 または git 不在）"
fi

# シナリオ7: DB 非採用 SKIP（sqlite3/DB 無し）
if command -v git >/dev/null 2>&1; then
  S35_7_TREE="$(make_git_tree_github)"
  S35_7_ISS="docs/maintainer/workflow/20260801_000000_br_nodb"
  mkdir -p "$S35_7_TREE/$S35_7_ISS"
  printf '%s' $'---\nbranch: null\n---\n' > "$S35_7_TREE/$S35_7_ISS/00_要求定義.md"
  S35_7_OUT="$(bash "$AUDIT" "$S35_7_TREE" 2>&1)"
  if ! grep -q "ブランチ紐づけ未記録" <<< "$S35_7_OUT"; then
    ok "#35 DB 非採用 SKIP（sqlite3/DB 無しで FAIL しない）"
  else
    ng "#35 DB 非採用でも FAIL した: $S35_7_OUT"
  fi
else
  echo "  [SKIP] #35 DB 非採用 SKIP 検証（git 不在）"
fi

# =====================================================================================
# #36 PR 紐づけ未記録検知（check_pr_issue_linkage）の回帰テスト
#   tmp 隔離（mktemp -d）。差分（GIT_RANGE）に issue を載せるため commit する git tree を使う。
#   参照: docs/maintainer/workflow/20260713_050350_issue紐づけ機械強制/03_実装計画.md §2.2
# =====================================================================================
echo "== #36 PR 紐づけ未記録検知 =="

# #36 用 seed ヘルパー: <tree> <issue_path> <github_issue 値> で issue を作り commit する（差分に載せる）。
# 直前に空コミットで base を作り HEAD~1..HEAD が当該 issue の追加を含むようにする。
seed_pr_issue() {
  local tree="$1" iss="$2" ghval="$3"
  mkdir -p "$tree/$iss"
  printf '%s' $'---\ngithub_issue: '"$ghval"$'\n---\n' > "$tree/$iss/00_要求定義.md"
  ( cd "$tree" && git add -A && git commit -qm "add $iss" >/dev/null )
}

if command -v git >/dev/null 2>&1; then
  # シナリオ1: PR_BODY 未設定（ローカル/push）は SKIP
  S36_1_TREE="$(make_git_tree_github)"
  ( cd "$S36_1_TREE" && git commit -q --allow-empty -m base >/dev/null )
  seed_pr_issue "$S36_1_TREE" "docs/maintainer/workflow/20260801_000000_pr1" '"#28"'
  S36_1_OUT="$(AUDIT_GIT_RANGE="HEAD~1..HEAD" bash "$AUDIT" "$S36_1_TREE" 2>&1)"
  if ! grep -q "PR 紐づけ未記録" <<< "$S36_1_OUT"; then
    ok "#36 PR_BODY 未設定（ローカル/push）は SKIP する"
  else
    ng "#36 PR_BODY 未設定でも FAIL した: $S36_1_OUT"
  fi

  # シナリオ2: PR_BODY 設定あり・Closes/Refs 無し・差分に非 declined の実 Issue 参照 issue → FAIL
  S36_2_OUT="$(PR_BODY="実装しました。説明のとおりです。" AUDIT_GIT_RANGE="HEAD~1..HEAD" bash "$AUDIT" "$S36_1_TREE" 2>&1)"
  if grep -q "PR 紐づけ未記録" <<< "$S36_2_OUT"; then
    ok "#36 違反系（Closes/Refs 無し・実 Issue 参照 issue 残存）で FAIL する"
  else
    ng "#36 違反系で FAIL しなかった（見逃し）: $S36_2_OUT"
  fi

  # シナリオ3: PR_BODY に Closes #N があれば PASS
  S36_3_OUT="$(PR_BODY="Closes #28" AUDIT_GIT_RANGE="HEAD~1..HEAD" bash "$AUDIT" "$S36_1_TREE" 2>&1)"
  if ! grep -q "PR 紐づけ未記録" <<< "$S36_3_OUT"; then
    ok "#36 正常系（PR 本文に Closes #N）は FAIL しない"
  else
    ng "#36 Closes #N ありで誤って FAIL した: $S36_3_OUT"
  fi

  # シナリオ3b: キーワード変種（fixes / resolves / refs / references / owner/repo#N・大小文字不問）で PASS
  S36_3B_FAIL=0
  for kw in "This fixes #28" "resolves #28" "Refs #28" "references #28" "CLOSES #28" "Fixes techbeansjp-free/AGENTS.md#28"; do
    _out="$(PR_BODY="$kw" AUDIT_GIT_RANGE="HEAD~1..HEAD" bash "$AUDIT" "$S36_1_TREE" 2>&1)"
    if grep -q "PR 紐づけ未記録" <<< "$_out"; then S36_3B_FAIL=1; echo "    [debug] 変種で誤 FAIL: '$kw'" >&2; fi
  done
  if [[ $S36_3B_FAIL -eq 0 ]]; then
    ok "#36 キーワード変種（fixes/resolves/refs/references/大小文字/owner-repo#N）を全て有効と判定"
  else
    ng "#36 一部のキーワード変種を有効と判定できなかった"
  fi

  # シナリオ4: 差分内 issue が declined のみ・Closes/Refs 無し → SKIP（対象外）
  S36_4_TREE="$(make_git_tree_github)"
  ( cd "$S36_4_TREE" && git commit -q --allow-empty -m base >/dev/null )
  seed_pr_issue "$S36_4_TREE" "docs/maintainer/workflow/20260801_000000_pr_declined" '"declined: 軽微な値修正のため"'
  S36_4_OUT="$(PR_BODY="実装しました" AUDIT_GIT_RANGE="HEAD~1..HEAD" bash "$AUDIT" "$S36_4_TREE" 2>&1)"
  if ! grep -q "PR 紐づけ未記録" <<< "$S36_4_OUT"; then
    ok "#36 declined のみの PR は対象外 SKIP（FAIL しない）"
  else
    ng "#36 declined 除外が効いていない: $S36_4_OUT"
  fi

  # シナリオ4b: 差分内 issue が github_issue null のみ・Closes/Refs 無し → SKIP（#34 の責務・非交差）
  S36_4B_TREE="$(make_git_tree_github)"
  ( cd "$S36_4B_TREE" && git commit -q --allow-empty -m base >/dev/null )
  seed_pr_issue "$S36_4B_TREE" "docs/maintainer/workflow/20260801_000000_pr_null" 'null'
  S36_4B_OUT="$(PR_BODY="実装しました" AUDIT_GIT_RANGE="HEAD~1..HEAD" bash "$AUDIT" "$S36_4B_TREE" 2>&1)"
  if ! grep -q "PR 紐づけ未記録" <<< "$S36_4B_OUT"; then
    ok "#36 github_issue null のみは対象外 SKIP（#34 と非交差）"
  else
    ng "#36 null 除外が効いていない（#34 と交差）: $S36_4B_OUT"
  fi

  # シナリオ5: 差分内 issue が grandfather（発効日前 prefix）のみ → SKIP
  S36_5_TREE="$(make_git_tree_github)"
  ( cd "$S36_5_TREE" && git commit -q --allow-empty -m base >/dev/null )
  seed_pr_issue "$S36_5_TREE" "docs/maintainer/workflow/20260101_000000_pr_old" '"#5"'
  S36_5_OUT="$(PR_BODY="実装しました" AUDIT_GIT_RANGE="HEAD~1..HEAD" bash "$AUDIT" "$S36_5_TREE" 2>&1)"
  if ! grep -q "PR 紐づけ未記録" <<< "$S36_5_OUT"; then
    ok "#36 grandfather のみの PR は対象外 SKIP（FAIL しない）"
  else
    ng "#36 grandfather 除外が効いていない: $S36_5_OUT"
  fi

  # シナリオ6: 差分に workflow issue 無し（コードのみ変更）→ SKIP
  S36_6_TREE="$(make_git_tree_github)"
  ( cd "$S36_6_TREE" && git commit -q --allow-empty -m base >/dev/null )
  mkdir -p "$S36_6_TREE/src"
  printf 'x\n' > "$S36_6_TREE/src/foo.txt"
  ( cd "$S36_6_TREE" && git add -A && git commit -qm codeonly >/dev/null )
  S36_6_OUT="$(PR_BODY="実装しました" AUDIT_GIT_RANGE="HEAD~1..HEAD" bash "$AUDIT" "$S36_6_TREE" 2>&1)"
  if ! grep -q "PR 紐づけ未記録" <<< "$S36_6_OUT"; then
    ok "#36 差分に workflow issue 無し（コードのみ）は SKIP（誤 FAIL なし）"
  else
    ng "#36 workflow issue 無しでも FAIL した: $S36_6_OUT"
  fi

  # シナリオ7: 無効化トグル ON（PR_LINK_GATE_ENABLED=false）→ 最優先 SKIP
  S36_7_OUT="$(PR_LINK_GATE_ENABLED=false PR_BODY="実装しました" AUDIT_GIT_RANGE="HEAD~1..HEAD" bash "$AUDIT" "$S36_1_TREE" 2>&1)"
  if ! grep -q "PR 紐づけ未記録" <<< "$S36_7_OUT"; then
    ok "#36 無効化トグル ON（PR_LINK_GATE_ENABLED=false）で SKIP する（最優先ガード）"
  else
    ng "#36 無効化トグル ON でも FAIL した: $S36_7_OUT"
  fi
else
  echo "  [SKIP] #36 PR 紐づけ未記録検知の回帰（git 不在）"
fi

# =====================================================================================
# #25 メイン直接作業検知の時系列突合是正（check_25_main_did_real_work）の回帰テスト
#   tmp 隔離（mktemp -d）。本開発リポの .agent-skill-chain/source/ .agent-skill-chain/runtime/ workflow.db は変更しない。
#   参照: docs/maintainer/workflow/20260714_180751_自己点検issue群対応/90_issues/20260714_163305_直接作業検知の弱い間接検出問題/03_実装計画.md
# =====================================================================================
echo "== #25 メイン直接作業検知の時系列突合是正 =="

# git tree を作るヘルパー（最小 issue ツリー＋初期コミット＋ check_25 の対象パターンに
# マッチする src/foo.txt を追加する 2 個目のコミット）。HEAD~1..HEAD の diff で src/foo.txt が
# 検出され、check_25 の「成果物変更あり」判定を発火させる。
make_git_tree_src() {
  local tmp
  tmp="$(make_min_tree)"
  ( cd "$tmp" && git init -q && git config user.email t@e.x && git config user.name t \
      && git add -A && git commit -qm init >/dev/null \
      && mkdir -p src && echo x > src/foo.txt && git add -A && git commit -qm "add src/foo.txt" >/dev/null )
  printf '%s\n' "$tmp"
}

if command -v git >/dev/null 2>&1 && command -v sqlite3 >/dev/null 2>&1; then
  # シナリオ1: 対象 command ログが皆無 → FAIL（既存動作を維持する回帰）
  # Given: 成果物変更（src/foo.txt）ありの git tree、workflow_log は空
  # When:  audit.sh <tmp> を AUDIT_GIT_RANGE=HEAD~1..HEAD で実行する
  # Then:  #25 の FAIL メッセージが出る
  S25_1_TREE="$(make_git_tree_src)"
  S25_1_DB="$S25_1_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S25_1_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S25_1_OUT="$(AUDIT_GIT_RANGE='HEAD~1..HEAD' bash "$AUDIT" "$S25_1_TREE" 2>&1)"
  if grep -q "may have done real work" <<< "$S25_1_OUT"; then
    ok "#25 対象 command ログが皆無で FAIL する（既存動作の回帰確認）"
  else
    ng "#25 ログ皆無でも FAIL しなかった（見逃し）: $S25_1_OUT"
  fi

  # シナリオ2（是正確認・異常系）: 対象差分と無関係な古いログのみ → FAIL する（旧実装は恒久 PASS していた不具合）
  # Given: 成果物変更ありの git tree（コミットは「今」）、workflow_log に 30 日前の implement-feature ログのみ
  # When:  audit.sh <tmp> を AUDIT_GIT_RANGE=HEAD~1..HEAD（既定許容窓 48h）で実行する
  # Then:  「証跡が対象差分に対して古すぎる」の FAIL メッセージが出る（時系列突合による新規検知）
  S25_2_TREE="$(make_git_tree_src)"
  S25_2_DB="$S25_2_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S25_2_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S25_2_OLD_TS="$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)"
  sqlite3 "$S25_2_DB" "INSERT INTO workflow_log VALUES ('e1','implement-feature',NULL,'$S25_2_OLD_TS');" 2>/dev/null
  S25_2_OUT="$(AUDIT_GIT_RANGE='HEAD~1..HEAD' bash "$AUDIT" "$S25_2_TREE" 2>&1)"
  if grep -q "証跡が対象差分に対して古すぎる" <<< "$S25_2_OUT"; then
    ok "#25 対象差分と無関係な古いログのみで FAIL する（時系列突合・新規検知）"
  else
    ng "#25 古いログのみでも FAIL しなかった（旧実装の恒久 PASS バグが再発）: $S25_2_OUT"
  fi

  # シナリオ3（正常系）: 対象差分の直近に対応するログがある → FAIL しない
  # Given: 成果物変更ありの git tree、workflow_log に現在時刻の implement-feature ログ
  # When:  audit.sh <tmp> を実行する
  # Then:  #25 の FAIL メッセージが出ない
  S25_3_TREE="$(make_git_tree_src)"
  S25_3_DB="$S25_3_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S25_3_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S25_3_RECENT_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  sqlite3 "$S25_3_DB" "INSERT INTO workflow_log VALUES ('e1','implement-feature',NULL,'$S25_3_RECENT_TS');" 2>/dev/null
  S25_3_OUT="$(AUDIT_GIT_RANGE='HEAD~1..HEAD' bash "$AUDIT" "$S25_3_TREE" 2>&1)"
  if ! grep -q "may have done real work" <<< "$S25_3_OUT" && ! grep -q "証跡が対象差分に対して古すぎる" <<< "$S25_3_OUT"; then
    ok "#25 直近ログありは FAIL しない（正常フロー回帰無し）"
  else
    ng "#25 直近ログありでも誤って FAIL した: $S25_3_OUT"
  fi

  # シナリオ4: 許容窓（MAIN_WORK_GATE_TOLERANCE_SECONDS）が既定(48h)超で FAIL し、拡大すると FAIL しない
  # Given: 成果物変更ありの git tree、workflow_log に 3 日前の implement-feature ログ
  # When:  (a) 既定許容窓で実行 (b) MAIN_WORK_GATE_TOLERANCE_SECONDS=604800（7日）で実行
  # Then:  (a) FAIL する (b) FAIL しない
  S25_4_TREE="$(make_git_tree_src)"
  S25_4_DB="$S25_4_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S25_4_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S25_4_TS="$(date -u -d '3 days ago' +%Y-%m-%dT%H:%M:%SZ)"
  sqlite3 "$S25_4_DB" "INSERT INTO workflow_log VALUES ('e1','implement-feature',NULL,'$S25_4_TS');" 2>/dev/null
  S25_4A_OUT="$(AUDIT_GIT_RANGE='HEAD~1..HEAD' bash "$AUDIT" "$S25_4_TREE" 2>&1)"
  if grep -q "証跡が対象差分に対して古すぎる" <<< "$S25_4A_OUT"; then
    ok "#25 既定許容窓(48h)超のログで FAIL する（3日前ログ）"
  else
    ng "#25 既定許容窓超でも FAIL しなかった: $S25_4A_OUT"
  fi
  S25_4B_OUT="$(MAIN_WORK_GATE_TOLERANCE_SECONDS=604800 AUDIT_GIT_RANGE='HEAD~1..HEAD' bash "$AUDIT" "$S25_4_TREE" 2>&1)"
  if ! grep -q "証跡が対象差分に対して古すぎる" <<< "$S25_4B_OUT"; then
    ok "#25 許容窓を env で拡大(7日)すると同ログで FAIL しない"
  else
    ng "#25 許容窓拡大が反映されず誤って FAIL した: $S25_4B_OUT"
  fi

  # シナリオ5: 非 git ツリーは従来どおり SKIP（既存動作維持）
  # Given: 成果物変更相当のファイルを含むが .git が無いツリー、workflow_log にログあり
  # When:  audit.sh <tmp> を実行する
  # Then:  #25 の FAIL メッセージが出ない（git 依存 check は SKIP）
  S25_5_TREE="$(make_min_tree)"
  mkdir -p "$S25_5_TREE/src"
  : > "$S25_5_TREE/src/foo.txt"
  S25_5_DB="$S25_5_TREE/.agent-skill-chain/runtime/workflow.db"
  sqlite3 "$S25_5_DB" "CREATE TABLE workflow_log (entry_id TEXT PRIMARY KEY, command TEXT NOT NULL, issue_path TEXT NULL, ts_utc TEXT NULL);" 2>/dev/null
  S25_5_OUT="$(bash "$AUDIT" "$S25_5_TREE" 2>&1)"
  if ! grep -q "may have done real work" <<< "$S25_5_OUT" && ! grep -q "証跡が対象差分に対して古すぎる" <<< "$S25_5_OUT"; then
    ok "#25 非 git ツリーは SKIP する（既存動作維持）"
  else
    ng "#25 非 git ツリーで誤って FAIL した: $S25_5_OUT"
  fi

  # シナリオ6: workflow.db 不在は従来どおり SKIP（既存動作維持）
  # Given: 成果物変更ありの git tree、workflow.db 自体を作らない
  # When:  audit.sh <tmp> を実行する
  # Then:  #25 の FAIL メッセージが出ない
  S25_6_TREE="$(make_git_tree_src)"
  S25_6_OUT="$(AUDIT_GIT_RANGE='HEAD~1..HEAD' bash "$AUDIT" "$S25_6_TREE" 2>&1)"
  if ! grep -q "may have done real work" <<< "$S25_6_OUT" && ! grep -q "証跡が対象差分に対して古すぎる" <<< "$S25_6_OUT"; then
    ok "#25 workflow.db 不在は SKIP する（既存動作維持）"
  else
    ng "#25 DB 不在でも誤って FAIL した: $S25_6_OUT"
  fi
else
  echo "  [SKIP] #25 メイン直接作業検知の時系列突合是正の回帰（git/sqlite3 不在）"
fi

echo
echo "== 結果: PASS=$PASS FAIL=$FAIL =="
if [[ $FAIL -gt 0 ]]; then
  printf '  失敗: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
exit 0
