---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "0e4fb8be-3dab-4838-bee1-cf2a8c6f2ef3"
---

# レビュー書: システム仕様書の完備・強制・テンプレート刷新（継続的な最新性・正確性の保証）

**プロジェクト名**: システム仕様書の完備・強制・テンプレート刷新
**作成日**: 2026 年 07 月 11 日
**最終更新**: 2026 年 07 月 11 日

> **重要**: **このドキュメントは常に更新**: レビューで発見した問題点や改善提案、対応内容などがあった場合は、即座にこのドキュメントを更新してください。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。
>
> **必須**: レビューは [.agent-skill-chain/source/REVIEW_RULE.md](../../../../../../../.agent-skill-chain/source/REVIEW_RULE.md) に従う。本 issue は新規・複数ファイルの規約/テンプレート/enforcement 変更のためレビュー深度は **full**。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

verify-and-close（検証・クローズ）フェーズとして、本サブ issue の実装（タスク 1〜6）が 00〜03 の要求・要件・設計・実装計画を満たし、SC-1〜SC-8・AC 全項目に対応していること、および実装担当の自己申告を鵜呑みにせず独立再検証したうえでクローズ可否を判定することを目的とする。

### 1.2 レビュー対象（必須）

- **実装範囲**: R-1〜R-5 の 5 手段を既存 docs 規約・テンプレート・enforcement・verify-and-close へ加算的に組み込む。新規 `DOCS_NOISE_RULES.md`、`DOCS_RULES.md`/`RULES.md`/`verify-and-close.md`/`04_review.md`(テンプレート)/`enforcement/README.md`/`enforcement/ci/audit.sh` の変更、テンプレート docs 群（`05_規約/`・`00_review/README.md`・`README.md`・`99_ID命名規則と管理/README.md`）の新設・追記。
- **レビュー期間**: 2026-07-11 ～ 2026-07-11
- **レビュー担当者**: verify-and-close 担当サブエージェント（独立監査）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| T1 (R-3) | `DOCS_NOISE_RULES.md` 新設（禁止 4 パターン・コード層境界） | 2026-07-11 | implement-feature 担当 | 完了 |
| T2 (R-1/R-5) | `DOCS_RULES.md` に §greenfield 規約必須文書化・§ノイズ排除参照・§継続追随ゲート追記 | 2026-07-11 | 同上 | 完了 |
| T3 (R-4) | テンプレート刷新（05_規約+索引 / 00_review 索引 / README 相互リンク / 99 全数採番） | 2026-07-11 | 同上 | 完了 |
| T4 (R-5) | `verify-and-close.md` 必須化 + `04_review.md` テンプレートのゲート結果記載枠 | 2026-07-11 | 同上 | 完了 |
| T5 (R-2) | `enforcement/README.md` #31 + `audit.sh` `check_docs_review_evidence()` | 2026-07-11 | 同上 | 完了 |
| T6 (結線) | `RULES.md §システム仕様書` 参照追記 + 全体静的検証 | 2026-07-11 | 同上 | 完了 |

### 2.2 実装内容の詳細（独立再検証の結果）

#### T1: DOCS_NOISE_RULES.md（R-3）

- **変更ファイル**: `.agent-skill-chain/source/DOCS_NOISE_RULES.md`（新設）。
- **確認**: 禁止 4 パターン (i) 実装と矛盾 (ii) 陳腐化 (iii) 正本重複 (iv) 壊れやすい参照 が存在（`grep -cE "実装と矛盾|陳腐化|重複|壊れやすい参照"` = 8）。コード層 `CODE_COMMENT_RULES.md` との境界を冒頭に明記（`grep -c CODE_COMMENT_RULES` = 3）。evidence_source 分類（`human_decision`）の複製なし（= 0）。(iv) は DOCS_RULES §行番号直リンク禁止を包含参照し二重定義していない。document_id あり。

#### T2: DOCS_RULES.md（R-1・R-5 正本・R-3 参照）

