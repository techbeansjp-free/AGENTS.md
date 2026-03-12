# REVIEW_RULE — レビュー実施時の必須参照と観点

04_review を実施するときの**必須参照**と**監査観点**をまとめる。レビュー深度は **quick / standard / full** のいずれか。変更規模（小修正→quick、中規模→standard、新規・大規模→full）に応じて [RULES.md §実行モード](RULES.md) で選択すること。

---

## レビュー成果物の配置（必須）

- **ドキュメントレビュー**の成果物は **issue フォルダ直下に 04_review（04_review.md 等）を直接作成**する。
- **memo にレビューを書かない**。「memo にレビューを書く」という指示・振る舞いは禁止する。memo はレビュー以外のメモ・証跡用とする。

---

## 必須参照（.agents の正本）

| 参照先 | 内容 |
|--------|------|
| .agents/boot/CORE.md | 読了義務・証跡省略禁止・ログは書記のみ・メインは直接実作業しない |
| .agents/boot/LOAD_POLICY.md | いつ何を読むか |
| .agents/workflow/PHASES.md | フェーズ・成果物・DoD・監査観点 |
| .agents/workflow/TEMPLATES.md | 成果物のフォーマット・必須セクション |
| .agents/RULES.md | 実行・ドキュメント・テスト・証跡・監査・書記 |
| .agents/IO_CONTRACT.md | command / skill の入出力契約（INPUT/PROCESS/OUTPUT/DONE、Purpose/Inputs/Process/Outputs/Done/Forbidden） |
| .agents/agents/auditor.md | 監査の責務・検証項目 |
| .agents/skills/review/ | review-code（実装・規約・テスト BDD インライン・ディレクトリ・命名・spec 準拠）、review-architecture（設計・境界） |
| .agents/TEST_BDD_FORMAT.md | テストコードの Given / When / Then インラインコメント必須 |
| .agents/spec/ | 設計原則・ディレクトリ構造・命名規則・設計判断の優先順位（監査で spec 準拠を確認する） |

---

## 監査で検証する項目（PHASES §監査観点）

- 各フェーズの成果物がテンプレートの必須セクションを満たしていること。
- 各工程で監査・書記に依頼していること。レビュー・クローズ前に verify-and-close を経ていること。
- 証跡（memo・ログ）が YYYYMMDD_HHMMSS_ プレフィックス等の規約に従っていること。**memo プレフィックスは専用経路のみで取得すること**（TZ=Asia/Tokyo date +%Y%m%d_%H%M%S の実行、または .agents/scripts/memo-prefix.sh の実行）。**手入力・固定値・AI の推測は違反とする。**
- command 実行が commands/{name}.md の skill chain に従っていること。
- **ディレクトリ構成・ファイルの作成場所・命名規則（spec/03）・プレフィックス（memo の YYYYMMDD_HHMMSS_ は実行環境現在時刻 JST 取得であること）・フォーマット・spec 準拠（設計原則・UNIX 哲学等）**。
- **テストコードに Given / When / Then のインラインコメントが付いていること**（.agents/TEST_BDD_FORMAT.md）。

---

## レビュー実施時の必須行動

- 関連するテストやコードだけでなく、**プロジェクト全体のすべてのテストやコードを徹底的に調査する**こと。
- 上記の必須参照を読んだうえで、04_review の各セクション（実装内容の確認・受け入れ基準の確認・設計の確認・レビュー結果）を記載すること。
- **重要判断には evidence_source を記載し、外部根拠を少なくとも 1 つは含めること。**

---

## 参照

| 参照先 | 内容 |
|--------|------|
| .agents/commands/verify-and-close.md | 検証・クローズ command |
| .agents/enforcement/README.md | 強制・監査の正本 |
