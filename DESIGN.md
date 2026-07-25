# DESIGN: ローカル独立レビュー証跡をCIで検証する

- Issue: `ISSUE-271`
- 対応SPEC: `SPEC.md`

## 目的・設計方針

AI inference と gate 状態遷移を分離する。進行役はローカル adapter へ read-only review を委譲し、trusted recorder が verdict を GitHub PR review として保存する。GitHub Actions はモデルを起動せず、Review API から取得した証跡を trusted CLI で再検証して Check Run を発行する。

```text
orchestrator
  → local adapter capability probe
  → read-only reviewer process
  → trusted recorder → GitHub PR Review API
  → GitHub Actions → evidence verifier → gate report → Check Run
```

## 要件と設計要素

| AC | 設計要素 |
|---|---|
| AC-1 | inferenceを除去したgate workflow、ローカルadapter |
| AC-2 | manifest能力契約、model-selection classifier、adapter probe |
| AC-3 | Review API metadata、SHA/prompt/artifact digest再検証 |
| AC-4 | trusted actor、writer actor分離、reviewer run ID/slot、必要数集約 |
| AC-5 | verdict envelope、gate report、reconcile |
| AC-6 | GitHub/local backend分岐、通常モデル明示選択 |
| AC-7 | schema、template sync、回帰テスト |

## 責務と境界

### project policy / classifier

manifest の `core_review` は次を保持する。

- `execution: local`、`evidence_transport: github_pr_review`、`ci_role: verify_and_publish`
- `trusted_reviewer_actors`: Review API投稿をattestとして受理するGitHub actor
- `required_profile: strict`、`reviewer_count: 2`
- `triggers`: `review:core-audit`、ローカルstate値、exact paths、path prefixes
- vendor-neutral capability `frontier_coding` / `maximum_reasoning`
- Codex固定値とClaude capability probe入力。未登録adapterは利用不能

classifier は base...target 差分とbackend正本の監査区分だけを解釈する。取得不能は `required/unresolved` とし、ordinaryへ降格しない。GitHubでもconfigの明示adapterを尊重し、Codexへ暗黙固定しない。

### trust rootとwriter identity

GitHub Actionsは `pull_request_target` / `pull_request_review` の保護されたbase revisionにあるworkflow、classifier、policy、schema、verifierだけを実行する。PR headのコードはcheckout・build・sourceせず、対象成果物はGit objectとしてread-onlyに参照する。当該PRが変更したallowlistやverifierを、同じPRの承認へ使わない。

writer actor集合はGitHub APIのPR authorと全commitのauthor/committer loginから作る。review evidenceのauthorは登録済みtrusted actorであり、かつwriter actor集合に含まれないことを要求する。証跡本文のwriter自己申告値は判定に使わない。

### local reviewer / trusted recorder

既存 `codex.sh` / `claude.sh` が同じvendor-neutral契約を実装する。

- 共通: read-only、非対話実行、conformance/falsification JSON、target SHA、prompt digest、成果物digest
- Codex: `codex exec --sandbox read-only -m gpt-5.6-sol -c model_reasoning_effort=xhigh`
- Claude Code: 実在model、`frontier_coding` / `maximum_reasoning` attestation、reasoning probe、無書込みtool
- Cursor: adapter・安定した非対話CLI・probeが未実装なので選択を拒否する

各呼出しは orchestrator が割り当てた一意な reviewer run ID と Strict slot (`1|2`) を持つ。adapterはmodel出力を直接状態へ書かず、trusted CLIへ標準入力で渡す。CLIはcapability、slot、prompt/artifact digestを確認し、GitHubモードでは marker付きPR reviewを作る。worker roleにはReview API commandを与えない。

local recorder自身もprotected baseをtrust rootにする。進行役はIssue worktree内のcandidateではなく、cleanなbase worktreeまたはversion固定したinstalled packageから `gate local-review` を起動する。commandはclassifier、prompt generator、adapter、recorderがbase SHA/package versionと一致することを検証し、target成果物は `git show <target_sha>:<path>` で読む。dirty・version不一致・由来不明の実行系は `human_required` とする。

### evidence envelope

PR review本文には次を保存する。

- schema version、Issue、gate、target SHA、profile
- reviewer run ID、slot、adapter、model、reasoning/capability、read-only
- prompt digest、approved artifactsとdigest、verdict

GitHub APIのreview `id` / `user.login` / `commit_id` / `state` とPR/commit actorは本文外の正本である。CIはdismissed review、未登録actor、writer actorによるreview、target SHA不一致を除外せずエラーとして扱う。PRまたはいずれかのcommitのauthor/committer loginがnull・未解決ならwriter集合を推測せず `human_required` とする。branch内のgate reportやJSONは承認入力にしない。

### evidence verifier / aggregator

