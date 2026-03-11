# Skill 必須条件（Phase 単位）

**いつどの skill を呼ぶか・どの phase で mandatory か・省略時どうするか** を phase 単位で明文化する。command の skill chain は各 commands/*.md を参照。

---

## Phase 別 必須・省略条件

| Phase | 起動する command（必須） | Mandatory capabilities（省略不可） | Optional（省略可の目安） | 省略時・未実施時に残すもの |
|-------|--------------------------|-------------------------------------|---------------------------|----------------------------|
| **要求** | requirement-discovery | extract-goals, define-constraints, write-bdd | identify-assumptions（前提が自明な場合は簡略化可） | 00 に目的・受け入れ基準・参照元が記載されていること。未実施 capability は 00 に「未実施・理由」を 1 行で残す。 |
| **要件** | requirement-discovery（続き） | write-bdd | extract-goals / define-constraints（既に 00 で十分な場合は追加のみ） | 01 にユーザーストーリー・受け入れ基準・BDD シナリオが記載されていること。 |
| **設計** | design-feature | define-boundaries, design-api-contract, review-dependencies | （通常は 3 つとも実行） | 02 に責務・参照関係・テスト観点が記載されていること。spec 参照の証跡（どの spec に基づいたか）を 02 に 1 行残す。 |
| **実装計画** | design-feature または implement-feature の入口 | review-dependencies（03 にタスク・テスト観点を書くため） | define-boundaries / design-api-contract（02 が既に完了している場合） | 03 にタスク分解・テスト仕様（BDD）が記載されていること。 |
| **実装** | implement-feature | （command 内の実装 capability。テスト観点の実装は必須） | （プロジェクトで定めた optional のみ） | 成果物・コードと、02/03 で定めたテスト観点を満たした証跡。未達のテスト観点は 04 に理由を残す。 |
| **レビュー** | verify-and-close | generate-scenarios, map-coverage, review-code, **write-workflow-log** | review-architecture（変更がコードのみで境界変更なしの場合は簡略化可） | 04_review に実装内容・受け入れ基準の確認が記載されていること。**write-workflow-log は省略禁止**（CORE）。証跡は本則として **workflow.db** に残す。**memo は workflow.db を採用しない場合の過渡的・例外運用のみ**。 |

---

## 共通ルール

- **書記（write-workflow-log）**: レビュー phase の verify-and-close で**常に mandatory**。省略した場合は enforcement で差し戻し。
- **spec 参照**: 要求・設計 phase では、command 実行**前に** .agents/spec/（00, 01, 06 等）を参照すること。これは command の「実行時の注意」で強制。
- **未実施時に残すもの**: 上表の「省略時・未実施時に残すもの」を満たさないと DoD 未達。監査で確認する。

---

## 参照

- [PHASES.md](PHASES.md) — フェーズ・成果物・DoD
- [TEMPLATES.md](TEMPLATES.md) — 成果物とテンプレートの対応
- commands/requirement-discovery.md, design-feature.md, implement-feature.md, verify-and-close.md — 各 skill chain の定義
