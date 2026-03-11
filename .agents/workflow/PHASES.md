# PHASES.md — フェーズ順・成果物・DoD

フェーズは**状態 gate**。どの phase でどの **command**（skill chain）を起動するかは commands/ と本表、および [PHASE_COMMAND_MAP.md](PHASE_COMMAND_MAP.md) で対応させる。監査観点は簡潔に。**モード別の適用は [RULES.md](../RULES.md) の実行モードを参照。**

---

## フェーズ一覧

| フェーズ | 起動する command（必須） | 必須成果物 | DoD（完了定義） |
|----------|--------------------------|------------|------------------|
| 要求 | requirement-discovery | 00_要求定義.md | 目的・受け入れ基準・参照元が記載されている |
| 要件 | requirement-discovery（続き） | 01_要件定義.md | ユーザーストーリー・受け入れ基準・BDD シナリオが記載されている |
| 設計 | design-feature | 02_設計.md | 責務・参照関係・テスト観点が記載されている |
| 実装計画 | design-feature または implement-feature の入口 | 03_実装計画.md | タスク分解・テスト仕様（BDD）が記載されている |
| 実装 | implement-feature | 成果物・コード等 | 実装計画に従い実装され、単体テスト観点を満たす |
| レビュー | verify-and-close | 04_review.md | 実装内容・受け入れ基準の確認が記載されている |

---

## 監査観点

- 各フェーズの成果物が**テンプレート**の必須セクションを満たしていること。
- **各工程で監査・書記に依頼する**。レビュー・クローズ前に必ず verify-and-close（監査・書記）を経ること。
- 証跡（memo・ログ）が YYYYMMDD_HHMMSS_ プレフィックス等の規約に従っていること。**プレフィックスは実行環境の現在時刻（JST）を取得して付与すること。推測・固定日時は禁止。** ログは一定のルールで必ず記録すること。
- command 実行は commands/{name}.md の skill chain に従っていること。
- **監査で検証する項目**: ディレクトリ構成・ファイルの作成場所・命名規則（spec/03）・**プレフィックス**（memo の YYYYMMDD_HHMMSS_ は実行環境現在時刻 JST 取得。推測禁止）・フォーマット（TEMPLATES）・spec 準拠（設計原則・UNIX 哲学等）。テストコードは Given / When / Then をインラインコメントで記載していること（.agents/TEST_BDD_FORMAT.md）。

---

フェーズ→command の対応は commands/ 配下のファイル名と上表に加え、[PHASE_COMMAND_MAP.md](PHASE_COMMAND_MAP.md) を**単一の正本**として把握する。オーケストレーションは agents/README.md を参照する。

**Phase 別の skill 必須条件**（どの phase でどの capability が mandatory か・省略時どうするか）は [SKILL_MANDATORY.md](SKILL_MANDATORY.md) を参照する。
