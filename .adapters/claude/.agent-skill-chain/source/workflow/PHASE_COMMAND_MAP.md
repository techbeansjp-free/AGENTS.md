# PHASE_COMMAND_MAP.md — Phase → Command Mapping

フェーズ判定後の **command 選択を決定的（deterministic）にする**ための対応表。

メインエージェントは phase を判定したら、**必ず本ファイルを参照して command を選択する**。推測や独自判断で command を決めてはならない。

---

## Phase → Command 一覧

| Phase | Command | 説明 |
|------|---------|------|
| 要求 | requirement-discovery | 依頼内容の把握と 00_要求定義.md の作成・更新 |
| 要件 | requirement-discovery | 01_要件定義.md の作成・更新（ユーザーストーリー／受け入れ基準／BDD シナリオ） |
| 設計 | design-feature | 02_設計.md の作成・更新 |
| 実装計画 | design-feature（review-dependencies が 03 を生成） | 03_実装計画.md の作成・更新。「implement-feature の入口」という表現は用いない（implement-feature の Allowed Phase は「実装」のみで 03 生成 capability を持たない） |
| issue_creation（一般） | requirement-discovery | 一般的な issue 作成依頼（PR 指摘対応以外）。issue ディレクトリの新規作成を含む（PHASES.md §一般的な issue 作成ステップ） |
| issue_creation（サブフェーズ create_pr_review_issue） | create-pr-review-issue | PR 指摘対応 issue の起票。90_issues 配下にディレクトリと 00_要求定義.md を生成（実装→PR 作成→レビューの後、PR レビューコメントが得られてから起動する随時ゲート。「この issue を最初から最後まで実行」フローではレビュー phase の後に実行される） |
| 実装 | implement-feature | 実装およびテストコード作成。既存 03_実装計画.md に従う |
| レビュー | verify-and-close | 04_review.md の作成・更新とクローズ判定 |

**04_review の作成条件**: 04_review は**実装フェーズ完了後**のレビューフェーズでのみ作成する。実装完了前に「ドキュメントレビュー」を依頼された場合は、verify-and-close を起動せず、**.agent-skill-chain/runtime/{issue}/memo/** に証跡を記録する委譲とする（PHASES §レビュー成果物の配置ルール）。

**証跡の原則**: レビュー phase の証跡は本則として workflow.db に記録する。memo は過渡的・例外運用のみ（scribe/CONTRACT 参照）。

---

## 横断的必須ゲート

本表が定義するのは **phase → command（フェーズ遷移コマンドの起動経路）** である。これとは別に、特定の phase に対応せず横断的に必須となる**ゲート**というカテゴリが存在し、本表には行を持たない。表に行を持たないことはカテゴリの欠落や矛盾ではなく、以下のとおり定義された分類である（本節が review-docs の位置づけの正本。PHASES.md 側は本節を参照し、内容を重複記載しない）。

- **[review-docs](../commands/review-docs.md)**（実装前ドキュメントレビュー）: design-feature（設計・実装計画）完了と implement-feature 着手の間の**必須ゲート**（**full/standard は一律必須・quick モード（`mode: quick`）は免除**。免除は軽量化であり記録省略ではない。詳細は RULES.md §実行モードおよび run_command.md §Constraints）。phase→command の選択対象ではなく、`create-pr-review-issue` の内部 step（対応方針の監査）や、ユーザーの「ドキュメントレビューして」依頼から起動される。**「表に載らない（本表に行を持たない）」は「省略可・任意」を意味しない**（full/standard において）。義務の正本は [skills/agent/run_command.md §Constraints](../skills/agent/run_command.md)、未実行検知は [enforcement/README.md](../enforcement/README.md) §失敗条件と差し戻し の #32 を参照。
- 下記「禁止事項」の「**本表にない command の起動は禁止**」は、**phase からの選択経路に関する禁止**（phase 判定後に表外 command を勝手に選ぶな）であり、横断的必須ゲート（review-docs 等）の呼び出し（別 command の step・ドキュメントレビュー依頼からの直接起動）はこの禁止の対象外とする。

---

## Rule

メインエージェントは次を守る。

1. phase を判定したら、本 PHASE_COMMAND_MAP を開く。
2. 一致する Phase 行から command を選択する。
3. 選択した command を skills/agent/run_command に渡し、サブエージェントへ委譲する。

禁止事項:

- **本表は phase → command（フェーズ遷移コマンドの起動経路）の唯一の経路である。フェーズ判定後に本表にない command を選ぶことは禁止。**（横断的必須ゲート（review-docs 等）の呼び出しは対象外。上記「横断的必須ゲート」参照。）
- 本表にない command を自由に作ってはいけない。
- 本表と異なる command を「便利そうだから」という理由で選んではいけない。
- PHASES.md と矛盾する対応を作ってはいけない（矛盾がある場合は PHASES.md / 本ファイルを更新して解消する）。

本ファイルは **phase → command の単一の正本** とする。

