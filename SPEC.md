# SPEC: attested workflowでローカルレビューをCheck正本へ記録する

- Issue: `ISSUE-283`
- 対象ブランチ: `bugfix/283-gate-check-bootstrap`

## 目的・背景

GitHub Actions内でAI/API keyを使わず、進行役がローカルCodex・Claude Code等へ委譲した独立レビューを
default branchのtrusted workflowが検証し、現在PR SHAのCheck Run正本へ記録する。runner一時fileに
依存せずADR finalizationとpush後のgate継承を復元可能にし、candidate workflowによる同名Check偽装を拒否する。

## 前提・用語・境界

- `recorder_actor`: GitHubへ証跡・dispatchを記録する進行役。PR authorと同一でもreviewerとは扱わない。
- `evidence v3`: Issue/gate/profile/SHA、attempt ID・expected count・launcher token digest、run/slot/能力、
  prompt/verdict/artifact digest、protected-base隔離read-only実行を含むPR Review証跡。
- `aggregate report`: latest attemptのv3証跡をtrusted aggregate policyで集約した最終report。
- `workflow attestation`: report digestを、exact signer workflowと`refs/heads/main`へ暗号的に束縛するGitHub provenance。
- `enforcement backend`: environment保護した`dedicated_app`、またはorg/enterprise `required_workflow`。
  fork PRは追加隔離策であり、単独ではruleset enforcementにしない。
- #274はbootstrap用v3 producer/verifier/aggregate、#277は後続で一般Strict集約を正本化する。#283は共有aggregate
  policyの出力を再判定せず、provenance・schema・digest検証、Check写像、materialize、reconcileを担う。

## 要求・要件

GitHub Actionsだけで調整状態を管理しつつ、AI実行はローカルへ委譲し、権限・対象・証跡不整合をfail-closedにする。

- 記録はdefault branch固定SHAの`repository_dispatch` workflowだけが行い、PR codeを実行しない。
- 入力はPR番号・許可gate・40桁target SHAだけとし、actorの`write|maintain|admin`権限と全状態をAPIから再取得する。
- current head/default base/Issue/profile、v3最新attempt、人数/slot/run、launcher、verdict、成果物を再検証する。
  最新attempt不完全時は旧attemptへfallbackせず、artifact digestはtarget Git objectから再計算する。
- author本人のhuman reviewは拒否する。同一recorder actorの独立AI runはv3 attestation一致時だけ許可する。
- shared aggregate policyだけがapproved/rejected/human_requiredを導出し、recorderはsuccess/failure/action_requiredへ写像する。
- report fileへGitHub artifact attestationを生成し、exact signer workflow・source ref・subject digestを検証する。
  envelopeをrepo/PR/SHA/gate/attempt/workflow run+attempt/check IDへ束縛し、別Checkへのreplayを拒否する。
- rulesetとenforcement backendをmerge-ready・materialize・reconcileの全経路で検証する。dedicated Appの
  private keyはdefault branch限定environmentだけへ置き、ruleset integration IDを固定する。標準Actions Appだけなら停止する。
- Checkはin_progressで検証し、PR/gate単位concurrency下で全postcondition成立後の最後の操作だけがsuccessへ遷移する。
- Check outputへ最終report・evidence/attestation digest・review/aggregate/artifact provenanceを機密を除いて保存する。
- materializeはcurrent SHA/name/same-Appの全conclusion中最新runがattested successの場合だけ非正本cacheを復元する。
- reconcileはprevious headのenforcement sourceに属する全conclusion中最新runを先に選び、valid attested approved時だけ
  fresh runnerへ復元する。current期待path集合の完全一致+全digest一致時だけ再発行し、それ以外は下流も無効化する。
- template/root workflow、CLI、init/upgrade、ruleset、テストを同期し、AI/provider credentialを要求しない。
  Artifact Attestations非対応またはenforcement backend未構成のconsumerは部分配備せず設定エラーにする。
- 初回trust root導入はAC-6の一回限りmigrationに限定し、通常運用へbypassを持ち越さない。

## 受入条件

### AC-1: attested Checkを記録・復元できる

- Given: write以上のrecorderがcurrent headへ完全な独立v3 evidenceを提出する
- When: trusted workflowがaggregate reportを検証・attestし、後続がmaterializeを要求する
- Then: successは最後に一度だけ発行され、最新runのworkflow provenance検証後だけreportを復元してADRをfinalizeできる
- 検証方法見込み: `automated`

### AC-2: stale・不正対象・candidate偽装を拒否する

- Given: stale SHA、別PR/Issue/base、不正gate、digest不一致、candidate same-App Checkまたはattestation replayがある
- When: record・merge-ready・materialize・reconcileのいずれかを実行する
- Then: success/復元/merge許可を行わず、過去のattested successへfallbackしない
- 検証方法見込み: `automated`

### AC-3: 権限・独立性・attemptをfail-closed検証する

- Given: 権限不足、v3不足、最新attempt不完全、重複slot/run、非read-only、author本人human review、判定矛盾がある
- When: trusted verifierが検証する
- Then: 非zeroまたはaction_requiredとなり、recorderとAI reviewerを同一identityとして誤判定しない
- 検証方法見込み: `automated`

### AC-4: fresh checkoutでgateを継承・無効化できる

- Given: previous headのenforcement source全conclusion中最新runがvalid attested approvedで、新しいheadがpushされた
- When: default-base reconcilerがprevious reportとcurrent artifactをfresh runnerで照合する
- Then: 期待path集合と全digestが完全一致するgateだけを再発行し、変更gateと下流を無効化する
- 検証方法見込み: `automated`

### AC-5: consumerへ安全に配布・更新できる

- Given: 新規または既存consumerがsetup/upgradeする
- When: GitHubテンプレートを展開する
- Then: 対応backendとattested workflow・ruleset・CLIが同期し、非対応環境は部分配備せず停止する
- 検証方法見込み: `automated`

### AC-6: #274だけを監査可能にbootstrapできる

- Given: owner承認・admin bypass許可・Sol/xhigh最終PASS・全非gate CI PASSと、#274固定SHAにv3・
  durable output・materialize・dedicated-App経路の実装があり、その固定digestをPR Reviewに記録済みである
- When: 進行役がその#274 SHAだけをadmin mergeする
- Then: 非attestedな一回限り証跡を耐久記録して別SHA/二回目を拒否し、merge後の#283から通常attestationを使う
- 検証方法見込み: `hybrid`

## 対象外・完了条件

AIモデル実行、AI provider key、self-hosted runner、branch protectionの緩和は対象外。GitHub AppはCheck専用である。
AC-1〜5の自動検証と全回帰・同期・権限検査を成功させ、AC-6のhybrid証跡を残す。未決事項はない。
