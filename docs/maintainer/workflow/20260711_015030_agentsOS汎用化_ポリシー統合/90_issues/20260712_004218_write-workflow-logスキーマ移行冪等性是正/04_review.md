---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "d383e90c-5c79-457d-86f7-85e20c735b19"
---

# レビュー書: write-workflow-log.sh スキーマ移行 ADD COLUMN の冪等性是正

**プロジェクト名**: write-workflow-log.sh スキーマ移行 ADD COLUMN の冪等性是正（親 issue: agentsOS 汎用化・ポリシー統合 のサブ issue 8）
**作成日**: 2026 年 07 月 12 日
**最終更新**: 2026 年 07 月 12 日

> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。
> **参照**: [`.agent-skill-chain/source/REVIEW_RULE.md`](../../../../../../.agent-skill-chain/source/REVIEW_RULE.md)。本レビューは command `verify-and-close`（skill chain: generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）として実施。レビュー深度 = **standard**（単一スクリプトへの局所改修＋新規テスト 1 本）。

---

## 1. レビュー概要

### 1.1 レビュー目的

実装内容の確認・品質保証・クローズ前最終チェック。`ensure_column` ヘルパー導入によるスキーマ移行 ADD COLUMN 冪等化が 00/01 の受け入れ基準・02 の ADR-1/ADR-2 どおりに実装され、真のエラー時の fail-fast が維持されているかを、fresh reviewer（実装・過去レビューと別インスタンス）が独立検証する。

### 1.2 レビュー対象

- **実装範囲**:
  - `.agent-skill-chain/source/scripts/write-workflow-log.sh` — `ensure_column` ヘルパー新設（285〜304 行）＋スキーマ移行検知ブロックの 4 行委譲への置換（322〜326 行）＋ `document_path` 特殊フォールバックの廃止。
  - `test/test-write-workflow-log-schema-idempotent.sh` — 新規テスト（T-1〜T-6・25 assert）。
  - `test/run-all.sh` — 新規テストの runner 登録（表コメント＋実行エントリ）。
- **レビュー期間**: 2026-07-12 ～ 2026-07-12
- **レビュー担当者**: fresh reviewer（サブエージェント・opus・reasoning high）

---

## 2. 実装内容の確認（review-code の入力）

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| ------------ | ----------------- | -------- | ---------- | ---- |
| タスク 1: `ensure_column` 追加 | try-then-recheck で指定カラム＋インデックスを冪等に存在保証する 1 責務ヘルパーを `insert_with_retries` 直後に追加 | 2026-07-12 | 実装担当 | 完了 |
| タスク 2: 移行ブロック置換 | 同型 4 ブロック（`document_path` 不整合フォールバック含む）を `ensure_column ... \|\| exit 1` の 4 行へ置換 | 2026-07-12 | 実装担当 | 完了 |
| タスク 3: 新規テスト追加 | `test-write-workflow-log-schema-idempotent.sh`（T-1〜T-6）追加・`run-all.sh` 登録 | 2026-07-12 | 実装担当 | 完了 |
| タスク 4: 無回帰・スキーマ不変検証 | 既存 4 テスト全通過・移行後 4 カラム＋インデックス不変を T-5 で確認 | 2026-07-12 | 実装担当 | 完了 |

### 2.2 実装内容の詳細

#### タスク 1・2: `ensure_column` と委譲置換

- **変更ファイル**: `.agent-skill-chain/source/scripts/write-workflow-log.sh`
- **実装方法（`git diff HEAD` で確認）**:
  - `ensure_column db col`（285〜304 行）: (1) `PRAGMA table_info` でカラム取得→既存なら `return 0`（fast-path skip）。(2) `ALTER TABLE ... ADD COLUMN col TEXT NULL; CREATE INDEX IF NOT EXISTS idx_workflow_log_<col> ...` を `if ...; then return 0; fi` で試行。(3) 失敗時は `PRAGMA table_info` を**再取得**し、対象カラムが存在すれば `CREATE INDEX IF NOT EXISTS ... || true` で index を補完して `return 0`（競合吸収）。再確認でも不在なら `echo "ERROR: <col> マイグレーションに失敗しました。" >&2; return 1`（真のエラー）。
  - 呼び出し側（322〜326 行）: `HAS_NEW_SCHEMA` 分岐内で 4 カラムを `ensure_column "$WF_DB" <col> || exit 1` の 4 行に整理。旧 `CURRENT_COLS` 取得は関数内へ内包され削除済み。
  - HEAD 版にあった `document_path` の「index 付き ALTER 失敗→index 無し ALTER 再試行」フォールバック（それ自体が既存カラム時に `duplicate column name` で `exit 1` する不完全な握り込みだった）は**廃止**され、4 カラムが同一経路に統一された。
