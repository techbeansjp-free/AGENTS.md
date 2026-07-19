---
name: map-experience
description: "frame-experience の前提の上で、情報設計（IA）・ユーザーフロー・体験ジャーニーを設計し、02_設計.md §7.2 に記録する。体験設計フェーズ2（design-feature の step0b）。Use when designing information architecture, user flow, or the experience journey for a UI/UX-bearing feature after frame-experience has completed."
---

# map-experience

**契約**: IO_CONTRACT.md（`.agent-skill-chain/source/IO_CONTRACT.md`。本スキルは配備後に `.claude/skills/experience__map-experience/` へ単体コピーされるため相対リンクではなくパス表記で示す）に従い Purpose / Inputs / Process / Outputs / Done / Forbidden で定義する。

## Purpose

frame-experience（フェーズ1）の前提の上で、情報設計（IA）・ユーザーフロー・体験ジャーニーを設計し、02_設計.md §7.2 に記録する（体験設計フェーズ2）。

## Inputs

- 02_設計.md §7.1（frame-experience の出力: 前提ナラティブ・ペルソナ・JTBD・却下案）。
- 01_要件定義.md。

## Process

1. IA（情報構造・分類・ナビゲーション）を設計する（観点シード:「情報構造は誰の意思決定順に並んでいるか／削っても誰も困らない情報はどれか」）。
2. ユーザーフロー・CTA・タッチポイント・失敗時体験を一人称ナラティブで記述する（観点シード:「失敗時の画面／出力（CLI エラー・生成 Markdown 含む）を先に設計したか」）。
3. 体験ジャーニーを描く。
4. 却下案（採らなかった導線案）を 1 件以上記述する。

## Forbidden

- フェーズ1（frame-experience）の前提を無視して流れを描くこと。
- UI/ビジュアルの具体化（detail-experience の責務）。
- architecture の責務境界を確定すること（define-boundaries の責務）。

## Outputs

- **OUT**: 02_設計.md §7.2（IA・ユーザーフロー・体験ジャーニー・却下案）。
- 出力は次フェーズ detail-experience の Inputs となる。

## Done

- 体験面=あり の場合: §7.2 に体験ジャーニー・IA・ユーザーフロー・却下案 1 件以上が揃っている。

## 参照

- CONCEPTS、RULES、IO_CONTRACT.md
- .agent-skill-chain/runtime/templates/02_設計.md §7
- skills/experience/README.md（判断基準優先順位・fresh サブ分割・規模比例統合）
- skills/experience/frame-experience/（前フェーズの出力）
- commands/design-feature.md（発動条件・委譲手順）
