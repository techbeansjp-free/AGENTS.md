# DESIGN: コア監査のモデル選択を Sol xhigh 必須へ更新する

- Issue: `ISSUE-271`
- 対応する SPEC: `SPEC.md`

## 目的・対象・前提

本設計は、自己拡張 project policy にコア独立レビューの能力契約を置き、対象分類から adapter 起動までを一方向に接続する。通常作業や consumer project へ Sol/xhigh を一律強制せず、ポリシーが存在する本リポジトリだけで追加制約を有効にする。

前提は、GitHub モードの監査区分が PR label、ローカルモードの監査区分が `state.yaml` に存在し、変更作業は base と target SHA の Git 差分を取得できることである。分類不能は「通常」と推測せず、コア対象の可能性が未解決として安全側に停止する。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | project policy manifest / `MODEL_TIER_TABLE.md` | 機械値と自己完結した説明をともに manifest の規範へ登録 |
| AC-2 | model-selection classifier / reviewer context / launcher | Git 差分と backend 正本の監査区分から core 判定、strict 検査 |
| AC-3 | Codex adapter policy guard | `gpt-5.6-sol` / `xhigh` / read-only を検証 |
| AC-4 | Claude adapter policy guard | `--model` と環境能力証明・reasoning probe を分離 |
| AC-5 | launcher / adapter fail-safe / gate workflow | `human_required` と `action_required` 以外へ降格しない |
| AC-6 | policy absent/non-core 分岐 | 従来の adapter 既定・明示上書きを維持 |
| AC-7 | schema / labels / workflow template sync / policy・adapter tests | 正本と展開結果、旧メモ、実装を同期 |

## 責務・境界

### project policy

`.agent-skill-chain/project/manifest.yaml` に次を追加し、`policy_version` を更新する。

- `ordinary.behavior: explicit_selection`: 非コア作業は既存の明示選択を尊重する。
- `core_review.capability`: `frontier_coding` と `maximum_reasoning` をベンダー中立な必須能力とする。
- `core_review.triggers`: GitHub label、ローカル state 値、コア資産の exact path / path prefix。
- `core_review.adapters`: Codex の固定値、Claude の環境入力名と能力証明、human の停止挙動。
- `core_review.required_profile: strict` と `unavailable: human_required`。

`.agent-skill-chain/project/MODEL_TIER_TABLE.md` は旧参考メモから登録済み規範へ変更し、対象、能力、adapter 別表現、失敗時挙動、通常作業を自己完結して説明する。manifest の構造化値が機械入力、文書が人間向け契約となり、テストで一致を拘束する。

### model-selection classifier

新しい `src/lib/model-selection.ts` が次だけを担う。

1. 現在の worktree にある project policy manifest を schema 検証後に読む。
2. 明示監査区分が `core_audit` ならコア対象とする。
3. base と target SHA の `git diff --name-only` を取得し、exact path または path prefix に一致すればコア対象とする。
4. policy 不在は通常作業、差分分類不能は `required=true` かつ `status=unresolved` とする。

対象パターンはコードへ重複ハードコードしない。classifier は manifest 値のみを解釈する。

### backend ごとの監査区分

- GitHub: `review:core-audit` PR label が正本。workflow が event の labels から `core_audit` を導出して launcher へ渡す。
- ローカル: `state.yaml` の任意 `review_subject: core_audit` が正本。未設定は `ordinary` として後方互換にする。
- 変更差分によるコア分類は両 backend 共通で、監査区分が未設定でも作動する。

環境変数は backend 正本の値を同一プロセスへ渡す輸送路であり、別の状態正本にはしない。

### reviewer context と launcher

`gate reviewer-context` は既存値に加え、分類状態、必須 profile、ベンダー中立能力、adapter 固有要求値を KEY=VALUE で返す。`gate-launch-reviewer.sh` は target SHA、base ref、監査区分を context へ渡し、次を検査する。

- context 解決失敗または分類未解決: gate report を `human_required` にして非成功。
- コア対象かつ profile が strict でない: `human_required`。
- コア対象: 検証済み要求値を選択 adapter へ環境入力として渡す。
- 非コア対象: 新しい固定値を注入せず既存経路を維持する。

### Codex adapter

コア対象では model を `gpt-5.6-sol`、`model_reasoning_effort` を `xhigh` に固定し、read-only sandbox で `codex exec` を構築する。上書き値が固定値と異なる場合は起動前に `human_required`。テスト用・外部 wrapper の完全上書きは、固定値を使用するという専用 attestation が揃う場合だけ許可する。CLI・認証・モデル可用性の失敗は既存 lifecycle が `human_required` にする。

非コア対象では現在の `CODEX_REVIEWER_MODEL` / `CODEX_REVIEWER_REASONING_EFFORT` と既定値を維持する。

### Claude adapter

Claude Code へ Codex のモデル名や `model_reasoning_effort` 設定を渡さない。公式 CLI が提供する `--model` で、実行環境が `CLAUDE_CORE_REVIEW_MODEL` に宣言した実在モデルを選ぶ。次の全入力を要求する。

