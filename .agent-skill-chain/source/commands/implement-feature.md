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

- **issue**: .agent-skill-chain/runtime/{issue}/ のパス。実装対象。
- **context**: 00/01/02/03 のパス。委譲時に指定された参照ファイル。
- **spec**: .agent-skill-chain/source/spec/（設計原則・命名規則等）。必要に応じて参照する。

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
- **サブissueを 1 件以上作成した場合**: 親ワークフロー（.agent-skill-chain/runtime/{親issue}/）のルートに 90_issues.md を作成すること。

---

## DONE（DoD）

- 実装計画に従い実装されている。
- 単体テスト観点を満たしている。
- 証跡が残っている（本則 workflow.db。memo 運用時は YYYYMMDD_HHMMSS_ プレフィックス）。
- **サブissueを 1 件以上作成した場合**: 親ワークフローのルートに 90_issues.md が存在すること。未作成のまま完了とみなさない。

---

## 実行時の注意

- **実装着手の前提（絶対強制）**: 実装着手の前提として、**同一 issue の [review-docs](review-docs.md)（実装前ドキュメントレビュー）が完了していること**を要する。design-feature 完了後・本 command 委譲前に review-docs が未完了の場合は、先に review-docs を委譲すること（委譲義務の正本は [skills/agent/run_command.md §Constraints](../skills/agent/run_command.md)）。未完了のまま implement-feature ログが記録されると enforcement #32（[enforcement/README.md](../enforcement/README.md) §失敗条件と差し戻し）で FAIL する。
- **実装着手の前提（GitHub Issue 起票ゲート・デフォルト起票＋理由付き代替経路）**: review-docs 完了後・本 command 委譲前に、**対応 GitHub Issue の記録**（00_要求定義.md frontmatter の `github_issue` に実 Issue 番号、**または** 意図的に起票しない決定の理由付き記録 `"declined: <理由>"`）を要する（対象＝トップレベル issue のみ。デフォルトは起票。GitHub 非採用環境は非発火）。ゲート未通過（記録なし・理由なし declined）のまま implement-feature ログが記録されると enforcement #34（[enforcement/README.md](../enforcement/README.md) §失敗条件と差し戻し）で FAIL する。委譲義務の正本は [skills/agent/run_command.md §Constraints](../skills/agent/run_command.md)、具体手順は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../project/自己拡張ワークフロー.md) を参照。
- **実装着手の前提（ブランチ紐づけ）**: 本 command 委譲前に、**この issue の実装作業に用いる feature ブランチ名が 00_要求定義.md frontmatter の `branch` に記録されていること**を要する（空/null/未記載は不可）。未記録のまま implement-feature ログが記録されると enforcement #35（[enforcement/README.md](../enforcement/README.md) §失敗条件と差し戻し）で FAIL する。委譲義務の正本は [skills/agent/run_command.md §Constraints](../skills/agent/run_command.md)、具体手順（いつ・どの値を書くか）は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../project/自己拡張ワークフロー.md) を参照。
- **PR 化の前提（PR 紐づけ）**: 実装を PR にする際は、**PR 本文へ対応 GitHub Issue の `Closes #<番号>` または `Refs #<番号>` を含めること**（`github_issue` が `declined:` の issue は対象外）。CI（PR イベント）で enforcement #36 が検証し、紐づけが無ければ FAIL する（ローカル・push では非発火）。具体手順は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../project/自己拡張ワークフロー.md) を参照。
- **実装完了後は必ず verify-and-close を委譲すること。** 実装 phase の成果物がある場合、クローズ前に verify-and-close を経ずに次に進んではならない（enforcement で拒否する）。
- **完了後に書記（write-workflow-log）に依頼して記録させること。**
- **証跡・書記に渡す項目**: implement-feature 完了時は書記（write-workflow-log）に **CHANGED_FILES_JSON**（変更ファイルの JSON 配列）を渡すことが**必須**。enforcement の audit で検証する。
- Task/Constraints/OutputSpec で委譲されている場合は、指定された参照ファイル（00/01/02/03）を読んだうえで実装する。
- テストファーストを推奨。03 のテスト観点を先に満たす実装をする。

---

## クローズアウト（欠落工程の補完）

implement-feature 完了の検知で起動する不変クローズアウトの**欠落工程**の抽象形正本は [CLOSEOUT.md](../CLOSEOUT.md) に置く（commit ステップ／別セッション引継ぎ／clear 境界／fresh サブ分割／verify-実経路検証）。本ファイルには再記述せず、リンクで委譲する（CORE.md §境界）。具体値（ブランチ名・CI コマンド・トレーラ等）は `.agent-skill-chain/project/` に委ねる。

クローズ/起票時のフォローアップを取りこぼさない（no-drop）原則の正本は [CLOSEOUT.md §取りこぼし0と既出確認（no-drop / dedup）](../CLOSEOUT.md#取りこぼし0と既出確認no-drop--dedup) に置く。本ファイル OUTPUT/DONE の 90_issues 出力要件は no-drop の具体的帰結の一例であり、定義は再記述せずリンクで委譲する。

## issue 起票時のコンテキスト効率（ISSUE_CREATION）

大規模一括起票時のコンテキスト肥大を防ぐ汎用原理の正本は [CONTEXT_EFFICIENCY.md](../CONTEXT_EFFICIENCY.md) に置く。本ファイルには再記述せず、リンクで委譲する（CORE.md §境界）。

起票前の既出確認（dedup スキャン）の正本は [CLOSEOUT.md §取りこぼし0と既出確認（no-drop / dedup）](../CLOSEOUT.md#取りこぼし0と既出確認no-drop--dedup) に置く。本ファイルには定義を再記述せず、リンクで委譲する。
