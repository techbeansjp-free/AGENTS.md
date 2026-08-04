# PLAN: bugfix: resumeしたsegment workerがPR/Issueのレビューフィードバックを一切参照せず静的completion checklistだけで完了と自己判定する

- Issue: `ISSUE-446`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | roles.yaml静的ルール追加 | `.agent-skill-chain/config/roles.yaml` の `role_contracts.{spec_worker,design_worker,implementation_worker,validation_worker}.rules` へ「作業再開時は対象Issue/PRの最新レビュー・コメント（`review_status`セクションがあれば含む）を確認し、ファイル存在やcommit済みであることのみを根拠に完了と判定しない」旨の1行を追加する。既存の `rules` 配列の他要素・`inputs`/`outputs`/`completion`/`forbidden` は変更しない。 | `AC-1` | なし |
| 2 | test/helpers/gh-stub.ts 拡張 | 既存 `pr view <branch>` 分岐（`branch名`キー）に加え、PR番号での問い合わせ（`gh pr view <number> --json latestReviews,comments`）を扱えるようにする。`prsByBranch` から番号一致でも引けるようにする、または番号引き専用の内部索引を追加する。`GhStub` インターフェースへレビュー・コメントを注入するヘルパー（例: `seedPrReviews(prNumber, reviews)`）を追加する。既存の `issue view --json comments` は変更不要（既に対応済み）。 | `AC-2, AC-3, AC-4, AC-5`（自動テストの前提条件） | なし |
| 3 | review-status.ts 新規作成 | `src/lib/review-status.ts` を新規作成する。`detectGithubReviewStatus(root, issueNumber)` と `detectLocalBlockingFindings(root, issueNumber, segment)`、およびそれぞれのYAML整形を担う `formatReviewStatusBlock(data)` を実装する。DESIGN.md「未対応の判定基準」節のとおり、レビューは `latestReviews` の `state === 'CHANGES_REQUESTED'` のみ、コメントは対象ブランチ最新commit時刻（`git log -1 --format=%cI HEAD`）より後のもののみを対象とする。`gh`／`git` 呼び出し失敗・JSON解釈失敗は例外を外へ投げず `{ detection: 'failed', reason }` として返す。ローカルモードの `readYamlFile` 例外はtry/catchで捕捉し `undefined` を返す。 | `AC-2, AC-3, AC-4, AC-5, AC-6` | `#2`（テスト実行に必要） |
| 4 | segment.ts 組み込み | `src/commands/segment.ts` の `start()` に、既存の `issueBlock` 構築と同列で `review-status.ts` の結果を呼び出し、非空（または検出失敗）の場合のみ `parts` へ `review_status:` ブロックを追加する処理を組み込む。`config.coordination.backend` による分岐は既存の `issueBlock` 分岐と対称に実装する。 | `AC-1〜AC-6` の結線 | `#1, #3` |
| 5 | 単体テスト | `test/unit/review-status.test.ts`（新規）で `detectGithubReviewStatus`／`detectLocalBlockingFindings` の判定ロジック（CHANGES_REQUESTED抽出、comment since判定、gh失敗時のfailed、ローカルYAML破損時のundefined、PR未作成時のundefined）を直接検証する。`test/unit/roles.test.ts` に `role_contracts.*.rules` へのAC-1文言を検査するケースを追加する。 | `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6` | `#1, #3` |
| 6 | 結合テスト | `test/integration/github-backend.test.ts` へ、`gh-stub` 経由でCHANGES_REQUESTEDレビューあり／未対応コメントあり／全てAPPROVEDかつコメント無し／`gh` 呼び出し失敗、の4パターンで `segment start` を呼び出し、出力プロンプトを検証するケースを追加する。ローカルモード（`test/integration/issue-lifecycle.test.ts` 等の既存ローカルbackendスイート）へ、`reviews/<segment>.yaml` に blocking finding がある場合／無い場合の `segment start` 出力を検証するケースを追加する。 | `AC-2, AC-3, AC-4, AC-5, AC-6` | `#2, #4` |
| 7 | 実地再現確認 | 本Issueの独立検証セグメントで、Issue #441の再現手順と同型の状況（design-gateでblocking finding→PRへ修正依頼コメント→`worker-launch.sh` でdesign_worker再起動）を用意し、実際のworker完了報告・作業ログに当該フィードバックへの具体的言及があることを確認する。 | `AC-7` | `#4, #6` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