- **変更ファイル**: `.agent-skill-chain/source/DOCS_RULES.md`（追記）。
- **確認**: §「Issue 完了時のシステム仕様書更新チェック（継続追随ゲート）」に as-built 同期（実装→仕様）・指摘 0 件までの反復・レビュー記録先・更新履歴相互リンク・軽量パス（更新不要判定 1 件）・docs/ 非採用の不発動が明記。§ノイズ排除は `DOCS_NOISE_RULES.md` へ参照 1 行。§greenfield 規約必須文書化はコーディング規約・ディレクトリ構成・アーキテクチャの `docs/` 文書化を必須化し、決定・ADR 記録は `EVIDENCE_POLICY.md §節5` を参照（再定義なし）。既存 §基本方針・§行番号直リンク禁止は非破壊（追記のみ）。

#### T3: テンプレート刷新（R-4）

- **変更ファイル**: 新設 `docs/01_システム概要/05_規約/README.md`・`.../00_索引と探し方/README.md`・`.../{10,20,30,40,50,60,90}_*/README.md`(7 件)・`docs/00_review/README.md`。追記 `docs/README.md`・`docs/01_システム概要/README.md`・`docs/99_ID命名規則と管理/README.md`。
- **確認**: (a) 05_規約/00_索引に「探したいこと→正本ファイル」表・grep ヒント・Diátaxis 位置づけが存在。10〜90 の 7 ファイルが存在。(b) 00_review/README に索引表（`| 日時 | 対象 | 指摘 N→0 | 対応 issue / 版番号 |`）。(c) README 更新履歴に「対応レビュー記録」列・相互リンク運用。(d) 99 に「全数採番」方針。system-graph 固有内容（`CMD_*`・`openapi.yaml`）の混入 0 件。全 README に document_id（テンプレート標準の all-zeros プレースホルダ、既存テンプレートと同一慣習）。

#### T4: verify-and-close 必須化 + 04_review テンプレート（R-5）

- **変更ファイル**: `.agent-skill-chain/source/commands/verify-and-close.md`・`.agent-skill-chain/runtime/templates/04_review.md`。
- **確認**: verify-and-close §実行時の注意の「システム仕様書（docs/）の更新: **必要に応じて**加筆修正」が「システム仕様書（docs/）の継続追随（必須ゲート）… DOCS_RULES §継続追随ゲート に従いレビュー反復を**必須**」へ置換され、docs 更新文脈の「必要に応じて」が 0 件に。04_review テンプレートの §11 冒頭も必須ゲート参照へ置換され「必要に応じて加筆修正」が 0 件に。固定キー `## docs 更新`・`- 要否:` は保持（#5/#31 互換）。skill chain（5 step）・DoD は不変。

#### T5: enforcement #31（R-2）

- **変更ファイル**: `.agent-skill-chain/source/enforcement/README.md`・`.agent-skill-chain/source/enforcement/ci/audit.sh`。
- **確認**: README に #31（システム仕様書レビュー証跡欠落）を 4 か所（必須チェック列挙・失敗条件表 #31・差し戻し先固定表・対応表 #31）へ追加。audit.sh に `check_docs_review_evidence()` を実装し末尾呼び出し列（`check_review_before_implement` の後）に登録。`bash -n` 構文 OK。SKIP ガード（sqlite3/DB 不在・docs/ 非採用・templates//close/ 配下・implement/verify ログ 0 件）実装済み。PreToolUse.sh/PostToolUse.sh・stdin JSON・exit code 規約は無変更（EXIT_CODE=1 の CI FAIL 方式のみ）。

#### T6: 結線と全体検証

- **変更ファイル**: `.agent-skill-chain/source/RULES.md`。
- **確認**: §システム仕様書に「継続追随ゲートは DOCS_RULES §継続追随ゲート、ノイズ排除は DOCS_NOISE_RULES を参照」の 1 行を追記（正本複製なし）。本リポで `audit.sh .` を実行し、本 issue 起因の FAIL は本 04_review 未作成の 1 件のみ（本 verify-and-close で解消）であることを確認。

---

## 3. テスト結果の確認

本 issue はドキュメント・規約・テンプレート・シェルスクリプト変更のため、テストは**静的検証（grep・存在確認・realpath リンク解決）**と **audit.sh #31 の tmp 隔離フィクスチャ実行**が中心（02_設計 §6・03 テスト計画に整合）。破壊的検証は本番非破壊で `mktemp -d` 上の隔離環境で実施した。

### 3.1 単体（静的検証）

#### 実行結果（数値で記載）

