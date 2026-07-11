---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "fa80cf14-bcff-4720-b2b9-b459eaca0dba"
---

# レビュー書: audit.sh #31（システム仕様書レビュー証跡欠落検知）の tmp 隔離検証を test/ 配下の恒久回帰テストへ固定化

**プロジェクト名**: audit.sh #31 tmp 隔離検証の恒久テスト化
**作成日**: 2026 年 07 月 12 日
**最終更新**: 2026 年 07 月 12 日

> **重要**: **このドキュメントは常に更新**: レビューで発見した問題点や改善提案、対応内容などがあった場合は、即座にこのドキュメントを更新してください。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容（`test/test-audit.sh` への `#31` セクション追加）が 00〜03 の要求・要件・設計・実装計画に整合し、`audit.sh` の実際の判定分岐と一致しているかを独立検証し、close 可否を判定する。

### 1.2 レビュー対象（必須）

- **実装範囲**: `test/test-audit.sh` 末尾（行 473–604）への `== #31 システム仕様書レビュー証跡欠落検知 ==` セクション追加。7 ケース（A〜G）＋ #5 非交差の計 8 アサートを `mktemp -d` 隔離ツリー上で `audit.sh <隔離パス>` を黒箱実行し出力を grep 判定する。`audit.sh` 本体は無変更。
- **レビュー期間**: 2026-07-12 ～ 2026-07-12
- **レビュー担当者**: fresh reviewer（実装担当・過去レビュー担当と別インスタンス）／モデル opus・reasoning effort high
- **レビュー深度**: standard（変更は 1 ファイル・テスト追加のみ・本体ロジック無変更のため）
- **参照規約**: [REVIEW_RULE.md](../../../../../../.agent-skill-chain/source/REVIEW_RULE.md)、[PHASES.md 監査観点](../../../../../../.agent-skill-chain/source/workflow/PHASES.md)、[TEST_BDD_FORMAT.md](../../../../../../.agent-skill-chain/source/TEST_BDD_FORMAT.md)、[自己拡張ワークフロー.md §テストの tmp 隔離](../../../../../../.agent-skill-chain/project/自己拡張ワークフロー.md)

---

## 2. 実装内容の確認（review-code）

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| #31 セクション追加 | `test/test-audit.sh` に 8 アサート（A〜G＋#5非交差）を append | 2026-07-12 | 実装担当 | 完了 |

### 2.2 コードと `audit.sh` 実分岐の 1:1 裏取り（evidence_source: 一次情報＝コード実測）

`check_docs_review_evidence()`（`audit.sh:851-899`）・#5（`audit.sh:291-305`）・`resolve_workflow_dirs`（`audit.sh:101-131`）・`WF_DB`（`audit.sh:357`）・`make_min_tree`（`test-audit.sh:43-53`）を自分で精読し、各テストケースが実分岐と一致することを確認した。

| ケース | テスト実装（フィクスチャ） | 到達する audit.sh 実分岐 | 期待 | 一致 |
| ------ | -------------------------- | ------------------------ | ---- | ---- |
| A | docs/ 配下 issue＋workflow_log に implement-feature＋04 が `- 要否: （要 / 不要）` | 852/853/854/855 通過→860 非templates→869 hit有→877 `! grep -qF '要 / 不要'` が偽→ok=0→893 FAIL | FAIL 発火 | ✓ |
| #5 非交差 | A と同一ツリー | #5(296) は `## docs 更新`＋`- 要否:` の**有無**のみ→両行存在で PASS（`docs 更新要否未記載` 非出力） | #5 非発火 | ✓ |
| B | `- 要否: 要`＋`docs/00_review/20260101_000000_review.md` | 877 真→878 `不要` 非含（"要否: 要" に "不要" 部分文字列なし）→要ブランチ 886 が `docs/00_review/[0-9]{8}_[0-9]{6}` 一致→ok=1 | 非FAIL | ✓ |
| C | `- 要否: 不要`＋`- 理由: 変更が仕様に影響しないため` | 877 真→878 `不要` 含→不要ブランチ 880 reason 非空かつ非`（要の場合`→ok=1 | 非FAIL | ✓ |
| D | docs/ を作らず issue を `.agent-skill-chain/runtime/` 配下に配置 | 854 `[[ ! -d "$PROJECT_ROOT/docs" ]]`→return 0（SKIP） | 非FAIL | ✓ |
| E | docs/ 採用だが workflow_log に `design-feature` のみ | 869 hit 空→870 continue | 非FAIL | ✓ |
| F | workflow.db を作らない | 852 `[[ ! -f "$WF_DB" ]]`→return 0（SKIP） | 非FAIL | ✓ |
| G | docs/ ディレクトリ＋workflow_log テーブル付き workflow.db のみ、04 を `.agent-skill-chain/runtime/templates/` 配下に配置（templates 外に発火 04 なし・implement ログ不要） | find が templates/04 を発見→860 `*"/templates/"* && continue` | 非FAIL | ✓ |

