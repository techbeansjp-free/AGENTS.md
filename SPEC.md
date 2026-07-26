# SPEC: コア監査のローカル独立レビュー契約

- Issue: `ISSUE-271`
- 対象ブランチ: `process/271-core-audit-model-selection`

## 目的・背景

コア規約・状態遷移・ゲート・Coordination Backend・配布ルールの変更または監査には、最上位能力の独立レビューが必要である。ただし、AI レビューを GitHub Actions 内で実行すると model provider の API credential または self-hosted runner を要求し、利用者が既にローカルの Codex / Claude Code へログインしている実態と一致しない。

本変更では、進行役がローカルの adapter を通じて独立レビュアを起動する。legacy GitHub Actions は AI を実行せず、GitHub Review API に保存された構造化証跡の検証だけを行う。canonical Check は専用trusted recorderだけが扱い、Issue #283のtrusted rollout完了前はlegacy gate/reconcile workflowから発行しない。Codex では `gpt-5.6-sol` / `xhigh`、Claude Code では実行環境が検証した同等能力を要求する。Cursor は adapter と非対話 capability probe が未実装であるため利用可能と推測しない。

## 対象・用語・入出力

- 対象: GitHub/ローカル両 Coordination Backend の全 gate reviewer。コア変更では Strict を必須とする。
- ローカル独立レビュー: 成果物を書けないレビュアプロセスが、ローカル CLI の既存ログインを使って verdict を返すこと。
- 構造化証跡: Issue、gate、target SHA、prompt digest、adapter 能力、attempt ID・期待件数・reviewer run ID/slot、成果物 digest、protected-base launcher/token attestation、verdict を含む GitHub PR review。Review API actor はAIレビュア本人ではなく、writerからcredential分離した専用trusted recorder principalを表す。
- 入力: Issue ID、gate、profile、target SHA、変更差分、選択 adapter、reviewer/writer run ID。
- 出力: 検証済み gate report と Check Run、または `human_required` / `action_required`。
- 永続先: GitHub モードは PR review と Check Run、ローカルモードは `reviews/<gate>.yaml`。branch 内の自己申告証跡は GitHub モードの承認根拠にしない。

## 要求

- コア変更は manifest の root exact path / 包括path prefix、コア監査は GitHub の `review:core-audit` label またはローカル state の `core_audit` から機械分類し、Strict の独立 reviewer 2体を要求する。差分pathはNUL境界で列挙し、invalid UTF-8または正本入力を解決できなければ `human_required` とする。
- AI は進行役がローカル adapter へ委譲する。legacy CI は model provider を呼ばず証跡検証だけを行い、Checks書込み権限を持たない。
- reviewer は read-only、証跡の GitHub Review API 送信はprotected-baseのtrusted recorder、成果物変更は writer に限定する。
- provider 差異は vendor-neutral capability contract と capability probe で扱い、未実装 provider の能力を捏造しない。

## 受入条件

### AC-1: ローカル実行と CI 責務が分離される

- Given: GitHub モードで gate 対象 SHA が push される
- When: gate workflow が実行される
- Then: OpenAI/Anthropic API credential と self-hosted runner を要求せず、GitHub Review API の証跡検証だけを行う。legacy gate/reconcile workflowはcanonical Checkを発行せず、ローカルAI subprocessへGitHub token・gh/git credential設定を渡さない
- 検証方法: `automated`

### AC-2: コア能力契約を provider ごとに検証する

- Given: コア変更または `core_audit` をローカル reviewer が判定する
- When: adapter と capability probe を解決する
- Then: Codex は `gpt-5.6-sol` / `xhigh` / read-only、Claude Code は `frontier_coding` / `maximum_reasoning` / read-only の検証済み実在設定だけを許可し、ローカルStrictでは別workspaceの独立processを2回起動する。Cursor等の未登録 adapter は `human_required` になる
- 検証方法: `automated`

### AC-3: 古いSHA・改変証跡を拒否する

- Given: PR baseがrepository default branchでない、PR review 証跡の投稿者が登録済み専用trusted recorder principalでない、投稿者がPR/commit writerと同一、または target SHA、GitHub review の commit ID、prompt digest、成果物 digest のいずれかが現在の対象と異なる
- When: CI の trusted CLI が証跡を検証する
- Then: 承認を生成せず `action_required` とし、branch 内ファイルだけで証跡を代替できない
- 検証方法: `automated`

### AC-4: launcherを通らない実行とStrict attempt不足を拒否する

- Given: one-time launcher tokenが無い・再利用された、reviewer run IDが`review-`名前空間でない、同一attemptのrun ID/slotが重複する、protected-base隔離launcher・credential-scrubbed read-only sandbox・base SHA・launcher/token digestのattestationが一致しない、または最新Strict attemptのslot 1・2が揃わない
- When: trusted CLI が証跡を集約する
- Then: gate は approved にならず、1件でも origin付きblocking findingを伴うfailがあれば rejected、failなのに差し戻し先findingが無い場合と判定不能・不足は `human_required` になり、旧complete attemptへfallbackしない。新しいcomplete attemptが揃えば同一SHAの旧attemptは監査履歴として無視する
- 検証方法: `automated`

