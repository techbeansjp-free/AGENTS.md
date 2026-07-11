---
name: identify-assumptions
description: "目的・ゴールが成り立つ前提・制約・リスクを洗い出し、01 の背景や BDD の Given に使える形にする。Use when mapping assumptions or defining context for requirements."
---

# identify-assumptions

**目的**: 目的・ゴールが成り立つ「前提」「制約」「リスク」を洗い出し、01_要件定義の背景や BDD の Given に使える形にする。

## 手順

1. 入力（extract-goals の出力：目的・受け入れ基準候補）を読む。
2. 「この目的が成り立つ前提は何か」「守るべき制約は何か」「起きうるリスクは何か」を列挙する。
3. 前提・制約を BDD の Given や 01 の「背景」に転用できる短文でまとめる。
4. 次の capability（define-constraints）へ渡すため、前提一覧・制約候補を出力する。

## 制約・禁止

- 前提は検証可能なものと「仮定として置く」ものを分けて書く。
- 制約は「守らないと失敗する」ものに限定する。YAGNI に従い、必要最小にする。

## 成果物の形式

- **OUT**: 前提一覧（箇条書き）。制約候補（箇条書き）。必要ならリスクと緩和方針を 1 行ずつ。define-constraints ではこの出力を明確化された制約・受け入れ基準に落とし込む。

## 参照

- CONCEPTS。pm-skills の identify-assumptions の思想。01_要件定義の「背景」セクション。workflow/TEMPLATES.md。