### 2.3 review-docs 修正（ケース G）の反映確認

review-docs（memo `20260712_032249_review-docs.md`）サイクル1 で指摘された「ケース G の過剰プロビジョニング／誤発火トラップ（templates 外に implement ログ付き別 04 を置くと #31 が誤発火）」の修正が、実装に正しく反映されていることを確認した。

- 実装（`test-audit.sh:591-600`）は `G_TREE` に `docs/` ディレクトリ・`runtime/templates/04_review.md`・`workflow_log` テーブルのみを構築し、**implement ログ（INSERT）を作らず**、**templates 外に #31 発火可能な 04 を一切置いていない**。これは実コードの評価順序（templates continue 860 が hit 判定 869 より前）に照らし、templates ガードのみを純粋に isolate する正しい構成である。✓
- コメント（`test-audit.sh:585-590`）も「templates 外に #31 を発火させうる 04 は置かない・implement ログは不要」と 02 §3.1.3 表 G・03 §2.4.2 と整合して記述されている。✓

### 2.4 規約遵守

- **tmp 隔離**: 全ケースが `make_min_tree`（`mktemp -d`＋`TMP_DIRS` 登録）由来ツリーで完結し、`trap cleanup EXIT` で後片付け。本番 `.agent-skill-chain/source/`・`.claude/`・`.cursor/`・`.agent-skill-chain/runtime/`・`workflow.db` へ書き込まない（`自己拡張ワークフロー.md §テストの tmp 隔離` 準拠）。実測で `git status` 非破壊を確認（§5）。✓
- **BDD 記法**: 各シナリオに `# Given:`/`# When:`/`# Then:` を明記（`TEST_BDD_FORMAT.md` 準拠）。✓
- **sqlite3 ガード**: セクション全体を `if command -v sqlite3 ... else echo "  [SKIP] ..."` で囲み、不在時は集計を汚さない（ADR-2 準拠）。✓
- **単一責務**: `audit.sh` 本体は無変更（`git diff` は `test/test-audit.sh` のみ）。判定ロジックの改修は含まない（要求 §5・要件 §5 準拠）。✓

### 2.5 変更ファイル

- `test/test-audit.sh`（`#31` セクション追加。行 473–604。既存シナリオへの append のみ・既存行の改変なし）

---

## 3. 受け入れ基準の確認（generate-scenarios / map-coverage）

### 3.1 シナリオ整理と AC ↔ テスト ↔ 実分岐の対応

