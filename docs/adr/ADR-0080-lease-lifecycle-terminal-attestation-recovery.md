# ADR

```yaml
id: ADR-0080
status: proposed
title: writer lease回復を世代付きterminal attestationとBackend排他claimへ限定する
tags: [lease, recovery, lifecycle, concurrency, audit]
supersedes: [ADR-0024]
superseded-by: null
deprecated-reason: null
```

## Context

既存のcredential不要な`lease reclaim`は、期限切れ、明示confirm、lease refのCAS削除を安全条件とする。この方式は期限前のorphanを回復できず、反対に期限切れruntimeが実行中か、completed report後も生存しているかを立証しない。worker起動、report、renew/release、lease削除は単一の排他境界を共有せず、観測後に新runtimeや遅延reportが成立する余地もある。

PID不在、経過時間、heartbeatを組み合わせても、未起動と終了、PID再利用、launcher喪失、再起動を区別するpositive proofにはならない。安全な期限前回復には、runtimeを実際に起動・監視する主体が、lease世代と終了を同一recordへ耐久化する必要がある。またGitHubとlocalの正本を同期せず、削除前後の監査を選択Backend自身から読み戻す必要がある。

検討した代替は、TTL短縮、completed report単独、process探索、期限切れ経路とactive経路の併存である。TTL短縮は正常workerを阻害し、report/processはterminalを証明せず、弱い旧経路を残すと単一proof規則を迂回できるため採用しない。

## Decision

credential不要のwriter lease回復は、current lifecycle generationに属する完全なtrusted-launcher terminal attestationがある場合だけ許す。既存の期限だけによるreclaim契約を置換し、別の低強度fallbackを設けない。

新規leaseは非secretなlease instance digest、単調増加generation、runtime state、terminal attestationを持つpublic v2 recordとする。bearer credentialはGit管理外mode `0600`の既存credential storeに限定する。legacy leaseはcredential、holder、branch、worktreeを正に確認できる通常start/resumeだけがCAS移行でき、metadataを欠くleaseを回復可能と推測しない。

start/resumeはruntime実行前にgenerationをCASで増やし、旧terminal attestationを同じ更新で無効化する。trusted launcherはchildを開始barrier下で生成し、started recordの耐久化後だけ実行させ、直接`wait`した終了後にbranch、worktree、HEAD、remote、report setを束縛したterminal attestationをCAS保存する。新しいstartは必ず次generationへ進むため、旧attestationは再利用できない。

recovery、report publication、start/resume、renew、releaseはBackend正本上のoperation claimを共有する。GitHubは専用custom ref、localはIssue coordination directoryの排他claim fileを使う。recoveryはclaim後と削除直前に全入力を再観測し、terminal proof、runtime不在、clean/pushed、明示holder+digest、report set不変を満たす場合だけexpected lease revisionで削除する。

監査は削除前のreservationと削除後のfinal resultをappendし、同じBackendから完全payloadをread-backする。GitHub modeはGitHub Issue、local modeは`state.yaml`のBackend所有audit arrayだけを使い、同期しない。削除後のfinal auditまたはclaim release確認失敗は補償的にleaseを再作成せず、部分成功の理由付き非0とする。

recovery read model、digest、confirmation、claim、audit、attestation、reportはbearer credential値を型として受け取らず、private legacy payloadを読まない。

## Consequences

- 実行中・起動中・監視不能・legacyのleaseは、期限やreportにかかわらず回復されない。
- 正常に終了しlauncher attestationが残ったorphanだけは、TTLを待たず監査付きで回復できる。
- worker起動経路はprovider固有commandをtrusted runtime wrapperのchildとして実行する必要があり、監視できないhuman deferredはactive recovery対象外になる。
- report、renew/release、start、recoveryは同じclaim競合を扱うため、従来よりBackend mutation回数が増える。claim状態を判定できないときは可用性より安全を優先して停止する。
- crashで残ったclaimの自動時刻回収は行わない。positive proofを別途設計するまで人間判断とする。
- ADR-0024は本ADRがacceptedになった時点でsupersededとなる。それまでは既存実装の決定として有効であり、候補設計を使った自己承認には用いない。
