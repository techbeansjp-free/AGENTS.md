# SPEC: Dependabot PR で verify/reconcile CI が issue_id 抽出失敗により恒久的に落ちる問題の修正

- Issue: `ISSUE-215`（由来・追跡のための参照。本仕様の意味は本ファイル内で完結する）
- 作成者: `spec-worker`
- 対象ブランチ: `bugfix/215-dependabot-ci-skip-non-issue-branch`

## 目的・背景

Dependabot が生成する依存関係更新 PR が、GitHub Actions ワークフロー `agent-skill-chain / ci`（verify job）および `agent-skill-chain / reconcile`（reconcile job）で、ブランチ名から issue_id を必須抽出する「Derive issue_id」ステップの `exit 1` により**恒久的に誤爆（本来無関係な追跡系検査がクラッシュして job 全体を巻き込む）**する。本リポジトリの Dependabot は現在4件の更新 PR を生成しうる（github-actions-ecosystem: `actions/checkout`・`actions/setup-node`／npm-ecosystem: `typescript`・`@types/node`）が、いずれのブランチ名（例: `dependabot/github_actions/actions/checkout-7`）も agent-skill-chain の Issue ブランチ規約 `{type}/{issue_id}-{slug}` に適合しないため、追跡系検査の入口である Derive issue_id が抽出に失敗し `exit 1` で job 全体を落とす。

両ワークフローの「Derive issue_id」ステップは、ブランチ名から次の処理で issue_id を必須抽出する。

```
ISSUE_ID="ISSUE-$(echo "$BRANCH" | sed -E 's#^[^/]+/([0-9]+)-.*#\1#')"
if ! [[ "$ISSUE_ID" =~ ^ISSUE-[0-9]+$ ]]; then
  echo "ブランチ名 '$BRANCH' から issue_id を抽出できません（... branch.pattern に非適合）" >&2
  exit 1
fi
```

このガードは、agent-skill-chain が管理する Issue ブランチ規約 `{type}/{issue_id}-{slug}`（例: `feature/123-user-authentication`）を前提とし、全 PR/push トリガーへ無条件に適用されている。Dependabot のブランチ名（例: `dependabot/github_actions/actions/checkout-7`）はこのパターンに一切適合しないため issue_id 抽出が失敗し、`exit 1` で job 全体が落ちる。ci.yml（verify job）と reconcile.yml（reconcile job）で同一パターンが発生する。

**本 Issue が達成すること**: この誤爆を解消する。全 Dependabot PR について、追跡系検査（verify-branch-name 等、Issue ブランチの命名・成果物・追跡を前提とし Dependabot ブランチには本質的に適用対象が存在しない検査群）の入口 Derive issue_id が `exit 1` で job 即死させる挙動を、Dependabot 限定のスキップで是正する。これにより各 Dependabot PR の CI 成否は「本来無関係な追跡系検査のクラッシュ」ではなく、そのPRの実態（ビルド健全性・テンプレート同期状態）に応じた正しい判定へ戻る。結果として **npm-ecosystem の更新 PR**（`typescript`・`@types/node`。`.github/workflows/` を一切変更しない）は、追跡系検査がスキップされビルド検証（`npm ci` / `npm run build` / `npm test`）に通り、本体・テンプレート正本に差分も生じないため verify-template-sync も成功し、**CI が完全自動で成功して BLOCKED 状態が解消される**。

**本 Issue が達成しないこと（正直に明記）**: **github-actions-ecosystem の更新 PR**（`actions/checkout`・`actions/setup-node`。`.github/workflows/*.yml` 自体を書き換える。PR #192/#193 が該当）については、追跡系検査の誤爆は解消されるものの、verify-template-sync が本来の役割（本体とテンプレート正本の一致保証）を正しく果たし続けるため、テンプレート正本が古いままである限り**検査は正しく失敗し続け、BLOCKED 状態は自動解消されない**。これは Dependabot の github-actions スキャンが `.github/workflows/` のみを対象とし `.agent-skill-chain/templates/github/.github/workflows/` 配下のテンプレート正本を更新できないという、この種別の Dependabot PR の構造的性質に起因し、本 Issue が是正の対象とするものではない。BLOCKED 状態の解消には、マージ前に人間（進行役）がテンプレート正本を手動同期する運用が引き続き必要であり、本 Issue はこれを自動化しない。

