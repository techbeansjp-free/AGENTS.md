# SPEC: Dependabot PR で verify/reconcile CI が issue_id 抽出失敗により恒久的に落ちる問題の修正

- Issue: `ISSUE-215`（由来・追跡のための参照。本仕様の意味は本ファイル内で完結する）
- 作成者: `spec-worker`
- 対象ブランチ: `bugfix/215-dependabot-ci-skip-non-issue-branch`

## 目的・背景

Dependabot が生成する依存関係更新 PR（本リポジトリでは `actions/checkout`・`actions/setup-node`・`typescript`・`@types/node` のバージョン bump 4件）が、GitHub Actions ワークフロー `agent-skill-chain / ci`（verify job）および `agent-skill-chain / reconcile` で恒久的に失敗し、マージ判定が BLOCKED のまま解消できない。本 Issue はこれを是正する。

両ワークフローの「Derive issue_id」ステップは、ブランチ名から次の処理で issue_id を必須抽出する。

```
ISSUE_ID="ISSUE-$(echo "$BRANCH" | sed -E 's#^[^/]+/([0-9]+)-.*#\1#')"
if ! [[ "$ISSUE_ID" =~ ^ISSUE-[0-9]+$ ]]; then
  echo "ブランチ名 '$BRANCH' から issue_id を抽出できません（... branch.pattern に非適合）" >&2
  exit 1
fi
```

このガードは、agent-skill-chain が管理する Issue ブランチ規約 `{type}/{issue_id}-{slug}`（例: `feature/123-user-authentication`）を前提とし、全 PR/push トリガーへ無条件に適用されている。Dependabot のブランチ名（例: `dependabot/github_actions/actions/checkout-7`）はこのパターンに一切適合しないため issue_id 抽出が失敗し、`exit 1` で job 全体が落ちる。ci.yml（verify job）と reconcile.yml（reconcile job）で同一パターンが発生する。

なお `agent-skill-chain / gate` job は同じ issue_id 抽出ロジックを持つが、`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` 未設定という別要因で恒久失敗しており（既知・対応方針確定済み、進行役の手動ゲートレビューで代替）、本 Issue のスコープ外とする。

## 要求 → 要件 → 受入条件

### 要求

Dependabot の依存関係更新 PR が、ビルド健全性検証（`npm ci` / `npm run build` / `npm test`）を受けつつ、agent-skill-chain 固有の Issue ブランチ検査に足を引っ張られず、CI 全体を失敗させずに緑にできること。同時に、agent-skill-chain の Issue ブランチに対する既存の検査挙動は一切変えないこと。

### 要件（設計判断を含む）

本修正が満たすべき要件、および採否した設計判断は以下のとおり。

- **採用しない設計（重要）**: 「ブランチ名が Issue ブランチパターンに一致しないなら agent-skill-chain 固有検査をスキップする」という汎用ルールは採用しない。verify-branch-name はブランチ命名規約（I4 分離）を強制する検査そのものであり、「規約違反のブランチ名なら検査をスキップ」にすると規約違反者だけが検査を逃れる循環的な穴になる。

- **採用する設計**: スキップは **Dependabot 限定の明示的な許可リスト**でのみ行う。スキップ条件は次の両方を満たす場合に限る。
  1. アクターが Dependabot である（GitHub Actions コンテキスト上の bot アクター識別子 `dependabot[bot]`）。
  2. ブランチ名が `dependabot/` で始まる。
  これ以外（パターン非適合だが許可リスト外）は従来どおり `exit 1` で落とし、ブランチ命名規約の強制（I4 検査）を維持する。

