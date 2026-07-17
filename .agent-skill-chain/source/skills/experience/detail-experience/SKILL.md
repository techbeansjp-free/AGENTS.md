---
name: detail-experience
description: "map-experience の流れの上で、UI・デザインシステム適用・アクセシビリティ・実装可能性を具体化し、既存デザイン資産の再利用を新規作成より優先して探索した上で、責務・API 候補を 02_設計.md §7.3 に記録し define-boundaries へ引き渡す。体験設計フェーズ3（design-feature の step0c）。Use when detailing UI, accessibility, design-system reuse, or implementation feasibility for a UI/UX-bearing feature after map-experience has completed, or before delegating to define-boundaries."
---

# detail-experience

**契約**: IO_CONTRACT.md（`.agent-skill-chain/source/IO_CONTRACT.md`。本スキルは配備後に `.claude/skills/experience__detail-experience/` へ単体コピーされるため相対リンクではなくパス表記で示す）に従い Purpose / Inputs / Process / Outputs / Done / Forbidden で定義する。

## Purpose

map-experience（フェーズ2）の流れの上で、UI・デザインシステム適用・アクセシビリティ・実装可能性を具体化し、既存デザイン資産を再利用優先で探索した上で責務・API を逆算する土台を 02_設計.md §7.3 に作る（体験設計フェーズ3）。

## Inputs

- 02_設計.md §7.2（map-experience の出力: IA・ユーザーフロー・体験ジャーニー・却下案）。
- 01_要件定義.md。
- 消費者プロジェクトの既存デザイン資産／デザインシステム（存在すればその階層・命名を最優先で参照）。

## Process

1. UI/ビジュアル・視線誘導を検討する。
2. **既存デザイン資産の再利用探索を優先順位で実施する**（新規作成の前に必ず実施）: ①既存のページテンプレート相当 → ②既存のパターン/セクション相当 → ③既存のコンポーネント相当 → ④既存のレイアウト相当の組み合わせ → ⑤既存のプリミティブ相当 → ⑥不足時のみ新規作成。
3. デザインシステム適用・一貫性を確認する（基礎値＝トークン相当を自由に増やさない／レイアウトを個別成果物に直接埋め込まない）。
4. アクセシビリティ（コントラスト・キーボード操作・代替テキスト等）を確認する。
5. 実装可能性・検証改善観点（体験を成立させる実装制約との整合、どう計測・改善するか）を確認する。
6. 新規 UI 要素を作る場合は正当化条件（複数箇所での再利用見込み・責務明確・既存の組み合わせで表現不可・バリアント明示・アクセシビリティ要件文書化・レスポンシブ挙動文書化）を満たすか §7.3 へ明記する。
7. 却下案（ビジュアル洗練度優先で操作性を損なう案）を 1 件以上記述する。
8. 責務・API 候補を抽出し define-boundaries へ渡す形で記録する。

## Forbidden

- 判断基準優先順位（skills/experience/README.md §判断基準の優先順位）を無視し「ビジュアルの洗練度」を上位に置くこと。
- **既存資産の探索を省略し安易に新規 UI 要素・新規トークン・ページ直書きレイアウトを増やすこと**。
- 幻覚ペルソナを実ユーザー調査の代替として扱うこと。
- UI モックの作画（本フレームワークの除外要件）。
- architecture の責務境界を確定すること（define-boundaries の責務）。
- **特定技術スタック（React/Figma 等）や特定ディレクトリ構成を前提として固定すること**（消費者の技術非依存性を壊す）。

## Outputs

- **OUT**: 02_設計.md §7.3（UI 具体化・**探索した既存資産の一覧**〈どの層で何を探索し、再利用可否と理由。既存デザイン資産が無いプロジェクトでは「既存資産なし」と 1 行明記〉・**再利用結果／新規作成の正当化根拠**・アクセシビリティ・却下案）。
- define-boundaries への「責務・API 候補」（体験から逆算した種）。

## Done

- 体験面=あり の場合、§7.3 に以下がすべて揃っている:
  - UI 具体化
  - **既存資産の探索一覧**（層ごとの探索対象・再利用可否・理由の列挙。「探索した」という一言では不可。既存資産が無い場合は「既存資産なし」と 1 行明記）
  - **再利用結果**（再利用したか／新規作成なら正当化条件の充足）
  - アクセシビリティの確認結果
  - 「操作性を損なう案の却下」1 件以上
  - 責務・API 候補
- 新規 UI 要素を提案する場合は、新規作成正当化条件を満たす根拠が §7.3 に書かれている。

## 参照

- CONCEPTS、RULES、IO_CONTRACT.md
- .agent-skill-chain/runtime/templates/02_設計.md §7
- skills/experience/README.md（判断基準優先順位・fresh サブ分割・規模比例統合）
- skills/experience/map-experience/（前フェーズの出力）
- skills/architecture/define-boundaries/（責務・API 候補の引き渡し先）
- commands/design-feature.md（発動条件・委譲手順）
