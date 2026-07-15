---
document_id: "0c9b9ffd-4584-4e58-ab8c-834d16b20075"
---

# レビュー書: S-1 audit.sh モード分岐（resolve_issue_tracking_mode 新設＋#33 の github_native SKIP ガード）

**プロジェクト名**: S-1 audit.sh モード分岐（親: issue 運用ポリシーの GitHub Issue 中心への全面移行）
**作成日**: 2026 年 07 月 15 日
**最終更新**: 2026 年 07 月 15 日

> **レビュー深度**: standard（変更は「純関数 1 つ＋#33 冒頭ガード 1 ブロック」の挿入のみ・既定 local_tracked で挙動不変）。
> **参照**: [REVIEW_RULE.md](../../../../../../.agent-skill-chain/source/REVIEW_RULE.md) / [PHASES.md 監査観点](../../../../../../.agent-skill-chain/source/workflow/PHASES.md) / [TEST_BDD_FORMAT.md](../../../../../../.agent-skill-chain/source/TEST_BDD_FORMAT.md) / [DOCS_RULES.md 継続追随ゲート](../../../../../../.agent-skill-chain/source/DOCS_RULES.md)。
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約)。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認・品質保証・close 可否判定（verify-and-close skill chain: generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）。

### 1.2 レビュー対象（必須）

- **実装範囲**: `.agent-skill-chain/source/enforcement/ci/audit.sh` へ (C1) `resolve_issue_tracking_mode()` 純関数を新設、(C2) `check_close_move_pending()`（#33）冒頭へ github_native SKIP ガードを挿入。(C3) tmp 隔離 BDD テスト `tests/s1_bdd.sh`（S1-BDD-1〜10）。
- **レビュー期間**: 2026-07-15 ～ 2026-07-15
- **レビュー担当者**: verify-and-close 監査エージェント（モデルティア opus）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| C1 resolve_issue_tracking_mode 新設 | env×github.com remote から実効モードを stdout へ返す純関数。#33 コメント直前へ挿入 | 2026-07-15 | 実装エージェント | 完了 |
| C2 #33 github_native SKIP ガード | `check_close_move_pending()` 冒頭（既存 DB ガードより前）へ早期 SKIP＋`return 0` を挿入 | 2026-07-15 | 実装エージェント | 完了 |
| C3 BDD テスト（tmp 隔離） | S1-BDD-1〜10 を `tests/s1_bdd.sh` に実装 | 2026-07-15 | 実装エージェント | 完了 |

### 2.2 実装内容の詳細

#### C1: `resolve_issue_tracking_mode()`

- **実装内容**: `ISSUE_TRACKING_MODE != github_native`（未設定・不明値含む）→ `local_tracked`。`== github_native` かつ `git -C "$PROJECT_ROOT" remote -v` に `github.com` を含むときのみ `github_native`。それ以外（非 GitHub・非 git・remote 取得失敗）は `local_tracked`。全経路 `return 0`。
- **変更ファイル**: `.agent-skill-chain/source/enforcement/ci/audit.sh`（挿入のみ）。
- **実装方法**: 02_設計 §3.1.3 スケッチと**逐語一致**。github.com 判定は #34（audit.sh:1131）と同一シグナルを再利用（新規判定を作らない・親 ADR-2）。
- **確認事項**: `set -e` 下でも分岐は `if` 条件内に閉じ致命化しない（既存 1131 が同一パターンで実証・`pipefail` 未設定を確認）。

#### C2: #33 モードガード

- **実装内容**: 関数本体の 1 行目に `[[ "$(resolve_issue_tracking_mode)" == "github_native" ]]` なら SKIP ログ（stderr）＋`return 0`。SKIP ログは既存 #33 SKIP ログと同一様式で `SKIP` と `#33` の両リテラルを含む。
- **実装方法**: 02_設計 §3.2.1 スケッチと逐語一致。挿入位置は既存 sqlite3/DB ガード（現 1056）の直前＝最優先ガード（ADR-S1-1）。既存 3 ガード〜本判定は位置・内容とも不変。
- **確認事項**: local_tracked では新ガードを素通りし既存経路へ到達（回帰＝挙動不変）。