- **ci.yml（verify job）の要件**:
  - `npm ci` / `npm run build` / `npm test` の一般的ビルド健全性チェックは、許可リスト該当（Dependabot）PR でも従来どおり実行する（依存更新でビルドが壊れないか検出する主目的そのもの）。
  - agent-skill-chain 固有の検査群のうち **ブランチ・Issue 追跡に関する検査**（Derive issue_id 以降のステップ: verify-branch-name / verify-worktree-path / verify-artifacts / verify-ac-coverage / verify-adr / lint-vocab / lint-references / secret scan 用 base branch 取得 / lint-secrets / adr-lint）は、許可リスト該当時のみ**完全スキップ**する。これらは Issue ブランチの命名・成果物・追跡に関する検査であり、Dependabot ブランチには本質的に適用対象が存在しないため。
  - **verify-template-sync ステップだけは別扱いとする**。本体 `.github/workflows/` とテンプレート正本の乖離検出は Dependabot PR でも意味を持つため、`if:` によるスキップは付けず**常に実行する**。ただし許可リスト該当時のみ `continue-on-error: ${{ steps.ctx.outputs.skip_checks == 'true' }}` を付与し、失敗しても job 全体を失敗させない「非ブロッキング・可視化のみ」の扱いにする。これにより、Dependabot が `.github/workflows/*.yml` のバージョン pin を書き換える一方でテンプレート正本 `.agent-skill-chain/templates/github/.github/workflows/` 配下は更新されない場合に生じる乖離が、GitHub Actions UI 上に赤×として可視化され続ける（無検査のまま静かに進行しない）。Issue ブランチ（`skip_checks=false`）では `continue-on-error` が `false` となり従来どおり失敗が job を落とす（回帰なし）。
  - 可読性のため、ブランチ・Issue 追跡系の各固有検査ステップに個別の `if:` を多数付ける形は避け、単一 output（`skip_checks`）で判定できる構造にする。スキップ判定に用いるアクター・ブランチ名の許可リスト条件は 1 箇所に集約する。

- **reconcile.yml（reconcile job）の要件**:
  - 非 Issue ブランチにはゲート整合性確認の適用対象が存在しないため、許可リスト該当時は job 全体を早期スキップしてよい（job 失敗にしない）。

- **テンプレート正本の要件**: 配布元テンプレート `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml` と `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-reconcile.yml` も、対象リポジトリの `.github/workflows/` と同一内容になるよう同時修正し、`verify-template-sync.sh` の同期検査を通過させる。

- **回帰不可の要件**: agent-skill-chain の Issue ブランチ（`{type}/{issue_id}-{slug}` 適合ブランチ）に対する既存の検査挙動（成功・失敗判定を含む）は一切変更しない。

### 受入条件（Acceptance Criteria）

各 AC は Given/When/Then による受け入れシナリオで記述する。散文形式（`bdd.profile` が strict でない前提）。

#### AC-1: Dependabot PR で verify job がビルド検証を通し固有検査をスキップして失敗しない

- Given: アクターが `dependabot[bot]` で、ブランチ名が `dependabot/` で始まる（例: `dependabot/github_actions/actions/checkout-7`）PR が開かれている。
- When: `agent-skill-chain / ci` の verify job が起動する。
- Then: `npm ci` / `npm run build` / `npm test` は実行され、ブランチ・Issue 追跡系の固有検査群（verify-branch-name / verify-worktree-path / verify-artifacts / verify-ac-coverage / verify-adr / lint-vocab / lint-references / lint-secrets / adr-lint）はスキップされる。verify-template-sync ステップは**常に実行される**が許可リスト該当時は `continue-on-error` により非ブロッキングとなり、たとえ本体・テンプレート正本の乖離で失敗しても（GitHub Actions UI 上に赤×として可視化されつつ）job 全体は失敗しない。結果として job 全体は成功する（固有検査は skipped、verify-template-sync は成功または非ブロッキング失敗）。
- 検証方法見込み: `hybrid`（ワークフロー YAML の条件式静的検証 + Dependabot PR での実 run 観測。詳細は `VALIDATION.md` で確定）

#### AC-2: Dependabot ブランチで reconcile job が失敗しない

- Given: アクターが `dependabot[bot]` で、ブランチ名が `dependabot/` で始まる push が発生している。
- When: `agent-skill-chain / reconcile` の reconcile job が起動する。
- Then: reconcile job は早期スキップされ、job 全体は失敗しない。
- 検証方法見込み: `hybrid`（ワークフロー YAML の条件式静的検証 + 実 run 観測）

#### AC-3: Issue ブランチに対する既存検査挙動が不変（回帰なし）

