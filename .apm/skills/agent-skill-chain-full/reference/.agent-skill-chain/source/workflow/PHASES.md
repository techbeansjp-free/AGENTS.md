# PHASES.md — フェーズ順・成果物・DoD

フェーズは**状態 gate**。どの phase でどの **command**（skill chain）を起動するかは commands/ と本表、および [PHASE_COMMAND_MAP.md](PHASE_COMMAND_MAP.md) で対応させる。監査観点は簡潔に。**モード別の適用は [RULES.md](../RULES.md) の実行モードを参照。**

---

## フェーズ一覧

| フェーズ | 起動する command（必須） | 必須成果物 | DoD（完了定義） |
|----------|--------------------------|------------|------------------|
| 要求 | requirement-discovery | 00_要求定義.md | 目的・受け入れ基準・参照元が記載されている |
| 要件 | requirement-discovery（続き） | 01_要件定義.md | ユーザーストーリー・受け入れ基準・BDD シナリオが記載されている |
| 設計 | design-feature | 02_設計.md | 責務・参照関係・テスト観点が記載されている |
| 実装計画 | design-feature または implement-feature の入口 | 03_実装計画.md | タスク分解・テスト仕様（BDD）が記載されている |
| 実装 | implement-feature | 成果物・コード等 | 実装計画に従い実装され、単体テスト観点を満たす |
| レビュー | verify-and-close | **04_review.md（必須・絶対強制）** | 実装内容・受け入れ基準の確認が記載されている。**04_review.md を issue 直下に作成しないと完了とみなさない。** |

---

## issue_creation サブフェーズ

親 issue の 00→01→02→03 まで完了したあと、**PR 指摘対応用のサブ issue を起票する**場合に次のサブフェーズを用いる。

| サブフェーズ | 起動する command | 必須成果物 | DoD |
|--------------|------------------|------------|-----|
| **issue_creation.create_pr_review_issue** | create-pr-review-issue | .agent-skill-chain/runtime/{親}/90_issues/{ディレクトリ名}/ および 00_要求定義.md | 当該ディレクトリが存在し、00_要求定義.md に指摘一覧・対応方針案が記載されている。**対応方針の監査を経ていること**（00 に対する監査・修正反復・memo 証跡）。**書記（write-workflow-log）で証跡が記録されていること**。 |

- **説明**: PR 指摘対応 issue の起票を行う。ユーザーが「この PR の指摘対応 issue を作成して」等と指示したときに、メインエージェントは本 command を run_command 経由でサブに委譲する。
- **使用コマンド**: [commands/create-pr-review-issue.md](../commands/create-pr-review-issue.md)

### 一般的な issue 作成ステップ

- **作成場所の上書き**: 作成場所は `.agent-skill-chain/project/` の上書きを最優先で確認（[CLAUDE.md §issue 作成タスク受領時の標準フロー](../../CLAUDE.md) 参照。本体定義は再記述しない）。
- **概要**: ユーザーが「この要件で issue を作成して」「issueを作成して」等と依頼した場合、メインエージェントは **issue 作成をサブに自動委譲**する（サブへの指示文案だけを返して終了してはならない）。サブは作成場所（汎用標準では `.agent-skill-chain/runtime/<timestamp>_<title>/`。`.agent-skill-chain/project/` の上書きがある場合は :33 のとおりそれを最優先）配下に 00_要求定義.md 等を作成し、タイトル・概要・保存場所を返却する。
- **適用ルール**: AGENTS.md §issue 作成依頼時のサブ自動委譲ルール、CLAUDE.md §issue 作成タスク受領時の標準フロー に従う。「提案して」「説明して」と明示された場合は委譲せず指示案・説明のみ返す。
- **本ルールの根拠（自己完結）**: issue 作成依頼を受けたメインエージェントは、作成をサブへ自動委譲すること・サブは実際に成果物を作成して返却すること・書記で証跡を残すことを必須とする（サブへの指示文案だけを返して終了することの禁止、作成場所の上書き確認、監査・証跡の必須化を含む）。この規定は上記の各項目で自己完結しており、外部の issue 記録に依存しない。