- **実行日**: 2026-07-11
- **検証項目数**: T1〜T6 の grep/存在検査 + #31 tmp 隔離 7 ケース + 全成果物リンク realpath
- **成功**: 全項目 OK
- **失敗**: 0
- **スキップ**: 0

| 検査 | 結果 |
| ---- | ---- |
| T1: 禁止 4 パターン=8・境界=3・分類複製=0 | OK |
| T2: R-1=1・R-3 参照=1・R-5=4・EVIDENCE_POLICY=1 | OK |
| T3: 05_規約 索引 3 表・10〜90=7 件・00_review 索引・README 対応レビュー記録列・99 全数採番・固有内容漏れ 0 | OK |
| T4: 継続追随/必須=6・DOCS_RULES 参照=1・04 の「必要に応じて加筆修正」=0・固定キー残存 | OK |
| T5: `bash -n audit.sh` OK・`check_docs_review_evidence` 出現=3（def/call/コメント） | OK |
| T6: RULES 結線=1 | OK |

### 3.2 統合テスト（audit.sh #31 の独立再現・tmp 隔離）

実装担当の自己申告を鵜呑みにせず、`audit.sh` から `check_docs_review_evidence()` を抽出し、`mktemp -d` 上のフィクスチャで FAIL/PASS/SKIP を独立再現した（本番ファイル非破壊）。

| ケース | 条件 | 期待 | 結果 |
| ------ | ---- | ---- | ---- |
| A | docs/ 採用・implement ログあり・04 の要否がプレースホルダ | FAIL | **FAIL31 一致** |
| B | 要否=要 + `docs/00_review/YYYYMMDD_HHMMSS` 参照あり | PASS | **NOFAIL31 一致** |
| C | 要否=不要 + 実質的な根拠あり | PASS | **NOFAIL31 一致** |
| D | docs/ 未採用 | SKIP | **NOFAIL31 一致** |
| E | implement/verify ログ 0 件（design のみ） | SKIP | **NOFAIL31 一致** |
| F | workflow.db 不在 | SKIP | **NOFAIL31 一致** |
| G | 04 が templates/ 配下 | SKIP | **NOFAIL31 一致** |

- **#5 との非交差（独立確認）**: #5 は `## docs 更新` と `- 要否:` の**存在**を検査（audit.sh L289）。#31 は要=`docs/00_review/` タイムスタンプ参照 / 不要=非プレースホルダ理由という**内容**を検査（L865-886）。ケース A は固定キーが両方存在するため #5 は PASS だが #31 は FAIL となり、両者が別物であることを実証。コードでも検査対象が交差しないことを確認した。

### 3.3 E2E テスト

- 実行コード（audit.sh の bash 検査 1 関数）以外は静的検証で代替（03 に整合）。本リポ自己適用（ドッグフーディング）で `audit.sh .` を実行し、本 issue 起因 FAIL が本 04_review 作成前は 1 件（04 未作成）、他 issue 由来・#31 由来の FAIL は 0 件であることを確認。

---

## 4. コードレビュー

### 4.1 コード品質

- **リント結果**: `bash -n audit.sh` エラー 0 / 警告 0。
- **フォーマット**: 問題なし（既存 #29 と同型のガード様式に準拠）。
- **型チェック**: 該当なし（bash）。

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | #31 関数のコメント・変数名が意図を表す | OK | 冒頭コメントで SKIP ガード・非交差を明記 |
| 保守性 | 正本 1 か所 + 参照 1 行の結線を徹底 | OK | DOCS_NOISE_RULES は葉ノード・循環なし |
| パフォーマンス | #31 は docs/ 採用・実装変更 issue のみ発動（規模比例） | OK | SKIP ガードで軽量 issue を重くしない |
| セキュリティ | PreToolUse 契約・exit code 規約不変 | OK | git diff で PreToolUse.sh/PostToolUse.sh 無変更を確認 |

### 4.2 指摘事項

#### 指摘 1: テンプレート docs のクロス参照リンクに既往の相対パス深度不整合（本 issue 範囲外・是正不要）