| 受け入れ基準（01 §2.1） | 対応テストアサート | 検証方法 | 結果 |
| ----------------------- | ------------------ | -------- | ---- |
| AC-1a（ケースA: プレースホルダで FAIL） | `#31-A 要否プレースホルダで FAIL` | `grep -q 'FAIL: システム仕様書レビュー証跡欠落'` | PASS |
| AC-1b（本番 git 非破壊） | §5 の git status 実測 | `git status --porcelain` 差分 0 | PASS |
| AC-2a（ケースB: 要=実TS参照で非FAIL） | `#31-B 要=実TS参照で非FAIL` | `! grep -q ...` | PASS |
| AC-2b（ケースC: 不要=実質理由で非FAIL） | `#31-C 不要=実質理由で非FAIL` | `! grep -q ...` | PASS |
| AC-3a（ケースD: docs/ 不在 SKIP） | `#31-D docs/ 不在 SKIP` | `! grep -q ...` | PASS |
| AC-3b（ケースE: impl/verify 0件 SKIP） | `#31-E implement/verify ログ 0件で SKIP` | `! grep -q ...` | PASS |
| AC-3c（ケースF: DB 不在 SKIP） | `#31-F DB 不在 SKIP` | `! grep -q ...` | PASS |
| AC-3d（ケースG: templates 配下 SKIP） | `#31-G templates 配下 SKIP` | `! grep -q ...` | PASS |
| AC-4a（#5 非交差: #5=PASS・#31=FAIL） | `#31/#5 非交差（同一フィクスチャで #5 は非発火）` | `! grep -q 'FAIL: docs 更新要否未記載'`（A と同一ツリー） | PASS |

### 3.2 成功基準（00 §6）の充足

- **SC-1**（#31 の A〜G 判定テストが存在し全ケース期待どおり）: ✓ 8 アサート全 PASS（§5）。
- **SC-2**（tmp 隔離・本番非破壊）: ✓ `git status` 差分 0 を実測（§5）。
- **SC-3**（#5 非交差ケースを含む）: ✓ `#31/#5 非交差` アサートが存在・PASS。
- **SC-4**（既存シナリオ回帰なし）: ✓ 既存 T1〜T4・#7・GIT_RANGE・#32 は変更前後で挙動不変（§5 の stash 比較）。

**カバレッジ欠落: なし**（AC-1a〜4a・SC-1〜4 が 8 アサートで 1:1 に充足。過不足なし）。

---

## 4. 設計・境界の確認（review-architecture）

- **ADR-1（既存 `test-audit.sh` へ追加・新規ファイル不作成）**: 実装は既存ファイル末尾に append。`test/run-all.sh` の変更不要という帰結どおり、`run-all.sh` に差分なし（§5 git status で `test-audit.sh` のみ変更）。境界維持 ✓。
- **ADR-2（sqlite3 不在時 SKIP）**: 実装のガード構造が既存 #32・シナリオ4 と同型。安全側（誤 FAIL 回避）を維持 ✓。
- **ADR-3（#5 非交差を A と同一ツリーで 2 アサート同時実証）**: 実装は A のツリー出力に対し `#31=FAIL`・`#5=非FAIL` を同一 `$A_OUT` で検査。別フィクスチャを新設せず「同一入力での分岐」を直接実証しており、設計意図どおり ✓。
- **責務境界**: テストは `audit.sh` を読み取り専用の外部プロセスとして実行するのみで、`check_docs_review_evidence()` の判定式を改変・抽出していない。SKIP ガードの前提（scan dirs 解決・docs/ 判定・WF_DB 解決）まで end-to-end で固定する黒箱設計が保たれている ✓。
- **循環参照・過剰抽象**: なし。既存ヘルパの再利用のみで新規抽象を導入していない ✓。

---

## 5. テスト再実行結果（監査による独立再実行）

実行環境に sqlite3 あり（`/usr/bin/sqlite3`）のため #31 の 8 ケースは実際に実行された。`bash -n test/test-audit.sh` 構文チェック OK。

### 5.1 変更後の実行結果

```
bash test/test-audit.sh → == 結果: PASS=34 FAIL=2 == / exit 1
```

- **#31 の 8 アサートは全て PASS**（`#31-A`／`#31/#5 非交差`／`#31-B`／`#31-C`／`#31-D`／`#31-E`／`#31-F`／`#31-G`）。
- FAIL=2 は `test-audit.sh` シナリオ3（必須ファイル欠落検知）の 2 件（`必須ファイル欠落でも exit 0 になった`／`必須ファイル未参照メッセージが無い`）。

### 5.2 FAIL=2 が本変更による回帰でないことの独立再検証（git stash 比較）

`git stash push -- test/test-audit.sh` で本変更を退避し、変更前バージョンで再実行して比較した。

