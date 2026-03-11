---
name: review-dependencies
description: "依存関係とテスト観点を確認し、02_設計・03_実装計画に反映する。Use when reviewing 02_設計 or defining test scope."
---

# review-dependencies

**目的**: 依存関係とテスト観点を確認し、02_設計・03_実装計画に反映する。

## 手順

1. 入力（02_設計のたたき台：責務・API。define-boundaries / design-api-contract の出力）を読む。
2. 依存の向き（A → B）を一覧にし、循環がないか確認する。
3. 各責務・API について「どうテストするか」の観点を 1 行ずつ書く（単体・結合・境界値）。
4. 02_設計の「テスト観点」と 03_実装計画の「テスト仕様・BDD」に反映する。
5. 必須成果物欠落がないか PHASES の DoD で確認する。

## 制約・禁止

- 依存は一方向に。循環が見つかったら define-boundaries または design-api-contract の見直しを促す。
- テスト観点は 01 の BDD シナリオと対応させる。無関係な観点を増やしすぎない。

## 成果物の形式

- **OUT**: 依存関係の整理表。テスト観点一覧。02 の「テスト観点」・03 の「テスト仕様」に追記する形。design-feature command の DoD を満たす。

## 参照

- CONCEPTS、PHASES。01_要件定義（BDD シナリオ）。02_設計、03_実装計画。workflow/TEMPLATES.md。