---

## 3. テスト結果の確認

### 3.1 単体テスト（再実行済み）

#### テスト実行結果（必須: 数値で記載）

- **実行日**: 2026-07-15（本監査で再実行）
- **テストファイル数**: 1（`tests/s1_bdd.sh`）
- **テストケース数**: 10（S1-BDD-1〜10）
- **成功**: 10
- **失敗**: 0
- **スキップ**: 0
- **実行コマンド**: `bash tests/s1_bdd.sh`
- **実行結果ログ**: `ALL PASS (S1-BDD-1〜10)`。特記: `S1-BDD-8 (base sig='1 1 1')`（#34/#35/#36 が全 4 モードで同一に発火＝モード非依存を実証）、`S1-BDD-10 (deleted lines=0)`（挿入のみを機械確認）。

#### 失敗したテスト

なし（0 件）。

### 3.2 統合テスト

S1-BDD-6〜8 が audit.sh を tmp 隔離リポで**実プロセス実行**し、stderr の SKIP/FAIL 行文字列でアサート（結合相当）。すべて PASS。

### 3.3 E2E テスト

対象外（audit.sh・bash のみ。DB/UI/HTTP なし）。

---

## 4. コードレビュー（review-code）

### 4.1 コード品質

- **リント結果**: 追加コードは 2 ブロック（純関数＋ガード）で bash 構文エラーなし（audit.sh は全 BDD 実行で正常起動を確認）。
- **フォーマット**: 問題なし（既存トグル前例と同一スタイル）。
- **型チェック**: 対象外（bash）。

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | モード分岐を「1 ヘルパー＋#33 の 1 ガード」に集約、コメントに ADR 参照 | OK | 02 §3.1.3/§3.2.1 と逐語一致 |
| 保守性 | 挿入のみ・既存行の書換/削除ゼロ（S1-BDD-10 で削除行 0 件を機械確認） | OK | 審査済み audit.sh への介入最小 |
| パフォーマンス | 追加は env 参照 1 回＋既存 `git remote -v` の再利用のみ | OK | #34 が既に remote を評価（1131） |
| セキュリティ | 認証トークン実値を成果物・ログ・fixture に残さない。fixture remote はダミー `github.com/example/repo.git`（fetch しない） | OK | ISSUE_TRACKING_MODE の AI 自律設定禁止原則は S-3 で source 明記 |

### 4.2 指摘事項

#### 指摘 1: テストコードが TEST_BDD_FORMAT の必須インラインコメント様式を満たさない

- **重要度**: 中
- **指摘内容**: `tests/s1_bdd.sh` は各ケースを `# ===== S1-BDD-N（G/CO）=====` の区切りコメントで表しており、[TEST_BDD_FORMAT.md](../../../../../../.agent-skill-chain/source/TEST_BDD_FORMAT.md) §0/§1 が**強制**する `ユースケース:`（テスト群）・`シナリオ:`（各ケース）の doc コメント、および `# Given:` / `# When:` / `# Then:` のインラインコメント（各ブロック直上に 1 つ）を備えていない（grep 0 件）。Gherkin 本体（Feature/Scenario/Given/When/Then）は 03_実装計画 §BDD に完全に記述され、テスト ID（S1-BDD-1〜10）で 1:1 対応するが、**テストコード自身**には規約が要求する BDD コメントが載っていない。REVIEW_RULE §フォーマットの正しさ・PHASES 監査観点（テストコードの `ユースケース:`/`シナリオ:`/GWT インラインコメント必須）に照らし、フォーマット逸脱として記録する。
- **対応状況**: 対応済み（`tests/s1_bdd.sh` へ付与済み。実測: `ユースケース:` 5 件・`シナリオ:` 10 件・`# Given:` 10 件・`# When:` 9 件・`# Then:` 10 件）
- **対応方法**: `tests/s1_bdd.sh` の各 S1-BDD ブロック直上に `シナリオ:`（03 の対応 Scenario 名を参照）を、ファイル冒頭のセットアップ群・resolve 系/#33 系/回帰系のまとまりに `ユースケース:` を、各ケース本体の前提/実行/検証に `# Given:`/`# When:`/`# Then:`（必要時 `# And (...)`）を付与した。**機能・アサーションは変更なし**（コメント付与のみ）で、実装成果物・回帰性への影響はない。
- **evidence_source**: existing_code（テストファイル本文の grep 実測）／external_spec（TEST_BDD_FORMAT.md の強制要件）。

