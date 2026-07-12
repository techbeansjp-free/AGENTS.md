# SETUP — コピー対象・初回セットアップ

プロジェクトへ本パッケージを導入するときのコピー対象・必須ファイル・初回セットアップで生成するもの・フックの正本を 1 ファイルにまとめる。記載パスと実体が一致する。

以下を最初に実行する。

## ⚠️ `.agent-skill-chain/` を直接 `rm -rf` しないこと（要旨）

配備先の統合ルート `.agent-skill-chain/` には、パッケージ本体（`source/`）だけでなく、プロジェクト固有の設定（`project/`）と監査履歴・issue 記録（`runtime/`）が同居する。`rm -rf .agent-skill-chain/` は**公式なアンインストール手順ではなく**、プロジェクト固有の設定・監査履歴・issue 記録を無警告で失う。安全な削除には常に `agents-md uninstall`（既定＝`source/`・`runtime/templates/` のみ削除、`--purge`＝完全削除）を使用すること。配備先に置かれる `.agent-skill-chain/README.md`（setup が新規配備・再配備のたびに最新化する）にも同趣旨の警告文が記載される。

## セットアップの実行方法

セットアップ脚本は **`.agent-skill-chain/source/scripts/`** に配置する。

```bash
# パッケージのルートで実行（採用先では本リポジトリのディレクトリへ cd してから）。
bash .agent-skill-chain/source/scripts/setup.sh
```

プロジェクトルートを第 1 引数で渡す実装でもよい。

---

以下は補足・参照用である。

## コピー対象（パッケージルートからプロジェクトルートへ）

| コピー元（パッケージルート基準） | コピー先（プロジェクトルート） |
|----------|-------------------------------|
| AGENTS.md | AGENTS.md |
| CLAUDE.md | CLAUDE.md |
| .agent-skill-chain/source/ 全体 | .agent-skill-chain/source/ |
| （実コピーは setup 脚本が実行） | - |

