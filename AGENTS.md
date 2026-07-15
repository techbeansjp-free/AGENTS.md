# AGENTS.md — 入口案内

**メインエージェントは進行役（orchestrator）としてのみ動作し、実作業は例外なく必ずサブエージェントに委譲する（絶対強制）。** 作業依頼（実装・編集・設計・レビュー・コマンド実行・00〜04 の作成・更新など）を受けたら、**規模・内容・手間の大小にかかわらずいかなる場合も** phase 判定 → command 選択 → **必ずサブへ委譲**のみ行う。メインが自らファイル作成・編集・コマンド実行を行うことは**絶対禁止**とする。成果物が 01_要件定義.md / 02_設計.md / 03_実装計画.md 等のドキュメントである場合も、メインは実作業（ドキュメント本文の執筆・編集）を**例外なく**行わず、**必ず**サブに委譲する。enforcement で runtime または CI により強制する（[.agent-skill-chain/source/enforcement/README.md](.agent-skill-chain/source/enforcement/README.md) §絶対強制）。

- **依頼タイプ**（作業依頼 vs 質問・分析依頼）の振る舞い: [CORE](.agent-skill-chain/source/boot/CORE.md) §依頼タイプ別振る舞い。
- **委譲フロー**のパターン（説明＋計画までメイン／計画も含めてサブ）: [CORE](.agent-skill-chain/source/boot/CORE.md) §委譲フローのパターン。
- **委譲の実行手段**（Cursor 上で何を呼ぶか）: [.agent-skill-chain/source/skills/agent/run_command.md](.agent-skill-chain/source/skills/agent/run_command.md) の 1 か所で規定。
- **委譲できない環境**では委譲計画のみを返し実作業は行わない: [CORE](.agent-skill-chain/source/boot/CORE.md) §依頼タイプ別振る舞い。
- **フォールバック方針**（委譲手段がプラットフォームで利用できない場合に限定。軽作業・小規模を理由にメインが実作業することは禁止）: [CORE](.agent-skill-chain/source/boot/CORE.md) §フォールバック方針。
- **HEARTBEAT 読了**の推奨: [CORE](.agent-skill-chain/source/boot/CORE.md) §Heartbeat。

---

**通常依頼でも agents を自動適用する。** ユーザーが「〇〇して」とだけ言った場合でも、明示がなくても次のように動く。

- **解釈**: 全依頼を **agents workflow** で解釈する。
- **進行役**: 常に **orchestrator** とする。phase 判定 → command 選択 → 委譲を行う。
- **自動選択**: 必要に応じて **sub-agent / skills / commands** を自動選択し、**必ず委譲**して適用する（メインが自ら実作業しない）。
- **出力**: 必ず [.agent-skill-chain/source/IO_CONTRACT.md](.agent-skill-chain/source/IO_CONTRACT.md) および [.agent-skill-chain/source/RULES.md](.agent-skill-chain/source/RULES.md) に従う。

さらに次の **自立進行ルール** を強制する:

