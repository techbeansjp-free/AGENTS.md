---
document_id: "a7f3c1d2-9e84-4b56-bf20-5c8d1e6a7042"
---

# レビュー書: system-graph .agents-project ポリシーのコア取り込み

**プロジェクト名**: system-graph .agents-project ポリシーのコア取り込み
**作成日**: 2026 年 06 月 14 日
**最終更新**: 2026 年 06 月 14 日

> **重要**: 本 04_review は verify-and-close（レビューフェーズ）で作成。実装フェーズ（第1波コンテンツ群・第2波 enforcement 群）完了後の正式レビュー成果物。
>
> **レビュー深度**: **full**（新規本体 3 ファイル＋既存追記＋enforcement への実コード追加を伴う大規模変更）。[.agents/REVIEW_RULE.md](../../../../../.agents/REVIEW_RULE.md)・[.agents/REVIEW_DUAL_LENS.md](../../../../../.agents/REVIEW_DUAL_LENS.md)（二観点・両リスト必須＝ドッグフーディング適用）に従う。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認・受け入れ基準の充足確認・設計境界の確認・テスト再実行による品質保証、およびクローズ可否の判定。

### 1.2 レビュー対象（必須）

- **実装範囲**: 新規本体 3（`.agents/CODE_COMMENT_RULES.md` / `REVIEW_DUAL_LENS.md` / `MODEL_SELECTION.md`）、既存追記（implement-feature.md §クローズアウト＋欠落工程(i)〜(v)＋ISSUE_CREATION 小見出し、verify-and-close.md §クローズアウト）、配線（LOAD_POLICY 3行・RULES.md・run_command.md・review-code/architecture SKILL・CLAUDE.md・PHASES.md・HEARTBEAT.md）、enforcement（audit.sh の resolve_workflow_dirs() 複数Dir化＋新規 check #26〜#29、enforcement/README.md 5箇所同期）。
- **レビュー期間**: 2026-06-14 ～ 2026-06-14
- **レビュー担当者**: verify-and-close 監査サブエージェント（auditor ロール）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| T0 アンカー規約 | 相互参照アンカーを確定文字列で固定 | 2026-06-14 | 第1波 | 完了 |
| T1 CODE_COMMENT_RULES | 新規本体＋LOAD_POLICY/RULES 配線 | 2026-06-14 | 第1波 | 完了 |
| T2 REVIEW_DUAL_LENS＋CLOSEOUT 束 | 新規本体＋欠落工程(i)〜(v)追記＋SKILL 出力要求 | 2026-06-14 | 第1波 | 完了 |
| T3 MODEL_SELECTION | 新規本体（抽象原則のみ）＋run_command ティア明記＋LOAD_POLICY | 2026-06-14 | 第1波 | 完了 |
| T4 ISSUE_CREATION | implement-feature §クローズアウト姉妹小見出し＋CLAUDE.md リンク | 2026-06-14 | 第1波 | 完了 |
| T5 enforcement #26/#27 | check_code_comment_external_ref / check_review_dual_lists | 2026-06-14 | 第2波 | 完了 |
| TP0 走査スコープ複数Dir | resolve_workflow_dirs() | 2026-06-14 | 第2波 | 完了 |
| TP1a/TP1c ポインタ・HEARTBEAT | CLAUDE/PHASES ポインタ・HEARTBEAT 作成場所項 | 2026-06-14 | 第1波 | 完了 |
| TP1b #28 誤配置検知 | check_issue_doc_in_gitignored_path | 2026-06-14 | 第2波 | 完了 |
| TP2a #29 実装前04検知 | check_review_before_implement | 2026-06-14 | 第2波 | 完了 |
| TP2b/TP2c HEARTBEAT・run_command | verify飛ばし項追記・#29 相互参照 | 2026-06-14 | 第1/2波 | 完了 |

### 2.2 実装内容の詳細

#### 新規本体 3 ファイル