すなわち本 Issue の実質的価値は「CI の誤爆（本来無関係な検査がクラッシュして job 全体を巻き込むこと）を解消し、各 Dependabot PR の成否をそのPRの実態に応じた正しい判定に戻すこと」であり、「全 Dependabot PR を無条件で自動グリーン化すること」ではない。

なお `agent-skill-chain / gate` job は同じ issue_id 抽出ロジックを持つが、`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` 未設定という別要因で恒久失敗しており（既知・対応方針確定済み、進行役の手動ゲートレビューで代替）、本 Issue のスコープ外とする。

## 要求 → 要件 → 受入条件

### 要求

Dependabot の依存関係更新 PR に対し、追跡系固有検査（Issue ブランチの命名・成果物・追跡を前提とし Dependabot ブランチには適用対象が存在しない検査群）の入口 Derive issue_id が `exit 1` で誤爆して job 全体を巻き込む挙動を解消すること。具体的には、Dependabot ブランチではビルド健全性検証（`npm ci` / `npm run build` / `npm test`）を従来どおり実行しつつ、追跡系固有検査を Dependabot 限定でスキップし、各 PR の CI 成否をそのPRの実態（ビルド健全性・テンプレート同期状態）に基づく正しい判定へ戻すこと。これにより `.github/workflows/` を変更しない PR（npm-ecosystem）は完全自動で CI 成功・BLOCKED 解消に至る。ただし verify-template-sync は挙動を一切変えないため、`.github/workflows/*.yml` を書き換える PR（github-actions-ecosystem）はテンプレート正本が古い限り**正しく失敗し続けてよく**（BLOCKED は人間の手動同期で解消）、本要求は「全 Dependabot PR を無条件で緑化すること」を含まない。同時に、agent-skill-chain の Issue ブランチに対する既存の検査挙動は一切変えないこと。

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
  - **verify-template-sync ステップは変更前と同一の挙動を維持し、Dependabot であっても一切スキップ・非ブロッキング化しない**。`if:` 条件も `continue-on-error` も付けず、修正前とまったく同じ「常時実行・失敗時は job 全体を失敗させる」ブロッキング挙動のまま変更しない。理由: verify-template-sync の失敗を「安全に非ブロッキング化する」手段は GitHub Actions の標準機能に存在しない。`continue-on-error: true` を付けた step は、失敗しても job 全体・PR のチェック一覧上は緑（成功）として表示され、個別 step を手動展開しない限り失敗に気づけない（既知の UX gap）。したがって「可視化されるが非ブロッキング」という扱いは成立せず、実質的に失敗を隠蔽する。乖離検出能力を 100% 維持するため、この妥協策は採らない。
  - 可読性のため、ブランチ・Issue 追跡系の各固有検査ステップに個別の `if:` を多数付ける形は避け、単一 output（`skip_checks`）で判定できる構造にする。スキップ判定に用いるアクター・ブランチ名の許可リスト条件は 1 箇所に集約する。verify-template-sync はこの `skip_checks` 判定の対象に含めない。

- **reconcile.yml（reconcile job）の要件**:
  - 非 Issue ブランチにはゲート整合性確認の適用対象が存在しないため、許可リスト該当時は job 全体を早期スキップしてよい（job 失敗にしない）。

- **テンプレート正本の要件**: 配布元テンプレート `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml` と `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-reconcile.yml` も、対象リポジトリの `.github/workflows/` と同一内容になるよう同時修正し、`verify-template-sync.sh` の同期検査を通過させる。

- **回帰不可の要件**: agent-skill-chain の Issue ブランチ（`{type}/{issue_id}-{slug}` 適合ブランチ）に対する既存の検査挙動（成功・失敗判定を含む）は一切変更しない。

### 受入条件（Acceptance Criteria）

各 AC は Given/When/Then による受け入れシナリオで記述する。散文形式（`bdd.profile` が strict でない前提）。

> AC-1 と AC-2 は verify job の同一挙動（追跡系固有検査の Dependabot 限定スキップ・verify-template-sync の挙動不変）に対する検証だが、Given の ecosystem 種別によって Then の最終結果が一意に分岐する（npm=自動成功／github-actions=template-sync が正しく失敗継続）ため、前提条件が結果を一意に決定するよう2つの AC に分割している。

