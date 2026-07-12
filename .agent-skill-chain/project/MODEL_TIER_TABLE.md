# MODEL_TIER_TABLE.md — 役割→ティア対応表（本リポ固有）

**責務**: サブ委譲時のモデルティア選定について、本リポジトリ固有の**上書き/追加**（選定手順・運用ポリシー・確定した実例）を正本化する。役割→抽象ティアの**一般的な方向性（推奨デフォルト）の正本は [../source/platforms/claude/MODEL_TIER_RECOMMENDED.md](../source/platforms/claude/MODEL_TIER_RECOMMENDED.md)** に置き、本ファイルは**それを基点に本リポ固有の上書き/追加のみを記す**（重複記載しない）。抽象原則（適用条件・ティア明記義務・品質ゲート最上位・裁量の禁止と形骸化防止）は [../source/MODEL_SELECTION.md](../source/MODEL_SELECTION.md) に置き、本ファイルはその **project 側正本**（[../source/MODEL_SELECTION.md §汎用/固有境界](../source/MODEL_SELECTION.md#汎用固有境界)）である。委譲パケットのティア根拠 1 行は、本表の該当行または推奨デフォルトの該当行をそのまま引用する（[../source/MODEL_SELECTION.md §2 ティア明記義務](../source/MODEL_SELECTION.md#2-ティア明記義務)）。

---

## 一般ティア方向性（推奨デフォルトを参照）

役割→抽象ティアの**一般的な方向性**（設計・レビュー・監査＝上位ティア〈opus〉／実装＝中位ティア〈sonnet〉＋複雑作業は上位へエスカレーション／書記＝軽量ティア〈haiku〉）の正本は [../source/platforms/claude/MODEL_TIER_RECOMMENDED.md](../source/platforms/claude/MODEL_TIER_RECOMMENDED.md) に置く。**本リポでもこの方向性に従い、品質ゲート直結役割（設計・レビュー・監査＝opus）は推奨デフォルトと同じく格下げしない。** 一般行は再掲せず参照する（重複禁止・単一責務）。

---

## 本リポ固有の上書き/追加

推奨デフォルトを基点に、本リポ固有の上書き/追加のみを次に記す。

| 本リポ固有の上書き/追加 | ティア／方針 | 選定手順・根拠 |
| ---- | ------ | -------------- |
| 実装のティア選定順序（ADR-1） | 原則 sonnet（複雑箇所は opus 格上げ可） | **まず opus 要否を判定し、不要と確定した場合のみ sonnet を選ぶ**（sonnet をデフォルトにして複雑な時だけ格上げする、という逆順ではない）。推奨デフォルトの「実装＝中位ティア」に対する**本リポ固有の順序規定の追加**。 |
| 書記＝haiku 固定の実例 | haiku | `evidence_source: existing_code`。実在実例: `scribe_claude.md:11` の `model: haiku`（[../runtime/templates/agents/scribe_claude.md](../runtime/templates/agents/scribe_claude.md)）。推奨デフォルト「書記＝軽量ティア」を本リポで haiku に確定した実例。 |
| fable | 原則禁止 | ユーザーが個別 issue を「最重要」と明示指定した場合のみ、都度例外として許容する。日常運用化しない。推奨デフォルトには含めない**本リポ固有の運用ポリシー**。 |
| 降格（裁量下振れ）手続き | project 側で扱う | 計測閾値・承認フロー・対応表更新手順は [../source/MODEL_SELECTION.md §裁量の禁止と形骸化防止](../source/MODEL_SELECTION.md#裁量の禁止と形骸化防止) に従う。 |

各行はそのまま委譲パケットの根拠 1 行として引用できる粒度で書いている。

---

## opus 要否先行検討の選定手順

実装を委譲する前に、**まず「opus で実装させるべきか」を先に検討する**。opus が不要と確定した場合に**限り** sonnet を選ぶ。「sonnet をデフォルトにしておき、複雑だと判明した時だけ opus に格上げする」という**逆順の運用にはしない**。opus 要否の判定を先行させることで、品質を最優先しつつティア選定を非裁量に保つ。

---

## 品質最優先・コスト二次

ティア選定はコスト最適化のために行うが、品質ゲート（レビュー・テスト・受け入れ基準）を最上位に固定する。コスト都合で品質ゲートを下げない（[../source/MODEL_SELECTION.md §3 品質ゲート最上位固定](../source/MODEL_SELECTION.md#3-品質ゲート最上位固定)）。安価ティアで品質が満たせない場合は上位ティアへ上げる。

---

## 裁量禁止との整合（非裁量ルールである旨）

**opus 要否先行検討は、対応表の該当行の決め方そのものであり、エージェントの自由裁量ではない。** 「迷ったら上位」という裁量上振れとは区別される非裁量の選定手順である。詳細な検討経緯・論拠は [docs/maintainer/workflow/20260712_120018_モデルティア選定方針のproject化/00_要求定義.md §7 ADR-1](../../docs/maintainer/workflow/20260712_120018_モデルティア選定方針のproject化/00_要求定義.md) を参照。この整合の一般原則は [../source/MODEL_SELECTION.md §裁量の禁止と形骸化防止](../source/MODEL_SELECTION.md#裁量の禁止と形骸化防止) に定める。

コスト都合による裁量的な降格（裁量下振れ）は、本ファイルでは扱わない。降格の計測閾値・承認フロー・対応表更新手順は [../source/MODEL_SELECTION.md §裁量の禁止と形骸化防止 2](../source/MODEL_SELECTION.md#裁量の禁止と形骸化防止) の手続きに従う（本 issue のスコープ外）。

---

## 参照

- [../source/platforms/claude/MODEL_TIER_RECOMMENDED.md](../source/platforms/claude/MODEL_TIER_RECOMMENDED.md) — Claude 採用先向け 役割→推奨ティア（推奨デフォルト・advisory）。一般ティア方向性の正本。本ファイルはこれを基点に上書き/追加する。
- [../source/MODEL_SELECTION.md §汎用/固有境界](../source/MODEL_SELECTION.md#汎用固有境界) — コア（抽象原則）／PF 限定名前空間（推奨デフォルト）／project（本表）の役割分担
- [README.md §優先順位](README.md) — project 配下は source に優先する
