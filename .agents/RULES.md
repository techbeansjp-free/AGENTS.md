# RULES.md — 実行・ドキュメント・テスト要約

思想は CONCEPTS に委譲。ここでは実行・ドキュメント・テストに関する要約のみを記載する。

---

### 実行モード（quick / standard / full）

軽作業にフルプロセスを回すと重いため、要求の規模に応じて次の 3 モードを**正式に**使い分ける。どのモードで何を必須とするかは下表のとおり。

| モード | 対象 | 流れ | 必須成果物・必須行為（成果物最小セット） |
|--------|------|------|----------------------------------------------------------------|
| **full** | 新規機能・大規模変更 | 要求定義からレビューまで全部 | **00→01→02→03→実装→04 の全成果物**。00_要求定義・01_要件定義・02_設計・03_実装計画・実装成果物・04_review をすべて作成。verify-and-close（監査・書記）必須。 |
| **standard** | 中規模・既存機能の拡張 | 要件整理 → 設計要点 → 実装 → 簡易レビュー | **要件要点・設計要点・実装・簡易レビュー**。01 要点・02 要点（または 02 省略可のプロジェクト則）・03 実装計画・実装・04 の簡易版または要点のみ。証跡は本則 workflow.db、memo は過渡的・例外のみ。必須。 |
| **quick** | 小修正・軽微変更・短い回答 | 必要最小限 | **設計メモと変更理由のみ**。00/01/02/03/04 のうち「変更理由が追える形」の最小セット（設計メモ 1 件以上と変更理由の記載）。証跡は最小限。 |

**段階化の要約**: quick は成果物を 00〜04 のフルセットにしない。standard は 04 を簡易版で可。full は全成果物と verify-and-close を省略しない。監査（audit.sh）は full/standard 運用を前提に 03→04 や docs 更新要否を検査する。

モード別のフェーズ適用・成果物の要否は [workflow/PHASES.md](workflow/PHASES.md) のフェーズ一覧と組み合わせて判断する。モードを省略した場合は **standard** を前提とする。

---

- **実行**: CORE / LOAD_POLICY / PHASES 読了後に開始。command 実行時は commands/{name}.md の skill chain に従う。メインは実作業をせず、サブに委譲してルールを守らせる（CORE §メインとサブの役割）。
- **ドキュメント**: 1 ファイル 1 責務。正本は 1 か所。参照は 1 行に限定。**ドキュメントはテンプレートを活用する**。各成果物（00/01/02/03/04）は所定のフォーマット・テンプレートを使う。どの command・どの capability がどのテンプレートを使うかは [workflow/TEMPLATES.md](workflow/TEMPLATES.md) に明示する。監査でテンプレート遵守を確認する。
- **監査・書記**: 各工程の完了後、クローズ前に**必ず** verify-and-close（監査・書記）を経る。監査は PHASES の監査観点（ディレクトリ構成・命名・プレフィックス・フォーマット・spec 準拠・テスト BDD インライン等）で検証する。
- **命名**: 新規 command または capability を追加するときは、**command 名と capability 名の対応・命名方針**を一度確認する。
- **契約**: 新規 command / skill は [IO_CONTRACT.md](IO_CONTRACT.md) の共通セクション（command: INPUT/PROCESS/OUTPUT/DONE、skill: Purpose/Inputs/Process/Outputs/Done/Forbidden）に従う。契約付きフィルタとして pipe 可能・検証可能にする。概念名が近い（例: commands/design-feature.md と skills/architecture/design-feature/）と混乱しうる。CONCEPTS.md §既知の注意点 2 を参照。
- **テスト**: BDD シナリオに沿った単体テストを実装計画に含める。テストファーストを推奨する。**テストコードでは、実行コードの直前に Given / When / Then をインラインコメントで必ず記載する**（.agents/TEST_BDD_FORMAT.md）。監査で確認する。

### テスト戦略必須要件

02_設計 §6 および 03_実装計画のタスク別テスト観点で次を満たすこと。詳細は [TEST_BDD_FORMAT.md](TEST_BDD_FORMAT.md) と workflow/TEMPLATES.md を参照。

- **単体**: 正常系・異常系・境界値・回帰・結合を BDD（Given/When/Then インラインコメント）で網羅。未達時は理由を記載。
- **結合/API**: エンドポイント/契約ごとに正常・異常・境界をブラックボックスで検証。
- **E2E/受け入れ**: 主要シナリオを E2E で網羅。未達時は理由を記載。
- **バリデーション**: 全バリデーションルール・境界値・エラーメッセージをテスト。
- **証跡**: memo は **.workflow/{issue}/memo/** に作成する。**{issue} は YYYYMMDD_HHMMSS_ をプレフィックスとする issue フォルダ名（必須）。** ファイル名も YYYYMMDD_HHMMSS_ プレフィックス必須。**ログは書記のみ**が記録する（CORE）。**ログは一定のルールで必ず記録する**。**ログは SQLite（workflow.db）を用いる**。workflow.db が無ければ ledger/schema.md に従い作成する。書記は scribe/README.md に従う。**日時は実行環境の現在時刻を取得して付与すること。AI は時間の概念が曖昧になりがちなため、未来・過去の日時を推測で使わない。ファイル名の日時部分（YYYYMMDD_HHMMSS_）を手入力・固定値・推測で指定してはならず、必ず `date` 等で実行時に取得する。**
- **システム仕様書（docs/）**: 作成・更新は**基本的に issue を立てない**。システム仕様書直下の**レビュー用ディレクトリ**（`docs/00_review/`）にレビュー結果（YYYYMMDD_HHMMSS_review.md）を記載する。詳細は [DOCS_RULES.md](DOCS_RULES.md) を参照。04_review §9 と verify-and-close で守る。
