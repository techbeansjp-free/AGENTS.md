# ADR

```yaml
id: ADR-0034
status: proposed
title: 設定リファレンス(docs/CONFIGURATION.md)の陳腐化検知チェックを配布テンプレート外の本リポジトリ専用ワークフローとして新設する
tags: [distribution, ci, documentation, config]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

Issue #429は、`.agent-skill-chain/schemas/config.schema.yaml` が定義するトップレベル設定項目を一覧化する `docs/CONFIGURATION.md` を新設し、あわせてスキーマへの追随漏れを本リポジトリ自身のCIで機械的に検出する仕組みを要求する（SPEC.md AC-7）。同時に、当該検査は配布テンプレート（`.agent-skill-chain/templates/github/.github/`）経由でconsumerプロジェクトへ配布されてはならないという制約も課されている（SPEC.md AC-8）。

本リポジトリの唯一の必須CIチェック（GitHubブランチ保護の `required_status_checks` に登録された `verify` コンテキスト）は `.github/workflows/agent-skill-chain-ci.yml` の `verify` ジョブであり、このファイル自体が配布テンプレート `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml` の展開結果である。`verify-template-sync`（`src/lib/template-sync.ts` の `computeTemplateSyncDiffs`）はテンプレート側ファイルとの完全なbyte一致を要求するため、新しい検査ステップを `verify` ジョブへ直接追記すると、それはテンプレート側にも同一内容で反映しない限りCI自身が同期エラーで落ちる。しかしテンプレート側へ反映すればAC-8（配布禁止）に直接抵触する。

この種の「本リポジトリ専用ロジックを、consumer配布テンプレートと同一ファイルへは足せない」という制約は本Issueが初出ではない。ADR-0017（配布テンプレートと本体専用ファイルの分離基準を確立し、`agent-skill-chain-release.yml` を配布物から除外する）が、Issue #344の実害報告を契機に既に同型の問題を扱っており、「本リポジトリ専用のワークフローは配布テンプレートディレクトリの外（`.github/workflows/` 直下に直接配置し、`.agent-skill-chain/templates/github/.github/workflows/` には置かない）」という分離基準を確立している。`computeTemplateSyncDiffs` はテンプレート側ファイル集合のみを走査し展開先の余剰ファイルは検査しないため、この配置は同期検査を壊さない。

## Decision

Issue #429のスキーマ⇔文書追随検査を、テンプレート外の本リポジトリ専用ワークフロー `.github/workflows/agent-skill-chain-config-doc-sync.yml` として新設する（`.agent-skill-chain/templates/github/.github/workflows/` には追加しない）。検査ロジック自体は既存の `verify <subcommand>` パターン（`src/commands/verify.ts` の関数＋`src/lib/cli-routes.ts` への登録＋`.agent-skill-chain/ci/verify-<name>.sh` の薄いラッパー）を踏襲し、`verify config-doc-sync` として実装する。

`.agent-skill-chain/ci/verify-config-doc-sync.sh` はnpmパッケージの配布対象（`package.json` の `files` に `.agent-skill-chain/ci/` が含まれる）ではあるが、これはAC-8が禁止する配布経路（`.agent-skill-chain/templates/github/.github/` 経由でのワークフロー・スクリプトの配布）とは異なる別チャネルであり、かつconsumer側へ展開されたいかなるワークフローからも呼び出されないため実行されない。この構造は、`.agent-skill-chain/scripts/release-*.sh`（npm配布はされるが `agent-skill-chain-release.yml`——ADR-0017により配布テンプレート外——からのみ起動される）と同型である。

新設ワークフローのジョブ名は `verify-config-doc-sync` とし、既存の必須チェックである `verify` ジョブ（`agent-skill-chain-ci.yml`）とは別名にする。これにより `agent-skill-chain-ci.yml`・その配布テンプレートは1バイトも変更せずに済み、`verify-template-sync` の同期検査に影響を与えない。

## Consequences

- 新設ワークフローを本リポジトリのGitHubブランチ保護（`required_status_checks`）へ必須チェックとして追加するか否かは本ADRの対象外とする。追加せずとも、当該ワークフローはPRごとに実行されCI結果（成功/失敗）は可視化される。必須化する場合、本リポジトリの実ルールセット設定は配布テンプレート `.agent-skill-chain/templates/github/provisioning/rulesets/main.json` と意図的に乖離させる必要があり（当該JSONへ追加するとconsumer側へ配布され、常に未実行のチェックとして待機し続ける不具合を招く）、その乖離を追跡する仕組みは別途の判断・別Issueに委ねる。
- 将来 `config.schema.yaml` のトップレベルプロパティを追加・削除するIssueは、本チェックの失敗を解消するため `docs/CONFIGURATION.md` への追随が実質的に必須となる。
- `.agent-skill-chain/ci/` 配下に「配布はされるが、配布テンプレート経由のいかなるワークフローからも呼ばれない検査スクリプト」が今後増える可能性がある。本ADRはその配置パターン自体をADR-0017に続く2件目の前例として確立するに留め、パターンの一般名称化・ガイドライン化は対象外とする。