- model tier attestation が `frontier_coding`
- reasoning tier attestation が `maximum_reasoning`
- reasoning probe command が成功し、実行環境固有の最大利用可能 reasoning 設定を確認できる
- model 名が空でなく、OpenAI 固有 slug ではない

可搬な Claude Code reasoning flag を仮定しない。上記 probe を実装できない環境では自動レビュー不能として `human_required` にする。非コア対象では、既存 command override を維持し、任意の `CLAUDE_REVIEWER_MODEL` があれば公式 `--model` で明示選択を反映する。

### workflow と配布

gate workflow は checkout を完全履歴にし、base ref と PR label 由来の監査区分を context / launcher へ渡す。自己拡張 project policy が GitHub コアレビューに Codex を指定した場合は、公式 `openai/codex-action@v1` を read-only sandbox / safety strategy で起動する。Action が Codex CLI の導入と Responses API proxy を担うため、利用者が一度だけ登録する入力は repository secret `OPENAI_API_KEY` だけである。

Standard は Codex Action 1回、Strict は同じ head SHA と prompt に対する独立 Action 2回を起動する。trusted CLI は verdict 配列の個数を期待 reviewer 数と照合し、全 verdict が pass/pass の場合だけ approved、1件でも fail または blocking finding があれば rejected、欠落・不正・inconclusive は `human_required` とする。これにより既存 `reviewer_count: 2` を単なる表示値で終わらせない。

Claude が選択された GitHub/ローカル経路は既存 launcher と Claude 固有 `--model` / attestation / probe を維持し、Codex Action の model・effort 入力を流用しない。認証が無い場合、コア対象だけは `action_required` Check Run を発行し、通常作業経路は別 Issue の責務と衝突させない。テンプレート正本と展開済み `.github/` は同時更新する。labels 正本へ `review:core-audit` を追加する。

workflow の credential 検査と通常 adapter 起動では、解決済み adapter に対応する provider secret だけを環境へ渡す。Claude process に `OPENAI_API_KEY`、Codex process に Anthropic credential を渡さず、provider 間の認証境界を維持する。

## 依存関係

```text
project policy manifest
  → model-selection classifier
  → gate reviewer-context
  → GitHub core: official Codex Action × reviewer_count → trusted verdict aggregation
  → other paths: gate-launch-reviewer → selected adapter policy guard
  → existing read-only review lifecycle
  → gate report / Check Run
```

GitHub label とローカル state は同じ `review_subject` 意味へ正規化されるが、相互同期はしない。

## 設定・schema・後方互換の判断

- ハードコード不可理由: コア対象パターンと provider mapping は project と実行環境で異なり、adapter 内固定だけでは manifest 優先順位と通常作業を表現できない。
- project 単位差: 本リポジトリの自己拡張だけがコア対象を持ち、consumer project は policy 不在で従来動作を維持する。
- schema: project-policy schema に任意 `model_selection`、state schema に任意 `review_subject` を追加する。
- 既定値: `model_selection` 不在および `review_subject` 未設定は通常作業。既存 manifest/state はそのまま有効。
- migration: 追加フィールドはいずれも任意で既存値の意味を変えないため schema namespace は v1 のまま。自己拡張 manifest の `policy_version` だけを更新する。
- ADR: provider 名とベンダー中立能力を分離し、実行環境証明を fail-closed にする長期判断を proposed ADR として記録する。

## セキュリティ・障害・ロールバック考慮

- 想定される失敗モード: base ref 不在、policy/schema 不適合、label 輸送漏れ、モデル値の不一致、`OPENAI_API_KEY` 未設定、Codex Action失敗、Strict verdict欠落、Claude reasoning probe 不在、CLI/認証/モデル利用不能、command override による検証回避。
- 安全側挙動: 分類不能と能力未証明はすべて `human_required`。コア対象に `neutral` や `success` を発行しない。
- command 境界: 値は既知 KEY と固定 enum だけを context から抽出する。credential や probe 出力はログへ出さない。
- ロールバック手順: manifest の `model_selection`、classifier/context 連携、adapter guard、state 追加、workflow/label を同一 PR で戻す。任意フィールドのため既存データ migration の巻き戻しは不要。
- 影響を受ける既存機能: 自己拡張リポジトリのコア gate review と監査 label。非コア reviewer、worker model 選択、consumer project は既定で不変。

## 完了条件・検証

- manifest schema と登録文書の一致、core/non-core/audit/unresolved 分類を単体テストする。
- reviewer context、strict 拒否、Codex Action exact mapping、Strict 2-verdict集約、Claude attestation/probe、通常上書き、human_required を結合テストする。
- workflow の core credentialless 経路が `action_required` で、テンプレートと展開先が一致することを静的検査する。
- lint、型検査、全単体・結合テスト、SAST、依存関係・secret scan を実行する。

## 未決事項・対象外

- 未決事項はない。
- Claude の具体的モデル slug と reasoning 設定方式を本規範で固定すること、通常作業を一律高コスト化すること、provider の品質を文字列から推測することは対象外。

## 関連ADR

```yaml
related_adrs: []
```
