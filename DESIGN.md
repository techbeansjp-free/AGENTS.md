<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: trusted gate recorderを専用GitHub App登録なしでもfailureにしない

- Issue: `ISSUE-331`
- 対応する SPEC: `SPEC.md`

## 目的・前提（SPEC要約）

`.github/workflows/agent-skill-chain-trusted-gate.yml`の`record` jobは、`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`（専用GitHub Appの認証情報。`environment: agent-skill-chain-gate-bootstrap-v1`にスコープされ、defaultブランチ限定でのみ参照可能）が未設定の環境では、`bin/agents-md.js gate record-trusted-check prepare`内部の必須環境変数チェックがエラーを投げ、job全体がfailure（赤）として終了する。この「未設定のため実行できない」failureと、「実行した結果として検出された真正性検証の失敗等」のfailureとがCI結果上区別できない。本設計は、両者をGitHub Actionsのjob conclusion（skipped/failure/success）だけで、ログを開かずに区別できるようにする。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（未設定環境でfailureにしない） | `record job entry guard`（新設リポジトリ変数`ASC_GATE_APP_ENABLED`によるjob-level `if:`ガード） | 未設定時はjob全体を実行前にskip状態で終了させ、内部のfailure分岐へ到達させない |
| `AC-2`（source trust保証水準を後退させない） | 既存dedicated App記録処理（Check作成・attestation構築/検証・finalize）を無変更のまま維持 | 「前提条件の確認」節で保証水準が維持されることを明示する |
| `AC-3`（設定済み環境で既存動作を後退させない） | 同じ`record job entry guard` | フラグ有効時は既存step列（checkout〜finalize）を一切変更せず素通りする |
| `AC-4`（終了状態変更がbranch protectionをすり抜けない） | 「前提条件の確認」節でのrequired status checks構造分析 | recordジョブ自体はrequired contextではないため、ruleset側の変更は不要であることを確認・明記する |
| `AC-5`（「実行して失敗」と「未実行」の機械判別） | `record job entry guard`が生む3値の終了状態（skipped/failure/success）＋既存の`test/unit/trusted-gate-workflow.test.ts`パターンによる自動検証 | GitHub Actionsのjob conclusionの色分けだけで判別できる |

## 責務・境界

### 検討した代替案と選定理由

SPECは「App未設定時のneutral/skip化」と「専用App要件自体の撤廃」の両案を比較検討することを要求している。

- **専用App要件の撤廃案**: 既存の`docs/adr/ADR-0013-trusted-gate-check-materialization.md`（status: proposed、本設計時点では未acceptedのため`related_adrs:`には計上しないが、背景として参照する）は、GitHub App方式の代替として`required_workflow`（org/enterprise rulesetでsource repo/path/refを固定したworkflowを必須化する方式）を挙げているが、同ADRは「現在のFree organizationはRequired Workflowを使えない」と明記している。本リポジトリの実行環境がFree organizationである前提を覆す情報はなく、この代替は現時点で技術的に選択できない。他に「同水準の保証を満たす代替信頼機構」を新設する案も検討したが、それ自体が新たな検証対象を持つ大きな設計変更になり、SPECのAC-2が要求する「後退させない」を満たすことの証明コストが高い。
- **neutral/skip化案（採用）**: 専用Appという既存の信頼機構自体には一切手を入れず、「Appの認証情報が用意されていないので実行を試みない」という既知の状態をGitHub Actionsのjob conclusionとして`skipped`にマッピングする。既存のCheck作成・attestation構築/検証・finalizeロジックは無変更のまま温存されるため、AC-2の保証水準は自明に維持される。

以上より、neutral/skip化案を採用する。

### コンポーネント構成

- **`record job entry guard`**: `record` jobのjob-level `if:`に、新設するリポジトリ変数`ASC_GATE_APP_ENABLED`が`'true'`であることを追加条件として組み込む。

  ```yaml
  jobs:
    record:
      if: >-
        github.ref == 'refs/heads/main' && github.event.repository.default_branch == 'main' &&
        vars.ASC_GATE_APP_ENABLED == 'true'
  ```

  条件がfalseの場合、GitHub Actionsはjob全体を実行せず、job conclusionを`skipped`として確定する。checkout以降の既存step（`Validate dispatch payload allowlist`・`Fetch target as a read-only Git object`・`Prepare dedicated-App in-progress Check and envelope`・`Attest exact gate envelope`・`Verify signer workflow, ref, digest, and certificate`・`Finalize dedicated-App Check as the last operation`）には一切変更を加えない。

- **`ASC_GATE_APP_ENABLED`（新設・repository-level variable）**: 専用Appの認証情報そのものではなく、「専用Appが本環境に用意されているか」という真偽のみを表すフラグである。既存の`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`は`environment: agent-skill-chain-gate-bootstrap-v1`にスコープされたsecret/variableのままとし、スコープ・置き場所を変更しない。`ASC_GATE_APP_ENABLED`だけをrepository-levelに新設するのは、job-level `if:`の評価がjobの`environment:`へのentry（環境保護ルールの適用）より前に行われるため、environment-scopedな値をjob-level `if:`から参照できる保証がない（GitHub Actionsの既知の制約）ためである。repository-levelのvariableはenvironment entryに依存せず常に参照できるため、この制約を回避できる。
- **既存dedicated App記録処理**（`bin/agents-md.js gate record-trusted-check {validate,prepare,finalize}`、Check作成、`actions/attest`によるattestation構築、`gh attestation verify`、finalize）: 無変更。フラグが有効な場合のみ、従来通りこの経路へ到達する。
- **workflow file pair**（`.github/workflows/agent-skill-chain-trusted-gate.yml`と、配布正本である`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-trusted-gate.yml`）: 両ファイルへ同一内容のguardを反映し、`.agent-skill-chain/scripts/verify-template-sync.sh`が要求する同期を維持する。

