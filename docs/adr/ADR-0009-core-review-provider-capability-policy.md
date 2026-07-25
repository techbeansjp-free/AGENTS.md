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

- 進行役がローカルadapterへレビューを委譲する。Codex は `gpt-5.6-sol`、`xhigh`、read-only sandboxを厳密に検証する。Strict は独立2回のverdictを要求する。
- Claude Code は実行環境が宣言する実在モデルを公式の model 指定で使い、model tier attestation、maximum reasoning attestation、実行環境固有 reasoning probe の成功を要求する。Codex 固有 slug・設定キーは使わない。
- adapter・非対話実行・capability probeが未実装のproviderは、実行可能と推測しない。
- GitHubモードのtrusted recorderはverdictと実行attestationを構造化PR reviewへ投稿する。GitHub Actionsは保護されたbase revisionのworkflow/verifier/policyだけを実行し、登録済みactor、PR/commit writer actor、Review API metadata、target SHA、prompt/artifact digest、reviewer run ID、Strict slot/件数を検証してgate reportとCheck Runだけを生成する。CIはproviderもPR headのコードも実行しない。
- ローカルのadapter・prompt generator・recorderもcleanなprotected base worktreeまたはversion固定したinstalled packageから起動し、Issue worktreeが変更した実行コードを同じPRの証跡生成へ使わない。
- human adapter、利用不能、不一致、未証明、strict 未満、分類不能は `human_required` へ停止する。

非コア作業と model policy を持たない consumer project は、依頼者・実行環境の明示選択と既存 adapter 既定を維持する。環境変数は backend 正本の分類値と検証入力をプロセスへ渡すだけで、調整状態の正本にはしない。

provider API key、ローカル認証状態のCIへの移送、self-hosted runnerは採用しない。GitHub credentialはReview APIとCheck RunというCoordination Backend操作だけに使い、model provider認証へ流用しない。worker credentialにはReview API投稿能力を与えず、trusted reviewer actorをmanifestへ登録する。最初の導入PRはcandidate verifierで自己承認せず、protected baseの既存local gate記録経路の修復後に同経路で承認する。

## Consequences

利点は、コア作業だけを品質優先へ昇格でき、provider の異なる表現を混同せず、利用不能時に silent downgrade しないことである。利用者の既存ローカルログインを使い、CIは決定論的な検証に限定される。manifest、classifier、launcher、adapter、evidence verifier、workflow の境界をテストできる。

欠点は、GitHub ActionsだけではAIレビューを開始できず、進行役がローカルadapterを起動できる環境が必要なことである。trusted recorder credentialとworker credentialの分離も必要になる。Claude Codeで最大reasoningを検証できない環境は人間判断へ止まる。またコアpathの安全側リストにより、境界付近の変更が通常より高コストになる場合がある。

将来 provider が検証可能な reasoning 設定を追加した場合は、能力契約を変えず adapter mapping だけを新しい ADR で更新できる。コア資産の責務境界が変わった場合は project policy の trigger と分類テストを同じ変更で更新する。
