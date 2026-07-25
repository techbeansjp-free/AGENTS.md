# ADR

```yaml
id: ADR-0010
status: proposed
title: Strictレビューを固定slotのtrusted provenance集約で判定する
tags: [gate, review, security, multi-provider]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

Strictゲートは独立したread-onlyレビュア2体を要求するが、一般adapter経路は1回しか起動せず、設定の`reviewer_count: 2`を判定へ反映しない。JSON verdictを2件並べて件数だけを検査しても、同じ結果の複製、自己申告IDの付替え、別SHA・別gateの混在、過去結果のreplayを独立レビューとして誤承認できる。

provider固有のmodel名を共通規則へ埋め込む案は、Claude Code、Codex、humanの実行能力を偽って同一視する。別々のworkflowへ実装を分散する案は、GitHubとローカルで集約規則が乖離し、Standard経路まで複雑にする。

## Decision

Strictの独立性を、trusted launcherが発行する固定slot `reviewer-1`・`reviewer-2`、一回限りの別invocation UUID、同一Issue・gate・target SHA・profileへの結線として定義する。launcherは同じadapter契約を別subprocessで2回起動し、provider固有のmodel選択には介入しない。peer verdictは各レビュアの入力へ渡さない。

trusted CLIだけが2つのscratch gate reportを集約する。入力妥当性と`human_required`を最優先し、次にreject、両方approveだけをapproveとする。slot、invocation、binding、schema、artifact digest集合が不一致ならapproveしない。最終gate reportは両sub-verdictとprovenanceを保持し、Strictのapproved publishはこの証跡が無ければ拒否する。

Standardは既存の1体がconformanceとfalsificationを順に行うdirect pathを維持する。core監査の分類・model能力選択は別責務であり、その2結果だけを同じtrusted aggregationへ結線できる境界を提供する。

## Consequences

- 件数だけでなく起動provenanceと対象bindingを機械検証でき、複製・混在・replayをfail-closedにできる。
- 全providerが同じ集約規則を使いながら、存在しない共通model名を仮定しない。
- Strictは2回のreviewer実行時間・費用を要し、humanは2つの独立submissionが揃うまで停止する。
- runtime sessionとscratch reportの管理、schemaのoptional証跡、並行起動テストが増える。
- PR #274のcore専用2 Actionはrebase時に件数だけの集約を捨て、本契約へ結線する必要がある。
- session・片側起動・cleanup・集約の失敗は`human_required`となり、可用性より誤承認防止を優先する。