- **重要度**: 低
- **指摘内容**: `.agent-skill-chain/runtime/templates/docs/` 配下の複数 README で `.agent-skill-chain/source/` へ向かう相対リンクの `../` 深度が不揃い。in-repo realpath 解決で以下が未解決（BROKEN）:
  - `02_画面設計/README.md:7`（`../../../../` → `.agent-skill-chain/.agent-skill-chain/source/…`）※**本 issue 未変更・pre-existing**
  - `03_データ設計/README.md:7`（同上）※**本 issue 未変更・pre-existing**
  - `docs/README.md:7`（`../../` → `.agent-skill-chain/runtime/.agent-skill-chain/source/…`）※pre-existing 行（本 issue 追記行 51 は `../../../../` で in-repo 解決 OK）
  - `01_システム概要/README.md:6`（`../../../../`）※本 issue の diff に当該リンク変更なし＝pre-existing
- **独立確認**: 上記 4 件はいずれも本 issue の git 変更対象行ではない（`git status`/`git diff` で確認）。本 issue が新設・追記した 05_規約/00_review/99/README:51 のリンクは in-repo で realpath 解決 OK。すなわち **既往の pre-existing バグ**であり、実装担当の申告どおり実在する。
- **対応状況**: 未対応（**本 issue 範囲外・是正不要**）。テンプレートは配備コンテキスト（消費者 `docs/` はリポジトリ直下）と in-repo 配置（`.agent-skill-chain/runtime/templates/docs/`）で正しい深度が異なるという構造的曖昧さがあり、深度統一・配備時補正の是正は別 issue として扱うのが適切。**本 verify-and-close では見て見ぬふりをせず既知の問題として記録**する。
- **対応方法（提案・メインの承認を経て別 issue 化）**: テンプレート docs の `.agent-skill-chain/source/` 参照を配備先（消費者 `docs/` 直下）基準の深度に統一するか、build/setup 時にリンク補正する仕組みを設ける。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（旧パス補正済み・SC-1〜8 正本） | verify 担当 | 2026-07-11 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（AC・BDD 正本） | verify 担当 | 2026-07-11 |
| [`02_設計.md`](./02_設計.md) | 更新済み（ADR-1〜5・責務表） | verify 担当 | 2026-07-11 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（T1〜6・BDD） | verify 担当 | 2026-07-11 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（02 責務表の変更種別と実際の git 変更が一致。無変更指定の CODE_COMMENT_RULES.md・CONCEPTS.md は diff 0 行、PreToolUse.sh/PostToolUse.sh は diff なし）。
- **要件と実装の整合性**: 整合している（SC-1〜8・AC 全項目に実装が対応。§下記マッピング参照）。
- **コメント**: EVIDENCE_POLICY.md は隣接 issue「フィジビリティADR必須化」が新設した未追跡ファイルであり、本 issue は参照のみ（本 issue 由来の変更ではない）。

---

## docs 更新

（監査で必須。システム仕様書（docs/）の更新要否を [`.agent-skill-chain/source/DOCS_RULES.md`](../../../../../../../.agent-skill-chain/source/DOCS_RULES.md) §継続追随ゲートに従い判定する。）

- 要否: 不要
- 対象: なし
- 理由: 本 issue の変更対象は配布パッケージの規約・ポリシー・テンプレート・enforcement（`.agent-skill-chain/source/` 配下および `.agent-skill-chain/runtime/templates/`）であり、本リポジトリの `docs/` 配下のシステム仕様書（`docs/AI_CI_CD_VISION.md`）の記載範囲に影響しない。`docs/maintainer/workflow/` は issue 開発記録であり継続追随ゲートの対象ではない。本リポは消費者向けの `docs/01_システム概要/…` 形式のシステム仕様書を保持しておらず（`docs/` 直下は `AI_CI_CD_VISION.md` と `maintainer/` のみ、`docs/00_review/` は不在）、as-built 同期の対象となる仕様記述が存在しないため更新不要と判定した（軽量パス）。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: spec/01 設計原則の「単一責務・明確な境界・AI フレンドリー設計・KISS/YAGNI・規模比例」に準拠。正本 1 か所 + 参照 1 行を徹底。
- **ディレクトリ構成**: spec/02 に沿い、既存テンプレート章立てを壊さない加算的拡張（ADR-5）。
- **命名規則**: `05_規約/{10..90}_*` の連番・`00_索引と探し方` は system-graph 参考の汎用命名。document_id 規約は既存テンプレートと同一。

### 9.2 境界・依存の確認

