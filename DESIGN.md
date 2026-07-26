# DESIGN: human gateをGitHub正準sessionから一回だけ復帰させる

- Issue: `ISSUE-278` / 対応する SPEC: `SPEC.md`

## 目的・前提・依存

human gateを「trusted初回通知」「read-only人間判定」「trusted CAS発行」へ分ける。Issueを集約ルート、PRとCheck RunをGitHub backendの調整プリミティブとし、PR branchにはtoken・session書込み・CLI実行を
許さない。Strict集約規則とsub-verdict provenanceはIssue #277の成果を先にmainへ取り込み、本設計はその純粋集約へGitHub耐久slotを渡す。依存未導入ならStrict session開始をfail-closedにする。

## ACと設計要素

| AC-ID | 設計要素 |
|---|---|
| AC-1 | Trusted session opener / Check notification |
| AC-2 | Context and provenance validator |
| AC-3 | Serialized Check CAS / replay guard |
| AC-4 | Config check resolver / artifact full-set resolver |
| AC-5 | Verdict validator / fail-closed publisher |
| AC-6 | Durable 2-slot adapter / common Strict aggregator |
| AC-7 | Backend and role guard |
| AC-8 | Audit record / template contract tests |

## GitHub正準session

親はrequired名`config.checks[gate]`のCheck Runで、`external_id`にversion、session ID、状態、
submission digestを持つ。boundedな機械可読outputにrepo/Issue/PR/gate/head/profile/adapter、
publisher App ID、trusted CLI SHA、親Check ID、expected slot、slot Check ID・invocation ID・actor・run ID、
expected artifact集合とdigestを保存する。全slotは親sessionを指す非required Check Runとして判定本文を
独立保存する。GitHub外のmanifestやrunner一時fileを復帰状態の正本にしない。

```text
parent: absent -> awaiting(action_required)
slot:   absent -> awaiting -> consuming -> recorded
slot:   recorded + same digest -> same result
slot:   recorded + different digest -> reject
parent: awaiting + slot不足 -> awaiting
parent: awaiting + slot充足 -> consuming -> approved|rejected|human_required
parent/slot: awaiting -> invalidated           : head/profile/adapter変更
parent terminal + same aggregate digest -> same result; different digest -> reject
```

## Trusted session opener

専用`pull_request_target` workflowはdefault branch上のworkflowとCLI SHAを明示checkoutし、同じSHAで
buildする。最初にbackend=github、adapter=human、open/same-repo/current head、branch→Issueを検証し、
PR headはfetchしたGit objectとしてだけ読む。変更gateとprofileをdefault branch設定・PR labelから導出し、
`gate human-open-session`が親/slot Checkを作る。human adapterは通知文をrenderするだけでGitHubへ書かず、Claude Code/Codexは既存の自動workflowだけを使う。
復帰commandは親Check summaryへ2行で記録し、JSONは`VERDICT_JSON="$(jq -c . verdict.json)"`の後、
quotedな`-f "verdict_json=${VERDICT_JSON}"`として渡す。Issue書込み権限は使わない。

## Dispatch validatorと一回限りCAS

`workflow_dispatch`はdefault branchをrefとし、親Check/session/slot/invocation、PR/gate/SHA、verdictを受ける。
`gate human-submit`はGitHub APIを呼ぶ前にbackend=githubを要求し、default設定のadapter・Check名、実行repositoryとpublisher App ID、
現在のPR metadata/profile/headを再導出する。同一repo-wide concurrency group
`asc-human:<repository-id>:<pr>:<gate>`の中で親/slotを再読し、親と対象slotが`awaiting`かつ全provenance
一致時だけslotを`consuming`へ更新する。直後に再読して所有を確認し、不一致ならsuccessを書かない。
slot充足後だけ親を同じexpected-state手順で`consuming`へ移す。同じcanonical verdict digestのreplayは
既存Check URLを返し、異なるdigest・消費済slotは拒否する。publisherは新しいrequired Checkを作らず
同じ親Check IDをPATCHする。

## Verdict・artifact・Strict集約

workflow inputはenvへ割り当て、`printf '%s' "$VERDICT_JSON"`でstdinへ渡す。式をshell本文へ直接展開せず、
token・verdictをlogへ出さない。verdictは2観点とorigin付きfindingだけを受け、`pending`、未知field、
空evidence、上限超過を拒否する。artifact full-setはsegment manifestの必須outputとbase/target差分の
当該segment分類をunionし、正規化・sort・重複排除した非空集合とする。全blobを
`git show <target>:<path>`で読み、各SHA-256とcanonical集合SHA-256をtrusted側で算出する。

Standardは固定1 durable slot、Strictは別slot・別invocation・別actorの2件を待ち、両slotの
Issue/gate/SHA/profile/sessionとartifact集合が完全一致する場合だけIssue #277の共通aggregatorへ渡す。
不足・不正・`human_required`を最優先、次にreject、両方approveだけをapproveとする。slot提出後も
必要数未満なら親は`awaiting/action_required`を維持し、2件揃った時だけ親をterminalへCAS更新する。

## Sequence・権限境界

```text
PR event -> trusted opener: default CLIでcontext/artifact/profileを導出
trusted opener -> Checks API: 親action_required + durable slot + 復帰command
human A -> dispatch: slot-1 verdictのみ
dispatch -> trusted submit: provenance再検証 -> slot-1 CAS
human B -> dispatch: slot-2 verdictのみ
dispatch -> trusted submit: provenance再検証 -> slot-2 CAS
trusted submit -> common aggregator: 2 slotを集約
trusted submit -> Checks API: 同じ親Check IDをterminalへPATCH
```

レビュアはleaseなし・成果物read-only、trusted publisherだけがChecks APIへ書く。implementation workerの
code変更には通常のwriter leaseを要求する。local backendは既存marker/reportだけを使い、本commandは
GitHub API前に拒否する。workflow tokenはdefault branch CLI stepだけへ渡し、PR codeやhumanへ渡さない。

## 障害・ロールバック・関連ADR

API/fetch/build/CAS/cleanup失敗は親をsuccessにせず、CAS前なら`awaiting`、所有取得後なら
`human_required`へ証跡付きで停止する。head/profile/adapter変更は旧sessionをinvalidatedにする。
workflow、CLI、adapter通知、templateを同時にrollbackし、片側だけ残さない。未決事項はない。

```yaml
related_adrs: [ADR-0011]
```
