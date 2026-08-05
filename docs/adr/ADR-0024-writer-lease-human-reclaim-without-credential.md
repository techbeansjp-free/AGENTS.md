# ADR

```yaml
id: ADR-0024
status: accepted
title: 期限切れwriter leaseの人間向けCLI回収はcredential不要・期限検査+明示confirm+監査コメントで安全側を担保する
tags: [lease, reclaim, security, human-recovery]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

ADR-0002（accepted）は GitHub writer lease の正本を、force無しpushによるgit ref操作（compare-and-set相当）と定義した。同一Issueに同時1つのwriter leaseのみを許可する制約（AGENTS.md §役割・権限・writer lease）のもと、`lease acquire` は既存refがある限り（期限切れでも）非fast-forwardとして拒否し、`lease resume` は同一holder credentialと同一worktreeのdirty検査が一致した場合だけref更新できる設計（ADR-0014、proposed）である。`lease release` もwriter credentialのtoken一致（または明示token入力）を要求する。

いずれの既存コマンドも「対象leaseのwriter credentialを保有・提示できること」を前提にしている。しかし、workerプロセスの異常終了・再起動やcredentialファイル（`.git/agent-skill-chain/lease-credentials/<issue>.yaml`、Git管理対象外）の消失が起きると、期限切れleaseに対して `resume` も `release` も実行不能になる。2026-08-04、本リポジトリ自身でIssue #437のimplementationセグメントworkerを再起動しようとした際にこの状況へ実際に遭遇し、進行役は `git push origin --delete refs/agent-skill-chain/leases/<issue>-<segment>` という低レベルなgit操作を手動で行うしかなかった。この操作はCoordination Backendの抽象化を経由せず、証跡も残らない。

## Decision

新設する `lease reclaim` コマンドは、対象leaseのwriter credential（token）の一致検査を一切行わない。安全性は、credential照合の代わりに次の3つの独立した検査で担保する。

1. 対象leaseの `expires_at` が現在時刻より過去であることの検査（期限内leaseは拒否する）。
2. 呼び出し時の明示的な `--confirm` フラグ（無指定では実行しない、誤操作防止）。
3. 検査時点のref SHAを条件とするforce-with-lease削除（既存 `releaseLeaseRef` をそのまま再利用し、ADR-0002のCAS保証を継承する）——検査後に対象leaseが更新された場合（対象workerが `resume`／`renew` に成功した場合等）は削除を拒否し、安全側で停止する。

回収成功後は、回収主体・回収日時・対象Issue/segment・回収前holderを含む監査コメントをGitHub Issueへ投稿する。回収主体の識別は、暗号学的な権限分離の仕組み（role capability・credential分離、AGENTS.md I5関連の将来課題）を新設せず、コマンドの用途上の区別（`release`ではなく別名の `reclaim` コマンドであること、writer credential検査を経由しないこと自体が「進行役の操作」であることの識別材料になること）に留める。

## Consequences

credential紛失時でも、進行役はCLI経由で安全に（期限切れ検査・明示confirm・CAS条件付き削除・監査コメントを伴って）回収できるようになり、低レベルなgit ref直接操作への依存が無くなる。

一方、`lease reclaim` コマンド自体の実行権限（誰がこのコマンドを実行できるか）は、対象リポジトリへのpush権限を持つ者であれば誰でも行使できてしまう——writer credentialの提示を前提とする既存の `release`／`resume`／`renew` と異なり、本コマンドは「進行役が実行する」という運用上の前提にのみ依拠する。これはIssue #441のスコープ外として明示的に許容する。将来、role capability・credential分離の仕組みでこの操作主体を機械的に強制する場合は、本ADRを `superseded` にして新しいADRを作成する。

## Alternatives considered

- `lease resume` の検査を緩和し、credential不一致でも同一worktree・dirty検査だけで再開可能にする: ADR-0014が意図的に定めた「他holderへの自動移譲をしない」という安全側の挙動を変更してしまうため不採用（Issue #441 SPEC.mdの「スコープ外」節にも明記）。
- reconcileワークフローの自動照合ロジックに回収機能を追加する: Issue #441のSPEC.mdは人間（進行役）の明示操作をスコープとしており、自動化は意図的にスコープ外とした。
- GitHub Actor（`gh api user`）を暗号学的に検証してからのみ回収を許可する: 現状のrole capability・credential分離の仕組み（AGENTS.md I5）に回収コマンド固有の認可層を新設する必要があり、Issue #441が是正対象とする「人間向け回収経路そのものの欠如」を超えるスコープ拡大になるため見送り、将来Issueへ委ねる。
