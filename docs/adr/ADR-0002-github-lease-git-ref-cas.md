# ADR

```yaml
id: ADR-0002
status: proposed
title: GitHubモードのwriter leaseをgit ref-based compare-and-setへ置換する
tags: [lease, coordination-backend, github]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`src/lib/github-lease.ts`のGitHubモードwriter lease取得は、Issueコメントへlease YAMLを投稿し「投稿前に既存アクティブleaseの有無を確認し、投稿後に競合有無を再確認する」楽観的排他制御で近似してきた。gh CLI・GitHub Issue コメントAPIには比較更新（compare-and-set）相当のAPIが無いため、2プロセスがほぼ同時にactiveLeaseFor確認をパスしてから投稿した場合、投稿タイムスタンプの分解能・API応答順序に依存するTOCTOUウィンドウが理論上残っていた（コード内コメントでも「真の原子性は保証しない」と明記されていた）。

SPEC.md（ISSUE-176）が実施した技術検証により、gitのref更新（`git push origin <sha>:<ref>`）はサーバ側（receive-pack）でref現在値を再検証するため、既存ref・存在しないrefいずれに対しても真にatomicなcompare-and-set保証を持つことを実測確認した。GitHub.com自身も`refs/heads/`・`refs/tags/`以外の任意のカスタムref namespaceへのpushをネイティブgitプロトコル経由でサポートする。

この決定は、AGENTS.md「Coordination Backend」表がGitHubモードの調整状態の正本として列挙する「Issue・PR・branch・Check Run」に加え、writer lease専用の新しいgit ref namespace（`refs/agent-skill-chain/leases/*`）をこのIssueに紐づく調整状態の正本として追加することを意味する。これは既存の「Issueコメント」という表現形式の内部実装変更ではなく、I2（セグメントゲート）・I5（進行役の純粋性の前提となるwriter lease排他）を支える中核メカニズム自体の置換であり、かつ新しい権限要件（fine-grained PAT／GitHub App installation permissionの`contents`権限がこのカスタムref namespaceへのpushを許可する必要がある）を운用者に課すため、ADRとして決定を記録する。

## Decision

GitHubモードのwriter lease取得・更新・解放を、issue番号+segmentごとの専用git ref（`refs/agent-skill-chain/leases/<issue_number>-<segment>`）へのgit push/deleteによるcompare-and-setで実装する。

- **acquire**: `git commit-tree <empty-tree-sha> -m "<lease YAML>"`でlease内容を埋め込んだparentless commitをローカルに作成し、`git push origin <sha>:<ref>`（force無し）を実行する。ref不在なら新規作成として成功する。既存refがある場合はサーバ側が非fast-forwardとして拒否する（`[rejected]`）。
- **renew**: 現在のref先頭commitを親とする新しいcommit（更新後のexpires_atを埋め込む）を作成し、同じrefへforce無しでpushする。fast-forward条件（現在のref値が新commitの祖先であること）が自動的にcompare-and-setの条件（「自分が最後に読んだ値のままである」）として機能する。
- **release**: `git push origin --delete <ref>`。
- 上記いずれも、pushが`[rejected]`（既存参照との非fast-forward）で失敗した場合のみ「既存leaseとの競合」として扱う。それ以外の失敗（認証・権限・接続エラー）は既存の楽観的排他制御へフォールバックせず、明確な別種のエラーとして即座に失敗させる（安全側ラチェット。権限不足を無自覚にTOCTOU再導入で覆い隠さないため）。
- Issueコメントへの投稿（`postLeaseComment`）はhuman向け可視性のためのbest-effort処理として残すが、以後は競合判定・token検証等いかなるロジックにも使用しない（正本はgit refのみ）。

## Consequences

- `contents: write`権限がこのカスタムref namespace（`refs/agent-skill-chain/*`）への実pushを許可するかは、実リポジトリでの実機検証がまだ完了していない（SPEC.mdのスコープ外事項）。実装Issueで検証し、権限不足が判明した場合は本ADRを別ADRでsupersedeし対応方針（PAT scope拡張の運用手順文書化、または別方式への転換）を決定する。
- `.agent-skill-chain/schemas/lease.schema.yaml`自体（フィールド構成）は変更しない。変更されるのはGitHubモードでの保存先プリミティブのみである。
- `src/lib/github-lease.ts`のCLI呼び出し元（`src/commands/lease.ts`の`acquire`/`release`/`renew`）の引数・標準出力形式は変更しない。`launch_worker`（`.agent-skill-chain/adapters/{claude,human,codex}.sh`）はCLIの引数・標準出力契約のみに依存しているため無変更。`launch_gate_reviewer`はread-onlyでありwriter leaseを取得しないため無関係。
- 既存の`test/unit/github-lease.test.ts`（gh-stub前提）は、コメントベースの`postLeaseComment`/`listLeaseComments`/`activeLeaseFor`（旧実装）のテストからgit ref前提のテストへ実装Issueで書き換える。
