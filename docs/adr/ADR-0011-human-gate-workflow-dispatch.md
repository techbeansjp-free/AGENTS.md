# ADR

```yaml
id: ADR-0011
status: proposed
title: human gateを耐久inboxと単一App publisherで同じCheck sessionへ復帰させる
tags: [github-actions, gate, human-review, idempotency]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

human reviewerはCI job内で同期的に待てず、required Checkを`action_required`にして非同期判定を待つ。
runner fileやActions artifactは次runの調整正本ではなく、workflow dispatchも処理開始前に取消され得る。
判定をPR Reviewへ先に耐久記録しなければ、queueやrunner障害で受理済み入力を失う。

GitHub公式Actions仕様で`concurrency.queue: max`は実在するがpending上限は100件で、満杯後のrunは取消される。
待機開始順はdispatch順を保証しないため、queueは直列化の補助であってinboxにはならない。公式Checks RESTの
update endpointはstatus/conclusion/outputをPATCHできるが、expected versionや`If-Match`による条件付き更新を
契約として示さない。したがってこの処理をCASと呼ぶことも、PATCH単体へ競合排除を委ねることもできない。

通常workflow tokenや別integrationが同名Checkを作れるとrequired名だけでは偽装を防げない。Issue #283が
設計するdedicated App、main限定protected environment、rulesetの`context+integration_id`固定が先に必要である。
StrictにはIssue #277が設計する2 slot provenance集約が必要だが、現実装のfile/session操作をGitHub adapterへ
複製してはならず、I/O・時刻・replayを持たない純粋reducer APIとして先に確定する必要がある。

公式根拠:
https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
https://docs.github.com/en/rest/checks/runs
https://docs.github.com/en/rest/orgs/rules

## Decision

PRをhuman gate aggregate rootとし、required parent Checkをsession、非required slot Checkを判定証跡、
機械marker付きPR Reviewをdurable dispatch inboxとする。parent keyはrepository/PR/target SHA/gate/name/App、
session IDはそのdigestである。trusted openerはbase/targetのdiffから
`spec→design→implementation→validation`の開始gateを導出し、gateごとに0件なら作成、1件なら再利用、
同SHA/name/Appが複数ならfail-closedにする。既存publisher/reconcileは新publisherへ置換し二重writerにしない。

candidate workflowはcustom Checkを書かず、`GITHUB_TOKEN`を`checks: none`にする。専用App tokenは
default branchかつmain限定environmentのpublisher stepだけが取得する。parent create/PATCH、slot
create/PATCH、reconcileは全て同Appをsourceとし、rulesetはrequired名ごとにそのintegration IDを要求する。
human判定はPR Reviewへ先に保存する。read-only review event runの完了を受けるdefault-branch
`workflow_run` publisherまたはmain指定manual recoveryがdrainを起動する。publisherと定期sweeperはAPIから
ReviewとPRを再取得し、未消費ReviewをID順にdrainするため、Actions queue取消は入力を失わせない。

Checks更新はCASではなくsingle-writer serializationとする。repository/PR/gateごとのprotected publisher
laneだけが書き、slotへownership nonceとowner run IDを記録して再読する。PATCH応答不明なら同nonceの
postconditionを再読し、成立済みはno-opとする。owner runがrunningなら待ち、Actions APIでterminalと確認後だけ
新nonceで再開する。terminal同digestはno-op、異digest・相反結論は上書きせず新sessionを要求する。
parentはawaiting/reducingを`completed/action_required`、approvedを`completed/success`、rejectedを
`completed/failure`へ写像する。slotはqueued、in_progress、completedと各判定conclusionを対応させる。

artifact集合はbase→targetのA/M/D全pathをgateへ一意分類する。SPEC、DESIGN/PLAN/ADR、VALIDATIONを各文書
gateへ割り当て、残るsource/test/workflow/config/schema/scriptをimplementationへ割り当てる。A/Mはtarget
blob digest、Dはbase digestと`deleted` markerのtombstoneを持ち、path順canonical JSONの集合digestを作る。
submitは保存集合と再導出集合を両方向比較し、追加・欠落・重複・digest差・取得不能を承認しない。

Strict adapterはdurable slotを`context,envelopes`へ写像し、ADR-0010でacceptedになる純粋reducerだけに
最終判定を委ねる。reducerは固定2 slot、異actor/invocation、session/target/artifact一致、判定優先順位だけを
扱う。Review選択、replay、nonce、API retry、Check status/conclusion写像は外側に置く。ADR-0010とADR-0013が
acceptedかつ配備済みになるまでsession開始を拒否する。

ADR-0011はこのDESIGNが記録する自己判断であり、DESIGNの`related_adrs`へ自己参照しない。ADR-0010/0013は
accepted後にだけ、テンプレート規範の`id`/`relation: adopts` objectとしてDESIGNへ追加し再承認する。

## Consequences

- 受理済み判定はActions queueやrunnerから独立してGitHub上に残り、sweeperで回復できる。
- Check writer/sourceが同じAppへ狭まり、同名Check偽装とpublisher二重化をrulesetと実装の両方で拒否できる。
- 非atomic PATCHでも唯一writer、nonce、run terminal確認、postconditionで冪等に収束し、逆結論を上書きしない。
- gate別A/M/D全集合とtombstoneにより、削除・片方向subset・空承認を検出できる。
- Review/Check output上限、100件超のburst、API遅延に備え、bounded envelopeと定期drainの運用が増える。
- rollbackは#278 publisher routingだけを無効化し、#283の既存active rulesetを残す。旧writerへfallbackしない。
