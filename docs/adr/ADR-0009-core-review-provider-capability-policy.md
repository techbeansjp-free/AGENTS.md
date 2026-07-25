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

Codex はモデルと reasoning effort を明示する可搬な設定を持つため、`gpt-5.6-sol` と `xhigh` を直接検証できる。一方、Claude Code のモデル名と reasoning の設定表現は Codex と同一ではない。Codex 固有 slug や設定キーを Claude へ流用すると、存在しないモデルを捏造するか、指定が無視されたまま承認する危険がある。

検討した選択肢は、全 adapter に同一モデル文字列を強制する方式、説明文だけで運用する方式、global config の既定を一律変更する方式、project policy のベンダー中立能力を adapter が固有表現へ変換・検証する方式である。同一文字列方式は provider 非互換、説明文方式は機械強制不能、global 変更は通常作業と consumer project を不要に高コスト化するため採用しない。

## Decision

自己拡張 project policy に、コア独立レビューの必須能力を `frontier_coding` と `maximum_reasoning` として構造化する。コア対象は登録済み exact path / path prefix、または Coordination Backend に保存した `core_audit` marker で判定する。分類不能はコア対象の可能性が未解決として扱う。

各 adapter はベンダー中立能力を自分の実行系だけへ変換する。

- GitHub の自己拡張コアレビューは Codex を選択し、公式 `openai/codex-action@v1` が CLI と API proxy を準備する。利用者入力は一度登録する repository secret `OPENAI_API_KEY` だけとする。
- Codex は `gpt-5.6-sol`、`xhigh`、read-only sandbox を厳密に検証する。Strict は独立2回の verdict を trusted CLI が集約し、全件 pass/pass の場合だけ承認する。
- Claude Code は実行環境が宣言する実在モデルを公式の model 指定で使い、model tier attestation、maximum reasoning attestation、実行環境固有 reasoning probe の成功を要求する。Codex 固有 slug・設定キーは使わない。
- human adapter、利用不能、不一致、未証明、strict 未満、分類不能は `human_required` へ停止する。

非コア作業と model policy を持たない consumer project は、依頼者・実行環境の明示選択と既存 adapter 既定を維持する。環境変数は backend 正本の分類値と検証入力をプロセスへ渡すだけで、調整状態の正本にはしない。

## Consequences

利点は、コア作業だけを品質優先へ昇格でき、provider の異なる表現を混同せず、利用不能時に silent downgrade しないことである。manifest、classifier、launcher、adapter、workflow の境界をテストでき、旧メモだけに判断が残らない。

欠点は、GitHub 自動レビューの初回に `OPENAI_API_KEY` secret の人間による登録が必要で、Strict は API 呼出しを2回消費することである。Claude Code で最大 reasoning を可搬な単一 flag として検証できない環境では、attestation と probe の準備も必要になる。準備できない環境は自動承認を得られず、人間判断へ止まる。またコア path の安全側リストにより、境界付近の変更が通常より高コストな review になる場合がある。

将来 provider が検証可能な reasoning 設定を追加した場合は、能力契約を変えず adapter mapping だけを新しい ADR で更新できる。コア資産の責務境界が変わった場合は project policy の trigger と分類テストを同じ変更で更新する。
