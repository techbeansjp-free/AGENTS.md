# コア独立レビューのモデル選択ポリシー

## 目的・対象・入力

本書はagent-skill-chain自身のコア変更とコア監査に使う独立gate reviewerを定める登録済みproject policyである。入力はtarget SHA、監査区分、review profile、選択adapterとcapability probeで、出力はローカルreviewerの検証済み起動、または `human_required` である。

## コア対象

コア変更はmanifestのexact path/path prefixに一致する差分、コア監査はCoordination Backendの `core_audit` である。GitHubは `review:core-audit` label、ローカルはstateの `review_subject` を使い、相互同期しない。差分・状態を解決できない場合は通常作業と推測せず `human_required` にする。

コア対象はStrictと独立reviewer 2体を必要とし、各reviewerに `frontier_coding`、`maximum_reasoning`、read-onlyを要求する。

## adapter契約

| adapter | model | reasoning | 検証 |
|---|---|---|---|
| Codex | `gpt-5.6-sol` | `xhigh` | `codex exec`のmodel/effortを厳密照合しread-only sandboxで起動 |
| Claude Code | 実行環境が宣言した実在model | 最大利用可能reasoning | `--model`、能力attestation、reasoning probe、無書込みtool |
| human | 自動modelなし | 自動reasoningなし | 自動承認せず `human_required` |

Claude CodeへCodex固有slugや設定keyを渡さない。具体的Claude model名を推測しない。Cursor等はadapter、安定した非対話実行、capability probeが実装・登録されるまで利用不能とする。

## ローカル実行とGitHub証跡

AI reviewは進行役がcleanなrepository default branchのprotected base worktreeまたはversion固定installed packageのadapterへ委譲する。launcherはprotected base SHAのephemeral cloneでbuildしたclassifier、prompt generator、adapter、recorderだけを使い、credential-bearing remoteを削除し、Issue worktreeが変更した実行コードを同じPRの証跡生成へ使わない。Codex/Claude Codeはローカルの既存ログインを使い、provider credentialをCIへ移送しない。

trusted recorderはverdict、target SHA、prompt/artifact/launcher digest、protected base SHA、one-time attempt ID/token、credential-scrubbed ephemeral-clone/read-only attestation、adapter能力、`review-` namespaceのreviewer run ID/slotをGitHub PR reviewへ保存する。Review API actorはAIレビュア本人ではなくCoordination Backendへの記録主体であり、writer actorと同一でもよい。worker/reviewerにはReview API投稿能力を与えない。

PR/commit/review API metadataと証跡をGitHub Actions上で自動検証しgate reportとCheck Runを生成する専用verifier workflowは、Issue #386（gate/reconcile/trusted-gate 3ワークフロー削除）以降このリポジトリに存在しない。GitHubモードでのI2判定はガイドラインであり進行役の手動判断による（AGENTS.md I2）。将来自動verifierを再導入する場合の設計条件は次の通り：AI、provider CLI、Codex Action、provider API credential、self-hosted runnerを使用しないこと、review actorが未登録・actor関係未解決・実行attestation不一致・SHA不一致・digest不一致・latest Strict attemptのslot不足/重複・判定不能なら `action_required` とすること、旧attemptへfallbackしないこと、latest attemptの全reviewerがpass/passかつblocking無しの場合だけsuccessとすること。

GitHub Actions Appの一致だけではworkflow sourceを識別できない。#274は固定SHAのbootstrapとreport整合性までを扱う。GitHub モードのI2はガイドラインであり自動CI強制を持たないため（AGENTS.md I2）、本書が扱うのは進行役が手動起動するコア変更レビューのモデル選定に限る。

## 通常作業・配布・完了条件

通常作業は明示された既存adapter/model選択を維持する。model policyが無いconsumerも従来動作を維持する。

配布templateと展開済みworkflowは同一である。initは検証専用workflowを配り、upgradeは導入済みtemplateと展開物が一致するときだけ両方を更新する。不一致・欠落はlocal customization競合として何も上書きしない。

classifier、adapter、証跡検証、Strict集約、workflow、schema、init/upgrade、template syncの自動テストを完了条件とする。導入PRはcandidate codeで自己承認せず、protected baseの既存gate記録経路を使う。
