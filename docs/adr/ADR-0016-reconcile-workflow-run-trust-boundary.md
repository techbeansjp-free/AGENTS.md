# ADR

```yaml
id: ADR-0016
status: proposed
title: reconcileのpush自己参照信頼境界をpull_request_target方式で解消する
tags: [security, ci, trust-boundary, github-actions, gate]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`agent-skill-chain / reconcile`（`.github/workflows/agent-skill-chain-reconcile.yml`）は`on: push`（`branches-ignore: [main, 'chore/root-cleanup-*']`）で起動し、`permissions: checks: write`を持つ。GitHub Actionsの仕様上、`push`トリガーで実行されるワークフローは、ワークフローYAMLファイル自体を「pushされたコミット」から読み込む。実行時の判定ロジック（agent-skill-chain CLIのビルド元ソース、`gate reconcile`サブコマンドの実装）も同じチェックアウトから`npm ci && npm run build`されるため、pushされたブランチの内容から読み込まれる。

このため、正規のセグメントワーカーを含むwriter権限保有者が、自分のissueブランチへpushする際にワークフローYAML自体または判定ロジックのソースを改変するだけで、`GITHUB_TOKEN`の`checks: write`権限を用いて`agent-skill-chain/{spec,design,implementation,validation}-gate`のいずれかのCheck Runを、実際のレビュー証跡なしに成功として発行できてしまう。これはAGENTS.md I2（セグメントゲート）・I5（進行役の純粋性）が前提とする「ゲート成功はGitHub Check Runの正規発行元（専用App/Workflow）に限定され、成果物内容の改変では偽造できない」という信頼モデルを無効化する（ISSUE-342）。

同リポジトリの`.github/workflows/agent-skill-chain-gate.yml`は既に対照的な安全なパターンを実装している。`pull_request_target`で起動するためワークフローYAML自体は常にPRのbaseブランチ（trusted。マージ後は常に最新のdefaultブランチ）から読まれ、`actions/checkout@v7`は保護されたbaseのSHAを明示指定し、PR headは`git fetch`によるread-onlyなgit objectとしてのみ取得し実行しない。

design-gateの前ラウンドでは本問題を`workflow_run`によるtrigger/trusted 2ファイル分離（`on: push`・無権限の新規`agent-skill-chain-reconcile-trigger.yml`を起点に、`agent-skill-chain-reconcile.yml`を`workflow_run`化する）で解消しようとしたが、strictレビューにより根本的な欠陥が発見された（`reconcile-trigger-workflow-remains-self-referential-push-yaml`）。`agent-skill-chain-reconcile-trigger.yml`自体が`on: push`トリガーのままである以上、GitHub Actionsの仕様上そのワークフローYAML自体（`permissions:`ブロックを含む）は攻撃者が完全に制御するpushされたコミットから読み込まれる。したがって攻撃者はtrigger workflow自身の`permissions: {}`を`checks: write`へ書き換え、Checks APIを呼ぶstepを追加するだけで、trusted workflow（`agent-skill-chain-reconcile.yml`）を一切経由せずCheck Runを偽造できてしまう。「trigger workflowは特権を持たないため攻撃者に利益が無い」という当時の前提は、trigger.yml自身が攻撃者の完全な制御下にあるpush内容から読まれる以上、成立しない。`workflow_run`によるtrusted/untrusted分離は、GITHUB_TOKEN権限がプラットフォームにより自動的に読み取り専用へ制限されるfork由来のpull_request系イベントに対してのみ有効な緩和策であり、同一リポジトリ内のpush（fork不要）には同種の自動制限が働かない。

判定ロジック自体の自己参照（上記）とは独立に、もう一段の信頼境界問題がある。`gate reconcile`（`src/commands/gate.ts`の`reconcile()`）は、承認済み成果物digestとの照合対象となる「承認済み基準」（`approved_artifacts`）を、`issues/<id>/.agent-skill-chain/reviews/<gate>.yaml`（`reviewFilePath`が指す、issueブランチへコミット可能なファイル）から読み込んでいる。判定ロジック自体を保護しても、writerが成果物本体（例: `SPEC.md`）と、このレビュー証跡ファイル内の承認済みdigestとを同一push内で揃えて書き換えれば、正しい判定ロジックのもとでも「変化なし」と誤判定させ、実際のレビュー証跡なしに成功を再発行させられる（ISSUE-342 spec-gate再レビュー指摘 `reconcile-trusts-branch-committed-approval-data`）。加えて、reconcileが判定対象とするSHA・issue_id自体の識別子入力元がpushされたブランチ内容物（`github.ref_name`・`github.sha`はpushされたコミットのメタデータであり広義にはwriterが作り出す値）に依存したままだと、判定ロジック・承認済み基準の両方を保護しても、対象そのものを差し替えることで保護を迂回できてしまう（同spec-gate指摘 `reconcile-target-identifier-provenance-unspecified`）。本ADRはこの3点（判定ロジック自体・承認済み基準データ自体・判定対象識別子自体）をまとめて同一の信頼境界問題として扱う。

検討した代替案:

- **`workflow_run`によるtrigger/trusted分離**: GitHub Actions公式に推奨される、fork由来PRに対する`pull_request_target`と同型のパターンを、同一リポジトリ内push（fork不要）にも適用する案。`on: push`・無権限の新規`agent-skill-chain-reconcile-trigger.yml`を起点に、`agent-skill-chain-reconcile.yml`を`workflow_run`化する構成を前ラウンドで一度採用したが、strictレビューによりtrigger workflow自体が`on: push`のままYAML自体を自身のブランチから読み込む（GitHub Actionsの仕様）ため、攻撃者がtrigger.yml自身の`permissions:`ブロックを書き換えて`checks: write`を追加し、trusted workflowを経由せずCheck Runを直接偽造できることが判明した（`reconcile-trigger-workflow-remains-self-referential-push-yaml`）。`workflow_run`分離はfork由来pull_request系イベントに対する自動権限制限を前提とした緩和策であり、同一リポジトリ内pushには適用できない誤った類推だったため不採用。
- **`pull_request_target`への一本化**: 当初はissue-start直後のSPECワーカー初回pushがDraft PR作成前に発生し、reconcileが常にPRコンテキストを前提にできないため既存の正規フロー（AC-2）を壊すと考え不採用としたが、再検討の結果この懸念は成立しないと判断した。Draft PR作成前の最初のpush時点では承認済みCheck Runがまだ1件も存在せず、reconcileが照合すべき「承認済み基準」自体が存在しないため、その時点でreconcileが起動しないことは機能的なギャップにならない。SPEC.mdのAC-2 Givenも「PRのheadブランチへ…push」を前提としており、`pull_request_target: types: [synchronize]`の発火条件（PRが既に存在し、そのheadブランチへ新規pushがあること）と正確に一致する。加えて`pull_request_target`は`workflow_run`分離が抱えていたtrigger workflow自体の自己参照問題を、trigger.ymlという別ファイルを作らないため構造的に持たない。採用。
- **`push`のまま`persist-credentials: false`等でcredentialだけ絞る**: ワークフローYAML自体・CLIソースが依然としてpushされた内容から読まれる事実は変わらず、根本原因（自己参照）を解消しない。不採用。
- **ADR-0013（`docs/adr/ADR-0013-trusted-gate-check-materialization.md`、`status: proposed`）が提案する専用GitHub App／Required Workflowへの全面移行**: 未承認かつスコープが本Issueより大幅に広い（enforcement backend全体の刷新）。本Issueはpushトリガーのワークフロー自己参照という個別の脆弱性解消に限定するため不採用（ADR-0013と本ADRは独立しており、将来ADR-0013が採用されても本ADRの決定と矛盾しない）。

承認済み基準データ自体の保護（`reviewFilePath`問題）について検討した代替案:

- **`issues/<id>/.agent-skill-chain/reviews/<gate>.yaml`をGitHubモードでも唯一の正本のまま維持し、書込みをbranch protection等で制限する**: issueブランチ自体がwriter権限者にとって書込み自由なブランチであることが前提（AGENTS.md I4「1 Issue = 1 ブランチ」でありbranch protectionの対象は通常default branchのみ）のため、branch protectionでこのファイルだけを保護する仕組みはAGENTS.mdのブランチモデルと整合しない。不採用。
- **`reviewFilePath`を廃止し、GitHub Check Run発行履歴のみを承認済み基準の正本とする（GitHubモード限定）**: `publishCheckRun`が発行時に`output.text`へ`canonicalJson(GateReport)`（`approved_artifacts`を含む）を既に埋め込んでいるため、追加のデータ構造を新設せずCheck Run履歴から`approved_artifacts`を再構築できる。`reviewFilePath`自体はローカルモードの正本・ワーカー向けスキャフォールドとして無変更のまま残し、GitHubモードの`reconcile()`だけが参照元を切り替える（ローカルモードにはCheck Runという概念自体が無く、AGENTS.mdの二重正本禁止（I6）にも抵触しない）。採用。ただし単純にCheck Runの`check_name`一致・`conclusion=success`のみで採用可否を判定すると、writer権限保有者が自分のissueブランチへ`checks: write`権限を持つ全く新規のuntrustedワークフローファイル（例: `evil.yml`。`agent-skill-chain-reconcile.yml`自体の改変ではなく無関係な新規ファイルの追加であり、AC-1のtrigger/trusted分離が想定しない別経路）をpushするだけで、同名の偽Check Run（改ざんした`approved_artifacts`を含む）を発行し「承認済み基準」として採用させられてしまう（strictレビュア2名が独立に指摘、`resolve-approved-baseline-no-source-identity-check`）。`check_run.app.slug`が`github-actions`であることの確認だけでは、defaultの`GITHUB_TOKEN`を使う限り攻撃者の新規ワークフローも同一App identityでCheck Runを発行できるため区別にならない（AGENTS.md「ゲートの継承・無効化」節が明示的に禁じる、App IDのみをsource trustの証明とする構成）。そこで採用にあたり、候補Check Runの`check_suite.id`から`GET actions/runs?check_suite_id=`で対応するworkflow runを特定し、その`path`（発行元ワークフロー定義ファイルのリポジトリ内パス、GitHub管理の権威あるメタデータ）が既知のtrusted workflowファイルパス（`agent-skill-chain-gate.yml`・`agent-skill-chain-reconcile.yml`）と一致することを追加検証する（source identity検証）。実際にこのリポジトリの既存Check Run・workflow runに対し`gh api repos/{owner}/{repo}/actions/runs?head_sha={sha}`を試行し、応答に`path`フィールド（例: `.github/workflows/agent-skill-chain-reconcile.yml`）と`check_suite_id`（Check Run側の`check_suite.id`と突合可能）が実在することを確認済み。
- **ADR-0013が提案する専用GitHub App／Required Workflowによる検証済みgate report materializationへ全面移行**: 未承認かつ本Issueより大幅にスコープが広い。本ADRの決定はADR-0013を前提とせず独立して成立する。不採用（本Issueのスコープでは）。

## Decision

`agent-skill-chain / reconcile`（`.github/workflows/agent-skill-chain-reconcile.yml`）を、新規ファイルを追加せず1ファイルのまま`pull_request_target`方式へ作り直す。

1. `agent-skill-chain-reconcile.yml`（既存ファイルを変更、trusted）: `on: pull_request_target: types: [synchronize]`で起動する。`pull_request_target`により本ファイル自体のYAML定義・`npm ci && npm run build`されるCLIソースは常にPRのbaseブランチ（trusted。マージ後は常に最新のdefaultブランチ）から読み込まれる。ジョブに`if: github.event.pull_request.base.ref == github.event.repository.default_branch`を追加し（`gate.yml`と同型）、baseブランチをcheckoutしてtrust rootとする（`ref: github.event.pull_request.base.sha`、`persist-credentials: false`）。PR headのSHAは`git fetch`で`refs/agent-skill-chain/targets/<sha>`へread-onlyなgit objectとして取得するのみで、checkoutやビルド対象には含めない（`gate.yml`と同一パターン）。既存の`gate-reconcile.sh`・`gate reconcile`サブコマンド（`artifactDigestAtSha`が`git show <sha>:<path>`によるread-only参照として実装済み）はこの構成にそのまま整合するため無変更とする。issue_id抽出・dependabotの3分岐許可判定ロジックの意図は維持し、参照元イベントフィールドのみ`github.ref_name`/`github.sha`から`github.event.pull_request.head.ref`/`github.event.pull_request.head.sha`へ置き換える（いずれもGitHubが提供するイベントメタデータであり、pushされたファイル内容ではない）。`pull_request_target`イベントは常にPRコンテキストを伴うため、dependabot判定は`github.event.pull_request.user.login`を直接参照でき、`push`イベント時代に必要だった`gh api ... pulls?head=...`によるPR特定・作成者照会は不要になる。

本ファイルはリポジトリ実体（`.github/workflows/`）と配布テンプレート正本（`.agent-skill-chain/templates/github/.github/workflows/`）の両方に同一内容で配置する。新規ファイルを追加しないため、同期対象は本Issue着手前と同じ単一ファイルのままである。

2. `resolveApprovedBaseline`（新規、`src/commands/gate.ts`の`reconcile()`内部）: GitHubモード（`config.coordination.backend === 'github'`）でのみ、承認済み基準（`approved_artifacts`）を`reviewFilePath`（issueブランチ上でwriterが改変可能なコミット済みファイル）からではなく、GitHub Check Run発行履歴から復元する。`pull_request_target`化により`pr_number`が`github.event.pull_request.number`としてワークフロー実行時に直接判明するため、`gate-reconcile.sh`の新設第3引数として渡す。手順は、(a) `pr_number`が渡されていれば`GET pulls/{pr_number}/commits`を直接呼び出し対象PRのコミット列を取得する（渡されない場合のみ`GET commits/{target_sha}/pulls`でPRを特定するフォールバックを行う）、(b) target_shaより前のコミットを新しい順に`GET commits/{sha}/check-runs?check_name=<gateのCheck Run名>`で照会し`conclusion=success`な候補を新しい順に走査、(c) 各候補について`GET actions/runs?check_suite_id=<候補の`check_suite.id`>&head_sha=<候補コミットのSHA>`を照会し、応答`workflow_runs[].path`（そのCheck Runを発行したworkflow定義ファイルのリポジトリ内パス。GitHubがワークフロー実行時に記録する権威あるメタデータであり、実行ソースがbaseブランチ・PR headいずれの内容であってもファイル自身の実際のパスとしてしか報告されないため偽装できない）が既知のtrusted workflowファイルパス（`.github/workflows/agent-skill-chain-gate.yml`・`.github/workflows/agent-skill-chain-reconcile.yml`）のいずれかと一致すること、かつ同応答`workflow_runs[].event`（当該workflow runを実際に起動したイベント種別、同じくGitHub記録の偽装不能なメタデータ）が、一致したpathに対応する正規イベント種別集合（trusted workflowファイルパスごとに異なる。`agent-skill-chain-reconcile.yml`は`pull_request_target`のみ、`agent-skill-chain-gate.yml`は`pull_request_target`・`pull_request_review`の両方——同ファイルの`verify-and-publish`ジョブはtrusted recorderがGitHub PR Review APIへreview evidenceを投稿・編集・却下した際（`pull_request_review`イベント）にもCheck Runを発行する正規経路であり、単一固定値`pull_request_target`のみとの一致要求ではこの正規発行分を誤って棄却してしまうため、ファイルごとの集合との一致要求へ改めた）に含まれることの両方を検証する（source identity検証）。いずれか一方でも一致しない候補は棄却し次候補を試す。path不一致の候補は`checks: write`権限を持つ攻撃者の新規untrustedワークフローファイルが同名で偽装発行したCheck Runであり、path一致だがevent不一致（典型的には`push`）の候補は、本ADRのマージ前から存在しmainを未取込のissueブランチにファイル名として同一のまま残存する旧`on: push`版`agent-skill-chain-reconcile.yml`（自己参照構成のまま）が発行した偽装Check Runである（後述「Consequences」の移行ギャップに関する記述を参照）。検証を通った最新候補の`output.text`から`approved_artifacts`を復元する。対応PR無し・過去のsuccess Check Run無し・trusted pathと一致する候補が1件も無いという0件応答は当該ゲートの照合スキップ（既存の未レビュー時`continue`と同型、I8の安全側）とし、API呼び出し自体の失敗（0件応答ではない）はreconcileコマンド全体を失敗させ両者を区別する。ローカルモードの`reconcile()`・`reviewFilePath`書込み処理（`gate publish`/`gate review`/`gate record-verdict`）自体は無変更。

## Consequences

- reconcileは1回のPR headへのpush（synchronize）につき1回のワークフロー実行のみで済む。`workflow_run`分離案が要した「untrusted trigger + trusted follow-up」の2回実行は不要になる。
- `pull_request_target`版`agent-skill-chain-reconcile.yml`自体は、本修正のマージ後は、マージ前から存在する進行中のPR（既存issueブランチ）であっても、次のsynchronizeイベントから正しくtrustedな構成（baseブランチ由来のYAML・CLIソース）で起動する。しかしGitHub Actionsの`on: push`トリガーは常にpushされたブランチ自身に存在するワークフロー定義を読む仕様であるため、本修正のマージ前から存在しmainを未取込のissueブランチは、そのブランチ内に旧`on: push`版`agent-skill-chain-reconcile.yml`（自己参照構成のまま）をファイル名として同一のまま保持し続け、そのブランチへの通常pushは`pull_request_target`版の起動とは独立に旧版ワークフローも同時に発火させる。したがって「マージ前から存在するブランチは新しいmain内容を取り込むまで旧構成が残存する」という移行ギャップは、本設計単独では構造的に解消されない。この残存ギャップに対し、本ADRは (1) `resolveApprovedBaseline`のsource identity検証をpath一致に加えてevent一致（一致したpathに対応する正規イベント種別集合との一致。`agent-skill-chain-reconcile.yml`の正規集合は`pull_request_target`のみ）も要求する技術的防御（旧版ワークフローが発行する偽装Check Runの`event`は`push`であり、いずれのファイルパスの正規集合にも含まれないため確実に棄却される。承認済み基準の信頼汚染を防ぐ、I8の安全側）と、(2) 本修正のマージ後に進行役が既存の開いている全issueブランチのmain取込みを確認する運用上の必須手順（`PLAN.md`変更単位#7）の二段構えで対応する。(1)は信頼汚染を防ぐが、旧版ワークフロー自体が実行され得る状態そのものは(2)の完了まで残る。
- Draft PR作成前（issue-start直後のSPECワーカー最初のpush）は`pull_request_target: synchronize`が発火せずreconcileは起動しない。この時点では承認済みCheck Runがまだ1件も存在せず照合対象自体が無いため、機能的なギャップにはならない（SPEC.mdのAC-2 Givenも「PRのheadブランチへ…push」を前提としており整合する）。
- dependabot分岐の判定は`github.event.pull_request.user.login`を直接参照するため、`push`イベント時代に必要だった`gh api ... pulls?head=...`によるAPI照会が不要になる（`pull_request_target`イベントは常にPRコンテキストを伴うため）。
- PRのbaseブランチがdefaultブランチ以外へretargetされた場合、ジョブの`if`条件によりreconcileは起動しない（fail-safe、Check Run偽造の方向には倒れない）。
- `test/unit/dependabot-ci-skip.test.ts`はワークフローYAML構造を直接パースして固定化しているため、`on:`変更・参照フィールド変更に追随させる更新が実装セグメントで必要になる（詳細は`PLAN.md`）。`test/unit/dependabot-ci-skip-exec.test.ts`は`ctx`ステップの`run`本文をenv直接注入で実行検証する方式のため、新規env名（`PR_AUTHOR`）への追随のみで済む。
- 本ADRはADR-0013（専用GitHub App／Required Workflowによるenforcement backend全体の刷新、未承認）を採用・前提としない。`GITHUB_TOKEN`＋Check Runという既存のcredential/backendモデルは本Issueのスコープ外として維持される。default branchへの直接書き込み（branch protectionにより人間の承認を要する）を最終的な信頼の起点とする点も従来通り変わらない。
- （design-gate指摘`new-arbitrary-workflow-file-bypasses-fix`/`source-identity-event-check-does-not-prevent-direct-forgery-on-unmigrated-branches`対応、既知の残存ギャップ）本ADRが解消するのはreconcile自身の判定ロジックの自己参照（Decision 1.）と承認済み基準データ自体の改ざん耐性（Decision 2., `resolveApprovedBaseline`のsource identity検証）に限られる。攻撃者が`agent-skill-chain-reconcile.yml`・`agent-skill-chain-gate.yml`のいずれとも無関係な全く新規のワークフローファイル（`checks: write`を自身のYAML内で明示宣言）を自分のissueブランチへ追加してpushした場合、そのワークフローはpush内容のまま実行され、GitHub Checks APIを直接呼び出して`agent-skill-chain/{spec,design,implementation,validation}-gate`と同名のCheck Runを偽造できる。本リポジトリに適用済みのGitHub native ruleset（`gh api repos/{owner}/{repo}/rulesets/19276510`で確認）の`required_status_checks`は`context`のみを指定し`integration_id`（発行元App限定）を含まないため、標準`GITHUB_TOKEN`（全workflow共有の単一App ID）で発行された当該偽Check Runはマージ可否判定（required status check）を実際に満たしてしまう。`resolveApprovedBaseline`のsource identity検証は`reconcile()`内部が「何を承認済み基準として信頼するか」を保護するのみであり、GitHub native required status checkがどのCheck Runを合格と見なすかには関与しないため、この経路を防がない。この経路の技術的な完全解消はCheck Run発行主体をrulesetの`integration_id`で専用GitHub Appへ限定することを要し、これはADR-0013の`dedicated_app`/`required_workflow`enforcement backendの役割である。対応する実装（`src/lib/trust-backend.ts`の`resolveDedicatedAppBackend`、`src/commands/setup.ts`の`renderRulesetWithDedicatedApp`、`.github/workflows/agent-skill-chain-trusted-gate.yml`）は既にコードベースに存在するが、専用GitHub Appの作成・installationおよび本リポジトリrulesetへの`integration_id`反映（`agent-skill-chain setup ruleset`の再実行）という運用手続きが未実施であり、いずれも本ADRが変更する範囲外である。この境界は本Issueが新たに生む欠陥ではなく、参照実装とする`agent-skill-chain-gate.yml`自身も本Issue以前から同一の限界を持つ（詳細な実測根拠は`DESIGN.md`「本設計のスコープ境界」節）。
- （design-gate指摘`check-run-output-mutable-via-same-app-patch-poisons-approved-baseline`対応、既知の残存ギャップ）`resolveApprovedBaseline`のsource identity検証（`workflow_runs[].path`・`.event`照合）が保護するのは「新規のCheck Run発行によるsource偽装」のみであり、「既に発行され承認済みとなっているCheck Runの`output.text`を、発行後に同一App identity（標準`GITHUB_TOKEN`、`app.slug: github-actions`）を持つ別の新規ワークフローファイルからChecks APIのPATCH（Update a check run、`checks: write`）で直接書き換える」経路は防がない。PATCHはcheck_suite・その発行元workflow run（`path`・`event`）との関連付けを変更しないため、source identity検証は書き換え後も通過し、`resolveApprovedBaseline`は改ざん済みの`approved_artifacts`をそのまま「承認済み基準」として復元してしまう。この経路の技術的な完全解消は、上記`new-arbitrary-workflow-file-bypasses-fix`の残存ギャップと同様、Check Run発行・更新主体をrulesetの`integration_id`で専用GitHub Appへ限定するADR-0013のenforcement backendを要し、本ADRのスコープでは解消しない。したがって本ADRの`resolveApprovedBaseline`は、ゲート合否の完全な偽造耐性を単独で保証する仕組みではなく、pushトリガーのYAML自己参照という当初の脆弱性（AC-1〜AC-4）を閉じる多層防御の一つとして位置づける。本Issueが実際に運用されている実態に即して言えば、ゲート合否判断の実効的な信頼源は、GitHub Actions内のCheck Run発行そのものではなく、進行役がwriter権限とは分離された別のcredential（trusted recorder）を用いてGitHub PR Review APIへ投稿するreview evidenceである（詳細な根拠・SPEC.mdとの対応は`DESIGN.md`「Check Run発行履歴を信頼源とすることの限界」節、`SPEC.md`「未決事項」節`check-run-output-patch-poisoning-gap`参照）。
- `resolveApprovedBaseline`は1回のreconcile実行あたりGitHub APIへの追加呼び出し（PRコミット列取得・ゲート数分のCheck Run照会・採用候補ごとのsource identity検証用`actions/runs`照会）を要する。`pr_number`が直接渡されるため`workflow_run`案にあった「PR特定」ステップは主経路では不要になり、呼び出し回数はやや減少する。呼び出し回数はPRのコミット数・ゲート数・偽装候補を棄却して次候補を試す回数に比例して増えうるが、1 Issue = 1 PRのスコープ内に留まり、GitHub APIのレート制限内で収まる規模である。
- source identity検証により、`resolveApprovedBaseline`が信頼する情報源は「`checks: write`権限を持つ何らかのワークフロー」ではなく「trusted workflowファイルパス（`agent-skill-chain-gate.yml`・`agent-skill-chain-reconcile.yml`）から発行されたCheck Run」に限定される。将来これら以外のワークフローファイルが正規にgateのCheck Runを発行するようになった場合（例: 新しいgate関連ワークフローの追加）は、`resolveApprovedBaseline`のtrusted pathリストを同一PR内で更新しなければ、その正規発行分のCheck Runが承認済み基準として採用されず「承認済み基準なし」（安全側のスキップ）に倒れる。Check Run偽造の再発ではなくreconcile機能の一部低下として顕在化する。
- `reviewFilePath`（`issues/<id>/.agent-skill-chain/reviews/<gate>.yaml`）はローカルモードの正本・GitHubモードでのワーカー向けスキャフォールド（`gate review`/`gate publish`/`gate record-verdict`の書込み先）として引き続き存在し続ける。GitHubモードの`reconcile()`だけが承認済み基準の参照元をこのファイルからCheck Run発行履歴へ切り替える非対称な構成になる点に留意する（二重正本ではなく、GitHubモードでは同ファイルはreconcileの承認済み基準としては信頼されなくなる、という設計上の非対称性）。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。

## ライフサイクル

```text
DESIGNワーカー   → ADR を proposed で作成
設計レビュア     → ADR 本文をレビュー（read-only）→ content digest を承認
進行役           → adr-finalize.sh を起動
ADR finalization → writer lease を取得 → status を accepted へ更新
ワーカー           → commit・push → content digest を再検査
```

- `proposed → accepted`: 設計ゲート承認時に遷移する。設計レビュアは ADR 本文をレビューし content digest を承認するのみ（read-only、直接 status を書き換えない）。進行役が `.agent-skill-chain/scripts/adr-finalize.sh` を起動し、専任の ADR finalization ワーカーが writer lease を取得したうえで `status` のみを `accepted` に更新して commit・push する（`.agent-skill-chain/config/roles.yaml` の `adr_finalization_worker`、`scope: adr_status_only`）。finalization ワーカーは書込み前に content digest を再検査する。
- `accepted → superseded`: 新しい ADR を含む同一 PR 内で、新 ADR の作者（ワーカー）が旧 ADR の `status` / `superseded-by` を同一 PR で更新する。`supersedes` ⇔ `superseded-by` の対称性・参照先の実在が機械検査される。
- `accepted → deprecated`: 前提が消滅し後継が無い場合に遷移する。`deprecated-reason` に1行の理由を記録する（存在検査あり）。

## related_adrs 参照ルール

他 Issue の `DESIGN.md` から本 ADR を参照する場合は `related_adrs:` フィールド（構造化リスト）を用いる。stale 参照検査（`adr-lint.sh check`）はこのフィールドのみを対象とし、`accepted` の ADR のみ参照可能とする。本文中の自然文による歴史的言及（例: 「本決定は ADR-0007 を置き換える」）は検査対象外であり許可される。
