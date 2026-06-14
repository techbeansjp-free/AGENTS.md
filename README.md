# agents-package — AI 実行契約・ワークフロー仕様

LLM エージェント（AI）と人間が協働するための**実行契約・能力（skills）中心のワークフロー**を定義する仕様パッケージ。プロジェクトにコピーして、AI に「.agents に従って」と指示すると、フェーズ（要求→要件→設計→実装計画→実装→レビュー）に沿って動く。

**メタレイヤー**: 本仕様で定義する orchestrator / worker 等は「プロジェクト内で動くエージェント」の振る舞いである。これら仕様ファイルを編集するアシスタント（Cursor 等）は別レイヤー。**基盤の自己肥大化防止**（Feature First・文書追加前の統合検討・一時文書の寿命・責務境界・監視指標）も [.agents/META_LAYER.md](.agents/META_LAYER.md) で定義する。

---

## 何がどこに置かれるか

- **プロジェクトルートに置くもの（その他・今まで通り）**: `AGENTS.md`, `CLAUDE.md`。入口として 1 ファイルずつ。AI はここから .agents を参照する。
- **.agents-project/**（プロジェクト固有・**最優先**）: プロジェクトごとの固有ルールを置く。**.agents-project が .agents より優先**される。同名・同目的のルールは .agents-project を採用。setup では作成しない。プロジェクト側で必要に応じて用意する。
- **.agents ディレクトリ配下に置くもの**: 実行契約・能力・ワークフロー・強制の正本。**正本は本パッケージの `.agents/` にあり、セットアップでプロジェクトの `.agents/` にコピーする。**

---

## .agents 配下の構成（正本: パッケージの `.agents/`）

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

**テンプレート（00〜04 等）**: .agents 配下には置かない。**`.workflow/templates/`** にあり、setup でプロジェクトの **.workflow/templates/** にコピーする。プロジェクトは .workflow/templates を参照する。

---

## 導入（プロジェクトへ配備するとき）

導線は **npm（主導線）** と **Claude marketplace（副導線）** の 2 つ。基本は npm 経由を推奨する。

> 注: npm スコープ名 `@techbeansjp-free/agents-md` は暫定であり、公開レジストリ／スコープは未確定（確定後に変更される可能性がある）。

### 1. npm 経由（主導線・推奨）

採用先プロジェクトのルートで次を実行する。`init` が内部で `.agents/scripts/setup.sh` を呼び、配備一式を行う。

```bash
cd my-project
npx @techbeansjp-free/agents-md init
```

これで以下が行われる:

- パッケージの `AGENTS.md` と `CLAUDE.md` がプロジェクトルートにコピーされる
- パッケージの `.agents/` がプロジェクトの `.agents/` にコピーされる
- `.workflow/templates` が無い場合は **`.workflow/templates/`**（パッケージ内）からコピーされる
- `.claude/hooks` と `.cursor/` に enforcement が展開され、スキルが `.claude/skills` と `.cursor/skills` に同期される

**サブコマンド**:

| コマンド | 役割 |
|----------|------|
| `init [dir]` | 採用先（既定: カレントディレクトリ）へ `.agents/` 等を配備する |
| `upgrade [dir]` | 既存配備を再同期する（当面 `init` と同等。新版取り込みに使う） |
| `uninstall [dir]` | `init`/`setup` が配備した成果物のみを除去する（ユーザー資産は既定で保持） |
| `doctor` | 配備に必要な前提（`setup.sh`・`bash`・`sqlite3` 等）の有無を確認する。enforcement 配線の on/off も表示する |
| `enforce <on\|off\|status> [dir]` | enforcement フックを `.claude/settings.json` に着脱する（**既定 off / opt-in**） |
| `version` | パッケージのバージョンを表示する |
| `help` | 使い方を表示する |

**版のピン留め・アップグレード**:

```bash
# 特定版をピン留めして導入（@x.y.z で固定。再現的に同一内容を取り込める）
npx @techbeansjp-free/agents-md@0.1.0 init

# 既存配備を新版へ再同期（アップグレード）
npx @techbeansjp-free/agents-md@latest upgrade

# 配備前提（bash・sqlite3 等）の健全性を確認
npx @techbeansjp-free/agents-md doctor
```

**アンインストール（つけ外し）**:

プラグインは簡単につけ外しできる。`init`/`upgrade`/`uninstall` は **パッケージ配備物（既知エントリ）のみ**を管理し、ユーザー資産（`.agents-project/`・`.cursor`/`.claude` のユーザー作成物・`.claude/skills` や `.cursor/skills` の**自作スキル**・`.claude/hooks` の**独自フック**・`.workflow/<issue>`・`workflow.db`）は**破壊しない**。`uninstall` は配備物のみを除去し、人間が編集する資産は**既定で保持**する。引数なしは dry-run（削除対象の表示のみ）。

```bash
# 採用先プロジェクトのルートで実行。まず削除対象を表示（dry-run。何も消さない）
npx @techbeansjp-free/agents-md uninstall

# 実際に配備物のみを除去する（.cursor/.claude は丸ごと消さず配備分のみ。自作スキル/独自フックは保持）
npx @techbeansjp-free/agents-md uninstall --yes

# workflow.db 等の証跡も含めて完全除去する
npx @techbeansjp-free/agents-md uninstall --purge --yes
```

| 区分 | 既定の `uninstall` | `--purge` 付き |
|------|-------------------|----------------|
| 除去する配備物 | `.agents/`・`AGENTS.md`・`CLAUDE.md`・`.cursor/agents-core.mdc`・`.claude/hooks` の所有フック・`.claude/skills` と `.cursor/skills` の所有 skill エントリ・`.workflow/templates/` | 同左 |
| 保持するユーザー資産 | `.agents-project/`・`.cursor` のユーザー作成物・`.claude` のユーザー設定・**自作スキル**（`.claude/skills`・`.cursor/skills`）・**独自フック**（`.claude/hooks`）・`.workflow/<issue>`・`.workflow/workflow.db*` | 左に同じ（`workflow.db` は削除） |
| 安全策 | `.agents/` も `AGENTS.md` も無い（未配備の）ディレクトリでは誤削除を防ぐため中止する。`.cursor`/`.claude` は丸ごと消さず**配備分（既知エントリ）のみ**除去（自作スキル/独自フックは保持）。`--yes` 無しは表示のみ。 | 同左 |

> 補足: `init`／`upgrade` は workflow.db の初期化に `sqlite3` バイナリを必要とする（`doctor` で確認できる）。**project 固有ルールは `.agents-project/` に置くこと**を推奨する（再インストール・upgrade・uninstall で保持される）。`.cursor`/`.claude` に置いたユーザー作成物も保持される。`AGENTS.md`・`CLAUDE.md`・`.agents-project/` 等の人間編集領域は無断破壊されない（保持・上書き契約の正本は [.agents/SETUP.md](.agents/SETUP.md)）。

**enforcement の opt-in（既定 off）**:

enforcement フック（PreToolUse/PostToolUse）の `.claude/settings.json` への配線は**既定 off**。配線するとセッション挙動が変わる（orchestrator の Write/Edit/Bash 等が拒否される）ため、**ドッグフーディング時に任意で opt-in** する。常時 on にはしない。

```bash
# 採用先プロジェクトのルートで実行
npx @techbeansjp-free/agents-md enforce status   # 現在の on/off と hook 実在性を表示
npx @techbeansjp-free/agents-md enforce on       # opt-in（settings.json に配線をマージ。既存値は保持・.bak 退避）
npx @techbeansjp-free/agents-md enforce off      # 解除（enforcement 配線のみ外す。ユーザー値は保持）
```

- `enforce on` は正本テンプレート（`.agents/platforms/claude/settings.enforce.json`）から `hooks.PreToolUse`/`PostToolUse`（`.claude/hooks/PreToolUse.sh`/`PostToolUse.sh` を指す）と `env.AGENT_ROLE=orchestrator` を配線する。既存の `settings.json` があれば**ユーザー値を破壊せず**マージし、上書き前に `settings.json.bak` へ退避する。
- `enforce off` は enforcement 由来の配線のみを外し、ユーザーの env・hooks・permissions 等は保持する。
- 設定変更を**ライブの Claude セッションに反映するには再起動が必要**。無効 JSON の場合 `enforce` は破壊を避けて中止する。

### 2. Claude marketplace 経由（副導線）

Claude Code のプラグイン・マーケットプレイス（`/plugin` 系コマンド）から導入する経路。本リポの [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) を marketplace として登録し、プラグイン `agents-package`（正本 `.agents/` から生成される Claude アダプタ）を追加する。

```text
/plugin marketplace add techbeansjp-free/AGENTS.md
/plugin install agents-package
```

> marketplace のプラグイン生成物（`.adapters/claude`）は正本 `.agents/` から `build-adapters.sh` で生成される。詳細は [docs/maintainer/adapters.md](docs/maintainer/adapters.md) を参照。

### 3. ローカル配備（リポを直接置く場合）

npm を使わずパッケージを直接置く場合は、パッケージルートで `setup.sh` を実行する。

```bash
bash .agents/scripts/setup.sh /path/to/my-project   # 引数省略時はカレントを採用先とする
```

### 動作確認

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
- 本 README は本パッケージの概要と .agents 配下の構成・セットアップ手順を説明する。実行契約の詳細は .agents 配下（とくに .agents/README.md, boot/CORE.md, GETTING_STARTED.md）を参照すること。
