# SPEC: security: reconcile workflowがpushトリガーのYAML自己参照によりGate Check Runを偽造可能

- Issue: `ISSUE-342`
- 作成者: `spec-worker`
- 対象ブランチ: `bugfix/342-reconcile-workflow-trust-boundary`

## 目的・背景

`agent-skill-chain / reconcile` ワークフロー（`.github/workflows/agent-skill-chain-reconcile.yml`、および内容が同一の配布テンプレート `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-reconcile.yml`）は `on: push`（`branches-ignore: [main, 'chore/root-cleanup-*']`）で起動し、`permissions: checks: write` を持つ。GitHub Actionsの仕様上、`push` トリガーで実行されるワークフローは、ワークフローYAMLファイル自体・実行時の判定ロジック（agent-skill-chain CLIのビルド元ソース、`.agent-skill-chain/scripts/gate-reconcile.sh` が薄くラップする `gate reconcile` サブコマンドの実装）のいずれも、pushされたコミット（writer権限を持つ者が完全に制御できるブランチの内容）から読み込まれる。

このため、正規のセグメントワーカーを含むwriter権限保有者が、自分のissueブランチへpushする際にワークフローYAML自体または判定ロジックのソースを改変するだけで、`GITHUB_TOKEN` の `checks: write` 権限を用いて `agent-skill-chain/{spec,design,implementation,validation}-gate` のいずれかのCheck Runを、実際のレビュー証跡なしに成功として発行できてしまう。これはAGENTS.md I2（セグメントゲート）・I5（進行役の純粋性）が前提とする「ゲート成功はGitHub Check Runの正規発行元（専用App/Workflow）に限定され、成果物内容の改変では偽造できない」という信頼モデルを無効化する。

同リポジトリの `.github/workflows/agent-skill-chain-gate.yml` は既に対照的な安全なパターンを実装しており（`pull_request_target` で起動しYAML自体はbaseブランチ=trustedから読まれる、`actions/checkout@v7` は保護されたbaseのSHAを明示指定、PR headは `git fetch` によるread-onlyなgit objectとしてのみ取得し実行しない）、本Issueはreconcile側をこの既存の信頼モデルへ揃えることを目的とする。

由来：2026-08-02、`.github/workflows/` 全体・実行履歴・ruleset・ADR群を横断監査した結果、最優先のセキュリティ問題として発見された（監査対象はagent-skill-chain本体自身のCI/CDガバナンス機構）。

## 要求 → 要件 → 受入条件

### 要求

writer権限を持つ者が、pushするブランチの内容（ワークフローYAML自体・CLIソース・digest計算ロジックを含む）を改変するだけでは、`agent-skill-chain/{spec,design,implementation,validation}-gate` のいずれのCheck Runも、実際のレビュー証跡なしに成功として発行できないようにしたい。

### 要件

- reconcileの判定結果（Check Runの成否）を決定するロジック（ワークフロー定義自体・CLIビルド・`gate reconcile` の実装・digest計算）は、pushされたブランチの内容を読み込まずに実行されなければならない。
- 照合対象であるpushされたSHA上のコードは、read-onlyなgit objectとしての参照以外の用途（ビルド・実行）に用いてはならない。
- 既存の正規フロー（issue-start → SPECワーカーが最初のcheckpointをpush → Draft PR作成 → 設計/実装/検証ワーカーが同一PRへpush → reconcileによる照合）は、本Issueの変更後も同一の機能（承認済み成果物digestとの照合、変化なしの場合の最新SHAへの成功再発行、変化ありの場合の当該ゲートおよび全下流ゲート無効化）を提供し続けなければならない。
- dependabotが作成するブランチに対する既存の許可判定の意図（真正にdependabotが作成したPRのみを照合対象として許可し、それ以外は拒否する）は維持されなければならない。
- リポジトリ実体のワークフローファイルと配布テンプレートのワークフローファイルは、内容が同一のまま保たれなければならない。

### 受入条件（Acceptance Criteria）

#### AC-1: 攻撃者が制御するブランチ内容の改変だけではCheck Runを偽造できない

- Given: 任意のissueブランチへのwriter lease／push権限を持つ者が存在する
- When: 当該ブランチ上で、reconcileの判定ロジック（ワークフロー定義・CLIソース・`gate reconcile` の実装・digest計算部分のいずれか）を「常にsuccessを返す」よう改変してpushする
- Then: そのpushをトリガーに実行されるreconcile相当の処理は、改変された判定ロジックを読み込み・ビルド・実行することなく、保護されたベースブランチ（trusted）由来の判定ロジックのみに基づいて `agent-skill-chain/{spec,design,implementation,validation}-gate` の成否を決定する（したがって改変内容だけでは成功発行を偽造できない）
- 検証方法見込み: `hybrid`（信頼境界の静的な構成検査は自動化できるが、実際の攻撃ブランチによる偽造不能性の最終確認は隔離環境での確認を要する）

#### AC-2: 既存の正規フロー（reconcileによる照合・再発行・無効化判定）が引き続き機能する

- Given: 正規のセグメントワーカーが、issueブランチに紐づくPRのheadブランチへ承認済み成果物のcommit/pushを行う
- When: reconcile相当の処理が、当該pushをトリガーに起動する
- Then: 承認済み成果物digestとpushされたSHAの内容が照合され、変化がなければ最新SHAへ成功が再発行され、変化があれば当該ゲートおよびその全下流ゲートが無効化される
- 検証方法見込み: `automated`

#### AC-3: リポジトリ実体と配布テンプレートのワークフロー内容が同期している

- Given: reconcileワークフローの信頼境界に関する修正が、リポジトリ実体と配布テンプレートの両方に適用される
- When: テンプレート同期検査が実行される
- Then: `.github/workflows/agent-skill-chain-reconcile.yml` と `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-reconcile.yml` の内容差異が検出されない
- 検証方法見込み: `automated`

#### AC-4: dependabotブランチに対する既存の許可判定の意図が維持される

- Given: dependabotが作成したブランチと、dependabotを詐称した非dependabotブランチの双方が存在する
- When: それぞれのブランチへのpushをトリガーにreconcile相当の処理が起動する
- Then: 真正にdependabotが作成したブランチに対応するPRのみが照合対象として許可され、それ以外は拒否される
- 検証方法見込み: `automated`

## スコープ外

- `docs/adr/ADR-0013-trusted-gate-check-materialization.md`（`status: proposed`、未承認）が提案する専用GitHub App／Required Workflowによる強制enforcement backend全体の導入。本Issueはpushトリガーのワークフロー自己参照という個別の脆弱性の解消に限定する。
- `.github/workflows/agent-skill-chain-gate.yml`（PR gate本体）自体の変更。既に安全な信頼モデルを実装済みのため、参照パターンとしてのみ扱い変更対象としない。
- dependabotの許可条件そのもの（許可対象の範囲・ラベル等）の仕様変更。既存の許可判定の意図を維持することのみを要件とし、判定条件の拡張・縮小は対象外。
- Check Run発行の実行主体を専用GitHub Appへ切り替える等、GITHUB_TOKEN以外のcredentialモデルへの変更。