- **CODE_COMMENT_RULES.md**: §1 目的／§2 禁止（外部参照）／§3 許可（コード参照）／§4 張り替え／§5 enforcement／汎用固有境界。責務 1 文・正本 1 か所明記あり。
- **REVIEW_DUAL_LENS.md**: §1 目的（churn/退行）／§2 二観点（2.1 敵対的・2.2 肯定的=must-preserve）／§3 証跡要求（両リスト未記載＝未完了）／§4 深さ（quick/standard/full 流用）／§5 参照。確定アンカー `#3-証跡要求`・`#2-2-肯定的観点` 実在。
- **MODEL_SELECTION.md**: §1 適用条件（Claude ランタイム時のみ・対象外環境はデフォルト）／§2 ティア明記義務／§3 品質ゲート最上位／§4 未収束エスカレーション／§5 参照。**具体ティア対応表（haiku/sonnet/top）は本体に非混入**を grep 実測（後述 #T3）。

#### CLOSEOUT 追記差分（implement-feature.md / verify-and-close.md）

- §クローズアウト節を新設し、欠落工程 (i) commit ステップ（push はユーザー明示時のみ）／(ii) 別セッション引継ぎ＋再開プロンプト／(iii) clear 境界・safe-clear invariant／(iv) fresh サブ分割＋収束保証／(v) verify-実経路検証 を小見出しで列挙。
- 既存重複工程（verify 必須・指摘 0 反復・04_review・90_issues）は **本文再記述せず** REVIEW_RULE.md / run_command.md / RULES.md へリンク委譲（CORE.md:137）。
- ISSUE_CREATION は implement-feature §クローズアウト配下の姉妹小見出しに 1 か所配置、CLAUDE.md からはリンクのみ。
- 除外固有値（make check/Docker・docs/97_・develop/main・Co-Authored-By・FakeDriver）の非混入を第1波 memo grep で確認済み。

#### enforcement（audit.sh）

- `resolve_workflow_dirs()` で `WORKFLOW_SCAN_DIRS` 配列を構築。WORKFLOW_DIRS 設定時は置換セマンティクス、未設定時は `.workflow`＋（実在時のみ）`docs/maintainer/workflow`。非実在除外・重複正規化。
- find ベースの各 section（#1/#2b/#4/#5/#7/#20）をリストループ化。DB 参照系（#3/#8/#9/#11）は workflow.db 位置依存のため WORKFLOW_DIR 据置。
- 新規 4 関数 #26〜#29 を実装・末尾呼び出し登録。

---

## 3. テスト結果の確認

### 3.1 単体テスト（audit.sh 新規 check の再実行）

**テスト隔離（必須・`.agents-project/自己拡張ワークフロー.md` 準拠）**: `mktemp -d` ＋ `git archive HEAD | tar -x` でクリーン環境を再現し、`git init`／commit でコミット履歴と `.gitignore` を再現。本リポの `.agents/` `.workflow/` `workflow.db` は**不破壊**（テスト後 `rm -rf` で片付け済み。`git status` で `.workflow/`・`workflow.db` 無変更を確認）。

#### テスト実行結果

- **実行日**: 2026-06-14
- **テスト対象 check 数**: 4（#26/#27/#28/#29）
- **正常系・誤検出回避・SKIP・耐性ケース**: 全 9 ケース実行
- **成功**: 9
- **失敗**: 0
- **スキップ**: 0

#### 再実行ケースと結果（OK=期待どおり）

