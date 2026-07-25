# ADR

```yaml
id: ADR-0013
status: proposed
title: default-branch recorderがCheck正本を発行し検証済みreportを再materializeする
tags: [gate, github-actions, check-run, provenance, bootstrap]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

GitHubモードのゲート正本はCheck Runである。AIレビューをGitHub Actions内で実行せず、進行役がローカルの
Codex・Claude Code等へ委譲する場合、PR Review APIの証跡をCheckへ安全に写像するtrusted codeが必要になる。
候補branchのworkflowを実行すると、変更者が`checks: write`を使って自己承認できる。一方、Checkだけに最終判定を
保存してrunner上のgate-reportを破棄すると、ADR finalizationが承認artifact digestを読めず循環停止する。

## Decision

外部からの記録要求は`repository_dispatch`で受け、default branchの固定SHAにあるworkflowとCLIだけを実行する。
入力はPR番号・gate・target SHAに限定し、actor権限、PR状態、review evidence、成果物、ruleset integrationを
GitHub APIとtarget Git objectから再取得する。candidate codeは実行しない。

Check Runはcanonical名で`in_progress`作成後、作成応答のApp identityをrulesetと照合する。検証済み最終reportと
canonical evidence digestをoutputへ保存してcompletedへ更新し、same-App最新runを再読取して一致を確認する。
approvedだけをsuccess、rejectedをfailure、判定不能をaction_requiredへ写像する。

ADR finalization等が構造化reportを必要とするときは、current SHA・canonical名・same-Appの全conclusion中の
最新Checkを読み、そのrunがsuccessの場合だけoutputのreportを非正本cacheへmaterializeする。より新しい
failure/action_requiredがあれば過去successへfallbackしない。report schema・evidence digest・artifact digestは
復元時にも再検証する。正本はCheckのままでありcache間の同期状態を新たな正本にしない。

初回のtrust root導入は#274の最終固定SHAだけを対象とする。repository ownerの明示承認、既存rulesetのadmin
bypass許可、独立Sol/xhigh最終PASS、全非gate CI PASS、v3 evidence・durable Check output・protected-base
materialize経路の存在を確認し、PR/SHA/許可者/verdict/CI/実行者/時刻を記録した一回限りのadmin mergeとする。

## Consequences

- API keyやself-hosted runnerなしでローカルAIレビューとGitHub required checkを結線できる。
- PR authorとrecorder actorが同じでも、reviewer runの独立性はv3 attempt attestationで検証できる。
- runner一時fileが消えてもCheck outputからADR承認digestを復元でき、#270の耐久性欠陥を解消する。
- dispatch actorにはwrite以上、workflow tokenにはchecks writeが必要だが、candidate codeへ権限を渡さない。
- GitHub API障害やApp/ruleset不一致ではmergeが停止する。可用性よりI8のfail-closedを優先する。
- #274の一回限りmigrationは恒久例外ではなく、別PR/SHAへ再利用できない。
