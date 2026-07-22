<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: release tagのgit committer identity未設定バグ修正

- Issue: `ISSUE-204`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/204-release-tag-git-identity`

## 目的・背景

`src/commands/release.ts` の `tag()`（`release tag` サブコマンド、`git tag -a` で注釈付きタグを作成しpushする処理）が、GitHub Actionsランナー上でgit committer identity未設定のため「Committer identity unknown」で失敗する。

Issue #198 で `bump()`（`release bump` サブコマンド）における同種の問題（git author identity未設定でのcommit失敗）を修正し、`ensureGitIdentity()`（未解決の場合のみローカルスコープへ fallback identity `github-actions[bot]` / `github-actions[bot]@users.noreply.github.com` を書き込む）と `isIdentityConfigured()`（`git config <key>` が非空に解決できるかを副作用なく判定する）を導入した。しかしこの修正は `bump()` 関数内にのみ組み込まれ、`tag()` 関数には適用されなかった。`git tag -a`（注釈付きタグ）は `git commit` と同様にcommitter identityの解決を要求するため、`bump()` と同じ失敗モードが `tag()` でも発生する。実際にrelease workflowを再実行したところ、`release bump` は成功したが後続の `release tag` が「Committer identity unknown」エラーで失敗することを確認済みである。

本Issueは、`tag()` 関数の呼び出し冒頭で `ensureGitIdentity()` を呼び出すことでこの欠落を解消する、小さなバグ修正である。

## 要求 → 要件 → 受入条件

### 要求

release workflow（`.github/workflows/agent-skill-chain-release.yml` から `.agent-skill-chain/scripts/release-tag.sh` 経由で呼ばれる `release tag` サブコマンド）が、git committer identityが設定されていないGitHub Actionsランナー上でも、`bump`・`publish` 同様に最後まで成功すること。

### 要件

- 要件1: `tag()` は、`git tag -a` の実行前に committer identity（`user.name`/`user.email`）が実効的に解決可能であることを保証する。
- 要件2: 要件1の実現には、Issue #198 で導入済みの `ensureGitIdentity()` / `isIdentityConfigured()` をそのまま再利用し、同等ロジックを `tag()` 側に重複実装しない。
- 要件3: `git config` でローカル・グローバル・システムいずれかに明示的に `user.name`/`user.email` が設定済みの環境では、その既存設定を上書き・破壊しない（`GIT_AUTHOR_*`/`GIT_COMMITTER_*` 環境変数由来のidentityとの混同を避けるため、この要件の前提は `git config` による明示的な設定に限定する）。
- 要件4: 既存の自動テスト（`bump()` 関連を含む `test/integration/release.test.ts` 全体）が本修正後も通過し続ける。
- 要件5: `tag()` がidentity未設定環境で成功することを直接検証する新しい自動テストを追加する（既存テストの非破壊確認だけでは `tag()` 自身の修正を立証できないため）。

### 受入条件（Acceptance Criteria）

#### AC-1: identity未設定環境でも `release tag` が成功する

- Given: `git config` のローカル・グローバル・システムいずれからも `user.name`/`user.email` が解決できない環境（`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` を無効な参照先に差し替え、`GIT_AUTHOR_*`/`GIT_COMMITTER_*` 環境変数も未設定にすることでGitHub Actionsランナーの状態を模擬する）
- When: 存在しない版数タグに対して `release tag <target> <ref>` を実行する
- Then: 終了コード0で成功し、標準エラー出力に「Committer identity unknown」を含まない。作成された注釈付きタグのtagger identityが `github-actions[bot] <github-actions[bot]@users.noreply.github.com>` になっている
- 検証方法見込み: `automated`（新規テストとして追加、`test/integration/release.test.ts` の既存Issue #198テストと同じ手法でidentity未設定環境を再現する）

#### AC-2: `ensureGitIdentity()` / `isIdentityConfigured()` を再利用し、ロジックを重複させない

- Given: `src/commands/release.ts` に既存の `ensureGitIdentity()` / `isIdentityConfigured()`（Issue #198 導入、`bump()` が使用中）が存在する
- When: `tag()` の実装を確認する
- Then: `tag()` は `git tag -a` 実行前に既存の `ensureGitIdentity()` を呼び出しており、identity解決判定・fallback書き込みの同等ロジックが `tag()` 内に別途新規実装されていない
- 検証方法見込み: `hybrid`（実装差分のコードレビューで構造的な重複有無を確認し、AC-1の自動テストで挙動としての等価性を裏付ける）

#### AC-3: `git config` で明示的に設定済みの既存identityを破壊しない

- Given: 対象リポジトリのローカルスコープに `git config user.name`/`user.email` が明示的に設定済みの環境（`GIT_AUTHOR_*`/`GIT_COMMITTER_*` などの環境変数由来のidentityではなく、`git config` により恒久的に設定されているケースに限定する）
- When: `release tag <target> <ref>` を実行する
- Then: 実行前後で `git config user.name`/`user.email` の値が変化せず、かつ作成された注釈付きタグのtagger identityも既存設定のままである（`github-actions[bot]` へ上書きされていない）
- 検証方法見込み: `automated`（Issue #198 の `bump()` 向けAC-4テストと同じ手法を `tag()` に対して追加する）

#### AC-4: 既存の自動テストが引き続き通過する

- Given: `test/integration/release.test.ts` に定義済みの、`bump()`・`tag()`（冪等スキップ含む）・`publish()` に関する既存テスト一式
- When: 本Issueの変更を適用した上で全テストを実行する
- Then: 既存テストが全て通過し、回帰が発生していない
- 検証方法見込み: `automated`（既存テストスイートの実行結果）

#### AC-5: mainマージ後、実際のrelease workflowが最後まで成功する

- Given: 本Issueの変更が `main` へマージ済みであり、releaseワークフロー（`.github/workflows/agent-skill-chain-release.yml`）が起動可能な状態
- When: releaseワークフローを実際に（再）実行し、`resolve-version` → `bump` → `tag` → `publish` の一連の処理を通す
- Then: `release tag` ステップが「Committer identity unknown」で失敗せず、ワークフロー全体が成功で完了する
- 検証方法見込み: `manual`（実リポジトリ・実ランナー上でのワークフロー実行結果の目視確認。ローカルの自動テストだけでは実行環境固有の未設定状態を保証できないため）

## スコープ外

- `publish()`（`release publish`、`gh release create` によるGitHub Release作成）へのidentity関連修正は対象外。`publish()` はgit操作を行わずGitHub API呼び出しのみで完結するため、committer identityの問題は原理的に発生しない。ただし実装時に `publish()` 内にgit操作が含まれていないことを念のため再確認する。
- `resolveVersion()`（`release resolve-version`）は副作用のない読み取り専用処理であり、committer identityと無関係のため対象外。
- `ensureGitIdentity()` / `isIdentityConfigured()` 自体のロジック変更（fallback identity値の変更、環境変数由来identityの扱いの変更等）は対象外。既存実装をそのまま再利用する。
