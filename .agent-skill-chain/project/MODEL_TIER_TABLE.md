# コア独立レビューのモデル選択ポリシー

## 目的・対象・入力

本書はagent-skill-chain自身のコア変更とコア監査に使う独立gate reviewerを定める登録済みproject policyである。入力はtarget SHA、監査区分、review profile、選択adapterとcapability probeで、出力はローカルreviewerの検証済み起動、または `human_required` である。

## コア対象

コア変更はmanifestのexact path/path prefixに一致する差分、コア監査はCoordination Backendの `core_audit` である。GitHubは `review:core-audit` label、ローカルはstateの `review_subject` を使い、相互同期しない。差分・状態を解決できない場合は通常作業と推測せず `human_required` にする。

コア対象はStrictと独立reviewer 2体を必要とし、各reviewerに `frontier_coding`、`maximum_reasoning`、read-onlyを要求する。

## adapter契約

| adapter | model | reasoning | 検証 |
|---|---|---|---|
| Codex | `gpt-5.6-sol` | `xhigh` | adapter固定argvの`codex exec`だけをread-only sandboxで起動し、coreの完全command上書きは拒否 |
| Claude Code | 実行環境の管理主体が保証する実在model | 最大利用可能reasoning | 管理主体をtrust rootとする`--model`、能力attestation、reasoning probe、無書込みtool。coreの完全command上書きは拒否 |
| human | 自動modelなし | 自動reasoningなし | 自動承認せず `human_required` |

Claude CodeへCodex固有slugや設定keyを渡さない。具体的Claude model名を推測しない。Cursor等はadapter、安定した非対話実行、capability probeが実装・登録されるまで利用不能とする。

## ローカル実行とGitHub証跡

AI reviewは進行役がcleanなrepository default branchのprotected base worktreeまたはversion固定installed packageのadapterへ委譲する。launcherはprotected base SHAのephemeral cloneでbuildしたclassifier、prompt generator、adapter、recorderだけを使い、credential-bearing remoteを削除し、Issue worktreeが変更した実行コードを同じPRの証跡生成へ使わない。Codex/Claude Codeはローカルの既存ログインを使い、provider credentialをCIへ移送しない。

trusted recorderはverdict、target SHA、prompt/artifact/launcher digest、protected base SHA、one-time attempt ID/token、credential-scrubbed ephemeral-clone/read-only attestation、adapter能力、`review-` namespaceのreviewer run ID/slotをGitHub PR reviewへ保存する。Review API actorはAIレビュア本人ではなく、writer credentialから分離した専用Coordination Backend principalである。専用tokenでAPI identityを再取得し、PR authorと全commit author/committerのいずれかと一致する場合は拒否する。worker/reviewerには専用tokenとReview API投稿能力を与えない。

core Codexの実行物はprotected launcherがcandidate影響前の管理PATHからabsolute realpath解決し、SHA-256と固定`codex login status`成功を0600 one-time tokenへ束縛する。adapterは実行直前にdigestを再照合してexact pathだけを起動し、provider executable digestをReview evidence/gate reportへ保存する。`CODEX_EXECUTABLE`・`CODEX_AUTH_PROBE_CMD`・完全command上書きはcoreで拒否する。管理PATHと解決binaryは管理主体のtrust rootであり、candidate・model出力・caller自己申告はtrust rootではない。non-core override互換は維持する。

legacy GitHub Actionsはprotected baseのverifierでPR/commit/review API metadataと証跡を検証するが、Checks書込み権限を持たずcanonical Checkを発行しない。AI、provider CLI、Codex Action、provider API credential、self-hosted runnerを使用しない。review actorが未登録・writerと同一、actor関係が未解決、実行attestation・SHA・digest不一致、latest Strict attemptのslot不足・重複、判定不能なら検証jobを失敗させる。旧attemptへfallbackせず、canonical Checkは専用App recorderだけが生成する。

GitHub Actions Appの一致だけではworkflow sourceを識別できない。#274は固定SHAのbootstrapとreport整合性までを扱い、通常のI2 enforcementはIssue #283が導入する専用GitHub App source identityを必須とする。

## 通常作業・配布・完了条件

通常作業は明示された既存adapter/model選択を維持する。model policyが無いconsumerも従来動作を維持する。

配布templateと展開済みworkflowは同一である。initは検証専用workflowを配り、upgradeは導入済みtemplateと展開物が一致するときだけ両方を更新する。不一致・欠落はlocal customization競合として何も上書きしない。

classifier、adapter、証跡検証、Strict集約、workflow、schema、init/upgrade、template syncの自動テストを完了条件とする。導入PRはcandidate codeで自己承認せず、protected baseの既存gate記録経路を使う。