- **確認事項**: CHECK 制約再作成ブロック（328 行以降）・`insert_with_retries`・位置引数/環境変数 IF・`ledger/schema.sql`・`CONTRACT.md`・`audit.sh` は `git diff` 上**無変更**（スコープ厳守を確認）。

---

## 3. テスト結果の確認（generate-scenarios / map-coverage）

### 3.1 単体テスト（本レビューで再実行・独立検証）

#### テスト実行結果

- **実行日**: 2026-07-12（本レビューにて再実行。実装担当の報告を鵜呑みにせず全件再実行）
- **環境**: sqlite3 3.45.1、bash、非 root
- **新規テスト** `test/test-write-workflow-log-schema-idempotent.sh`: **PASS=25 / FAIL=0**（exit 0）
- **既存回帰テスト**（4 本すべて再実行・全通過）:

| テストファイル | 結果 | assert 件数 |
| -------------- | ---- | ----------- |
| test-write-workflow-log-multidoc.sh | PASS | 15 / 15 |
| test-write-workflow-log-prevhash.sh | PASS | 16 / 16 |
| test-write-workflow-log-glob.sh | PASS | 3 / 3 |
| test-write-workflow-log-ts-utc.sh | PASS | 44 / 44 |

- **合計**: 新規 25 ＋ 既存 78 = **103 assert すべて PASS・FAIL 0**。全テストは `mktemp -d` 隔離で、T-6（本番 DB 非破壊）は before/after 行数=343・mtime 不変を確認済み（本リポの workflow.db を非破壊）。

#### 失敗したテスト

- 本 issue スコープ内テストの失敗は **0 件**。
- **スコープ外の既知失敗**: `test/run-all.sh` フル実行（合計 17・PASS 16・FAIL 1）で **`test-audit` のみ FAIL**（2 assert: 「必須ファイル欠落でも exit 0」「必須ファイル未参照メッセージが無い」＝ audit.sh の contract-and-evidence チェックに関する既存不具合）。**本レビューで独立検証**: 当該 source 変更（write-workflow-log.sh・run-all.sh）を `git stash` して HEAD 相当に戻した状態でも `test-audit` は**同一の 2 assert が FAIL（PASS=26 FAIL=2）**し、完全に再現した。したがって本 issue の変更とは無関係な既存不具合であり、本 issue のスコープ外（実装担当の主張は正確と確認）。

### 3.2 シナリオ網羅（generate-scenarios）と 01 BDD → テスト対応（map-coverage）

| 01 の BDD / 受け入れ基準 | 実装/テストでの担保 | 再実行結果 | 判定 |
| ------------------------ | ------------------- | ---------- | ---- |
| UC1 S1: 競合状態での ADD COLUMN（recovery 分岐） | T-3（並列 12 × 5 ラウンド・flock no-op シム＋sqlite3 `.timeout` シムで競合窓を開く）＋コードレビュー（recovery ロジック） | 全 exit 0・duplicate 0 件・各ラウンド 12 件記録 | OK |
| UC1 S2: 反復実行での競合再現 | T-3（N 並列 × M ラウンド） | 5 ラウンド全て 12 件一致 | OK |
| （補助）既存カラム skip の idempotent 契約 | T-1（fast-path skip・単一プロセスで決定的） | exit 0・review_id 1 カラムのみ | OK |
| UC2 S1: 真のエラーで fail-fast | T-4（書込不可 DB で exit≠0・行数不変）＋コードレビュー（ERROR メッセージ分岐） | fail-fast・行数不変 | OK |
| UC2 S2: 正常系初回移行 | T-2（不足 1 カラム通常追加）／ T-5（4 カラム初回移行） | exit 0・カラム＋index 各 1 | OK |
| ストーリー3: 移行後スキーマ不変（4 カラム＋index） | T-5（`table_info`/`index_list` 検査） | 4 カラム＋4 index 存在 | OK |
| ストーリー3: 既存テスト無回帰 | 既存 4 テスト | 全 PASS（上表 3.1） | OK |
| 成功基準 5（真のエラー fail-fast） | T-4 ＋ コードレビュー（下記 §4） | fail-fast 確認・分岐妥当性確認 | OK |