> **close 可否への影響（監査所見）**: 実装本体（C1/C2）は設計 ADR に逐語準拠し、受け入れ基準 G1〜G6 を満たすテストが全 PASS、diff は挿入のみで回帰なし——**機能面の完成度は close 水準**。指摘 1（テストコードの BDD コメント様式）も対応済みであり、残課題はない。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（実装と整合・修正不要） | 監査 | 2026-07-15 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（BDD 6 シナリオが実装・テストと整合） | 監査 | 2026-07-15 |
| [`02_設計.md`](./02_設計.md) | 更新済み（ADR-S1-1〜4 が実装に逐語反映） | 監査 | 2026-07-15 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（S1-BDD-1〜10・fixture が実テストと一致。review-docs で #36 第 2 コミット化・`grep -q` 統一を反映済み） | 監査 | 2026-07-15 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（02 §3.1.3/§3.2.1 スケッチと audit.sh 差分が逐語一致・行番号引用は memo で全数突合済み）。
- **要件と実装の整合性**: 整合している（G1〜G6・6 BDD シナリオ→S1-BDD-1〜10→実テストが 1:1）。
- **コメント**: 実装前 review-docs（memo `20260715_192746_review-docs.md`）で 00/01/02 は無修正・03 のみ 2 点修正、ラウンド 2 で残指摘 0 収束済み。

---

## docs 更新

- **要否**: 不要（軽量パス・根拠付き判定）
- **対象**: なし
- **理由**: 本 S-1 は既定 `local_tracked` 固定で**現行のドキュメント化された挙動を一切変えない**（後方互換）。システム仕様書側では `docs/04_機能設計/enforcement/README.md` が audit.sh の失敗条件定義を source 側 `enforcement/README.md` を**正本として委譲**する構成で、#33 の close 移動検知・実効モード分岐の個別記述を持たない（grep で `#33`/`close 移動`/`ISSUE_TRACKING_MODE`/`github_native` はいずれも system spec に不在＝矛盾・陳腐化なし）。`ISSUE_TRACKING_MODE` の抽象原則・二重モード運用手順の仕様書追記は親 03 で明示的に **S-3/S-2 スコープ**に切り出されており S-1 対象外。よって DOCS_RULES §継続追随ゲート 手順 5（更新不要判定・軽量パス）に該当。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: OK。UNIX 哲学/変更範囲最小化（挿入のみ）・単一責務/単一決定点（実効モード導出は resolve のみ・#33 は返り値参照）・CQRS/Query 純粋性（DB/FS 非書込）・fail-safe（未設定/不明値/非 git/非 GitHub → local_tracked）・AI フレンドリー（2 因子で決定論）を満たす。
- **ディレクトリ構成**: OK（enforcement/ci/audit.sh 内の追加のみ・新規ファイルは issue 配下 tests/ のみ）。
- **命名規則**: OK（`resolve_issue_tracking_mode`・`ISSUE_TRACKING_MODE` は既存 `get_issue_mode`/`GITHUB_ISSUE_GATE_ENABLED` の命名慣習に整合）。

### 9.2 境界・依存の確認

