# ADR

```yaml
id: ADR-0009
status: proposed
title: コア独立レビューの要求をベンダー中立能力とadapter別検証へ分離する
tags: [review, model-selection, adapter, project-policy, safety]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

agent-skill-chain のコア規約・状態遷移・ゲート・Coordination Backend・配布ルールは、多数の consumer project の安全性を決める。strict review の人数・独立性だけでは、能力不足のモデルが承認する危険を防げない。

Codex はモデルと reasoning effort を明示する可搬な設定を持つため、`gpt-5.6-sol` と `xhigh` を直接検証できる。一方、Claude Code のモデル名と reasoning の設定表現は Codex と同一ではない。Codex 固有 slug や設定キーを Claude へ流用すると、存在しないモデルを捏造するか、指定が無視されたまま承認する危険がある。また、GitHub-hosted runner は利用者のローカルCLIログインを継承しない。CI内でAIを起動する設計は不要なprovider API credentialを要求し、既存のローカル実行系と責務が重複する。

検討した選択肢は、全 adapter に同一モデル文字列を強制する方式、説明文だけで運用する方式、global config の既定を一律変更する方式、project policy のベンダー中立能力を adapter が固有表現へ変換・検証する方式である。同一文字列方式は provider 非互換、説明文方式は機械強制不能、global 変更は通常作業と consumer project を不要に高コスト化するため採用しない。

## Decision

自己拡張 project policy に、コア独立レビューの必須能力を `frontier_coding` と `maximum_reasoning` として構造化する。コア対象は登録済み exact path / path prefix、または Coordination Backend に保存した `core_audit` marker で判定する。分類不能はコア対象の可能性が未解決として扱う。

各 adapter はベンダー中立能力を自分の実行系だけへ変換する。

- 進行役がローカルadapterへレビューを委譲する。Codex はadapterが構成する固定argvで `gpt-5.6-sol`、`xhigh`、read-only sandboxを厳密に指定する。core reviewでは完全command上書きと自己申告booleanを検証済みと見なさず無条件拒否する。Strict は独立2回のverdictを要求する。
- Claude Code は実行環境が宣言する実在モデルを公式の model 指定で使い、model tier attestation、maximum reasoning attestation、実行環境固有 reasoning probe の成功を要求する。tier宣言とprobe commandを管理する主体をprovider能力のtrust rootとし、モデル出力の自己申告は受理しない。汎用command上書きはcore reviewで拒否する。Codex 固有 slug・設定キーは使わない。
- adapter・非対話実行・capability probeが未実装のproviderは、実行可能と推測しない。
- GitHubモードのtrusted recorderはverdictと実行attestationを構造化PR reviewへ投稿する。このGitHub actorはAIレビュア本人ではなく、writer credentialから分離した専用Coordination Backend principalでなければならない。legacy GitHub Actionsはrepository default branchの保護base revisionにあるworkflow/verifier/policyだけを実行し、登録済みrecorder actorとPR/commit writer actorの非重複、Review API metadata、target SHA、prompt/artifact digest、latest attempt、reviewer run ID、Strict slot/件数を検証するが、Checks書込み権限を持たずcanonical Checkを発行しない。専用App recorderだけがcanonical gate reportとCheckを生成する。CIはproviderもPR headのコードも実行しない。
- GitHub Actions Appのslug一致だけではrequired statusを生成したworkflow/eventを識別できない。#274のCheck Runは固定SHAの一回限りbootstrapと耐久report整合性に限定し、通常運用のsource trustはIssue #283の専用GitHub App identityと発行権限で担保する。
- ローカルlauncherはprotected base SHAからephemeral cloneを作り、credential-bearing remoteを除去して、そのcloneでbuildしたadapter・prompt generator・recorderだけを起動する。AI subprocessへGitHub token・gh/git config・caller HOMEを渡さず、固定launcher構成のdigest、base SHA、one-time attempt token、credential-scrubbed read-only sandbox、`review-` namespaceの一意なrun ID/slotを証跡へattestし、Issue worktreeが変更した実行コードを同じPRの証跡生成へ使わない。
- core Codexは`CODEX_EXECUTABLE`・`CODEX_AUTH_PROBE_CMD`・完全command上書きを拒否する。protected launcherはcandidate影響前の管理PATHからCodexをabsolute realpath解決し、SHA-256と固定`codex login status`成功を確定して0600 one-time tokenへ束縛する。adapterは実行直前にdigestを再照合してexact pathだけを起動し、Review evidence/gate reportへdigestを保存する。管理PATHと解決binaryは管理主体のtrust rootであり、candidate、model出力、caller自己申告値はtrust rootではない。通常non-core overrideは後方互換として維持する。
- human adapter、利用不能、不一致、未証明、strict 未満、分類不能は `human_required` へ停止する。

非コア作業と model policy を持たない consumer project は、依頼者・実行環境の明示選択と既存 adapter 既定を維持する。環境変数は backend 正本の分類値と検証入力をプロセスへ渡すだけで、調整状態の正本にはしない。

provider API key、ローカル認証状態のCIへの移送、self-hosted runnerは採用しない。GitHub credentialはReview APIとCheck RunというCoordination Backend操作だけに使い、model provider認証へ流用しない。worker/reviewer roleにはReview API投稿能力を与えず、進行役の専用trusted recorder actorをmanifestへ登録する。writerとrecorderで同一GitHub credentialを使う案は、公開digestと自己生成tokenを直接投稿できlauncher起源を検証できないため採用しない。最初の導入PRはcandidate verifierで自己承認せず、protected baseの既存local gate記録経路の修復後に同経路で承認する。

## Consequences

利点は、コア作業だけを品質優先へ昇格でき、provider の異なる表現を混同せず、利用不能時に silent downgrade しないことである。利用者の既存ローカルログインを使い、CIは決定論的な検証に限定される。same-SHA retryはlatest attemptだけを採用し、旧証跡を削除せず監査履歴として残せる。manifest、classifier、launcher、adapter、evidence verifier、workflow の境界をテストできる。

欠点は、GitHub ActionsだけではAIレビューを開始できず、進行役がローカルadapterを起動できる環境と、writerから権限分離した専用recorder principalが必要なことである。actor分離だけでmodel出力自体を暗号学的に証明するわけではないため、protected-base launcher、実行attestation、role capabilityも維持する。Claude Codeで最大reasoningを検証できない環境は人間判断へ止まる。またコアpathの安全側リストにより、境界付近の変更が通常より高コストになる場合がある。

将来 provider が検証可能な reasoning 設定を追加した場合は、能力契約を変えず adapter mapping だけを新しい ADR で更新できる。コア資産の責務境界が変わった場合は project policy の trigger と分類テストを同じ変更で更新する。配布先でagent-skill-chain CLIをconsumer固有buildへ依存せず解決する可搬性は別判断であり、Issue #285のfixtureと設計が完了するまで任意consumer対応を主張しない。
