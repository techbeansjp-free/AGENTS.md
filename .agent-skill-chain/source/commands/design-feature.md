# command: design-feature

**本ファイルの責務**: **どの skill をどの順で実行するか**（skill chain）の定義のみ。実行手順・委譲の形は skills/agent/run_command.md に従う。各 step の手順は各 capability の README/SKILL に従う。

設計と実装計画までを一連の skill chain で実行する。**契約**: [IO_CONTRACT.md](../IO_CONTRACT.md) に従い INPUT / PROCESS / OUTPUT / DONE で定義する。

---

## メタデータ（phase → command 整合用）

| 項目 | 値 |
|------|-----|
| **Allowed Phase** | 設計、実装計画 |
| **Required Inputs** | issue、01_要件定義.md、context（親 02/03 等）、spec |
| **Produces** | 02_設計.md、03_実装計画.md |
| **Next Phase** | 実装計画（02 のみ完了時）、実装（03 まで完了時） |

---

## INPUT

- **issue**: .agent-skill-chain/runtime/{issue}/ のパス。02/03 の更新対象。
- **context**: 親 01、02、03 等の参照（存在する場合）。
- **spec**: .agent-skill-chain/source/spec/（00 概要、01 設計原則、02 ディレクトリ構造方針、06 設計判断の優先順位）。着手前に参照する。

---

## PROCESS（Skill chain・この順で実行）

1. **define-boundaries** — 責務・境界の定義  
   `skills/architecture/define-boundaries/`
2. **design-api-contract** — API・インターフェースの設計  
   `skills/architecture/design-api-contract/`
3. **review-dependencies** — 依存関係・テスト観点の確認  
   `skills/architecture/review-dependencies/`

---

## 入出力の受け渡し

- define-boundaries の OUT（責務・境界・参照関係）→ design-api-contract の IN。
- design-api-contract の OUT（API 一覧・契約）→ review-dependencies の IN。
- 各 step の出力は 02_設計に随時反映し、03_実装計画にテスト観点・タスク分解を書く。review-dependencies で 02・03 を完成させる。

---

## OUTPUT

- 02_設計.md（責務・参照関係・テスト観点・API）
- 03_実装計画.md（タスク分解・テスト仕様 BDD）
- **サブissueを 1 件以上分割した場合**: 親ワークフロー（.agent-skill-chain/runtime/{親issue}/）のルートに 90_issues.md を作成すること。

---

## DONE（DoD）

- 責務・参照関係・テスト観点が 02 に記載されている。
- タスク分解・テスト仕様（BDD）が 03 に記載されている。
- 01 の BDD と 03 のテスト観点が対応している。
- **サブissueを 1 件以上作成（分割）した場合**: 親ワークフローのルートに 90_issues.md が存在すること。未作成のまま完了とみなさない。

---

## 実行時の注意

- **着手前に .agent-skill-chain/source/spec/ を参照する**。spec 概要・設計原則・ディレクトリ構造方針・設計判断の優先順位（spec/00_spec概要.md, spec/01_設計原則.md, spec/02_ディレクトリ構造方針.md, spec/06_設計判断の優先順位.md）を踏まえて設計する。システムアーキテクチャで最初に考慮すべきことは spec に記載する。
- 01_要件定義を読んだうえで設計する。02 の責務は 01 の要求と整合させる。
- run_command の順序を守ること。
- 02/03 を更新する際、frontmatter に既に document_id が存在する場合はその値を変更・上書きしてはならない。document_id は 02/03 を新規作成するときまたは初回付与時にのみ設定する。
- **完了後に書記（write-workflow-log）に依頼して記録させること。** 本 command は 02 と 03 の**複数成果物**を生成・更新しうるため、**生成・更新した全成果物それぞれ**（02_設計.md・03_実装計画.md など）について、各成果物の **DOCUMENT_ID**（frontmatter の UUID）と **DOCUMENT_PATH**（プロジェクトルート相対パス）を渡して書記に **1 回ずつ**記録させること（「1 command につき書記 1 回」の単数解釈は禁止。1 件でも漏れると audit#20 で FAIL する）。詳細は [skills/logging/write-workflow-log/SKILL.md](../skills/logging/write-workflow-log/SKILL.md) を参照。
