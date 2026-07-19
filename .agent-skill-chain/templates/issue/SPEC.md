<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
<...> のプレースホルダを実際の内容に置き換えて記入すること。
-->

# SPEC: <Issue タイトル>

- Issue: `<ISSUE-123>`
- 作成者: `<worker id>`
- 対象ブランチ: `<feature/123-user-authentication>`

## 目的・背景

<この Issue が解決する問題、達成したい目的を記述する。なぜ今これが必要かの背景も含める。>

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

<この Issue のトリガーとなったユーザー・ステークホルダーの要求を記述する。>

### 要件

- <要件1: 要求を満たすために必要な機能・制約>
- <要件2: ...>

### 受入条件（Acceptance Criteria）

各 AC には、散文形式の Given/When/Then による受け入れシナリオを添える（構造化マーカーの強制は `bdd.profile: strict` の場合のみ。`.agent-skill-chain/config/agent-skill-chain.yaml` 参照）。

#### AC-1: <受入条件の要約>

- Given: <前提条件>
- When: <操作・イベント>
- Then: <期待される結果>
- 検証方法見込み: `<automated | manual | hybrid>`（詳細な理由・手順・実行者は `VALIDATION.md` で確定する）

#### AC-2: <受入条件の要約>

- Given: <前提条件>
- When: <操作・イベント>
- Then: <期待される結果>
- 検証方法見込み: `<automated | manual | hybrid>`

<!-- AC を追加する場合は AC-3, AC-4 ... と連番で追加する -->

## スコープ外

<この Issue では対応しない事項を明記する。曖昧語・対象外欠落は仕様ゲートの反証観点で指摘される。>

- <対象外事項1>
- <対象外事項2>
