# ADR

```yaml
id: ADR-0016
status: proposed
title: reconcileのpush自己参照信頼境界をworkflow_run分離で解消する
tags: [security, ci, trust-boundary, github-actions, gate]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`agent-skill-chain / reconcile`（`.github/workflows/agent-skill-chain-reconcile.yml`）は`on: push`（`branches-ignore: [main, 'chore/root-cleanup-*']`）で起動し、`permissions: checks: write`を持つ。GitHub Actionsの仕様上、`push`トリガーで実行されるワークフローは、ワークフローYAMLファイル自体を「pushされたコミット」から読み込む。実行時の判定ロジック（agent-skill-chain CLIのビルド元ソース、`gate reconcile`サブコマンドの実装）も同じチェックアウトから`npm ci && npm run build`されるため、pushされたブランチの内容から読み込まれる。

このため、正規のセグメントワーカーを含むwriter権限保有者が、自分のissueブランチへpushする際にワークフローYAML自体または判定ロジックのソースを改変するだけで、`GITHUB_TOKEN`の`checks: write`権限を用いて`agent-skill-chain/{spec,design,implementation,validation}-gate`のいずれかのCheck Runを、実際のレビュー証跡なしに成功として発行できてしまう。これはAGENTS.md I2（セグメントゲート）・I5（進行役の純粋性）が前提とする「ゲート成功はGitHub Check Runの正規発行元（専用App/Workflow）に限定され、成果物内容の改変では偽造できない」という信頼モデルを無効化する（ISSUE-342）。

同リポジトリの`.github/workflows/agent-skill-chain-gate.yml`は既に対照的な安全なパターンを実装している。`pull_request_target`で起動するためワークフローYAML自体は常にdefaultブランチ（trusted）から読まれ、`actions/checkout@v7`は保護されたbaseのSHAを明示指定し、PR headは`git fetch`によるread-onlyなgit objectとしてのみ取得し実行しない。

検討した代替案:

- **`pull_request_target`への一本化**: issue-start直後のSPECワーカー初回pushはDraft PR作成前に発生するため、reconcileが常にPRコンテキストを前提にできず、既存の正規フロー（AC-2）を壊す。不採用。
- **`push`のまま`persist-credentials: false`等でcredentialだけ絞る**: ワークフローYAML自体・CLIソースが依然としてpushされた内容から読まれる事実は変わらず、根本原因（自己参照）を解消しない。不採用。
- **ADR-0013（`docs/adr/ADR-0013-trusted-gate-check-materialization.md`、`status: proposed`）が提案する専用GitHub App／Required Workflowへの全面移行**: 未承認かつスコープが本Issueより大幅に広い（enforcement backend全体の刷新）。本Issueはpushトリガーのワークフロー自己参照という個別の脆弱性解消に限定するため不採用（ADR-0013と本ADRは独立しており、将来ADR-0013が採用されても本ADRの決定と矛盾しない）。
- **`workflow_run`によるtrigger/trusted分離**: GitHub Actions公式に推奨される、fork由来PRに対する`pull_request_target`と同型のパターンを、同一リポジトリ内push（fork不要）にも適用する。`workflow_run`イベントで起動するワークフローは、トリガー元ワークフローの実行結果に関わらず常にdefaultブランチのYAML定義として解決される（GitHub Actionsの仕様）。採用。

## Decision

`agent-skill-chain / reconcile`を次の2ワークフローへ分離する。

1. `agent-skill-chain-reconcile-trigger.yml`（新規、untrusted）: 既存と同一の`on: push`／`branches-ignore`で起動する。`permissions: {}`とし、checkoutを行わずtrivialな1ステップのみを持つ。判定ロジックを一切持たないため、pushされた内容がどう改変されても特権操作（`checks: write`等）を実行できない。

2. `agent-skill-chain-reconcile.yml`（既存ファイルを変更、trusted）: `on: workflow_run: workflows: ["agent-skill-chain / reconcile-trigger"], types: [completed]`で起動する。`workflow_run`により本ファイル自体のYAML定義は常にdefaultブランチから読み込まれる。defaultブランチをcheckoutしてtrust rootとし、`npm ci && npm run build`もdefaultブランチ由来のソースから行う。pushされたSHAは`git fetch`で`refs/agent-skill-chain/targets/<sha>`へread-onlyなgit objectとして取得するのみで、checkoutやビルド対象には含めない。既存の`gate-reconcile.sh`・`gate reconcile`サブコマンド（`artifactDigestAtSha`が`git show <sha>:<path>`によるread-only参照として実装済み）はこの構成にそのまま整合するため無変更とする。issue_id抽出・dependabotの3分岐許可判定ロジックの字句は維持し、参照元イベントフィールドのみ`github.ref_name`/`github.sha`から`github.event.workflow_run.head_branch`/`github.event.workflow_run.head_sha`へ置き換える（いずれもGitHubが提供するイベントメタデータであり、pushされたファイル内容ではない）。

両ファイルはリポジトリ実体（`.github/workflows/`）と配布テンプレート正本（`.agent-skill-chain/templates/github/.github/workflows/`）の両方に同一内容で配置する。

## Consequences

- reconcileはpushごとに2回のワークフロー実行（untrusted trigger + trusted follow-up）になる。追加コストはGitHub Actionsの実行時間がごく短い1ジョブ分増える程度であり、`checks: write`を持つ側の実行内容・回数は従来と同一（1回）である。
- `agent-skill-chain-reconcile.yml`側の`workflow_run.workflows`指定は`agent-skill-chain-reconcile-trigger.yml`の`name:`と字句一致している必要がある。将来どちらかの`name:`を変更する場合は両方を同時に更新しなければならず、不一致になるとreconcileが起動しなくなる（fail-safe側に倒れるため、Check Run偽造の再発ではなくreconcile機能の停止として顕在化する）。
- 攻撃者が自分のissueブランチ上で`agent-skill-chain-reconcile-trigger.yml`を削除・無効化しても、trigger workflow自体が無権限のため得られる利益が無い。結果は当該ブランチのreconcileが起動しなくなることのみであり、他Issue・他人のCheck Run偽造には至らない。
- `test/unit/dependabot-ci-skip.test.ts`はワークフローYAML構造を直接パースして固定化しているため、新規ファイルの追加・`on:`変更・参照フィールド変更に追随させる更新が実装セグメントで必要になる（詳細は`PLAN.md`）。`test/unit/dependabot-ci-skip-exec.test.ts`は`ctx`ステップの`run`本文をenv直接注入で実行検証する方式のため、この変更による影響を受けない。
- 本ADRはADR-0013（専用GitHub App／Required Workflowによるenforcement backend全体の刷新、未承認）を採用・前提としない。`GITHUB_TOKEN`＋Check Runという既存のcredential/backendモデルは本Issueのスコープ外として維持される。default branchへの直接書き込み（branch protectionにより人間の承認を要する）を最終的な信頼の起点とする点も従来通り変わらない。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。

## ライフサイクル

```text
DESIGNワーカー   → ADR を proposed で作成
設計レビュア     → ADR 本文をレビュー（read-only）→ content digest を承認
進行役           → adr-finalize.sh を起動
ADR finalization → writer lease を取得 → status を accepted へ更新
ワーカー           → commit・push → content digest を再検査
```

- `proposed → accepted`: 設計ゲート承認時に遷移する。設計レビュアは ADR 本文をレビューし content digest を承認するのみ（read-only、直接 status を書き換えない）。進行役が `.agent-skill-chain/scripts/adr-finalize.sh` を起動し、専任の ADR finalization ワーカーが writer lease を取得したうえで `status` のみを `accepted` に更新して commit・push する（`.agent-skill-chain/config/roles.yaml` の `adr_finalization_worker`、`scope: adr_status_only`）。finalization ワーカーは書込み前に content digest を再検査する。
- `accepted → superseded`: 新しい ADR を含む同一 PR 内で、新 ADR の作者（ワーカー）が旧 ADR の `status` / `superseded-by` を同一 PR で更新する。`supersedes` ⇔ `superseded-by` の対称性・参照先の実在が機械検査される。
- `accepted → deprecated`: 前提が消滅し後継が無い場合に遷移する。`deprecated-reason` に1行の理由を記録する（存在検査あり）。

## related_adrs 参照ルール

他 Issue の `DESIGN.md` から本 ADR を参照する場合は `related_adrs:` フィールド（構造化リスト）を用いる。stale 参照検査（`adr-lint.sh check`）はこのフィールドのみを対象とし、`accepted` の ADR のみ参照可能とする。本文中の自然文による歴史的言及（例: 「本決定は ADR-0007 を置き換える」）は検査対象外であり許可される。
