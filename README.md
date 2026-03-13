# AGENTS-spec — AI 実行契約・ワークフロー仕様

LLM エージェント（AI）と人間が協働するための**実行契約・能力（skills）中心のワークフロー**を定義する仕様パッケージ。プロジェクトにコピーして、AI に「.agents に従って」と指示すると、フェーズ（要求→要件→設計→実装計画→実装→レビュー）に沿って動く。

**メタレイヤー**: 本仕様で定義する orchestrator / worker 等は「プロジェクト内で動くエージェント」の振る舞いである。これら仕様ファイルを編集するアシスタント（Cursor 等）は別レイヤー。**基盤の自己肥大化防止**（Feature First・文書追加前の統合検討・一時文書の寿命・責務境界・監視指標）も [.agents/META_LAYER.md](.agents/META_LAYER.md) で定義する。

---

## 何がどこに置かれるか

- **プロジェクトルートに置くもの（その他・今まで通り）**: `AGENTS.md`, `CLAUDE.md`。入口として 1 ファイルずつ。AI はここから .agents を参照する。
- **.agents-project/**（プロジェクト固有・**最優先**）: プロジェクトごとの固有ルールを置く。**.agents-project が .agents より優先**される。同名・同目的のルールは .agents-project を採用。setup では作成しない。プロジェクト側で必要に応じて用意する。
- **.agents ディレクトリ配下に置くもの**: 実行契約・能力・ワークフロー・強制の正本。**正本は本パッケージの `AGENTS-spec/.agents/` にあり、セットアップでプロジェクトの `.agents/` にコピーする。**

---

## .agents 配下の構成（正本: AGENTS-spec/.agents/）

| 配置 | 内容 |
|------|------|
| **SETUP.md** | コピー対象・セットアップ・スモークテスト |
| **META_LAYER.md** | 基盤の肥大化防止・文書追加前の統合検討 |
| **CONCEPTS.md** | 思想・判断の問い |
| **GETTING_STARTED.md** | 使い方（メイン・サブの役割、1 issue の回し方） |
| **README.md** | 構成と索引（何を知りたいときに何を読むか） |
| **RULES.md** | 実行・ドキュメント・テスト要約 |
| **boot/** | CORE.md（絶対制約）、LOAD_POLICY.md（いつ何を読むか） |
| **workflow/** | PHASES.md（フェーズ・DoD）、TEMPLATES.md（phase と templates のみ） |
| **commands/** | requirement-discovery, design-feature, implement-feature, verify-and-close（skill chain 定義） |
| **skills/** | agent/, requirements/, architecture/, implementation/, testing/, review/, logging（各 capability） |
| **agents/** | オーケストレーション（メインは指示に徹し、実作業はサブに委譲） |
| **enforcement/** | claude/, cursor/, ci/（フック・ルール・監査の正本） |
| **scribe/** | ログは誰が書くか・どこに書くか |
| **ledger/** | workflow.db の配置・スキーマ（schema.md） |
| **platforms/** | Cursor / Claude Code / Gemini の差分・スキル配備方針（README.md, SKILLS.md） |
| **human/** | 人間向け案内 |
| **spec/** | 設計原則・設計判断の優先順位・AI開発ルール等。要求・設計 command の前に参照する。 |

中心は **skill（能力）** と **command（skill chain）**。phase は gate、agents はオーケストレーションのみ。

**テンプレート（00〜04 等）**: .agents 配下には置かない。**AGENTS-spec/.workflow/templates/** にあり、setup でプロジェクトの **.workflow/templates/** にコピーする。プロジェクトは .workflow/templates を参照する。

---

## セットアップ（プロジェクトへ導入するとき）

1. **AGENTS-spec をプロジェクトに置く**  
   プロジェクトルート直下に `AGENTS-spec/` がある状態にする（clone またはコピー）。

2. **セットアップ脚本を実行する**  
   ```bash
   bash AGENTS-spec/.agents/scripts/setup-agents-spec.sh
   ```
   これで以下が行われる:
   - `AGENTS-spec/AGENTS.md` と `AGENTS-spec/CLAUDE.md` がプロジェクトルートにコピーされる
   - `AGENTS-spec/.agents/` がプロジェクトの `.agents/` にコピーされる
   - `.workflow/templates` が無い場合は **AGENTS-spec/.workflow/templates** からコピーされる
   - `.claude/hooks` と `.cursor/` に enforcement が展開され、スキルが `.claude/skills` と `.cursor/skills` に同期される

3. **動作確認**  
   プロジェクトルートに `AGENTS.md` と `.agents/` が存在することを確認する。詳細は [.agents/SETUP.md](.agents/SETUP.md) のスモークテストを参照。

---

## 入口と参照

| 目的 | 読むファイル |
|------|--------------|
| プロジェクトの入口 | ルートの AGENTS.md → .agents/README.md |
| 絶対制約・読了義務 | .agents/boot/CORE.md |
| いつ何を読むか | .agents/boot/LOAD_POLICY.md |
| フェーズ・成果物・DoD | .agents/workflow/PHASES.md |
| command を実行するとき | .agents/skills/agent/run_command.md と .agents/commands/{name}.md |
| コピー対象・セットアップ詳細 | [.agents/SETUP.md](.agents/SETUP.md) |
| 基盤の肥大化防止・文書追加ルール | [.agents/META_LAYER.md](.agents/META_LAYER.md) |

---

## その他（今まで通り）

- テンプレート一式・.workflow の運用は従来どおり。**spec（設計原則等）は .agents/spec/ に含まれ、要求・設計の前に参照する。**issue 用フォルダは `.workflow/{YYYYMMDD_HHMMSS_issue_name}/` に作成し、証跡（memo）のファイル名は `YYYYMMDD_HHMMSS_` プレフィックスを付ける。
- 本 README は AGENTS-spec パッケージの概要と .agents 配下の構成・セットアップ手順を説明する。実行契約の詳細は .agents 配下（とくに .agents/README.md, boot/CORE.md, GETTING_STARTED.md）を参照すること。