| 状態 | 結果 | 該当 FAIL |
| ---- | ---- | --------- |
| 変更前（stash 退避） | PASS=26 FAIL=2 / exit 1 | `必須ファイル欠落…` 2 件（本変更後と同一） |
| 変更後 | PASS=34 FAIL=2 / exit 1 | 同上 2 件 |

- **差分は PASS が +8（＝#31 の 8 アサート）のみ・新規 FAIL は 0 件**。FAIL=2 は変更前から存在する既存の無関係な失敗であり、本変更による回帰ではないことを監査自身の stash 比較で確認した（実装担当の主張を独立に裏取り済み）。
- この 2 件は既にサブ issue #11「test-audit_AGENTS_ROOT未追随是正」（`90_issues.md` id `a876f925-3cd9-4f88-ac6f-eb8e6af2ca6b`）で別途追跡されている（根本原因: 呼び出し元の `AGENTS_ROOT` 環境変数汚染＋`audit.sh` 必須ファイルチェックの fail-open 設計）。本 issue（#31 テスト固定化）のスコープ外。

### 5.3 本番非破壊（tmp 隔離）の実測

- テスト実行前後の `git status --porcelain` に、意図した変更（`test/test-audit.sh` の M と当該 issue の 02/03/04 ドキュメント）以外の差分なし。本番 `.agent-skill-chain/source/`・`.claude/`・`.cursor/`・`.agent-skill-chain/runtime/`・`workflow.db` の変更なしを確認（SC-2 充足）。

---

## 6. PHASES 監査観点の充足

- **全シナリオのテストコード化の網羅**: 01 の BDD ユースケース1（シナリオ1〜4）・ユースケース2（#5 非交差）が 8 アサートに 1:1 で翻訳され、欠落なし（§3.1）。
- **フォーマットの正しさ**: BDD 記法（Given/When/Then）・`ok`/`ng` ヘルパ・ケースラベル（A〜G）が既存 `test-audit.sh` 記法と統一。テンプレート必須フォーマット（`## docs 更新` セクション等）を本 04 も充足。
- **サブ issue 分割なし**: 本 issue 配下に `90_issues/` は存在せず、サブ issue は作成していない（親 `90_issues.md` への追記要件は非該当）。

---

## docs 更新

- 要否: 不要
- 対象: なし
- 理由: 本変更は `test/`（保守者自己テスト・非配布）への回帰テスト追加のみで、`audit.sh` 本体・システム仕様書（`.agent-skill-chain/source/` の RULES.md/DOCS_RULES.md 等 docs/ 系仕様）に一切変更がない。DOCS_RULES §継続追随ゲートに照らし、システム仕様の記述と実装の乖離は生じないため docs 更新は不要（軽量パス・根拠付き判定 1 件）。

---

## 7. レビュー結果・結論

- **指摘**: 0 件（本 issue スコープ内）。実装は 00〜03 の要求・要件・設計・実装計画、および `audit.sh` の実分岐（852/854/860/869-870/877-896・#5 296）と完全に整合する。review-docs で指摘されたケース G の修正も正しく反映されている。
- **既知のスコープ外事項**: `test-audit.sh` シナリオ3 の FAIL=2（既存・別 issue #11 で追跡中・本変更による回帰ではないことを stash 比較で実証）。
- **evidence_source**: 一次情報＝コード実測（`audit.sh`・`test-audit.sh` 精読）＋テスト実測（変更前後の実行・git stash 比較・git status 非破壊確認）。inference_only のみに依存する重要判断はなし。
- **DoD（verify-and-close）**: 04_review.md 作成済み・テスト再実行結果記載済み・PHASES 監査観点充足・サブ issue 分割なし。書記記録（write-workflow-log）を本レビュー完了とセットで実施する。

### 7.1 close 可否

**close 可**。本 issue（#31 tmp 隔離検証の恒久テスト化）は要求・要件・設計・実装計画を満たし、スコープ内指摘 0 件。ただし本 issue はトップレベル issue「agentsOS汎用化_ポリシー統合」配下のサブ issue であり、close 移動（`docs/maintainer/workflow/close/` への移動）はトップレベル issue 完了時に一括で行う（`自己拡張ワークフロー.md §完了 issue の close 移動`）。サブ issue 単独では移動しない。

---

## 8. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ
