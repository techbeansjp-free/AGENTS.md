<!--
正本: AGENTS.md §ADR・テンプレート・テスト適用性
このファイルは Issue 毎（design セグメント）に複製して使う雛形である。docs/adr/ に保存する。
-->

# ADR

```yaml
id: ADR-0016
status: proposed   # proposed | accepted | superseded | deprecated
title: trusted gate recorderの専用App未設定はrepository変数によるjob-level guardでneutral化し、記録済み信頼機構は変更しない
tags: [gate, github-app, ci, availability]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.github/workflows/agent-skill-chain-trusted-gate.yml`の`record` jobは、ゲートレビュー証跡をdurableなCheck Runとして記録するために、専用GitHub Appの認証情報`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`（`environment: agent-skill-chain-gate-bootstrap-v1`にスコープされ、defaultブランチ限定でのみ参照可能な設定）を要求する。これらが本環境に設定されていない場合、`bin/agents-md.js gate record-trusted-check prepare`内の必須環境変数チェックがエラーを投げ、job全体がfailure（赤）として終了する。この状態は、記録処理を実際に実行した結果として検出された真正性検証の失敗（Check・attestation・signer-workflowの不一致等）によるfailureと区別できず、開発チームがCI結果を都度目視判断してadmin mergeする運用を常態化させるリスクを持つ。

対応方針として、(a) 専用App未設定時にjob conclusionをneutral/skip相当にする案と、(b) 専用GitHub App要件自体を撤廃し認証情報の有無に依存しない代替の信頼機構へ置換する案の2つを比較検討した。`docs/adr/ADR-0013-trusted-gate-check-materialization.md`（本ADR起票時点でstatus: proposed）は、GitHub App方式の代替として、org/enterprise rulesetでsource repo/path/refを固定したworkflowを必須化する`required_workflow`方式を挙げているが、同ADRは「現在のFree organizationはRequired Workflowを使えない」ことを明記している。本リポジトリがこの制約下にあるという前提を覆す情報はなく、(b)は現時点で技術的に選択できない。

## Decision

専用App・attestation・signer-workflow検証・Check finalizeという既存の信頼機構には一切変更を加えず、(a)のneutral/skip化を採用する。

具体的には、新設するrepository-level variable `ASC_GATE_APP_ENABLED`（secretではなく、単に「専用Appが本環境に用意されているか」を表す真偽フラグ。認証情報そのものは含まない）を、`record` jobのjob-level `if:`へ追加条件として組み込む。

```yaml
jobs:
  record:
    if: >-
      github.ref == 'refs/heads/main' && github.event.repository.default_branch == 'main' &&
      vars.ASC_GATE_APP_ENABLED == 'true'
```

このフラグをrepository-levelに置く（`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`のようにenvironment-scopeにしない）理由は、GitHub Actionsのjob-level `if:`評価がjobの`environment:`へのentry（環境保護ルール適用）より前に行われるため、environment-scopedな値をjob-level `if:`から確実に参照できる保証がないという既知の制約を回避するためである。`ASC_GATE_APP_ENABLED`が`'true'`でない場合、job全体（checkout以降の全step）は実行されず、job conclusionは`skipped`として確定する。フラグが`'true'`の場合は、既存のCheck作成・attestation構築・`gh attestation verify`・finalizeという経路をこれまでと完全に同一のまま通過する。

`ASC_GATE_APP_ENABLED`が`'true'`に設定されているにもかかわらず`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`が実際には未設定・不正な場合は、既存の`consumeTrustedGateSecrets`内の必須環境変数チェックがこれまで通りfailureとして検出する。フラグは「実行を試みてよいか」のみを表し、認証情報自体の正当性検証は既存の内部チェックにそのまま委ねる二重構造とする。

branch protection（ruleset）のrequired status checksは`agent-skill-chain/{spec,design,implementation,validation}-gate`（専用Appが作成する個別Check Run）と`verify`のみを含み、`record` job自体のActions-native checkはrequired contextに含まれない。フラグ未設定でjobがskippedになる場合、専用AppによるCheck Run自体が作成されないため、required contextは対象SHAについて一度もstatusを報告しない状態のままとなり、GitHubの標準的なrequired status checks挙動により「未実行（マージ不可）」として扱われる。したがって、job conclusionの変更がrequired statusのfalse pass（合格相当のすり抜け）を生むことはない。

## Consequences

- 専用App未設定環境では`record` jobがfailureではなくskippedとして終了し、「未設定のため実行できない既知の状態」と「実行して検出された失敗」がjob conclusion（skipped/failure/success）だけで、ログを開かずに判別できるようになる。
- 専用App・attestation・signer-workflow検証・Check finalizeのロジックには一切変更がないため、AGENTS.mdの不変条件I2が定める真正性保証の水準は変更前と同水準のまま維持される。
- 専用GitHub Appの実provisioning作業（本ADRの対象外。ISSUE-331のSPECでもスコープ外と明記）を行う際は、`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`に加えてrepository-level variable `ASC_GATE_APP_ENABLED=true`の設定が新たに必要になる。設定を失念した場合、Appが実際には使える状態でもjobはskippedのまま残るが、これはfailureに埋もれず明示的にskippedとして残り続けるため、failureのまま埋もれるより運用上発見しやすい。
- 本変更はjob-level `if:`への条件追加のみであり、Check作成・attestation構築/検証・finalizeという既存の記録処理ロジックには触れないため、問題発覚時はgit revertのみで変更前の挙動に完全に戻せる。状態を持つmigrationは発生しない。
- `.github/workflows/agent-skill-chain-trusted-gate.yml`と配布正本`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-trusted-gate.yml`の両方へ同一のguardを反映する必要があり、実装セグメントでは`test/unit/trusted-gate-workflow.test.ts`による同期・内容の機械検証を追加する。
- 将来、Free organizationの制約が解消されるかRequired Workflow相当の代替信頼機構が利用可能になった場合、専用GitHub App要件自体の撤廃を再検討する余地が残る。その場合は本ADRをsupersedeする新しいADRを作成する。

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
