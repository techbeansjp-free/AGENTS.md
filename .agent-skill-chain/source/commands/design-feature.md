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
- **experience_surface**: 00_要求定義.md frontmatter の `experience_surface`（任意）。体験設計 3 工程（0a/0b/0c）の発動判定に用いる。未記入の場合は frame-experience が判定する。

---

## PROCESS（Skill chain・この順で実行）

0a. **frame-experience**（`experience_surface` が `null`（未記入）または `"yes: ..."` の場合に実行。`"no: ..."` はスキップ）— 体験の前提づけ ※fresh サブ①へ委譲  
   `skills/experience/frame-experience/`
0b. **map-experience**（0a の判定結果=あり の場合に実行）— 体験の流れ ※fresh サブ②へ委譲  
   `skills/experience/map-experience/`
0c. **detail-experience**（0a の判定結果=あり の場合に実行）— 体験の具体化 ※fresh サブ③へ委譲  
   `skills/experience/detail-experience/`
1. **define-boundaries** — 責務・境界の定義  
   `skills/architecture/define-boundaries/`
2. **design-api-contract** — API・インターフェースの設計  
   `skills/architecture/design-api-contract/`
3. **review-dependencies** — 依存関係・テスト観点の確認  
   `skills/architecture/review-dependencies/`

> 0a/0b/0c は**各々別の fresh サブ**へ委譲する（一気通貫にしない）。委譲粒度の具体形は「実行時の注意」を参照（ADR-7 委譲手順）。
> `experience_surface` が `null（未記入）`の場合も 0a を起動し、frame-experience が『あり/なし』を判定する（INPUT の約束と整合）。0b/0c の要否は 0a の判定結果に従う。

---

## 入出力の受け渡し

- frame-experience の OUT（02 §7.1・前提ナラティブ）→ map-experience の IN。
- map-experience の OUT（02 §7.2・IA・UXフロー・ジャーニー）→ detail-experience の IN。
- detail-experience の OUT（02 §7.3・UI 具体化＋責務・API 候補）→ define-boundaries の IN。
- define-boundaries の OUT（責務・境界・参照関係）→ design-api-contract の IN。
- design-api-contract の OUT（API 一覧・契約）→ review-dependencies の IN。
- 各 step の出力は 02_設計に随時反映し、03_実装計画にテスト観点・タスク分解を書く。review-dependencies で 02・03 を完成させる。

---

## OUTPUT

- 02_設計.md（責務・参照関係・テスト観点・API。体験サーフェス=あり の場合は §7 に体験設計〈3 フェーズ分または統合記録〉を含む）
- 03_実装計画.md（タスク分解・テスト仕様 BDD）
- **サブissueを 1 件以上分割した場合**: 親ワークフロー（.agent-skill-chain/runtime/{親issue}/）のルートに 90_issues.md を作成すること（**作成主体・作成手段の正本は [skills/agent/run_command.md §サブissue作成時](../skills/agent/run_command.md)**。サブは独断で起票せず、進行役承認後に issue 作成 command へ再委譲する）。

---

## DONE（DoD）

- 責務・参照関係・テスト観点が 02 に記載されている。
- タスク分解・テスト仕様（BDD）が 03 に記載されている。
- 01 の BDD と 03 のテスト観点が対応している。
- **体験サーフェス=あり の場合**: 02 §7 に体験設計（3 フェーズ分、または規模比例で統合した場合は統合記録）が記載されている。
- **体験サーフェス=なし の場合**: 判定結果（なし＋理由 1 行）が 02 §7.0 に記録されている（トリガー非該当は正常系であり工程欠落として扱わない）。
- **サブissueを 1 件以上作成（分割）した場合**: 親ワークフローのルートに 90_issues.md が存在すること。未作成のまま完了とみなさない。
- **次工程＝実装着手前の review-docs が必須**: 本 command（02/03）完了後、implement-feature 着手前に [review-docs](review-docs.md)（実装前ドキュメントレビュー）を必ず経ること（**full/standard は必須。quick モード（`mode: quick`）は免除**。正本は [skills/agent/run_command.md §Constraints](../skills/agent/run_command.md)）。

---

## 実行時の注意

