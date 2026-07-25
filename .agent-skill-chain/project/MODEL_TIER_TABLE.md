# コア独立レビューのモデル選択ポリシー

## 目的・対象・入力

本書は agent-skill-chain 自身のコア変更とコア監査に使う独立 gate reviewer のモデル選択を定める。`.agent-skill-chain/project/manifest.yaml` に登録された project policy であり、旧参考メモではない。

入力は target SHA の変更ファイル、監査区分、review profile、選択 adapter、その adapter のモデル・reasoning 設定である。出力は自動 reviewer の検証済み起動、または `human_required` である。

## コア対象の判定

コア変更は manifest の `model_selection.core_review.triggers.exact_paths` または `path_prefixes` に一致する差分を持つ変更である。対象には憲法、project policy、状態・ゲート・adapter・script・CI・GitHub 配布物、CLI の command/lib、package 配布定義が含まれる。

コア監査はコード差分の有無にかかわらず、Coordination Backend に `core_audit` が明示された監査である。GitHub モードは `review:core-audit` PR label、ローカルモードは `state.yaml` の `review_subject: core_audit` を使う。両 backend の状態を同期しない。

差分を分類できない場合は通常作業と推測せず、コア対象の可能性が未解決として `human_required` にする。

## ベンダー中立な必須能力

コア対象は `review_profile: strict` を必要とし、各独立 reviewer に次の能力を要求する。

- model tier: `frontier_coding`
- reasoning tier: `maximum_reasoning`
- permission: read-only
- 利用不能・不一致・未証明: `human_required`

能力名は provider をまたぐ契約であり、他 provider のモデル slug や CLI 設定キーを流用する意味ではない。

## adapter 別の表現と検証

| adapter | model | reasoning | 検証 |
|---|---|---|---|
| Codex | `gpt-5.6-sol` | `xhigh` | `codex exec -m` と `model_reasoning_effort` を厳密照合し、read-only sandbox で起動 |
| Claude Code | 実行環境が `CLAUDE_CORE_REVIEW_MODEL` に宣言した実在モデル | 実行環境の最大利用可能 reasoning | `--model`、`frontier_coding` / `maximum_reasoning` attestation、reasoning probe 成功を必須化 |
| human | 自動モデルなし | 自動 reasoning なし | 自動承認せず `human_required` |

Claude Code には Codex の `gpt-5.6-sol` や `model_reasoning_effort=xhigh` を渡さない。Claude Code の可搬な model 指定は `--model` を使う。最大 reasoning の設定方法は実行環境で異なるため、adapter は model tier と reasoning tier の宣言に加え、専用 probe が実際の最大設定を確認できた場合だけ起動する。具体的 Claude model 名を本書から推測しない。

Codex の完全 command override は `CODEX_CORE_REVIEWER_ATTESTED=true` と固定 model/effort の一致を必要とする。Claude の model 名が空、OpenAI 固有 slug、能力証明不足、probe 不在または失敗の場合は起動しない。

## GitHub 自動レビュー

自己拡張 project の GitHub コアレビューは Codex adapter を選び、公式 `openai/codex-action@v1` を使う。Action が Codex CLI の導入と Responses API proxy を担当する。利用者が一度だけ登録する設定は repository secret `OPENAI_API_KEY` であり、モデル名・reasoning・CLI install の repository variable は要求しない。

Action には `model: gpt-5.6-sol`、`effort: xhigh`、`sandbox: read-only`、`safety-strategy: read-only` を明示する。Strict profile は同じ target SHA を別プロセスで2回レビューし、trusted CLI が2件の構造化 verdict を集約する。全件が conformance/falsification とも pass の場合だけ承認し、件数不足・不正JSON・inconclusive は `human_required`、1件でも fail または blocking finding があれば rejected とする。

`OPENAI_API_KEY` が未登録または Action が利用不能なら `action_required` を発行する。secret 登録後の PR push から自動レビューを再開し、継続的な人間操作を要求しない。Claude adapter を選ぶ環境では前節の Claude 固有 model/attestation/probe を使い、Codex Action の入力を混用しない。

## 通常作業・完了条件・対象外

コア変更でもコア監査でもない通常作業は、依頼者または実行環境の明示的なモデル・reasoning 選択と既存 adapter 既定を尊重する。consumer project に `model_selection` が無い場合も従来動作を維持する。

classifier、reviewer context、launcher、adapter、公式 Codex Action、Strict verdict集約、workflow、policy schema、template sync の自動テストが成功し、コア利用不能経路が `success` や `neutral` にならないことを完了条件とする。

対象外は、通常作業の一律 Sol/xhigh 化、provider 間のモデル名共有、モデル品質の文字列推測、API model migration、価格・context 制限の規定である。

## 外部公式根拠

- OpenAI Codex manual: `gpt-5.6-sol` と `xhigh`、CLI の `--model` / `model_reasoning_effort`
- OpenAI GPT-5.6 model guidance: `gpt-5.6` alias と Sol、reasoning effort
- OpenAI Codex Action: `openai/codex-action@v1`、`OPENAI_API_KEY`、model / effort / read-only inputs
- Anthropic Claude Code CLI reference: `--model`。provider 間で同一の reasoning flag が保証されないため本ポリシーは環境 probe を要求する
