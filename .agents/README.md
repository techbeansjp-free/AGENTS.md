# .agents ディレクトリ構成

> プロジェクトに **AGENTS-spec をコピーしたらすぐ使える** ように、役割別にサブディレクトリで整理している。

---

## ディレクトリ構成（正規形）

```text
.agents/
├── README.md                    # 本ファイル（構成説明・コピー手順）
├── boot/                        # 入口（メインが最初に読む）
│   ├── CORE.md                  # 絶対制約・SILENT MODE・委譲・トレーサビリティ
│   ├── LOAD_POLICY.md           # いつ何を読むか・フェーズ→worker
│   ├── TOOLS.md                 # 使えるツール要約
│   ├── EXECUTION_CONTRACT.md    # 委譲の入出力（Task/Constraints/OutputSpec）
│   ├── MEMORY_POLICY.md         # 記憶 2 層（raw/curated）・サニタイズ
│   ├── SUBAGENT_MINIMUM.md      # サブ最小読込保証（サブのコンテキストに必ず含める）
│   └── SUBAGENT_PACK.md         # サブに渡す固定パック（注入順序）
├── workers/                     # 6 人格の定義（IN/OUT）
│   ├── README.md                # 一覧・フェーズ→worker 概要
│   └── 01_要件BDDリード.md 〜 06_書記.md
├── capabilities/                # 権限境界（誰が何を書けるか）
│   └── POLICY.md                # 書記以外の logs/・DB 書込禁止
├── ledger/                      # ログ保存（workflow.db）
│   ├── README.md                # 配置・.gitignore 条件
│   ├── schema.sql               # DDL
│   └── ワークフローログ_SQLiteスキーマ.md  # 必須項目・ペイロード仕様
├── skills/                      # 委譲・ドキュメント等のスキル
│   └── agent/
│       └── delegate_to_sub.md   # Task/Constraints/OutputSpec の組み立て
├── rules/                       # 条件付き参照ルール（必要時のみ読む）
│   ├── 実行ルール.md            # ハード制約・フェーズ・SILENT MODE
│   ├── サブエージェント抜かし防止.md
│   ├── レビュールール.md
│   ├── コーディングルール.md
│   ├── ドキュメントルール.md
│   ├── テストガイドライン.md
│   ├── Mermaid図ルール.md
│   ├── Storybookルール.md
│   ├── GitHub_Copilot対応.md
│   ├── GitHub_CodeRabbit対応.md
│   └── GitHub_PR指摘取得.md
├── scribe/                      # 書記・ログ委譲（トレーサビリティ）
│   ├── 書記役とログ委譲.md
│   └── CONTRACT.md              # 書記が受け取るログのスキーマ（親→書記で固定）
├── enforcement/                 # ルールが破れない仕組み（Claude/Cursor 別）
│   ├── README.md
│   ├── claude/                  # PreToolUse Write ガード仕様
│   │   └── pretooluse_write_guard.md
│   └── cursor/                  # 入口一本化・役割制約
│       └── README.md
├── prompts/                     # 初期化・Issue 実行用プロンプト
│   ├── 初期化プロンプト.md
│   └── Issue実行テンプレート.md
├── guide/                       # 運用ガイド
│   └── サイレントモードガイド.md
├── platform/                    # Claude / Cursor 向け設定
│   └── CLAUDE_サブエージェントとMCPおよびエージェントチーム.md
├── reference/                   # 設計メモ・図解（参照用）
│   ├── README.md
│   └── DESIGN_NOTES.md          # 落とし穴・記憶・メイン/サブ境界の図
└── human/                       # 人間向け（AI は参照しない）
    ├── 人間向け_開発規約.md
    └── 人間向け_実装原則.md
```

---

## プロジェクトへのコピー（すぐ使える状態にする）

**方法 A（推奨・コピペするだけ）**: AGENTS-spec フォルダをプロジェクトにコピーし、ルートに入口ファイルを 1 つ置く。

1. **AGENTS-spec フォルダをプロジェクトルートにコピーする**（中に `.agents/` と `.workflow/templates/` が含まれた状態）。
2. **`AGENTS-spec/COPY_TO_PROJECT_ROOT_AGENTS.md` をプロジェクトルートに `AGENTS.md` としてコピーする。**
3. プロジェクトルートの `.workflow/` に issue 用ディレクトリを作成する。テンプレートは `AGENTS-spec/.workflow/templates/` を参照する。
4. **workflow.db を使う場合**: プロジェクトの `.gitignore` に `workflow.db` を追加する。

**方法 B（中身をルートに展開）**: 規約の中身だけをプロジェクトルートに展開する。

1. **AGENTS-spec の `.agents/` をそのままプロジェクトルートの `.agents/` にコピーする。**
2. **ルートに `AGENTS.md` と `CLAUDE.md` を置く**（AGENTS-spec のものをコピーまたは参照）。
3. **`.agents-project/`** を用意する場合、プロジェクト固有ルールのみ置く。`.agents-project/` は `.agents/` より優先される（AGENTS.md の規約どおり）。
4. **workflow.db を使う場合**: プロジェクトの `.gitignore` に `workflow.db` を追加する（[ledger/README.md](./ledger/README.md)、[workers/README.md](./workers/README.md) 参照）。
5. **テンプレート**: `.workflow/templates/` は AGENTS-spec の `.workflow/templates/` をコピーして使用する。

---

## 参照の起点

- **メインの入口**: [boot/CORE.md](./boot/CORE.md) と [boot/LOAD_POLICY.md](./boot/LOAD_POLICY.md) を最初に読む。
- **委譲**: [boot/EXECUTION_CONTRACT.md](./boot/EXECUTION_CONTRACT.md)、[skills/agent/delegate_to_sub.md](./skills/agent/delegate_to_sub.md)、[workers/README.md](./workers/README.md)。
- **トレーサビリティ**: [scribe/書記役とログ委譲.md](./scribe/書記役とログ委譲.md)、[ledger/README.md](./ledger/README.md)。
- **ハード制約・フェーズ**: [rules/実行ルール.md](./rules/実行ルール.md)。

すべての参照パスは **この構成を前提とした相対パス** で記載している。コピー後はパス変更不要。
