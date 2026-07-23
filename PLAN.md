# PLAN: Dependabot許可判定がgithub.actorに依存し人間の手動テンプレート同期commitで不成立になる不具合の是正

- Issue: `ISSUE-219`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md の設計要素A〜Dを、以下の順序・単位で実装する。各単位は対応 AC-ID と依存関係を明示する。本体2ファイルを先に確定し、テンプレート正本へ同期、最後にテスト更新と整合確認を行う（テンプレート同期テスト・verify-template-sync が両者の完全一致を担保するため、本体確定→同期の順が安全）。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | ci.yml 本体修正 | `.github/workflows/agent-skill-chain-ci.yml` の `Derive issue_id` ステップの env を `ACTOR: ${{ github.actor }}` → `ACTOR: ${{ github.event.pull_request.user.login }}` に変更。他ロジック・比較文字列は不変 | `AC-1`, `AC-3`, `AC-4` | なし |
| 2 | reconcile.yml 本体修正 | `.github/workflows/agent-skill-chain-reconcile.yml` の `jobs.reconcile.if`（job-level 早期スキップ）を撤回。`permissions` に `pull-requests: read` 追加。`Derive issue_id` を step-level 3分岐（第1: `branch.pattern` 一致で `skip_checks=false`／第2: `dependabot/` 始まりで `gh api "repos/$REPO/pulls?head=$OWNER:$BRANCH&state=open" --jq '.[0].user.login // empty'` により実 PR 作成者を確認し `dependabot[bot]` 一致で `skip_checks=true`・不一致/empty で日本語理由付き `exit 1`／第3: `exit 1`）へ変更。env に `GH_TOKEN`・`REPO=github.repository`・`OWNER=github.repository_owner` を追加。`Reconcile gates against pushed SHA` に `if: steps.ctx.outputs.skip_checks != 'true'` を付与 | `AC-2`, `AC-3`, `AC-4` | なし |
| 3 | テンプレート正本2ファイルへの同期 | `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`・同 `-reconcile.yml` へ #1・#2 と 1バイト差異なく同一変更を適用 | `AC-5` | `#1`, `#2` |
| 4 | テストの更新・追加 | `test/unit/dependabot-ci-skip.test.ts` の「reconcile: `jobs.reconcile.if` が `dependabot[bot]` と `dependabot/` を参照して除外する」テストを撤去し、新判定手段を固定するアサーション（reconcile に job-level `if` 早期スキップが無い／`Derive issue_id` が3分岐で API の PR 作成者を `dependabot[bot]` と比較／照合ステップに `skip_checks != 'true'` の `if`／`permissions` に `pull-requests: read`／判定に `github.actor` を用いない）へ置換。本体＝テンプレート完全一致テストは維持。加えて `test/unit/dependabot-ci-skip-exec.test.ts` を新設し、両ワークフローの `Derive issue_id` の `run` 本文を抽出して bash 実行し、通常ブランチ／Dependabot 起源／人間の追加 push／偽装ブランチ／`branch.pattern` 衝突型の各シナリオの終了コード・出力を実測する（reconcile の `gh api` は PATH 上のモック `gh` で置換） | `AC-1`〜`AC-5` | `#1`, `#2`, `#3` |
| 5 | 整合確認 | `npm run build && npm test`（更新後テストの成功）と `./.agent-skill-chain/ci/verify-template-sync.sh`（本体＝テンプレート正本の完全一致）を実行し、全 AC の automated 検証観点が満たされることを確認 | `AC-1`〜`AC-5` | `#1`, `#2`, `#3`, `#4` |

## 実装順序の見直しについて

上記の変更単位の並びのみを見直す場合は本ファイルのみを更新すればよい。設計要素・責務・境界（例: reconcile の PR 作成者確認手段、OWNER の導出元）を変更する場合は DESIGN.md の更新および設計ゲートの再通過が必要になる。
