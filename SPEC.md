# SPEC: Dependabot許可判定がgithub.actorに依存し人間の手動テンプレート同期commitで不成立になる不具合の是正

- Issue: `ISSUE-219`
- 作成者: `spec-worker`
- 対象ブランチ: `bugfix/219-dependabot-actor-check-pr-author`

## 目的・背景

CI（`agent-skill-chain / ci`）とゲート再照合（`agent-skill-chain / reconcile`）には、agent-skill-chain 管理下でない Dependabot 起源ブランチに対して I4（ブランチ命名規約）系の検査・ゲート照合をスキップする「Dependabot 限定許可リスト」判定が導入されている。現行実装はこの判定を `github.actor`（そのワークフロー実行を直接トリガーした人物）に基づいて行う。

`github.actor` は追加 push を行った人物に応じて変化する。Dependabot が開いた PR に対し、人間（進行役）がテンプレート正本の手動同期 commit を push すると `github.actor` は人間になり、許可リスト判定が不成立となる。その結果、`ci.yml` は `Derive issue_id` で `exit 1`、`reconcile.yml` は job がスキップされず通常実行して内部で `exit 1` となる。この「人間による手動同期 commit の push」は、github-actions-ecosystem の Dependabot PR の BLOCKED 状態を解消するために運用上必須の手順であり、本不具合により当該手順が実行不能になっている（実地では該当ブランチへの同期 commit push 後に verify・reconcile 両方の失敗を観測済み）。

本 Issue は、許可判定の基準を「その後の push 実行者」から「PR/ブランチの起源」へ切り替えることでこれを是正する。ci.yml と reconcile.yml では利用可能なコンテキストが異なるため、判定手段は各々独立に定める。

## 要求 → 要件 → 受入条件

### 要求

Dependabot 起源の PR に対して人間が追加 commit（テンプレート正本の手動同期など）を push しても、`ci` と `reconcile` の Dependabot 許可判定が不成立にならないこと。ただし、人間がブランチ命名規約（I4）を強制する検査を意図的に回避できる抜け道を新たに作らないこと。既存の agent-skill-chain 管理下 Issue ブランチに対する検査挙動は一切変えないこと。

### 要件

- ci.yml の Dependabot 許可判定は、その PR を最初に開いた人物（PR 作成者）に基づき、その後の追加 push の実行者に依存してはならない。判定には GitHub が管理し追加 push で変化しない信頼済みコンテキスト値 `github.event.pull_request.user.login` を用いる。許可リスト該当条件の文字列比較（作成者が `dependabot[bot]` かつブランチ名が `dependabot/` 始まり）自体は現行と同一とし、比較対象の env 値の由来のみを差し替える。
- reconcile.yml は `push` イベント駆動でありPR コンテキスト（`pull_request.user.login` 相当）を持たないため、ci.yml と同一手段は取れない。`jobs.reconcile.if` の条件から `github.actor == 'dependabot[bot]'` を除去し、ブランチ名が `dependabot/` で始まることのみを実行スキップ条件とする（`if: !startsWith(github.ref_name, 'dependabot/')`）。
- 修正はテンプレート正本（`.agent-skill-chain/templates/github/.github/workflows/`）と対象リポジトリの展開結果（`.github/workflows/`）の両方に同一内容で適用し、両者の完全一致を維持する。

#### reconcile.yml の許可判定緩和が安全である理由（反証観点への回答）

reconcile.yml の責務は「Issue ブランチのゲート整合性確認（承認済み成果物 digest の照合）」であり、Issue #215 の design-gate レビューで問題視された「verify-branch-name 等、ブランチ命名規約そのものを強制する検査」とは性質が異なる。人間が `dependabot/` 始まりのブランチ名を意図的に騙って reconcile の実行を回避しても、そのブランチには照合対象となる承認済み成果物（`reviews/*.yaml` 等）が存在しないため、reconcile を実行してもしなくても実害がない（no-op 相当）。したがって reconcile.yml 側の許可判定を actor 非依存に緩めても、ci.yml 側の verify-branch-name 等（I4 を実際に強制する検査）には一切影響しない。

一方 ci.yml 側は `github.event.pull_request.user.login`（そのPRの実際の作成者。GitHub 管理・追加 push で不変）を基準に維持することで、人間が `dependabot/` ブランチ名を騙って PR を開いても許可リストに該当せず（値が人間の login になり `dependabot[bot]` 比較に不一致）、branch/Issue 追跡系検査は従来どおり `exit 1` で強制される。これにより「規約違反者が検査を逃れる抜け道を作らない」という Issue #215 の設計原則を維持する。

### 受入条件（Acceptance Criteria）

#### AC-1: ci.yml の Dependabot 許可判定が PR 作成者基準で追加 push 実行者に非依存

