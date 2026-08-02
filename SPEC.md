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

writer権限を持つ者が、pushするブランチの内容を改変するだけでは、`agent-skill-chain/{spec,design,implementation,validation}-gate` のいずれのCheck Runも、実際のレビュー証跡なしに成功として発行できないようにしたい。ここでいう「pushするブランチの内容」には、(a) 判定ロジック自体（ワークフローYAML・CLIソース・digest計算の実装）と、(b) 判定ロジックが「承認済み」の基準として参照するデータ（承認済み成果物digest・承認済み成果物一覧など）の両方を含む。(b)を(a)と区別して明示するのは、判定ロジックのみを保護されたbase由来にしても、判定ロジックが参照する基準データがpushされたブランチ上のコミット済みファイル（例: `issues/<id>/.agent-skill-chain/reviews/<gate>.yaml`）から取得され続ける場合、writerが成果物本体と当該ファイル内の承認済みdigestを同一pushで揃えて書き換えることで、正しい判定ロジックのもとでも「変化なし」と誤判定させ実際のレビュー証跡なしに成功を再発行させられてしまうためである。

### 要件

- reconcileの判定結果（Check Runの成否）を決定するロジック（ワークフロー定義自体・CLIビルド・`gate reconcile` の実装・digest計算）は、pushされたブランチの内容を読み込まずに実行されなければならない。
- reconcileが「承認済み」と判定するために参照する基準データ（承認済み成果物digest・承認済み成果物一覧）は、pushされたブランチ上でwriter権限を持つ者が改変可能な経路（当該ブランチへコミット可能なファイル等）から取得してはならない。GitHubモードにおける正本であるGitHub Check Run発行履歴、またはそれと同等にwriterが改変不能な情報源にのみ基づかなければならない。
- 照合対象であるpushされたSHA上のコード・ファイルは、read-onlyなgit objectとしての参照（成果物digestの再計算対象等）以外の用途（判定ロジックとしてのビルド・実行、承認済み基準データとしての信頼）に用いてはならない。
- 既存の正規フロー（issue-start → SPECワーカーが最初のcheckpointをpush → Draft PR作成 → 設計/実装/検証ワーカーが同一PRへpush → reconcileによる照合）は、本Issueの変更後も同一の機能（承認済み成果物digestとの照合、変化なしの場合の最新SHAへの成功再発行、変化ありの場合の当該ゲートおよび全下流ゲート無効化）を提供し続けなければならない。
- dependabotが作成するブランチに対する既存の許可判定の意図（真正にdependabotが作成したPRのみを照合対象として許可し、それ以外は拒否する）は維持されなければならない。
- リポジトリ実体のワークフローファイルと配布テンプレートのワークフローファイルは、内容が同一のまま保たれなければならない。
- reconcileが判定対象を一意に指定するために用いる識別子（対象SHA・対象issue_id）自体は、pushされたブランチの内容物（コミットメッセージ・ファイル内容・環境変数等、当該ブランチへのwriter権限を持つ者が制御可能な値）から導出してはならず、GitHub Actionsランタイムが提供する、採用するトリガー種別に応じた構造化イベントフィールド（`workflow_run`イベントの`head_sha`・`head_branch`、または`pull_request_target`イベントの`pull_request.head.sha`・`pull_request.head.ref`・`pull_request.number`等）にのみ基づいて導出されなければならない。判定ロジック自体（AC-1）・承認済み基準データ自体（AC-5）の出所を保護しても、判定対象識別子自体を攻撃者が差し替えられれば、別の対象へ誤って成功判定・成功再発行を導ける（または他Issueの判定を巻き込む）ため、両者と対称に保護する必要がある。

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

#### AC-5: 承認済み基準データ自体の改ざんだけでは「変化なし」と誤判定させられない

- Given: 任意のissueブランチへのwriter lease／push権限を持つ者が存在し、当該ブランチには成果物（例: `SPEC.md`）と、対応するレビュー証跡（承認済み成果物digest・承認済み成果物一覧を記録した、当該ブランチへコミット可能なファイル。例: `issues/<id>/.agent-skill-chain/reviews/<gate>.yaml`）が存在する
- When: 判定ロジック自体は改変せず、(1) 成果物の内容を実際のレビュー未了の内容へ書き換え、かつ (2) 同一push内で当該レビュー証跡ファイルの承認済みdigest・承認済み成果物一覧を、書き換え後の成果物内容から計算されるdigestと一致するよう書き換えてpushする
- Then: そのpushをトリガーに実行されるreconcile相当の処理は、pushされたブランチ上のレビュー証跡ファイルに記録された承認済みdigest・承認済み成果物一覧を承認済み基準として信頼せず、GitHub Check Run発行履歴（正本）等のwriterが改変不能な情報源とのみ照合する。その結果、実際にはレビュー未了である当該変更を「変化なし」とは判定せず、成功を再発行しない（当該ゲートは無効化される、または既存の失敗・未成功状態が維持される）
- 検証方法見込み: `hybrid`（レビュー証跡ファイルが判定に用いられないことの静的検査は自動化できるが、実際の攻撃ブランチによる偽造不能性の最終確認は隔離環境での確認を要する）

