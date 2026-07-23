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
- reconcile.yml は `push` イベント駆動でありPR コンテキスト（`pull_request.user.login` 相当）をイベントペイロードから直接得られないため、ci.yml と同一手段は取れない。job-level の `jobs.reconcile.if` による早期スキップ（現行 `!(github.actor == 'dependabot[bot]' && startsWith(github.ref_name, 'dependabot/'))`）は撤回し、ci.yml と同様の step-level 制御へ移行する。actor（その後の push 実行者）には依存させず、Dependabot 判定は「ブランチに対応する開いている PR の実際の作成者を GitHub API で問い合わせ、`dependabot[bot]` と一致する場合のみ許可」とする。具体的には以下を行う。
  - `Derive issue_id` ステップを3分岐化する。
    - 第1分岐: ブランチ名が `branch.pattern` の正規表現 `^[^/]+/([0-9]+)-.*` に一致する場合 → `issue_id` を設定し `skip_checks=false`（既存の Issue ブランチ経路、判定内容は変更なし）。
    - 第2分岐: 第1分岐に一致せず、かつブランチ名が `dependabot/` で始まる場合 → `gh api "repos/${GITHUB_REPOSITORY}/pulls?head=<owner>:<branch>&state=open" --jq '.[0].user.login // empty'`（env `GH_TOKEN: ${{ github.token }}`）で当該ブランチに対応する開いている PR の作成者を実際に問い合わせ、作成者が `dependabot[bot]` と一致すれば `skip_checks=true`。一致しない／PR が存在せず empty の場合は日本語理由付きで `exit 1`。
    - 第3分岐: 上記いずれにも該当しない場合 → 日本語理由付きで `exit 1`（従来どおり）。
  - `Reconcile gates against pushed SHA` ステップに `if: steps.ctx.outputs.skip_checks != 'true'` を付与し、許可された Dependabot ブランチでは照合本体をスキップする。
  - `permissions` に `pull-requests: read` を追加する（PR 検索 API の呼び出しに必要）。
- 修正はテンプレート正本（`.agent-skill-chain/templates/github/.github/workflows/`）と対象リポジトリの展開結果（`.github/workflows/`）の両方に同一内容で適用し、両者の完全一致を維持する。

#### reconcile.yml を step-level PR 作成者確認へ変更する理由（反証観点への回答）

**却下した案（prefix 判定のみ）が退行を導入する点**：job-level `if` から actor を除去し「ブランチ名が `dependabot/` で始まることのみ」を実行スキップ条件とする案（`if: !startsWith(github.ref_name, 'dependabot/')`）は、`branch.pattern` の正規表現 `^[^/]+/([0-9]+)-.*` に一致しない本物の Dependabot 形式ブランチ名（例 `dependabot/npm_and_yarn/typescript-5.5.4`、`dependabot/github_actions/...`）を人間が偽装した場合に、元の actor チェックが唯一の防御だったにもかかわらず、prefix だけで無条件にスキップしてしまう。これは Issue #215 の「規約違反者が検査を逃れる抜け道を作らない」という設計原則に反する退行であるため採用しない。

**採用する設計（step-level 3分岐 + 実 PR 作成者の API 確認）が偽装を解消する理由**：Dependabot ブランチ経路は「ブランチ名 prefix」ではなく「そのブランチに対応する開いている PR の実際の作成者」を GitHub API で問い合わせて判定する。人間が `dependabot/npm_and_yarn/...` 型のブランチ名を偽装しても、(a) そのブランチに対応する開いている PR が存在しなければ API は empty を返し `exit 1`、(b) PR が存在してもその作成者は偽装者本人（人間の login）であり `dependabot[bot]` に不一致となり `exit 1` となる。PR を介さない push 単体でも対応 PR が見つからず empty で `exit 1` に落ちる。したがって偽装ブランチは reconcile をスキップできず、actor（その後の push 実行者）にも依存しない。この設計は ci.yml 側の `pull_request.user.login` ベース判定と対をなす「起源の実際の検証」という一貫した思想である。

**`branch.pattern` と偶然衝突する偽装ブランチ（`dependabot/223-fake` 型）は既存の第1分岐で安全に処理される点（反証耐性）**：`dependabot/223-fake` のようなブランチ名は、`branch.pattern` の正規表現 `^[^/]+/([0-9]+)-.*` に**先に一致し** `issue_id=223` を抽出できる。このため第2分岐（Dependabot API 判定）ではなく第1分岐（通常の reconcile 実行）を通り、実在 Issue 223 の承認済み成果物に対する gate digest 照合が正しく行われ、スキップされない（回避されない）。この観点は既存の第1分岐のまま変更せずに安全であり、`branch.pattern` と衝突しない本物の Dependabot 形式名のみが第2分岐の API 確認対象となる。

