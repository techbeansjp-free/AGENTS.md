# TEMPLATES.md — 成果物とテンプレート・command/capability の対応

各成果物は**所定のフォーマット・テンプレート**を使う。どの **command** およびどの **capability** がどのテンプレートを使うかを以下に示す。

---

## テンプレートの正本

- **00/01/02/03/04**: プロジェクトの **.workflow/templates/** に 00*要求定義.md, 01*要件定義.md, 02*設計.md, 03*実装計画.md, 04_review.md を置く。存在しない場合は、setup が **AGENTS-spec/.workflow/templates/**（本パッケージの .workflow）からコピーする。それも無い場合は親 issue の同種ファイルを形式の参照とする。
- **レビュー成果物の配置**: 04_review は**レビューフェーズ**（実装完了後に verify-and-close を実行するとき）でのみ作成する。その成果物は **issue フォルダ直下に 04_review（04_review.md）を直接作成**する。実装前の要求・要件・設計・実装計画フェーズで 04_review を作成してはならない。**memo にレビューを書かない**。memo はレビュー以外のメモ・証跡用とする。
- **memo（証跡）**: **配置は .workflow/{issue}/memo/** とする。**{issue} は YYYYMMDD*HHMMSS* をプレフィックスとする issue フォルダ名（必須）。** そのプレフィックスも **実行時 JST 取得**・**専用経路のみ**（**TZ=Asia/Tokyo date +%Y%m%d\_%H%M%S** の実行または **.agents/scripts/memo-prefix.sh** の実行で得た値）・**推測・固定・未来日時の使用は禁止**。例: 20260310*090428_AGENTS-spec完全作り直し。ファイル名も YYYYMMDD_HHMMSS* プレフィックス必須。中身は CONTRACT 準拠（実施内容・変更・完了判定が分かる形）。**memo プレフィックス（YYYYMMDD*HHMMSS*）の専用経路**: プレフィックスは**実行環境の現在時刻（JST）を取得して付与**する。**TZ=Asia/Tokyo date +%Y%m%d\_%H%M%S** を実行して得た値、または **.agents/scripts/memo-prefix.sh** を実行して得た値（必要に応じて末尾に `_` を付与）のみを使用する。取得は memo ファイル作成のたびに実行すること（キャッシュ・事前計算に依存しない）。**推測・固定・未来日時の使用は禁止**（手入力・固定値・AI の推測・未来日時でプレフィックスを生成してはならない）。専用経路以外ではプレフィックスを生成しない。

---

## 成果物 → テンプレート → 使う command / capability

| 成果物              | テンプレート（パス）                                                                                                                              | 使う command                | 主に使う capability                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| 00\_要求定義.md     | .workflow/templates/00\_要求定義.md または親 issue の 00                                                                                          | requirement-discovery       | extract-goals, define-constraints, write-bdd                                                        |
| 01\_要件定義.md     | .workflow/templates/01\_要件定義.md または親 issue の 01                                                                                          | requirement-discovery       | write-bdd                                                                                           |
| 02\_設計.md         | .workflow/templates/02\_設計.md または親 issue の 02                                                                                              | design-feature              | define-boundaries, design-api-contract, review-dependencies                                         |
| 03\_実装計画.md     | .workflow/templates/03\_実装計画.md または親 issue の 03                                                                                          | design-feature              | review-dependencies                                                                                 |
| 04_review.md        | .workflow/templates/04_review.md または親 issue の 04                                                                                             | verify-and-close            | generate-scenarios, map-coverage, review-code, review-architecture                                  |
| 指摘対応（01_指摘一覧 + 02_対応方針） | .workflow/templates/指摘対応/01_指摘一覧.md, 02_対応方針.md（AGENTS-spec/.workflow/templates/指摘対応/ を参照）                                       | run_command 経由の委譲（指摘対応方針決定時） | run_command Constraints に従いテンプレートをコピーして必須セクション記載                            |
| memo（証跡）        | **.workflow/{issue}/memo/** に配置。**{issue} は YYYYMMDD*HHMMSS* プレフィックス必須。** ファイル名も YYYYMMDD*HHMMSS* 必須。中身は CONTRACT 準拠 | verify-and-close の最後など | write-workflow-log                                                                                  |
| **99_PR.md**        | .workflow/templates/99_PR.md                                                                                                                      | PR 作成時                   | **PR 本文用（簡潔）**。GitHub 等に貼る内容。内部リンク禁止。                                        |
| **99_PR_review.md** | .workflow/templates/99_PR_review.md                                                                                                               | PR 作成前・内部             | **内部レビュー用**。要件・定義・テスト詳細・レビュー観点の詳細チェックリスト。PR 本文には載せない。 |

---

## 運用

- 執筆時は上記テンプレートを開き、必須セクションを欠かさない。各 capability の README/SKILL.md に「参照: 〇〇テンプレート」とある場合はそれに従う。
- メインは委譲時に「使うテンプレート」を Constraints または参照ファイル一覧に含め、サブがフォーマットに従うようにする。
- 監査では、各フェーズの成果物がテンプレートの必須セクションを満たしていることを本表と各 capability の成果物形式に照らして確認する。

---

## 参照

- PHASES（必須成果物・DoD）
- 各 skills/{domain}/{capability}/README.md（成果物の形式・参照）
- RULES（ドキュメント・証跡）
