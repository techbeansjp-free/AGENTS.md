# PLAN: root-cleanup runを永続main worktreeから直接実行すると実行後に一時ブランチのまま取り残されmainへ戻らない

- Issue: `ISSUE-619`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `checkout-state.ts` 新規作成 | `src/lib/checkout-state.ts` に `CheckoutState` 判別共用体（`{ kind: 'branch'; name: string }` \| `{ kind: 'detached'; sha: string }`）、`captureCheckoutState(root): CheckoutState`（`git rev-parse --abbrev-ref HEAD` が `HEAD` を返せばdetachedとしてSHAを記録、それ以外はブランチ名を記録）、`restoreCheckoutState(root, state): string \| undefined`（`git checkout <name または sha>` を実行し、失敗時は復元先・失敗後の現在ブランチ名を含むエラーメッセージ文字列を返す）を実装する | `AC-1, AC-2`, 要件（detached HEAD復元）, 要件（復元失敗時エラー） | なし |
| 2 | `checkout-state.ts` の単体テスト | `test/unit/checkout-state.test.ts` を新規作成し、(a) ブランチチェックアウト中の記録・復元、(b) detached HEADチェックアウト中の記録・復元（同一commitへ戻る）、(c) 復元先が存在しない場合（不正なブランチ名を直接渡す等）に `restoreCheckoutState` がエラーメッセージ（復元失敗の旨・失敗後の現在ブランチ名を含む）を返すこと、を実行bareでない一時git repoに対して検証する | `AC-1, AC-2`, 要件（detached HEAD復元）, 要件（復元失敗時エラー） | `#1` |
| 3 | `performCleanupBranch` への抽出 | `src/commands/root-cleanup.ts` の既存 `run()` 内 `if (!pr) { ... }` ブロック（`git checkout -b`・`ensureGitIdentity`・`git rm`・`git commit`・`git push`・`gh pr create`・`findOpenPrByHead`）を `performCleanupBranch(root, branch, stray): { pr: OpenPr } \| { error: string }` として抽出する。挙動は変更しない（純粋なリファクタ） | `AC-6`（回帰なしの基盤） | なし |
| 4 | `run()` のオーケストレーション変更 | `!pr` 分岐に入る直前で `captureCheckoutState(root)` を呼ぶ。`performCleanupBranch` 実行後、直ちに `restoreCheckoutState(root, initialState)` を呼ぶ。復元が失敗した場合はスコープ検査・admin mergeへ進まず即座に `fail(...)` で終了する（fail-closed）。復元が成功した場合は、`performCleanupBranch` の結果に応じて既存の `checkRootCleanupPrScope`・`gh pr merge --admin` 処理へ進む（`performCleanupBranch` がエラーだった場合はそのエラーで `fail(...)` する） | `AC-1, AC-2, AC-5` | `#1, #3` |
| 5 | `gh-stub.ts` へのPR作成失敗シミュレーション追加 | `test/helpers/gh-stub.ts` に、既存の `failMergeCount`/`failMergeMessage` と同型の `failPrCreateCount`/`failPrCreateMessage` を追加し、`gh pr create` 呼び出し時に指定回数だけ非ゼロ終了・任意メッセージで失敗させられるようにする | `AC-5`（テストインフラ） | なし |
| 6 | 統合テスト: AC-1（mainチェックアウト中の復元） | `test/integration/root-cleanup.test.ts` に、`main` をチェックアウトした状態で削除対象ファイルを用意し `root-cleanup run` を実行、成功後に `git rev-parse --abbrev-ref HEAD` が `main` であることを検証するテストを追加する | `AC-1` | `#4` |
| 7 | 統合テスト: AC-2（main以外チェックアウト中の復元） | 同ファイルに、`main` 以外の任意ブランチ（例: 進行役の作業ブランチ相当）をチェックアウトした状態で同様に実行し、実行前と同じブランチへ戻ることを検証するテストを追加する | `AC-2` | `#4` |
| 8 | 統合テスト: AC-3（no-opでのチェックアウト状態不変） | 既存のno-opテスト（削除対象0件）に、実行前後で `git rev-parse --abbrev-ref HEAD` が変化していないことのアサーションを追加する | `AC-3` | なし |
| 9 | 統合テスト: AC-4（既存OPENブランチ・PR再利用時のチェックアウト状態不変） | 既存の「自己修復」テスト（既存OPEN cleanup PRを再利用するケース）に、実行前後で `git rev-parse --abbrev-ref HEAD` が変化していないことのアサーションを追加する | `AC-4` | なし |
| 10 | 統合テスト: AC-5（push・PR作成失敗時も復元） | `#5` の `failPrCreateCount` を用いて `gh pr create` を失敗させ、`root-cleanup run` がエラー終了コードで終了し、かつ実行前のブランチへ復元されていることを検証するテストを追加する | `AC-5` | `#4, #5` |
| 11 | 統合テスト: AC-6（CIランナー既存動作への非回帰） | 既存の成功系テスト（削除対象ありのPR作成・admin merge成功ケース）が、本変更後も従来どおりの標準出力（PR番号）・終了コード0で完了することを確認する（既存テストの再実行で担保し、出力形式のアサーションが不足していれば補強する） | `AC-6` | `#4` |
| 12 | 単体テスト: 復元失敗時のfail-closed確認 | `performCleanupBranch` が成功し `restoreCheckoutState` が失敗するケースを再現できないか統合テストで検討し、再現困難な場合は `run()` のオーケストレーションロジックを直接呼び出せる形（または `restoreCheckoutState` のモック注入不要な単体テスト）で、復元失敗時にスコープ検査・admin merge（`gh pr merge`）が一切呼ばれないことを検証する | 要件（復元失敗時エラー） | `#4` |