**欠落**: 01 の全 BDD シナリオ・00 の全成功基準（1〜5）がテストまたはテスト＋コードレビューに写像されており、**未対応シナリオは無い**。recovery 分岐（UC1 S1 の核心）と真のエラー ERROR メッセージ分岐（UC2 S1）は、設計 02 §6.2・03 §2.1.3 のとおり「単一プロセスで到達不能／読み取り専用 DB は移行手前の `PRAGMA journal_mode=WAL` で先に停止（実測 exit 8）」という制約のため、T-3/T-4 の実行時再現に加えコードレビューで二重担保する方式が 00 §6 成功基準 5 で明示的に許容されており、その方針どおり実装・テストに反映されている（後述 §4.2）。

### 3.3 BDD フォーマット（監査観点）

- 新規テストはファイル冒頭に `ユースケース:`、各ケースに `# シナリオ:`・`# Given:`・`# When:`・`# Then:` のインラインコメントを備え、[TEST_BDD_FORMAT.md](../../../../../../.agent-skill-chain/source/TEST_BDD_FORMAT.md) に準拠（確認済み）。

---

## 4. コードレビュー（review-code）

### 4.1 コード品質

| 観点 | 確認内容 | 結果 | コメント |
| -------------- | ---------------------- | ---- | -------- |
| 可読性 | 4 行の宣言的委譲に整理され意図が明快。関数コメントに冪等化方針を明記 | OK | AI フレンドリー設計（02 §1.2）に整合 |
| 保守性 | 既存 `insert_with_retries` と同一の記述スタイル（`local`・小文字スネーク・`sqlite3 -separator $'\t' \| awk`）を踏襲。同型 4 ブロックを 1 関数へ共通化し重複排除 | OK | 00 §3.4・ADR-2 に整合 |
| パフォーマンス | 正常系（既存カラム）は `PRAGMA table_info` 1 回で return 0（ALTER 試行なし）。追加コストは競合時の再取得 1 回のみ。無限リトライなし | OK | 数百 ms 超の体感影響なし（00 §3.1） |
| セキュリティ | SQL 組み立て・`AGENT_ROLE=scribe` ガードは無変更。カラム名は呼び出し側リテラル固定 4 値のみで外部入力に由来しない | OK | 新規インジェクション面なし（02 §8.2） |

- **リント/フォーマット**: `bash -n`（構文チェック）相当は実行時に問題なく通過（全テストがスクリプトを実起動して PASS）。`set -euo pipefail` 下でも ALTER 試行・grep 判定を `if ...; then` 条件文に置き、`|| true` で index 補完を保護しているため意図せぬ即 exit は起きない設計（02 §3.1.4）。

### 4.2 指摘事項

#### ADR-1（try-then-recheck）準拠の確認 — 指摘なし

- **確認内容**: `ensure_column` は ALTER 失敗を stderr の文字列（`grep duplicate` 等）で判定せず、`PRAGMA table_info` の**再取得（状態ベース）**で「カラムが存在すれば競合吸収＝成功」と判定している（293〜301 行）。これは ADR-1 が採用した選択肢 2（メッセージ非依存）そのもので、sqlite3 バージョン・ロケール差によるメッセージ文言変化への回帰耐性を持つ。**設計どおり・指摘なし**。

#### ADR-2（共通化）準拠の確認 — 指摘なし

- **確認内容**: 4 カラムが単一の `ensure_column` を通り、HEAD 版の `document_path` 特殊フォールバック（既存カラム時に `duplicate column name` で `exit 1` する不完全な握り込み）は廃止された（`git diff` で確認）。同型ロジックの重複と齟齬が解消されている。**設計どおり・指摘なし**。

#### 真のエラー時の fail-fast 維持 — 指摘なし

- **確認内容**: recheck でも対象カラムが不在の場合のみ `ERROR: <col> マイグレーションに失敗しました。` を stderr 出力して `return 1`、呼び出し側 `ensure_column ... || exit 1` で従来同様に fail-fast する（302〜303・323〜326 行）。冪等化は「対象カラムが既に存在する場合の失敗」のみを吸収し、それ以外の失敗要因を一律には握り潰さない。成功基準 5・01 ストーリー 2 の受け入れ基準を満たす。**指摘なし**。
- **設計制約の反映確認**: review-docs で指摘された「recovery 分岐は単一プロセスでは到達不能・並列＋flock 無効化で再現／真のエラー ERROR メッセージ分岐は読み取り専用 DB では WAL 段で先に停止するためコードレビューで担保」という制約が、テスト（T-3 は flock no-op シムで競合窓を開く、T-4 は exit≠0・行数不変のみを検証）とドキュメント（03 §2.1.3・§2.3.2 の注記）に正しく反映されている。T-4 は本レビューでも実際に fail-fast（exit≠0）することを再実行で確認。**指摘なし**。