新しいCLI経路はPR・commit・Review API metadataを取得し、現在のtarget SHA用scaffoldへ結線する。

1. Issue/gate/profile/SHA、API `commit_id`、registered actorを検証する。
2. promptをtarget SHAから再生成しdigestを照合する。
3. `git show <sha>:<path>` で成果物digestを再計算する。
4. review actorがwriter actor集合に含まれず、run ID/slotが重複しないことを確認する。
5. Standardはslot 1を1件、Strictはslot 1・2を各1件要求する。
6. 全件pass/passかつblocking無しだけapproved、fail/blockingはrejected、不足・不一致・判定不能はhuman_requiredとする。

複数の有効候補や同じslotの再投稿は曖昧性として拒否する。古いSHAの証跡を最新SHAへ継承しない。gate reportにはAPI review ID/actorと検証済みreviewer metadataを残す。

### GitHub Actions

workflowは `pull_request_target` と `pull_request_review` を契機に、base revisionのcheckout/build、PR metadataとtarget Git objectの取得、evidence import、schema検査、publishだけを行う。provider secret、Codex Action、Claude/Codex CLI、self-hosted labelを含めず、PR head由来の実行可能ファイルを実行しない。証跡が未到着なら `human_required` reportを生成して `action_required` Check Runを発行する。workflow自体は証跡不足をクラッシュとして扱わず、検証器の異常はfail-closedで可視化する。

ローカルbackendは既存adapterがtrusted CLIを介して `reviews/<gate>.yaml` を生成するため、Review APIを要求しない。

### 配布と既導入consumer migration

配布正本 `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml` とroot展開物を同時更新する。`init` は新規consumerへ検証専用workflowを配る。

`upgrade` は全書込み前に、consumerの展開済みgate workflowと、そのconsumerに既に導入済みの配布templateを比較する。

- 同一ならmanaged assetとして両方を新workflowへ置換し、API credentialとCI内model起動を除去する。
- 不一致ならlocal customization競合としてupgrade全体を無変更で停止し、installed versionも進めない。
- 片方の欠落・読取不能もfail-closed。`--dry-run` は移行または競合だけを報告し書かない。

preflightは通常のmirror loopが旧templateを上書きする前に行う。安全なlegacy修復、競合時no-op、新規init、template sync、配布元と展開物にprovider secret/Codex Action/provider CLI/self-hosted runnerが0件であることを回帰検査する。

## DDD境界と依存方向

- Coordination Context: Issue、worker report、PR review、Check Run。GitHub/local間で同期しない。
- Review Execution Context: provider CLI、capability probe、read-only verdict。調整状態を書かない。
- Verification Context: API metadata・digest・件数を検証しgate reportへ集約。providerを呼ばない。
- Artifact Context: SPEC/DESIGN/PLAN/code/VALIDATION。reviewerと進行役は変更しない。

依存は `policy → execution → evidence → verification → gate` の一方向で、CIからexecutionへ逆流させない。

## schema・互換性・障害

- project-policy schemaへ任意のmodel-selection契約としてローカル実行・transport・CI責務・trusted actor・reviewer数を追加し、自己拡張manifestのpolicy versionを上げる。mainの既存v1 manifestにはmodel-selection自体がなく、この追加blockは任意なのでconsumer migrationは不要である。block不在は従来の通常adapter選択、block存在時は全新フィールド必須とする。rollbackはblock除去で旧manifestへ戻せる。
- gate-report schemaへ検証済みreviewer metadataを任意追加する。旧reportは読めるが、新しいapproved publishは必要reviewer metadataなしでは拒否する。
- API/CLI/capability/分類/証跡検証の失敗はhuman_required。`neutral`や推測値を使わない。
- rollbackは新workflow/policy/CLIを同一commitで戻す。既存レビュー証跡はPR履歴として残るが旧実装は参照しない。

## trust-root bootstrap

導入PRはcandidate verifierやcandidate allowlistで自己承認しない。PR #274は、#283でprotected baseの既存local gate記録経路が修復された後、そのbase経路で独立レビューとCheck Runを記録する。それまでは `human_required` のまま停止し、candidate code、admin bypass、branch内の自己申告証跡を使わない。merge後に初めて新しいbase revisionを後続PRのtrust rootとする。

## ADR

ADR-0009を「CI内model実行」から「ローカル実行・外部証跡・base trust rootによるCI検証」へ改訂する。provider固有値をvendor-neutral能力へ写像し、未証明providerをfail-closedにする長期判断は維持する。

## 完了条件

全ACの単体・結合テスト、型検査、policy/schema/template sync、lint/SAST/secret scanを成功させる。独立検証はwriter-controlled recorder、未解決actor、偽造・古いSHA・自己承認・Strict不足・upgrade競合を反証する。base gateの停止は迂回せず#283依存として報告する。
