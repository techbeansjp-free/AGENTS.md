# command: verify-and-close

**本ファイルの責務**: **どの skill をどの順で実行するか**（skill chain）の定義のみ。実行手順・委譲の形は skills/agent/run_command.md に従う。各 step の手順は各 capability の README/SKILL に従う。

検証・レビュー・クローズを一連の skill chain で実行する。**契約**: [IO_CONTRACT.md](../IO_CONTRACT.md) に従い INPUT / PROCESS / OUTPUT / DONE で定義する。

---

## メタデータ（phase → command 整合用）

| 項目 | 値 |
|------|-----|
| **Allowed Phase** | レビュー |
| **Required Inputs** | issue、00/01/02/03/04、REVIEW_RULE、PHASES 監査観点 |
| **Produces** | 04_review.md、証跡（本則 workflow.db、memo は過渡的・例外時のみ） |
| **Next Phase** | close（本 command 完了後、phase を閉じる） |

---

## INPUT

- **issue**: .workflow/{issue}/ のパス。04_review の更新対象。
- **context**: 00/01/02/03/04 のパス。委譲時に指定された参照ファイル。
- **参照**: .agents/REVIEW_RULE.md、.agents/workflow/PHASES.md の監査観点。監査時には PHASES の監査観点（ユースケースに基づく全シナリオのテストコード化の網羅・フォーマットの正しさ）に従い、証跡として「01 の BDD とテスト仕様の対応」「必須フォーマットの充足」を確認すること。

**レビュー成果物の参照先**: レビュー成果物は、**本 command（verify-and-close）をレビューフェーズで実行するときに** issue フォルダ直下の 04_review に作成・更新する。（00/01/02/03 に対するドキュメントレビューの結果および実装成果物の確認を含む。）本 command は 04_review を作成・更新し、その内容を検証・クローズの根拠とする。**memo はレビュー成果物の配置先として参照しない。**

---

## PROCESS（Skill chain・この順で実行）

1. **generate-scenarios** — テストシナリオ・観点の整理  
   `skills/testing/generate-scenarios/`
2. **map-coverage** — カバレッジ・受け入れ基準の対応確認  
   `skills/testing/map-coverage/`
3. **review-code** — コードレビュー  
   `skills/review/review-code/`
4. **review-architecture** — 設計・境界のレビュー  
   `skills/review/review-architecture/`
5. **write-workflow-log** — 書記・ログ記録  
   `skills/logging/write-workflow-log/`

---

## 入出力の受け渡し

- **レビュー成果物は issue 直下の 04_review を参照・更新する。** 検証・クローズ時に参照するレビュー成果物の配置先は 04_review のみとする（memo は参照しない）。
- generate-scenarios の OUT（シナリオ・観点一覧）→ map-coverage の IN。
- map-coverage の OUT（カバレッジ表・未達一覧）→ 04_review に反映。review-code / review-architecture でも参照する。
- review-code と review-architecture の OUT を 04_review にまとめる。
- 最後に write-workflow-log で実施内容・変更ファイル・完了判定を記録する。本則は workflow.db。memo 運用時は YYYYMMDD_HHMMSS_ プレフィックス必須（専用経路で取得）。

---

## OUTPUT

- 04_review.md（実装内容の確認・受け入れ基準の確認・設計の確認・レビュー結果）
- 証跡（本則 workflow.db、memo は過渡的・例外時のみ。CONTRACT 準拠）

---

## DONE（DoD）

- 04_review に実装内容・受け入れ基準の確認が記載されている。
- 証跡が規約に従って記録されている（workflow.db 本則。memo 運用時はプレフィックス・書記の形式）。
- PHASES の監査観点を満たしている（全シナリオのテストコード化の網羅・フォーマットの正しさを含む）。REVIEW_RULE のチェックリストで検証可能であること。

---

## 実行時の注意

- **実装 phase の成果物（コード・02/03 に基づく変更）が存在する場合、クローズまたは次 Task への遷移の前に必ず本 command（verify-and-close）を委譲すること。** 実装のみでレビューを飛ばす経路は禁止。enforcement で 04_review 未更新のままの close 相当の遷移を拒否する。
- 04_review のテンプレート（.workflow/templates または親 04）に従う。基準ごと・シナリオごとに「検証方法・結果」を書く。
- write-workflow-log を省略しない。CORE の証跡省略禁止を守る。
- **システム仕様書（docs/）の更新**: 必要に応じて加筆修正するが、**そのために issue を立てる必要はない**。レビュー用ディレクトリ `docs/00_review/` にレビュー結果を記載する。.agents/RULES.md（システム仕様書）および .agents/DOCS_RULES.md を参照。
- **重要判断・レビュー結論には根拠の種別（evidence_source）を記載し、inference_only のみに依存する重要判断は承認不可または要人間確認とする。** .agents の「外部根拠の必須化」（CONCEPTS.md §外部根拠の必須化）を参照。
