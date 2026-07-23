# DESIGN: Dependabot PR で verify/reconcile CI が issue_id 抽出失敗により恒久的に落ちる問題の修正

- Issue: `ISSUE-215`（由来・追跡のための参照。本設計の意味は本ファイル内で完結する）
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲

`agent-skill-chain / ci`（verify job）と `agent-skill-chain / reconcile`（reconcile job）が、Dependabot 生成ブランチ（`dependabot/...`、`{type}/{issue_id}-{slug}` 非適合）で「Derive issue_id」の `exit 1` により恒久失敗する不具合を、**Dependabot 限定の明示的許可リスト**によるスキップで是正する。Issue ブランチに対する既存挙動は不変とする。ブランチ命名規約（I4）の強制は維持し、規約違反者が検査を逃れる汎用スキップは採用しない。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1（verify job: Dependabot でビルド検証は実行・追跡系検査はスキップ・template-sync は非ブロッキング） | 設計要素A（Derive issue_id の3分岐化 + `skip_checks` output）+ 設計要素B1（追跡系固有検査群への `if:` 付与）+ 設計要素B2（verify-template-sync の `continue-on-error` 扱い） | `npm ci/build/test` は分岐前に位置し無条件実行 |
| AC-2（reconcile job: Dependabot で早期スキップ） | 設計要素C（reconcile job のトリガーレベル `if:`） | job 全体を非実行にし失敗させない |
| AC-3（Issue ブランチの既存挙動が不変・許可リスト外は `exit 1` 維持） | 設計要素A の第1分岐（`skip_checks=false`）+ 第3分岐（`exit 1`）+ 設計要素B2（Issue ブランチでは `continue-on-error=false`） | 許可条件に非該当なら従来と同一経路 |
| AC-4（本体とテンプレート正本の同期・Dependabot では可視化のみ） | 設計要素D（テンプレート正本2ファイルへの同一変更）+ 設計要素B2（乖離の可視化） | Issue ブランチはブロッキング検証、Dependabot は非ブロッキング可視化。恒久的自動同期は別 Issue |

## 責務・境界

### 設計要素A: verify job「Derive issue_id」ステップの3分岐化
ブランチ名から issue_id 抽出を試み、結果を `skip_checks` output（`true`/`false`）で下流へ伝達する。分岐は排他かつ網羅：
- 第1分岐（抽出成功 `^ISSUE-[0-9]+$`）→ `issue_id` 設定・`skip_checks=false`（Issue ブランチの既存経路）
- 第2分岐（`ACTOR == 'dependabot[bot]'` かつ `BRANCH == dependabot/*` の**両方**）→ `issue_id` 空・`skip_checks=true`
- 第3分岐（上記いずれにも非該当）→ 日本語理由付きで `exit 1`（規約強制の維持）

許可リスト条件（アクター + ブランチ prefix）は本ステップ1箇所に集約する。`ACTOR` は `github.actor` を env 経由で受ける。

### 設計要素B1: 追跡系固有検査群への `if:` 付与（完全スキップ）
「Derive issue_id」以降のうち **ブランチ・Issue 追跡に関する検査**（verify-branch-name / verify-worktree-path / verify-artifacts / verify-ac-coverage / verify-adr / lint-vocab / lint-references / Fetch base branch for secret scan / lint-secrets / adr-lint）に `if: steps.ctx.outputs.skip_checks != 'true'` を付与し、許可リスト該当時は**完全スキップ**する。既存 `if:`（`github.base_ref != ''`）を持つ2ステップは AND 併記する。`npm ci/build/test` と「Fetch base branch for diff-based checks」は分岐前のため変更しない。これらの検査は Issue ブランチの命名・成果物・追跡を前提とし、Dependabot ブランチには本質的に適用対象が存在しないため、スキップしても検出対象の欠落は生じない。

設計判断（反証観点「10箇所前後の `if:` 重複 vs 1シェルスクリプトへの集約」への回答）: 個別ステップへの `if:` 付与を採用する。理由は (1) 各ステップは `.agent-skill-chain/ci/*.sh` への薄いラッパーで「1チェック1ステップ」を保ち、GitHub Actions UI 上で失敗チェック名がそのまま可視化される利点を維持できる、(2) 差分が「既存ステップへの1行追加」に留まり新規スクリプト追加より変更範囲・レビュー負荷が小さい、(3) 全ステップが同一 output を参照する一貫パターンで可読性低下は限定的。

### 設計要素B2: verify-template-sync の `continue-on-error` 扱い（可視化のみ・非ブロッキング）
verify-template-sync ステップだけは B1 と扱いを変え、`if:` によるスキップは**付けず常に実行する**（Dependabot PR でも走らせる）。許可リスト該当時のみ `continue-on-error: ${{ steps.ctx.outputs.skip_checks == 'true' }}` を付与し、失敗しても job 全体を失敗させない「非ブロッキング・可視化のみ」の扱いにする。Issue ブランチ（`skip_checks=false`）では `continue-on-error` が `false` に評価され、従来どおり失敗が job を落とす（回帰なし）。

B1 と扱いを分ける理由: 追跡系検査は Dependabot ブランチに適用対象が無い（スキップは正しい）のに対し、本体・テンプレート正本の乖離検出は Dependabot PR でこそ意味を持つ。`.github/dependabot.yml` は `package-ecosystem: github-actions` を設定しており、その更新 PR は `.github/workflows/*.yml`（agent-skill-chain-ci.yml 等 6 ファイル）のバージョン pin を書き換える一方、Dependabot の github-actions スキャンは `.github/workflows/` のみを対象とし `.agent-skill-chain/templates/github/.github/workflows/` 配下のテンプレート正本は更新しない。この乖離を verify-template-sync の完全スキップで緑化してしまうと、乖離が無検査のまま週次で静かに進行する。`continue-on-error` により「PR の CI はブロックしないが、失敗は GitHub Actions UI 上に赤×として可視化し続ける」ことで、この静かな進行を防ぐ。npm-ecosystem の Dependabot PR（typescript・@types/node。`.github/workflows/` を触らない）は元々差分が無く素直に成功する。

