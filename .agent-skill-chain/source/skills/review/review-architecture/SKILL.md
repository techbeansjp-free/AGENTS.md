---
name: review-architecture
description: "設計・境界・依存の妥当性をレビューし、04_review に「設計・境界の確認」を記載する。Use when reviewing 02_設計 or 04_review."
---

# review-architecture

**Purpose**: 設計・境界・依存の妥当性をレビューし、04_review に「設計・境界の確認」を記載する。

## Inputs

- 02_設計.md。実装成果物（コード・変更ファイル一覧）。01_要件定義.md。
- 委譲時の Constraints（CONCEPTS、PHASES 監査観点参照）。

## Process（手順）

1. Inputs（02_設計。実装成果物。01_要件定義）を読む。
2. 02 の責務・境界が実装と一致しているか確認する。
3. 依存関係が一方向で、循環や不要な結合がないか確認する。
4. 01 の要求を満たす設計になっているか、抜け漏れがないか確認する。
5. 指摘事項があれば箇条書きでまとめる。
6. 04_review の「設計・境界の確認」（§9）に結果を書く。

## Outputs

- 04_review の「設計・境界の確認」に追記する内容。通過/要対応を分けて書く。PHASES の監査観点（成果物の必須セクション・証跡の規約遵守）も確認する。
- **二観点の両リストを必須出力**（[REVIEW_DUAL_LENS.md](../../../REVIEW_DUAL_LENS.md)）: 04_review に「敵対的観点リスト」と「must-preserve リスト」を**両方**出力する。両リスト未記載は未完了。

## Done

- 04_review の「設計・境界の確認」に、確認結果（通過または指摘一覧）が記載されていること。指摘がある場合は基準（どのファイル・どの spec に照らして）が分かる形で書かれていること。
- 04_review に「敵対的観点リスト」「must-preserve リスト」の**両方**が記載されていること（REVIEW_DUAL_LENS.md §3。いずれか欠落は未完了）。

## Forbidden（制約・禁止）

- CONCEPTS（責務・疎結合）に反している点は必ず指摘する。
- 指摘は「どのファイル・どの基準に照らして」を明示する。

## 参照

- CONCEPTS（単一責任・疎結合）。02_設計、01_要件定義。PHASES。workflow/TEMPLATES.md。
