---
name: write-bdd
description: "BDD シナリオ・ユーザーストーリー・受け入れ基準を 01_要件定義.md に執筆する。requirement-discovery command の最終 step。Use when writing 01_要件定義, user stories, or BDD scenarios."
---

# write-bdd

**契約**: [IO_CONTRACT.md](../../IO_CONTRACT.md) に従い Purpose / Inputs / Process / Outputs / Done / Forbidden で定義する。

## Purpose

BDD シナリオ・ユーザーストーリー・受け入れ基準を 01_要件定義.md に執筆する。

## Inputs

- 目的・制約・受け入れ基準候補（00_要求定義。define-constraints の出力）。
- .agent-skill-chain/runtime/templates/01_要件定義.md または親 issue の 01（形式参照）。

## Process

1. 入力（目的・制約・受け入れ基準候補。00_要求定義。define-constraints の出力）を読む。
2. ユーザーストーリーを「〇〇として／〇〇したい／〇〇である」の形で列挙する。
3. 各ストーリーに対し、受け入れ基準を 1 行〜数行で書く。
4. BDD シナリオを Given / When / Then で書く。複数シナリオがある場合は見出しで分ける。
5. 01_要件定義.md の必須セクション（目的・ストーリー・受け入れ基準・BDD）を満たしているか確認する。
6. 参照元（親 00、03、REBUILD_PLAN 等）を 01 の末尾に明記する。

## Forbidden

- BDD の Given は identify-assumptions の前提・制約と矛盾させない。
- 01 に書く内容の正本は 01 のみ。00 や 03 に重複して長文を書かない。参照 1 行で委譲する。
- テンプレートがある場合はその必須セクションを欠かさない。

## Outputs

- **OUT**: 01_要件定義.md（ユーザーストーリー・受け入れ基準・BDD シナリオが記載されている）。
- 行数・見出し構成は .agent-skill-chain/runtime/templates/01_要件定義.md または親 issue の 01 に合わせる。workflow/TEMPLATES.md を参照。

## Done

- 01 の必須セクション（目的・ストーリー・受け入れ基準・BDD）が満たされている。参照元が 01 の末尾に明記されている。

## 参照

- CONCEPTS、RULES。PHASES。.agent-skill-chain/runtime/templates または親 01_要件定義.md。
