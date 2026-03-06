# CLAUDE.md

> Cursor / Claude Code がリポジトリで作業する際のガイドとして参照されます。
> **責務**: **CLAUDE.md = Claude Code 利用者向けの入口・導線・セットアップ説明**。実行時の差分仕様は [.agents/platforms/claude_code.md](.agents/platforms/claude_code.md) に集約する（root は入口、platforms は実行差分に固定）。**定義しない**: ツール・委譲の表現・注意点等の実行差分（claude_code.md で定義）。

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 応答言語

常に**日本語**で応答する。コードレビュー、チャット、Issue 作成・更新、コメントすべて日本語。

## Agent 動作（「agentsに従って」の意味）

**「agentsに従って」「AGENTS に従って」等の指示は、以下を含む**：

- **実行前契約（強制）**: 次の 4 ファイルを**読了するまで**、ワークフロー開始・フェーズ進行・コード変更・委譲・成果物作成を**行ってはならない**。未読のまま行ったアクションは規約上無効とする。
  1. `.agents/boot/CORE.md`
  2. `.agents/boot/LOAD_POLICY.md`
  3. `.agents/WORKFLOW.md`
  4. `.agents/CONCEPTS.md`
  読了したうえで着手し、着手時は応答冒頭で短く確認すること（例: `🧠 Mode: SILENT MODE` の次に「CORE/LOAD_POLICY/WORKFLOW/CONCEPTS に従い、…」と 1 行）。ユーザーが「規約は読んだ前提で」と明示した場合のみ省略可。
- **サブエージェント運用（MVP）**: 上記読了後、フェーズごとに workers に Task/Constraints/OutputSpec で委譲する。**各サブ実行後に書記へログを委譲する（トレーサビリティ必須）**。詳細は AGENTS.md を参照。
- AGENTS 規約（ワークフロー・フェーズ・ドキュメント同期等）に従うこと
- **応答形式は常に SILENT MODE とすること**（ユーザーが「詳細を説明して」「全文を見せて」等と明示した場合を除く）
  - 会話への出力は**最大15行**
  - 応答の**先頭に `🧠 Mode: SILENT MODE` を必ず付与**
  - 詳細・思考過程は会話に書かず、`.workflow/` や `memo/` に書く

→ 「agentsに従って」だけで、上記実行前契約＋SILENT MODE が適用される。

---

## プロジェクト概要（各リポジトリで記入）

- プロジェクト名・目的
- 技術スタック（言語、フレームワーク、DB 等）
- ディレクトリ構成の概要

## ランタイム・ビルド（必要に応じて記入）

- 使用する Node.js / Python / その他のバージョンと確認方法
- 開発サーバー・ビルド・テスト・リント等の代表コマンド

## 開発ワークフロー規約

`AGENTS.md` および `.agents/` 配下のルールはすべて **AI に伝えるためのもの**である。

**重要**: すべての対応は `.workflow/{YYYYMMDD_HHMMSS_issue名}/` 配下のドキュメントから始める。

必須フェーズ（飛ばし禁止）:

1. `00_要求定義.md` → 2. `01_要件定義.md` → 3. `02_設計.md` → 4. `03_実装計画.md` → 5. **4.5 ドキュメント徹底レビュー**（必須）→ 6. 実装 → 7. `04_review.md`

**抜かさない運用**: 各フェーズは「固定ゲート」とし、提出物が揃うまで完了扱いにしない。完了の定義（DoD）は証跡ベースで固定。詳細は `.agents/WORKFLOW.md` を参照。

関連規約ファイル:

- `AGENTS.md` - 開発規約（完全版）。冒頭に「サブエージェント運用（MVP）」を記載
- `.agents/boot/CORE.md` - 絶対制約・入口（サブエージェント運用時は最初に読む）
- `.agents/boot/LOAD_POLICY.md` - いつ何を読むか・フェーズ→worker
- `.agents/RULES.md` - 実行・ドキュメント・テスト・レビュー（統合）
- `.agents/scribe/書記役とログ委譲.md` - ログは書記のみ・トレーサビリティ必須
- `.agents/workers/README.md` - 6 人格の IN/OUT
- `.agents/ledger/README.md` - ログ保存（workflow.db）
- `.agents/WORKFLOW.md` - 工程の固定ゲート・提出物義務化・DoD（抜かさない運用）
- `.agents/CONCEPTS.md` - 思想・観点・哲学
- `.agents/RULES.md` - 実行・ドキュメント・テスト・レビュー（SILENT MODE・レビュー時は RULES のレビュー節を参照）
- その他、`.agents/` 配下（構成は `.agents/README.md` 参照）。詳細は .agents/ 配下の該当ファイルで足りる。必要時は .review/ を参照。

## 重要な規約（各リポジトリで追記）

- **会話出力（最優先）**: **常に SILENT MODE**。会話への出力は**最大15行**まで。詳細は `.workflow/` や `memo/` に書く。先頭に `🧠 Mode: SILENT MODE` を付与。詳細は `.agents/RULES.md` 参照。
- **プロジェクト固有の規約**: 命名規則・型安全性・テスト配置・デザイン基盤等は **`.agents-project/`** 配下にファイルで追加する（`.agents/` より優先）。CLAUDE.md には概要のみ列挙してよい。

## その他（任意）

- CI/CD、環境変数、デプロイ手順など、プロジェクトで必要な項目を追記する。
