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
  ruleset integration IDをそのAppへ固定する。標準`GITHUB_TOKEN`にCheck書込み権限を与えない。
- `required_workflow`: org/enterprise rulesetでsource repo/path/refを固定したworkflowを必須化し、
  source SHA・PR event・signer provenanceを実行時にも検証する。

default branchのrecorderはv3最新attemptを共有aggregate policyで検証し、専用identityでin_progress Checkを
作る。Check ID、repo、PR、target SHA、gate、attempt、workflow run/attemptを含むcanonical reportをGitHub
artifact attestationへ束縛する。全postcondition成立後の最後のAPI操作だけがsuccessへ遷移する。

構造化reportはCheck `output.text`へ保存する。materializerとreconcilerはenforcement source・name・SHA一致の
全conclusion中最大IDを先に選び、success、schema、App/ruleset、artifact attestation、evidence/artifact digestを
再検証した場合だけ非正本cacheへ復元する。previous report継承は期待path集合の完全一致と全digest一致を要求し、
不一致時は当該gateと下流を無効化する。旧successへfallbackしない。

初回だけ#274の固定PR/SHA/digest、owner承認、Sol/xhigh PASS、非gate CIをPR Reviewへ記録してadmin mergeする。
used-keyを一意にし、merge後は専用backendと通常attestation以外のbypassを認めない。

## Consequences

- AI provider keyとself-hosted runnerなしで、ローカルAI判定をGitHub Actions上の強制可能なゲートへ結線できる。
- 現在のFree organizationはRequired Workflowを使えないため、専用GitHub Appの作成・installationが一度必要になる。
- App権限はChecks書込みとMetadata読取りに限定し、candidate branchは秘密鍵へ到達できない。
- GitHub CLIのartifact attestation検証機能とGitHub-hosted runnerを実行要件とし、非対応consumerは無変更で停止する。
- API障害、最新非success、provenance不一致時は可用性よりfail-closedを優先する。
- #274はbootstrap producer、#277は一般aggregate正本、#283はprovenance・Check・復元の責務を持ち、循環を作らない。
