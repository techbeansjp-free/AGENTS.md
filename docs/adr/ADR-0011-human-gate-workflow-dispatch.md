# ADR

```yaml
id: ADR-0011
status: proposed
title: human gateの停止と復帰を同じtrusted Check sessionへ限定する
tags: [github-actions, gate, human-review, idempotency]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

human reviewerはCI job内で同期的に待てないため、required Checkを`action_required`にして非同期判定を
待つ。runner内のgate-report pathは次のrunへ復元できず、PR branchのscriptをwrite token付きで
再実行するとread-only境界を越える。PR番号・gate・current SHAだけを検査して新しいsuccess Checkを
作る方式も、元の停止Check、human adapter、profile、未消費判定への結線を証明できず、replayや
自動reviewerの短絡を許す。

現行human adapterのIssue comment通知は`issues: write`を必要とする一方、gate workflowはその権限を
持たない。権限を追加してもPR codeを実行するjobへwrite tokenを広げるため採用できない。Strictでは
別slot・別invocationの2判定が必要であり、runner一時manifestでは非同期human判定を耐久化できない。
artifact pathを人間入力に任せると空集合でもschema上承認でき、後続の変更検知も無効になる。

## Decision

GitHub human gateは、default branchのtrusted CLIだけを実行する2 workflowで扱う。

- 初回workflowは`pull_request_target` eventを受け、backend=github、adapter=human、open/same-repo、
  current head、branch由来Issue、profileを検証する。PR commitはGit objectとしてだけ読み実行しない。
- 復帰workflowは`workflow_dispatch`とし、親Check/session/slot/invocation、PR/gate/SHA、verdictを受ける。
  workflow inputはenv経由でquoted stdinへ渡し、PR code・human・logへtokenを露出しない。
- required名の親Check Runをhuman gate sessionのGitHub正本とする。`external_id`とbounded outputに
  session state、publisher App、trusted CLI SHA、actor、workflow run、親/slot Check ID、submission digest、
  対象provenance、artifact digestを保存する。初回通知も親Check summaryへ記録する。
- 初回と復帰は同一repository/PR/gate concurrency groupで直列化する。復帰は対象slotの`awaiting`を
  CAS相当で`recorded`へ更新し、必要slot充足後だけ親の`awaiting`をterminalへ更新する。新しい
  success Checkは作らず、同一digest replayはno-op、異なる再提出は新sessionなしでは拒否する。
- Standardは1つのdurable slot、Strictは別actor・別invocationの2つの非required slot Checkを親へ結線する。
  Strictの集約規則は、対象一致とartifact一致を検査し、不足・不正・判定不能、reject、両approveの
  優先順位で確定する共通trusted aggregatorを再利用する。Issue #277は由来であり、契約は本ADR内に
  完全記載した。依存未導入時はStrict開始を拒否する。
- expected artifact full-setはsegment manifestとbase/target差分からtrusted側で導出し、target commitの
  全blob digestとcanonical集合digestを計算する。verdictはartifact path/digestを入力に持たない。
- `gate human-open-session`と`gate human-submit`は最初にbackend=githubを要求する。local backendは
  `reviews/<gate>.yaml`だけを正本とし、GitHub sessionを作らない。

workflow権限は`contents: read`、`pull-requests: read`、`checks: write`だけとし、Issue書込み権限を
追加しない。人間レビュアはleaseなし・read-only、trusted publisherだけがCheckを書き、成果物を
変更するimplementation workerだけがwriter leaseを使う。

## Rejected alternatives

- 既存PR workflowのrerun: 一時reportを失い、PR codeへwrite tokenを渡すため却下。
- Issue comment権限の追加: 通知のためにtrust境界を広げ、session正本にもならないため却下。
- submitごとに新CheckをPOST: 元の`action_required`との一回限り結線と冪等性がないため却下。
- local file・Actions artifact・runner manifest: GitHub backendの正準プリミティブでなく復元不能なため却下。
- 人間がartifact path/digestを指定: 空・部分集合・偽digestをtrusted承認へ持ち込めるため却下。

## Consequences

- 停止通知、判定、required Checkが同じsessionとして監査でき、stale・replay・自動経路短絡を防げる。
- Strict human gateは複数runをまたいで2件を蓄積し、正常時にsuccessへ復帰できる。
- Check outputへ保存できるようverdict/evidenceにサイズ上限が必要になる。
- terminal判定の訂正には、旧sessionを再利用せずtrusted処理で新sessionを作る必要がある。
- workflow、CLI、human通知、Strict adapter、templateは一つの契約として同期テストと同時rollbackを要する。