- Given: `ci.yml` の `Derive issue_id` ステップが env `ACTOR: ${{ github.event.pull_request.user.login }}` を参照し、許可リスト分岐が `[[ "$ACTOR" == "dependabot[bot]" && "$BRANCH" == dependabot/* ]]` を判定する。
- When: Dependabot が開いた PR（`pull_request.user.login == dependabot[bot]`、ブランチ `dependabot/...`）に、人間の進行役がテンプレート正本の同期 commit を push して synchronize イベントが発生する。
- Then: `pull_request.user.login` は追加 push で変化しないため許可リストに該当し、`skip_checks=true` となって branch/worktree/artifacts 系検査がスキップされ、verify job は（テンプレート正本が実際に同期されていれば）成功する。ステップが `github.actor` を参照する箇所が Dependabot 判定に残っていないこと。
- 検証方法見込み: `hybrid`（automated: 単体テストで `Derive issue_id` の env `ACTOR` が `github.event.pull_request.user.login` を参照し `github.actor` を参照しないことを固定／manual: 実地の Dependabot 起源 PR へ人間 push 後の verify job 成功を CI run で確認）

#### AC-2: reconcile.yml の実行スキップ条件がブランチ名 prefix のみに依存し追加 push 実行者に非依存

- Given: `reconcile.yml` の `jobs.reconcile.if` が `!startsWith(github.ref_name, 'dependabot/')` であり、`github.actor` を参照しない。
- When: `dependabot/...` ブランチに人間の進行役が同期 commit を push して push イベントが発生する。
- Then: `github.ref_name` は `dependabot/` 始まりのままであるため `if` 条件は偽となり reconcile job はスキップされ、失敗しない。actor が人間に変わっても結果は変わらない。
- 検証方法見込み: `hybrid`（automated: 単体テストで `jobs.reconcile.if` が `startsWith(github.ref_name, 'dependabot/')` を参照し `github.actor`/`dependabot[bot]` を参照しないことを固定／manual: 実地の `dependabot/` ブランチへ人間 push 後に reconcile がスキップされ失敗しないことを CI で確認）

#### AC-3: 既存の agent-skill-chain 管理下 Issue ブランチに対する挙動が無回帰

- Given: ブランチ名が `{type}/{issue_id}-{slug}` 形式（例 `bugfix/219-...`）で `pull_request.user.login`/`github.actor` が人間である。
- When: 当該ブランチの PR への push（ci）および push イベント（reconcile）が発生する。
- Then: ci.yml は `issue_id` を抽出でき `skip_checks=false` となり全 verify 検査を従来どおり実行する。reconcile.yml は `if` 条件が真（`dependabot/` 始まりでない）となり従来どおり job を実行する。Dependabot 判定分岐に入らない。
- 検証方法見込み: `automated`（単体テストで非 dependabot ブランチ入力に対し `skip_checks=false`／`issue_id` 抽出成功／reconcile job 実行が維持されることを確認）

#### AC-4: 人間が `dependabot/` ブランチ名を騙っても ci.yml の許可判定はなりすましを許さない

- Given: 人間が `dependabot/` で始まるブランチ名を意図的に作成し、Dependabot 以外のコード変更を含む PR を自分で開く。GitHub は `github.event.pull_request.user.login` にその PR の実際の作成者（人間の login）を設定し、この値は PR 作成者が固定であり追加 push で変化しない。
- When: 当該 PR に対し ci.yml の `Derive issue_id` が評価される。
- Then: `ACTOR`（= `pull_request.user.login`）は人間の login であり `dependabot[bot]` に不一致のため許可リスト分岐に入らず、ブランチ名から `issue_id` も抽出できないため `exit 1` となり、verify-branch-name 等の I4 強制検査は回避されない。
- 検証方法見込み: `hybrid`（automated: `Derive issue_id` の許可判定が `github.event.pull_request.user.login` を参照し `github.actor` を参照しないこと、および許可分岐が `dependabot[bot]` 完全一致を要求することを単体テストで固定／manual: 人間作成の `dependabot/` ブランチ PR で `pull_request.user.login` が人間 login となり verify job が `exit 1` で失敗することを実地確認）

#### AC-5: テンプレート正本と展開結果の完全一致維持

- Given: `ci.yml`・`reconcile.yml` はいずれもテンプレート正本（`.agent-skill-chain/templates/github/.github/workflows/`）と対象リポジトリの展開結果（`.github/workflows/`）に同一内容で存在する。
- When: 本 Issue の修正を適用する。
- Then: 両ファイルは修正後も 1 バイトも差異なく完全一致し、テンプレート同期検査（verify-template-sync）と既存の一致確認単体テストが成功する。既存単体テスト（`test/unit/dependabot-ci-skip.test.ts`）のうち修正後の判定手段と矛盾するアサーション（reconcile.if が `dependabot[bot]` を参照することを要求する箇所等）は、新しい判定手段に合わせて更新する。
- 検証方法見込み: `automated`（テンプレート正本と展開結果の完全一致を確認する既存単体テスト、および verify-template-sync）

## スコープ外

- `agent-skill-chain / gate` job 自体の修正（Issue #215 と同様、既知・スコープ外）。
- 4 セグメント・4 ゲートの仕様自体の変更、および ADR の新規作成（本 Issue は Issue #215 で導入した CI 判定ロジックのバグ修正であり、セグメント仕様の変更を伴わない）。
- Dependabot 許可リストの該当条件（作成者が `dependabot[bot]`／ブランチ名 `dependabot/` 始まり）そのものの再定義。本 Issue は比較対象コンテキスト値の由来のみを是正し、許可対象の意味は変えない。
- reconcile.yml における `push` イベントでの PR 作成者取得（GitHub Actions の `push` イベントには PR コンテキストが存在しないため、ブランチ名 prefix 判定で代替する）。
