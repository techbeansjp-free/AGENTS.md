# GETTING_STARTED — 使い方（1 ページ）

**通常依頼でも agents を自動適用する。** ユーザーが「〇〇して」とだけ言った場合でも、明示がなくても次のように動く。解釈は agents workflow、進行役は常に orchestrator。必要に応じて sub-agent / skills / commands を自動選択する。出力は IO_CONTRACT および RULES に従う。入口の固定は AGENTS.md 冒頭を参照。

本規約は skill-first。メインは指示に徹し、**実作業は規模・内容にかかわらず例外なく必ずサブに委譲する（絶対強制）。** サブが command（skill chain）を実行する。メインが自らファイル編集・作成・コマンド実行を行うことは**絶対禁止**（CORE §メインがやってはいけないこと。enforcement §絶対強制）。**トリガーごとの「何を読むか」の正本は boot/LOAD_POLICY.md。** 本ファイルは手順の要約のみ。

---

## メイン（オーケストレーター）がやること

1. **CORE / LOAD_POLICY / PHASES を読了する**（着手前の義務）。
2. **いまの phase を判定する**（要求・要件・設計・実装計画・実装・レビューのどれか）。
3. **次に実行する command を 1 つ指定する**。  
   - 要求・要件 → `requirement-discovery`  
   - 設計・実装計画 → `design-feature`  
   - 実装 → `implement-feature`  
   - レビュー・クローズ → `verify-and-close`  
   - **「ドキュメントレビュー」依頼時**: **実装が完了しているか**を確認する。未完了なら verify-and-close（04_review 作成）は委譲せず、**memo にレビュー証跡を記録する**よう委譲する（PHASES §レビュー成果物の配置ルール）。完了済みなら verify-and-close を委譲してよい。
4. **サブに委譲する**。渡すもの: **Task**（目的・成果物・参照）、**Constraints**（CORE / LOAD_POLICY / PHASES、該当 commands/{name}.md と skills、workflow/TEMPLATES.md）、**OutputSpec**（完了条件・証跡）。形式は skills/agent/run_command.md に従う。  
   - 通常の作業依頼（issue 作成・要件定義・設計・実装計画・実装・レビューなど）に対しては、**ユーザーに「サブを呼んでよいか」「この方針で進めてよいか」等の許可を逐一求めず**、phase 判定 → command 選択 → run_command による委譲までを**自立的に行う**。  
   - ユーザーから「プロンプト案だけ教えて」「手順だけ教えて」等、**説明モード** が明示された場合のみ、委譲ではなく**説明のみ**に切り替えてよい。  
   - 破壊的・高リスクな操作（大量削除・外部サービスへの書き込み等）、および RULES / CORE / enforcement で定義された**高リスク操作**に該当する command / capability を実行する場合は例外とし、そのときのみ事前にユーザーの**明示的な確認**を行う。
5. **完了を受領し、証跡を確認する**。次 phase に進めるか判定する。
6. **実作業は例外なく行わない（絶対強制）**（00/01/02/03/04 の執筆、コード、レビュー本文、memo の代筆は**必ずサブが行う**。軽い修正・1 ファイルだけの変更も**いかなる場合も**委譲する）。

---

## サブ（command を実行する側）がやること

1. **run_command.md と、指定された commands/{name}.md を読む**。LOAD_POLICY に従う。
2. **成果物を書く前に、該当するテンプレートファイル（TEMPLATES.md の表に従う）を開き、見出し・必須セクションを確認してから執筆する。**
3. **command に書かれた skill chain を、記載順に実行する**。各 capability の SKILL.md または README.md の「手順」「制約」「成果物の形式」に従う。
4. **前の capability の OUT を次の IN に渡す**（テキスト・ファイルパス・要約）。成果物は workflow/TEMPLATES.md のテンプレートに合わせる。
5. **証跡を残す**。memo を書く場合はファイル名に **YYYYMMDD_HHMMSS_**（JST）を付ける。write-workflow-log を省略しない。
6. **command の DoD を満たしたら完了**。メインに報告する。

---

## 1 issue を回す流れ

1. メイン: phase = 要求 → サブに「requirement-discovery を実行」と委譲（Task/Constraints/OutputSpec と 00/01 テンプレート参照を渡す）。
2. サブ: commands/requirement-discovery.md を読み、extract-goals → identify-assumptions → define-constraints → write-bdd の順に実行。00_要求定義.md と 01_要件定義.md を出す。証跡を memo に書く。
3. メイン: 完了受領。phase = 設計に進む → サブに「design-feature を実行」と委譲。
4. 同様に design-feature → implement-feature → verify-and-close まで回す。最後に 04_review.md と証跡が揃う。

