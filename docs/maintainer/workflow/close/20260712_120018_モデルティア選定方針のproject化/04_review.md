---
document_id: "4d65f2d5-fb3c-407e-a74a-5dbb4d9eb32f"
issue_id: "b42b0916-5186-4299-9977-3926b2d6c63c"
---

# レビュー報告書: AI駆動システム開発の基本運用原則の正本化（モデルティア選定・リソース意識・責務境界・進行役表示）

**プロジェクト名**: AI駆動システム開発の基本運用原則の正本化（モデルティア選定・リソース意識・責務境界・進行役表示）
**レビュー実施日**: 2026 年 07 月 12 日（JST）
**command**: verify-and-close
**レビュー深度**: standard（新規 2 ファイル・ドキュメント整備・コア無改変。RULES §実行モード）
**レビュー結論**: **合格（要修正なし）**

> **正本参照**: 監査観点は [REVIEW_RULE.md](../../../../../.agent-skill-chain/source/REVIEW_RULE.md)・[workflow/PHASES.md](../../../../../.agent-skill-chain/source/workflow/PHASES.md)、ルール正本は [RULES.md](../../../../../.agent-skill-chain/source/RULES.md)。

---

## 0. 対象成果物

| 成果物 | 区分 | 状態 |
| ------ | ---- | ---- |
| `.agent-skill-chain/project/MODEL_TIER_TABLE.md` | 新規（論点 a） | 作成済（untracked） |
| `.agent-skill-chain/project/OPERATING_PRINCIPLES.md` | 新規（論点 b/c/d） | 作成済（untracked） |
| `.agent-skill-chain/source/` 配下 | 既存・不変 | **改変ゼロを確認** |
| 既存 project ファイル（`自己拡張ワークフロー.md`・`COVERAGE_EXCEPTIONS.md`・`README.md`） | 既存・不変 | **改変ゼロを確認** |

実装記録: workflow.db `entry_id=deee1648-73e1-45c0-83c8-474c6cb2e45a`（implement-feature）。実装前ドキュメントレビュー: `entry_id=a3fdec67-e97a-42f7-9b6a-8146ccb298bf`（review-docs、2 サイクルで指摘 0 件収束済）。

---

## 1. テストシナリオ・観点の整理（generate-scenarios）

本 issue は**ドキュメント（運用原則）の正本化**であり、プログラム単体・結合・E2E テストは非該当（02 §5・§6、03「単体テスト」節に明記）。代替検証は以下 4 系統（03「テスト観点」節）。監査として各系統を独立に再実行した。

| 系統 | 検証方法 | 対応 BDD / SC |
| ---- | -------- | ------------- |
| 記載検証 | grep で必須記載の存在確認 | UC1〜UC5 / SC1〜SC8 |
| 二重定義/重複定義の不在 | 各節が「位置づけ＋参照リンク」に留まり原則本文を複製していないことの目視確認 | UC3 S2・UC4 S1・UC5 S2 |
| 相対リンク実在 | 全 markdown 相対リンクの実在検証 | 03 タスク3 |
| コア無改変 | `git diff -- .agent-skill-chain/source/` が空 | 00 §5 除外要件 |

---

## 2. 受け入れ基準の確認（map-coverage）

**プログラム単体テストは非該当**（03「単体テスト」節どおり確認）。以下は grep・リンク実在・git diff による代替検証の実測結果。全項目 ○。

