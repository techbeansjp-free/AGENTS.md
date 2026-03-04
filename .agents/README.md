# .agents ディレクトリ構成

> プロジェクトに **AGENTS-spec をコピーしたらすぐ使える** ように、役割別にサブディレクトリで整理している。

---

## エージェント関係とワークフロー（図）

### エージェントの関係

メイン（進行役）が CORE / LOAD_POLICY に従い、フェーズごとに 6 人格のいずれかに **delegate_to_sub** で委譲する。各サブ実行後は必ず書記にログ項目を委譲し、書記のみが **workflow.db** に記録する（.workflow/\*\*/logs/ は廃止）。

```mermaid
flowchart LR
    subgraph main["メイン（進行役）"]
        M["CORE / LOAD_POLICY を読む\n委譲の判定・完了受領・次フェーズ判定"]
    end
    subgraph workers["6 人格（workers）"]
        W1["01 要件BDDリード"]
        W2["02 総合レビューリード"]
        W3["03 実装者"]
        W4["04 テスト者"]
        W5["05 監査者"]
        W6["06 書記"]
    end
    DB[(workflow.db)]
    M -->|"delegate_to_sub\nTask/Constraints/OutputSpec"| W1
    M -->|"同上"| W2
    M -->|"同上"| W3
    M -->|"同上"| W4
    M -->|"同上"| W5
    M -->|"ログ項目を委譲\n（各サブ実行後）"| W6
    W1 -->|"成果物"| M
    W2 -->|"GO/NG・指摘"| M
    W3 -->|"実装成果物"| M
    W4 -->|"テスト結果"| M
    W5 -->|"監査結果"| M
    W6 -->|"記録済み"| M
    W6 -->|"唯一の書込先"| DB
```

- **委譲の入口**: [delegate_to_sub](../skills/agent/delegate_to_sub.md) のみ。直接呼び出し禁止。
- **フェーズ→worker 対応**: [LOAD_POLICY 4](../boot/LOAD_POLICY.md) および [workers/README](../workers/README.md) を参照。

### フェーズの状態遷移（システム開発の進め方）

各フェーズは順次進行し、**前フェーズの完了条件を満たすまで次に進まない**。00 は既存プロジェクト導入時のみ。4.5 は必須。05・08 は条件付き。

```mermaid
stateDiagram-v2
    [*] --> 00_システム理解: 既存導入時のみ
    00_システム理解 --> 01_要求定義
    [*] --> 01_要求定義: 新規
    01_要求定義 --> 02_要件定義
    02_要件定義 --> 03_設計
    03_設計 --> 04_実装計画
    04_実装計画 --> 4.5_ドキュメントレビュー
    4.5_ドキュメントレビュー --> 05_Issue作成: タスク分割する場合
    4.5_ドキュメントレビュー --> 06_実装: 分割しない
    05_Issue作成 --> 06_実装
    06_実装 --> 07_レビュー
    07_レビュー --> 08_最終確認: 外部設定あり
    07_レビュー --> [*]: 完了
    08_最終確認 --> [*]
```

| フェーズ                     | 必須成果物                              | 主な委譲先                    |
| ---------------------------- | --------------------------------------- | ----------------------------- |
| 00 システム理解              | 00\_システム理解.md                     | （メインまたは要件BDDリード） |
| 01 要求定義                  | 00\_要求定義.md                         | 要件BDDリード                 |
| 02 要件定義                  | 01\_要件定義.md                         | 要件BDDリード                 |
| 03 設計                      | 02\_設計.md                             | 要件BDDリード・実装者         |
| 04 実装計画                  | 03\_実装計画.md                         | 実装者・テスト者→監査者       |
| 4.5 ドキュメント徹底レビュー | memo（レビュー結果・指摘ゼロで3回以上） | メインが実施                  |
| 05 Issue作成                 | 90_issues.md 等                         | （タスク分割時のみ）          |
| 06 実装                      | 実装成果物・テスト通過                  | 実装者・テスト者              |
| 07 レビュー                  | 04_review.md                            | 総合レビューリード・監査者    |
| 08 最終確認                  | 05\_最終確認チェックリスト.md           | 外部設定が必要な場合のみ      |

詳細は [ワークフローとフェーズ定義](rules/ワークフローとフェーズ定義.md) を参照。

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
│   └── POLICY.md                # 書記以外の workflow.db 書込禁止。書記は workflow.db のみ（logs/ 廃止）
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
