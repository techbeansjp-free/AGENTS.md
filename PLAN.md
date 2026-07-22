<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
設計（何を・なぜ・どの構造にするか）と実装計画（どの順序で・どの変更単位で実装するか）は責務が異なる。
実装途中で作業順序だけを見直す場合、DESIGN.md 自体を変更する必要はない。
-->

# PLAN: verify-artifactsのunit_test_results判定をVALIDATION.md結合から分離する

- Issue: `ISSUE-202`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `checkOutputExists()` の `unit_test_results` ケース差し替え | `src/commands/verify.ts` の `switch (output)` から `unit_test_results` を `acceptance_test_results`/`regression_test_results` のケースと分離し、単独の `case 'unit_test_results':` を新設する。判定式は `code` ケースと同一の `defaultBranch(worktreePath)` + `git(['diff', '--stat', 'BASE...HEAD', '--', 'test'], worktreePath)` を用い、`diff.status === 0 && diff.stdout.trim().length > 0` を返す（DESIGN.md「証跡方式の設計判断」参照）。`VALIDATION.md` への参照は本ケースから完全に除去する | `AC-1` | なし |
| 2 | 既存テスト更新（implementationセグメントテスト） | `test/integration/verify.test.ts` の「implementation segmentはdefaultBranchとの差分（コード）とVALIDATION.mdの両方を要求する」テストを、VALIDATION.mdを作成せず `test/` 配下に新規テストファイルを追加してcheckpointする形へ書き換える。テスト名・アサーション内容も「VALIDATION.mdの存在で代替確認する」という現状の前提コメントを、変更後の実際の判定内容（testディレクトリ差分）に合わせて更新する | `AC-1, AC-3` | `#1` |
| 3 | AC-1新規テスト追加（VALIDATION.md不在での成功確認） | implementationセグメントの成果物チェックにおいて、`code` を充足させた上で `VALIDATION.md` を一切作成せず `test/` 配下ファイルの変更のみを行った状態で `verify artifacts <issue> implementation` が成功すること（`unit_test_results` が欠落として報告されないこと）を検証するテストを追加する。SPEC.md AC-1のGiven/When/Thenに1:1で対応させる | `AC-1` | `#1` |
| 4 | 回帰確認（validationセグメント既存テスト） | `test/integration/verify.test.ts` 内の既存のvalidationセグメント関連テスト（「validation segmentはVALIDATION.mdの有無で成否が切り替わり…」「VALIDATION.mdをcommit後に削除しても、履歴上の実績によりvalidationセグメントは成功する」等）が、本Issue適用後も無修正で通過することを確認する | `AC-2` | `#1` |
| 5 | 4セグメント通し回帰確認 | spec→design→implementation→validationの順で各セグメントの成果物を1つずつ揃えながら `verify artifacts` を実行し、各時点で意図した合否（未着手の後続セグメント成果物の有無に影響されないこと、先行セグメント成果物が後続セグメントの判定を代替しないこと）になることを確認する。既存の関連テスト（design/spec/validationセグメントのテスト）と `#2`・`#3` の結果を合わせて確認する | `AC-3` | `#1, #2, #3, #4` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