- **着手前に .agent-skill-chain/source/spec/ を参照する**。spec 概要・設計原則・ディレクトリ構造方針・設計判断の優先順位（spec/00_spec概要.md, spec/01_設計原則.md, spec/02_ディレクトリ構造方針.md, spec/06_設計判断の優先順位.md）を踏まえて設計する。システムアーキテクチャで最初に考慮すべきことは spec に記載する。
- 01_要件定義を読んだうえで設計する。02 の責務は 01 の要求と整合させる。
- run_command の順序を守ること。
- **体験サーフェス=あり の場合の委譲粒度（ADR-7 委譲手順・必須）**: 標準運用（1 command 委譲＝委譲を受けた 1 サブが chain を通しで実行）のままでは step0a〜0c も同一サブが一気通貫で実行してしまう。00 の `experience_surface` が「あり」（または未記入で frame-experience が「あり」と判定する見込み）の場合、**進行役は本 command の委譲を「step0a」「step0b」「step0c」「残り chain（step1〜3）」の単位に分割し、既存 run_command の委譲 I/F（Task/Constraints/OutputSpec）でフェーズごとに別 fresh サブへ個別に委譲する**（1 サブに文脈を蓄積させない）。各委譲パケットには次を明記する:
  - **Task**: 担当 step（例: step0a）・成果物（02 §7.x）・参照（本 command・該当 `skills/experience/{phase}-experience/`・00/01・**前フェーズの確定出力 §7.x**〈step0a は無し〉）。
  - **Constraints**: 継承物（前フェーズまでの**却下済み指摘＋理由**・**must-preserve リスト**＝CLOSEOUT §fresh サブ分割の継承前提。会話文脈そのものは引き継がない）・選定ティア/effort（MODEL_SELECTION / EFFORT_POLICY に基づき明記）。
  - **OutputSpec**: 当該フェーズの Done（各 SKILL.md の Done を転記）。
  - **規模比例統合可**: 体験サーフェスが小さい場合、統合対象の工程群（例: 0a+0b+0c）を 1 委譲に畳んでよい。統合した場合は 02 §7 に「どのフェーズを統合したか」を 1 行残す。（この規模比例の考え方は本 command に限らない一般原則であり、正本は [skills/agent/run_command.md §規模比例原則](../skills/agent/run_command.md) を参照。）
  - **体験サーフェス=なし はトリガー非該当の正常系**であり、委譲分割は不要（工程欠落ではない）。
  - **00 に `experience_surface: "no: <理由>"` が明示されている場合も無検証で採用しない**: 設計フェーズで最初に委譲されるサブ（=通常は define-boundaries 担当）が、00 の値を 02 §7.0 へ**転記**した上で、体験サーフェス定義（人間が感覚器で直接体験する出力があるか。画面に限らず CLI 出力・エラー・生成 Markdown・エージェント指示文を含む）に照らして**検証**する。定型理由が実際の出力と矛盾する場合は「あり」へ倒し（fail-safe）、進行役へ差し戻して step0a から実行し直す。
- 02/03 を更新する際、frontmatter に既に document_id が存在する場合はその値を変更・上書きしてはならない。document_id は 02/03 を新規作成するときまたは初回付与時にのみ設定する。
- **完了後に書記（write-workflow-log）を実行すること（chain 実行者自身が実行する。正本は [skills/agent/run_command.md §書記（write-workflow-log）の実行主体（chain 実行者自身）](../skills/agent/run_command.md)）。** 本 command は 02 と 03 の**複数成果物**を生成・更新しうるため、**生成・更新した全成果物それぞれ**（02_設計.md・03_実装計画.md など）について、各成果物の **DOCUMENT_ID**（frontmatter の UUID）と **DOCUMENT_PATH**（プロジェクトルート相対パス）を渡して **1 回ずつ**実行すること（「1 command につき書記 1 回」の単数解釈は禁止。1 件でも漏れると audit#20 で FAIL する）。詳細は [skills/logging/write-workflow-log/SKILL.md](../skills/logging/write-workflow-log/SKILL.md) を参照。
- **重要判断は** [EVIDENCE_POLICY.md](../EVIDENCE_POLICY.md) **の ADR 形式で記録し**、フィジビリティ確認のうえ **evidence_source** を付記すること。greenfield の土台決定（アーキテクチャ・コーディング規約・ディレクトリ構成）も重要判断に含む。
- **本 command 完了後・implement-feature 委譲前に review-docs を必須で経ること（絶対強制）**: 実装着手前の実装前ドキュメントレビュー [review-docs](review-docs.md) は、design-feature 完了と implement-feature 着手の間の必須ゲートである（**full/standard は必須・quick モードは免除**。正本は [skills/agent/run_command.md §Constraints](../skills/agent/run_command.md)）。未実行のまま implement-feature へ進むと enforcement #32 で FAIL する（[enforcement/README.md](../enforcement/README.md) §失敗条件と差し戻し。**quick モードは #32 の対象外＝SKIP**）。
