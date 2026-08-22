# PLAN: worker・core gate review の reasoning 上限を high に統一する

- Issue: `ISSUE-814`
- 対応する DESIGN: `DESIGN.md`

## 目的・前提・制約

DESIGN.md の D1〜D7 を、正本の許可値、provider 別起動境界、証跡、fixture、回帰検証の順に同期する。現行 runtime の `xhigh` / `maximum_reasoning` 許可経路を原因箇所から削除し、新しい設定、例外分岐、fallback、互換フラグを追加しない。既存 ADR と固定 bootstrap ledger・command・fixture は変更しない。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | core policy 正本 | project manifest/schema、`CoreReviewPolicy` の reasoning tier と Codex effort を `high` にし、Strict・2体・model tier・read-only を保持する | AC-1, AC-2 | なし |
| 2 | worker 設定境界 | config schema、`ReasoningEffort` 型、worker CLI help/context を `medium | high` に閉じ、恒久 implementation 値 `high` を確認する | AC-4, AC-5 | なし |
| 3 | 登録済み規範文書 | `MODEL_TIER_TABLE.md` を provider 共通 `high` へ同期し、implementation role policy の `xhigh` 格上げ許可を削除する。ADR は編集しない | AC-1, AC-3, AC-4, AC-7 | #1, #2 |
| 4 | Codex 起動境界 | core tuple を完全一致で検証し、worker/non-core reviewer の config 外環境上書きも `medium | high` 以外は起動前に拒否する | AC-2, AC-4, AC-6 | #1, #2 |
| 5 | Claude 起動境界 | reasoning tier `high` attestation、runtime 固有 high probe、実在 model、read-only を検証し、旧 tier と未証明を `human_required` にする | AC-1, AC-3, AC-6 | #1 |
| 6 | evidence 境界 | recorder が Codex/Claude の reasoning と capability tier を `high` で記録し、verifier が protected policy と完全一致で検証する | AC-1〜AC-3, AC-6 | #4, #5 |
| 7 | 正負テスト・fixture | schema/type/context/adapter/evidence の成功例を `high` に同期し、旧値を各入力境界で拒否する負例を追加する | AC-1〜AC-6 | #1〜#6 |
| 8 | 歴史的境界と全体検査 | runtime 限定検索、ADR/bootstrap 無差分確認、typecheck、unit/integration、文書・静的検査を実行して証跡化する | AC-1〜AC-7 | #1〜#7 |

## 変更対象と非変更対象

変更対象は `.agent-skill-chain/config/agent-skill-chain.yaml` と schema、project manifest/schema、登録済み project policy 文書、worker/core review の型・context、Codex/Claude adapter、review evidence verifier、対応 test/fixture である。既に `high` の値を持つ asset は値を変更せず回帰検証する。汎用処理は旧値の許可・固定が実測された原因箇所だけを置換する。

非変更対象は `docs/adr/` 全体、bootstrap ledger・bootstrap command・固定証跡 fixture、完了済み履歴である。これらの `xhigh` / `maximum_reasoning` は履歴整合性のため残し、現行 runtime 検索の対象集合から明示的に分離する。新規 ADR は作成しない。

## テスト適用性と証跡

| 分類 | 適用 | 手順・期待結果 |
|---|---|---|
| lint / format・型検査 | 必須 | repository の lint/format と `npm run typecheck` が成功する |
| 単体テスト | 必須 | model/worker selection、schema、review evidence の正負ケースが成功する |
| 変更範囲の結合テスト | 必須 | worker context/adapter、core judgment/adapter/evidence、project policy fixture が成功する |
| SAST・secret・依存関係 | 必須 | repository の既存 verify 経路で新規検出がない |
| E2E・アクセシビリティ | 不要 | UI・ユーザー操作を変更しない |
| 契約・権限境界 | 必須 | Strict 2体、独立 slot、read-only、probe、attestation、旧値の fail-closed を自動検証する |
| 性能・DB・外部連携・デプロイ | 不要 | 性能経路、永続データ、外部 API 契約、配備を変更しない |

### 正例

- core Codex は `gpt-5.6-sol / high / read-only` で2 slot が成功し、evidence の reasoning と capability tier が `high` になる。
- core Claude は runtime 固有 model、`high` attestation、成功する high probe、read-only で2 slot が成功し、evidence の reasoning と capability tier が `high` になる。
- worker と non-core gate reviewer は `medium` または `high` で起動でき、恒久 implementation worker は `high` のままである。

### 負例

- project manifest の reasoning tier/Codex effort、worker config の effort が `xhigh` または `maximum_reasoning` なら schema validation が失敗する。
- Codex worker、non-core reviewer、core reviewer の環境上書きが旧値なら subprocess を起動せず失敗する。core は `human_required` を記録する。
- Claude core attestation/evidence が `xhigh` または `maximum_reasoning`、probe が未設定・失敗、model が provider 不一致なら起動・承認せず `human_required` となる。
- Codex/Claude evidence の reasoning または capability tier が旧値なら、他の model/read-only/digest が正しくても gate success にならない。
- rejected input が暗黙に `high` へ変換されず、fallback や互換フラグも生成されない。

### 静的・履歴証跡

- 現行 runtime の config/project policy/schema/adapter/worker・gate source と登録済み生きた文書を列挙した検索で、`xhigh` / `maximum_reasoning` の許可値・必須値・help がゼロであることを確認する。
- `git diff` の path 集合に `docs/adr/` と bootstrap ledger/command/fixture が含まれず、それらの既存内容が保持されることを確認する。
- AC-1〜AC-7 の test 名・command・終了コードを独立検証の証跡へ対応付ける。

## 障害時・ロールバック順序

不一致が出た場合は、例外を足さず policy/config 正本、context、adapter、recorder/verifier、fixture の順に最初の差異を修正する。回復不能時は変更単位 #1〜#7 を同一 checkpoint として revert し、`high` と旧値の混在を残さない。ADR/bootstrap は変更しないため rollback 操作の対象外である。

## 実装順序の見直しについて

作業順序だけを変える場合は PLAN.md を更新する。責務・境界・許可値を変える場合は SPEC.md と DESIGN.md を更新し、必要なゲートを再通過する。

## 完了条件・未決事項・対象外

AC-1〜AC-7 の自動証跡が揃い、Codex/Claude core `high` の成功、worker/non-core の上限 `high`、全経路での旧値拒否、Strict/read-only/fail-closed の不変、ADR/bootstrap 無差分を同時に実証することを完了条件とする。未決事項はない。Issue #798、model 世代変更、新規 adapter、歴史的成果物の改変は対象外である。
