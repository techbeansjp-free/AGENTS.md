# DESIGN: Dependabot許可判定がgithub.actorに依存し人間の手動テンプレート同期commitで不成立になる不具合の是正

- Issue: `ISSUE-219`
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲

CI（`agent-skill-chain / ci`）とゲート再照合（`agent-skill-chain / reconcile`）における Dependabot 限定許可判定の基準を、「その後の push 実行者（`github.actor`）」から「PR/ブランチの起源（実際の PR 作成者）」へ切り替える。ci.yml は PR コンテキスト（`github.event.pull_request.user.login`）を、reconcile.yml は push イベントで PR コンテキストを持たないため GitHub API による実 PR 作成者問い合わせを、それぞれ判定手段とする。対象は本体2ワークフローファイル・テンプレート正本2ファイル・既存単体テスト1ファイル。許可条件（作成者が `dependabot[bot]` かつブランチ名 `dependabot/` 始まり）の意味は変えず、比較対象値の由来のみ是正する。

## 用語

- **Dependabot 許可判定**: agent-skill-chain 管理外の Dependabot 起源ブランチに対し I4 系検査・ゲート照合をスキップさせるための分岐判定。
- **起源の実際の検証**: ブランチ名 prefix ではなく、GitHub が管理し追加 push で変化しない信頼済み値（`pull_request.user.login` / API が返す実 PR 作成者）で判定する思想。
- **`skip_checks`**: `Derive issue_id` ステップが出力する真偽値。`true` の場合に追跡系検査／照合本体をスキップする。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | 設計要素A（ci.yml `Derive issue_id` の env `ACTOR` 由来差し替え） | `github.actor` → `github.event.pull_request.user.login`。分岐条件文字列は不変 |
| `AC-2` | 設計要素B（reconcile.yml step-level 3分岐化 + skip ガード + permissions） | job-level `if` 撤回、API 問い合わせで実 PR 作成者確認 |
| `AC-3` | 設計要素A・B（第1分岐 `branch.pattern` 一致経路） | 通常 Issue ブランチは両ファイルとも `skip_checks=false`、挙動無回帰 |
| `AC-4` | 設計要素A・B（なりすまし耐性） | ci=作成者不一致で `exit 1`、reconcile=empty/不一致で `exit 1` |
| `AC-5` | 設計要素C（テンプレート正本同期）・設計要素D（テスト更新） | 本体2ファイル＝テンプレート正本2ファイルの完全一致維持、既存テストを新判定手段へ更新 |

## 責務・境界

### コンポーネント構成

- **設計要素A: ci.yml `Derive issue_id` ステップ**: env を `ACTOR: ${{ github.event.pull_request.user.login }}` に差し替える。ステップ内 3分岐（第1: `branch.pattern` 一致で `skip_checks=false`／第2: `ACTOR == dependabot[bot]` かつ `BRANCH == dependabot/*` で `skip_checks=true`／第3: `exit 1`）のロジック構造・比較文字列は現行を維持し、比較対象 env の由来のみを変える。責務は「PR 作成者とブランチ名から `issue_id` と `skip_checks` を導出する」ことに限定。
- **設計要素B: reconcile.yml `Derive issue_id` ステップ + 照合ステップ + permissions**: job-level `jobs.reconcile.if` の早期スキップを撤回し、`Derive issue_id` を ci.yml と同型の step-level 3分岐にする。第2分岐で `gh api "repos/$REPO/pulls?head=$OWNER:$BRANCH&state=open" --jq '.[0].user.login // empty'`（env `GH_TOKEN: ${{ github.token }}`、`REPO=github.repository`、`OWNER=github.repository_owner`）により実 PR 作成者を問い合わせ、`dependabot[bot]` 一致時のみ `skip_checks=true`、不一致/empty で日本語理由付き `exit 1`。`Reconcile gates against pushed SHA` ステップに `if: steps.ctx.outputs.skip_checks != 'true'` を付与。`permissions` に `pull-requests: read` を追加（PR 検索 API に必要）。
- **設計要素C: テンプレート正本同期**: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`・同 `-reconcile.yml` へ設計要素A・Bと 1バイト差異なく同一変更を適用。
- **設計要素D: 単体テスト更新・追加**: `test/unit/dependabot-ci-skip.test.ts` の「reconcile: `jobs.reconcile.if` が `dependabot[bot]` と `dependabot/` を参照して除外する」アサーションを撤去し、新判定手段（`jobs.reconcile` に `if` 早期スキップが無い／`Derive issue_id` が3分岐で API の PR 作成者を `dependabot[bot]` と比較／照合ステップに `skip_checks != 'true'` の `if`／`permissions` に `pull-requests: read`／判定に `github.actor` を用いない）を固定するアサーションへ置換する。本体＝テンプレート完全一致テストはそのまま維持。加えて、静的パースのみでは bash 実行結果（終了コード・`GITHUB_OUTPUT`）を検証できないギャップを埋めるため、`test/unit/dependabot-ci-skip-exec.test.ts` を新設する。同テストは両ワークフローの `Derive issue_id` の `run` 本文を YAML から抽出し、GitHub Actions 相当（`bash -e -o pipefail`・`GITHUB_OUTPUT` ファイル）で実行して、(a) 通常 Issue ブランチ、(b) Dependabot 起源 PR、(c) Dependabot 起源 PR への人間の追加 push、(d) 人間による `dependabot/` ブランチ名偽装、(e) `branch.pattern` 衝突型 `dependabot/223-fake` の各シナリオの終了コードと出力を実測する。ci の `ACTOR` は YAML の env 式を解決して注入するため、env 由来を `github.actor` へ戻す退行はシナリオ (c) の失敗として機械検出される。reconcile の `gh api` は PATH 上のモック `gh`（固定の PR 作成者を返す）で置換する。

### 境界（責務外）

- 許可条件そのもの（`dependabot[bot]` / `dependabot/` 始まり）の再定義はしない。
- `agent-skill-chain / gate` job の修正はしない（スコープ外）。
- reconcile の PR 作成者確認を API 問い合わせ以外の手段で行わない。

### OWNER の導出（spec-gate 指摘 `<owner>` 未確定点への回答）

reconcile 第2分岐の `head=<owner>:<branch>` の `<owner>` は `github.repository_owner`（組織/ユーザー名のみ、リポジトリ名を含まない）を env `OWNER` として導出する。`github.repository`（`owner/repo` 形式）は API パスの `repos/$REPO` に用い、`head` フィルタの owner とは別値である点を区別する。

### 依存関係

```text
設計要素A(ci本体) ─┐
設計要素B(reconcile本体) ─┼→ 設計要素C(テンプレート正本同期) → 設計要素D(テスト更新) → verify-template-sync / npm test
                          └→ GitHub REST API (repos/{repo}/pulls, permissions: pull-requests:read)