### 依存関係

```text
GitHub Actions repository_dispatch (agent-skill-chain-gate-record)
  → record job entry guard (vars.ASC_GATE_APP_ENABLED)
      -- false --> job conclusion = skipped（既存step群には到達しない）
      -- true  --> 既存step群 (checkout → setup-node → npm ci/build →
                    validate → fetch → prepare → attest → verify → finalize)
                    → GitHub REST API（専用App credentials経由のCheck作成・finalize）
```

循環依存はない。`record job entry guard`は既存dedicated App記録処理の入口にのみ作用し、既存処理の内部には依存しない。

### 前提条件の確認（AC-2・AC-4関連）

- **AC-2（保証水準の維持）**: 本設計は専用App・attestation・signer-workflow検証・Check finalizeのロジックに一切変更を加えない。AGENTS.mdの不変条件I2が定める「Check Runの成功状態を専用App/Workflowに限定する」「同一GitHub Actions Appであることだけをsource trustの証明にしてはならない」という水準は、フラグ有効時の経路がこれまでと完全に同一であるため、変更前と同水準のまま維持される。
- **AC-4（branch protectionをすり抜けない）**: `.agent-skill-chain/templates/github/provisioning/rulesets/main.json`が定義するrequired status checksは`agent-skill-chain/{spec,design,implementation,validation}-gate`（専用Appが作成する個別Check Run）と`verify`のみであり、`record` job自体のActions-native check（例えば`agent-skill-chain / trusted gate recorder / record`）はrequired contextに含まれていない。`ASC_GATE_APP_ENABLED`が未設定でjobがskippedになる場合、専用AppによるCheck Run自体が作成されないため、required contextは対象SHAについて一度もstatusを報告しない状態のままとなる。GitHubのrequired status checksは、対象contextが一度もstatusを報告していない場合「未実行（pending、マージ不可）」として扱う（既に確立されたbranch protectionの標準挙動であり、report済みのfailureをpassへ読み替える仕組みは存在しない）。したがって、record jobがskippedになってもrequired contextがfalse pass（合格相当）として扱われることはなく、記録されるべきCheck Runが記録されないままゲートが先へ進む事態は生じない。この構造はfailureのままだった変更前から変わっていない（変更前後で同一の安全性を持つ）。

## 関連ADR

```yaml
related_adrs: []
```

acceptedのADRの中に本設計と直接関連するものは無い。`docs/adr/ADR-0013-trusted-gate-check-materialization.md`は関連する背景情報（専用GitHub App方式とRequired Workflow方式の比較、Free organizationの制約）を持つが、本設計時点でstatusが`proposed`であり`related_adrs:`の対象外のため、上記「検討した代替案と選定理由」節で自然文により言及するにとどめる。本Issueで新設する`docs/adr/ADR-0016-trusted-gate-recorder-neutral-on-missing-app-credentials.md`はこの設計を確定させるADRであり、`related_adrs:`には計上しない（同一設計セグメントの主成果物であるため）。

## 障害・ロールバック考慮

### 想定される失敗モード

- guard条件式の実装ミス（例: `==`と`!=`の取り違え、`vars.ASC_GATE_APP_ENABLED`のtypo）により、App設定済み環境でjobが常にskipされてしまい、AC-3が退行する（記録処理が一切行われなくなるにもかかわらず、CI上はskippedとしか見えず気づきにくい）。実装セグメントでは`test/unit/trusted-gate-workflow.test.ts`へ新条件の正規表現アサーションを追加し、この誤りを機械的に検出可能にする。
- `ASC_GATE_APP_ENABLED`だけが誤って`'true'`に設定され、`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`が実際には用意されていない場合。この場合guardを通過してjobは実行されるが、既存の`consumeTrustedGateSecrets`内の必須環境変数チェックが従来通りfailureとして検出するため、静かに壊れることはない。`ASC_GATE_APP_ENABLED`は「実行を試みてよいか」だけを表し、認証情報自体の正当性検証は既存の内部チェックにそのまま委ねる、という二重構造になっている。
- 将来、専用Appの実provisioning作業（本Issueの対象外、`SPEC.md`のスコープ外にも明記済み）を行う際に、`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`だけを設定して`ASC_GATE_APP_ENABLED`の設定を失念すると、Appが実際には使える状態でもjobはskippedのまま残る。これは機構の不具合ではなく運用手順の周知不足によるものであり、job結果が明示的にskippedとして残り続けるため、failureに埋もれて見逃されるより発見しやすい。

### ロールバック手順

本変更はjob-level `if:`への条件追加のみであり、Check作成・attestation構築/検証・finalizeという既存の記録処理ロジックには一切触れない。問題が発覚した場合は、追加した`if:`条件（および`ASC_GATE_APP_ENABLED`参照）をgit revertで除去するだけで、変更前の挙動（App未設定時はfailureとして終了する）に完全に戻せる。状態を持つmigrationは発生しない。

### 影響を受ける既存機能

`agent-skill-chain / trusted gate recorder` workflowの`record` job以外への影響はない。`.github/workflows/agent-skill-chain-gate.yml`の`verify-and-publish` job、branch protection（ruleset）のrequired status checks、`.agent-skill-chain/scripts/gate-reconcile.sh`は、いずれも`record` job自身の結論値を参照していない（`gate-reconcile.sh`はCheck Run digestの照合のみを行い、workflow run conclusionを読まない）ため、無変更・無影響である。
