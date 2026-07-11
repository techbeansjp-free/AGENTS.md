# command: requirement-discovery

**本ファイルの責務**: **どの skill をどの順で実行するか**（skill chain）の定義のみ。実行手順・委譲の形は skills/agent/run_command.md に従う。各 step の手順は各 capability の README/SKILL に従う。**契約**: [IO_CONTRACT.md](../IO_CONTRACT.md) に従い INPUT / PROCESS / OUTPUT / DONE で定義する。

要求・要件の整理と BDD までを一連の skill chain で実行する。

---

## メタデータ（phase → command 整合用）

| 項目 | 値 |
|------|-----|
| **Allowed Phase** | 要求、要件 |
| **Required Inputs** | issue（.agent-skill-chain/runtime/{issue}/）、context（親 00/03 等）、spec |
| **Produces** | 00_要求定義.md、01_要件定義.md |
| **Next Phase** | 要件（00 のみ完了時）、設計（01 まで完了時） |

---

## INPUT

- **issue**: .agent-skill-chain/runtime/{issue}/ のパス。00/01 の更新対象。
- **context**: 親 00、03、REBUILD_PLAN 等の参照（存在する場合）。
- **spec**: .agent-skill-chain/source/spec/（設計原則・設計判断の優先順位）。着手前に参照する。
- **テンプレート**: .agent-skill-chain/runtime/templates/00_要求定義.md, .agent-skill-chain/runtime/templates/01_要件定義.md（未存在時はパッケージの `.agent-skill-chain/runtime/templates/` を参照）。

---

## PROCESS（Skill chain・この順で実行）

1. **extract-goals** — 目的・ゴールの抽出  
   `skills/requirements/extract-goals/`
2. **identify-assumptions** — 前提・制約の洗い出し  
   `skills/requirements/identify-assumptions/`
3. **define-constraints** — 制約の明確化  
   `skills/requirements/define-constraints/`
4. **write-bdd** — BDD シナリオ・受け入れ基準の執筆  
   `skills/requirements/write-bdd/`

---

## 入出力の受け渡し

- extract-goals の OUT（目的・受け入れ基準候補）→ identify-assumptions の IN。
- identify-assumptions の OUT（前提・制約候補）→ define-constraints の IN。
- define-constraints の OUT（明確化された制約・受け入れ基準案）→ write-bdd の IN。
- 各 step の出力は 00_要求定義・01_要件定義のたたき台に随時反映し、最後に write-bdd で 00/01 を完成させる。

---

## OUTPUT

- 00_要求定義.md（目的・受け入れ基準・参照元）
- 01_要件定義.md（ユーザーストーリー・受け入れ基準・BDD シナリオ）

---

## DONE（DoD）

- 目的・受け入れ基準・参照元が 00 に記載されている。
- ユーザーストーリー・受け入れ基準・BDD シナリオが 01 に記載されている。
- 参照元（親 00、03、REBUILD_PLAN 等）が 01 に明記されている。

---

## 実行時の注意

- **着手前に**、00_要求定義.md および 01_要件定義.md の**テンプレートファイル**（.agent-skill-chain/runtime/templates/ またはプロジェクトに無い場合はパッケージの `.agent-skill-chain/runtime/templates/`）を**開いて確認**すること。成果物はテンプレートの**見出し・セクション番号・必須セクション**を欠かさずに作成すること。
- **着手前に .agent-skill-chain/source/spec/ を参照する**。spec 概要・設計原則・設計判断の優先順位（spec/00_spec概要.md, spec/01_設計原則.md, spec/06_設計判断の優先順位.md）を踏まえて要求・制約を整理する。
- 既存の 00/01 がある場合は上書きせず、該当 issue の 00/01 を更新する。テンプレートは .agent-skill-chain/runtime/templates または親 issue を参照する。
- 00/01 を更新する際、frontmatter に既に document_id が存在する場合はその値を変更・上書きしてはならない。document_id は 00/01 を新規作成するときまたは初回付与時にのみ設定する。
- **00_要求定義.md を新規作成する場合**、issue_id（UUID）を 1 回発行し、00 の frontmatter に `issue_id: "<UUID>"` を記載すること。既存 00 を更新する場合は issue_id を変更しないこと。issue フォルダの識別は 00 の frontmatter の issue_id を正とする。
- run_command の Constraints（順序・memo プレフィックス）を守ること。
- **完了後に書記（write-workflow-log）に依頼して記録させること。** 本 command は 00 と 01 の**複数成果物**を生成・更新しうるため、**生成・更新した全成果物それぞれ**（00_要求定義.md・01_要件定義.md など）について、各成果物の **DOCUMENT_ID**（frontmatter の UUID）と **DOCUMENT_PATH**（プロジェクトルート相対パス）を渡して書記に **1 回ずつ**記録させること（「1 command につき書記 1 回」の単数解釈は禁止。1 件でも漏れると audit#20 で FAIL する）。詳細は [skills/logging/write-workflow-log/SKILL.md](../skills/logging/write-workflow-log/SKILL.md) を参照。