**総括: コードレビューでの是正必須の指摘は 0 件。**

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------------------------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（document_id・issue_id あり） | fresh reviewer | 2026-07-12 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（document_id あり） | fresh reviewer | 2026-07-12 |
| [`02_設計.md`](./02_設計.md) | 更新済み（document_id あり・ADR-1/2） | fresh reviewer | 2026-07-12 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（document_id あり・T-1〜T-6） | fresh reviewer | 2026-07-12 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（`ensure_column` の 3 段階フローが 02 §3.1.2 のフロー図と一致。委譲 4 行が 02 §3.2 と一致）。
- **要件と実装の整合性**: 整合している（01 の全 BDD が §3.2 のとおりテスト＋コードレビューへ写像）。
- **document_id フォーマット**: 00/01/02/03 いずれも frontmatter に UUID（8-4-4-4-12）を保持。本 04 も新規 UUID `d383e90c-...` を付与（既存 document_id の後付け変更はなし）。

---

## docs 更新

- **要否**: **不要**
- **対象**: なし
- **理由**: 本改修は `write-workflow-log.sh` のスキーマ移行処理の堅牢化（内部ロジック）に限定され、移行後の最終スキーマ状態（4 カラム＋インデックス）・位置引数/環境変数インターフェース・書記契約（`CONTRACT.md`）・スキーマ正本（`ledger/schema.sql`）を一切変更しない（`git diff` で当該ファイル無変更を確認）。したがってシステム仕様書（`docs/`）に記載される外部から観測可能な振る舞い・契約に影響しないため、DOCS_RULES §継続追随ゲートは軽量パス（更新不要判定 1 件）で足りる。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: UNIX 哲学（bash＋sqlite3 CLI に閉じ新規外部依存なし）・単一責務（`ensure_column` は「指定カラムの冪等存在保証」1 責務）・AI フレンドリー設計（4 行の宣言的委譲）に準拠。[spec/01 設計原則](../../../../../../.agent-skill-chain/source/spec/01_設計原則.md) に沿う。
- **ディレクトリ構成**: 改修対象は配布物正本 `.agent-skill-chain/source/scripts/`、テストは非配布の `test/` に配置。[自己拡張ワークフロー §名前空間](../../../../../../.agent-skill-chain/project/自己拡張ワークフロー.md) の役割分担に整合。
- **命名規則**: 関数名 `ensure_column`・変数 `local db/col/idx/cols`（小文字スネーク）は既存関数群と一貫。インデックス名 `idx_workflow_log_<col>` は既存規則どおり導出。

### 9.2 境界・依存の確認

- **責務の境界**: `ensure_column` は `insert_with_retries`/`escape_sql`/`gen_entry_id` を呼ばず循環参照なし。移行オーケストレーション（どのカラムを保証するか・失敗時 `exit 1`）は呼び出し側、カラム型/インデックス命名の詳細は関数側に隠蔽。02 §2.1 の境界定義どおり。
- **依存関係**: スコープ厳守を `git diff HEAD` で実証。`ledger/schema.sql`・`scribe/CONTRACT.md`・`enforcement/ci/audit.sh`・CHECK 制約再作成ブロック（328 行以降）・`insert_with_retries` 本体・位置引数/環境変数 IF はいずれも無変更。
- **指摘・推奨**:
  - （情報・非ブロッキング）スキーマ正本 `ledger/schema.sql:56` の `idx_workflow_log_document_path` は**部分インデックス**（`WHERE document_path IS NOT NULL`）だが、移行経路（`ensure_column`）が作成するのは `WHERE` 句なしの**全体インデックス**。この差異は **HEAD 版の移行コードに既存**であり本改修が新たに導入したものではない（02 §4.1 注で明示的にスコープ外と宣言済み）。本改修の「移行後スキーマ不変」は「改修前後で同一」を意味し、成功基準 3・T-5 の `index_list` 検査はインデックス**名**の一致のみを見るため妥当。schema.sql との定義統一が必要なら別 issue とする（本 issue のクローズを妨げない）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考（参照元） |
