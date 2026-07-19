# ADR

```yaml
id: ADR-0001
status: proposed
title: docs/system-spec/ の実体構築方針（要求ID体系・並行制御・ローカルモード等価機構ほか6項目）
tags: [system-spec, segments, config]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

agent-skill-chain は、Issue をまたいで永続するシステム仕様の唯一の正本として `docs/system-spec/` を新設する方針を確定している。既存の3成果物との役割分離は次の通り。

| 成果物 | 役割 |
|---|---|
| `docs/system-spec/`（新設） | システムが何を満たすべきか（永続・正本） |
| Issue単位の `SPEC.md` | 今回の Issue でシステム仕様をどう変更するか（Issue毎に破棄） |
| ADR（`docs/adr/`） | なぜその設計判断をしたか（判断の理由） |

`docs/system-spec/` が参照してよい情報源は (a) system-spec 内部の別モジュール（安定IDを介した参照）、(b) 外部の公式一次情報（例：デジタル庁・IPA・ISO・GitHub公式ドキュメント等。非公式ブログ・SNS・AI回答は不可。採用した要求はローカルへ完全記述し出典のみ添える）に限る。Issue・PR・commit・ソースコード・テストコード・AGENTS.md・ADR・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`・会話履歴・非公式サイトを規範的参照先にしてはならない。依存方向は「外部公式一次情報 → システム仕様書 → Issue SPEC → DESIGN/PLAN → ADR → 実装 → テスト・VALIDATION」の一方向であり、システム仕様書は下流（ADR・コード・Issue）に依存してはならない。

`docs/system-spec/` の実体構築（ディレクトリ作成・スキーマ定義・ゲート統合）は、`config/segments.yaml` の `spec` セグメントの outputs に「system-spec変更案」または `system_spec_impact: {mode: none, rationale: ...}` の明示を追加することを伴う。セグメント数・id・next 自体は変わらないため `schema_version` は据え置き可能だが、outputs の意味的変更にあたるため、`config/segments.yaml` のヘッダーコメントが定める「セグメント自体の追加・変更は破壊的変更とし、ADR作成必須」に該当する。本 ADR はこの規約をシステム自身の設計プロセスへ最初に適用する事例であり、次の6項目を決定する。

1. 要求ID体系
2. `docs/GLOSSARY.md` の配置
3. design セグメントでの承認済み判断がシステム仕様の変更を要する場合の更新経路
4. 並行 Issue 間での system-spec 変更の競合制御
5. ローカルモードでの最終 reconcile 相当の機械確認手段
6. 外部公式一次情報の許可ドメインリストの正本置き場

本 ADR が決定するのは方針のみであり、`docs/system-spec/` 自体のディレクトリ・ファイルの作成、`schemas/system-spec.schema.yaml`・`config/system-spec-sources.yaml` の新設、`config/roles.yaml` の該当ロールへの読み取り scope 追加は、本 ADR が accepted になった後、別 Issue で実施する（本 ADR の Consequences に記載）。

## Decision

**1. 要求ID体系**：system-spec 正本のグローバル永続IDとして `ASC-<AREA>-<FR|NFR|CON>-<NNNN>` を採用する（`AREA` は system-spec のトップレベルモジュールディレクトリ名を大文字化した識別子、`FR`=機能要求・`NFR`=非機能要求・`CON`=制約）。ID の構造・一意性検査は新設する `schemas/system-spec.schema.yaml` が定義する。既存の `AC-[0-9]+`（Issue ローカルの受入条件ID）はそのまま維持し、変更しない。結合点として、`templates/issue/SPEC.md` に YAML front-matter を追加し `covers: [ASC-...]` フィールドで対応する `ASC-*` ID を列挙する（この template 変更自体は実体構築フェーズで行う）。

**2. `docs/GLOSSARY.md` の配置**：現状維持する。`docs/GLOSSARY.md` は system-spec 固有ではなく、生きたファイル全体（AGENTS.md・standards/・templates/・config/・schemas/・scripts/・ci/）の禁止語彙・用語統一を担う（`scripts/lint-vocab.sh` の対象範囲）。system-spec 配下へ統合すると「システム要求」の一部であるかのように scope が誤って狭まるため、統合しない。system-spec から見た `docs/GLOSSARY.md` は補助参照として扱う。