| SC | 内容 | 検証方法 | 実測結果 | 判定 |
| -- | ---- | -------- | -------- | ---- |
| SC1 | 対応表に「設計/レビュー/監査=opus」「実装=原則 sonnet」「書記=haiku」の 3 行 | grep（MODEL_TIER_TABLE.md:11-13） | 3 行とも実在 | ○ |
| SC2 | 「実装」行が「まず opus 要否判定→不要と確定した場合のみ sonnet」の順序で読め、逆順記述でない | grep（:12・:22） | 「まず opus 要否を判定し、不要と確定した場合のみ sonnet」「逆順の運用にはしない」を確認 | ○ |
| SC3 | fable 原則禁止／最重要明示指定時のみ都度例外 | grep（:14） | 「fable｜原則禁止｜最重要と明示指定された個別 issue のみ都度例外」を確認 | ○ |
| SC4 | opus 要否先行検討が非裁量（対応表の該当行の決め方）であり裁量上振れでない旨、00 §7 ADR-1 参照 | grep（:32-34） | 「§裁量禁止との整合」節・「00_要求定義.md §7 ADR-1」参照リンクを確認 | ○ |
| SC5 | 書記=haiku の根拠が `evidence_source: existing_code`＋`scribe_claude.md:11` 付き | grep（:13）＋実在確認 | 記載あり。`scribe_claude.md` 11 行目 = `model: haiku` を実ファイルで確認 | ○ |
| SC6 | (b) リソース意識を「開発全般の基本姿勢」と明記＋CONTEXT_EFFICIENCY 参照＋過剰適用回避維持 | grep（OPERATING_PRINCIPLES.md:11,13） | 「AI 駆動システム開発全般で…基本姿勢」「§適用のスケーリング」「全機構が新たに強制されることはない」を確認 | ○ |
| SC7 | (c) 責務境界を「全工程の基本姿勢」と明記＋spec/01・spec/06 参照＋新規定義なし | grep（:19,21） | 「設計フェーズに限らず全工程…」「原則の本文は新規に定義せず…spec/01・spec/06 を正本として参照」を確認 | ○ |
| SC8 | (d) 進行役表示最小化＋論拠（00〜04＋git 管理）＋AGENT_CONDUCT との対象範囲差 | grep（:27,29,31） | 明文＋「論拠」＋「git 管理下」＋「AGENT_CONDUCT.md はサブエージェント向け…対象が異なる」を確認 | ○ |

**BDD 対応（01 §2.2 UC1〜UC5）**: 03 §テスト観点の対応表（UC1〜UC5 ⇔ タスク別観点 ⇔ SC）どおり、各シナリオが上記記載検証にマップされ充足。テストコード化非該当の理由（プログラム API を持たないドキュメント整備）は 03 に明記済で、未対応シナリオはなし。

---

## 3. 実装内容の確認（review-code）

### 3.1 03 実装計画の検証タスクの独立再実行

| # | 検証 | コマンド | 結果 |
| - | ---- | -------- | ---- |
| 1 | 記載検証（対応表 3 行・opus 要否先行順序・fable 原則禁止・書記=haiku evidence・裁量整合） | grep 群 | **全ヒット**（§2 表のとおり） |
| 2 | (b/c/d) 記載検証（開発全般・spec/01・全工程・進行役・AGENT_CONDUCT・git） | grep 群 | **全ヒット** |
| 3 | 相対リンク実在 | dirname＋realpath で全リンク解決 | **18/18 解決・未解決 0 件** |
| 4 | コア無改変 | `git diff --quiet -- .agent-skill-chain/source/` | **空（unchanged）** |
| 5 | 既存 project ファイル無改変 | `git diff --quiet -- 自己拡張ワークフロー.md COVERAGE_EXCEPTIONS.md README.md` | **空（unchanged）** |

作業ツリーの `git status --porcelain` は新規 2 ファイル（`?? MODEL_TIER_TABLE.md`・`?? OPERATING_PRINCIPLES.md`）のみで、意図しない変更なし。

### 3.2 evidence_source の妥当性（外部根拠の必須化）

