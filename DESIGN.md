# DESIGN: Dependabot PR で verify/reconcile CI が issue_id 抽出失敗により恒久的に落ちる問題の修正

- Issue: `ISSUE-215`（由来・追跡のための参照。本設計の意味は本ファイル内で完結する）
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲

`agent-skill-chain / ci`（verify job）と `agent-skill-chain / reconcile`（reconcile job）が、Dependabot 生成ブランチ（`dependabot/...`、`{type}/{issue_id}-{slug}` 非適合）で「Derive issue_id」の `exit 1` により恒久失敗する不具合を、**Dependabot 限定の明示的許可リスト**によるスキップで是正する。Issue ブランチに対する既存挙動は不変とする。ブランチ命名規約（I4）の強制は維持し、規約違反者が検査を逃れる汎用スキップは採用しない。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1（verify job: Dependabot でビルド検証は実行・固有検査はスキップ） | 設計要素A（Derive issue_id の3分岐化 + `skip_checks` output）+ 設計要素B（固有検査群への `if:` 付与） | `npm ci/build/test` は分岐前に位置し無条件実行 |
| AC-2（reconcile job: Dependabot で早期スキップ） | 設計要素C（reconcile job のトリガーレベル `if:`） | job 全体を非実行にし失敗させない |
| AC-3（Issue ブランチの既存挙動が不変・許可リスト外は `exit 1` 維持） | 設計要素A の第1分岐（`skip_checks=false`）+ 第3分岐（`exit 1`） | 許可条件に非該当なら従来と同一経路 |
| AC-4（本体とテンプレート正本の同期） | 設計要素D（テンプレート正本2ファイルへの同一変更） | `verify-template-sync.sh` で機械検証 |

## 責務・境界

### 設計要素A: verify job「Derive issue_id」ステップの3分岐化
ブランチ名から issue_id 抽出を試み、結果を `skip_checks` output（`true`/`false`）で下流へ伝達する。分岐は排他かつ網羅：
- 第1分岐（抽出成功 `^ISSUE-[0-9]+$`）→ `issue_id` 設定・`skip_checks=false`（Issue ブランチの既存経路）
- 第2分岐（`ACTOR == 'dependabot[bot]'` かつ `BRANCH == dependabot/*` の**両方**）→ `issue_id` 空・`skip_checks=true`
- 第3分岐（上記いずれにも非該当）→ 日本語理由付きで `exit 1`（規約強制の維持）

許可リスト条件（アクター + ブランチ prefix）は本ステップ1箇所に集約する。`ACTOR` は `github.actor` を env 経由で受ける。

### 設計要素B: 固有検査群への `if:` 付与
「Derive issue_id」以降の全ステップ（verify-branch-name / verify-worktree-path / verify-template-sync / verify-artifacts / verify-ac-coverage / verify-adr / lint-vocab / lint-references / Fetch base branch for secret scan / lint-secrets / adr-lint）に `if: steps.ctx.outputs.skip_checks != 'true'` を付与する。既存 `if:`（`github.base_ref != ''`）を持つ2ステップは AND 併記する。`npm ci/build/test` と「Fetch base branch for diff-based checks」は分岐前のため変更しない。

設計判断（反証観点「10箇所前後の `if:` 重複 vs 1シェルスクリプトへの集約」への回答）: 個別ステップへの `if:` 付与を採用する。理由は (1) 各ステップは `.agent-skill-chain/ci/*.sh` への薄いラッパーで「1チェック1ステップ」を保ち、GitHub Actions UI 上で失敗チェック名がそのまま可視化される利点を維持できる、(2) 差分が「既存ステップへの1行追加」に留まり新規スクリプト追加より変更範囲・レビュー負荷が小さい、(3) 全ステップが同一 output を参照する一貫パターンで可読性低下は限定的。

### 設計要素C: reconcile job のトリガーレベル早期スキップ
`jobs.reconcile.if` に `!(github.actor == 'dependabot[bot]' && startsWith(github.ref_name, 'dependabot/'))` を付与し、Dependabot push で job 全体を非実行にする（非 Issue ブランチにはゲート整合の対象が存在しないため）。job 内「Derive issue_id」の `exit 1` ガードは二重の安全網として現状維持する。

### 設計要素D: テンプレート正本への同期
`.agent-skill-chain/templates/github/.github/workflows/` 配下の `agent-skill-chain-ci.yml`・`agent-skill-chain-reconcile.yml` にも設計要素A〜Cと**同一**の変更を適用する。配布元テンプレートが正本、`.github/` はその展開結果であり、両者の一致を `verify-template-sync.sh` が検査する。

### 境界・対象外
`agent-skill-chain-gate.yml`（secrets 未設定による別要因の恒久失敗）・`branch.pattern` 定義・Dependabot 以外の bot への拡張は対象外。4セグメント仕様自体の変更ではないため ADR は不要。

### 依存関係
```text
設計要素A（skip_checks output）→ 設計要素B（if: 参照）
設計要素C（独立）  設計要素D（A〜Cを本体・テンプレートで一致）
```
循環依存なし。

## 関連ADR

なし。本修正は agent-skill-chain 管理外ブランチへの CI 誤適用を是正するバグ修正であり、4セグメント・4ゲート仕様自体の変更を伴わないため ADR は作成しない（SPEC スコープ外に明記済み）。

## 障害・ロールバック考慮

- 想定失敗モード1（許可リストの過剰緩和）: Dependabot 以外の bot や偽装ブランチが固有検査を逃れるリスク。対策として、スキップ条件を「アクター識別子 `dependabot[bot]` の完全一致」**かつ**「ブランチ名 `dependabot/` prefix」の AND に限定し、いずれか一方のみでは第3分岐の `exit 1` に落ちる。`github.actor` は GitHub が付与する信頼済みコンテキストであり、任意ユーザーが `dependabot[bot]` を詐称できない。
- 想定失敗モード2（Issue ブランチの誤スキップ = 回帰）: 第1分岐が最優先で評価され、規約適合ブランチは必ず `skip_checks=false` となるため固有検査は従来どおり実行される。AC-3 の差分レビュー・run 観測で検証する。
- 想定失敗モード3（本体・テンプレート不一致）: `verify-template-sync.sh` が検出し verify job を失敗させる。設計要素D で同時修正し AC-4 で機械検証する。
- ロールバック手順: 本修正は該当2ファイル（+テンプレート2ファイル）への局所的 YAML 変更のみ。問題発生時は当該 PR/commit の revert で即座に修正前状態へ復帰でき、他コンポーネントへの波及はない。
- 影響を受ける既存機能: verify job の固有検査群の実行条件と reconcile job のトリガー条件のみ。`npm ci/build/test`・各 `.sh` スクリプト本体・`branch.pattern` 定義は不変。