| # | ケース | 期待 | 結果 |
| - | ------ | ---- | ---- |
| #28 | `.workflow/badissue/00_*.md`（gitignore 配下）誤配置 | FAIL | **OK**（FAIL 出力。docs/good・templates は pass） |
| #28 | 非 git ツリー / templates | SKIP/pass | **OK**（gitignore セマンティクス: `.workflow/foo/00` exit0・docs exit1・templates exit1） |
| #26 | `src/bad.py`（仕様名.md・§3.2・PR #123・Issue #42） | FAIL（行番号付き） | **OK**（bad.py:1,2,3 を検知） |
| #26 | `src/good.py`（import パス・`obj.method()`・`ClassName.method`・`build_index()`） | 非検知 | **OK**（誤検出なし） |
| #27 | 差分 04（敵対的観点のみ・must-preserve 欠落） | FAIL | **OK** |
| #27 | 差分 04（両リストあり） | pass | **OK** |
| #29 | `before_impl`（04 有・ログ無） | FAIL | **OK**（before_impl のみ FAIL） |
| #29 | `impl_done`（04 有・ログ有） | pass | **OK**（非交差・誤 FAIL なし） |
| #29 | DB 不採用（WF_DB 不在） | SKIP | **OK**（冒頭 return 0） |
| #29 | issue_path が `/04_review.md` サフィックス形のログ | pass（前方一致救済） | **OK**（H-2' 表記揺れ耐性確認） |

#### 現行リポでの self-enforcing CI 不違反確認（前方一致 SQL 直接クエリ含む）

- 現行リポ（読み取り専用・非破壊）で audit 全実行 → **#26〜#29 由来の新規 FAIL は 0 件**（`FAIL: コメント外部参照` / `FAIL: REVIEW_DUAL` / `FAIL: issue ドキュメント…gitignore` / `FAIL: 実装前に 04` のいずれも出力なし）。
- 完了 issue 救済の前方一致 SQL 直接クエリ（`配布とパッケージ構成の再設計` を `= dir OR LIKE dir/% OR LIKE %/base OR LIKE %/base/%`）→ **10 行**該当 → #29 は完了 issue を pass（誤 FAIL なし）。
- 本 issue（`20260614_162712_コア取り込み候補調査`）は本 04 作成前は 04_review.md 不在 → #29 は 04 不在で非発火（正しい挙動）。

### 3.2 統合テスト（配線の結線）

- LOAD_POLICY トリガー 3 行・run_command ティア明記・skills/review 両出力要求・CLAUDE/PHASES/HEARTBEAT ポインタの存在を grep 実測（すべて存在）。

### 3.3 E2E テスト

導入順序（CODE_COMMENT → REVIEW_DUAL＋CLOSEOUT 束 → MODEL → ISSUE_CREATION）の相互リンク双方向実在は第1波 memo で grep 確認済み（リンク切れ 0）。本 04 では SQL/関数レベルで独立検証。

---

## 4. コードレビュー

### 4.1 コード品質

#### コードスタイル

- **bash 構文チェック**: `bash -n audit.sh` → エラー 0。
- **既存イディオム踏襲**: 新規 4 関数は既存 `check_*` 様式（DB ガード・`issue_path_rel` 相対化・SQL エスケープ `${//\'/\'\'}`・`EXIT_CODE=1`・`$ROLLBACK_MSG`）を踏襲。
- **全角数字 collation バグ**: `[0-9０-９]` を列挙 alternation＋`LC_ALL=C` grep に修正済（第2波 memo 記載・隔離テストで再現解消確認）。

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | 各 check 関数に責務コメント・番号付与 | OK | ヘッダと本体に番号一貫 |
| 保守性 | 走査基点を resolve_workflow_dirs() に集約・最小差分 | OK | 判定ロジック不変・基点のみ複数化 |
| パフォーマンス | 重複ディレクトリ正規化で二重走査回避 | OK | - |
| セキュリティ | push はユーザー明示時のみ（CLOSEOUT commit）・SQL エスケープ | OK | 高リスク操作の自動化文面なし |

### 4.2 指摘事項

#### 指摘 1: audit.sh の `set -e` × 末尾 `[[ ]]` による早期終了（既存・本 issue 非由来）

