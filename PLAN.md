# PLAN: security: reconcile workflowがpushトリガーのYAML自己参照によりGate Check Runを偽造可能

- Issue: `ISSUE-342`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `reconcile-trigger`ワークフロー新規作成 | `.github/workflows/agent-skill-chain-reconcile-trigger.yml`を新規作成する。`on: push`（既存`agent-skill-chain-reconcile.yml`と同一の`branches-ignore: [main, 'chore/root-cleanup-*']`）、`permissions: {}`、checkoutなし、trivialな1ステップのみのjobとする。同一内容を`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-reconcile-trigger.yml`にも配置する | AC-1 | なし |
| 2 | `reconcile`ワークフローの`workflow_run`化 | `.github/workflows/agent-skill-chain-reconcile.yml`の`on:`を`push`から`workflow_run: workflows: ["agent-skill-chain / reconcile-trigger"], types: [completed]`へ変更する。checkoutをdefaultブランチ（trust root）に対して行い、対象SHAは`git fetch --no-tags origin "<head_branch>:refs/agent-skill-chain/targets/<head_sha>"`でread-onlyなgit objectとして取得する（checkout対象には含めない）。`Derive issue_id`ステップの`env.BRANCH`を`${{ github.ref_name }}`から`${{ github.event.workflow_run.head_branch }}`へ、`Reconcile gates against pushed SHA`ステップの対象SHA引数を`${{ github.sha }}`から`${{ github.event.workflow_run.head_sha }}`へ置き換える。job名`reconcile`・step名・step id`ctx`・3分岐dependabot判定ロジックの字句・`permissions`ブロックはすべて維持する。同一変更を配布テンプレート側の同名ファイルにも適用する | AC-1, AC-2, AC-4 | #1 |
| 3 | 配布テンプレート同期の確認 | `.agent-skill-chain/ci/verify-template-sync.sh`（`agent-skill-chain verify template-sync`）をローカルで実行し、`.github/workflows/agent-skill-chain-reconcile.yml`・新規`agent-skill-chain-reconcile-trigger.yml`のリポジトリ実体と配布テンプレートが完全一致することを確認する。差異があれば#1・#2の変更をテンプレート側へ反映する | AC-3 | #1, #2 |
| 4 | 既存ユニットテストの追随・拡張 | `test/unit/dependabot-ci-skip.test.ts`を次の点で更新する：(a) `agent-skill-chain-reconcile.yml`の`on.workflow_run.workflows`が`agent-skill-chain-reconcile-trigger.yml`の`name`と一致することを検査する項目を追加、(b) `agent-skill-chain-reconcile-trigger.yml`が`permissions: {}`であることを検査する項目を追加、(c) `agent-skill-chain-reconcile-trigger.yml`本体とテンプレート正本が完全一致することを検査する項目を追加（既存の`agent-skill-chain-reconcile.yml`同士の完全一致検査と同型）。`test/unit/dependabot-ci-skip-exec.test.ts`は`ctx`ステップの`run`本文抽出＋env直接注入という実行方式のため変更不要であることを確認する（`BRANCH`等の値は直接envで渡しており、YAML側の参照式変更の影響を受けない） | AC-1, AC-3, AC-4 | #1, #2 |
| 5 | ADR-0016のfinalize対応準備 | 設計ゲート承認後、進行役が`.agent-skill-chain/scripts/adr-finalize.sh`を起動できる状態にしておく（本Issueの設計セグメントでは`docs/adr/ADR-0016-reconcile-workflow-run-trust-boundary.md`を`status: proposed`のまま作成済みとし、`accepted`への遷移はADR finalizationワーカーの責務とする） | 該当なし（設計ゲート完了条件） | #1〜#4 |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.mdの更新（および設計ゲートの再通過）が必要になる点に注意する。