### 受入条件（Acceptance Criteria）

#### AC-1: ci.yml の Dependabot 許可判定が PR 作成者基準で追加 push 実行者に非依存

- Given: `ci.yml` の `Derive issue_id` ステップが env `ACTOR: ${{ github.event.pull_request.user.login }}` を参照し、許可リスト分岐が `[[ "$ACTOR" == "dependabot[bot]" && "$BRANCH" == dependabot/* ]]` を判定する。
- When: Dependabot が開いた PR（`pull_request.user.login == dependabot[bot]`、ブランチ `dependabot/...`）に、人間の進行役がテンプレート正本の同期 commit を push して synchronize イベントが発生する。
- Then: `pull_request.user.login` は追加 push で変化しないため許可リストに該当し、`skip_checks=true` となって branch/worktree/artifacts 系検査がスキップされ、verify job は（テンプレート正本が実際に同期されていれば）成功する。ステップが `github.actor` を参照する箇所が Dependabot 判定に残っていないこと。
- 検証方法見込み: `hybrid`（automated: 単体テストで `Derive issue_id` の env `ACTOR` が `github.event.pull_request.user.login` を参照し `github.actor` を参照しないことを固定／manual: 実地の Dependabot 起源 PR へ人間 push 後の verify job 成功を CI run で確認）

#### AC-2: reconcile.yml の Dependabot 判定が実 PR 作成者の API 確認に依存し追加 push 実行者に非依存

- Given: `reconcile.yml` の job-level `jobs.reconcile.if` から `github.actor == 'dependabot[bot]'` を用いた早期スキップが撤回され、`Derive issue_id` ステップが3分岐（第1: `branch.pattern` 一致で `skip_checks=false`／第2: 非一致かつ `dependabot/` 始まりで PR 作成者を `gh api ".../pulls?head=<owner>:<branch>&state=open" --jq '.[0].user.login // empty'` により問い合わせ `dependabot[bot]` 一致時のみ `skip_checks=true`、不一致/empty で `exit 1`／第3: それ以外で `exit 1`）で構成され、`Reconcile gates against pushed SHA` ステップに `if: steps.ctx.outputs.skip_checks != 'true'` が付与され、`permissions` に `pull-requests: read` が含まれる。判定は `github.actor` を参照しない。
- When: Dependabot が開いた PR の `dependabot/...`（`branch.pattern` 非一致形式、例 `dependabot/npm_and_yarn/...`）ブランチに、人間の進行役が同期 commit を push して push イベントが発生する。
- Then: API が返す PR 作成者は `dependabot[bot]` のままであり（追加 push で不変）第2分岐で `skip_checks=true` となり、照合ステップがスキップされて reconcile は失敗しない。actor が人間に変わっても結果は変わらない。
- 検証方法見込み: `hybrid`（automated: 単体テストで `jobs.reconcile.if` に `github.actor`/`dependabot[bot]` 早期スキップが無いこと、`Derive issue_id` が3分岐で PR 作成者 API 問い合わせ結果を `dependabot[bot]` と比較すること、照合ステップに `skip_checks != 'true'` の `if` が付き `permissions` に `pull-requests: read` があることを固定／manual: 実地の `dependabot/` ブランチへ人間 push 後に reconcile がスキップされ失敗しないことを CI で確認）

#### AC-3: 既存の agent-skill-chain 管理下 Issue ブランチに対する挙動が無回帰

- Given: ブランチ名が `{type}/{issue_id}-{slug}` 形式（例 `bugfix/219-...`）で `pull_request.user.login`/`github.actor` が人間である。
- When: 当該ブランチの PR への push（ci）および push イベント（reconcile）が発生する。
- Then: ci.yml は `issue_id` を抽出でき `skip_checks=false` となり全 verify 検査を従来どおり実行する。reconcile.yml も `Derive issue_id` の第1分岐（`branch.pattern` 一致）に入り `skip_checks=false` となって照合ステップを従来どおり実行する。第2分岐（Dependabot API 判定）には入らない。
- 検証方法見込み: `automated`（単体テストで非 dependabot ブランチ入力に対し ci.yml・reconcile.yml いずれも `skip_checks=false`／`issue_id` 抽出成功／照合ステップ実行が維持されることを確認）

