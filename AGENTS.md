# AGENTS.md — 入口案内

**メインエージェントは進行役（orchestrator）としてのみ動作し、実作業（実装・編集・設計・レビュー本文・コマンド実行）はサブエージェントに委譲する。** 作業依頼を受けたら phase 判定 → command 選択 → 委譲のみ行う（委譲できない環境では委譲計画のみを返す）。成果物が 01_要件定義.md / 02_設計.md / 03_実装計画.md 等のドキュメントである command を実行する場合は、メインは実作業（ドキュメント本文の執筆・編集）を行わず、サブに委譲する。

- **依頼タイプ**（作業依頼 vs 質問・分析依頼）の振る舞い: [CORE](.agents/boot/CORE.md) §依頼タイプ別振る舞い。
- **委譲フロー**のパターン（説明＋計画までメイン／計画も含めてサブ）: [CORE](.agents/boot/CORE.md) §委譲フローのパターン。
- **委譲の実行手段**（Cursor 上で何を呼ぶか）: [.agents/skills/agent/run_command.md](.agents/skills/agent/run_command.md) の 1 か所で規定。
- **委譲できない環境**では委譲計画のみを返し実作業は行わない: [CORE](.agents/boot/CORE.md) §依頼タイプ別振る舞い。
- **フォールバック方針**（必要に応じてメインが実作業することを許容）: [CORE](.agents/boot/CORE.md) §フォールバック方針。
- **HEARTBEAT 読了**の強制: [CORE](.agents/boot/CORE.md) §Heartbeat。

---

**通常依頼でも agents を自動適用する。** ユーザーが「〇〇して」とだけ言った場合でも、明示がなくても次のように動く。

- **解釈**: 全依頼を **agents workflow** で解釈する。
- **進行役**: 常に **orchestrator** とする。phase 判定 → command 選択 → 委譲を行う。
- **自動選択**: 必要に応じて **sub-agent / skills / commands** を自動選択し、適用する。
- **出力**: 必ず [.agents/IO_CONTRACT.md](.agents/IO_CONTRACT.md) および [.agents/RULES.md](.agents/RULES.md) に従う。

軽作業時の実行モード（quick / standard / full）・違反時の失敗条件と差し戻し先は後述および [.agents/enforcement/README.md](.agents/enforcement/README.md) に従う。

> **実行契約の正本**: [.agents/boot/CORE.md](.agents/boot/CORE.md)（AI はここを必ず読む）。読込順・いつ何を読むかは [.agents/boot/LOAD_POLICY.md](.agents/boot/LOAD_POLICY.md) に委譲。

---

## 標準実行モード

上記のとおり、明示がなくても **agents workflow** に従って解釈する。進行役は常に orchestrator。sub-agent / skill / rule は明示的に禁止されていない限り適用する。出力は IO_CONTRACT に従う。依頼受付時に仕様・設計・実装・レビューのいずれの段階かを最初に判定する。規模に応じた **quick / standard / full** は [.agents/RULES.md](.agents/RULES.md) の実行モードを参照する。

---

## 読み込み順・優先順位（絶対）

**読む順番は次の 1 か所で固定する。** 運用でブレないため、入口ではこの順を守ること。

| 順 | 対象 | 備考 |
|----|------|------|
| 0 | **.agents-project/**（プロジェクトルート） | **存在すれば最優先**。.agents より優先（CORE §ルールの優先順位）。 |
| 1 | 本ファイル（**AGENTS.md**） | 人間・AI の入口。 |
| 2 | .agents/boot/**CORE.md** | 実行契約の正本。 |
| 3 | .agents/**IO_CONTRACT.md** | command / skill の入出力契約。 |
| 4 | .agents/**RULES.md** | 実行・ドキュメント・テスト要約・実行モード。 |
| 5 | .agents/**GETTING_STARTED.md** | メイン・サブの手順要約。 |
| 6 | .agents/workflow/**PHASES.md** | フェーズ・成果物・DoD。 |
| 7 | .agents/**commands/** および 該当 command | 実行時は LOAD_POLICY に従い run_command と commands/{name}.md を読む。 |

トリガー別の「いつ何を読むか」の詳細は [.agents/boot/LOAD_POLICY.md](.agents/boot/LOAD_POLICY.md) に委譲する。詳細ルールは各 spec / skills / enforcement を参照する。

---

## 何があるか

- **人間・ツールの入口**: 本ファイル。詳細は [.agents/README.md](.agents/README.md) を参照。
- **プロジェクト固有・最優先**: プロジェクトルートの **.agents-project/** が .agents より優先される。同名・同目的のルールは .agents-project を採用（.agents/CORE.md §ルールの優先順位）。
- **AI の契約**: .agents/boot/CORE.md（正本）。思想は .agents/CONCEPTS.md、読込順は LOAD_POLICY へ委譲。
- **ワークフロー**: .agents/workflow/PHASES.md（フェーズ = gate）。**実行単位は command**（skill chain）。.agents/commands/ を参照。
- **command 実行時**: LOAD_POLICY の表に従い、.agents/skills/agent/run_command.md と .agents/commands/{name}.md を読む。
- **単体 capability**: .agents/skills/{domain}/{capability}/ を LOAD_POLICY に従い読む。
- **違反時**: 失敗条件と差し戻し先は [.agents/enforcement/README.md](.agents/enforcement/README.md) §失敗条件と差し戻しに従う。CI および subagent-guard が同一の判定ルールを参照する。

---

## 変更マップ

| 変えたいもの | 見るファイル |
|--------------|--------------|
| 絶対制約・読了義務 | .agents/boot/CORE.md |
| いつ何を読むか・command/capability トリガー | .agents/boot/LOAD_POLICY.md |
| フェーズ・成果物・DoD | .agents/workflow/PHASES.md |
| 実行モード（full/standard/quick） | .agents/RULES.md |
| command 実行の形・skill chain | .agents/skills/agent/run_command.md と .agents/commands/ |
| 構成・索引 | .agents/README.md |
| 失敗条件・差し戻し先 | .agents/enforcement/README.md |
| プロジェクト固有ルール（最優先） | プロジェクトルートの .agents-project/ |
| コピー対象・セットアップ詳細 | .agents/SETUP.md |
| 基盤の肥大化防止・文書追加ルール | .agents/META_LAYER.md |

---

詳細は .agents 配下を参照する。中心は **skill（能力）** と **command（skill chain）**。