### 設計要素C: reconcile job のトリガーレベル早期スキップ
`jobs.reconcile.if` に `!(github.actor == 'dependabot[bot]' && startsWith(github.ref_name, 'dependabot/'))` を付与し、Dependabot push で job 全体を非実行にする（非 Issue ブランチにはゲート整合の対象が存在しないため）。job 内「Derive issue_id」の `exit 1` ガードは二重の安全網として現状維持する。

### 設計要素D: テンプレート正本への同期
`.agent-skill-chain/templates/github/.github/workflows/` 配下の `agent-skill-chain-ci.yml`・`agent-skill-chain-reconcile.yml` にも設計要素A・B1・B2・Cと**同一**の変更を適用する。配布元テンプレートが正本、`.github/` はその展開結果であり、両者の一致を `verify-template-sync.sh` が検査する。

### 境界・対象外
`agent-skill-chain-gate.yml`（secrets 未設定による別要因の恒久失敗）・`branch.pattern` 定義・Dependabot 以外の bot への拡張は対象外。4セグメント仕様自体の変更ではないため ADR は不要。

### 依存関係
```text
設計要素A（skip_checks output）→ 設計要素B1（if: 参照）/ 設計要素B2（continue-on-error 参照）
設計要素C（独立）  設計要素D（A・B1・B2・Cを本体・テンプレートで一致）
```
循環依存なし。

## 関連ADR

なし。本修正は agent-skill-chain 管理外ブランチへの CI 誤適用を是正するバグ修正であり、4セグメント・4ゲート仕様自体の変更を伴わないため ADR は作成しない（SPEC スコープ外に明記済み）。

## 障害・ロールバック考慮

- 想定失敗モード1（許可リストの過剰緩和）: Dependabot 以外の bot や偽装ブランチが固有検査を逃れるリスク。対策として、スキップ条件を「アクター識別子 `dependabot[bot]` の完全一致」**かつ**「ブランチ名 `dependabot/` prefix」の AND に限定し、いずれか一方のみでは第3分岐の `exit 1` に落ちる。`github.actor` は GitHub が付与する信頼済みコンテキストであり、任意ユーザーが `dependabot[bot]` を詐称できない。
- 想定失敗モード2（Issue ブランチの誤スキップ = 回帰）: 第1分岐が最優先で評価され、規約適合ブランチは必ず `skip_checks=false` となるため固有検査は従来どおり実行される。AC-3 の差分レビュー・run 観測で検証する。
- 想定失敗モード3（本体・テンプレート正本の乖離）: 本修正コミット時点の乖離は設計要素D の同時修正で解消し AC-4 で機械検証する。継続運用での乖離検出は、Issue ブランチでは verify-template-sync が従来どおりブロッキングで検出・job 失敗させる（設計要素B2 で `continue-on-error=false`）。Dependabot PR では設計要素B2 により verify-template-sync を非ブロッキング（可視化のみ）とする。
  - 反証観点への回答（design-gate 指摘: 「Dependabot の github-actions 更新は `.github/workflows/*.yml` を書き換えるがテンプレート正本は更新されないため、verify-template-sync を Dependabot PR で完全スキップすると本体とテンプレート正本が無検査のまま週次で乖離していく」）: この妥協案が「無検査のまま乖離が進行する」リスクを許容範囲に収める根拠は次のとおり。(1) **完全スキップではなく可視化のみ**——`if:` でステップ自体を skipped にする案を採らず、ステップは常に実行し `continue-on-error` で失敗を非ブロッキングにする。乖離があれば verify-template-sync は実際に失敗し、GitHub Actions UI 上に赤×として残り続けるため、乖離は「無検査」ではなく「検査済みかつ可視、ただし PR を自動ブロックしないだけ」の状態になる。(2) **ブロック判断を人間へ委ねる**——Dependabot PR のマージは人間（またはブランチ保護下の判断）が行う。可視化された赤×を見た人間が、テンプレート正本の手動同期を行ってからマージするか、乖離を承知でマージするかを判断できる。乖離の解消機会は失われない。(3) **Issue ブランチの回帰は皆無**——`skip_checks=false` では `continue-on-error` が `false` となり従来と完全に同一のブロッキング挙動を保つため、本システムの正規フローでの同期強制は一切弱まらない。(4) **恒久対策は別 Issue**——本 Issue のスコープでは Dependabot の github-actions 更新に伴うテンプレート正本の自動同期（逆方向同期の仕組み）は実装せず、SPEC スコープ外に明記し別 Issue 起票を要求する。すなわち本設計は「静かな乖離」を「可視な乖離＋人間の判断機会＋恒久対策の追跡」に置き換えるものであり、完全スキップ案が持つ「気付かれない乖離」のリスクは負わない。
- ロールバック手順: 本修正は該当2ファイル（+テンプレート2ファイル）への局所的 YAML 変更のみ。問題発生時は当該 PR/commit の revert で即座に修正前状態へ復帰でき、他コンポーネントへの波及はない。
- 影響を受ける既存機能: verify job の固有検査群の実行条件と reconcile job のトリガー条件のみ。`npm ci/build/test`・各 `.sh` スクリプト本体・`branch.pattern` 定義は不変。
