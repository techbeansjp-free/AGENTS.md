# SPEC: 配布テンプレートからdependabot.ymlを削除する

- Issue: `ISSUE-611`
- 作成者: `spec_worker`
- 対象ブランチ: `chore/611-remove-dependabot-template`

## 目的・背景

`agent-skill-chain` は `init`／`sync templates`／`setup github` を通じて `.agent-skill-chain/templates/github/.github/` 配下のファイル一式を配布先（consumer project）の `.github/` へ展開する。この配布ファイル群には `dependabot.yml`（npm・github-actions双方を対象とした週次自動更新設定）が含まれており、`.agent-skill-chain/templates/github/.github.seed-only.yaml` の `paths:` にも `dependabot.yml` が登録されている（ISSUE-574で導入されたseed-only区分。初回配置後の内容カスタマイズは差分として検査しないが、展開先からの完全な削除は `computeTemplateSyncDiffs` により「未同期（欠落）」として検知され続ける）。

`dependabot.yml` は依存関係更新という汎用CI/CD設定であり、agent-skill-chainがドメインとする開発プロセスの調整・強制（ゲート・writer lease・4セグメント等）のいずれの仕組みからも参照・依存されていない。コード上の参照は `src/lib/template-sync.ts` 内のseed-only区分を説明するコメント1箇所（`CODEOWNERS・dependabot.yml等`という例示）のみであり、機能的な依存は無い。seed-only区分によって初回配置後のカスタマイズは許容されているが、「配布そのものを望まない」consumer projectが一度配置された `dependabot.yml` を削除しても、`verify template-sync` 等が恒久的に「未同期（欠落）」を報告し続け、実質的に削除できない状態になっている。

2026-08-11、ユーザーから「配布物には含めてほしくない」という直接の要望を受けて起票した。dependabot.ymlをconfig化・opt-out化するのではなく、配布物からの完全削除が適切と判断した（UNIX原則「疑わしい機能は追加しない」）。

このリポジトリ自身（dogfooding）の `.github/dependabot.yml` は、このリポジトリ自身のnpm・GitHub Actions依存関係更新のために存置し続ける対象であり、配布物としての要否とは別の判断であるため本Issueの対象外とする。

## 要求 → 要件 → 受入条件

### 要求

`agent-skill-chain` の配布テンプレート（`init`／`sync templates`／`setup github` の展開元）から `dependabot.yml` を完全に取り除き、新規導入・既存導入いずれの経路でも、これ以上 `dependabot.yml` がconsumer projectへ配布・強制されない状態にする。

### 要件

- 配布元 `.agent-skill-chain/templates/github/.github/dependabot.yml` ファイル自体を削除する。
- `.agent-skill-chain/templates/github/.github.seed-only.yaml` の `paths:` から `dependabot.yml` エントリを削除する。既存の `CODEOWNERS` エントリのseed-only扱いは変更しない。
- 上記2点の削除に伴い、配布元に `dependabot.yml` が存在することを前提として書かれている既存の自動テスト（`verify template-sync` の「seed-only指定ファイル（dependabot.yml）が完全に削除された場合は引き続き欠落として検出される」ケースを含む）を、削除後の実態（配布元に `dependabot.yml` が存在しない）に整合する内容へ更新する。この更新はテンプレート同期検査ロジック（`computeTemplateSyncDiffs`）自体の仕様変更を意味しない。
- dependabotが作成したPRのCIスキップを判定する既存ロジック（dependabot.ymlの配布有無とは独立した、PR作成者・ブランチ名に基づく汎用判定）は変更しない。
- このリポジトリ自身の `.github/dependabot.yml`（dogfooding用）は変更・削除しない。
- 既に `dependabot.yml` が配置済みのconsumer projectについて、本Issueの変更は展開先ファイルを自動削除しない。展開先だけに存在する余剰ファイルは `computeTemplateSyncDiffs` の検査対象外であるため、本Issueの変更後も「未同期」としては報告されず、削除するかどうかは各consumerの判断に委ねる。