- **責務の境界**: R-3 正本（DOCS_NOISE_RULES.md）はコード層 CODE_COMMENT_RULES.md と対称の独立正本。R-1/R-5 は DOCS_RULES.md、R-2 判定ルールは enforcement/README.md。決定・ADR 記録は EVIDENCE_POLICY.md §節5（隣接 issue 正本）へ委譲し再定義なし。
- **依存関係**: `DOCS_NOISE_RULES.md` は葉ノード（DOCS_RULES.md からのみ参照）。EVIDENCE_POLICY.md・CONCEPTS.md・CODE_COMMENT_RULES.md は本 issue 成果物を参照し返さず、循環なし。
- **指摘・推奨**: §4.2 指摘 1（pre-existing リンク深度）を別 issue 候補として提案（本 issue 範囲外）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| #31 の FAIL/PASS/SKIP が設計どおり動作 | test_output | tmp 隔離 7 ケースを独立実行し全ケース期待一致（§3.2） |
| #31 と既存 #5 が非交差 | existing_code | audit.sh L289（#5=存在）/ L865-886（#31=内容）を実コードで確認 + ケース A で実証 |
| PreToolUse 契約・無変更指定ファイルが不変 | existing_code | `git diff` で PreToolUse.sh/PostToolUse.sh 変更なし・CODE_COMMENT_RULES.md/CONCEPTS.md diff 0 行 |
| テンプレートに system-graph 固有内容の非混入 | test_output | `grep -rEc "CMD_[A-Z]|openapi\.yaml" 05_規約/` = 0 |
| 相対パス深度バグは pre-existing・本 issue 範囲外 | existing_code | 該当 4 リンクは本 issue の git 変更対象行でないことを確認（§4.2） |
| SC-1〜8・AC 全項目の充足 | test_output / existing_code | §下記マッピングの grep/存在検査（本 04 §3.1） |

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題 1**: テンプレート docs のクロス参照リンクの相対パス深度不整合（§4.2 指摘 1）。
  - **影響範囲**: テンプレート配備後の消費者 docs のリンク到達性（一部リンクが解決しない可能性）。
  - **対応方法**: 別 issue で深度統一 or build/setup 時のリンク補正（メイン承認後に起票）。

### 10.2 改善提案

- **改善 1**: #31 の tmp 隔離 FAIL/PASS/SKIP を `test/` 配下の恒久テスト（例 `test/test-audit.sh` への #31 ケース追加）として固定化すると回帰保護が強化される。
  - **効果**: 本 04 では手動 tmp 隔離で検証したが、CI 恒久テスト化で将来のリグレッションを自動検知できる（現状 `test/` に #31 専用テストは未追加）。

---

## 受け入れ基準・SC/AC マッピング（map-coverage）

| SC | 内容 | 対応 AC | 検証 | 結果 |
| -- | ---- | ------- | ---- | ---- |
| SC-1 | R-1 規約必須文書化が正本に明記・grep 可 | AC-2a | DOCS_RULES.md §greenfield（L48） | OK |
| SC-2 | 05_規約 標準構造（正本置き場+索引） | AC-2b | 05_規約/00_索引と探し方 存在・内容 | OK |
| SC-3 | 機械検証（#31）が enforcement に接続・FAIL 定義 | AC-5a | tmp 隔離ケース A FAIL | OK |
| SC-4 | ノイズ排除 1 正本 + 参照接続（重複なし） | AC-3a/3b | DOCS_NOISE_RULES + DOCS_RULES §ノイズ排除参照 | OK |
| SC-5 | テンプレ 4 要素 | AC-4a | (a)索引 (b)00_review 索引 (c)README 列 (d)全数採番 | OK |
| SC-6 | 任意表現→必須ゲート表現に置換 | AC-1a/1d | verify-and-close/04 の「必要に応じて」除去 | OK |
| SC-7 | ADR/evidence_source 再定義なし（参照のみ） | AC-2c/3c | DOCS_NOISE dup=0・EVIDENCE_POLICY 参照 | OK |
| SC-8 | 規模比例・軽量パス | AC-1c/4b/5c | DOCS_RULES 軽量パス + audit SKIP（ケース D/E/F/G） | OK |

