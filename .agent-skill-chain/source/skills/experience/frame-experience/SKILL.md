---
name: frame-experience
description: "UI/UX を伴う機能について、ビジネス目的・成功基準（KPI）とユーザー・課題を一人称ナラティブ＋却下案で枠づけ、02_設計.md §7.1 に記録する。体験設計フェーズ1（design-feature の step0a）。Use when starting the experience design phase for a UI/UX-bearing feature, or when determining whether a feature has an experience surface."
---

# frame-experience

**契約**: IO_CONTRACT.md（`.agent-skill-chain/source/IO_CONTRACT.md`。本スキルは配備後に `.claude/skills/experience__frame-experience/` へ単体コピーされるため相対リンクではなくパス表記で示す）に従い Purpose / Inputs / Process / Outputs / Done / Forbidden で定義する。

## Purpose

UI/UX を伴う機能について、ビジネス目的・成功基準（KPI）とユーザー・課題（誰の何の課題か・JTBD・仮説）を一人称ナラティブ＋却下案で枠づけ、02_設計.md §7.1 に記録する（体験設計フェーズ1）。

## Inputs

- 00_要求定義.md（`experience_surface` を含みうる）。
- 01_要件定義.md。
- .agent-skill-chain/runtime/templates/02_設計.md §7（記録先の形式）。

## Process

1. 00_要求定義.md の `experience_surface` を確認する。
   - 値がある場合: §7.0 へ転記し、体験サーフェス定義（人間が感覚器で直接体験する出力があるか。画面に限らず CLI 出力・エラー・生成 Markdown・エージェント指示文を含む）に照らして検証する。定型理由（例:「バックエンドのため」のみ）が実際の出力と矛盾する場合は「あり」へ倒し、進行役へ差し戻す。
   - 値が無い場合: この capability が体験サーフェスを判定し、判定結果（あり/なし＋理由 1 行）を §7.0 に記録する。
2. 判定が「なし」の場合はここで完了とする（map-experience / detail-experience はスキップ）。
3. 判定が「あり」の場合、ビジネス目的・成功基準（KPI）を一人称ナラティブで記述する（観点シード:「この機能が無ければ誰がどう困るか（実在の一人を挙げられるか）」）。
4. ユーザー・課題（ペルソナ・JTBD・仮説）を確認する（観点シード:「このユーザーが最初の 5 秒で知りたいことは何か／これはユーザーがやりたいことか、我々が作れることか」）。
5. 却下案（採らなかったターゲット/目的仮説）を 1 件以上記述する。
6. 幻覚ペルソナ注意（LLM が捏造したユーザー像は実ユーザー調査の代替にならない旨）を明記する。

## Forbidden

- チェックボックスの列挙のみ（ナラティブ無し）で済ませること。
- 幻覚ペルソナを実ユーザー調査の代替として扱うこと。
- IA・ユーザーフロー・UI 具体化へ踏み込むこと（それは map-experience / detail-experience の責務）。
- **00_要求定義.md・01_要件定義.md の目的・成功基準・ユーザーストーリーを再定義・重複執筆すること**。frame-experience は 00/01 を入力として「体験の前提」へ翻訳する役であり、要求定義の二重工数を生まない。00/01 との矛盾を発見した場合は自ら 00/01 を直さず進行役へ差し戻す（00/01 の修正は requirement-discovery 側の責務）。

## Outputs

- **OUT**: 02_設計.md §7.0（体験サーフェス判定結果）・§7.1（前提ナラティブ・ペルソナ・JTBD・却下案・幻覚ペルソナ注意）。
- 「あり」判定時の §7.1 出力は次フェーズ map-experience の Inputs となる。

## Done

- 体験面=あり の場合: §7.1 に前提ナラティブ・ペルソナ・JTBD・却下案 1 件以上・幻覚ペルソナ注意が揃っている。
- 体験面=なし の場合: §7.0 に判定結果（なし＋理由 1 行）が記録され、後続フェーズがスキップされている。

## 参照

- CONCEPTS、RULES、IO_CONTRACT.md
- .agent-skill-chain/runtime/templates/02_設計.md §7
- skills/experience/README.md（判断基準優先順位・fresh サブ分割・規模比例統合）
- commands/design-feature.md（発動条件・委譲手順）
