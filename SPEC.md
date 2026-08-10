# SPEC: issue_sync の既定値を enabled: true へ変更する（GitHubモードではGitHub Issueを正本とすべき）

- Issue: `ISSUE-567`
- 作成者: `spec_worker`
- 対象ブランチ: `process/567-issue-sync-default-true`

## 目的・背景

ADR-0021（GitHub Issue/PR 本文への成果物全文同期機構）は、既定を `issue_sync.enabled: false`（オプトイン）としていた。根拠は、有効化により不変条件I3（耐久性）の保証内容が変わる（GitHubが消失・アクセス不能になった場合の復元可能性が成果物内容についてもGitHub側の永続化に依存するようになる）ため、というものだった。

2026-08-10、ユーザーからの明示的な方針指示があった：GitHubを使っているならGitHub Issueが正であることは明確な事実であり、すべての成果物はそこに記載されているべきである、という趣旨の指示である。この指示に基づき、GitHubモードを選択するプロジェクトでは `issue_sync` を既定で有効化する（`enabled: true`）方針へ変更する。ADR-0021自体が定めた同期の仕組み・マーカー方式・転記対象（D-1・D-3以降相当の決定）の妥当性は変更せず、既定値の選択（D-2相当）のみを改定する。

## 要求 → 要件 → 受入条件

### 要求

GitHubモードを選択した新規プロジェクトは、初期状態からGitHub Issueページを開くだけで4セグメントの進捗・ゲート状態・要求・設計・実装計画・検証結果の全文を読める状態にする。既存プロジェクトで明示的に `issue_sync.enabled: false` を設定している場合の挙動は変更しない。

### 要件

- GitHubモード向けに配布・生成される設定の既定値で、`issue_sync.enabled` を `true` にする。
- 設定スキーマ上のデフォルト値・記述例が新しい既定値と矛盾しない状態にする。
- ADR-0021の既定値に関する決定記述（D-2相当）と、それに紐づく Consequences・Context の記述を、新しい既定値に合わせて改定する。ADR-0021のstatusは `proposed` であり、本文編集は許容される。
- リポジトリ内の規範文書・テンプレート・利用者向け文書上にある「既定は無効」「既定 `enabled: false`」等、旧既定値を前提とした記述箇所を、新しい既定値と整合する記述へ更新する。
- 明示的に `issue_sync.enabled: false` を設定済みの既存プロジェクトの設定ファイルは、既定値変更の影響を受けず、その明示設定のまま動作する。
- `issue_sync` が有効化された場合の転記対象・転記先（`target`）・上限（`max_body_chars`）・マーカー処理・ローカルモードでの取り扱いなど、既定値以外の既存の同期仕様は変更しない。

### 受入条件（Acceptance Criteria）

#### AC-1: GitHubモード向け既定設定で issue_sync が有効になる

- Given: GitHubモードを選択するプロジェクトが、`issue_sync` セクションを含む設定ファイルを未編集のまま参照する状態
- When: 当該設定ファイルの `issue_sync.enabled` の値を確認する
- Then: 値が `true` になっている
- 検証方法見込み: `automated`

#### AC-2: 配布用テンプレートの既定設定でも issue_sync が有効になる

- Given: `init` によって consumer project へ配布される設定テンプレート
- When: 配布された設定テンプレート内の `issue_sync.enabled` の値を確認する
- Then: 値が `true` になっている
- 検証方法見込み: `automated`

#### AC-3: 設定スキーマ上のデフォルト値記述が新しい既定値と整合する

- Given: `.agent-skill-chain/schemas/config.schema.yaml` 内に `issue_sync` のデフォルト値・記述例を示す箇所がある
- When: 既定値変更後に当該箇所を確認する
- Then: 記述されている `enabled` の値が `true` として新しい既定値と整合している。`enabled` の型・必須項目制約自体（真偽値であること等）は変更されない
- 検証方法見込み: `automated`

#### AC-4: 明示的に無効化した既存プロジェクトの設定は変更されない

- Given: 既存プロジェクトの設定ファイルが `issue_sync.enabled: false` を明示的に記載している
- When: 既定値変更後のコード・テンプレートの下で当該設定ファイルを読み込む
- Then: 明示された `false` がそのまま有効となり、既定値変更によって `true` へ書き換えられたり上書きされたりしない
- 検証方法見込み: `automated`

#### AC-5: ADR-0021 の既定値決定記述が新しい決定を反映する

- Given: `docs/adr/ADR-0021-github-issue-sync-full-text-content-canonical.md` が `status: proposed` であり本文編集可能である
- When: ADR-0021内の既定値に関する決定記述（D-2相当）と、関連する Consequences・Context の記述を確認する
- Then: 既定を `enabled: true` とする決定と、その根拠（GitHubモードではGitHub Issueが正本であるという方針指示）、および明示的にオプトアウトする経路が存在することが記載されている
- 検証方法見込み: `manual`

#### AC-6: 規範文書・利用者向け文書上の旧既定値記述が新しい既定値と矛盾しない

- Given: AGENTS.md・`docs/CONFIGURATION.md`・`docs/ARCHITECTURE.md` など、`issue_sync` の既定値に言及する文書群がある
- When: 既定値変更後にこれらの文書内の関連記述を確認する
- Then: 「既定は無効」「既定 `enabled: false`」など、旧既定値のみを前提とした矛盾する記述が残っていない
- 検証方法見込み: `automated`

#### AC-7: 既定値変更後も issue_sync の同期仕様自体の既存テストが回帰しない

- Given: `issue_sync.enabled: true` が指定された場合の転記処理（対象・転記先・上限・マーカー処理・ローカルモードでの無効扱い）を検証する既存の自動テスト群
- When: 既定値変更後に既存の自動テストを実行する
- Then: 既定値変更前と同じ結果（成功）を維持し、同期仕様自体の挙動は変化しない
- 検証方法見込み: `automated`

## スコープ外

- ADR-0021が既に確定した同期の仕組み自体（マーカー方式、転記対象ファイル集合、`target`・`max_body_chars` の意味、一方向転記であること等）の妥当性の再検討・変更。
- ローカルモードにおける `issue_sync` の取り扱い（常に無効として扱う既存仕様）の変更。
- 既に明示的な `issue_sync.enabled` 設定を持つ既存プロジェクトの設定ファイルそのものへの遡及的な書き換え。
- `issue_sync` 以外の設定項目（`merge.autonomous`、`human_confirmation.before_implementation` 等）の既定値の変更。