- **重要度**: 低（Low／本 issue スコープ外・申し送り）
- **指摘内容**: audit.sh は `set -e`（L58）で動作する。既存チェック関数（例 `check_delegated_by_role` #13・cf14d00 で導入、本 issue 非変更）は `if [[ count -gt 0 ]]; then …; fi` で終わり、条件が偽のとき**関数の最終コマンドが偽の `[[ ]]`＝戻り値 1** となる。これがトップレベル呼び出しの最終関数になると `set -e` で**スクリプトが exit 0 のまま静かに途中終了**し、後続 check（#20・#26〜#29 を含む）に到達しないケースが、DB/データ状態によっては起こりうる。隔離環境（空 DB の最小クローン）で本現象を観測した。
- **本 issue 由来でない根拠**: 当該パターンは既存 #12〜#19 等に内在し、`check_delegated_by_role` は cf14d00（本 issue 前）で追加。**新規 #26〜#29 はこのアンチパターンを回避**（冒頭 early-return ガード＋条件式中での評価で末尾が偽 `[[ ]]` にならない設計）。現行リポ（実 DB・実データ）では #26〜#29 まで到達することを実測済（[audit] checking …(#26〜#29) 出力確認）。
- **対応状況**: 未対応（本 issue スコープ外）。
- **対応方法**: 別タスクで各 check 関数末尾に `return 0` を付すか `set -e` 運用を見直す。本 issue のクローズはブロックしない（新規実装は影響を受けず、本番状態では正常動作する）。

#### 指摘 2: 第2波の申し送り懸念（TP0 走査拡大による既存 check の docs 配下検知）— §5 で重大度評価

- **重要度**: 低（Low／設計で許容済み）
- 詳細は本書「§5 設計・境界の確認」内「第2波申し送りの評価」を参照。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| 00_要求定義.md | 更新済み | auditor | 2026-06-14 |
| 01_要件定義.md | 更新済み | auditor | 2026-06-14 |
| 02_設計.md | 更新済み | auditor | 2026-06-14 |
| 03_実装計画.md | 更新済み | auditor | 2026-06-14 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（03 のタスク T0〜T5・TP0〜TP2c に対し実装の対応を確認）。
- **要件と実装の整合性**: 整合している（受け入れ基準照合は下記 §受け入れ基準の確認）。
- **コメント**: 採番は 03 では #26/#27 が二重主張だったが、第2波で「新規 check は実 4 つ」と判断し #26〜#29 の一意連番に再割当（README 現行最大 #25 を確認のうえ）。設計意図（単一番号同期）を保ったまま採番衝突を正しく解消。

### 受け入れ基準の確認（00 §6 / 01 BDD）

| 基準 | 内容 | 判定 |
| ---- | ---- | ---- |
| 00 §6-1 | 取り込み 8 件の推奨度・可否・取り込み先・抽象/固有が 01 に判定可能形で記載 | OK |
| 00 §6-2 | 横断所見（3 ポリシー相互参照・CORE.md:137・導入順序）が 00/01 に明記 | OK |
| 00 §6-3 | 高推奨 3 件で欠落点と既存重複点が区別され差分特定 | OK（CLOSEOUT は欠落工程(i)〜(v)のみ追記・既存重複はリンク委譲） |
| 00 §6-4 | 除外 3 件（DOCS_RULES 本体/WORKFLOW_REF/README）＋§全廃が理由付き除外 | OK |
| P1-1 | CLAUDE.md に `.agents-project/` 上書き最優先ポインタ | OK（CLAUDE.md L18） |
| P1-2 | `.workflow/<issue>/` の issue ドキュメントで audit FAIL（templates 除外）＋README 同期 | OK（#28 隔離テスト FAIL／templates pass・README 5 箇所） |
| P2-1 | implement ログ無し issue の 04 存在で audit FAIL＋README 同期 | OK（#29 隔離テスト FAIL／DB 不採用 SKIP・README 5 箇所） |
| P1/P2-共通 | P1/P2 が取り込みスコープと区別された独立要求グループとして 00/01 に記載 | OK |
| 01 シナリオ 1〜10 | 取り込み判定・差分・除外・順序の BDD | OK（実装は判定どおり配置・配線） |
| 01 シナリオ 11〜14 | 誤配置 audit・ポインタ・実装前 04 audit・単一番号同期 | OK（#28/#29 隔離テスト・README 同期で実証） |

