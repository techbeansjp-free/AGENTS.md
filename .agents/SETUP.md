# SETUP — コピー対象・初回セットアップ

プロジェクトへ本パッケージを導入するときのコピー対象・必須ファイル・初回セットアップで生成するもの・フックの正本を 1 ファイルにまとめる。記載パスと実体が一致する。

以下を最初に実行する。

## セットアップの実行方法

セットアップ脚本は **`.agents/scripts/`** に配置する。

```bash
# パッケージのルートで実行（採用先では本リポジトリのディレクトリへ cd してから）。
bash .agents/scripts/setup.sh
```

プロジェクトルートを第 1 引数で渡す実装でもよい。

---

以下は補足・参照用である。

## コピー対象（パッケージルートからプロジェクトルートへ）

| コピー元（パッケージルート基準） | コピー先（プロジェクトルート） |
|----------|-------------------------------|
| AGENTS.md | AGENTS.md |
| CLAUDE.md | CLAUDE.md |
| .agents/ 全体 | .agents/ |
| （実コピーは setup 脚本が実行） | - |

**プロジェクト固有・最優先**: プロジェクトルートの **.agents-project/** は setup では作成しない。プロジェクト側で用意する。**.agents-project 配下のルールは .agents より優先**される（.agents/boot/CORE.md §ルールの優先順位）。

---

## .agents 配下に置くもの（正本はパッケージの `.agents/`）

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
- .agents/scripts/（setup.sh）。※ setup は配備の責務のため、将来的にパッケージ直下の `scripts/` に移す選択肢あり。現状は .agents/scripts/ で運用可。
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
- **.workflow/templates/**: プロジェクトに存在しない場合、パッケージの **`.workflow/templates/`** からコピーする。
- **.workflow/workflow.db**: 存在しない場合のみ、setup の init_workflow_db で作成する（証跡用。配布物には含めない）。
- フックの正本は .agents/enforcement/ にあり、setup が各ツール向けに配備する。
- **scribe（agents テンプレート）**: 初回セットアップでは **.claude/agents/ および .cursor/agents/ には配置しない**。手動コピーを前提とする（理由は後述「scribe の利用手順」）。

---

## scribe（agents テンプレート）の利用手順

**結論: 手動コピーとする。** setup 脚本では .claude/agents および .cursor/agents へ scribe を配置しない。

- **手順**: scribe テンプレート（scribe_claude.md, scribe_cursor.md）の正本は **.workflow/templates/agents/**（setup でテンプレートをコピー済みのプロジェクトではプロジェクトの `.workflow/templates/agents/`）にあり、利用する場合は **手動で .claude/agents/ および .cursor/agents/ にコピーすること**。
- **理由**: 利用者による選択的コピーを想定し、既存の .claude/agents や .cursor/agents を setup で上書きしないため。必要なプロジェクト・環境にのみ配置できる。

---

## init / upgrade / uninstall の保持・上書き契約（正本）

**結論: install/upgrade/uninstall は「パッケージ配備物」のみを管理し、ユーザー資産は破壊しない。** 再インストール・upgrade でユーザーが個人的に作成した project 固有ルールや自作エディタルールが消えることはない。判断に迷う場合は安全側（保持）に倒す。

### パッケージ管理（init/upgrade のたびに上書き・最新化される）

| 対象 | 種別 | 説明 |
|------|------|------|
| **.agents/** | 正本コピー | パッケージ正本。再 init で再配備し最新化する。 |
| **AGENTS.md, CLAUDE.md** | ルート契約 | パッケージ正本をルートへコピー（最新化）。 |
| **.workflow/templates/** | テンプレート | パッケージの `.workflow/templates/` から最新化する。 |
| **.cursor/agents-core.mdc**（enforcement/cursor の所有ファイル） | エディタルール | setup がパッケージ所有ファイルのみを上書き。**.cursor/ を丸ごと削除しない。** |
| **.cursor/skills/**（パッケージ配備分 {domain}__{capability}・ドメイン直下 {domain}） | 生成 skills | **パッケージ配備分のみ**毎回更新（古い版を消して再コピー）。**ユーザー自作スキルは保持**（共存可）。 |
| **.claude/hooks/**（パッケージ所有フックファイル） | enforcement | **パッケージ所有フックファイルのみ**毎回上書き。**ユーザー独自フックは保持**（共存可）。 |
| **.claude/skills/**（パッケージ配備分 {domain}__{capability}・ドメイン直下 {domain}） | 生成 skills | **パッケージ配備分のみ**毎回更新。**ユーザー自作スキルは保持**（共存可）。 |

> 注: `.cursor/skills/`・`.claude/skills/`・`.claude/hooks/` は **パッケージ配備分（既知エントリ）のみ**を毎回更新する。Claude Code では `.claude/skills/` はユーザーが自作スキルを置く一般的な場所であり、`.claude/hooks/` にも独自フックを置けるため、**ユーザー自作スキル/フックは保持され、パッケージ配備分と共存できる**。パッケージ skill のカスタムは `.agents/skills/` 正本を、フックは `.agents/enforcement/` 正本を編集して反映する。所有エントリの導出は単一定義（skills は `lib/deploy-skills.sh` の `list_owned_skill_names`、フックは `enforcement/claude` のトップレベルファイル）。

### ユーザー資産（保持・破壊しない）

| 対象 | 説明 |
|------|------|
| **.agents-project/** | project 固有ルール。setup は touch しない。**project 固有ルールは必ずここに置くこと**（推奨）。.agents より優先される。 |
| **.cursor/ 配下のユーザー作成物**（他の `rules/*.mdc`・独自ファイル・`.cursor/skills/` の自作スキル） | setup は `.cursor/` を丸ごと削除せず、パッケージ所有ファイル・所有 skill エントリのみ更新するため**保持**される。 |
| **.claude/ のユーザー設定・自作物**（`settings.json`・`.claude/skills/` の自作スキル・`.claude/hooks/` の独自フック） | setup は `.claude/hooks`・`.claude/skills` の**パッケージ配備分のみ**更新し、ユーザー設定・自作スキル・独自フックは touch しない（保持）。 |
| **.workflow/<issue>/** | issue 成果物（消費者ランタイム）。保持。 |
| **workflow.db** | 証跡 DB。初回のみ生成、既存は上書きしない（保持）。 |

**保証**: 上記の保持は E2E テスト `.agents/scripts/test/e2e-install-uninstall.sh` のシナリオ R1（再インストール保持）・R2（upgrade 保持）・R3（uninstall 保持）で再現確認される。

### 初回コピー時の挙動補足

| 対象 | 初回挙動 |
|------|----------|
| **AGENTS.md, CLAUDE.md** | 既存が無い場合にコピー。ソースと採用先が同一パスのときはスキップ。 |
| **.agents/** | 既存 .agents がソースと別パスなら削除して再コピー（最新化）。 |
| **.workflow/templates/** | 未存在時にパッケージから最新化。 |
| **workflow.db** | setup の init_workflow_db で無い場合のみ作成。既存 DB は上書きしない。 |

---

## アンインストール（つけ外し）

プラグイン（配備一式）は簡単につけ外しできる。除去は CLI の `uninstall` サブコマンドで行う（正本は `bin/agents-md.js` の `runUninstall`）。setup/init が配備した成果物のみを除去し、人間が編集する資産は既定で保持する。

```bash
# 採用先プロジェクトのルートで実行
npx @techbeansjp-free/agents-md uninstall            # dry-run（削除対象の表示のみ。何も消さない）
npx @techbeansjp-free/agents-md uninstall --yes      # 実際に配備物を除去する
npx @techbeansjp-free/agents-md uninstall --purge --yes  # workflow.db 等の証跡も含め完全除去
```

| 対象 | 既定 `uninstall` | 説明 |
|------|------------------|------|
| **.agents/・AGENTS.md・CLAUDE.md** | 除去 | setup/init がコピー配備した正本（配備物）。 |
| **.claude/hooks の所有フック・.claude/skills と .cursor/skills の所有 skill エントリ** | 除去 | パッケージ配備分（既知エントリ）のみ。ディレクトリごとは消さない。 |
| **.cursor/ のパッケージ所有ファイル**（agents-core.mdc 等） | 除去 | enforcement 正本由来の配備ファイルのみ。 |
| **.workflow/templates/** | 除去 | setup がコピーしたテンプレート（`.workflow/` 自体は残す）。 |
| **.cursor/ 配下のユーザー作成物**（他の `rules/*.mdc`・`.cursor/skills/` の自作スキル等） | 保持 | `.cursor/` を丸ごと消さず、配備分のみ除去する。 |
| **.claude/ のユーザー設定・自作物**（settings.json・自作スキル・独自フック等） | 保持 | `.claude/` を丸ごと消さず、配備分のみ除去する。 |
| **.agents-project/** | 保持 | プロジェクト固有ルール（人間が編集する資産）。誤削除しない。 |
| **.workflow/<issue>/**（templates 以外） | 保持 | issue 成果物（消費者ランタイム）。 |
| **workflow.db** | 保持（`--purge` 時のみ除去） | 証跡 DB。既定では残す。 |

> uninstall は `.cursor/`・`.claude/` を**丸ごと削除しない**。パッケージが配備した**既知エントリ**（`.cursor/agents-core.mdc`・`.claude/hooks` の所有フックファイル・`.claude/skills` と `.cursor/skills` の所有 skill エントリ {domain}__{capability}・{domain}）のみを除去し、ユーザー作成物（自作スキル・独自フック・自作 rules 等）が同居していれば残す。除去後に `.claude/hooks`・`.claude/skills`・`.cursor/skills`・`.cursor/`・`.claude/` が空になった場合のみ、空ディレクトリを片付ける。所有エントリ集合は setup.sh と単一整合（skills は `lib/deploy-skills.sh` の `list_owned_skill_names`、フックは `enforcement/claude` のトップレベルファイル、cursor 直下は `enforcement/cursor` のトップレベルファイル）。

**安全策**: 採用先に配備の痕跡（`.agents/` または `AGENTS.md`）が無い場合、誤削除を防ぐため uninstall を中止する。存在しない対象はスキップし、`--yes` を付けない限り削除は行わず対象の一覧表示（dry-run）に留める。`uninstall` の挙動は E2E テスト `.agents/scripts/test/e2e-install-uninstall.sh`（install→uninstall→冪等→カプセル化→リーク→**R1 再インストール保持・R2 upgrade 保持・R3 uninstall 保持**）で再現確認される。

---

## スモークテスト（セットアップ後）

本セクションは簡易確認。**正式な導入完了確認は「導入完了チェックリスト」を参照**すること。

- プロジェクトルートに AGENTS.md が存在する。
- .agents/ に boot/CORE.md, LOAD_POLICY.md, workflow/PHASES.md, workflow/TEMPLATES.md, commands/, skills/, ledger/schema.md が存在する。
- .workflow/templates/ はパッケージの `.workflow/templates/` からコピーされる（未存在時）。00_要求定義.md 〜 04_review.md 等を参照。
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

**配布に含めない**: 保守用・実装レビュー用の文書は **.agents 外**（例: **docs/maintainer/**）に置き、プロジェクトへはコピーしない。setup は .agents/ 等のコピー対象のみを配備する。**workflow.db の実体および workflow.db-wal / workflow.db-shm はテンプレート・OSS 配布に絶対に含めない**。証跡 DB は setup（.agents/scripts/setup.sh の init_workflow_db）で生成する。

- **COPY_TO_PROJECT_ROOT_AGENTS.md** — 廃止済み。正本は本ファイル（SETUP.md）のみ。コピー対象・セットアップは本ファイルと setup 脚本に一元化する。
- **spec/** — パッケージ直下からは削除済み。正本は **.agents/spec/** に移動し、要求・設計 command の前に参照する。
- **.review/** — 規約全体のレビュー履歴。パッケージ配布には不要なため削除済み。
- **v2/・v3/** — 削除済み。正本はパッケージ直下と .agents に統一している。
- **OSS化ロードマップ.md** — リポジトリ保守向けのタスク一覧。配布物には不要なため削除済み。
- **examples/** — 導入レベル別のコピペ例。導入は **setup 脚本 1 本**（.agents/scripts/setup.sh）に統一したため削除済み。