---

## 「この issue を最初から最後まで実行」フロー

ユーザーが「この issue を最初から最後まで実行」と指示した場合、メインエージェントは次の順でフェーズを進める。

1. **要求** — requirement-discovery → 00_要求定義.md
2. **要件** — requirement-discovery（続き）→ 01_要件定義.md
3. **設計** — design-feature → 02_設計.md
4. **実装計画** — design-feature / implement-feature の入口 → 03_実装計画.md
5. **issue_creation.create_pr_review_issue**（該当する場合のみ）— 親 00/01/02/03 の内容で「PR 指摘対応 issue を起票する」と判断されたとき、create-pr-review-issue を実行し、90_issues 配下にサブ issue と 00_要求定義.md を用意する。
6. **実装** — implement-feature → 成果物・コード等
7. **レビュー** — verify-and-close → 04_review.md（必須）

通常の issue（PR 指摘対応起票を含まない）の場合は 5 を省略する。PR 指摘対応 issue 自動作成フローを組み込んだ親 issue の場合は、03 完了後に 5 を実行してから 6 に進む。

---

## レビュー成果物の配置ルール

- **二経路の区別**: **実装前のドキュメントレビュー**（run_command §実装前のドキュメントレビュー）では memo のみに証跡を残し、04_review.md は作成しない。**実装完了後のレビュー**（verify-and-close）では 04_review.md を必須で作成し、write-workflow-log を必須で実行する。memo は 04_review の代わりにはならない。
- **04_review（04_review.md）は、実装フェーズ完了後のレビューフェーズ（verify-and-close を実行するとき）でのみ作成・更新する。要求・要件・設計・実装計画・実装のいずれかのフェーズで 04_review を作成してはならない。**
- **レビューフェーズで verify-and-close が実施するレビュー**（00/01/02/03 および実装成果物の確認を含む）の成果物は、**必ず issue フォルダ直下に 04_review（04_review.md）を直接作成する（絶対強制）。** verify-and-close を実行したら 04_review.md を作成しないで完了とみなしてはならない。省略は認めない。enforcement 失敗条件 #3 で検出する。
- **memo にはドキュメントレビュー証跡を記録してよい（推奨）**。実装前の 00/01/02/03 に対するドキュメントレビューの指摘一覧・修正内容・完了判定などの証跡は memo に残してよい。**04_review に相当する正式なレビュー成果物は memo に書かない**。memo はメモ・証跡用とする。**実装完了レビュー（verify-and-close）では必ず 04_review.md を issue 直下に作成し、memo のみで済ませること禁止。**
- **ドキュメントレビューはレビューと修正を一組とする**。指摘がなくなるまでレビュー→修正を繰り返すこと。各回の証跡は memo に記録する。**完了後は必ず書記（write-workflow-log）に依頼**すること（run_command §実装前のドキュメントレビュー）。
- **ドキュメントレビュー「完了」の定義**: 完了とは **(1) memo 作成 (2) 指摘がなくなるまでの修正反復 (3) 書記委譲**の**すべて**を指す。**(3) を実施するまで「完了」とみなしてはならない**。書記委譲を省略してユーザーに報告のみして終了することは禁止（enforcement §失敗条件 #23）。
- **ユーザーが「レビュー用の指示文だけ教えて」等と明示した場合を除き、ドキュメントレビュー依頼は常に本ルール（memo への記録＋指摘がなくなるまでの反復＋書記委譲）を適用すること**。レビュー本文やサマリだけを返して memo・書記を省略することを禁止する（enforcement §失敗条件 #22–#23 と整合させる）。
- **review-docs は補助手順（auxiliary）であり phase→command 表には載せない**: 実装前ドキュメントレビューの command [review-docs](../commands/review-docs.md) は特定 phase に対応しない横断的な補助手順であり、`create-pr-review-issue` の内部 step やユーザーの「ドキュメントレビューして」依頼から呼ばれる。[PHASE_COMMAND_MAP.md §補助手順（auxiliary）](PHASE_COMMAND_MAP.md#phase--command-一覧) の注記と一致させる（同表の「本表にない command の起動は禁止」は phase からの選択経路に関する禁止であり、補助手順の呼び出しは対象外）。**ただし review-docs は design-feature（設計・実装計画）完了と implement-feature 着手の間の必須ゲートであり（全 issue 一律・規模比例の免除なし）、「auxiliary（表に載らない）」は「任意・省略可」を意味しない。** 委譲義務の正本は [run_command.md §Constraints](../skills/agent/run_command.md)、未実行検知は [enforcement/README.md](../enforcement/README.md) §失敗条件と差し戻し の #32 を参照。

---

## 完了 issue の close 移動

完了したトップレベル issue を `close/` に移動する手順詳細。**宣言は [CORE.md](../boot/CORE.md) §完了 issue の close 分離**、本節はライフサイクル（いつ・どう移動するか）を定める（1 ファイル 1 責務・重複禁止）。

- **トリガー（厳密）**: 移動は**トップレベル issue が完了したときのみ**行う。**サブ issue が完了しても、親が未完了なら移動しない。** サブ issue が**すべて完了し、かつ親も完了と判断できたとき**に、当該トップレベル issue（配下のサブ issue 含む）を close へ移動する。
- **完了の定義（接続）**: ここでの「完了」は、当該 issue の**レビューフェーズ（verify-and-close）が完了**（issue 直下に 04_review.md を作成＋ write-workflow-log による書記記録、本表「レビュー」DoD）を満たし、かつ**トップレベルとして残タスク・未完了サブ issue が無い**状態を指す。サブ issue を持つ場合は、配下サブ issue がすべてこの完了条件を満たしていること。
- **close ステップ**: verify-and-close 完了後にトップレベル完了が確認できたら、当該トップレベル issue ディレクトリ（配下のサブ issue を含む）をワークフローの `close/` ディレクトリ配下へ移動する。
- **配置先（一般）**: ワークフロールート直下の `close/` ディレクトリ（消費者ランタイムでは `.agent-skill-chain/runtime/close/<issue>/`）。
- **自己拡張（本リポ）の配置先**: `docs/maintainer/workflow/close/<issue>/`。詳細は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../.agent-skill-chain/project/自己拡張ワークフロー.md) §完了 issue の close 移動（上書き）を参照。
- 移動は**完了状態の整理のみ**を目的とし、close 後も証跡（04_review.md・workflow.db ログ）はそのまま残す。書記記録の書き換え・削除はしない。
- **移動に伴う相対リンクの深度補正（原則）**: close への移動は、issue ディレクトリの階層を **1 段深くする**操作である。issue 成果物（00〜04・memo 等）内の相対リンクのうち、**issue ディレクトリの外**（リポジトリルート配下等）を指すものは、移動によって基準ディレクトリの深度が変わるため**補正が必要**である。一方、**同一 issue ディレクトリ内の相互参照**（兄弟ファイル間・配下 memo 等）は移動後も相対位置が変わらないため**補正不要**である。
- **検証は必ず移動前に行う（強制）**: リンク補正の妥当性検証は、成果物がまだ**元の場所にある間**に完了させ、補正後の内容を確定してから移動を実行すること。**移動後の close 配下に対してファイル読み取り・grep・glob 等による検証を行う設計にしてはならない**。当該ディレクトリへの読み取りアクセスを制限する環境設定がありうるため、移動後検証に依存する手順は環境によって実行不能になる。リンク補正・検証は、ファイルがまだ元の場所にある間に完了させ、補正後の内容を確定してから移動を実行すること。
- **具体手順の委譲**: 具体的な補正手順・検証手段（コマンド・パス）はコアに置かず、消費者ランタイム／自己拡張それぞれの `.agent-skill-chain/project/` 側の上書き定義に委ねる（既存の汎用/固有境界パターンを踏襲）。自己拡張（本リポ）の具体化は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../.agent-skill-chain/project/自己拡張ワークフロー.md) §close 移動時の相対リンク補正 を参照。

