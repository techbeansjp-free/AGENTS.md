# SPEC: リリースworkflowのbumpステップがgit author identity未設定で失敗する

- Issue: `ISSUE-198`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/198-release-git-author`

## 目的・背景

Issue #196で実装したリリース自動化workflow（`agent-skill-chain / release`）が、マージ直後の初回実行（run 29902200805）で失敗した。原因はバージョンbumpコミット・PR作成ステップ（`release bump` CLIサブコマンド）が `git commit` を実行する際、GitHub Actionsランナー上でgit author identity（`user.name`/`user.email`）が設定されておらず、以下のエラーで停止すること。

```
git commit に失敗しました: Author identity unknown
*** Please tell me who you are.
fatal: empty ident name ... not allowed
```

この Issue では原因箇所を修正し、リリース自動化を実際に機能する状態へ復旧する。リリース自動化の設計自体（Issue #196・ADR-0005で確定済み）には変更を加えない。

## 要求 → 要件 → 受入条件

### 要求

- リリース自動化workflowが、mainへのマージ後に人手介入なしでバージョンbumpコミット・タグ・GitHub Releaseの作成まで自動的に完走すること。

### 要件

- 要件1: `release bump` サブコマンドが実行するbumpコミット作成処理は、実行環境（ローカル・GitHub Actionsランナーいずれも）にgit author identityが未設定であっても `git commit` に成功すること。
- 要件2: 既存のgit author identity設定（ローカル開発者の `user.name`/`user.email` 等）を上書き・破壊しないこと。
- 要件3: 既存の単体テスト・統合テストの挙動を変えないこと（新規失敗を発生させない）。

### 受入条件（Acceptance Criteria）

#### AC-1: git author identity未設定環境でのbumpコミット成功

- Given: 実行環境にgit author identity（`user.name`/`user.email`）が設定されていない
- When: `release bump` サブコマンドがバージョンbumpコミットを作成する
- Then: `git commit` が「Author identity unknown」エラーを出さずに成功する
- 検証方法見込み: `automated`

#### AC-2: 既存テストの継続通過

- Given: 修正後のコードベース
- When: 既存の単体テスト・統合テストを実行する
- Then: 全テストが通過し、新規の失敗が発生しない
- 検証方法見込み: `automated`

#### AC-3: 実環境でのリリース完走確認

- Given: 本Issueの修正がmainへマージされた状態
- When: `agent-skill-chain / release` workflowが実行される
- Then: workflowが成功し、v0.2.1相当のバージョンタグおよびGitHub Releaseが作成される
- 検証方法見込み: `manual`

#### AC-4: 既存git author identity設定の非破壊性

- Given: 実行環境に既存のgit author identity（`user.name`/`user.email`）が `git config` で設定済みである
- When: `release bump` サブコマンドがバージョンbumpコミットを作成する
- Then: 実行前後で `git config user.name` / `git config user.email` の値（scope・設定元を含む）が変化しない。すなわち本サブコマンドはこれらを上書き・削除・別scopeでの追加設定のいずれによっても改変しない
- 検証方法見込み: `automated`

## スコープ外

- リリース自動化ワークフロー自体の設計変更（Issue #196・ADR-0005で確定済みの範囲は変更しない）
- バージョン採番ルールなど、git author identity修正と無関係な `release bump` の既存挙動の変更
