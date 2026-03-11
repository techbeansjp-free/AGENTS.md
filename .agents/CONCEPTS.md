# CONCEPTS.md — 思想・判断の問い

CORE から思想を委譲する先。UNIX 哲学に基づく開発を前提とする。本規約は skill-first。中心は能力（capability）であり、command は skill の chain、phase は gate。**システム開発の基本方針・設計原則・アーキテクチャで最初に考慮すべきことは [spec/](spec/) にあり、要求発見・設計の command 実行前に参照すること。**

---

## 原則

- **単一責任**: 1 ファイル 1 責務。正本は 1 か所。
- **疎結合**: 参照は「〇〇は △△ を参照」の 1 行に限定。重複記載をしない。
- **KISS / YAGNI**: 必要最小の強制（ワークフロー入口・フェーズ順・証跡の残し方）まで。肥大化したら分割可能とする。
- **skill-first**: 主語は役割ではなく**能力**。1 skill = 1 目的の最小部品。command = skill を束ねる実行単位。

---

## 用語規約

**正本はここ 1 か所のみ。** テンプレート・他ドキュメントでは「用語は .agents/CONCEPTS.md §用語規約 を参照」と 1 行で参照すること。

- **プロジェクト**: 要求〜実装まで一連の成果物で扱う単位。テンプレートの「プロジェクト名」は、規模に応じて issue/タスク名で置き換えてよい。
- **issue**: プロジェクトを分割する際の単位。複数のタスクを含むこともある。
- **タスク**: 実装計画書（`03_実装計画.md`）で定義する個別の作業単位。
- **使い分け**: **issue とタスクは必要に応じて置き換え可能**。プロジェクトの規模や管理方法に応じて、適切な粒度で使い分ける。小さな単位では「タスク」、大きな単位では「issue」として扱うことが多い。

---

## 設計方針

- **skills/**: ドメイン別・能力単位。`skills/requirements/write-bdd/`, `skills/architecture/design-api-contract/` のように、**スキル = 能力**で切る。各 skill は **契約付きフィルタ** として定義する（Purpose・Inputs・Process・Outputs・Done・Forbidden）。共通契約は [IO_CONTRACT.md](IO_CONTRACT.md)。orchestrator は Input を渡し、skill は Output を返し、command は Output を次の Input へ流す。hooks は Done/Forbidden の周辺を検証できる。説明書ではなく入出力契約で逸脱を減らす。
- **commands/**: skill chain。phase に紐づく「どの skill をどの順で使うか」を 1 ファイルで定義する。**command = filter**。各 command は共通の契約セクション（INPUT / PROCESS / OUTPUT / DONE）を持つ。詳細は [IO_CONTRACT.md](IO_CONTRACT.md)。
- **workflow/**: phase = 状態 gate、および成果物テンプレート（TEMPLATES.md）のみ。どの phase でどの command を起動するかは PHASES.md で定義する。
- **platforms/**: プラットフォーム差分（入口・設定・**スキル形式・配備方針**）を集約する。スキル配備の詳細は platforms/SKILLS.md。
- **agents/**: オーケストレーションと役割の最小定義（orchestrator, auditor, scribe）。誰がいつどの command を回すかは agents/README.md と各 agents/*.md。**司令塔は必要だが主役ではない**。orchestrator は phase 遷移・command 選択・委譲・証跡確認に限定し、詳細手順・成果物フォーマット・domain 知識は持たない（agents/orchestrator.md §持たないもの）。
- **enforcement/**: 違反経路を塞ぐ。配置するファイルは enforcement/README.md の表に従う。setup が .claude/・.cursor/・CI へ展開する。
- **スキル形式**: 正本は .agents/skills/{domain}/{capability}/ に 1 か所。各 capability に SKILL.md を置き、setup で各ツールの skills ディレクトリにコピーする。詳細は platforms/SKILLS.md。

参照: [pm-skills](https://github.com/phuryn/pm-skills)、[Claude Code - Skills](https://code.claude.com/docs/en/skills)、[Agent Skills](https://agentskills.io/)。

---

## 判断の問い

- 変更したいとき、どのファイルを触ればよいか明確か。
- command 実行時、該当 command と skill chain が渡されているか。
- 証跡（memo・ログ）が規約に従っているか（YYYYMMDD_HHMMSS_ 等）。
- 呼び出しているのは「役割」か「能力」か。必要なら command として skill を chain しているか。

---

## 既知の注意点・対応済み

1. **sync_skills の名前衝突** → **対応済み**。配備先を `{domain}__{capability}` にしている（scripts/setup-agents-spec.sh）。設計の経緯は platforms/DESIGN_SYNC_SKILLS_NAMING.md。
2. **command 名と capability 名の衝突余地**: 新規 command または capability 追加時は、RULES.md の「命名」に従い「command 名と capability 名の対応・命名方針」を一度確認する。概念名が近い（例: commands/design-feature.md と skills/architecture/design-feature/）と混乱しうるため。
3. **「何を読むか」の重複リスク** → **対応済み**。正本は boot/LOAD_POLICY.md のみ。GETTING_STARTED は要約・platforms はスキル形式・配備のみ。トリガー追加時は LOAD_POLICY のみ更新（各ファイル冒頭で正本を明記済み）。

---

## 外部根拠の必須化（external anchor）

この基盤は**内部整合性**（順序・必須項目・証跡）を強く保証するが、**外部真実**（記述が現実と一致するか）は単独では保証できない。そのため verify-and-close またはレビューでは、**少なくとも 1 つは外部根拠**を要求する。

**外部根拠の例**: 人間の承認済み要求、既存システム実測、API 実レスポンス、テスト実行ログ、issue/PR URL、参照元ドキュメントの明示など。

**evidence_source（根拠の種別）**: 重要判断・レビュー結果ごとに根拠を分類する。

| 種別 | 説明 |
|------|------|
| human_decision | 人間の承認・判断 |
| observed_runtime | 既存システム・実行環境の実測 |
| existing_code | 既存コード・実装の確認 |
| external_spec | 外部仕様・ドキュメント |
| test_output | テスト実行ログ・結果 |
| inference_only | 推論のみ（外部観測なし） |

**inference_only のみの重要判断は承認不可または要注意**とする。参照元を明示する方針（cursor_rules 等）と整合する。