- Given: agent-skill-chain 規約に適合する Issue ブランチ（例: `feature/<n>-<slug>`・`bugfix/<n>-<slug>`）からの PR/push。
- When: `agent-skill-chain / ci`（verify job）および `agent-skill-chain / reconcile`（reconcile job）が起動する。
- Then: Derive issue_id 以降の固有検査は修正前と同一条件で実行され、成功・失敗判定は修正前と一致する（スキップされない）。規約非適合かつ許可リスト外のブランチは従来どおり `exit 1` で失敗する。
- 検証方法見込み: `hybrid`（条件式静的検証 + 既存 Issue ブランチ PR の run 観測。差分レビューで固有ステップの実行条件が Dependabot 許可リスト以外で変化していないことを確認）

#### AC-4: ワークフロー本体とテンプレート正本の同期

- Given: `.github/workflows/agent-skill-chain-ci.yml`・`.github/workflows/agent-skill-chain-reconcile.yml` と、対応するテンプレート `.agent-skill-chain/templates/github/.github/workflows/` 配下の同名 2 ファイルが本修正の対象である。
- When: `./.agent-skill-chain/ci/verify-template-sync.sh` を実行する。
- Then: 本修正のコミット時点で本体とテンプレート正本の内容が一致し、同期検査がエラーなく通過する（exit 0）。
- 継続的検証の扱い:
  - **Issue ブランチ（agent-skill-chain 管理下、`skip_checks=false`）** に対しては、verify-template-sync は従来どおり **ブロッキング**で検証される（失敗すれば verify job が失敗する）。本修正はこの挙動を変えない。
  - **Dependabot PR（許可リスト該当、`skip_checks=true`）** に対しては、verify-template-sync は実行されるが `continue-on-error` により **可視化のみ（非ブロッキング）** となる。Dependabot が `.github/workflows/*.yml` を更新してもテンプレート正本は自動更新されないため乖離が生じうるが、その同期の恒久的自動化は本 Issue のスコープ外であり、乖離は GitHub Actions UI 上の赤×として可視化される。
- 検証方法見込み: `automated`（`verify-template-sync.sh` の実行結果で機械判定）

## スコープ外

- `agent-skill-chain / gate` job 自体の修正（secrets 未設定による恒久失敗は別課題として既知・対応方針確定済み、手動ゲートレビューで代替）。
- Dependabot 以外の外部要因による CI 失敗の対処。
- Dependabot 以外の bot・外部アクターに対するスキップ許可の拡張（本 Issue の許可リストは Dependabot に限定する）。
- 4 セグメント・4 ゲートの仕様自体の変更（本 Issue は agent-skill-chain 管理外ブランチへの CI 実装の誤適用を是正するバグ修正であり、セグメント追加・変更には該当しない。ADR 作成不要）。
- `.agent-skill-chain/config/agent-skill-chain.yaml` の `branch.pattern` 定義自体の変更（規約は現状維持し、CI 側の適用条件のみを是正する）。
- **Dependabot の github-actions 更新に伴うテンプレート正本の自動同期**（恒久的制約として本 Issue では解消しない）。`.github/dependabot.yml` は `package-ecosystem: github-actions` を設定しており、その更新 PR は `.github/workflows/*.yml`（agent-skill-chain-ci.yml・agent-skill-chain-gate.yml・agent-skill-chain-reconcile.yml・agent-skill-chain-release.yml・agent-skill-chain-risk.yml・agent-skill-chain-root-cleanup.yml）のバージョン pin を書き換える。一方 Dependabot の github-actions スキャンは `.github/workflows/` のみを対象とし `.agent-skill-chain/templates/github/.github/workflows/` 配下のテンプレート正本は更新しない。このため github-actions 系 Dependabot 更新のたびに本体とテンプレート正本の乖離が発生し、手動同期を要する。本 Issue では verify-template-sync を Dependabot PR で非ブロッキング化して乖離を可視化するに留め、乖離の自動解消は実装しない。将来的な自動同期の仕組み（例: main へのマージ後に `.github/workflows/` → テンプレート正本への**逆方向**自動同期を行う仕組み。既存の `sync templates` CLI コマンドはテンプレート正本 → `.github/` の**順方向**コピーのみを行い本用途には使えない）は、別 Issue として起票する必要がある。
