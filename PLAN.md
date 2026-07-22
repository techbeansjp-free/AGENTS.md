<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
-->

# PLAN: main リポジトリルート直下に混入した stray なセグメント成果物ファイルの削除

- Issue: `ISSUE-200`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md で定義した通り、変更内容は「root 直下 stray ファイルの削除（`AC-1`・`AC-2`）」と「その結果露見した verify-artifacts の自己言及的欠陥修正（`AC-3`）」の2系統から成る。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | root 直下 stray ファイルの削除 | `git rm SPEC.md DESIGN.md PLAN.md VALIDATION.md` を worktree ルート直下で実行し、削除内容を commit する。`.agent-skill-chain/templates/issue/` 配下の雛形ファイルおよび `.worktrees/` 配下の他 Issue 成果物には触れない | `AC-1` | なし |
| 2 | CI 通過確認（暫定） | #1 の commit を push した PR に対し既存 CI ワークフローを実行し、`verify-artifacts` が `AC-3` 対応前の自己言及的欠陥により失敗することを実際に確認する（この失敗の実観測が `AC-3` 追加スコープの根拠になっている） | `AC-2` | `#1` |
| 3 | verify-artifactsの自己言及的欠陥修正 | `src/commands/verify.ts` の `checkOutputExists()` を DESIGN.md「AC-3対応」節の設計に従い拡張する。SPEC.md/DESIGN.md/PLAN.md/VALIDATION.mdの各判定に、`git(['log', '--diff-filter=AM', '--name-only', 'base..HEAD', '--', file], worktreePath)`（`base` は既存の `defaultBranch(worktreePath)` を再利用。2ドット＝`base`から分岐後にHEAD側で追加された実績のみを見る。`git diff`の3ドット判定とは意味が異なるため混同しない）による履歴判定をOR条件で追加し、`git log`失敗時は例外を握りつぶし「実績なし」に倒す | `AC-3` | `#1`（削除自体は#1で完了済み。本変更単位はその結果露見した検査側の欠陥を修正する） |
| 4 | 回帰テスト追加 | `test/integration/verify.test.ts` に以下3パターンを追加する: (a) SPEC.md/DESIGN.md/PLAN.mdをcommitした後に削除してもspec/design/planセグメントの`verify artifacts`が成功すること、(b) VALIDATION.mdをcommitした後に削除してもvalidationセグメントの`verify artifacts`が成功すること、(c) 対象ファイルを一度もcommitしていない未着手セグメントでは引き続き失敗すること（既存の回帰確認） | `AC-3` | `#3` |
| 5 | CI 通過確認（最終） | #3・#4 の commit を push した PR に対し、既存 CI ワークフロー（`verify-branch-name`・`verify-worktree-path`・`verify-template-sync`・`verify-artifacts`・`verify-ac-coverage`・`verify-adr` を含む）が全て成功することを確認する。特に `verify-artifacts` が本Issue自身のspecセグメントに対して green になることを実地確認する | `AC-2`, `AC-3` | `#2`, `#3`, `#4` |
| 6 | 検証完了後の4ファイル最終再削除＋帰結の証跡化 | validation セグメントが `VALIDATION.md` を作成し検証記録（受入・統合・回帰テスト結果）を完了させた**後**、その validation_worker 自身の最終アクションとして、worktree ルート直下の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` の4ファイルを `git rm` で再度削除し、最後のcheckpointとしてcommit・pushする。これにより `AC-1`（root 直下に4ファイルが存在しない）は、validation セグメント完了時点の最終状態で満たされる。`AC-3` 対応後の `verify-artifacts` は `git log --diff-filter=AM --name-only base..HEAD -- <file>` による履歴判定を用いるため、削除後も spec/design/plan/validation の各セグメントの完了自体は正しく判定され続ける（VALIDATION.md の内容自体は、削除前の直前commitのgit履歴から必要に応じて参照可能）。**この最終削除commitのpush後、validation_worker は帰結の証跡化として次の2点を実際に確認し記録する**：(a) `gate-reconcile`（reconcile workflow）が spec/design/implementation/validation の4ゲートを `action_required` へ遷移させたこと、(b) 同 commit に対する CI 必須 `verify` ジョブで `verify-ac-coverage` が `SPEC.md`・`VALIDATION.md` の不在により失敗したこと。この2点は DESIGN.md「最終削除commitが引き起こすゲート・CI側の帰結」節および `AC-2` が「削除という行為自体の構造的帰結として明示的に受容する」と定めた既知の帰結であり、実際に発生したことを Issueコメントまたは validation_worker の報告（VALIDATION.md 内の検証記録）に記録することで、想定通りの帰結（新規に持ち込んだ欠陥ではないこと）を証跡化する。**実装セグメント直後（#1の時点）ではなくvalidationセグメントの最後に行わなければならない理由**：`SPEC.md`・`DESIGN.md`・`PLAN.md` はvalidation_workerが検証観点（要求・設計との整合性確認）のために参照する必要があり、それより前に削除すると検証作業自体が行えなくなるため | `AC-1`, `AC-2` | `#1`〜`#5` 完了後、validation セグメント側の `VALIDATION.md` 作成完了 |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

## 補足: 実際の削除実行タイミング

本 design セグメントでは実際のファイル削除は行わない。削除の実行は上表 #1・#6 の通り、暫定削除は**実装セグメントの責務**、最終削除は**validation セグメントの責務**とし、design セグメントの成果物は本 DESIGN.md・PLAN.md の執筆に限定する。