---

## 6. パフォーマンス確認

- 走査ディレクトリの重複正規化により二重判定を回避。判定ロジック自体は不変で、走査基点の複数化のみ。コンテキスト効率（新規本体は小さく単一責務・配線は最小行追記）を維持。

---

## 7. セキュリティ確認

| 項目 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 高リスク操作 | CLOSEOUT commit の push はユーザー明示時のみ | OK | 自動 push 文面なし |
| 入力検証 | audit.sh の SQL は `${//\'/\'\'}` でエスケープ | OK | 既存イディオム踏襲 |
| 機密境界 | 固有値（トレーラ・CI コマンド・対応表）はコアに非混入 | OK | `.agents-project/` に閉じる |

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本変更は `.agents/`（実行契約コア）の自己拡張であり、`docs/`（システム仕様書）の機能仕様には影響しないため。レビュー証跡は本 04_review に集約。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: OK。「正本（本体）＋索引（配線）」レイヤ分離・1 ポリシー=1 ファイル・浅い階層配置（`.agents/` 直下）。UNIX 哲学（1 ファイル 1 責務）に準拠。
- **CORE.md:137 重複禁止**: OK。新規本体は各 1 か所（CODE_COMMENT_RULES / REVIEW_DUAL_LENS / MODEL_SELECTION）。RULES.md は CODE_COMMENT へリンク 1 行（本文非再記述）。CLOSEOUT 既存工程は本文化せずリンク委譲。README は定義の正・audit.sh は実装（別文言重複なし）。MODEL_SELECTION に対応表非混入。PF 中立性（対象外環境明記）維持。
- **相互参照リンクの実在（宙吊り 0）**: OK。第1波で `#高リスク操作-1`（bold bullet でアンカー不可）を `[RULES.md] §高リスク操作` に修正し宙吊り解消。MODEL §5 → REVIEW_DUAL_LENS `#3-証跡要求`・implement-feature `#クローズアウト欠落工程の補完` が実在。

### 9.2 境界・依存の確認

- **責務の境界**: コア=抽象ルール、`.agents-project/`=具体値の分離が各新規本体に明記。
- **依存関係**: 束（REVIEW_DUAL＋CLOSEOUT）を同時導入し参照宙吊りを回避。ISSUE_CREATION は CLOSEOUT 後配置。意図しない循環なし（相互リンクは索引のみ）。

### 第2波申し送りの評価（item 5・重大度付き）

> 懸念: 「TP0 走査拡大により既存 check（#2b/#3/#4/#7/#20）が docs 配下の既存データ状態を検知し、audit 全実行が文字通りには clean にならない」。

