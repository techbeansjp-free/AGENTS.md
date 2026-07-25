# ADR

```yaml
id: ADR-0011
status: proposed
title: human gateの復帰をdefault branch上のtrusted dispatchへ限定する
tags: [github-actions, gate, human-review]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

human reviewerはCI job内で同期的に待機できないため、最初の判定を`human_required`として
`action_required` Checkへ発行する。従来の通知はworkflow再実行を案内したが、実在する手動入口、
対象PR head SHA、required Check、書込み主体の契約が無かった。単なるjob rerunではrunner内の
一時gate-reportを復元できず、PR branchのscriptをtoken付きで実行するとreviewerのread-only境界を
越える。

## Decision

GitHubモードのhuman gate復帰は、default branchに存在する専用`workflow_dispatch`だけを正式入口と
する。入力PRがopen・same-repositoryで、入力SHAが現在のheadと完全一致することをtrusted CLIが
検証する。workflowはdefault branchのCLIだけを実行し、PR commitはartifact digest用のread-only
Git objectとして扱う。

人間はverdictだけを提出し、trusted CLIがschema検証、final導出、設定由来required Check名への発行を
行う。workflow tokenはcontents/pull request readとchecks writeに限定し、actorを証跡へ残す。
不一致・不正・不足・API失敗はCheck successを発行しない。

## Consequences

- 通知された操作と実在入口が一致し、stale SHAの承認を防げる。
- PR codeへChecks書込みtokenを渡さず、human reviewerのread-only責務を維持できる。
- 初回利用前にworkflowをdefault branchへ配備する必要がある。
- verdict JSON入力は人間に構造化判定を要求するが、対象・根拠・再実行を監査できる。
- Strict件数は一般trusted aggregationへ委譲し、不足時は復帰せず安全側停止する。
- workflow/CLI/通知は一つの契約なので、将来変更時も同期テストを必要とする。
