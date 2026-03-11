---
name: design-api-contract
description: "API・インターフェース・入出力の契約を設計し、02_設計に記載する。Use when designing APIs or 02_設計."
---

# design-api-contract

**目的**: API・インターフェース・入出力の契約を設計し、02_設計に記載する。

## 手順

1. 入力（define-boundaries の出力：責務・境界・参照関係。01_要件定義）を読む。
2. 外部に公開する API・関数・イベントの入出力を列挙する。
3. 各 API について「入力」「出力」「責務」を 1 行〜数行で書く。
4. 契約違反（不正入力・境界外）の扱いを簡潔に書く（エラー・例外方針）。
5. 02_設計の「API・インターフェース」セクションに反映する。

## 制約・禁止

- API は責務の境界で切る。define-boundaries と矛盾させない。
- 実装の詳細は 02 に長く書かない。03_実装計画に委譲する。
- テスト観点は review-dependencies と連携する。

## 成果物の形式

- **OUT**: API 一覧。各 API の入出力・契約の短文。02_設計に追記する形。review-dependencies では依存関係とテスト観点を確認する。

## 参照

- CONCEPTS（疎結合）。define-boundaries の出力。PHASES。workflow/TEMPLATES.md。
