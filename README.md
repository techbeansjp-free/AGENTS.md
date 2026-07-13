# agents-package — AI 実行契約・ワークフロー仕様

LLM エージェント（AI）と人間が協働するための**実行契約・能力（skills）中心のワークフロー**を定義する仕様パッケージ。プロジェクトにコピーして、AI に「.agents に従って」と指示すると、フェーズ（要求→要件→設計→実装計画→実装→レビュー）に沿って動く。

**配備と強制力の考え方**: `.agent-skill-chain/source/` を**単一の正本**とし、各 AI ツール（Claude Code / Cursor / Gemini / Copilot / Codex）へ**段階的に配備**する（全ツールが同一機能で対応するわけではない）。**強制力はツールごとに異なる**（Claude Code は runtime hook で物理強制、Cursor はルール配布・一部誘導、Gemini / Copilot / Codex は方針適用予定）。**最終保証は CI audit**（全ツール共通の最後の砦）が担う。ツール別の強制力区分の正本は [.agent-skill-chain/source/enforcement/README.md §ツール別強制力マトリクス](.agent-skill-chain/source/enforcement/README.md#ツール別強制力マトリクス) を参照。

**メタレイヤー**: 本仕様で定義する orchestrator / worker 等は「プロジェクト内で動くエージェント」の振る舞いである。これら仕様ファイルを編集するアシスタント（Cursor 等）は別レイヤー。**基盤の自己肥大化防止**（Feature First・文書追加前の統合検討・一時文書の寿命・責務境界・監視指標）も [.agent-skill-chain/source/META_LAYER.md](.agent-skill-chain/source/META_LAYER.md) で定義する。

---

## 導入すると何が変わるか

「.agents に従って」と指示すると、AI アシスタントの進め方が次のように変わる。思想・詳細は正本 [CONCEPTS.md](.agent-skill-chain/source/CONCEPTS.md)・[GETTING_STARTED.md](.agent-skill-chain/source/GETTING_STARTED.md) を参照。

- **進行役がサブに委譲する**: メイン（orchestrator）は phase 判定・command 選択・証跡確認に徹し、実作業（要求・要件・設計・実装・レビューの執筆やコード編集）は必ずサブエージェントに委譲する。
- **phase gate に沿って進む**: 作業は 要求 → 要件 → 設計 → 実装計画 → 実装 → レビュー の順に command（skill chain）で回り、各 phase の DoD を満たしてから次へ進む。
- **enforcement を opt-in すると挙動が制約される**: `enforce on`（既定 off）でフックを配線すると、orchestrator の直接 Write/Edit/Bash 等が拒否され、サブへの委譲が物理的に強制される（[§配備後の管理（CLI）](#配備後の管理cli)）。
- **証跡が workflow.db に残る**: 各 command の完了は書記（scribe）が workflow.db に記録し、監査で検証できる。

---

## 何がどこに置かれるか

- **プロジェクトルートに置くもの（その他・今まで通り）**: `AGENTS.md`, `CLAUDE.md`。入口として 1 ファイルずつ。AI はここから .agents を参照する。
- **.agent-skill-chain/project/**（プロジェクト固有・**最優先**）: プロジェクトごとの固有ルールを置く。**.agent-skill-chain/project が .agents より優先**される。同名・同目的のルールは .agent-skill-chain/project を採用。setup では作成しない。プロジェクト側で必要に応じて用意する。
- **.agents ディレクトリ配下に置くもの**: 実行契約・能力・ワークフロー・強制の正本。**正本は本パッケージの `.agent-skill-chain/source/` にあり、セットアップでプロジェクトの `.agent-skill-chain/source/` にコピーする。**

---

## .agents 配下の構成（正本: パッケージの `.agent-skill-chain/source/`）

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

**テンプレート（00〜04 等）**: .agents 配下には置かない。**`.agent-skill-chain/runtime/templates/`** にあり、setup でプロジェクトの **.agent-skill-chain/runtime/templates/** にコピーする。プロジェクトは .agent-skill-chain/runtime/templates を参照する。

---

## 使えるもの（command とスキル）

上記「.agents 配下の構成」のディレクトリマップを補完し、導入すると使える command と skills（能力）の概要を示す。個別 capability の詳細カタログは正本 [.agent-skill-chain/source/README.md](.agent-skill-chain/source/README.md) の索引を参照。

### command（skill chain）

phase に紐づく実行単位。次の 6 種がある。

| command | 役割 |
|---------|------|
| `requirement-discovery` | 要求・要件を発見し、00/01 と BDD を書く |
| `design-feature` | 責務・境界・API を設計し、02（設計）・03（実装計画）を書く |
| `implement-feature` | 03 の計画に従って実装し、単体テストと証跡を残す |
| `verify-and-close` | 検証・レビューし、04_review を書いてクローズする |
| `review-docs` | 実装前に 00〜03 をドキュメントレビューする（実装着手の必須ゲート） |
| `create-pr-review-issue` | PR 指摘対応のための issue を起票する |

### skills（能力）

1 目的の最小部品。`skills/{domain}/{capability}/` に配置し、command が chain して使う。ドメインは次の 7 つ。

| ドメイン | 概要 |
|----------|------|
| requirements | 目的抽出・前提整理・制約定義・BDD 執筆 |
| architecture | 責務境界の定義・API 契約設計・依存レビュー |
| implementation | 実装・安全なリファクタ |
| testing | テストシナリオ生成・カバレッジ対応確認 |
| review | 設計レビュー・コードレビュー |
| logging | workflow.db への証跡記録（書記） |
| agent | command 実行・委譲のオーケストレーション |

個別 capability の一覧・詳細は [.agent-skill-chain/source/README.md](.agent-skill-chain/source/README.md) の索引から辿る。

---

## 導入（プロジェクトへ配備するとき）

導線は **npx github:techbeansjp-free/AGENTS.md init（推奨・GitHub 直接参照）**・**apm install（バンドル参照・複数ツール横断配布向けの副導線）**・**Claude marketplace（副導線）** の 3 つ。**基本は `npx github:techbeansjp-free/AGENTS.md init` を推奨する**（apm は個別スキルを配布せず `agent-skill-chain-full` バンドル参照のみのため、個別スキル・enforcement・管理 CLI を含むフル機能を得るには npx が必要）。

> **導線ごとの配布責務**: 個別スキル（`{domain}__{capability}`）・`AGENTS.md`/`CLAUDE.md` 本体・enforcement フック・管理 CLI（uninstall/doctor/enforce/upgrade 等）を配れる**完全導線は npx** のみ。**apm は参照コンテキストとして `agent-skill-chain-full` バンドルのみを配布**し、個別スキルは配らない（apm と npx を併用してもスキルが二重コピーされないようにするため。詳細は [docs/maintainer/apm-package.md](docs/maintainer/apm-package.md)）。apm と npx は併用してよい（重複は生じない）。

> CLI コマンド名は `agents-md`。`npx github:owner/repo` は npm レジストリを経由せず GitHub リポジトリを直接参照する記法。`apm install` も同様に npm レジストリを経由せず GitHub リポジトリ（`techbeansjp-free/AGENTS.md`）から直接取得するが、展開するのは skills のバンドル参照のみで CLI バイナリ（`agents-md`）は導入しない。

`npx` 経由の GitHub 直接参照配備の具体的な手順は [CONTRIBUTING.md](CONTRIBUTING.md) に記載する（開発者・自己拡張・メンテナ向けの追加情報も同ファイルに集約）。

### apm 経由（バンドル参照・複数ツール横断配布向け）

[`microsoft/apm`](https://github.com/microsoft/apm)（Agent Package Manager）で配布する。`apm` CLI を導入したうえで、採用先プロジェクトのルートで次を実行する。

```bash
apm install techbeansjp-free/AGENTS.md#release/apm
# ハーネスマーカー（.claude/ .github/ 等）が無いプロジェクトでは --target を明示する
apm install techbeansjp-free/AGENTS.md#release/apm --target claude
```

これで以下が行われる:

- `.agents/skills/agent-skill-chain-full/reference/.agent-skill-chain/source/` 配下に、正本一式（実行契約・skills・commands・boot・workflow・spec・enforcement 等）が参照コンテキストとして展開される（apm 経由で配布されるスキルはこのバンドル 1 件のみ）
- 個別スキル（`{domain}__{capability}`）は apm では配備されない。個別スキルは npx 導線（§1）が `.claude/skills/`・`.cursor/skills/` に配備する
- `apm.lock.yaml` が採用先プロジェクトのルートに生成される

再現性を求める場合はブランチ ref の代わりにタグ ref（`#apm-vX.Y.Z`。例: `apm install techbeansjp-free/AGENTS.md#apm-v0.1.0`）でピン留めできる。個別スキルや enforcement・管理 CLI・契約本体を要する場合は npx 導線（§1）を使う（詳細は [docs/maintainer/apm-package.md](docs/maintainer/apm-package.md) を参照）。

### Claude marketplace 経由

Claude Code のプラグイン・マーケットプレイス（`/plugin` 系コマンド）から導入する経路。本リポの [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) を marketplace として登録し、プラグイン `agents-package`（正本 `.agent-skill-chain/source/` から生成される Claude アダプタ）を追加する。

```text
/plugin marketplace add techbeansjp-free/AGENTS.md
/plugin install agents-package
```

> marketplace のプラグイン生成物（`.adapters/claude`）は正本 `.agent-skill-chain/source/` から `build-adapters.sh` で生成される。詳細は [docs/maintainer/adapters.md](docs/maintainer/adapters.md) を参照。

### ローカル配備

npm を使わずパッケージを直接置く場合は、パッケージルートで `setup.sh` を実行する。

```bash
bash .agent-skill-chain/source/scripts/setup.sh /path/to/my-project   # 引数省略時はカレントを採用先とする
```

### 動作確認

プロジェクトルートに `AGENTS.md` と `.agent-skill-chain/source/` が存在することを確認する。詳細は [.agent-skill-chain/source/SETUP.md](.agent-skill-chain/source/SETUP.md) のスモークテストを参照。

---

## 配備後の管理（CLI）

**サブコマンド**:

| コマンド | 役割 |
|----------|------|
| `init [dir]` | 採用先（既定: カレントディレクトリ）へ `.agent-skill-chain/source/` 等を配備する |
| `upgrade [dir]` | 既存配備を再同期する（当面 `init` と同等。新版取り込みに使う） |
| `uninstall [dir]` | `init`/`setup` が配備した成果物のみを除去する（ユーザー資産は既定で保持） |
| `doctor [dir]` | 採用先（既定: カレントディレクトリ）の配備前提の有無を確認する。enforcement 配線の on/off・証跡健全性も表示する |
| `enforce <on\|off\|status> [dir]` | enforcement フックを `.claude/settings.json` に着脱する（**既定 off / opt-in**） |
| `version` | パッケージのバージョンを表示する |
| `help` | 使い方を表示する |

**版のピン留め・アップグレード**:

```bash
# 特定版をピン留めして導入（#<tag-or-branch> で git ref を固定。再現的に同一内容を取り込める）
npx github:techbeansjp-free/AGENTS.md#<tag-or-branch> init

# 既存配備を新版へ再同期（アップグレード。ref 省略時は既定ブランチ＝最新を指す）
npx github:techbeansjp-free/AGENTS.md upgrade

# 配備前提（bash・sqlite3 等）の健全性を確認
npx github:techbeansjp-free/AGENTS.md doctor
```

**アンインストール（つけ外し）**:

プラグインは簡単につけ外しできる。`init`/`upgrade`/`uninstall` は **パッケージ配備物（既知エントリ）のみ**を管理し、ユーザー資産（`.agent-skill-chain/project/`・`.cursor`/`.claude` のユーザー作成物・`.claude/skills` や `.cursor/skills` の**自作スキル**・`.claude/hooks` の**独自フック**・`.agent-skill-chain/runtime/<issue>`・`workflow.db`）は**破壊しない**。`uninstall` は配備物のみを除去し、人間が編集する資産は**既定で保持**する。引数なしは dry-run（削除対象の表示のみ）。

```bash
# 採用先プロジェクトのルートで実行。まず削除対象を表示（dry-run。何も消さない）
npx github:techbeansjp-free/AGENTS.md uninstall

# 実際に配備物のみを除去する（.cursor/.claude は丸ごと消さず配備分のみ。自作スキル/独自フックは保持）
npx github:techbeansjp-free/AGENTS.md uninstall --yes

# workflow.db 等の証跡も含めて完全除去する
npx github:techbeansjp-free/AGENTS.md uninstall --purge --yes
```

| 区分 | 既定の `uninstall` | `--purge` 付き |
|------|-------------------|----------------|
| 除去する配備物 | `.agent-skill-chain/source/`・`AGENTS.md`・`CLAUDE.md`・`.cursor/agents-core.mdc`・`.claude/hooks` の所有フック・`.claude/skills` と `.cursor/skills` の所有 skill エントリ・`.agent-skill-chain/runtime/templates/` | 同左 ＋ `.agent-skill-chain/project/`・`.agent-skill-chain/runtime/`（issue 履歴・`workflow.db` を含む） |
| 保持するユーザー資産 | `.agent-skill-chain/project/`・`.cursor` のユーザー作成物・`.claude` のユーザー設定・**自作スキル**（`.claude/skills`・`.cursor/skills`）・**独自フック**（`.claude/hooks`）・`.agent-skill-chain/runtime/<issue>`・`.agent-skill-chain/runtime/workflow.db*` | `.agent-skill-chain/project/` を含め**すべて削除**（統合ルート `.agent-skill-chain/` ごと完全削除）。`.cursor`/`.claude` のユーザー作成物・自作スキル・独自フックは既定同様に保持 |
| 安全策 | `.agent-skill-chain/source/` も `AGENTS.md` も無い（未配備の）ディレクトリでは誤削除を防ぐため中止する。`.cursor`/`.claude` は丸ごと消さず**配備分（既知エントリ）のみ**除去（自作スキル/独自フックは保持）。`--yes` 無しは表示のみ。 | 同左 |

> **注意**: `--purge --yes` は上記「保持するユーザー資産」の `.agent-skill-chain/project/`・`.agent-skill-chain/runtime/` を含め `.agent-skill-chain/` を丸ごと削除する。project 固有ルールも失われるため、必要な資産は事前に退避すること。

> 補足: `init`／`upgrade` は workflow.db の初期化に `sqlite3` バイナリを必要とする（`doctor` で確認できる）。**project 固有ルールは `.agent-skill-chain/project/` に置くこと**を推奨する（再インストール・upgrade・**既定の** uninstall で保持される。ただし `--purge` では削除される）。`.cursor`/`.claude` に置いたユーザー作成物も保持される。`AGENTS.md`・`CLAUDE.md`・`.agent-skill-chain/project/` 等の人間編集領域は無断破壊されない（保持・上書き契約の正本は [.agent-skill-chain/source/SETUP.md](.agent-skill-chain/source/SETUP.md)）。

**enforcement の opt-in（既定 off）**:

enforcement フック（PreToolUse/PostToolUse）の `.claude/settings.json` への配線は**既定 off**。配線するとセッション挙動が変わる（orchestrator の Write/Edit/Bash 等が拒否される）ため、**ドッグフーディング時に任意で opt-in** する。常時 on にはしない。

```bash
# 採用先プロジェクトのルートで実行
npx github:techbeansjp-free/AGENTS.md enforce status   # 現在の on/off と hook 実在性を表示
npx github:techbeansjp-free/AGENTS.md enforce on       # opt-in（settings.json に配線をマージ。既存値は保持・.bak 退避）
npx github:techbeansjp-free/AGENTS.md enforce off      # 解除（enforcement 配線のみ外す。ユーザー値は保持）
```

- `enforce on` は正本テンプレート（`.agent-skill-chain/source/platforms/claude/settings.enforce.json`）から `hooks.PreToolUse`/`PostToolUse`（`.claude/hooks/PreToolUse.sh`/`PostToolUse.sh` を指す）と `env.AGENT_ROLE=orchestrator` を配線する。既存の `settings.json` があれば**ユーザー値を破壊せず**マージし、上書き前に `settings.json.bak` へ退避する。
- `enforce off` は enforcement 由来の配線のみを外し、ユーザーの env・hooks・permissions 等は保持する。
- 設定変更を**ライブの Claude セッションに反映するには再起動が必要**。無効 JSON の場合 `enforce` は破壊を避けて中止する。

---

## 設定できること（設定一覧）

導入後に調整できる設定は次のカテゴリに分かれる。README は代表例のみを示し、設定の全カタログは詳細正本 [enforcement/README.md](.agent-skill-chain/source/enforcement/README.md) 等へのリンクで委譲する。

| カテゴリ | 代表例 | 詳細 |
|----------|--------|------|
| enforcement の opt-in | `enforce on/off`（既定 off） | 本 README [§配備後の管理（CLI）](#配備後の管理cli)・[enforcement/README.md](.agent-skill-chain/source/enforcement/README.md) |
| 版のピン留め・アップグレード | `#<tag-or-branch>` で git ref を固定 | 本 README [§配備後の管理（CLI）](#配備後の管理cli) |
| 監査・走査スコープ等の環境変数 | 走査対象ディレクトリ（`WORKFLOW_DIRS`） | [enforcement/README.md](.agent-skill-chain/source/enforcement/README.md) |

個別の環境変数の網羅はここでは行わず、詳細正本を参照する。

---

## 入口と参照

| 目的 | 読むファイル |
|------|--------------|
| プロジェクトの入口 | ルートの AGENTS.md → .agent-skill-chain/source/README.md |
| 絶対制約・読了義務 | .agent-skill-chain/source/boot/CORE.md |
| いつ何を読むか | .agent-skill-chain/source/boot/LOAD_POLICY.md |
| フェーズ・成果物・DoD | .agent-skill-chain/source/workflow/PHASES.md |
| command を実行するとき | .agent-skill-chain/source/skills/agent/run_command.md と .agent-skill-chain/source/commands/{name}.md |
| コピー対象・セットアップ詳細 | [.agent-skill-chain/source/SETUP.md](.agent-skill-chain/source/SETUP.md) |
| 基盤の肥大化防止・文書追加ルール | [.agent-skill-chain/source/META_LAYER.md](.agent-skill-chain/source/META_LAYER.md) |
| 開発者・自己拡張・メンテナ向け入口 | [CONTRIBUTING.md](CONTRIBUTING.md) |

---

## その他（今まで通り）

- テンプレート一式・.workflow の運用は従来どおり。**spec（設計原則等）は .agent-skill-chain/source/spec/ に含まれ、要求・設計の前に参照する。**issue 用フォルダは `.agent-skill-chain/runtime/{YYYYMMDD_HHMMSS_issue_name}/` に作成し、証跡（memo）のファイル名は `YYYYMMDD_HHMMSS_` プレフィックスを付ける。
- 本 README は本パッケージの概要と .agents 配下の構成・セットアップ手順を説明する。実行契約の詳細は .agents 配下（とくに .agent-skill-chain/source/README.md, boot/CORE.md, GETTING_STARTED.md）を参照すること。
