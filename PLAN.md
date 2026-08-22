# PLAN: Codex core review の reasoning effort を high に固定する

- Issue: `ISSUE-814`
- 対応する DESIGN: `DESIGN.md`

## 目的・前提・制約

DESIGN.md の D1〜D5 を、policy 正本から伝播先、fixture、回帰検証の順に同期する。承認済み `SPEC.md` は変更せず、新しい設定、分岐、fallback、ADR、実装責務を追加しない。各変更単位の入力は直前単位で同期済みの tuple、出力は `gpt-5.6-sol / high / read-only` に揃った asset と自動証跡である。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | policy 正本 | `.agent-skill-chain/project/manifest.yaml`、project-policy schema、`CoreReviewPolicy` 型の Codex effort を `high` に置換し、Strict・2体・model・attestation を保持する | AC-1, AC-4 | なし |
| 2 | 規範文書 | `MODEL_TIER_TABLE.md` の Codex 行と proposed ADR-0009 の旧具体値を `high` に訂正する。新規 ADR は作らない | AC-1, AC-3, AC-4 | #1 |
| 3 | policy/context テスト | model-selection、self-extension policy、reviewer-context の期待値を同期し、schema が core `xhigh` を拒否する反例を追加する | AC-1, AC-3, AC-5 | #1 |
| 4 | adapter 正負テスト | attested `high` が read-only で成功し、model/read-only が正しくても `xhigh` は起動前に `human_required` となることを検証する | AC-2, AC-5 | #1 |
| 5 | evidence 正負テスト | 2体の `high` が記録・承認され、1体でも `xhigh` なら policy mismatch で `human_required` となることを検証する | AC-2, AC-5 | #1 |
| 6 | core fixture 同期 | gate-evidence、round-budget、gh-slurp の core/Strict evidence 引数を `high` にする。reachability 等の standard/non-core `xhigh` と bootstrap fixture は維持する | AC-2, AC-3, AC-4 | #3, #4, #5 |
| 7 | 汎用経路の確認 | gate command、launcher、Codex adapter、evidence verifier が policy 値を伝播・完全一致照合する既存実装を対象テストで確認し、ハードコードが実証された場合のみ原因箇所を置換する | AC-2, AC-4, AC-5 | #1〜#6 |
| 8 | 回帰・静的検査 | typecheck、対象 unit/integration、doc-length、vocab、reference、ADR、artifact/AC coverage、対象限定の旧値検索を実行して証跡化する | AC-1〜AC-5 | #1〜#7 |

## テスト適用性と証跡

| 分類 | 適用 | 手順・期待結果 |
|---|---|---|
| lint / format・型検査 | 必須 | repository scripts と `npm run typecheck` が成功する |
| 単体テスト | 必須 | model selection と review evidence の正負ケースが成功する |
| 変更範囲の結合テスト | 必須 | self-extension policy、reviewer context、adapter、evidence fixture が成功する |
| SAST・secret・依存関係 | 必須 | repository の既存 verify 経路で新規検出がない |
| E2E・アクセシビリティ | 不要 | UI・ユーザー操作を変更しない |
| 契約・権限境界 | 必須 | read-only、attestation、Strict 2体、mismatch の fail-closed を自動検証する |
| 性能・DB・外部連携・デプロイ | 不要 | 性能経路、永続データ、外部 API 契約、配備を変更しない |

対象限定検索では、manifest、schema、MODEL_TIER_TABLE、ADR-0009、model-selection 型、core-policy/context/adapter/evidence fixture に `xhigh` が旧必須値として残らないことを確認する。通常 worker の許容値、implementation override、standard/non-core fixture、bootstrap ledger、完了済み履歴に残る `xhigh` は失敗条件にしない。検証結果は `VALIDATION.md` の AC-1〜AC-5 に自動証跡として記録する。

## 障害時・ロールバック順序

policy mismatch が出た場合は例外分岐を足さず、最初にずれた正本・伝播先・fixture を同じ tuple へ直す。回復不能時は変更単位 #1〜#7 を同一 checkpoint として revert し、混在状態を残さない。remote push 前に失敗した場合は修正後に全対象検査を再実行する。

## 実装順序の見直しについて

実装中に作業順序だけを見直す場合は PLAN.md のみを更新する。設計要素・責務・境界を変更する場合は DESIGN.md を更新し、設計ゲートを再通過する。

## 完了条件・未決事項・対象外

全 AC の自動証跡が揃い、core `high` の成功と core `xhigh` の拒否を同時に実証し、非対象契約の回帰がないことを完了条件とする。未決事項はない。Claude model 選定、worker effort 値域、bootstrap 証跡、non-core reviewer、Issue #798 cleanup は対象外である。