---

## 監査観点

- 各フェーズの成果物が**テンプレート**の必須セクションを満たしていること。
- **各工程で監査・書記に依頼する**。worker（監査・書記以外）の command 完了後は、要求・要件・設計・実装計画・実装のいずれの工程でも必ず verify-and-close（監査・書記）を経ること。レビュー・クローズ前に必ず verify-and-close を経ること。
- **各フェーズ完了時の監査・書記は run_command の定義に従うこと**。実装前のドキュメントレビューは memo 証跡＋書記委譲（04_review は作らない）。実装完了後のレビューは verify-and-close を実行し 04_review.md を必須で作成する。run_command の Constraints と整合させる。
- **ユースケースに基づく全シナリオ**について、**テストコード化できるものは全て**テストコード化されていること（できない場合は理由が明記されていること）。01 の BDD シナリオとテスト仕様（単体テスト仕様・チェックリスト等）の対応が取れていることを確認する。
- **フォーマットは正しいか**。成果物がフォーマット規約に適合していること（テンプレート必須セクション・用語・参照リンク・BDD 形式等）。ディレクトリ構成・ファイルの作成場所・命名規則（spec/03）・**プレフィックス**（memo および issue フォルダ名の YYYYMMDD_HHMMSS_ は実行環境現在時刻 JST 取得。推測・固定・未来禁止）・spec 準拠（設計原則・UNIX 哲学等）を含む。
- 証跡（memo・ログ）のプレフィックスは **YYYYMMDD_HHMMSS_** とし、**実行環境の現在時刻（JST）を取得して付与すること**。**memo プレフィックスは専用経路のみで取得すること**: **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S** の実行、または **.agent-skill-chain/source/scripts/memo-prefix.sh** の実行で得た値を使用する。**issue フォルダ名のプレフィックス**も同様に**実行環境の現在時刻（JST）を取得**して付与すること。**TZ=Asia/Tokyo date +%Y%m%d_%H%M%S** の実行、または **.agent-skill-chain/source/scripts/memo-prefix.sh** の実行で得た値を使用する。**推測・固定・未来日時の使用は禁止**（手入力・固定値・推測・未来日時を使わない）。**プレフィックスは、memo/issue を作成するたびに、memo-prefix.sh または TZ=Asia/Tokyo date を実行して得た値のみを使用すること。** 実行せずにプレフィックスを決めること、およびコンテキストの日付・推測でファイル名・フォルダ名を組み立てることは違反とする。ログは一定のルールで必ず記録すること。
- command 実行は commands/{name}.md の skill chain に従っていること。
- **サブissueを 1 件以上作成した場合**: 親ワークフローのルートに **90_issues.md が存在すること**。未作成のまま当該フローを完了とみなさない。run_command の Constraints および該当 command の DoD と整合して検証する。
- **監査で検証する項目**（上記のほか）: テストコードは `ユースケース:`・`シナリオ:`（doc コメント等）および Given / When / Then（必要に応じて And）をインラインコメントで記載していること（.agent-skill-chain/source/TEST_BDD_FORMAT.md）。詳細は .agent-skill-chain/source/REVIEW_RULE.md を参照する。
- **実装成果物にテストが含まれる場合、レビュー（04_review 作成・更新）時点でテストを再実行し、その結果を 04_review に記載すること。** テスト未実行のまま監査完了とみなさない。

---

フェーズ→command の対応は commands/ 配下のファイル名と上表に加え、[PHASE_COMMAND_MAP.md](PHASE_COMMAND_MAP.md) を**単一の正本**として把握する。オーケストレーションは agents/README.md を参照する。

**Phase 別の skill 必須条件**（どの phase でどの capability が mandatory か・省略時どうするか）は [SKILL_MANDATORY.md](SKILL_MANDATORY.md) を参照する。