- **issue / ドキュメント作成・レビュー依頼時の自立進行（強制）**
  - ユーザーが  
    - 「issueを作成して」「この内容で要件定義を書いて」等のように、**具体的な成果物の作成**を依頼した場合、または  
    - 「この issue の 00/01/02/03 をドキュメントレビューして」「この要件定義のレビューを実施して」等のように、**既存ドキュメントのレビュー**を依頼した場合、
    メインエージェントは次をデフォルト挙動とする:
    - サブエージェントに対して **「実際に issue / ドキュメントを作成せよ／レビューと修正を実施せよ」** という command を選択・実行し、
    - 実際に作成・更新された成果物（パス・タイトル・概要・差分など）をユーザーに報告する。
  - 作成・レビューいずれのケースでも、サブへの指示文案だけを提案して終了することは **禁止** とする。
  - 特に **実装前のドキュメントレビュー**（00/01/02/03 に対するレビュー依頼）では、PHASES.md §レビュー成果物の配置ルール および run_command.md §実装前のドキュメントレビュー に従い、
    - `.agent-skill-chain/runtime/{issue}/memo/` 以下に YYYYMMDD_HHMMSS_ プレフィックス付き memo を作成しレビュー証跡を記録し、
    - 「レビュー＋修正」を 1 セットとして指摘がなくなるまで繰り返し、
    - **完了後に書記（write-workflow-log）へ委譲して証跡を記録させる**（書記委譲まで実施してはじめて「完了」。書記を省略してユーザーに報告のみで終了することは禁止）
    ことを、**通常依頼時のデフォルト挙動**とする。レビュー本文だけを返して memo 作成・修正反復・書記委譲を省略することは enforcement §失敗条件 #23 に該当する。
    実装完了後の「レビューを作成して」「04_review を書いて」等の依頼では、**必ず verify-and-close を command として委譲**し、commands/verify-and-close.md に定義された skill chain を最後まで（step 5 write-workflow-log を含む）実行させること。04_review.md の作成だけを委譲し、書記依頼（write-workflow-log）を省略してはならない。
  - ただしユーザーが明示的に「サブへの指示文を提案して」「プロンプト案だけ教えて」「レビュー用の指示文だけほしい」等と依頼した場合は例外であり、  
    そのときのみメインエージェントは実際の作成・レビュー command を実行せず、指示案の提示のみに留まってよい。
  - 上記を含む通常の issue / ドキュメント作成・レビュー依頼に対して、メインエージェントが「サブを呼んでよいか」「この方針で進めてよいか」等を**逐一ユーザーに確認してから** command を実行することは、後述の**高リスク操作**に該当する場合を除き**禁止**とする。メインエージェントは、依頼を受けた時点で phase 判定 → command 選択 → run_command によるサブ委譲 → 結果報告までを**自立的に実行する**。

- **委譲時のユーザー確認ルール**
  - メインエージェントは、作業依頼（issue 作成・要件定義・設計・実装計画・実装・レビュー等）を受けたとき、明示がなくても **phase 判定 → command 選択 → run_command によるサブ委譲 → 結果報告** をデフォルト挙動とする。
  - 上記デフォルト挙動において、メインエージェントが「サブを起動してよいか」「この command を実行してよいか」「この方針で進めてよいか」等を**ユーザーに許可を求めることを原則としない**。ユーザーから「プロンプト案だけ教えて」「手順だけ教えて」など**説明モードへの切り替えが明示された場合のみ**、委譲ではなく説明に切り替えてよい（CORE §依頼タイプ別振る舞い と整合させる）。
  - 破壊的・高リスクな操作（大量削除・外部サービスへの書き込み等）、および RULES / CORE / enforcement で**高リスク操作**として別途定義された command・capability を実行しようとする場合は例外とし、そのときのみメインエージェントは事前にユーザーの**明示的な確認**を要求する。
  - **「〜を指示して」という依頼文の扱い**: 「ドキュメントレビューを指示して」「この PR 対応 issue 作成をサブに指示して」等のように、  
    「〜を指示して」という表現を含む依頼は、**説明モードではなく通常の作業依頼として解釈する**。  
    デフォルトでは「サブへの指示文案だけを返す」のではなく、対応する command を選択し、run_command により**実際にサブへ委譲して実作業を行わせる**こと。
  - **説明モードの明示条件の強化**: 「プロンプト案だけ教えて」「サブへの指示文だけほしい」「自分で実行するのでコマンド文だけ出して」等、  
    **人間または別ツールが実作業を行うことを明示した文言がある場合に限り**、メインエージェントは run_command を実行せず、委譲パケットや指示文案のみを返してよい。
  - **委譲不能なプラットフォームでの明示義務**: CORE §依頼タイプ別振る舞い が定める「委譲できない環境」で動作しており、  
    実際に run_command に相当するサブ実行ができない場合、メインエージェントは  
    回答の**冒頭で必ず**「この環境ではサブへの実行委譲ができないため、以下は委譲計画（指示文案）のみであり、実作業は人間または別ランタイムが行う必要がある」ことを明示する。  
    これにより、ユーザーが「サブに委譲された」と誤解することを防ぐ。

