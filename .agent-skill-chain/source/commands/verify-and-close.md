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

- **issue**: .agent-skill-chain/runtime/{issue}/ のパス。04_review の更新対象。
- **context**: 00/01/02/03/04 のパス。委譲時に指定された参照ファイル。
- **参照**: .agent-skill-chain/source/REVIEW_RULE.md、.agent-skill-chain/source/workflow/PHASES.md の監査観点。監査時には PHASES の監査観点（ユースケースに基づく全シナリオのテストコード化の網羅・フォーマットの正しさ）に従い、証跡として「01 の BDD とテスト仕様の対応」「必須フォーマットの充足」を確認すること。

**レビュー成果物の参照先**: **04_review は issue 直下で実装フェーズ完了後のレビューフェーズ（本 command 実行時）でのみ作成・更新する。** 実装前の 00/01/02/03 に対するドキュメントレビュー証跡は memo に残してよい。本 command は 04_review を作成・更新し、その内容を検証・クローズの根拠とする。正式なレビュー成果物（04_review）の配置先は 04_review のみとする。必要に応じ証跡の補足を memo に残すことも許容する。

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
- 最後に write-workflow-log で実施内容・変更ファイル・完了判定を記録する。本則は workflow.db。memo 運用時は YYYYMMDD_HHMMSS_ プレフィックス必須（専用経路で取得）。本 command が 04_review.md に加えて**複数の成果ドキュメント**（frontmatter に document_id を持つ 00/01/02/03/04 等）を作成・更新した場合は、**生成・更新した全成果物それぞれ**について各成果物の **DOCUMENT_ID** と **DOCUMENT_PATH**（ルート相対）を渡して書記に **1 回ずつ**記録させること（「1 command につき書記 1 回」の単数解釈は禁止。1 件でも漏れると audit#20 で FAIL する）。詳細は [skills/logging/write-workflow-log/SKILL.md](../skills/logging/write-workflow-log/SKILL.md) を参照。

---

## OUTPUT

- **04_review.md**（実装内容の確認・受け入れ基準の確認・設計の確認・レビュー結果）— **必ず issue 直下にファイルとして作成する（絶対強制）。** 本 command を実行したら、issue 直下に 04_review.md が存在しなければならない。memo にレビューを書いて 04 を省略することは**禁止**とする。
- 証跡（本則 workflow.db、memo は過渡的・例外時のみ。CONTRACT 準拠）

---

## DONE（DoD）

- **issue 直下に 04_review.md ファイルが存在すること（必須・絶対強制）。** 存在しない場合は未完了とする。作成しないで verify-and-close を完了とみなしてはならない。
- 04_review に実装内容・受け入れ基準の確認が記載されている。
- 証跡が規約に従って記録されている（workflow.db 本則。memo 運用時はプレフィックス・書記の形式）。
- PHASES の監査観点を満たしている（全シナリオのテストコード化の網羅・フォーマットの正しさを含む）。REVIEW_RULE のチェックリストで検証可能であること。
- サブissueを 1 件以上作成した場合、親ワークフロールートに 90_issues.md が存在すること。
- run_command の Constraints と本 command の DoD が整合していること。

---

## 実行時の注意

- **04_review 作成と書記は一組**: 本 command（verify-and-close）を実行した場合、**04_review.md の作成・更新と step 5（write-workflow-log）の実行を必ずセットで行うこと**。04_review.md のみ作成・更新し、write-workflow-log（書記）を実行せずに完了とみなすことは**禁止**であり、その場合は本 command は**未完了**と扱う。workflow.db に verify-and-close の書記ログが存在しない 04_review 更新は、enforcement 失敗条件 #5・#9 に該当し CI/audit で FAIL とする。
- **04_review.md の作成は省略禁止（絶対強制）。** 本 command（verify-and-close）を実行したら、**必ず** issue 直下に 04_review.md を**作成**する。memo のみでレビュー証跡を残し 04 を省略することは**禁止**。enforcement 失敗条件 #3 で検出し reject する。
- **実装成果物にテストが含まれる場合は、04_review を作成・更新する前にテストを再実行し、実行結果（成功/失敗・ログ参照先）を 04_review に記載すること。** テスト未実行のまま監査完了とみなしてはならない。
- **実装 phase の成果物（コード・02/03 に基づく変更）が存在する場合、クローズまたは次 Task への遷移の前に必ず本 command（verify-and-close）を委譲すること。** 実装のみでレビューを飛ばす経路は禁止。enforcement で 04_review 未更新のままの close 相当の遷移を拒否する。
- 04_review のテンプレート（.agent-skill-chain/runtime/templates または親 04）に従う。基準ごと・シナリオごとに「検証方法・結果」を書く。
- **skill chain を最後まで実行すること。** step 5（write-workflow-log）を省略しない。workflow.db 採用時は write-workflow-log.sh を実行すること（run_command の Constraints 参照）。CORE の証跡省略禁止を守る。
- **システム仕様書（docs/）の更新**: 必要に応じて加筆修正するが、**そのために issue を立てる必要はない**。レビュー用ディレクトリ `docs/00_review/` にレビュー結果を記載する。.agent-skill-chain/source/RULES.md（システム仕様書）および .agent-skill-chain/source/DOCS_RULES.md を参照。
- **重要判断・レビュー結論には根拠の種別（evidence_source）を記載し、inference_only のみに依存する重要判断は承認不可または要人間確認とする。** .agents の「外部根拠の必須化」（CONCEPTS.md §外部根拠の必須化）を参照。

---

## クローズアウト（欠落工程の補完）

クローズ前に、実装完了で起動する不変クローズアウトの**欠落工程**が満たされているかを確認する。既存の重複工程（verify 必須・指摘 0 反復・04_review・90_issues）は**ここに再記述せず**、既存正本（[REVIEW_RULE.md](../REVIEW_RULE.md) / [run_command.md §Constraints](../skills/agent/run_command.md) / [RULES.md](../RULES.md)）へリンクで委譲する（CORE.md §境界）。工程の抽象形の正本は [CLOSEOUT.md](../CLOSEOUT.md) に置く。

確認する欠落工程（抽象形・詳細は上記正本）:

- **commit ステップ**: 1 サブ issue = 1 論理コミット／既定ブランチなら feature ブランチ／**push はユーザー明示時のみ**（[RULES.md](../RULES.md) §高リスク操作）。
- **別セッション引継ぎ**: 引継ぎ記録＋再開プロンプトを残したか。
- **clear 境界**: 1 feature = 1 コンテキスト（safe-clear invariant）を保ったか。
- **fresh サブ分割**: 却下済み指摘＋理由を継承し収束を保証したか。
- **verify-実経路検証**: verify(ii) として実経路で動くことを検証し、[REVIEW_DUAL_LENS.md §3 証跡要求](../REVIEW_DUAL_LENS.md#3-証跡要求) の両リストと整合させたか。
