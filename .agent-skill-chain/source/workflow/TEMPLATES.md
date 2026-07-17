# TEMPLATES.md — 成果物とテンプレート・command/capability の対応

各成果物は**所定のフォーマット・テンプレート**を使う。どの **command** およびどの **capability** がどのテンプレートを使うかを以下に示す。

---

## テンプレートの正本

- **00/01/02/03/04**: プロジェクトの **.agent-skill-chain/runtime/templates/** に 00*要求定義.md, 01*要件定義.md, 02*設計.md, 03*実装計画.md, 04_review.md を置く。存在しない場合は、setup が **`.agent-skill-chain/runtime/templates/`**（パッケージ内）からコピーする。それも無い場合は親 issue の同種ファイルを形式の参照とする。
- **レビュー成果物の配置**: 04_review は**レビューフェーズ**（実装完了後に verify-and-close を実行するとき）でのみ作成する。その成果物は **issue フォルダ直下に 04_review（04_review.md）を直接作成**する。実装前の要求・要件・設計・実装計画・実装フェーズで 04_review を作成してはならない。**04_review に相当する正式なレビュー成果物は memo に書かない**。memo はメモ・証跡用とし、ドキュメントレビュー等の証跡を含む。
- **memo（証跡）**:
  - **配置**: .agent-skill-chain/runtime/{issue}/memo/
  - **用途**: メモ・証跡用。**ドキュメントレビュー等の証跡を含む**。実装完了後の正式なレビュー成果物は 04_review に作成する。
  - **issue フォルダ名**: YYYYMMDD_HHMMSS_ をプレフィックスとする（必須）。
  - **memo ファイル名**: YYYYMMDD_HHMMSS_ プレフィックス必須。
  - **プレフィックス取得**: 実行環境の現在時刻（JST）を **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S** の実行、または **.agent-skill-chain/source/scripts/memo-prefix.sh** の実行で得た値のみを使用する。取得は memo ファイル作成のたびに実行すること（キャッシュ・事前計算に依存しない）。推測・固定・未来日時の使用は禁止。**作成のたびに** memo-prefix.sh または TZ=Asia/Tokyo date を**実行**し、その標準出力をプレフィックスに用いること。実行しないでプレフィックスを組み立ててはならない。
  - **中身**: CONTRACT 準拠（実施内容・変更・完了判定が分かる形）。

---

## 成果物 → テンプレート → 使う command / capability

| 成果物              | テンプレート（パス）                                                                                                                              | 使う command                | 主に使う capability                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| 00\_要求定義.md     | .agent-skill-chain/runtime/templates/00\_要求定義.md または親 issue の 00                                                                                          | requirement-discovery       | extract-goals, define-constraints, write-bdd                                                        |
| 01\_要件定義.md     | .agent-skill-chain/runtime/templates/01\_要件定義.md または親 issue の 01                                                                                          | requirement-discovery       | write-bdd                                                                                           |
| 02\_設計.md         | .agent-skill-chain/runtime/templates/02\_設計.md または親 issue の 02                                                                                              | design-feature              | define-boundaries, design-api-contract, review-dependencies, frame-experience, map-experience, detail-experience（体験面=あり時）                                         |
| 03\_実装計画.md     | .agent-skill-chain/runtime/templates/03\_実装計画.md または親 issue の 03                                                                                          | design-feature              | review-dependencies                                                                                 |
| 04_review.md        | .agent-skill-chain/runtime/templates/04_review.md または親 issue の 04                                                                                             | verify-and-close            | generate-scenarios, map-coverage, review-code, review-architecture                                  |
| memo（証跡）        | **.agent-skill-chain/runtime/{issue}/memo/** に配置。**{issue} は YYYYMMDD_HHMMSS_ プレフィックス必須。** ファイル名も YYYYMMDD_HHMMSS_ 必須。中身は CONTRACT 準拠 | verify-and-close の最後など | write-workflow-log                                                                                  |
| **99_PR.md**        | .agent-skill-chain/runtime/templates/99_PR.md                                                                                                                      | PR 作成時                   | **PR 本文用（簡潔）**。GitHub 等に貼る内容。内部リンク禁止。                                        |
| **99_PR_review.md** | .agent-skill-chain/runtime/templates/99_PR_review.md                                                                                                               | PR 作成前・内部             | **内部レビュー用**。要件・定義・テスト詳細・レビュー観点の詳細チェックリスト。PR 本文には載せない。 |

---

## 運用

- **00_要求定義.md のテンプレート強制**: 00_要求定義.md を作成・更新する場合は、必ず .agent-skill-chain/runtime/templates/00_要求定義.md（プロジェクトに無い場合はパッケージの `.agent-skill-chain/runtime/templates/00_要求定義.md`）を**開いて**、その**全セクション**（見出し・セクション番号・必須項目）を欠かさず執筆すること。特に**「要求定義の全体像」セクションに Mermaid マインドマップを必ず含めること**。テンプレートを開かずに、またはテンプレートのセクションを省略した形で 00 を作成することは禁止する。監査で 00 に「要求定義の全体像」およびマインドマップの存在を確認する。
- **全てのドキュメント（00/01/02/03/04/05/90 および memo）には document_id（UUID）を必ず設定すること。任意とすることを禁止する。レビュワーが任意と判断することも禁止とする。** 成果ドキュメントの作成・major 更新時には document_id（UUID）を付与する。各テンプレートの frontmatter に `document_id` の記載欄を設け、作成時または major 更新時に UUID を必ず付与すること。**document_id は作成時または初回付与時にのみ設定し、既に存在する場合は変更・上書きしてはならない。**
- **上記に加え、.agent-skill-chain/runtime/templates/docs/** 配下のテンプレート（システム仕様書・レビュー結果等）、**.agent-skill-chain/runtime/templates/指摘対応/** 配下のテンプレート、**00_システム理解.md** から作成するドキュメントについても、作成時または major 更新時に document_id（UUID）を必ず付与すること。強制とする。**
- **command 実行側（サブ）は、00/01/02/03/04 のいずれかを執筆する前に、必ず当該テンプレートファイルを開き、見出し・セクション番号・必須項目を確認してから執筆すること。** テンプレートを開かずに成果物のみを書くことは禁止する。
- 執筆時は上記テンプレートを開き、必須セクションを欠かさない。各 capability の README/SKILL.md に「参照: 〇〇テンプレート」とある場合はそれに従う。
- メインは委譲時に「使うテンプレート」を Constraints または参照ファイル一覧に含め、サブがフォーマットに従うようにする。
- 監査では、各フェーズの成果物がテンプレートの必須セクションを満たしていることを本表と各 capability の成果物形式に照らして確認する。

---

## 参照

- PHASES（必須成果物・DoD）
- 各 skills/{domain}/{capability}/README.md（成果物の形式・参照）
- RULES（ドキュメント・証跡）