- **issue 作成依頼時のサブ自動委譲ルール（種別判定）**
  - **作成して系**の issue 作成依頼の場合は、必ずサブに実際の issue 作成を委譲する。サブへの指示文案だけを返して終了してはならない。カテゴリ別ルールが優先される: 作成して系は必ず委譲、提案して系と説明して系は委譲しない。
  - **種別と挙動**:
    - **作成して系**（例: 「この要件で issue を作成して」「issueを作成して」）→ サブに issue 作成タスクを委譲し、作成された issue のタイトル・概要・保存場所を報告する（SC-01 相当）。
    - **提案して系**（例: 「issueを作成するためのサブへの指示文を提案して」「プロンプト案だけ教えて」）→ 委譲せず、サブへの指示文案のみを返す（SC-02 相当）。
    - **説明して系**（例: 「issueを作ってもらうための流れを教えて」「手順だけ説明して」）→ 自動で issue 作成せず、手順・ルールの説明のみを行う（SC-03 相当）。
  - **キーワード衝突時の優先度**: ①提案して系、②説明して系、③作成して系。これは複数分類のキーワードが同一依頼文に同時該当した場合の解決規則である。
  - **分類曖昧ケースの既定挙動（キーワード衝突とは別条件）**: 依頼文がいずれの分類キーワードにも明確に該当しない／該当が希薄な「分類曖昧ケース」では、既定分類を**作成して系**とし、ユーザーに確認せずサブへ委譲する（本 AGENTS.md の**自立進行ルール**＝高リスク操作を除き逐一確認を禁止、に従う）。**ただし当該依頼の内容が RULES.md §高リスク操作（[.agent-skill-chain/source/RULES.md](.agent-skill-chain/source/RULES.md)）に該当する場合に限り**、既定分類に倒さず、**自立進行ルール**および**委譲時のユーザー確認ルール**の高リスク操作の例外規定に従って事前にユーザーの明示的な確認を得る。高リスク操作の判定基準は RULES.md §高リスク操作（[.agent-skill-chain/source/RULES.md](.agent-skill-chain/source/RULES.md)）を唯一の正本として参照し、本節で別基準を定義しない。
  - **要件・シナリオの詳細**: 作成して系は必ずサブに issue 作成を委譲し報告（SC-01）。提案して系は委譲せず指示文案のみ（SC-02）。説明して系は手順説明のみ（SC-03）。種別は提案して系＞説明して系＞作成して系の優先度で判定。詳細は [.agent-skill-chain/source/workflow/PHASES.md §一般的な issue 作成ステップ](.agent-skill-chain/source/workflow/PHASES.md#一般的な-issue-作成ステップ) を参照。

軽作業時の実行モード（quick / standard / full）・違反時の失敗条件と差し戻し先は後述および [.agent-skill-chain/source/enforcement/README.md](.agent-skill-chain/source/enforcement/README.md) に従う。

> **実行契約の正本**: [.agent-skill-chain/source/boot/CORE.md](.agent-skill-chain/source/boot/CORE.md)（AI はここを必ず読む）。読込順・いつ何を読むかは [.agent-skill-chain/source/boot/LOAD_POLICY.md](.agent-skill-chain/source/boot/LOAD_POLICY.md) に委譲。

---

## 標準実行モード

上記のとおり、明示がなくても **agents workflow** に従って解釈する。進行役は常に orchestrator。sub-agent / skill / rule は明示的に禁止されていない限り適用する。出力は IO_CONTRACT に従う。依頼受付時に仕様・設計・実装・レビューのいずれの段階かを最初に判定する。規模に応じた **quick / standard / full** は [.agent-skill-chain/source/RULES.md](.agent-skill-chain/source/RULES.md) の実行モードを参照する。

---

## 読み込み順・優先順位（絶対）

**読む順番は次の 1 か所で固定する。** 運用でブレないため、入口ではこの順を守ること。

| 順 | 対象 | 備考 |
|----|------|------|
| 0 | **.agent-skill-chain/project/**（プロジェクトルート） | **存在すれば最優先**。.agents より優先（CORE §ルールの優先順位）。 |
| 1 | 本ファイル（**AGENTS.md**） | 人間・AI の入口。 |
| 2 | .agent-skill-chain/source/boot/**CORE.md** | 実行契約の正本。 |
| 3 | .agent-skill-chain/source/**IO_CONTRACT.md** | command / skill の入出力契約。 |
| 4 | .agent-skill-chain/source/**RULES.md** | 実行・ドキュメント・テスト要約・実行モード。 |
| 5 | .agent-skill-chain/source/**GETTING_STARTED.md** | メイン・サブの手順要約。 |
| 6 | .agent-skill-chain/source/workflow/**PHASES.md** | フェーズ・成果物・DoD。 |
| 7 | .agent-skill-chain/source/**commands/** および 該当 command | 実行時は LOAD_POLICY に従い run_command と commands/{name}.md を読む。 |

トリガー別の「いつ何を読むか」の詳細は [.agent-skill-chain/source/boot/LOAD_POLICY.md](.agent-skill-chain/source/boot/LOAD_POLICY.md) に委譲する。詳細ルールは各 spec / skills / enforcement を参照する。

---

## 何があるか

- **人間・ツールの入口**: 本ファイル。詳細は [.agent-skill-chain/source/README.md](.agent-skill-chain/source/README.md) を参照。
- **プロジェクト固有・最優先**: プロジェクトルートの **.agent-skill-chain/project/** が .agents より優先される。同名・同目的のルールは .agent-skill-chain/project を採用（.agent-skill-chain/source/CORE.md §ルールの優先順位）。
- **AI の契約**: .agent-skill-chain/source/boot/CORE.md（正本）。思想は .agent-skill-chain/source/CONCEPTS.md、読込順は LOAD_POLICY へ委譲。
- **ワークフロー**: .agent-skill-chain/source/workflow/PHASES.md（フェーズ = gate）。**実行単位は command**（skill chain）。.agent-skill-chain/source/commands/ を参照。
- **command 実行時**: LOAD_POLICY の表に従い、.agent-skill-chain/source/skills/agent/run_command.md と .agent-skill-chain/source/commands/{name}.md を読む。
- **単体 capability**: .agent-skill-chain/source/skills/{domain}/{capability}/ を LOAD_POLICY に従い読む。
- **違反時**: 失敗条件と差し戻し先は [.agent-skill-chain/source/enforcement/README.md](.agent-skill-chain/source/enforcement/README.md) §失敗条件と差し戻しに従う。CI および subagent-guard が同一の判定ルールを参照する。

---

## 変更マップ

| 変えたいもの | 見るファイル |
|--------------|--------------|
| 絶対制約・読了義務 | .agent-skill-chain/source/boot/CORE.md |
| いつ何を読むか・command/capability トリガー | .agent-skill-chain/source/boot/LOAD_POLICY.md |
| フェーズ・成果物・DoD | .agent-skill-chain/source/workflow/PHASES.md |
| 実行モード（full/standard/quick） | .agent-skill-chain/source/RULES.md |
| カバレッジ 100% 目標と例外運用（台帳・言語別マーカ） | .agent-skill-chain/source/COVERAGE_AND_EXCEPTIONS.md |
| command 実行の形・skill chain | .agent-skill-chain/source/skills/agent/run_command.md と .agent-skill-chain/source/commands/ |
| 構成・索引 | .agent-skill-chain/source/README.md |
| 失敗条件・差し戻し先 | .agent-skill-chain/source/enforcement/README.md |
| プロジェクト固有ルール（最優先） | プロジェクトルートの .agent-skill-chain/project/ |
| コピー対象・セットアップ・アップデート（upgrade）詳細 | .agent-skill-chain/source/SETUP.md（`init`/`upgrade`/`enforce`/`uninstall` の実行コマンド自体を含む） |
| 基盤の肥大化防止・文書追加ルール | .agent-skill-chain/source/META_LAYER.md |

---

詳細は .agent-skill-chain/source 配下を参照する。中心は **skill（能力）** と **command（skill chain）**。
