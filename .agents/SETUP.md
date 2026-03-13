# SETUP — コピー対象・初回セットアップ

プロジェクトへ AGENTS-spec を導入するときのコピー対象・必須ファイル・初回セットアップで生成するもの・フックの正本を 1 ファイルにまとめる。記載パスと実体が一致する。

以下を最初に実行する。

## セットアップの実行方法

セットアップ脚本は **.agents 配下** に配置する（AGENTS-spec/.agents/scripts/）。

```bash
# プロジェクトルートで実行。AGENTS-spec がプロジェクト直下にある場合。
bash AGENTS-spec/.agents/scripts/setup-agents-spec.sh
```

プロジェクトルートを第 1 引数で渡す実装でもよい。

---

以下は補足・参照用である。

## コピー対象（AGENTS-spec からプロジェクトルートへ）

| コピー元 | コピー先（プロジェクトルート） |
|----------|-------------------------------|
| AGENTS-spec/AGENTS.md | AGENTS.md |
| AGENTS-spec/CLAUDE.md | CLAUDE.md |
| AGENTS-spec/.agents/ 全体 | .agents/ |
| （実コピーは setup 脚本が実行） | - |

**プロジェクト固有・最優先**: プロジェクトルートの **.agents-project/** は setup では作成しない。プロジェクト側で用意する。**.agents-project 配下のルールは .agents より優先**される（.agents/boot/CORE.md §ルールの優先順位）。

---

## .agents 配下に置くもの（正本は AGENTS-spec/.agents/）

以下はすべて **.agents ディレクトリ配下** に置く。プロジェクトへ配備後はプロジェクトルートの `.agents/` に存在する。

- .agents/README.md
- .agents/CONCEPTS.md
- .agents/RULES.md
- .agents/DOCS_RULES.md（システム仕様書 docs/ 運用ルール）
- .agents/REVIEW_RULE.md（04_review 実施時の必須参照・監査観点）
- .agents/GETTING_STARTED.md
- .agents/boot/（CORE.md, LOAD_POLICY.md）
- .agents/workflow/（PHASES.md, TEMPLATES.md のみ。phase と templates の責務に限定。プラットフォーム・スキル配備は platforms/ に含める）
- .agents/commands/（requirement-discovery, design-feature, implement-feature, verify-and-close）
- .agents/skills/（agent/, requirements/, architecture/, implementation/, testing/, review/, logging/ 各 capability）
- .agents/agents/README.md
- .agents/enforcement/（claude/, cursor/, ci/）
- .agents/scribe/README.md
- .agents/ledger/（README.md, schema.md）
- .agents/platforms/（README.md, SKILLS.md。プラットフォーム差分・スキル配備方針）
- .agents/human/README.md
- .agents/scripts/（setup-agents-spec.sh）。※ setup は配備の責務のため、将来的に AGENTS-spec/scripts/ 直下に移す選択肢あり。現状は .agents/scripts/ で運用可。
- .agents/spec/（設計原則・設計判断の優先順位・AI開発ルール等。要求・設計 command の前に参照）

---

## スキル・agents の正本と配備先

メンテナが正本の場所と配備先の関係を一箇所で確認できるよう、対応を下表に示す。

| 正本（.agents 配下） | 配備先 |
|----------------------|--------|
| .agents/skills/ | .claude/skills/ 、 .cursor/skills/ （setup の sync_skills で同期） |
| .agents/agents/（README 等） | 配備先なし（参照用。agents テンプレートは .workflow/templates/agents/ を参照） |
| .workflow/templates/agents/（scribe テンプレート） | 手動で .claude/agents/ および .cursor/agents/ にコピー（後述） |

---

## 初回セットアップで生成するもの

- **.claude/hooks/**: .agents/enforcement/claude/ の PreToolUse.sh, PostToolUse.sh を配置。
- **.cursor/**: .agents/enforcement/cursor/ の agents-core.mdc 等を配置。
- **.claude/skills/**, **.cursor/skills/**: .agents/skills/ 配下の各 capability をコピー（SKILL.md 含む）。
- **.workflow/templates/**: プロジェクトに存在しない場合、**AGENTS-spec/.workflow/templates/** からコピーする。
- **.workflow/workflow.db**: 存在しない場合のみ、setup の init_workflow_db で作成する（証跡用。配布物には含めない）。
- フックの正本は .agents/enforcement/ にあり、setup が各ツール向けに配備する。
- **scribe（agents テンプレート）**: 初回セットアップでは **.claude/agents/ および .cursor/agents/ には配置しない**。手動コピーを前提とする（理由は後述「scribe の利用手順」）。

---

## scribe（agents テンプレート）の利用手順

**結論: 手動コピーとする。** setup 脚本では .claude/agents および .cursor/agents へ scribe を配置しない。

- **手順**: scribe テンプレート（scribe_claude.md, scribe_cursor.md）の正本は **.workflow/templates/agents/**（AGENTS-spec からコピーした .workflow の場合はプロジェクトの .workflow/templates/agents/）にあり、利用する場合は **手動で .claude/agents/ および .cursor/agents/ にコピーすること**。
- **理由**: 利用者による選択的コピーを想定し、既存の .claude/agents や .cursor/agents を setup で上書きしないため。必要なプロジェクト・環境にのみ配置できる。

---

## セットアップの上書きルール

| 対象 | 上書き | 説明 |
|------|--------|------|
| **AGENTS.md, CLAUDE.md** | 初回のみ、既存が無い場合 | setup がプロジェクトルートにコピー。既に存在する場合は上書きしない（手動で差し替え可）。 |
| **.agents/** | 初回のみ | 既に .agents がある場合はコピーをスキップ（警告表示）。上書きしたい場合は手動で削除または退避してから setup を再実行。 |
| **.workflow/templates/** | 初回のみ、未存在時 | ディレクトリが無い場合のみ AGENTS-spec/.workflow/templates からコピー。既存は上書きしない。 |
| **.claude/hooks/, .cursor/** | 再同期対象 | setup のたびに enforcement 正本からコピーする。**人間が編集した内容は上書きされる**。カスタムは .agents/enforcement/ の正本を編集するか、別名で配置する。 |
| **.claude/skills/, .cursor/skills/** | 再同期対象 | sync_skills で .agents/skills/ からコピー。正本を編集したら setup または sync を再実行して反映。 |
| **.agents-project/** | 作成しない | setup は作成しない。プロジェクト側で用意する。**人間が編集してよい**。.agents より優先される。 |
| **workflow.db** | 初回生成のみ | setup の init_workflow_db で無い場合のみ作成。既存 DB は上書きしない。 |

---

## スモークテスト（セットアップ後）

本セクションは簡易確認。**正式な導入完了確認は「導入完了チェックリスト」を参照**すること。

- プロジェクトルートに AGENTS.md が存在する。
- .agents/ に boot/CORE.md, LOAD_POLICY.md, workflow/PHASES.md, workflow/TEMPLATES.md, commands/, skills/, ledger/schema.md が存在する。
- .workflow/templates/ は AGENTS-spec/.workflow/templates からコピーされる（未存在時）。00_要求定義.md 〜 04_review.md 等を参照。
- command 実行時は .agents/commands/{name}.md と .agents/skills/agent/run_command.md を読めること。
- .agents/GETTING_STARTED.md が存在すること。
- .claude/hooks/ に PreToolUse.sh, PostToolUse.sh が存在する（enforcement に配置している場合）。
- .cursor/ に agents-core.mdc が存在する（enforcement に配置している場合）。
- .claude/skills/ および .cursor/skills/ に各 capability ディレクトリが存在する。
- .agents/spec/ に設計原則・設計判断の優先順位等が存在する。

---

## 導入完了チェックリスト（1 ページ）

セットアップ実行後、次を 1 ページで確認する。すべて満たせば導入完了とする。

| # | 確認項目 | 確認方法 |
|---|----------|----------|
| 1 | **コピー対象が揃っているか** | プロジェクトルートに AGENTS.md、.agents/ が存在する。.agents/ に boot/, workflow/, commands/, skills/, enforcement/, scribe/, ledger/ が存在する。 |
| 2 | **.agents-project の有無と優先確認** | プロジェクト固有ルールを使う場合は .agents-project/ をプロジェクトルートに用意する。.agents より優先される（AGENTS.md §読み込み順・CORE §ルールの優先順位）。 |
| 3 | **commands が呼べるか** | .agents/commands/ に requirement-discovery, design-feature, implement-feature, verify-and-close が存在する。.agents/skills/agent/run_command.md が読めること。 |
| 4 | **enforcement が有効か** | .claude/hooks/ に PreToolUse.sh, PostToolUse.sh が存在する（Claude 利用時）。.cursor/ に agents-core.mdc が存在する（Cursor 利用時）。.agents/enforcement/ci/audit.sh が存在する。 |
| 5 | **workflow.db へ書記ログが 1 件入るか** | .workflow/workflow.db が存在する（無ければ ledger/schema.md に従い作成）。verify-and-close または write-workflow-log を 1 回実行し、execution_logs に 1 件以上記録されることを確認する。書記は唯一の記録者（scribe/README.md）。 |
| 6 | **pre-push / CI が最低限動くか** | 採用する場合、.github/workflows/ に subagent-guard または audit を呼ぶワークフローを配置する。pre-push フックを採用する場合は scripts/pre-push が実行可能であること。 |

**失敗系テストの推奨**: 導入後、わざと違反ケース（例: 03_実装計画.md のみ存在し 04_review.md を書かない、memo のプレフィックスを誤った形式にする）を作り、audit.sh が FAIL すること・pre-push が push を止めること・CI が reject することを確認すること。存在確認と実効性は別のため、失敗系テストで実効性を確認する。

上記のうち、プロジェクトで利用しないツール（例: Claude のみで Cursor を使わない）の項目はスキップしてよい。必須なのは 1・2・3 および、ログを運用する場合は 5。enforcement と CI は強く推奨する。

---

## 不要ファイル・削除済み／整理方針

**配布に含めない**: 保守用・実装レビュー用の文書は **.agents 外**（例: **docs/maintainer/**）に置き、プロジェクトへはコピーしない。setup は .agents/ 等のコピー対象のみを配備する。**workflow.db の実体および workflow.db-wal / workflow.db-shm はテンプレート・OSS 配布に絶対に含めない**。証跡 DB は setup（.agents/scripts/setup-agents-spec.sh の init_workflow_db）で生成する。

- **COPY_TO_PROJECT_ROOT_AGENTS.md** — 廃止済み。正本は本ファイル（SETUP.md）のみ。コピー対象・セットアップは本ファイルと setup 脚本に一元化する。
- **spec/** — AGENTS-spec 直下からは削除済み。正本は **.agents/spec/** に移動し、要求・設計 command の前に参照する。
- **.review/** — 規約全体のレビュー履歴。パッケージ配布には不要なため削除済み。
- **v2/・v3/** — 削除済み。正本は AGENTS-spec 直下と .agents に統一している。
- **OSS化ロードマップ.md** — リポジトリ保守向けのタスク一覧。配布物には不要なため削除済み。
- **examples/** — 導入レベル別のコピペ例。導入は **setup 脚本 1 本**（.agents/scripts/setup-agents-spec.sh）に統一したため削除済み。
