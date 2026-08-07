# PLAN: pr merge が base branch の最新性を保証せず、--admin 常用運用が strict_required_status_checks_policy を事実上バイパスする

- Issue: `ISSUE-493`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | config スキーマ・型定義への `merge.auto_update_branch` 追加 | `.agent-skill-chain/schemas/config.schema.yaml` の `merge` オブジェクトへ任意項目 `auto_update_branch: boolean` を追加（`required` は `autonomous` のみのまま維持し後方互換を保つ）。`src/lib/config.ts` の `AgentSkillChainConfig['merge']` 型・`.agent-skill-chain/config/agent-skill-chain.yaml` の日本語コメントを更新する | AC-1（既定挙動の根拠） | なし |
| 2 | `src/lib/pr-freshness.ts` 新設（対象PR解決・最新性チェック） | `resolveMergeTarget()`（`args` から対象識別子を抽出し、見つからない場合は `gh pr view --json number` によるcwdベースの暗黙解決へフォールバック）・`checkFreshness()`（`gh pr view --json ...mergeStateStatus` 呼び出し、`UNKNOWN` ポーリング、`gh pr view` 失敗検知）を実装する | AC-1, AC-3, AC-4, AC-5 | #1 |
| 3 | `src/lib/pr-freshness.ts` へ最新化ロジック追加 | `attemptUpdateBranch()`（`gh api -X PUT .../pulls/{n}/update-branch` + `checkFreshness()` を `UPDATE_BRANCH_POLL_INTERVAL_MS`（3秒）間隔・`UPDATE_BRANCH_POLL_MAX_ATTEMPTS`（10回、合計最大30秒）上限でポーリングする完了確認）を実装する。`BEHIND`/`check_failed`（`UNKNOWN`未解決を含む）はいずれも「未反映」として同様にポーリング継続対象とする。`config.merge.auto_update_branch` が true の場合のみ `merge()` から呼ばれる | AC-2 | #2 |
| 4 | `src/lib/pr-freshness.ts` へ失敗分類器追加 | `MergeFailureClassifier.classifyMergeFailure(stderr)` を実装する。既知の「明らかに無関係」パターン（権限不足・既にマージ済み・既にクローズ済み等を示す `gh` の標準エラー文言）のみを許可 list 化し、それ以外は `ambiguous` を返す | AC-6, AC-7 | なし |
| 5 | `src/commands/pr.ts` の `merge()` 統合 | `merge.autonomous` 確認の後・`gh(['pr','merge',...args])` 呼び出しの前に `resolveMergeTarget()` → `checkFreshness()`（必要なら `attemptUpdateBranch()`）を呼び、`behind`/`check_failed`/最新化失敗時（`resolveMergeTarget()` が `undefined` を返す場合を含む）は日本語エラーメッセージで中断する。`gh pr merge` 失敗時は `MergeFailureClassifier.classifyMergeFailure()` の結果に応じてメッセージを補完する。`MERGE_USAGE` の説明文を更新する | AC-1〜AC-7 | #2, #3, #4 |
| 6 | `test/helpers/gh-stub.ts` 拡張 | `gh pr view` の `mergeStateStatus`・`baseRefName` フィールド返却、`state` を明示制御するテスト用フラグ、`gh api -X PUT .../update-branch` の成功/失敗を制御するスタブ状態を追加する。呼び出し回数に応じて `mergeStateStatus` を切り替えられるようにし（例: 1〜2回目は `BEHIND`、3回目以降は `CLEAN`）、`attemptUpdateBranch()` のポーリングが複数回の再問い合わせで `fresh` に到達するケースと、`UPDATE_BRANCH_POLL_MAX_ATTEMPTS` に到達しても解決しないケースの両方をテストで再現できるようにする。加えて、対象識別子を伴わない `gh pr view --json number` 呼び出し（`resolveMergeTarget()` のcwdベース暗黙解決フォールバック）を、成功（cwdの現在ブランチに紐づくPR番号を返す）と失敗（該当PRなしで非0終了）の両方に切り替えられるスタブ状態も追加する | AC-1〜AC-7（テスト実行の前提） | なし |
| 7 | `test/integration/pr-merge.test.ts` へ受入テスト追加 | AC-1（behind時は既定で中断）・AC-2（update-branch API自体の失敗で中断、およびポーリング上限到達まで反映されず中断する場合の双方。複数回のポーリングを経て `fresh` になり成功する場合も含む）・AC-3（`--admin`付きでも迂回不可、`-R/--repo`等の値取り型オプションを含む引数でも対象PRを正しく解決できる）・AC-4（チェック失敗で中断。`args`に対象識別子が無く、かつ`gh pr view`によるcwdベースの暗黙解決も失敗する場合を含む）・AC-5（fresh時は既存挙動を維持。加えて`args`に対象識別子を含まない場合、`gh pr view`によるcwdベースの暗黙解決が機能し、fresh〔最新〕なPRであれば従来通りマージが成立することを検証し回帰していないことを確認する）・AC-6（明らかに無関係な失敗は既存出力を維持）・AC-7（TOCTOU疑いは日本語メッセージ付きで非0終了）の各ケースを追加する | AC-1〜AC-7 | #5, #6 |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