```

循環依存なし。外部依存は GitHub REST API（`gh api`、`github.token`）のみ。

## 検討した代替案: GitHub Ruleset bypass による Dependabot 免除（不採用）

「本リポジトリはブランチ保護を GitHub Rulesets（`main-protection`、required_status_checks 等）で行っているため、Ruleset の bypass list に Dependabot を登録すれば、ci.yml / reconcile.yml 内の手製 Dependabot 判定ロジック自体が不要になるのではないか」という代替案を、GitHub 公式ドキュメント（一次情報）で検証した。

- **bypass list が制御する範囲**: 公式ドキュメント About rulesets（https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets）は bypass を「When you create a ruleset, you can allow certain users to bypass the rules in the ruleset.」と定義する。すなわち bypass は「ルール（push/マージのブロック等のサーバーサイド強制）の適用免除」であり、GitHub Actions ワークフローの実行有無・job/step の終了コード・Actions 上の成功/失敗表示には関与しない。
- **Dependabot は bypass actor として登録可能**: Creating rulesets for a repository（https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository）は bypass を付与できる対象として「Repository admins, organization owners, and enterprise owners」「The maintain or write role, or custom repository roles based on the write role」「Teams, excluding secret teams」「GitHub Apps」に加えて「Dependabot」を明示的に列挙しており、登録自体は可能である。
- **required_status_checks ルールの意味**: Available rules for rulesets（https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets）は「After enabling required status checks, all required status checks must pass before collaborators can merge changes into the branch or tag.」と定める。すなわち本ルールは「チェック結果が失敗のままではマージできない」というマージ可否ゲートであり、チェック（ワークフロー）自体の実行・成否は独立に決まる。

**不採用の理由**: 本 Issue の障害モードは「`Derive issue_id` ステップの bash が exit 1 し、`ci`（verify job）・`reconcile` の各 job が失敗する（Check Run が failure になる）」ことであり、マージ可否判定より手前の、ワークフロー実行そのものの失敗である。Ruleset bypass はサーバーサイドのルール強制免除であってワークフローの実行・終了コードに一切関与しないため、bypass を設定しても job の失敗（赤い失敗表示・Check Run failure）は消えず、根本原因は解消されない。さらに bypass はマージ等の操作を行う actor 本人に適用される免除であるところ、本リポジトリの Dependabot PR のマージは人間の進行役が行うため、Dependabot に bypass を与えても人間のマージ操作には適用されない。以上より、Ruleset bypass は本問題を部分的にも解決せず、ワークフロー内部の判定基準を「push 実行者」から「PR/ブランチの起源」へ是正する本設計が引き続き必要である。

## 関連ADR

なし（本 Issue は Issue #215 で導入した CI 判定ロジックのバグ修正であり、セグメント仕様変更・新規 ADR を伴わない。上記代替案の不採用判断は本 Issue に固有のため本 DESIGN 内に自己完結して記載する）。

## 障害・ロールバック考慮

- **想定失敗モード1（GitHub API 障害・rate limit・ネットワーク断）**: reconcile 第2分岐の `gh api` が非0終了した場合、コマンド置換の結果 `PR_AUTHOR` は空文字列となる。空文字列は `dependabot[bot]` に不一致のため `skip_checks=true` にならず、第2分岐末尾の日本語理由付き `exit 1`（実測 `PR_AUTHOR` を「なし」と表示）へ落ちる。すなわち API 不確実性は常に安全側（照合を回避させない・reconcile を失敗させる）へ倒れ、なりすまし許可を生まない。
- **想定失敗モード2（本物の Dependabot PR に対する一時的 API 失敗で reconcile が偽陰性 fail）**: 正規 Dependabot ブランチでも API 失敗時は `exit 1` となり得るが、reconcile は push 冪等であり再 push・再実行で回復可能。安全側倒れを優先し、リトライは本 Issue のスコープに含めない。
- **想定失敗モード3（本体とテンプレート正本の不一致）**: 片方のみ変更した場合 verify-template-sync および本体＝テンプレート完全一致テストが fail し、CI で機械検知される。
- **ロールバック手順**: 本変更は本体2・テンプレート2・テスト2（既存更新1＋実行テスト新設1）の計6ファイル差分に閉じる。当該 commit の revert で全ファイルが同時に旧実装（`github.actor` ベース）へ戻り、部分適用状態は生じない。
- **影響を受ける既存機能**: 通常 Issue ブランチ経路（第1分岐）は入力・出力とも不変（AC-3）。Dependabot 起源 PR への人間同期 push 経路のみ挙動が是正される。