- **AC 個別**: AC-1a〜1d（継続追随ゲート・記録先・軽量パス・04 §11 記載）、AC-2a〜2c（R-1・書き先・境界）、AC-3a〜3c（ノイズ 4 パターン・(iv) 包含参照・コード層境界）、AC-4a〜4d（4 要素・骨格/拡張区別・非破壊・非移植）、AC-5a〜5d（#31 FAIL・4 層整合・誤発動防止・意味的検証は対象外）はいずれも本 04 §2〜§3・§9 の検証で充足を確認。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（設計 ADR-1〜5 どおりの加算的実装。無変更制約・非交差・非移植を独立確認）。
- **テスト品質**: 良好（静的検証全 OK・#31 の FAIL/PASS/SKIP を tmp 隔離で独立再現）。ただし #31 の恒久テスト未追加（§10.2 改善提案）。
- **ドキュメント品質**: 良好（00〜03 と実装が整合・正本一元・循環なし）。
- **総合評価**: **クローズ可**。本 issue 起因の audit FAIL は本 04_review 未作成の 1 件のみで、本ファイル作成により解消。#31 由来・他 issue 由来の FAIL は 0 件。指摘 1（相対パス深度）は pre-existing・本 issue 範囲外で是正不要（既知の問題として記録済み）。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close 担当サブエージェント
- **承認日**: 2026-07-11
- **承認コメント**: SC-1〜8・AC 全項目の充足を独立再検証で確認。DoD（04_review 作成 + write-workflow-log）を満たせばクローズ相当。

---

## レビュー観点の両リスト（REVIEW_DUAL_LENS）

### 敵対的観点（この実装が壊れ・すり抜ける経路を能動的に探す）

- #31 が既存 #5 と交差して二重 FAIL/誤 FAIL を招かないか → ケース A（固定キーあり・内容プレースホルダ）で #5 PASS・#31 FAIL を実証し、検査対象が交差しないことを確認。
- #31 が docs/ 非採用・軽量 issue で誤発動しないか → ケース D/E/F/G の SKIP を独立再現。
- テンプレート刷新で system-graph 固有内容（`CMD_*`・`openapi.yaml`）が混入していないか → grep 0 件で確認。
- 無変更を宣言したファイル（PreToolUse.sh/PostToolUse.sh/CODE_COMMENT_RULES.md/CONCEPTS.md）が実際に変わっていないか → git diff で確認。
- 04_review テンプレートの「必要に応じて」除去が §docs 更新・§11 の両方で成立しているか → 該当 0 件を確認。
- クロス参照リンクの深度不整合を看過していないか → realpath 全数解決で 4 件の pre-existing BROKEN を検出し記録（本 issue 範囲外）。

### must-preserve（不変条件・壊してはならないもの）

- verify-and-close の skill chain（5 step）の順序・DoD を変更しない。
- 04_review 固定キー `## docs 更新`・`- 要否:` を保持（#5/#31 互換）。
- PreToolUse hook の stdin JSON 契約・exit code 規約（違反=2/許可=0）・fail-open 方針を変更・緩和しない。
- 既存 audit 失敗条件 #5/#29 の挙動を変えない（#31 は追加のみ・非交差）。
- 既存テンプレート章立て（01〜05・99・00_review・README 更新履歴表）と既存列を削除・改名しない。
- ADR/evidence_source の分類を成果物内に再定義しない（EVIDENCE_POLICY.md・CONCEPTS.md が正本）。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- [.agent-skill-chain/source/DOCS_RULES.md](../../../../../../../.agent-skill-chain/source/DOCS_RULES.md) / [.agent-skill-chain/source/DOCS_NOISE_RULES.md](../../../../../../../.agent-skill-chain/source/DOCS_NOISE_RULES.md)
- [.agent-skill-chain/source/enforcement/README.md](../../../../../../../.agent-skill-chain/source/enforcement/README.md) / [.agent-skill-chain/source/enforcement/ci/audit.sh](../../../../../../../.agent-skill-chain/source/enforcement/ci/audit.sh)
- [.agent-skill-chain/source/REVIEW_RULE.md](../../../../../../../.agent-skill-chain/source/REVIEW_RULE.md) / [.agent-skill-chain/source/workflow/PHASES.md](../../../../../../../.agent-skill-chain/source/workflow/PHASES.md)

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 本サブ issue はレビューフェーズ完了。親 issue（agentsOS 汎用化・ポリシー統合）配下のサブ issue であり、親が未完了のため close ディレクトリへの移動は行わない（CORE §完了 issue の close 分離・PHASES §完了 issue の close 移動）。
