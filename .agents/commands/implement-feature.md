# command: implement-feature

**本ファイルの責務**: **どの skill をどの順で実行するか**（skill chain）の定義のみ。実行手順・委譲の形は skills/agent/run_command.md に従う。各 step の手順は各 capability の README/SKILL に従う。

実装を一連の skill chain で実行する。**契約**: [IO_CONTRACT.md](../IO_CONTRACT.md) に従い INPUT / PROCESS / OUTPUT / DONE で定義する。

---

## メタデータ（phase → command 整合用）

| 項目 | 値 |
|------|-----|
| **Allowed Phase** | 実装 |
| **Required Inputs** | issue、00/01/02/03（委譲時に指定）、spec |
| **Produces** | コード・成果物、単体テスト、証跡（本則 workflow.db、memo は過渡的・例外時のみ） |
| **Next Phase** | レビュー（実装後は必ず verify-and-close を委譲する） |

---

## INPUT

- **issue**: .workflow/{issue}/ のパス。実装対象。
- **context**: 00/01/02/03 のパス。委譲時に指定された参照ファイル。
- **spec**: .agents/spec/（設計原則・命名規則等）。必要に応じて参照する。

---

## PROCESS（Skill chain・この順で実行）

1. **implement-change** — 計画に従った実装  
   `skills/implementation/implement-change/`
2. **refactor-safely** — 必要に応じた安全なリファクタ  
   `skills/implementation/refactor-safely/`

---

## 入出力の受け渡し

- implement-change で 02・03 に従い実装する。OUT はコード・成果物と変更ファイル一覧。
- refactor-safely は、実装後にリファクタが必要な場合に実行する。implement-change の成果物を IN に取り、振る舞いを変えずにリファクタする。リファクタが不要な場合は省略する（command の DONE は implement-change で満たす）。

---

## OUTPUT

- コード・成果物（03_実装計画に従う）
- 単体テスト（BDD 観点を満たす）
- 証跡（変更ファイル。本則 workflow.db、memo は過渡的・例外時のみ）
- **サブissueを 1 件以上作成した場合**: 親ワークフロー（.workflow/{親issue}/）のルートに 90_issues.md を作成すること。

---

## DONE（DoD）

- 実装計画に従い実装されている。
- 単体テスト観点を満たしている。
- 証跡が残っている（本則 workflow.db。memo 運用時は YYYYMMDD_HHMMSS_ プレフィックス）。
- **サブissueを 1 件以上作成した場合**: 親ワークフローのルートに 90_issues.md が存在すること。未作成のまま完了とみなさない。

---

## 実行時の注意

- **実装完了後は必ず verify-and-close を委譲すること。** 実装 phase の成果物がある場合、クローズ前に verify-and-close を経ずに次に進んではならない（enforcement で拒否する）。
- **完了後に書記（write-workflow-log）に依頼して記録させること。**
- **証跡・書記に渡す項目**: implement-feature 完了時は書記（write-workflow-log）に **CHANGED_FILES_JSON**（変更ファイルの JSON 配列）を渡すことが**必須**。enforcement の audit で検証する。
- Task/Constraints/OutputSpec で委譲されている場合は、指定された参照ファイル（00/01/02/03）を読んだうえで実装する。
- テストファーストを推奨。03 のテスト観点を先に満たす実装をする。

---

## クローズアウト（欠落工程の補完）

implement-feature 完了の検知で起動する不変クローズアウトの**欠落工程のみ**を補う。既存の重複工程（verify 必須・指摘 0 反復・04_review・90_issues）は**ここに再記述せず**、既存正本（[REVIEW_RULE.md](../REVIEW_RULE.md) / [run_command.md §Constraints](../skills/agent/run_command.md) / [RULES.md](../RULES.md)）へリンクで委譲する（CORE.md:137）。本節は工程の**抽象形**のみを定め、ブランチ名・CI コマンド・トレーラ等の具体値は `.agents-project/` に委ねる。

### commit ステップ

- 1 サブ issue = 1 論理コミットを基本とする。
- 既定ブランチ（main 等）上で作業している場合は feature ブランチを切ってからコミットする。
- **push はユーザーが明示したときのみ**行う（高リスク操作。[RULES.md](../RULES.md) §高リスク操作 参照）。

### 別セッション引継ぎ

- 作業を別セッションへ引き継ぐ場合は、引継ぎ記録と**再開プロンプト**（次に何をどこから始めるか）を残し、受け手が文脈を再構築できる状態にする。

### clear 境界

- **1 feature = 1 コンテキスト**を保つ。feature の区切りで /clear し、無関係な文脈を持ち越さない（safe-clear invariant: clear して安全な境界でのみ clear する）。

### fresh サブ分割

- 工程は必要に応じて fresh なサブへ分割する。分割しても**収束を保証**するため、**却下済みの指摘とその理由**を後続サブへ継承し、同じ指摘の蒸し返し・無限反復を防ぐ。

### verify-実経路検証

- verify(ii) として、変更が**実際の経路で動く**ことを検証する（机上確認だけで完了としない）。検証様式は [REVIEW_DUAL_LENS.md §3 証跡要求](../REVIEW_DUAL_LENS.md#3-証跡要求) の両リストと整合させる。

### issue 起票時のコンテキスト効率（ISSUE_CREATION）

大規模一括起票時のコンテキスト肥大を防ぐ汎用原理。具体数値・タグ運用は混入させず `.agents-project/` に委ねる。規模比例で、単一/少数 issue は [CLAUDE.md §issue 作成タスク受領時の標準フロー](../../CLAUDE.md) の軽量運用を保つ。

- **作業単位 = 1 issue**。1 issue は **fresh サブ**で扱い、issue 間で文脈を持ち越さない（issue-persist 境界）。
- **仕様 inventory は一度だけ索引化**し、各サブには必要な**スライスのみ渡す**（全文を毎回渡さない）。
- **確定した起票順序を正本化**し、親は issue 区切りで /clear する。
