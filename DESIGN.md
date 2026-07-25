# DESIGN: ローカル独立レビュー証跡をCIで検証する

- Issue: `ISSUE-271`
- 対応SPEC: `SPEC.md`

## 目的・設計方針

AI inference と gate 状態遷移を分離する。進行役はローカル adapter へ read-only review を委譲し、trusted recorder が verdict を GitHub PR review として保存する。GitHub Actions はモデルを起動せず、Review API から取得した証跡を trusted CLI で再検証して Check Run を発行する。

```text
進行役 → local adapter capability probe → read-only reviewer process
      → trusted recorder → GitHub PR Review API
      → repository_dispatch → default-main evidence verifier
                            → dedicated GitHub App in-progress Check
                            → artifact attestation
                            → success/failure/action_required（最後のPATCH）
```

## 要件と設計要素

| AC | 設計要素 |
|---|---|
| AC-1 | inferenceを除去したgate workflow、ローカルadapter |
| AC-2 | manifest能力契約、model-selection classifier、adapter probe |
| AC-3 | Review API metadata、SHA/prompt/artifact digest再検証 |
| AC-4 | one-time launcher token、attempt ID、reviewer run ID/slot、latest attempt集約 |
| AC-5 | verdict envelope、canonical evidence digest、Check output、cache復元、reconcile |
| AC-6 | GitHub/local backend分岐、通常モデル明示選択 |
| AC-7 | schema、template sync、回帰テスト |
| AC-8 | default-main dispatch、専用App Check、run tuple attestation、success-last |

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

### trust rootとactor関係

GitHub Actionsは `pull_request_target` / `pull_request_review` のrepository default branchにある保護base revisionのworkflow、classifier、policy、schema、verifierだけを実行する。PR headのコードはcheckout・build・sourceせず、対象成果物はGit objectとしてread-onlyに参照する。当該PRが変更したallowlistやverifierを、同じPRの承認へ使わない。PR base refがdefault branchでなければローカルlauncher・recorder・workflowの全境界で拒否する。

writer actor集合はGitHub APIのPR authorと全commitのauthor/committer loginから作る。review evidenceのauthorはAIレビュア本人ではなく、ローカル実行結果をCoordination Backendへ記録するtrusted recorderである。同じ利用者がwriterとrecorderを担う場合は同一GitHub actorでもよい。独立性はactor名ではなく、protected base由来のlauncher digest、ephemeral clone、credentialを除去したread-only sandbox、one-time attempt token、固有reviewer run ID/slot、target/prompt/artifact digestで機械検証する。証跡本文のwriter自己申告値は判定に使わず、APIから得たactor関係をgate reportへ記録する。

### local reviewer / trusted recorder

既存 `codex.sh` / `claude.sh` が同じvendor-neutral契約を実装する。

- 共通: read-only、非対話実行、conformance/falsification JSON、AC-ID別判定・証跡、target SHA、prompt digest、成果物digest
- Codex: `codex exec --sandbox read-only -m gpt-5.6-sol -c model_reasoning_effort=xhigh`
- Claude Code: 実在model、`frontier_coding` / `maximum_reasoning` attestation、reasoning probe、無書込みtool
- Cursor: adapter・安定した非対話CLI・probeが未実装なので選択を拒否する

launcher呼出しごとに暗号学的乱数の `attempt-` IDを1つ生成し、profile由来の期待件数と `review-` namespaceの一意なrun ID・Strict slot (`1|2`) を0600のone-time tokenへ固定する。adapterはmodel出力を直接状態へ書かず、trusted CLIへ標準入力で返す。orchestratorのtrusted recorderはtokenをslotごとに一度だけ消費し、capability、slot、prompt/artifact digestを確認してmarker付きPR reviewを作る。token無し・mode/owner不正・再利用・attempt不一致の直接submitは拒否する。workerとreviewer roleにはReview API commandを与えない。

local recorder自身もprotected baseをtrust rootにする。進行役はIssue worktree内のcandidateではなく、cleanなbase worktreeまたはversion固定したinstalled packageから `gate local-review` を起動する。launcherはprotected base SHAからephemeral cloneを作り、credential-bearing originを削除して、そのclone内でbuildしたclassifier、prompt generator、adapter、recorderだけを使う。判定対象は長さ付きJSON stringの非信頼データとしてprompt内へ埋め込み、成果物内の命令やMarkdown fenceをレビュー指示として扱わせない。AI subprocessは全adapter共通の空workspaceをcurrent directoryとし、空HOME・`env -i`・gh/git config無しで起動する。Claudeはtool無し、Codexはephemeral/ignore-user-config・shell env allowlist・caller HOME denyのread-only permissionを重ねる。target成果物は `git show <target_sha>:<path>` の標準出力を文字列化せずbyte列のままhashし、固定launcher構成ファイル一覧のblob digestを証跡へattestする。dirty・version不一致・由来不明の実行系は `human_required` とする。