### AC-5: BDD追跡を保つ

- Given: 各 gate の構造化証跡が存在する
- When: verdict と成果物を集約する
- Then: conformance/falsification、全 AC-ID、finding origin、base...targetから確定した完全一致のapproved artifact集合とdomain分離digest、attempt ID・期待件数・canonical evidence digest が gate report と Check Run output に保存され、同一source候補の最新Checkがsuccessの場合だけcache復元でき、AC変更時は下流 gate が無効化される。GitHub Actions Appの一致だけをsource trustの証明にはしない
- 検証方法: `automated`

### AC-6: 通常作業とローカルbackendを維持する

- Given: 非コア作業またはローカル Coordination Backend である
- When: 明示選択された既存 adapter を起動する
- Then: 通常作業のモデル選択をコア固定値へ置換せず、ローカル backend は検証済み gate report を正本として従来どおり動作する
- 検証方法: `automated`

### AC-7: self-repositoryの正本と配布物が一致する

- Given: agent-skill-chain self-repositoryのpolicy、schema、adapter、workflow template、展開済みworkflow、または旧workflow assetを導入済みのfixtureが存在する
- When: init、upgrade、template sync、policy、adapter、回帰検査を行う
- Then: 配布assetからAPI key / Codex Action / CI内AI実行依存が除去され、旧templateと展開物が同期済みなら安全に移行し、不一致なら何も上書きせず競合として停止する。任意consumerでのCLI実行可搬性は完了扱いにしない
- 検証方法: `automated`

### AC-8: bootstrap後も再利用できる専用App recorderを含む

- Given: default branch限定environmentにChecks専用GitHub AppのID・private keyが構成され、write以上のrecorderがPR番号・gate・current target SHAだけをdispatchする
- When: default branch固定workflowがAPI正本からcontextとv3 evidenceを再検証する
- Then: `GITHUB_TOKEN`はactions readとattestation発行だけを担い、専用Appでin-progress Checkを作る。Check ID・workflow run tuple・report digestを束縛したenvelopeをGitHub artifact attestationで署名・再検証し、状態書込み前の失敗もcurrent runのApp CheckをAPI回収して、全postcondition後の最後のAPI更新だけでsuccess/failure/action_requiredへ確定する。標準Actions App、App未構成、48KiB超report、stale/replayは成功にせず、terminal PATCH後の不要なresponse parseも行わない
- 検証方法: `automated`

## 制約・完了条件

- I2/I5/I7/I8、1 Issue = 1 branch = 1 worktree = 1 PR、writer lease、4 checkpoint を維持する。
- GitHub review の author/id/commit_id とPR/commitのwriter actorはAPI応答を正本とする。review authorは保護されたbase revisionのmanifestにある `trusted_reviewer_actors` に一致し、PR authorと全commit author/committerのいずれとも異なる専用principalでなければならない。gate reportは`distinct_from_writer`だけを許可する。
- trusted recorder は、専用principalの短命GitHub tokenで自身のAPI identityを再取得し、GitHub PRのdefault base/headと全writer actorの照合、ephemeral clone、remote除去、保護base sourceからのbuild、GitHub credentialを除いたAI環境、one-time attempt token、`review-` run ID/slot、launcher/prompt/artifact digestとverdictの対応をGitHub reviewでattestする。専用token未設定・未登録actor・writerと同一・attestation不一致・branch 内ファイルによる代替は信頼しない。
- reviewer・writer・recorderのcapabilityはrole contractで分離し、workerとreviewerにReview API投稿能力を与えない。Review API投稿は調整状態を扱う進行役だけが行う。
- classifier、policy、schema、verifier、workflowは保護されたbase revisionをtrust rootとして実行し、PRが変更した検証コードやactor allowlistを当該PR自身の承認には使わない。
- GitHubのrequired statusは同一GitHub Actions App内のworkflowを識別しないため、#274は一回限りbootstrapに必要な最小専用App recorderも同梱する。legacy gate workflowから`checks: write`・Check API・publishを、reconcile workflowから`checks: write`・candidate script実行を除去する。rulesetへのintegration ID適用・chunk化・完全なreconcile/rolloutはIssue #283が担い、それらが有効になるまで通常PRを成功扱いにしない。
- 証跡未到着・分類不能・capability 未証明・件数不足は成功や `neutral` にしない。
- 全 AC の自動テスト、型検査、lint、SAST、依存関係・secret scan、template sync を実行して push する。

## 対象外・未決事項

- API key、self-hosted runner、CI 内 model inference の導入。
- Cursor adapter/CLI の推測実装。将来は同じ capability contract と probe を満たす別 Issue で追加する。
- Node build構造を持たない、またはagent-skill-chain CLIを同じ配置に持たない任意consumerでのgate workflow実行可搬性。Issue #285でCLI解決境界とfixtureを実装する。
- model 出力そのものの暗号学的証明。偽造耐性はbase trust root、writer credentialから分離した専用recorder principal、GitHub API metadata、実行attestation、digest再計算で担保する。専用recorder credentialを保持する管理主体自体はtrust rootである。
- 未決事項はない。