#### AC-1: npm-ecosystem の Dependabot PR で verify job が完全自動成功する

- Given: アクターが `dependabot[bot]` で、ブランチ名が `dependabot/` で始まり、かつ **npm-ecosystem 更新**（例: `typescript`・`@types/node` の bump。`.github/workflows/` 配下を一切変更しない）である PR が開かれている。
- When: `agent-skill-chain / ci` の verify job が起動する。
- Then: `npm ci` / `npm run build` / `npm test` は実行され、ブランチ・Issue 追跡系の固有検査群（verify-branch-name / verify-worktree-path / verify-artifacts / verify-ac-coverage / verify-adr / lint-vocab / lint-references / lint-secrets / adr-lint）はスキップされる。verify-template-sync は本修正の対象外であり修正前と同一のブロッキング挙動のまま実行されるが、本体・テンプレート正本に差分が生じないため成功する。結果として **verify job 全体が自動的に成功し、BLOCKED 状態が解消される**。
- 検証方法見込み: `hybrid`（ワークフロー YAML の条件式静的検証 + npm-ecosystem Dependabot PR での実 run 観測で自動成功を確認。詳細は `VALIDATION.md` で確定）

#### AC-2: github-actions-ecosystem の Dependabot PR で追跡系検査の誤爆が解消され、verify-template-sync は正しく失敗し続ける

- Given: アクターが `dependabot[bot]` で、ブランチ名が `dependabot/` で始まり、かつ **github-actions-ecosystem 更新**（例: `actions/checkout`・`actions/setup-node` の bump。`.github/workflows/*.yml` 自体を書き換える。PR #192/#193 が該当）である PR が開かれている。
- When: `agent-skill-chain / ci` の verify job が起動する。
- Then: `npm ci` / `npm run build` / `npm test` は実行され、ブランチ・Issue 追跡系の固有検査群（AC-1 に列挙した同一の検査群）はスキップされる——これにより Derive issue_id の `exit 1` による追跡系検査の誤爆（job 即死）は解消される。一方 verify-template-sync は本修正の対象外であり修正前と同一のブロッキング挙動のまま実行され、テンプレート正本が古いままのため **正しく失敗し続ける**（偽陽性ではなく正しい検出）。したがって verify job 全体は BLOCKED のままとなり、自動解消はしない。この PR のマージには、マージ前に人間（進行役）が `.agent-skill-chain/templates/github/.github/workflows/` 配下の該当ファイルを `.github/workflows/` の内容へ手動同期する運用が必要であり、この運用手順は本 Issue では自動化しない。
- 検証方法見込み: `hybrid`（ワークフロー YAML の条件式静的検証 + github-actions-ecosystem Dependabot PR での実 run 観測で、追跡系検査の非誤爆＝スキップと verify-template-sync の正しい失敗継続を観測。詳細は `VALIDATION.md` で確定）

#### AC-3: Dependabot ブランチで reconcile job が失敗しない

- Given: アクターが `dependabot[bot]` で、ブランチ名が `dependabot/` で始まる push が発生している。
- When: `agent-skill-chain / reconcile` の reconcile job が起動する。
- Then: reconcile job は早期スキップされ、job 全体は失敗しない。
- 検証方法見込み: `hybrid`（ワークフロー YAML の条件式静的検証 + 実 run 観測）

#### AC-4: Issue ブランチに対する既存検査挙動が不変（回帰なし）

- Given: agent-skill-chain 規約に適合する Issue ブランチ（例: `feature/<n>-<slug>`・`bugfix/<n>-<slug>`）からの PR/push。
- When: `agent-skill-chain / ci`（verify job）および `agent-skill-chain / reconcile`（reconcile job）が起動する。
- Then: Derive issue_id 以降の固有検査は修正前と同一条件で実行され、成功・失敗判定は修正前と一致する（スキップされない）。規約非適合かつ許可リスト外のブランチは従来どおり `exit 1` で失敗する。
- 検証方法見込み: `hybrid`（条件式静的検証 + 既存 Issue ブランチ PR の run 観測。差分レビューで固有ステップの実行条件が Dependabot 許可リスト以外で変化していないことを確認）