### evidence envelope

PR review本文には次を保存する。

- schema version、Issue、gate、target SHA、profile
- reviewer run ID、slot、adapter、model、reasoning/capability、read-only
- attempt ID、profile由来期待件数、launcher version、trusted base SHA、launcher/token digest、ephemeral-clone/read-only実行attestation
- prompt digest、target SPECの全AC-IDに対する個別conformance・証跡、approved artifactsとdigest、verdict

GitHub APIのreview `id` / `user.login` / `commit_id` / `state` とPR/commit actorは本文外の正本である。CIはdismissed review、未登録recorder、実行attestation不一致、target SHA不一致を除外せずエラーとして扱う。PRまたはいずれかのcommitのauthor/committer loginがnull・未解決ならactor関係を推測せず `human_required` とする。branch内のgate reportやJSONは承認入力にしない。

### evidence verifier / aggregator

新しいCLI経路はPR・commit・Review API metadataを取得し、現在のtarget SHA用scaffoldへ結線する。

1. Issue/gate/profile/SHA、API `commit_id`、registered actorを検証する。
2. promptをtarget SHAから再生成しdigestを照合する。
3. `git show <sha>:<path>` のexact bytesで成果物digestを再計算する。
4. target SPECからAC-ID集合を再抽出し、各verdictの集合が重複なしの完全一致であること、各ACに非空証跡があること、aggregate conformanceがAC別判定から一意に導出される値と一致することを検証する。
5. 同じIssue/gate/profile/targetのv3証跡をattempt単位に分け、最大Review API IDを含むattemptだけをlatestとする。旧attemptは監査履歴として無視し、latest不完全時に旧completeへfallbackしない。
6. protected base SHA、launcher/token digest、ephemeral clone、credential-scrubbed read-only sandbox、`review-` run ID namespaceを検証し、同一attemptのrun ID/slotが重複しないことを確認する。Standardはslot 1を1件、Strictはslot 1・2を各1件要求する。
7. 全件pass/pass・全AC passかつblocking無しだけapproved、ACを含むfail/blockingはrejected、不足・不一致・判定不能はhuman_requiredとする。

同じlatest attempt内の複数候補やslot再投稿は曖昧性として拒否する。古いSHAの証跡を最新SHAへ継承しない。gate reportにはAPI review ID/actor、検証済みreviewer metadata、attempt ID・期待件数、slot順のAPI ID/actor/commit/evidenceから算出したcanonical evidence digestを残す。

### GitHub Actions

workflowは `pull_request_target` と `pull_request_review` を契機に、base revisionのcheckout/build、PR metadataとtarget Git objectの取得、evidence import、schema検査、publishだけを行う。provider secret、Codex Action、Claude/Codex CLI、self-hosted labelを含めず、PR head由来の実行可能ファイルを実行しない。証跡が未到着なら `human_required` reportを生成して `action_required` Check Runを発行する。workflow自体は証跡不足をクラッシュとして扱わず、検証器の異常はfail-closedで可視化する。

verified gate report全体をCheck Run `output.text`へ保存する。protected-base CLIはcurrent SHAの同一App候補を全conclusionから列挙し、最大Check Run IDを先に選び、そのlatestがsuccessの場合だけschema、approved状態、artifact digest、attempt/token provenanceを再検証してnoncanonicalなローカルcacheへ復元する。このApp一致は履歴選択の整合性条件であってsource trustの証明ではない。ローカルbackendは既存adapterがtrusted CLIを介して `reviews/<gate>.yaml` を生成するため、Review APIを要求しない。

bootstrap後の通常sourceを作れる最小recorderとして、default branchの `repository_dispatch` workflowを追加する。信頼入力はPR番号・gate・40桁target SHAだけで、actor権限・default base/current head・Issue/profile・latest v3 attempt・artifactをAPIから再取得する。workflow sourceとcheckoutは同じ `github.workflow_sha` へ固定し、queue中のmain更新による別revision実行を拒否する。`GITHUB_TOKEN`にChecks writeを与えず、main限定environmentのGitHub App ID/private keyから内部HTTPだけに使う短命installation tokenを生成する。専用Appのin-progress Check IDとworkflow run tupleを含むattestation envelopeを `actions/attest` の完全SHA固定actionで署名し、exact signer workflow/ref/digestとenvelope内容を再検証する。48KiB以内のcanonical reportだけをCheck outputへ保存し、successは全検査後の最後のPATCHに限定する。prepare後にattestation・verification・通常finalizeが失敗した場合も、同じAppが最後のPATCHで`action_required`へterminalizeし、in-progressを放置しない。

