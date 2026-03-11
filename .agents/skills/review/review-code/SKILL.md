---
name: review-code
description: "実装内容・規約遵守・テスト観点を確認し、04_review に「実装内容の確認」を記載する。Use when performing code review or writing 04_review."
---

# review-code

**Purpose**: 実装内容・規約遵守・テスト観点を確認し、04_review に「実装内容の確認」を記載する。

## Inputs

- 実装成果物（コード・変更ファイル一覧）。
- 02_設計.md、03_実装計画.md。01_要件定義.md（受け入れ基準）。
- 委譲時の Constraints（CORE、RULES、PHASES 参照）。

## Process（手順）

1. Inputs（実装成果物。02_設計、03_実装計画。01 の受け入れ基準）を読む。
2. 02・03 に従っているか、責務の逸脱がないかを確認する。
3. 規約（CORE、RULES、証跡の残し方）を守っているか確認する。
4. 単体テスト観点・BDD シナリオとの対応を確認する。**テストコードに Given / When / Then のインラインコメントが付いているか**（.agents/TEST_BDD_FORMAT.md）。欠落は指摘する。
5. ディレクトリ構成・ファイル配置・命名規則・プレフィックス・フォーマット・spec（UNIX 哲学等）への準拠を確認する。
6. 指摘事項があれば箇条書きでまとめる。なければ「確認済み」と書く。
7. 04_review の「実装内容の確認」セクションに結果を書く。

## Outputs

- 04_review の「実装内容の確認」に追記する内容。表または箇条書き。指摘があれば「指摘」「推奨対応」を分けて書く。review-architecture と合わせて 04 を完成させる。

## Done

- 04_review の「実装内容の確認」に、確認結果（確認済みまたは指摘一覧）が記載されていること。指摘がある場合は推奨対応が分かる形で書かれていること。

## Forbidden（制約・禁止）

- 設計品質・要件の妥当性は本 capability の範囲だが、指摘は「事実と基準」に基づく。主観だけの批判にしない。
- 証跡省略は CORE 違反として必ず指摘する。

## 参照

- RULES、CORE。02_設計、03_実装計画、01_要件定義。PHASES。workflow/TEMPLATES.md。
