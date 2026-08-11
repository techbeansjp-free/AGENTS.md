# ADR

```yaml
id: ADR-0045
status: proposed
title: 読み取り専用のlease status確認はCoordination Backendの正本のみを参照し、Issueコメント・writer credentialを一切使わない
tags: [lease, coordination-backend, read-only, github]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

writer lease サブコマンドは `acquire`・`renew`・`release`・`resume`・`reclaim` の5つのみであり、いずれも呼び出しにより writer lease の状態そのものを変更する操作である。ADR-0002（`github-lease-git-ref-cas`、`status: accepted`）は GitHubモードの writer lease 正本を Issue コメントではなく git ref（`refs/agent-skill-chain/leases/<issue_number>-<segment>`、compare-and-set）と定義し、Issue コメントへの投稿は取得時のみ行う human 向け可視性目的の best-effort 処理であって、以後の renew のたびに更新される保証は無いと明記した。

2026-08-11、本リポジトリ自身の開発セッションで、進行役が ISSUE-588 の validation セグメントの lease 状態を確認する目的で GitHub Issue のコメント欄に残っていた最新投稿を読んだところ、そこに記載された `expires_at` は初回 acquire 時点の値のままであり、その後の renew によって git ref 側で更新済みだった実際の `expires_at`（Issue コメントの記載より大幅に新しい時刻）と一致していなかった。進行役はこの記載の乖離により「lease が実際には期限切れで renewal が機能していない」と誤って判断し、reclaim（回収）へ進もうとした。真の現在状態は `worker-launch.sh` 実行時に発生した「既存の writer lease と競合しています」というエラーメッセージから、副作用を伴う操作の結果としてのみ確認できた（ISSUE-602 由来）。

読み取り専用の状態確認コマンドを新設するにあたり、その実装がどの情報源を正本として扱うかは、ADR-0002が確立した「GitHubモードの正本はgit refのみ」という原則をこの新規コマンドにも一貫させるか、実装の簡便さを優先してIssueコメント（`gh issue view --json comments`、`report latest` 等の既存コマンドが使う経路）を情報源に含めてしまうかという分岐点であり、後者を選ぶと本Issueが解消しようとしている誤判断の誘発源をコマンド内部にそのまま持ち込むことになるため、明文化した決定として記録する。また、ADR-0024（`writer-lease-human-reclaim-without-credential`、`status: accepted`）はcredential照合を経由しない読み取り・回収系コマンドの前例であるが、read-onlyコマンド全般の情報源方針までは扱っていない。

## Decision

新設する `agent-skill-chain lease status` は、次を満たす設計に限定する。

1. GitHubモードでは、`refs/agent-skill-chain/leases/<issue_number>-<segment>` の内容を `git fetch`／`git show` のみで読み出す既存の読み取り専用関数（`allLeasesFor`・`activeLeasesFor`・`readLeaseFromRef`、`src/lib/github-lease.ts`）だけを情報源とする。`gh issue view --json comments` を含む、Issue コメント本文を読み出す経路は一切呼ばない。
2. ローカルモードでは、Issue 毎の `lease.yaml`（`src/lib/local-state.ts` の `leaseFilePath`、Git 管理下）を既存の読み取り専用ヘルパー（`tryReadYamlFile`、`src/lib/yaml-io.ts`）のみで読む。
3. いずれのモードでも、writer lease credential（`src/lib/lease-credential.ts` の `readLeaseCredential`・`resolveCredentialToken` 相当）を一切参照しない。credential の有無・一致性は `lease status` の実行可否に影響しない。
4. いずれのモードでも、`postLeaseComment`・`cleanupLeaseComment`・`markActiveWriterLeaseLabel`・`writeYamlFileAtomic`・`writeYamlFileExclusive` を含む、状態変更・可視化情報変更を伴う関数を一切呼ばない。

## Consequences

`lease status` の出力は常に、Issue コメントの投稿・更新頻度に左右されない、正本由来の値のみを返す。これにより、本ADRの Context に記載した実例（Issue コメントの記載が古いまま renew が反映されない状態）が `lease status` 自体には再現し得なくなる——Issue コメントを情報源に一切含めないため、乖離という概念そのものが `lease status` の出力に対して発生しない。

一方、`lease status` は Issue コメント側の情報（例: 過去の acquire 履歴の人間向け可視性ログ）を提供しない。これは意図した設計であり、Issue コメントの履歴的な閲覧が必要な場合は引き続き `gh issue view --comments` 等の既存手段を使う（本ADRのスコープ外）。

将来、GitHubモードのwriter lease正本自体（git ref namespace）を変更する場合は、ADR-0002を `superseded` にする新しいADRが必要になり、それに伴い本ADRが依拠する読み取り関数（`allLeasesFor` 等）の実装も追従が必要になる。本ADR自体は「情報源をどこに限定するか」という方針のみを扱うため、正本の保存形式変更それ自体は本ADRの改定を必須としない限り、参照先関数のシグネチャが変わらない範囲では影響を受けない。

## Alternatives considered

- Issue コメント欄の最新投稿を `lease status` の情報源に含める（速度・実装の単純さを優先）: 本ADRの Context に記載した実例そのものを `lease status` の内部に再導入することになり、本Issueが解消しようとしている誤判断の誘発源を除去できないため不採用。
- `lease status` を新設せず、既存の `lease acquire` を「状態確認用に実行して競合エラーメッセージを読む」運用を継続する: SPEC.md が記載する通り、意図せず新規acquireが成立し既存workerの作業を横取りするリスクを伴う副作用依存の回避策であり、読み取り専用コマンドとしての設計要求（AGENTS.md 前提、SPEC.md 要件）を満たさないため不採用。