#### AC-4: 人間が `dependabot/` ブランチ名を騙っても ci.yml・reconcile.yml いずれの許可判定もなりすましを許さない

ci.yml 側（PR コンテキスト由来の `pull_request.user.login`）と reconcile.yml 側（push イベントでは PR コンテキストが無いため実 PR 作成者を API 問い合わせ）で確認手段は異なるが、いずれも「起源の実際の作成者を検証する」点で一貫し、ブランチ名の偽装だけでは許可されない。

- Given(ci.yml): 人間が `dependabot/` で始まるブランチ名を意図的に作成し、Dependabot 以外のコード変更を含む PR を自分で開く。GitHub は `github.event.pull_request.user.login` にその PR の実際の作成者（人間の login）を設定し、この値は追加 push で変化しない。
- When(ci.yml): 当該 PR に対し ci.yml の `Derive issue_id` が評価される。
- Then(ci.yml): `ACTOR`（= `pull_request.user.login`）は人間の login であり `dependabot[bot]` に不一致のため許可リスト分岐に入らず、ブランチ名から `issue_id` も抽出できないため `exit 1` となり、verify-branch-name 等の I4 強制検査は回避されない。
- Given(reconcile.yml): 人間が `branch.pattern` 非一致の本物の Dependabot 形式ブランチ名（例 `dependabot/npm_and_yarn/fake`）を騙って push する。対応する開いている Dependabot PR は存在しないか、存在してもその作成者は偽装者本人である。
- When(reconcile.yml): 当該ブランチの push イベントで `Derive issue_id` の第2分岐（`branch.pattern` 非一致かつ `dependabot/` 始まり）が評価され、`gh api ".../pulls?head=<owner>:<branch>&state=open" --jq '.[0].user.login // empty'` が実行される。
- Then(reconcile.yml): API 結果は空文字（対応 PR 無し）または人間の login であり `dependabot[bot]` に不一致のため `skip_checks=true` にならず、第2分岐末尾で日本語理由付きの `exit 1` となる。偽装ブランチは照合スキップを得られず、actor（push 実行者）にも依存しない。
- 検証方法見込み: `hybrid`（automated: ci.yml の許可判定が `github.event.pull_request.user.login` を参照し `dependabot[bot]` 完全一致を要求すること、reconcile.yml の第2分岐が API の PR 作成者を `dependabot[bot]` と比較し不一致/empty で `exit 1` すること、両者とも `github.actor` を判定に用いないことを単体テストで固定／manual: 人間作成の `dependabot/` ブランチについて ci verify・reconcile がともに `exit 1` で失敗することを実地確認）

#### AC-5: テンプレート正本と展開結果の完全一致維持

- Given: `ci.yml`・`reconcile.yml` はいずれもテンプレート正本（`.agent-skill-chain/templates/github/.github/workflows/`）と対象リポジトリの展開結果（`.github/workflows/`）に同一内容で存在する。
- When: 本 Issue の修正を適用する。
- Then: 両ファイルは修正後も 1 バイトも差異なく完全一致し、テンプレート同期検査（verify-template-sync）と既存の一致確認単体テストが成功する。既存単体テスト（`test/unit/dependabot-ci-skip.test.ts`）のうち修正後の判定手段と矛盾するアサーション（reconcile.if が `dependabot[bot]` を参照することを要求する箇所等）は、新しい判定手段に合わせて更新する。
- 検証方法見込み: `automated`（テンプレート正本と展開結果の完全一致を確認する既存単体テスト、および verify-template-sync）

## スコープ外

- `agent-skill-chain / gate` job 自体の修正（Issue #215 と同様、既知・スコープ外）。
- 4 セグメント・4 ゲートの仕様自体の変更、および ADR の新規作成（本 Issue は Issue #215 で導入した CI 判定ロジックのバグ修正であり、セグメント仕様の変更を伴わない）。
- Dependabot 許可リストの該当条件（作成者が `dependabot[bot]`／ブランチ名 `dependabot/` 始まり）そのものの再定義。本 Issue は比較対象コンテキスト値の由来のみを是正し、許可対象の意味は変えない。
- reconcile.yml における PR 作成者確認手段を GitHub API 問い合わせ以外（例: イベントペイロード内の PR コンテキスト）で行うこと。`push` イベントには PR コンテキストが存在しないため、`state=open` の PR を head ブランチで検索して作成者を得る API 問い合わせを唯一の手段とする。
