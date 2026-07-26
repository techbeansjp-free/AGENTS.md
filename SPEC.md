# SPEC: 配布テンプレートにagent-skill-chain自身の開発専用CIが混入している

- Issue: `ISSUE-290`
- 作成者: `implementation_worker`
- 対象ブランチ: `bugfix/290-distribution-ci-leak`

## 目的・背景

`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`（consumerへの配布正本）は、`npm ci && npm run build && npm test` によりagent-skill-chain CLI自体の開発リポジトリ用テストスイート（`test/unit`・`test/integration`）を実行するジョブと、consumerのIssue/PR成果物を検査する `verify-*`/`lint-*` ジョブが同一ワークフロー・同一ファイルに同居している。`.agent-skill-chain/ci/verify-template-sync.sh` はこのファイルをconsumerの `.github/` へ内容一致で配布することを強制するため、agent-skill-chain自身の自己テストジョブがそのままconsumerへ展開される。

consumerはagent-skill-chain自身の `src/agents-md.ts`・`test/unit`・`test/integration` を保有しないため、配布された `npm test` ステップはconsumer環境で意味を持たない。ユーザーが実際に別プロジェクトへ導入した際、この自己テストジョブが混入し意図しない挙動が発生することを確認した。

## 要求 → 要件 → 受入条件

### 要求

配布されるCIワークフローには、consumer自身のIssue/PR運用を検査するために必要な内容のみを含め、agent-skill-chain自身の開発専用の自己テストを含めない。

### 要件

- agent-skill-chain自身の自己テストジョブ（`npm ci`・`npm run build`・`npm test`・ログartifact）を配布テンプレートから除外する。
- 除外した自己テストジョブは、本リポジトリ自身のCIとしては引き続き実行され続ける（regressionにしない）。
- consumer向けの `verify-*`/`lint-*` 検査ジョブの内容・挙動は変更しない。
- `.agent-skill-chain/ci/verify-template-sync.sh`（`.github/` と配布テンプレートの同期検査）は、本修正後も成功し続ける。

### 受入条件（Acceptance Criteria）

#### AC-1: 配布テンプレートに自己テストジョブが含まれない

- Given: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`（配布正本）
- When: ファイル内容を検査する
- Then: `npm ci`・`npm run build`・`npm test`・`npm-test-execution-log` のいずれも含まれない
- 検証方法見込み: `automated`

#### AC-2: 本リポジトリ自身のnpm testは引き続きCIで実行される

- Given: 本リポジトリの `.github/workflows/`
- When: PRをpushする
- Then: agent-skill-chain自身の `npm test` を実行するジョブが（配布対象外の別ファイルとして）引き続き存在し実行される
- 検証方法見込み: `automated`

#### AC-3: verify-template-syncが成功し続ける

- Given: 修正後の `.agent-skill-chain/templates/github/.github/` と `.github/`
- When: `agent-skill-chain verify template-sync` を実行する
- Then: 差分なしで終了コード0になる
- 検証方法見込み: `automated`

#### AC-4: consumer向けverify-*/lint-*検査の内容は変更されない

- Given: 修正後の配布テンプレート `agent-skill-chain-ci.yml`
- When: 内容を修正前と比較する
- Then: `verify-branch-name`〜`adr-lint` の各consumer向けステップの内容・条件式は変更されていない
- 検証方法見込み: `manual`

## スコープ外

- `agent-skill-chain-gate.yml` 等、他の配布ワークフローが `npm ci && npm run build` にconsumer側で依存する問題（Node package非保有consumerでのCLI解決）はIssue #285の対象であり、本Issueでは対応しない。
- 配布テンプレート全体のCLI解決戦略（`npx`化・prebuilt配布経路への統一等）の再設計は行わない。
