# PLAN: bugfix: worker-launchが対象issueの専用worktreeへcdせず、複数worktree並存時に対象を特定できない

- Issue: `ISSUE-442`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `resolveIssueWorktreeExactlyOne` 新設 | `src/lib/worktree.ts`。`findIssueWorktree`のpath-pattern正規表現構築部分を共有ヘルパーへ抽出し、`listWorktrees`結果を全件フィルタして`found`（1件）/`not_found`（0件）/`ambiguous`（2件以上、該当worktreeパス列挙付き）を返す関数を追加する。0件時は既存`findIssueWorktree`のbranch名一致・CI単一checkoutフォールバックへ委譲し、既存呼び出し元8箇所（`issue.ts`・`verify.ts`・`adr.ts`・`gate.ts`・`lease.ts`・`pr.ts`・`cleanup.ts`・`reconcile.ts`）の挙動は変更しない | AC-4 | なし |
| 2 | `worker context` へ `worktree_path=` 追加 | `src/commands/worker.ts`の`context()`、segment指定時のみ`resolveIssueWorktreeExactlyOne`を呼び、`found`の場合だけ`worktree_path=<絶対パス>`行を`issue_number=`の直後に追加する。`not_found`/`ambiguous`時は行を出さない（コマンド自体は既存どおり成功）。segment省略の3行のみ返す経路は無改修 | AC-1, AC-2, AC-3, AC-4（前提） | #1 |
| 3 | `worker-launch.sh` の解決・再実行ブロック追加 | `.agent-skill-chain/scripts/worker-launch.sh`。`_cli worker context`成功直後・他フィールド抽出前に`worktree_path=`を抽出。空なら「対象issueのworktreeを一意に解決できませんでした」でexit 2（lease取得前）。値がありかつ自身の`REPO_ROOT`と`-ef`で不一致なら、対象worktree内`.agent-skill-chain/scripts/worker-launch.sh`の実在を確認したうえで`cd`後`exec`により処理を委譲する（環境変数`ASC_WORKER_LAUNCH_REEXEC`による一回限りの再帰ガード付き。ガード済みでなお不一致ならexit 2） | AC-1, AC-2, AC-3, AC-4, AC-5 | #2 |
| 4 | 単体テスト: `resolveIssueWorktreeExactlyOne` | `test/unit/worktree.test.ts`に`found`（1件一致）・`not_found`（0件、既存フォールバック込み）・`ambiguous`（同一issue_idに2worktree該当、候補パスがエラーメッセージへ列挙される）の3ケースを追加 | AC-4 | #1 |
| 5 | 統合テスト: `worker context` の `worktree_path` | `test/integration/worker-context.test.ts`に、`issue start`実行後は`worktree_path=`行が出ること、未実行時は出ないこと（既存の3行/6行deepEqualテストが無改修で通ることの確認を含む）を追加 | AC-1, AC-4 | #2 |
| 6 | 統合テスト: `worker-launch.sh` の対象特定 | `test/integration/worker-adapters.test.ts`に以下を追加: (a) 複数worktree（対象issue用+別issue用）並存下でmain相当のcwd・絶対パス経由で起動しても対象worktree内で完結すること（AC-2, AC-3）、(b) 同一issue_idに一致するworktreeを意図的に2つ作り、lease未取得のままexit非0で停止すること（AC-4）、(c) 呼び出し元cwdが別worktree（異なるHEAD）を指す状態でも、完了確認が対象worktree自身のHEADで正しく判定されること（AC-5、正常完了・偽装完了双方の既存ケースが対象worktree基準になっても壊れないことを含む） | AC-1〜AC-5 | #3 |

## 実装順序の見直しについて

実装中に#4〜#6のテスト追加順序のみを見直す場合は本ファイルのみ更新すればよい。`resolveIssueWorktreeExactlyOne`の返り値の形（`found`/`not_found`/`ambiguous`の判別可能な結果）や、`worker-launch.sh`の再実行ブロックの配置（lease取得より前段であること）自体を変更する場合はDESIGN.mdの更新（設計ゲート再通過）が必要になる。