**プロジェクト固有・最優先**: プロジェクトルートの **.agent-skill-chain/project/** は setup では作成しない。プロジェクト側で用意する。**.agent-skill-chain/project 配下のルールは .agent-skill-chain/source より優先**される（.agent-skill-chain/source/boot/CORE.md §ルールの優先順位）。

---

## .agent-skill-chain/source 配下に置くもの（正本はパッケージの `.agent-skill-chain/source/`）

以下はすべて **.agent-skill-chain/source ディレクトリ配下** に置く。プロジェクトへ配備後はプロジェクトルートの `.agent-skill-chain/source/` に存在する。

- .agent-skill-chain/source/README.md
- .agent-skill-chain/source/CONCEPTS.md
- .agent-skill-chain/source/RULES.md
- .agent-skill-chain/source/DOCS_RULES.md（システム仕様書 docs/ 運用ルール）
- .agent-skill-chain/source/REVIEW_RULE.md（04_review 実施時の必須参照・監査観点）
- .agent-skill-chain/source/GETTING_STARTED.md
- .agent-skill-chain/source/boot/（CORE.md, LOAD_POLICY.md）
- .agent-skill-chain/source/workflow/（PHASES.md, TEMPLATES.md のみ。phase と templates の責務に限定。プラットフォーム・スキル配備は platforms/ に含める）
- .agent-skill-chain/source/commands/（requirement-discovery, design-feature, implement-feature, verify-and-close）
- .agent-skill-chain/source/skills/（agent/, requirements/, architecture/, implementation/, testing/, review/, logging/ 各 capability）
- .agent-skill-chain/source/agents/README.md
- .agent-skill-chain/source/enforcement/（claude/, cursor/, ci/）
- .agent-skill-chain/source/scribe/README.md
- .agent-skill-chain/source/ledger/（README.md, schema.md）
- .agent-skill-chain/source/platforms/（README.md, SKILLS.md。プラットフォーム差分・スキル配備方針）
- .agent-skill-chain/source/human/README.md
- .agent-skill-chain/source/scripts/（setup.sh）。※ setup は配備の責務のため、将来的にパッケージ直下の `scripts/` に移す選択肢あり。現状は .agent-skill-chain/source/scripts/ で運用可。
- .agent-skill-chain/source/spec/（設計原則・設計判断の優先順位・AI開発ルール等。要求・設計 command の前に参照）

---

## スキル・agents の正本と配備先

メンテナが正本の場所と配備先の関係を一箇所で確認できるよう、対応を下表に示す。

| 正本（.agent-skill-chain/source 配下） | 配備先 |
|----------------------|--------|
| .agent-skill-chain/source/skills/ | .claude/skills/ 、 .cursor/skills/ （setup の sync_skills で同期） |
| .agent-skill-chain/source/agents/（README 等） | 配備先なし（参照用。agents テンプレートは .agent-skill-chain/runtime/templates/agents/ を参照） |
| .agent-skill-chain/runtime/templates/agents/（scribe テンプレート） | 手動で .claude/agents/ および .cursor/agents/ にコピー（後述） |

---

## 初回セットアップで生成するもの

- **.claude/hooks/**: .agent-skill-chain/source/enforcement/claude/ の PreToolUse.sh, PostToolUse.sh を配置。
- **.cursor/**: .agent-skill-chain/source/enforcement/cursor/ の agents-core.mdc 等を配置。
- **.claude/skills/**, **.cursor/skills/**: .agent-skill-chain/source/skills/ 配下の各 capability をコピー（SKILL.md 含む）。
- **.agent-skill-chain/runtime/templates/**: プロジェクトに存在しない場合、パッケージの **`.agent-skill-chain/runtime/templates/`** からコピーする。
- **.agent-skill-chain/runtime/workflow.db**: 存在しない場合のみ、setup の init_workflow_db で作成する（証跡用。配布物には含めない）。
- フックの正本は .agent-skill-chain/source/enforcement/ にあり、setup が各ツール向けに配備する。
- **scribe（agents テンプレート）**: 初回セットアップでは **.claude/agents/ および .cursor/agents/ には配置しない**。手動コピーを前提とする（理由は後述「scribe の利用手順」）。

---

## scribe（agents テンプレート）の利用手順

**結論: 手動コピーとする。** setup 脚本では .claude/agents および .cursor/agents へ scribe を配置しない。

- **手順**: scribe テンプレート（scribe_claude.md, scribe_cursor.md）の正本は **.agent-skill-chain/runtime/templates/agents/**（setup でテンプレートをコピー済みのプロジェクトではプロジェクトの `.agent-skill-chain/runtime/templates/agents/`）にあり、利用する場合は **手動で .claude/agents/ および .cursor/agents/ にコピーすること**。
- **理由**: 利用者による選択的コピーを想定し、既存の .claude/agents や .cursor/agents を setup で上書きしないため。必要なプロジェクト・環境にのみ配置できる。

---

## enforcement の opt-in（既定 off）

**結論: enforcement フック（PreToolUse/PostToolUse）の `.claude/settings.json` への配線は既定 off。ドッグフーディング時に明示的に opt-in する。** 常時 on にはしない（自己拡張・通常開発のノイズ回避。03_実装計画 §2.6）。配線はセッション挙動を変えるため、利用者が任意のタイミングで着脱できる。

| コマンド | 役割 |
|----------|------|
| `agents-md enforce on [dir]` | 正本テンプレート（`.agent-skill-chain/source/platforms/claude/settings.enforce.json`）から `.claude/settings.json` に enforcement 配線（`hooks.PreToolUse`/`PostToolUse`・`env.AGENT_ROLE=orchestrator` 等）をマージする。既存 settings.json があれば**ユーザー値を破壊せず**マージし、上書き前に `settings.json.bak` へ退避する。 |
| `agents-md enforce off [dir]` | enforcement 由来の配線（パッケージが注入した hook エントリ・managed env キー）のみを外す。ユーザーの他設定（env・hooks・permissions 等）は保持する。 |
| `agents-md enforce status [dir]` | 現在の on/off と hook スクリプト（`.claude/hooks/PreToolUse.sh`・`PostToolUse.sh`）の実在性を表示する。 |

- **正本テンプレート**: `.agent-skill-chain/source/platforms/claude/settings.enforce.json`。`hooks.PreToolUse`/`PostToolUse` を setup 配備物 `.claude/hooks/PreToolUse.sh`/`PostToolUse.sh` へ `${CLAUDE_PROJECT_DIR}` 相対で結線し、`env.AGENT_ROLE=orchestrator`・`env.AGENTS_ROOT` を設定する。各 hook エントリには `__agentsMdEnforce: true` の目印を付与し、`enforce off` で正確に除去する。
- **既定 install では書き込まない**: `init`/`setup` は `.claude/settings.json` に enforcement を**書かない**（off）。`doctor` は enforcement 配線の on/off と hook スクリプト実在性を表示する。
- **安全策**: `.claude/settings.json` が無効 JSON の場合、`enforce` は破壊を避けるため中止する（Claude 起動時エラーを事前に防ぐ）。

### settings.json の保持・上書き契約

| 対象 | init/upgrade | enforce on | enforce off | uninstall |
|------|--------------|-----------|-------------|-----------|
| **.claude/settings.json**（ユーザー値） | touch しない（保持） | **ユーザー値は保持**し enforcement 配線のみ追加（マージ・`.bak` 退避） | enforcement 配線のみ除去（ユーザー値は保持） | touch しない（ユーザー設定として保持） |

---

## init / upgrade / uninstall の保持・上書き契約（正本）

**結論: install/upgrade/uninstall は「パッケージ配備物」のみを管理し、ユーザー資産は破壊しない。** 再インストール・upgrade でユーザーが個人的に作成した project 固有ルールや自作エディタルールが消えることはない。判断に迷う場合は安全側（保持）に倒す。

### 所有区分（統合ルート `.agent-skill-chain/` の 3 サブディレクトリと配備先）

配備先の所有区分を名前だけで判別できるよう、下表に一覧する。**「消してよいもの（パッケージ所有）」と「消してはいけないもの（ユーザー資産）」を区別する単一の早見表**である（詳細契約は後続の各表）。

| 区分 | パス | 所有 | setup の扱い |
|------|------|------|-------------|
| パッケージ正本 | **`.agent-skill-chain/source/`** | パッケージ | 完全所有・毎回置換（再配備で最新化。復元可能） |
| プロジェクト固有オーバーライド | **`.agent-skill-chain/project/`** | ユーザー資産・不可侵 | **setup は touch しない**（作成も削除もしない）。`source/` より優先される |
| 消費者ランタイム生成物 | **`.agent-skill-chain/runtime/`** | 混在 | `runtime/templates/` のみパッケージ所有（毎回置換）。`runtime/<issue>/`・`runtime/workflow.db*` はユーザー資産・保持 |
| プラットフォーム配備先 | **`.claude/`・`.cursor/`** | 混在（プラットフォーム固定名） | ディレクトリ名はプラットフォーム側の固定名で**ネスト対象外**。パッケージ所有エントリ（hooks・所有 skill・所有ファイル）のみ更新し、ユーザー設定・自作物は保持 |

- `.agent-skill-chain/` 直下の `.package-manifest`・`README.md` は 3 サブディレクトリのいずれの所有物でもなく、統合ルート全体の識別・警告を担う setup 生成物である。
- `.agent-skill-chain/runtime/workflow.db` の由来検知欠如（sqlite3 有効性・`workflow_log` テーブル有無をファイル単位で検査しないためサイレントスキップし得る）は本パッケージのルート単位マーカーでは解消されない別軸の課題であり、サブ issue「workflowDB由来検知欠如是正」で扱う（当該 issue が旧レイアウトで記載する `workflow.db` の対象パスは `.agent-skill-chain/runtime/workflow.db` に読み替える）。

### 配備マーカーによる衝突検知・バックアップ・統合移行（fail-closed）

init/upgrade（setup）は、既存の `.agent-skill-chain/` を上書きする前に配備マーカー（`.agent-skill-chain/.package-manifest`＝`name`+`version`）で由来を検知する。**判定できない場合は必ず処理を中止して既存ファイルを保護する（fail-closed）。** この方針は enforcement 抽象仕様（系統A/C/E）の **fail-open**（判定不能でもブロックせず続行）とは**意図的に異なる**（衝突検知はユーザー資産の破壊的削除を対象とするため安全側に倒す）。両者を混同しないこと。判定規則の正本は `.agent-skill-chain/source/scripts/lib/package-manifest.sh`（`src/agents-md.ts` が同一規則をミラー）。

| 状況（`.agent-skill-chain/` の状態） | setup の挙動 |
|------|------|
| PROJECT_ROOT がパッケージ自身（PACKAGE_ROOT と実パス一致＝自己適用） | マーカー検査をスキップして続行（配備先がパッケージ正本そのものであることが実パス一致で確実なため。他人の無関係ディレクトリは一致せず本分岐に入らない） |
| `.agent-skill-chain/` が存在しない（新規配備） | `source/`・`runtime/templates/` を新規配備し、マーカー（`name`+`version`）と `README.md` 警告を生成（`project/` は作成しない） |
| マーカーが存在し `name` が本パッケージと一致（本パッケージ由来の再配備） | 上書き前に `source/`・`runtime/templates/` をタイムスタンプ付きでバックアップ退避（`.agent-skill-chain-source.bak.<ts>/`・`.agent-skill-chain-runtime-templates.bak.<ts>/`）してから最新化。**バックアップに失敗したら上書きを中止**（バックアップ成立を上書きの前提とする）。`project/`・`runtime/<issue>/`・`workflow.db*` は touch しない |
| `.agent-skill-chain/` は存在するがマーカー不在、または `name` 不一致 | **fail-closed で中止**（本パッケージ由来と確認できないため破壊的操作を一切行わない）。人間の判断を促すエラーを表示する |

**旧 3 ディレクトリからの統合移行パス（レガシー移行）**: `.agent-skill-chain/` が存在せず、旧名 `.agents/` が存在し、かつ**フィンガープリント**（`.agents/` 配下の `boot/CORE.md`・`scripts/setup.sh`・`enforcement/ci/audit.sh`・`ledger/schema.sql` の 4 ファイル AND 条件）が一致する場合のみ、本パッケージの旧バージョン配備とみなして統合移行する。手順は (1) 存在する各レガシーディレクトリ（`.agents/`・`.agents-project/`・`.workflow/`）を個別にタイムスタンプ付きバックアップへ退避（1 つでも失敗すれば移動せず中止＝部分移行を避け原本を保護）、(2) `.agents/`→`source/`・`.agents-project/`（存在時）→`project/`・`.workflow/`（存在時）→`runtime/` へ移動、(3) マーカー・`README.md` を生成、(4) 同一実行内で通常の再配備経路へ続行し `source/`・`runtime/templates/` を最新化。フィンガープリント不一致なら**中止**（既存ファイルは一切変更しない）。存在しないレガシーディレクトリはエラーにせずスキップし、`.agents-project/` 不在時は `project/` を作成しない（新規配備と同じ）。

### パッケージ管理（init/upgrade のたびに上書き・最新化される）

| 対象 | 種別 | 説明 |
|------|------|------|
| **.agent-skill-chain/source/** | 正本コピー | パッケージ正本。再 init で再配備し最新化する。 |
| **AGENTS.md, CLAUDE.md** | ルート契約 | パッケージ正本をルートへコピー（最新化）。 |
| **.agent-skill-chain/runtime/templates/** | テンプレート | パッケージの `.agent-skill-chain/runtime/templates/` から最新化する。 |
| **.cursor/agents-core.mdc**（enforcement/cursor の所有ファイル） | エディタルール | setup がパッケージ所有ファイルのみを上書き。**.cursor/ を丸ごと削除しない。** |
| **.cursor/skills/**（パッケージ配備分 {domain}__{capability}・ドメイン直下 {domain}） | 生成 skills | **パッケージ配備分のみ**毎回更新（古い版を消して再コピー）。**ユーザー自作スキルは保持**（共存可）。 |
| **.claude/hooks/**（パッケージ所有フックファイル） | enforcement | **パッケージ所有フックファイルのみ**毎回上書き。**ユーザー独自フックは保持**（共存可）。 |
| **.claude/skills/**（パッケージ配備分 {domain}__{capability}・ドメイン直下 {domain}） | 生成 skills | **パッケージ配備分のみ**毎回更新。**ユーザー自作スキルは保持**（共存可）。 |

> 注: `.cursor/skills/`・`.claude/skills/`・`.claude/hooks/` は **パッケージ配備分（既知エントリ）のみ**を毎回更新する。Claude Code では `.claude/skills/` はユーザーが自作スキルを置く一般的な場所であり、`.claude/hooks/` にも独自フックを置けるため、**ユーザー自作スキル/フックは保持され、パッケージ配備分と共存できる**。パッケージ skill のカスタムは `.agent-skill-chain/source/skills/` 正本を、フックは `.agent-skill-chain/source/enforcement/` 正本を編集して反映する。所有エントリの導出は単一定義（skills は `lib/deploy-skills.sh` の `list_owned_skill_names`、フックは `enforcement/claude` のトップレベルファイル）。

### ユーザー資産（保持・破壊しない）

| 対象 | 説明 |
|------|------|
| **.agent-skill-chain/project/** | project 固有ルール。setup は touch しない。**project 固有ルールは必ずここに置くこと**（推奨）。.agent-skill-chain/source より優先される。 |
| **.cursor/ 配下のユーザー作成物**（他の `rules/*.mdc`・独自ファイル・`.cursor/skills/` の自作スキル） | setup は `.cursor/` を丸ごと削除せず、パッケージ所有ファイル・所有 skill エントリのみ更新するため**保持**される。 |
| **.claude/ のユーザー設定・自作物**（`settings.json`・`.claude/skills/` の自作スキル・`.claude/hooks/` の独自フック） | setup は `.claude/hooks`・`.claude/skills` の**パッケージ配備分のみ**更新し、ユーザー設定・自作スキル・独自フックは touch しない（保持）。`settings.json` の enforcement 配線は `enforce on`/`off` でのみ着脱し、ユーザー値は破壊しない（§enforcement の opt-in）。 |
| **.agent-skill-chain/runtime/<issue>/** | issue 成果物（消費者ランタイム）。保持。 |
| **workflow.db** | 証跡 DB。初回のみ生成、既存は上書きしない（保持）。 |

**保証**: 上記の保持は E2E テスト `test/e2e-install-uninstall.sh` のシナリオ R1（再インストール保持）・R2（upgrade 保持）・R3（uninstall 保持）で再現確認される。

### 初回コピー時の挙動補足

| 対象 | 初回挙動 |
|------|----------|
| **AGENTS.md, CLAUDE.md** | 既存が無い場合にコピー。ソースと採用先が同一パスのときはスキップ。 |
| **.agent-skill-chain/source/** | 既存 .agent-skill-chain/source がソースと別パスなら削除して再コピー（最新化）。 |
| **.agent-skill-chain/runtime/templates/** | 未存在時にパッケージから最新化。 |
| **workflow.db** | setup の init_workflow_db で無い場合のみ作成。既存 DB は上書きしない。 |

---

## アンインストール（つけ外し）

プラグイン（配備一式）は簡単につけ外しできる。除去は CLI の `uninstall` サブコマンドで行う（正本は `bin/agents-md.js` の `runUninstall`）。setup/init が配備した成果物のみを除去し、人間が編集する資産は既定で保持する。

> GitHub 直接参照の詳細は [README.md §導入](../../README.md#導入プロジェクトへ配備するとき) を参照。

```bash
# 採用先プロジェクトのルートで実行
npx github:techbeansjp-free/AGENTS.md uninstall            # dry-run（削除対象の表示のみ。何も消さない）
npx github:techbeansjp-free/AGENTS.md uninstall --yes      # 実際に配備物を除去する
npx github:techbeansjp-free/AGENTS.md uninstall --purge --yes  # workflow.db 等の証跡も含め完全除去
```

| 対象 | 既定 `uninstall` | 説明 |
|------|------------------|------|
| **.agent-skill-chain/source/・AGENTS.md・CLAUDE.md** | 除去 | setup/init がコピー配備した正本（配備物）。 |
| **.claude/hooks の所有フック・.claude/skills と .cursor/skills の所有 skill エントリ** | 除去 | パッケージ配備分（既知エントリ）のみ。ディレクトリごとは消さない。 |
| **.cursor/ のパッケージ所有ファイル**（agents-core.mdc 等） | 除去 | enforcement 正本由来の配備ファイルのみ。 |
| **.agent-skill-chain/runtime/templates/** | 除去 | setup がコピーしたテンプレート（`.agent-skill-chain/runtime/` 自体は残す）。 |
| **.cursor/ 配下のユーザー作成物**（他の `rules/*.mdc`・`.cursor/skills/` の自作スキル等） | 保持 | `.cursor/` を丸ごと消さず、配備分のみ除去する。 |
| **.claude/ のユーザー設定・自作物**（settings.json・自作スキル・独自フック等） | 保持 | `.claude/` を丸ごと消さず、配備分のみ除去する。 |
| **.agent-skill-chain/project/** | 保持 | プロジェクト固有ルール（人間が編集する資産）。誤削除しない。 |
| **.agent-skill-chain/runtime/<issue>/**（templates 以外） | 保持 | issue 成果物（消費者ランタイム）。 |
| **workflow.db** | 保持（`--purge` 時のみ除去） | 証跡 DB。既定では残す。 |

> uninstall は `.cursor/`・`.claude/` を**丸ごと削除しない**。パッケージが配備した**既知エントリ**（`.cursor/agents-core.mdc`・`.claude/hooks` の所有フックファイル・`.claude/skills` と `.cursor/skills` の所有 skill エントリ {domain}__{capability}・{domain}）のみを除去し、ユーザー作成物（自作スキル・独自フック・自作 rules 等）が同居していれば残す。除去後に `.claude/hooks`・`.claude/skills`・`.cursor/skills`・`.cursor/`・`.claude/` が空になった場合のみ、空ディレクトリを片付ける。所有エントリ集合は setup.sh と単一整合（skills は `lib/deploy-skills.sh` の `list_owned_skill_names`、フックは `enforcement/claude` のトップレベルファイル、cursor 直下は `enforcement/cursor` のトップレベルファイル）。

**安全策**: 採用先に配備の痕跡（`.agent-skill-chain/source/` または `AGENTS.md`）が無い場合、誤削除を防ぐため uninstall を中止する。存在しない対象はスキップし、`--yes` を付けない限り削除は行わず対象の一覧表示（dry-run）に留める。`uninstall` の挙動は E2E テスト `test/e2e-install-uninstall.sh`（install→uninstall→冪等→カプセル化→リーク→**R1 再インストール保持・R2 upgrade 保持・R3 uninstall 保持**）で再現確認される。

---

## テスト実行（ローカルで全テストを 1 コマンド）

本リポジトリ（パッケージ正本／自己拡張）には `test/` 配下に複数のテストスクリプトがあり、**一括 runner で 1 コマンド実行**できる。検証ロジックは各テストスクリプトに集約（single source of truth）し、runner は呼ぶだけのラッパに徹する（CI とローカルで二重化しない）。

### 一括実行

```bash
npm test                                  # = bash test/run-all.sh
bash test/run-all.sh                      # npm を使わない場合
```

- 全テストを順に実行し、末尾に `合計=N PASS=p FAIL=f SKIP=s` のサマリを出力する。
- **終了コード契約**: すべて PASS/SKIP（FAIL=0）なら `exit 0`、1 件以上 FAIL なら `exit 1`（`npm test` の終了コードに伝播する）。
- **SKIP は失敗扱いにしない**。必須依存が欠けたテストは実行せず `[SKIP] <name>: 必須依存 <tool> なし` と案内して継続する（runner はクラッシュしない）。

### 個別実行

runner 導入後も各テストを従来どおり直接実行できる（呼び出し方・終了コードは不変）。

```bash
bash test/test-audit.sh
bash test/test-pretooluse-hook.sh
bash test/test-write-workflow-log-prevhash.sh
bash test/e2e-install-uninstall.sh
bash test/test-run-all.sh          # runner 自体のテスト
```

### 前提依存マトリクス

実行系の前提は **bash**。テストにより `git` / `node` / `tar` / `sqlite3` を追加で要する。**任意依存が無い環境**でも runner はクラッシュせず、当該テストを SKIP として案内し残りを実行する。

| テスト | 必須依存（runner が事前確認） | 任意依存（スクリプト内で SKIP） |
|--------|--------------------------------|----------------------------------|
| `test-run-all.sh` | bash | - |
| `test-audit.sh` | bash | sqlite3 / git（無くても SKIP→PASS） |
| `test-pretooluse-hook.sh` | bash・git・tar | jq（無い系統も検証） |
| `test-write-workflow-log-prevhash.sh` | bash・sqlite3 | - |
| `e2e-install-uninstall.sh` | bash・git・node・tar | sqlite3（あれば DB 検証も実施） |

> 依存の正本は各スクリプト冒頭の「前提」記載。終了コード規約は自己完結で次のとおり定める（外部の issue 記録に依存しない）。**個別テスト**: `0`=PASS / `2`=SKIP（必須依存の欠如）/ その他=FAIL。**runner（`test/run-all.sh`）**: 全テストを順に実行し、末尾に `合計=N PASS=p FAIL=f SKIP=s` を出力する。1 件以上 FAIL なら `exit 1`、すべて PASS/SKIP なら `exit 0`。SKIP は失敗扱いにしない。

### tmp 隔離（破壊禁止）

各テストは `mktemp -d`（＋ `git archive HEAD`）でクリーン環境を再現して実行し、開発リポの `.agent-skill-chain/source/` `.claude/` `.cursor/` `.agent-skill-chain/runtime/` `workflow.db` を変更・破壊しない。runner 自身も開発リポへ書き込まない（隔離は各スクリプトの責務）。

---

## スモークテスト（セットアップ後）

本セクションは簡易確認。**正式な導入完了確認は「導入完了チェックリスト」を参照**すること。

- プロジェクトルートに AGENTS.md が存在する。
- .agent-skill-chain/source/ に boot/CORE.md, LOAD_POLICY.md, workflow/PHASES.md, workflow/TEMPLATES.md, commands/, skills/, ledger/schema.md が存在する。
- .agent-skill-chain/runtime/templates/ はパッケージの `.agent-skill-chain/runtime/templates/` からコピーされる（未存在時）。00_要求定義.md 〜 04_review.md 等を参照。
- command 実行時は .agent-skill-chain/source/commands/{name}.md と .agent-skill-chain/source/skills/agent/run_command.md を読めること。
- .agent-skill-chain/source/GETTING_STARTED.md が存在すること。
- .claude/hooks/ に PreToolUse.sh, PostToolUse.sh が存在する（enforcement に配置している場合）。
- .cursor/ に agents-core.mdc が存在する（enforcement に配置している場合）。
- .claude/skills/ および .cursor/skills/ に各 capability ディレクトリが存在する。
- .agent-skill-chain/source/spec/ に設計原則・設計判断の優先順位等が存在する。

---

## 導入完了チェックリスト（1 ページ）

セットアップ実行後、次を 1 ページで確認する。すべて満たせば導入完了とする。

| # | 確認項目 | 確認方法 |
|---|----------|----------|
| 1 | **コピー対象が揃っているか** | プロジェクトルートに AGENTS.md、.agent-skill-chain/source/ が存在する。.agent-skill-chain/source/ に boot/, workflow/, commands/, skills/, enforcement/, scribe/, ledger/ が存在する。 |
| 2 | **.agent-skill-chain/project の有無と優先確認** | プロジェクト固有ルールを使う場合は .agent-skill-chain/project/ をプロジェクトルートに用意する。.agent-skill-chain/source より優先される（AGENTS.md §読み込み順・CORE §ルールの優先順位）。 |
| 3 | **commands が呼べるか** | .agent-skill-chain/source/commands/ に requirement-discovery, design-feature, implement-feature, verify-and-close が存在する。.agent-skill-chain/source/skills/agent/run_command.md が読めること。 |
| 4 | **enforcement が有効か** | .claude/hooks/ に PreToolUse.sh, PostToolUse.sh が存在する（Claude 利用時）。.cursor/ に agents-core.mdc が存在する（Cursor 利用時）。.agent-skill-chain/source/enforcement/ci/audit.sh が存在する。 |
| 5 | **workflow.db へ書記ログが 1 件入るか** | .agent-skill-chain/runtime/workflow.db が存在する（無ければ ledger/schema.md に従い作成）。verify-and-close または write-workflow-log を 1 回実行し、execution_logs に 1 件以上記録されることを確認する。書記は唯一の記録者（scribe/README.md）。 |
| 6 | **pre-push / CI が最低限動くか** | 採用する場合、.github/workflows/ に subagent-guard（実体: `.agent-skill-chain/runtime/templates/github/scripts/subagent-guard.sh`）または audit（`.agent-skill-chain/source/enforcement/ci/audit.sh`）を呼ぶワークフローを配置する。pre-push フックを採用する場合は scripts/pre-push が実行可能であること。subagent-guard が検査するのは内部参照禁止（#6 相当）・ログ frontmatter 禁止・`logs/` 廃止の 3 点のみ（判定ルールの正本は `.agent-skill-chain/source/enforcement/README.md` §失敗条件と差し戻し）。 |

**失敗系テストの推奨**: 導入後、わざと違反ケース（例: 03_実装計画.md のみ存在し 04_review.md を書かない、memo のプレフィックスを誤った形式にする）を作り、audit.sh が FAIL すること・pre-push が push を止めること・CI が reject することを確認すること。存在確認と実効性は別のため、失敗系テストで実効性を確認する。

上記のうち、プロジェクトで利用しないツール（例: Claude のみで Cursor を使わない）の項目はスキップしてよい。必須なのは 1・2・3 および、ログを運用する場合は 5。enforcement と CI は強く推奨する。

---

## 不要ファイル・削除済み／整理方針

**配布に含めない**: 保守用・実装レビュー用の文書は **.agent-skill-chain/source 外**（例: **docs/maintainer/**）に置き、プロジェクトへはコピーしない。setup は .agent-skill-chain/source/ 等のコピー対象のみを配備する。**workflow.db の実体および workflow.db-wal / workflow.db-shm はテンプレート・OSS 配布に絶対に含めない**。証跡 DB は setup（.agent-skill-chain/source/scripts/setup.sh の init_workflow_db）で生成する。

- **COPY_TO_PROJECT_ROOT_AGENTS.md** — 廃止済み。正本は本ファイル（SETUP.md）のみ。コピー対象・セットアップは本ファイルと setup 脚本に一元化する。
- **spec/** — パッケージ直下からは削除済み。正本は **.agent-skill-chain/source/spec/** に移動し、要求・設計 command の前に参照する。
- **.review/** — 規約全体のレビュー履歴。パッケージ配布には不要なため削除済み。
- **v2/・v3/** — 削除済み。正本はパッケージ直下と .agent-skill-chain/source に統一している。
- **OSS化ロードマップ.md** — リポジトリ保守向けのタスク一覧。配布物には不要なため削除済み。
- **examples/** — 導入レベル別のコピペ例。導入は **setup 脚本 1 本**（.agent-skill-chain/source/scripts/setup.sh）に統一したため削除済み。