- 書記=haiku: `evidence_source: existing_code`。`scribe_claude.md:11` の `model: haiku` を実ファイルで再確認（実在）。inference_only 依存ではない。
- 参照アンカーのスポット確認: `MODEL_SELECTION.md` の「2 ティア明記義務」「3 品質ゲート最上位固定」「裁量の禁止と形骸化防止」「汎用/固有境界」、`CONTEXT_EFFICIENCY.md §適用のスケーリング」、`boot/CORE.md §応答ルール」、`spec/01 §単一責務・§明確な境界」がいずれも実セクションとして存在。参照契約は健全。

### 3.3 規約遵守

- **配置**: `.agent-skill-chain/project/` 配下（`README.md §優先順位` により source に優先）。02 ADR-1〜5 の配置決定どおり。
- **単一責務**: (a) 具体対応表と (b/c/d) 原則強化を別ファイルに分離（02 §2.1）。
- **DRY**: 既存原則本文を複製せず参照リンクで接続。二重定義・重複定義なし。
- **命名**: `MODEL_TIER_TABLE.md`・`OPERATING_PRINCIPLES.md`（意図が分かる命名、AIフレンドリー設計）。

---

## 4. 設計・境界の確認（review-architecture）

- **コア／project 境界**: 抽象原則はコア（不変）、具体・本リポ強化は project の 1 か所。project→source の**単方向・非循環**参照のみ（02 §2.1.3）。コア側から project への逆参照追記なし（git diff で確認済）。設計どおり。
- **進行役向け（d）／サブエージェント向け（AGENT_CONDUCT.md）の責務分離**: OPERATING_PRINCIPLES.md(d) が対象範囲の違いを明記し、混同・二重定義を回避（02 ADR-5）。妥当。
- **スコープ規律**: 降格（裁量下振れ）の計測閾値・承認フローは持たず `MODEL_SELECTION.md §裁量の禁止 2` へ参照に留める（00 §5 スコープ外の遵守）。過剰実装なし。

---

## 5. システム仕様書 継続追随ゲート（DOCS_RULES §継続追随ゲート）

- 本 issue の変更は `.agent-skill-chain/project/` への**追加的な運用原則ドキュメント 2 件のみ**であり、コア挙動・スクリプト・システム仕様（`docs/` 配下の `AI_CI_CD_VISION.md` 等）に記述された既存の系挙動を変更していない。`docs/00_review/` は本リポに存在せず、追随対象となるシステム仕様の記述変更は発生しない。
- **判定（軽量パス・根拠 1 件）**: システム仕様書の更新は不要。根拠 = 変更は project 設定ドキュメントの純追加でありコア無改変（§3.1 #4-5 で実証）、既存 docs が記述する挙動に差分を生じないため。`evidence_source: existing_code`（git diff 実測）。

---

## 6. フォーマット・監査観点（PHASES §監査観点）

- **テストコード化の網羅**: プログラム API を持たないドキュメント整備につきテストコード化は非該当。未対応理由は 03 に明記済（網羅観点を満たす）。
- **document_id**: 00/01/02/03 は frontmatter に document_id を保持（既存付与値の後からの変更なしを確認）。本 04_review も document_id を付与。
  - **観察（非ブロッキング）**: 新規 2 ファイルは frontmatter を持たないが、これは既存 project ルールファイル（`自己拡張ワークフロー.md`・`COVERAGE_EXCEPTIONS.md`・`README.md`）が一様に frontmatter を持たない**既存の project 設定ファイル慣行**に整合させたもの。REVIEW_RULE §フォーマットの document_id 必須対象列挙（00/01/02/03/04/05/90・memo・docs 配下・指摘対応・00_システム理解）に project 設定ファイルは含まれず、02 ADR-1 でも project 正本ファイルとして設計されている。よって欠陥ではない。01 §4.2 の汎記述との差異は、ランタイムが読み込む project 設定ファイルの性質上フロントマターを付さない慣行が優先されるものであり、修正不要と判断する。
- **ディレクトリ・命名・参照リンク・BDD 形式・spec 準拠**: いずれも適合（§3.3・§4）。相対リンク 18/18 実在。

---

## 7. 指摘事項

- **ブロッキング指摘**: なし。
- **非ブロッキング観察**: §6 の document_id 慣行の差異（既存 project ファイル慣行に整合しており修正不要）。

---

## 8. レビュー結論

**合格。** 受け入れ基準 SC1〜SC8 を全て充足（§2）。03 記載の全検証（記載検証・二重定義不在・相対リンク実在 18/18・コア無改変・既存 project ファイル無改変）を監査として独立再実行し、すべて期待どおり。コア `.agent-skill-chain/source/` 改変ゼロ・スコープ規律遵守。要修正なし。close 相当へ進んでよい（commit は進行役の指示による）。

---

## 9. 参考

- [00_要求定義.md](./00_要求定義.md)・[01_要件定義.md](./01_要件定義.md)・[02_設計.md](./02_設計.md)・[03_実装計画.md](./03_実装計画.md)
- [REVIEW_RULE.md](../../../../../.agent-skill-chain/source/REVIEW_RULE.md)・[commands/verify-and-close.md](../../../../../.agent-skill-chain/source/commands/verify-and-close.md)
- 実装記録: workflow.db `entry_id=deee1648-73e1-45c0-83c8-474c6cb2e45a`