- **(a) #26〜#29 由来か既存 check のデータ状態か**: **既存 check のデータ状態**である。現行リポ audit の FAIL 4 件はすべて既存 check 由来（#2b 90_issues 不在＝`docs/.../close`／#3 04_review 未更新＝本 issue 自身が実装済みで 04 未作成だったため／#7 TODO/FIXME 残存）であり、ERROR 群は #20 document_id 不整合（close 配下 issue の document_id が再生成 DB に不在）。**#26〜#29 由来の FAIL は 0 件**を実測。なお #3 が本 issue を指していたのは本 04_review 作成前の状態であり、本 verify-and-close による 04 作成で解消する。
- **(b) continue-on-error・02 §9.5.6(c) との整合**: **整合する**。`.github/workflows/self-enforce.yml` は audit.sh を `continue-on-error: true`（非ブロッキング、本リポの issue は docs 配下で audit.sh が .workflow 前提のため）で実行。02 §9.5.6(c) は「TP0 スコープ拡大で既存 check が docs 配下の既存データを検知（FAIL 出力）しても continue-on-error で CI を赤くしない」「ブロッキング化は別タスク」と明示的に許容。前方一致の有効性は audit 全実行でなく SQL 直接クエリで担保する設計（§9.5.6(d)）であり、本 04 でも SQL クエリ（10 行返却）で独立検証済。
- **(c) 追加対応の要否／重大度**: **追加対応不要・重大度 Low**。設計で予見・許容済みの既存データ状態であり、新規 #26〜#29 の正しさ（self-FAIL なし・誤検出回避・前方一致救済）は隔離テストと SQL クエリで実証済み。`docs/maintainer/workflow/close/` 配下の既存データ（90_issues 欠落・document_id 不在等）の clean 化、および self-enforce のブロッキング化は、本 issue とは独立の別タスク（任意）として切り分けるのが妥当。**High 級の問題は無く、本 issue のクローズをブロックしない。**

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| #26〜#29 の正常系・誤検出回避・SKIP・前方一致が期待どおり | test_output | tmp 隔離（mktemp -d＋git archive）での関数単位再実行 9 ケース |
| #26〜#29 が現行リポで新規 self-FAIL を出さない | observed_runtime | 現行リポ audit 全実行（読み取り専用）＋前方一致 SQL 直接クエリ 10 行 |
| CORE.md:137 重複禁止の遵守（新規本体 1 か所・配線リンクのみ） | existing_code | 実ファイル grep（RULES リンク 1 行・CLOSEOUT 本文非再記述・対応表非混入） |
| TP0 申し送りが設計で許容済み | external_spec | 02_設計 §9.5.6(c)(d)・self-enforce.yml continue-on-error: true |
| 採番 #26〜#29 が README 現行最大 #25 の次連番で妥当 | existing_code | enforcement/README.md 失敗条件表・第2波 memo |

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題 1（Low・別タスク）**: audit.sh の `set -e` × 末尾 `[[ ]]` 早期終了（既存・本 issue 非由来）。
  - **影響範囲**: 特定 DB/データ状態で audit が後続 check に到達せず exit 0 で終わりうる。本番状態では #26〜#29 まで到達を実測。
  - **対応方法**: 別タスクで各 check 末尾に `return 0` 付与または `set -e` 運用見直し。
- **課題 2（Low・別タスク）**: `docs/maintainer/workflow/close/` 配下の既存データ（90_issues 欠落・document_id 再生成 DB 不在）を既存 check が検知。
  - **影響範囲**: continue-on-error で CI ブロックなし。設計許容済み。
  - **対応方法**: 別タスクで close 配下データの clean 化・必要なら self-enforce のブロッキング化。

### 10.2 改善提案

- **改善 1**: audit.sh 全 check 関数末尾の `return 0` 統一（堅牢性向上）。
  - **効果**: `set -e` 早期終了のフラジリティ解消、全 check 到達の保証。

---

## 11. システム仕様書の更新

### 11.1 システム仕様書の確認結果

- 本 issue はコア実行契約（`.agents/`）の自己拡張であり、`docs/` のシステム機能仕様への影響なし。

### 11.2 システム仕様書の更新状況

- 更新不要（理由は「docs 更新」節参照）。

---

## 12. レビュー結果

### REVIEW_DUAL_LENS 適用（ドッグフーディング・両リスト必須）

#### 敵対的観点リスト（反証・破壊。不確実なら要修正に倒す）

1. **「audit 全実行が clean」を反証**: 反証成立（既存 check 由来の FAIL は出る）。ただし #26〜#29 由来でないことを出力分類で確認 → 本 issue の品質ゲートは通過。
2. **#26 のコード参照誤検出を攻撃**: `import os.path`・`obj.method()`・`ClassName.method`・`build_index()` を含む good.py で誤検出ゼロを実測 → 破壊試行失敗（堅牢）。
3. **#29 を完了 issue で誤 FAIL させようと攻撃**: 表記揺れ（`/04_review.md` サフィックス）・close 移動を狙うも前方一致＋basename 救済で pass → 破壊失敗。
4. **#28 を一般消費者で誤 FAIL させようと攻撃**: 追跡運用（gitignore しない）で exit 1 → pass、本リポ gitignore 配下のみ FAIL。git check-ignore の客観事実判定で消費者運用差を自然吸収 → 破壊失敗。
5. **CORE.md:137 違反を探索**: RULES/CLOSEOUT/README で本文重複・対応表混入・宙吊りリンクを grep 探索 → いずれも検出されず。
6. **set -e フラジリティを攻撃**: 空 DB クローンで後続 check 到達不能を観測。ただし既存・本 issue 非由来・本番状態では到達 → 要修正に倒し Low 指摘＋別タスク申し送りとして残置（クローズはブロックせず）。

#### must-preserve リスト（壊してはならない不変条件）

1. **既存 #1〜#25 のロジック不変**: 走査基点の複数化のみで判定ロジック改変なし（保持）。
2. **後方互換（汎用消費者＝`docs/maintainer/workflow` 不在）**: 走査リストが `.workflow` のみ＝従来同一挙動（隔離テストで確認・保持）。
3. **マルチ PF 中立性**: MODEL_SELECTION に対応表非混入・対象外環境明記（保持）。
4. **正本 1 か所（CORE.md:137）**: 新規本体 1 か所・配線はリンク／最小行・README 正/audit.sh 実装（保持）。
5. **04_review は実装完了後の verify-and-close でのみ作成**: 本 04 は実装フェーズ完了後に作成（#29 が保護する不変条件自体を遵守・保持）。
6. **高リスク操作（push）はユーザー明示時のみ**: CLOSEOUT commit 文面に自動 push なし（保持）。
7. **既存レビュー骨格（REVIEW_RULE 直交追加）**: REVIEW_DUAL_LENS は骨格を改変せず直交追加（保持）。

### 12.1 総合評価

- **実装品質**: 良好（受け入れ基準全充足・CORE.md:137 遵守・宙吊り 0）。
- **テスト品質**: 良好（#26〜#29 を tmp 隔離で正常系/誤検出回避/SKIP/前方一致 9 ケース再実行・全 OK・SQL 直接クエリ実証）。
- **ドキュメント品質**: 良好（00〜03 整合・採番衝突を正しく解消）。
- **総合評価**: **クローズ可**（High/重大ブロッカーなし。Low 指摘 2 件はいずれも本 issue 非由来または設計許容済みで別タスク申し送り）。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close 監査サブエージェント（auditor）
- **承認日**: 2026-06-14
- **承認コメント**: 受け入れ基準（取り込み 8 件判定・横断所見・高推奨 3 件・除外 3 件＋§全廃・P1-1/P1-2/P2-1/共通）すべて充足。CORE.md:137 重複・PF 中立性・宙吊りいずれも問題なし。テスト再実行は全 OK。第2波申し送りは Low（設計許容済み）。**クローズ可。** 完了済みトップレベル issue として `docs/maintainer/workflow/close/` への移動が妥当（残タスク・未完了サブ issue なし）。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md)
- [`01_要件定義.md`](./01_要件定義.md)
- [`02_設計.md`](./02_設計.md)
- [`03_実装計画.md`](./03_実装計画.md)

### 13.2 その他の参考資料

- [.agents/REVIEW_DUAL_LENS.md](../../../../../.agents/REVIEW_DUAL_LENS.md)・[.agents/REVIEW_RULE.md](../../../../../.agents/REVIEW_RULE.md)・[.agents/enforcement/README.md](../../../../../.agents/enforcement/README.md)・[.agents/enforcement/ci/audit.sh](../../../../../.agents/enforcement/ci/audit.sh)
- memo: `20260614_222618_第1波実装grep検証証跡.md`・`20260614_224452_enforcement群実装_tmp隔離回帰実測.md`

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md)

---

## 15. 次のステップ

- レビュー承認済み・クローズ可。完了済みトップレベル issue として close へ移動（書記記録後）。