**3. 更新経路**：design ワーカーには system-spec への直接改訂権を与えない。design ワーカーは `DESIGN.md` に system-spec 変更案（`system_spec_impact` セクション、変更内容・対象 `ASC-*` ID・変更理由）を記述するのみとし、system-spec 本体は編集しない。変更の反映は、専任の `system_spec_finalization_worker`（`config/roles.yaml` の `adr_finalization_worker` と同様の限定 lease パターン：writer lease を取得し、承認済みの変更内容のみを書き込み、それ以外のフィールドは変更不可）が、変更案が accepted ADR に紐づいたことを確認したうえで書き込む。理由：system-spec は全 Issue 共有の単一正本であり、Issue 粒度の writer lease（AGENTS.md §役割・権限・writer lease）のまま design ワーカーに直接改訂権を与えると、並行 Issue 間で未レビューの変更が混入しうる。ADR 経由の finalization に限定することで、AGENTS.md の不変条件「追跡可能性」（全変更が要求→設計(ADR)→実装→レビューの証跡を持つ）と整合させる。

**4. 並行制御**：ファイル/モジュール粒度への lease 拡張は複雑性が高いため採用しない。まず、system-spec 全体をシリアライズする専用 lease（`system_spec_lease`、粒度＝リポジトリ全体、対象＝`system_spec_finalization_worker` のみ）を採用する。モジュール粒度の並行更新が実運用上のボトルネックになった場合は、別途 ADR を起票して拡張する（過剰設計を避け、段階導入の方針に合わせる）。

**5. ローカルモードの reconcile 相当**：ローカルモードでは、GitHub モードの Check Run digest 照合と等価のロジックを `state.yaml` に `approved_digest` フィールドを追加することで実現する（`scripts/gate-reconcile.sh` が push ごとに承認済み成果物 digest と比較し、変化なしなら成功を再発行、変化ありなら当該ゲートと全下流ゲートを無効化する処理を、GitHub モードの Check Run と同じ判定ロジックでバックエンド抽象化する）。詳細な実装（`state.yaml` のフィールド構造、比較アルゴリズム）は `scripts/gate-reconcile.sh` の実装 Issue で行う。本 ADR では「等価物として `state.yaml` に `approved_digest` フィールドを追加する」という設計方針のみを決定する。

**6. 許可ドメインリストの正本置き場**：新設する `config/system-spec-sources.yaml`（`schema_version: agent-skill-chain/config/v1` 系列）に、外部公式一次情報として参照可能なドメインの許可リストを置く。`scripts/lint-references.sh` またはこれと別系統の system-spec 専用 lint がこの設定を読み込んで、system-spec 内の外部参照が許可リスト内のドメインに限られていることを検査する。

**導入順序**：`docs/system-spec/` の実体が無い段階で `system_spec_impact` をすべての PR に必須化すると、実態を伴わない儀式と化し原則が発効前に形骸化する。移行期は `system_spec_impact` を optional warning とし、実体構築完了後に required へ昇格する。

## Consequences

- `docs/system-spec/` の実体構築（ディレクトリ作成、`schemas/system-spec.schema.yaml`・`config/system-spec-sources.yaml` の新設、`templates/issue/SPEC.md` への `covers:` front-matter 追加、`config/roles.yaml` への `system_spec_finalization_worker` ロール追加および `design_worker`・`gate_reviewer` への system-spec 読み取り scope 追加、`scripts/gate-reconcile.sh` の `approved_digest` 対応）は、本 ADR が accepted になった後、別 Issue で実施する。
- 本 ADR が accepted になるまで、`system_spec_impact` フィールドはいかなる成果物にも追加しない。
- system-spec 専用 lease（`system_spec_lease`）の追加は `schemas/lease.schema.yaml` の変更を伴う。実体構築 Issue のスコープに含める。
- モジュール粒度の並行制御が将来必要になった場合は、決定4を supersede する別 ADR を起票する。