#### AC-6: 判定対象識別子（target_sha・issue_id）自体の出所がGitHub提供の構造化フィールドに限定される

- Given: 任意のissueブランチへのwriter lease／push権限を持つ者が存在し、reconcile相当の処理は当該pushに対して判定対象とするSHA・issue_idを何らかの入力元から導出する
- When: 当該ブランチ上で、判定ロジック自体（AC-1）・承認済み基準データ自体（AC-5）は改変せず、コミットメッセージ・ファイル内容・環境変数等、pushされたブランチの内容物として攻撃者が制御可能な値を通じて、reconcile相当の処理が実際とは異なるSHA・issue_idを判定対象と誤認するよう誘導してpushする
- Then: reconcile相当の処理が実際に判定対象とするtarget_sha・issue_idは、GitHub Actionsランタイムが提供する、pushされたブランチの内容物からは導出不可能な構造化イベントフィールド（採用するトリガー種別に応じて`workflow_run`イベントの`head_sha`・`head_branch`、または`pull_request_target`イベントの`pull_request.head.sha`・`pull_request.head.ref`・`pull_request.number`等）にのみ基づいて導出され、pushされたブランチの内容物（コミットメッセージ・ファイル内容・環境変数等）からは導出されない。したがって攻撃者は判定対象そのものを差し替えることができず、AC-1・AC-5が保証する保護を「別の対象を判定させる」ことで迂回できない
- 検証方法見込み: `hybrid`（判定対象識別子の入力元が、採用するトリガー種別に応じたGitHub Actionsランタイム提供の構造化イベントフィールドのみであり、pushされたブランチ内容物からの入力経路が存在しないことの静的検査は自動化できるが、実際の攻撃ブランチによる対象偽装不能性の最終確認は隔離環境での確認を要する）

## 未決事項

- **隔離環境での最終確認待ち（AC-1・AC-5・AC-6）**: AC-1（判定ロジック自体の偽装耐性）・AC-5（承認済み基準データの改ざん耐性）・AC-6（判定対象識別子の偽装耐性）はいずれも検証方法見込みを `hybrid` としている。信頼境界の静的な構成検査（トリガー種別・checkout ref指定・判定ロジックの入力元等）は自動化できるが、実際に攻撃者が制御するブランチ内容（判定ロジックの改変・承認済み基準データの改ざん・判定対象識別子の差し替え）によってCheck Runの偽造が不可能であることの最終確認は、実装完了後の独立検証（validation）セグメントで隔離環境上の実機確認を要する。具体的な検証手順・実行環境・合否判定基準は `VALIDATION.md` で確定する。
- **AC-6のref/branch値自体の真正性検証（ac6-ref-name-spoofing-gap）**: AC-6は判定対象識別子（target_sha・issue_id）の出所を、GitHub Actionsランタイムが提供する構造化イベントフィールド（`pull_request.head.ref`・`workflow_run.head_branch`等）に限定することを要求する。これによりコミットメッセージ・ファイル内容・環境変数等を経由した識別子の差し替えは防げるが、これら構造化フィールドの値自体（ブランチ名文字列）は、当該ブランチ・PRを作成する主体が任意に設定できる値である。現行の `.agent-skill-chain/ci/verify-branch-name.sh` はブランチ命名規則（`<type>/<issue-id>-<slug>` 形式）の構文検査のみを行い、その `<issue-id>` が実在するIssueと正しく対応していること自体（例: 他Issueの番号を騙るブランチ名でのブランチ・PR作成）の真正性検証は行わない。この制約は本Issueが新たに導入するものではなく、既存のissue-id・ブランチ対応関係検証の仕組み全体に及ぶ構造的な既存ギャップであるため、本Issueの対応範囲には含めず（スコープ外節参照）、別Issueでの検討課題として記録する。

## スコープ外

- `docs/adr/ADR-0013-trusted-gate-check-materialization.md`（`status: proposed`、未承認）が提案する専用GitHub App／Required Workflowによる強制enforcement backend全体の導入。本Issueはpushトリガーのワークフロー自己参照という個別の脆弱性の解消に限定する。
- `.github/workflows/agent-skill-chain-gate.yml`（PR gate本体）自体の変更。既に安全な信頼モデルを実装済みのため、参照パターンとしてのみ扱い変更対象としない。
- dependabotの許可条件そのもの（許可対象の範囲・ラベル等）の仕様変更。既存の許可判定の意図を維持することのみを要件とし、判定条件の拡張・縮小は対象外。
- Check Run発行の実行主体を専用GitHub Appへ切り替える等、GITHUB_TOKEN以外のcredentialモデルへの変更。
- ブランチ名・PR head refの文字列値自体が実在するIssueと正しく対応していることの真正性検証（ac6-ref-name-spoofing-gap、前節「未決事項」参照）の導入。AC-6は判定対象識別子の出所をGitHub提供の構造化フィールドに限定することのみを要件とし、当該フィールド値自体の真正性検証は別Issueの検討課題とする。