| -------- | --------------- | -------------- |
| 全テスト（新規 25＋既存 78）が PASS・FAIL 0 | test_output | 本レビューでの再実行（§3.1・本セッションのツール出力） |
| `test-audit` FAIL は本 issue と無関係な既存不具合 | observed_runtime | source 変更を `git stash` した HEAD 相当で同一 2 assert が再現（§3.1） |
| 実装が ADR-1（try-then-recheck）・ADR-2（共通化）どおり／fail-fast 維持 | existing_code | `git diff HEAD -- write-workflow-log.sh`・285〜326 行の読取（§2.2・§4.2） |
| スコープ厳守（schema.sql/CONTRACT/audit.sh 等無変更） | existing_code | `git diff HEAD` の変更ファイル一覧（§9.2） |
| 移行後スキーマ 4 カラム＋インデックス不変 | test_output | T-5 の `table_info`/`index_list` 検査 PASS（§3.2） |

- inference_only のみに依存する重要判断は無い（すべて test_output / observed_runtime / existing_code の外部根拠を伴う）。

---

## 10. 課題と改善点

### 10.1 発見された課題

- 本 issue スコープ内の是正必須課題: **なし**。
- スコープ外の既知課題（本 issue のクローズを妨げない）:
  - **`test-audit` の 2 assert FAIL**: audit.sh の contract-and-evidence（必須ファイル欠落/未参照）チェックに関する既存不具合。HEAD 相当でも再現（§3.1）。本 issue とは独立で、別途対応の判断は進行役に委ねる。
  - **schema.sql の部分インデックス vs 移行の全体インデックスの定義差**（§9.2）。既存差異・スコープ外。

### 10.2 改善提案

- （任意・別件）schema.sql と移行経路のインデックス定義（部分/全体）の統一。効果: スキーマ正本と移行結果の完全一致。本 issue の対象外。

---

## 11. システム仕様書の更新

### 11.1 システム仕様書の確認結果

- **実装した機能**: スキーマ移行 ADD COLUMN の冪等化（内部ヘルパー `ensure_column`）。外部から観測可能な機能・画面・API・データ構造の追加は**なし**（移行後スキーマ・IF・契約は不変）。
- **システム仕様書との整合性**: 変更が仕様に影響しないため更新不要（§docs 更新の判定と同一）。

### 11.2 システム仕様書の更新状況

- 更新が不要: 本改修は移行処理の堅牢化に閉じ、`docs/` に記載される契約・振る舞いに影響しないため。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好。設計（ADR-1/ADR-2）に忠実で、スコープを厳守し、既存の設計方針（競合は握り込みで吸収）と一貫。
- **テスト品質**: 良好。00 の全成功基準・01 の全 BDD をテスト（＋許容された範囲のコードレビュー二重担保）へ写像。tmp 隔離・本番 DB 非破壊を自己検証。新規 25＋既存 78 = 103 assert 全通過。
- **ドキュメント品質**: 良好。00〜03 が整合し document_id 完備。
- **総合評価**: **合格（クローズ可）**。本 issue スコープ内の是正必須指摘は 0 件。

### 12.2 承認状況

- **レビュー承認者**: fresh reviewer（サブエージェント）
- **承認日**: 2026-07-12
- **承認コメント**: verify-and-close の DoD を満たす。テスト全再実行で FAIL 0（スコープ外の `test-audit` 既存 FAIL は HEAD 相当で再現し無関係と確認）。実装は ADR-1/ADR-2 準拠、真のエラー fail-fast 維持、スコープ厳守。**close 可**と判断する。最終的な close 実行（issue の close 移動・commit 等）は進行役の判断・Go 出しに委ねる。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義
- [`02_設計.md`](./02_設計.md) - 設計
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画

### 13.2 その他の参考資料

- [.agent-skill-chain/source/scripts/write-workflow-log.sh](../../../../../../.agent-skill-chain/source/scripts/write-workflow-log.sh) - 改修対象（`ensure_column` 285〜304 行・委譲 322〜326 行）
- [.agent-skill-chain/source/REVIEW_RULE.md](../../../../../../.agent-skill-chain/source/REVIEW_RULE.md) - レビュー観点
- [.agent-skill-chain/source/TEST_BDD_FORMAT.md](../../../../../../.agent-skill-chain/source/TEST_BDD_FORMAT.md) - BDD 記法
- `test/test-write-workflow-log-schema-idempotent.sh` - 新規テスト（T-1〜T-6・25 assert）
- 検出元: [`../20260711_055602_write-workflow-log_ts_utc検証/04_review.md`](../20260711_055602_write-workflow-log_ts_utc検証/04_review.md) §3.3・§4.2 指摘 2・§10.1 課題 1

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 本 issue は外部設定を要さないため、進行役の Go 出しにより issue/タスク完了（close）へ進める。本 issue は単一改修のため 90_issues への追加分割はしない（親 90_issues.md にサブ issue 8 として登録済みを確認）。