### 配布assetと既導入fixture migration

配布正本 `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml` とroot展開物を同時更新する。`init` のfixture検証では新規対象repositoryへ検証専用workflowを配る。

`upgrade` は全書込み前に、fixtureの展開済みgate workflowと、既に導入済みの配布templateを比較する。

- 同一ならmanaged assetとして両方を新workflowへ置換し、API credentialとCI内model起動を除去する。
- 不一致ならlocal customization競合としてupgrade全体を無変更で停止し、installed versionも進めない。
- 片方の欠落・読取不能もfail-closed。`--dry-run` は移行または競合だけを報告し書かない。

preflightは通常のmirror loopが旧templateを上書きする前に行う。安全なlegacy修復、競合時no-op、新規init、template sync、配布元と展開物にprovider secret/Codex Action/provider CLI/self-hosted runnerが0件であることを回帰検査する。このIssueが動的に検証するのはself-repositoryのworkflow実行とasset移行までであり、任意consumerのCLI解決はIssue #285へ分離する。

## DDD境界と依存方向

- Coordination Context: Issue、worker report、PR review、Check Run。GitHub/local間で同期しない。
- Review Execution Context: provider CLI、capability probe、read-only verdict。調整状態を書かない。
- Verification Context: API metadata・digest・件数を検証しgate reportへ集約。providerを呼ばない。
- Artifact Context: SPEC/DESIGN/PLAN/code/VALIDATION。reviewerと進行役は変更しない。

依存は `policy → execution → evidence → verification → gate` の一方向で、CIからexecutionへ逆流させない。

## schema・互換性・障害

- project-policy schemaへ任意のmodel-selection契約としてローカル実行・transport・CI責務・trusted actor・reviewer数を追加し、自己拡張manifestのpolicy versionを上げる。mainの既存v1 manifestにはmodel-selection自体がなく、この追加blockは任意なので既存manifestの必須migrationはない。block不在は従来の通常adapter選択、block存在時は全新フィールド必須とする。rollbackはblock除去で旧manifestへ戻せる。
- gate-report schemaへAC-ID別判定、検証済みreviewer metadata、review attempt provenanceを追加する。新規local scaffoldはAC別配列を生成する。schema version据置の互換境界として旧local reportは読めるが、GitHub Review由来reportはAC別配列とattempt provenanceなしでは拒否する。
- API/CLI/capability/分類/証跡検証の失敗はhuman_required。`neutral`や推測値を使わない。
- rollbackは新workflow/policy/CLIを同一commitで戻す。既存レビュー証跡はPR履歴として残るが旧実装は参照しない。

## trust-root bootstrap

導入PRはcandidate verifierやcandidate allowlistで自己承認しない。GitHubのrequired statusは同じGitHub Actions App内のworkflow/eventを区別できないため、App slug一致だけでI2を満たしたとは扱わない。PR #274はprotected base経路・固定SHA・独立レビューによる一回限りbootstrap対象だが、固定SHA内に最小専用App recorderを含める。merge後、Issue #283がruleset integration ID・chunk ledger・完全materialize/reconcile/rolloutを通常運用へ有効化する。それまでは通常PRを `human_required` に停止し、candidate code、branch内の自己申告証跡、同名Checkを承認根拠に使わない。

## ADR

ADR-0009を「CI内model実行」から「ローカル実行・外部証跡・base trust rootによるCI検証」へ改訂する。provider固有値をvendor-neutral能力へ写像し、未証明providerをfail-closedにする長期判断は維持する。

## 完了条件

全ACの単体・結合テスト、型検査、policy/schema/template sync、lint/SAST/secret scanを成功させる。独立検証は同一actorの正当な記録、credential非継承、default base、token無し直接submit、token再利用、same-SHA retry、latest attempt不足、canonical evidence digest、Check cache復元、未解決actor、偽造・古いSHA・upgrade競合を反証する。任意consumer可搬性を完了と主張せずIssue #285へ追跡し、base gateの停止は迂回せず#283依存として報告する。
