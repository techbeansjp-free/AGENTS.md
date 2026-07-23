<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
設計（何を・なぜ・どの構造にするか）と実装計画（どの順序で・どの変更単位で実装するか）は責務が異なる。
実装途中で作業順序だけを見直す場合、DESIGN.md 自体を変更する必要はない。
-->

# PLAN: PRマージのたびにSPEC/DESIGN/PLAN/VALIDATION.mdがmainルート直下へ恒久的に混入する構造的欠陥の解消

- Issue: `ISSUE-208`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `verify root-clean` の新設 | `src/commands/verify.ts` に、`checkOutputExists()`/`wasEverAddedOrModified()`とは独立した新規エクスポート関数を追加する。repoRoot直下に `SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md` が存在しないことのみを確認する単純な存在チェックとし、既存関数へは一切手を入れない。CLIサブコマンド `verify root-clean` として配線する | `AC-4` | なし |
| 2 | `root-cleanup run` の新設 | `src/commands/root-cleanup.ts` を新設する。repoRoot直下の当該4ファイル（コード内リテラル、設定化しない）の存在検出、0件時no-op、1件以上時は短命ブランチ`chore/root-cleanup-<UTC timestamp>`作成→該当ファイルのみ`git rm`→固定メッセージでcommit・push→PR作成→マージ直前のスコープ検査（削除のみで構成されているか）→`gh pr merge --admin --squash --subject`、を実装する。`src/commands/release.ts`の`ensureGitIdentity`相当のgit identity保証処理・スコープ検査・同名ブランチ/PRの冪等な再利用ロジックを参考に実装し、重複するロジックがあれば共有ヘルパーへ切り出す | `AC-1, AC-3` | なし |
| 3 | CLIラッパー・ワークフロー新設 | `.agent-skill-chain/scripts/root-cleanup.sh`・`.agent-skill-chain/ci/verify-root-clean.sh`（既存`release-bump.sh`等と同型の薄いラッパー）、および`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-root-cleanup.yml`を新設する。ワークフローは`on: push: branches: [main]`、`[skip ci]`ガード、`concurrency: {group: root-cleanup}`、`permissions: contents: write`とし、`root-cleanup run`ステップには`env: GH_TOKEN: ${{ secrets.RELEASE_MAIN_PAT }}`を配線する（push・PR作成・admin mergeがadmin bypassを要し既定の`GITHUB_TOKEN`では不可のため。既存`agent-skill-chain-release.yml`の`release bump`ステップと同一secretを再利用し新規secretは追加しない）。`verify root-clean`ステップは読み取りのみのため`${{ github.token }}`で足りる。あわせて`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-reconcile.yml`（および`.github/workflows/`側の展開結果）の`branches-ignore`を`[main]`から`[main, 'chore/root-cleanup-*']`へ変更し、cleanupブランチへのpushでreconcileジョブが誤って`exit 1`失敗するCIノイズを防ぐ（DESIGN.md「`agent-skill-chain-reconcile.yml`との関係（訂正）」参照）。`.github/workflows/`へ同期し`verify-template-sync`の対象に自然に含まれることを確認する | `AC-1` | `#1, #2` |
| 4 | 単体・統合テスト追加 | `test/integration/root-cleanup.test.ts`（新設）で、(a) 対象4ファイルが0件のときno-opになること、(b) 1件以上のとき該当ファイルのみが削除対象になり無関係なファイルは削除されないこと、(c) スコープ検査に違反するdiff（headブランチ名不一致、または削除以外の変更を含む）の場合はadmin mergeを行わず`human_required`相当の結果を返すこと、(d) `verify root-clean`が4ファイル残存時に失敗しゼロ件時に成功すること、を検証する | `AC-1, AC-4` | `#1, #2` |
| 5 | 並行Issue不干渉の自動検証（AC-3専用） | `test/integration/root-cleanup.test.ts`（または専用の新設ファイル）に、複数の疑似Issueブランチ・worktreeが並行して存在する状態を模した統合テストを追加する。具体的には、2つ以上の独立したgit worktree（それぞれ独自の`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`を持つ疑似Issueブランチ）を用意し、一方のブランチ相当の内容をmain側で`root-cleanup run`により削除処理した後も、他方のworktree・ブランチのファイル内容・commit履歴（各commitのSHA）が実行前後で一切変化しないこと（byte-for-byte一致・SHA一致）をアサートする。あわせて、root-cleanupの短命ブランチ作成・削除が`.agent-skill-chain/ci/verify-worktree-path.sh`のworktree命名規則検査や他Issueのworktreeパス解決（`findIssueWorktree()`等）に影響しないことを確認する | `AC-3` | `#1, #2` |
| 6 | 既存テストの無変更確認（回帰） | `test/integration/verify.test.ts`（`checkOutputExists()`/`wasEverAddedOrModified()`を対象とする既存テスト全件）が本Issue適用後も無修正・無変更で通過することを確認する。`segments.yaml`・`roles.yaml`に対する既存テストについても同様に無影響であることを確認する | `AC-2` | `#1, #2, #3` |
| 7 | 実地回帰確認 | 本Issue（#208）自身のPRをマージし、そのmainへのpushで`agent-skill-chain / root-cleanup`ワークフローが実際に起動して、root直下の`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`（Issue #202由来の既存残存分を含む）が削除されることを実地に確認し、証跡をVALIDATION.mdへ記録する | `AC-4` | `#1, #2, #3, #4, #5, #6` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
