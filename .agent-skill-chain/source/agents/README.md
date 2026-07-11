# agents — オーケストレーションと役割の最小定義

**責務**: どの phase でどの **command** を起動するか。**誰が command を実行し、誰が監査し、誰が記録するか**を最小定義で示す。メイン（進行役）は指示に徹し、実作業は行わない。

**境界**: 本 README は**一覧・対応表のみ**。個別 md（orchestrator.md, auditor.md, scribe.md）は **Role / Owns / Inputs / Outputs** に限定し、説明を README に寄せすぎない。重複を避ける。

---

## 役割の最小定義（誰が何をするか）

| 役割 | 定義ファイル | 責務の要約 |
|------|--------------|------------|
| **orchestrator**（進行役） | [orchestrator.md](orchestrator.md) | phase 判定・command 指定・委譲のみ。実作業はしない。 |
| **worker**（command 実行側） | [worker.md](worker.md) | 委譲された command の skill chain を順に実行。実装・設計・レビュー・証跡を出力。 |
| **auditor**（監査） | [auditor.md](auditor.md) | DoD・証跡・規約遵守の確認。verify-and-close と enforcement/ci で実行。 |
| **scribe**（書記） | [scribe.md](scribe.md) | 証跡・ログの記録。write-workflow-log capability を実行。 |

command を**実行する**のは **worker**（orchestrator が run_command で委譲した先）。worker は commands/{name}.md の skill chain に従う。

---

## フェーズ → command（必須）

フェーズに応じた command の選択は **[PHASE_COMMAND_MAP.md](../workflow/PHASE_COMMAND_MAP.md) を単一の正本**として参照する。推測や独自判断で command を決めてはならない。

| フェーズ | 起動する command |
|----------|------------------|
| 要求・要件 | requirement-discovery |
| 設計・実装計画 | design-feature |
| 実装 | implement-feature |
| レビュー・クローズ | verify-and-close |

---

## 運用

- 進行役は [orchestrator.md](orchestrator.md) に従い、実作業をせず command を指定して委譲する。委譲の形は skills/agent/run_command.md に従う。
- テンプレートの使用は workflow/TEMPLATES.md に従わせる。ルールは CORE / LOAD_POLICY / PHASES を委譲時の Constraints で参照させる。