#### AC-5: verify-template-sync の挙動不変（本体・テンプレート正本一致の不変条件を一切緩和しない）

- Given: `.github/workflows/agent-skill-chain-ci.yml`・`.github/workflows/agent-skill-chain-reconcile.yml` と、対応するテンプレート `.agent-skill-chain/templates/github/.github/workflows/` 配下の同名 2 ファイルが本修正の対象である。verify-template-sync 自体は本修正の変更対象**外**である。
- When: `./.agent-skill-chain/ci/verify-template-sync.sh` を実行する（Issue ブランチ・Dependabot ブランチのいずれからでも）。
- Then: verify-template-sync は、ブランチ種別（Issue ブランチか Dependabot ブランチか）を問わず変更前と**同一挙動**を維持する——本体とテンプレート正本に差分があれば必ず**ブロッキングで失敗**し（job を落とす）、一致すれば exit 0 で通過する。Dependabot に対する `if:` スキップも `continue-on-error` 非ブロッキング化も一切導入せず、本体・テンプレート正本の一致を要求する不変条件は緩和しない。本修正のコミット時点では本体とテンプレート正本（設計要素A・B・C の適用結果）が一致し、同期検査は exit 0 で通過する。
- 検証方法見込み: `automated`（`verify-template-sync.sh` の実行結果で機械判定。本修正コミットで exit 0 を確認。あわせて YAML 差分レビューで verify-template-sync ステップに `if:`・`continue-on-error` が追加されていないこと=挙動不変を確認）

## スコープ外

- `agent-skill-chain / gate` job 自体の修正（secrets 未設定による恒久失敗は別課題として既知・対応方針確定済み、手動ゲートレビューで代替）。
- Dependabot 以外の外部要因による CI 失敗の対処。
- Dependabot 以外の bot・外部アクターに対するスキップ許可の拡張（本 Issue の許可リストは Dependabot に限定する）。
- 4 セグメント・4 ゲートの仕様自体の変更（本 Issue は agent-skill-chain 管理外ブランチへの CI 実装の誤適用を是正するバグ修正であり、セグメント追加・変更には該当しない。ADR 作成不要）。
- `.agent-skill-chain/config/agent-skill-chain.yaml` の `branch.pattern` 定義自体の変更（規約は現状維持し、CI 側の適用条件のみを是正する）。
- **github-actions 系 Dependabot PR のマージ前に必要なテンプレート正本の手動同期**、および**逆方向自動同期の実装**（いずれも本 Issue では扱わない）。`.github/dependabot.yml` は `package-ecosystem: github-actions` を設定しており、その更新 PR は `.github/workflows/*.yml`（agent-skill-chain-ci.yml・agent-skill-chain-gate.yml・agent-skill-chain-reconcile.yml・agent-skill-chain-release.yml・agent-skill-chain-risk.yml・agent-skill-chain-root-cleanup.yml）のバージョン pin を書き換える。一方 Dependabot の github-actions スキャンは `.github/workflows/` のみを対象とし `.agent-skill-chain/templates/github/.github/workflows/` 配下のテンプレート正本は更新しない。このため github-actions 系 Dependabot 更新のたびに本体とテンプレート正本の乖離が発生し、verify-template-sync が正しく失敗する。本 Issue はこの失敗を偽装・隠蔽せず（`continue-on-error` による非ブロッキング化は UI 上失敗を実質隠蔽するため採らない）、**マージ前に人間（進行役）が該当テンプレート正本を `.github/workflows/` の内容へ合わせて手動更新し、当該 PR ブランチへ push する運用**で解消する。この運用手順の自動化は本 Issue のスコープ外とする。恒久的な自動同期の仕組み（例: main へのマージ後に `.github/workflows/` → テンプレート正本への**逆方向**自動同期を行う仕組み。既存の `sync templates` CLI コマンドはテンプレート正本 → `.github/` の**順方向**コピーのみを行い本用途には使えず、かつ Dependabot がトリガーする `pull_request` イベントの実行には GitHub の仕様上 secrets/PAT が渡らないため CI 側からの安全な self-heal も構築できない）は、別 Issue として起票する必要がある。
