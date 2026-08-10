# SPEC: gate publishのCheck Run発行がGitHub Appトークン無しでは不可能で、配布rulesetの必須化と相まって標準導入経路のPRが恒久的にマージ不能になりうる

- Issue: `ISSUE-593`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/593-gate-publish-ruleset-drift`

## 目的・背景

`gate publish` が発行する Check Run（`agent-skill-chain/{spec,design,implementation,validation}-gate`）は、個人アカウント認証（PAT・個人OAuthトークン）では GitHub Checks API の仕様制約により常に失敗する。加えて配布テンプレート `.agent-skill-chain/templates/github/provisioning/rulesets/main.json` の `required_status_checks` は、この4つのCheck Runを必須ステータスとして要求したままである。

このリポジトリ自身に現在適用中の branch ruleset（GitHub API経由の実体、id=19276510）は既に `verify` のみを必須としており、4つのgateチェックは含まれていない。しかし配布テンプレートファイル側にはこの是正が反映されておらず、実体と配布物が乖離（drift）している。この結果、`init` → `setup github` という標準導入経路をそのまま辿った consumer プロジェクトでは、**誰も発行できない Check Run が必須ステータスとして設定され、admin bypass 権限を持たない利用者は通常の PR を恒久的にマージできなくなる**。

さらに `gate publish` の実装は、Check Run 発行（`publishCheckRun()`）が失敗すると、成果物内容を Issue/PR 本文へ転記する `syncGateArtifacts()` の呼び出しに到達せずに処理を打ち切る。`syncGateArtifacts()` 自体は Check Run 発行の成否に依存しない独立した処理であるにもかかわらず、Check Run 発行失敗のたびに道連れで実行されなくなっており、`issue_sync`（Issue/PR本文への成果物転記機構）が実質的に機能しない状態を生んでいる。

本 Issue は、(a) 配布テンプレートの ruleset drift を是正し、(b) `gate publish` 内で Check Run 発行の失敗と成果物転記の実行可否を分離し、(c) `gate publish` の現状の運用制約（Check Run 発行元workflowが存在せず、rulesetのrequired statusにも寄与しない、進行役が任意実行する記録専用ツールであること）を文書化することで、標準導入経路のPRマージ不能問題と issue_sync 不動作問題を解消する。

## 要求 → 要件 → 受入条件

### 要求

新規・既存を問わず consumer プロジェクトが標準導入手順（`init` → `setup github`）を実行したとき、`gate publish` を一度も成功させられない状態であっても、通常のPRが恒久的にマージ不能になってはならない。また `gate publish` を実行した際、Check Run 発行に失敗しても、Issue/PR 本文への成果物転記（`issue_sync`）は独立して試行されなければならない。

### 要件

- 配布テンプレート `.agent-skill-chain/templates/github/provisioning/rulesets/main.json` の `required_status_checks` は、このリポジトリ自身の現在適用中 ruleset の内容（`verify` のみを必須とする）と一致していなければならない。
- `gate publish` は、`publishCheckRun()` が失敗した場合でも `syncGateArtifacts()` を独立して試行しなければならない。
- `gate publish` の現状の運用制約（Check Run を発行可能な CI workflow がこのリポジトリにも配布テンプレートにも存在しないこと、rulesetのrequired statusに現状寄与しないこと、進行役が任意実行する記録専用ツールであること）が、利用者が到達可能などこかの文書に記載されていなければならない。
- 配布テンプレートを更新した後も、`setup ruleset` がテンプレートJSONの内容をそのまま用いて ruleset を適用する既存の同期経路が維持されていなければならない。

### 受入条件（Acceptance Criteria）

#### AC-1: 配布テンプレートのrequired status checksから発行不能な4つのgateチェックを除去する

- Given: 配布テンプレート `.agent-skill-chain/templates/github/provisioning/rulesets/main.json` の `required_status_checks.required_status_checks` に `agent-skill-chain/spec-gate`・`agent-skill-chain/design-gate`・`agent-skill-chain/implementation-gate`・`agent-skill-chain/validation-gate`・`verify` の5件が含まれている状態
- When: 本Issueの変更を適用する
- Then: `required_status_checks.required_status_checks` は `verify` の1件のみとなり、このリポジトリの現在適用中 ruleset（`GET /repos/{owner}/{repo}/rulesets/19276510` で取得できる内容）の `required_status_checks` と一致する
- 検証方法見込み: `automated`

#### AC-2: 標準導入手順を辿ったconsumerプロジェクトで、gate publishが一度も成功しなくても通常のPRがマージ可能である

- Given: consumer プロジェクトが `init` → `setup github` を実行し、AC-1適用後の配布テンプレートから ruleset が適用された状態
- When: 個人アカウント認証のまま `gate publish` を一度も成功させずに、`verify` を含む必須ステータスチェックが全て成功した通常のPRを作成する
- Then: 当該PRは branch ruleset の required status checks を理由にブロックされず、マージ可能である
- 検証方法見込み: `manual`

#### AC-3: Check Run発行が失敗してもIssue/PR本文への成果物転記が独立して試行される

- Given: `gate publish` 実行時に `publishCheckRun()` がエラーを返す状況（個人アカウント認証によるCheck Run発行不能を含む）
- When: `gate publish` を実行する
- Then: `publishCheckRun()` の失敗結果とは独立して `syncGateArtifacts()` が呼び出され、その実行結果（成功時の転記内容、または失敗時の理由）が `gate publish` の出力に含まれる
- 検証方法見込み: `automated`

#### AC-4: verify-template-sync.shがAC-1適用後も従来どおり成功する

- Given: AC-1により配布テンプレート `.agent-skill-chain/templates/github/provisioning/rulesets/main.json` を更新した状態
- When: 配布物とこのリポジトリ実体の同期を検査する `.agent-skill-chain/ci/verify-template-sync.sh` を実行する
- Then: 検査は従来どおり成功する。かつ `setup ruleset` の実装が配布テンプレートJSONの内容をそのまま ruleset 適用に用いていること（テンプレートと実際に適用される内容が乖離しない経路になっていること）を確認できる
- 検証方法見込み: `automated`

#### AC-5: gate publishの現状の運用制約が文書化されている

- Given: `gate publish` が、Check Run を発行可能な CI workflow が存在しない状態で、進行役が任意実行する記録専用ツールとしてのみ機能している現状
- When: 本Issueの変更を適用する
- Then: この制約（Check Run発行元workflowが存在しないこと、rulesetのrequired statusに現状寄与しないこと、進行役が任意実行する記録専用ツールであること）が、利用者が到達可能な文書（配布物に含まれるREADME・runbook・AGENTS.md等のいずれか）に記載されている
- 検証方法見込み: `manual`

## スコープ外

- GitHub Checks API を個人アカウント認証で呼び出し可能にする代替実装（GitHub API仕様上の制約であり本Issueの対応範囲外）。
- Check Run 発行元となる CI workflow（`agent-skill-chain-gate.yml` 等、Issue #386で削除済み）の復元。
- 専用 GitHub App の installation token を用いた `gate publish` の完全運用の実装（ADR-0016が扱う `dedicated_app`/`required_workflow` backend の有効化）。AC-5は現状の制約を文書化するに留め、この完全運用の実装判断・実装自体は対象外とする。
- 将来的な自動 verifier workflow の再導入（AGENTS.md 掲載のコア独立レビューのモデル選択ポリシーが定める設計条件に従う別Issueの対象）。
- `issue_sync` の既定値そのものの変更（ISSUE-567で既に確定済みであり、本Issueは既定値を維持したまま失敗経路の独立化のみを扱う）。