**「この issue を最初から最後まで実行」** で、親 issue に PR 指摘対応 issue の起票が含まれる場合は、03_実装計画の後に **issue_creation.create_pr_review_issue**（command: create-pr-review-issue）を実行し、`.workflow/{親}/90_issues/{プレフィックス}PR指摘対応/00_要求定義.md` を生成してから実装フェーズに進む。詳細は [workflow/PHASES.md](workflow/PHASES.md) §issue_creation サブフェーズ および [commands/create-pr-review-issue.md](commands/create-pr-review-issue.md) を参照。

---

## PR 指摘対応 issue 自動作成フロー（使い方）

- **ユーザー指示例**: 「この PR の指摘対応のための issue を作成して」「`https://github.com/owner/repo/pull/4` の指摘対応 issue を作って」
- **メインの動き**: phase が issue_creation（サブフェーズ create_pr_review_issue）と判断したら、**create-pr-review-issue** を run_command でサブに委譲する。
- **サブの動き**: [commands/create-pr-review-issue.md](commands/create-pr-review-issue.md) に従い、[workers/create-pr-review-issue/](workers/create-pr-review-issue/README.md) の手順（ディレクトリ決定 → 指摘抽出 → 対応方針案生成 → 00_要求定義.md 生成）を実行する。入力は pr_url / review_comments_raw / issue_dir_hint（任意）/ parent_issue_id。
- **成果物**: `.workflow/{親 issue}/90_issues/{ディレクトリ名}/00_要求定義.md`（指摘一覧・各指摘の対応方針案を埋めた状態）。ディレクトリ未指定時は scripts/create-pr-review-issue-dir.sh で新規作成、既存指定時はそのディレクトリを再利用する。

---

## 実行モード（quick / standard / full）

作業粒度に応じて 3 段階で切る。定義・必須成果物は [RULES.md](RULES.md) の実行モードを参照。一覧のみここに示す。

| モード | 必須とするもの |
|--------|----------------|
| **full** | 00→01→02→03→実装→04 全て。verify-and-close 必須。 |
| **standard** | 要件要点・設計要点・実装・簡易レビュー。証跡必須。 |
| **quick** | 設計メモと変更理由のみ。証跡は最小限。 |

---

---

## .agents-project との衝突解決

プロジェクト固有のルールは **.agents-project/** に置く。**.agents より最優先**される（CORE §ルールの優先順位）。次の場合の扱いを統一する。

| 状況 | 優先・扱い |
|------|------------|
| **同名ファイル**（例: .agents/RULES.md と .agents-project/RULES.md） | **.agents-project を採用**。LOAD_POLICY や command が参照する「RULES」は .agents-project/RULES.md を読む。 |
| **同目的の別名**（例: .agents-project/cursor-rules.mdc と .agents の agents-core.mdc） | プラットフォームが .cursor/rules に複数読み込む場合、両方適用される。.agents-project 側を優先したい場合は、内容で上書きするか、ファイル名・glob の読み込み順に依存する。**推奨**: プロジェクト固有は .agents-project に集約し、同名で上書き。 |
| **不足時**（.agents-project に該当ファイルが無い） | **.agents にフォールバック**。例: .agents-project/REVIEW_RULE.md が無ければ .agents/REVIEW_RULE.md を参照する。 |
| **不整合検知** | 同一キー（例: 実行モード名）が .agents と .agents-project で異なる定義のとき、どちらを採用するかは「.agents-project 優先」で一意。不整合は CI や手動レビューで検知する。enforcement の audit は証跡・CONTRACT を検査し、ルールファイルの内容一致は検査しない。 |

**具体例**: プロジェクトで「full モードでも 02_設計を省略可能」にしたい場合、.agents-project/RULES.md に実行モード表を置き、02 を省略可能と記載する。.agents/RULES.md は読まれず、.agents-project の定義が使われる。

---

## 参照

- メインとサブの役割: boot/CORE.md §メインとサブの役割、agents/README.md  
- 委譲の形: skills/agent/run_command.md  
- command 一覧: commands/ 配下の requirement-discovery.md, design-feature.md, implement-feature.md, verify-and-close.md  
- 成果物とテンプレート: workflow/TEMPLATES.md  
- 実行モードの正式定義: RULES.md §実行モード  
