# ADR

```yaml
id: ADR-0013
status: proposed
title: 強制identityとworkflow attestationを満たすCheckだけをゲート正本にする
tags: [gate, github-app, attestation, provenance, bootstrap]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

ローカルCodex・Claude Code等へ委譲したレビューをGitHub required checkへ結線するには、PR Review証跡を
trusted codeが再検証してCheck Runへ写像する必要がある。しかしrequired status checkは同名workflow、
event、matrixを区別せず、通常のGitHub Actions App identityも全workflowで共有される。candidate workflowへ
`checks: write`を与えるだけでは自己承認を防げない。runner上のreportだけではADR finalizationやpush後の
reconcileをfresh checkoutから復元できず、古いsuccessへのfallbackも安全条件を破る。

## Decision

GitHubゲートは次のどちらかのenforcement backendが有効な場合だけ配備する。

- `dedicated_app`: Check専用GitHub App秘密鍵をdefault branch限定environmentへ置き、required contextの
  ruleset integration IDをそのAppへ固定する。Checks/Commit statuses書込みを最小権限とし、標準tokenでCheckを書かない。
- `required_workflow`: org/enterprise rulesetでsource repo/path/refを固定したworkflowを必須化し、
  source SHA・PR event・signer provenanceを検証する。不足証跡で失敗したexact PR runを証跡追加後に再実行する。

default branchのrecorderはv3最新attemptを共有aggregate policyで検証し、専用identityでin_progress Checkを
作る。Check ID、repo、PR、target SHA、gate、attempt、workflow run/attemptを含むcanonical reportをGitHub
artifact attestationへ束縛する。全postcondition成立後の最後のAPI操作だけがsuccessへ遷移する。

構造化reportは48 KiB以下をCheckへinline保存する。超過時は45,000 byte単位のPR comment chunksへ置き、
Checkには全chunk digestを持つmanifestを保存する。4 MiBを超えるreportは拒否する。どちらもattestする。
materializerとreconcilerはexact workflowの`run_number/run_attempt`最大tupleをstatusより先に選び、対応Checkの
schema、backend、attestation、chunk、evidence/artifact digestを再検証した場合だけcacheへ復元する。previous
report継承は期待path集合の完全一致と全digest一致を要求し、旧successへfallbackしない。

配布はversioned environment/secret/workflowとdisabled rulesetをprepareし、main smoke後に新rulesetを
旧activeへ加算する。実PR検証後だけ旧系をretireし、失敗時も保護無しの瞬間を作らない。初回#274は固定keyを
`prepared→completed`へ遷移し、同一keyのmerge再開だけ許可する。merge後は通常attestation以外を認めない。

## Consequences

- AI provider keyとself-hosted runnerなしで、ローカルAI判定をGitHub Actions上の強制可能なゲートへ結線できる。
- 現在のFree organizationはRequired Workflowを使えないため、専用GitHub Appの作成・installationが一度必要になる。
- App権限はChecks/Commit statuses書込みとMetadata読取りに限定し、candidate branchは秘密鍵へ到達できない。
- GitHub CLIのartifact attestation検証機能とGitHub-hosted runnerを実行要件とし、非対応consumerは無変更で停止する。
- reportはbounded chunk ledgerを使うため大規模変更でもrunner一時fileへ依存しない。
- API障害、最新workflow attempt非success、provenance不一致時は可用性よりfail-closedを優先する。
- #274はbootstrap producer、#277は一般aggregate正本、#283はprovenance・Check・復元の責務を持ち、循環を作らない。