<!-- design-gate再通過分（validation-gateで発見された回帰、test/integration/pr-merge.test.ts「pr merge (ISSUE-590 AC-3)」への是正）。以下 #13〜#17 を追加する。 -->

| 13 | `syncBaseBranchAfterAdminMerge` 新規実装 | `src/commands/root-cleanup.ts` に `syncBaseBranchAfterAdminMerge(root, base): string \| undefined` を新規実装する。`captureCheckoutState(root)` で現在のチェックアウト状態を確認し、`{ kind: 'branch', name: base }` と一致する場合のみ `git fetch origin <base>` → `git merge --ff-only origin/<base>` を実行する。一致しない場合（detached HEAD、または `base` 以外のブランチ）は何もせず `undefined` を返す。`fetch`/`merge --ff-only` いずれかが失敗した場合は、追従先・失敗理由・`root` での手動対応を促す日本語エラーメッセージ文字列を返す（例外を投げない） | 要件（root-cleanup run自身のadmin mergeがbase branchを前進させた場合のローカル反映） | `#1`（`captureCheckoutState`を再利用） |
| 14 | `run()` への組み込み | `gh pr merge --admin` が成功した直後（`!pr` 経路・`existingBranch && pr` 再利用経路の両方で共通、スコープ検査・admin merge呼び出し自体の位置は変更しない）に `syncBaseBranchAfterAdminMerge(root, base)` を1回呼ぶ。戻り値が文字列（エラー）なら `fail(...)` で終了し、admin merge自体は取り消さない。戻り値が `undefined` なら従来どおり `ok(String(pr.number))` で終了する | 要件（root-cleanup run自身のadmin mergeがbase branchを前進させた場合のローカル反映） | `#13` |
| 15 | 既存統合テスト2件の是正 | `test/integration/root-cleanup.test.ts` の「対象ファイルが1件以上のとき...」「対象4ファイルすべてが存在する場合...」の各テストに、`run()` 完了後 `repo.dir` 直下（mainチェックアウト中のworktree自体）から削除対象ファイルが `fs.existsSync` で確認できないことのアサーションを追加する。現状の「ISSUE-619の復元によりローカルのチェックアウトはmain（削除前の状態）へ戻るため、削除自体の検証はpushされた一時ブランチの内容で行う」という趣旨のコメントは、本是正により陳腐化するため削除・更新する（削除対象ファイルの検証はpushされた一時ブランチの内容に加え、`repo.dir` 直下の内容でも直接行えるようになる） | 要件（root-cleanup run自身のadmin mergeがbase branchを前進させた場合のローカル反映） | `#13, #14` |
| 16 | 新規統合テスト: baseと異なるブランチへ復元するケースでの非適用確認 | `test/integration/root-cleanup.test.ts`（ISSUE-619 AC-2テストと同一パターン: `main` 以外のブランチをチェックアウトした状態で実行）に、完了後 `syncBaseBranchAfterAdminMerge` のfetch/ff-only同期が試みられない（実行前後で当該ブランチの内容・commit履歴が変化しない）ことを確認するアサーションを追加する | 要件（root-cleanup run自身のadmin mergeがbase branchを前進させた場合のローカル反映） | `#13, #14` |
| 17 | 回帰確認: 既存の `pr merge` 連鎖呼び出しテスト | 新規テストの追加ではなく、既存の `test/integration/pr-merge.test.ts`「pr merge (ISSUE-590 AC-3): マージ・同期成功後、root直下混入ファイルをroot-cleanup runが自動検出・削除する」が本是正（`#13, #14`）により変更なしで再度passすることを確認する（`src/commands/pr.ts` 自体は変更しない） | 要件（root-cleanup run自身のadmin mergeがbase branchを前進させた場合のローカル反映） | `#13, #14` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