### 受入条件（Acceptance Criteria）

#### AC-1: 新規導入した consumer project に dependabot.yml が配置されない

- Given: `agent-skill-chain init` を初めて実行する対象ディレクトリ
- When: `init`（`sync templates`／`setup github` を含む展開処理）を実行する
- Then: 展開先 `.github/` 配下に `dependabot.yml` が一切生成されない
- 検証方法見込み: `automated`

#### AC-2: seed-only manifest から dependabot.yml エントリが削除されている

- Given: `.agent-skill-chain/templates/github/.github.seed-only.yaml` の現在の内容
- When: 本Issueの変更を適用する
- Then: `paths:` から `dependabot.yml` エントリが削除されており、`CODEOWNERS` エントリはそのまま残っている
- 検証方法見込み: `automated`

#### AC-3: 配布元に dependabot.yml が存在しない状態で verify template-sync が整合して動作する

- Given: 配布元 `.agent-skill-chain/templates/github/.github/` に `dependabot.yml` が存在せず、`.github.seed-only.yaml` にも当該エントリが無い状態
- When: `verify template-sync` を実行する（新規展開直後の一致確認、および展開先に旧 `dependabot.yml` が残存する場合の余剰ファイル非検知の両方を含む）
- Then: 配布元に存在しないファイルを理由とする誤検知（存在しないファイルの欠落報告等）が起きず、既存の自動テスト（配布元に `dependabot.yml` が存在する前提だったケースを含む）が削除後の実態に合わせて更新され、全て成功する
- 検証方法見込み: `automated`

#### AC-4: dependabot-ci-skip 判定ロジックに回帰が無い

- Given: dependabotが作成したPRのCIスキップ可否を判定する既存ロジック（PR作成者・ブランチ名パターンに基づく汎用判定。consumerが独自に `dependabot.yml` を設定した場合も対象に含む）
- When: 本Issueの変更（配布テンプレートからの `dependabot.yml` 削除）を適用する
- Then: 当該ロジックおよびその既存テストに変更が不要であり、既存テストが全て成功する。design-gateで変更不要であることを確認する
- 検証方法見込み: `automated`

#### AC-5: このリポジトリ自身の dogfooding 用 dependabot.yml が変更されない

- Given: このリポジトリ自身の `.github/dependabot.yml`（dogfooding用、npm・github-actionsの週次自動更新設定）
- When: 本Issueの変更（配布テンプレート `.agent-skill-chain/templates/github/.github/dependabot.yml` の削除、および `.github.seed-only.yaml` の更新）を適用する
- Then: このリポジトリ自身の `.github/dependabot.yml` の内容が変更・削除されずそのまま残る
- 検証方法見込み: `manual`

## スコープ外

- `dependabot.yml` の配布可否をconfig化・opt-in/opt-out設定化すること。本Issueは配布物からの完全削除であり、設定による選択制は導入しない。
- 既に `dependabot.yml` が配置済みのconsumer projectの展開先 `.github/dependabot.yml` を、本Issueの変更によって自動的に削除・変更すること。削除するかどうかは各consumerの判断に委ねる。
- `CODEOWNERS` のseed-only区分・配布内容自体の変更。
- このリポジトリ自身（dogfooding）の `.github/dependabot.yml` の内容変更・削除。
- dependabotが作成したPRのCIスキップ判定ロジック自体の仕様変更（AC-4のとおり、判定ロジックは `dependabot.yml` の配布有無と独立しており変更不要と想定されるが、この想定自体の確認はdesign-gateで行う）。
- `computeTemplateSyncDiffs`（テンプレート同期検査）の検査仕様自体の変更（既存挙動の維持を前提とし、本Issueで更新する自動テストはあくまで削除後の実態への追従に限る）。