- **責務の境界**: 明確。resolve は `PROJECT_ROOT`＋env のみに依存。#33 は resolve を単方向参照。#34/#35/#36 ほかは resolve を参照せず（S1-BDD-8 でモード非依存を実証・base sig='1 1 1'）。
- **依存関係**: 循環なし（ENV/REMOTE → resolve → #33 の単方向）。resolve は `PROJECT_ROOT`（audit.sh:76 で確定）のみに依存し、呼出時（末尾 1449 相当）には定義済み。
- **ADR 準拠**: ADR-S1-1（冒頭最優先ガード）・S1-2（SKIP ログ様式＋`SKIP`/`#33` 含む）・S1-3（#33 直前へ配置）・S1-4（tmp 隔離＋モード env スイープ＋差分スコープ静的検査）すべて実装・テストに反映。
- **指摘・推奨**: 設計・境界面の指摘なし。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| 実装が ADR-S1-1〜4 に逐語準拠 | existing_code | audit.sh 差分と 02 §3.1.3/§3.2.1 の突合 |
| G1〜G6 の受け入れ充足（回帰含む） | test_output | 本監査で `bash tests/s1_bdd.sh` 再実行 → ALL PASS（10/10） |
| #34/#35/#36 のモード非依存（回帰） | test_output | S1-BDD-8 base sig='1 1 1' が全モードで一致 |
| 挿入のみ・既存行不変 | test_output / existing_code | S1-BDD-10 deleted lines=0＋`git diff main` 目視 |
| docs 更新不要 | existing_code | system spec が失敗条件を source 正本へ委譲・#33/mode 記述不在 |
| BDD コメント様式対応（指摘 1） | existing_code / external_spec | test 本文 grep 実測（`ユースケース:`5/`シナリオ:`10/`# Given:`10/`# When:`9/`# Then:`10 件）で TEST_BDD_FORMAT 強制要件を充足 |

---

## 11. システム仕様書の更新

「docs 更新」節のとおり、DOCS_RULES §継続追随ゲート 手順 5（軽量パス・更新不要）で通過。docs/00_review への新規記録は不要（更新作業自体が発生しないため）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好。設計 ADR に逐語準拠・挿入のみで回帰リスク最小。
- **テスト品質**: 良好（網羅・回帰・TEST_BDD_FORMAT コメント様式も対応済み）。
- **ドキュメント品質**: 良好（00〜03 が実装・テストと整合・行番号引用突合済み）。
- **総合評価**: **合格**。機能・受け入れ基準・回帰は完全充足（全 BDD PASS・diff 挿入のみ）。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close 監査エージェント（opus）
- **承認日**: 2026-07-15
- **承認コメント**: 実装本体・テストともに close 水準。

---

## 受け入れ基準↔テスト対応（map-coverage 結果）

| 受け入れ基準 | BDD シナリオ | テスト | 結果 |
| ------------ | ------------ | ------ | ---- |
| G1（github_native 解決） | S1-BDD-1 | 単体（resolve 抽出 source） | PASS |
| G2（fail-safe 4 ケース） | S1-BDD-2〜5 | 単体 | PASS |
| G3（github_native で #33 SKIP） | S1-BDD-6 | 結合（audit.sh 実行） | PASS |
| G4（local_tracked で #33 FAIL・回帰） | S1-BDD-7 | 結合 | PASS |
| G5（#34/#35/#36 モード非依存・回帰） | S1-BDD-8 | 結合 | PASS |
| G6（全検証 tmp 隔離） | 全シナリオ共通 Given | — | PASS |
| 副作用なし（VO-1） | S1-BDD-9 | 単体 | PASS |
| 変更最小（VO-3） | S1-BDD-10 | 静的検査 | PASS |

**網羅性判定**: 01 の全 BDD ユースケース（6 シナリオ）・G1〜G6・VO-1/VO-3 がテストコード化され全 PASS。テストコード化できないシナリオ・未対応シナリオはなし。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- [`tests/s1_bdd.sh`](./tests/s1_bdd.sh) / [`memo/20260715_192746_review-docs.md`](./memo/20260715_192746_review-docs.md)
- 親 issue（GitHub Issue #115）: [`../../02_設計.md`](../../02_設計.md)（ADR-1/2/4/5）／[`../../03_実装計画.md`](../../03_実装計画.md)（T1）
- [`.agent-skill-chain/source/enforcement/ci/audit.sh`](../../../../../../.agent-skill-chain/source/enforcement/ci/audit.sh)

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ
