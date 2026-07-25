# PLAN: 強制可能なattested gate Check

- Issue: `ISSUE-283`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存 |
|---|---|---|---|---|
| 1 | #274契約取込 | v3 verifier、latest attempt、canonical aggregate/report型を共有APIとして取込む | AC-1, AC-3 | #274 |
| 2 | trust backend | App/environment/rulesetとRequired Workflow sourceを解決・検証する | AC-2, AC-5 | #1 |
| 3 | recorder | context再取得、in_progress作成、envelope、attest、success-last更新を実装する | AC-1〜AC-3 | #1, #2 |
| 4 | durable output | canonical full reportと全provenance digestをCheck `output.text`へ保存する | AC-1, AC-2 | #3 |
| 5 | materializer | all-conclusion latest選択、App・attestation再検証、cache原子復元を実装する | AC-1, AC-2 | #4 |
| 6 | ADR連携 | GitHubモードの`adr finalize`がcache欠落時にmaterializerを必須実行する | AC-1 | #5 |
| 7 | fresh reconcile | previous head reportを復元し期待path集合と全digestを双方向比較する | AC-2, AC-4 | #5 |
| 8 | 配布 | protected environment setup、ruleset動的描画、workflow/root/template同期を実装する | AC-5 | #2〜#7 |
| 9 | 原子的更新 | init/upgrade preflight・staging・rollbackと非対応環境の無変更停止を実装する | AC-5 | #8 |
| 10 | bootstrap | #274固定PR/SHA/digestの一回限りReview証跡とused-key検査を実行する | AC-6 | #1〜#9 |

## テスト設計

- unit: backend解決、最大Check ID、canonical envelope、結論写像、path集合差分、bootstrap used-key。
- integration: wrong App/environment/ruleset、stale SHA、別Check replay、新しい非success、不完全latest attemptを反証する。
- attestation: signer workflow/ref/digest、run attempt、Check ID、subject digestの各一点改変を全て拒否する。
- reconcile: fresh checkoutで同一・追加・削除・改変・取得不能を検証し、下流無効化を確認する。
- distribution: preflight失敗時byte-identical、成功時root/template/ruleset同期、`checks: write`漏れ無しを検証する。
- regression: local backendを維持し、AI provider key・self-hosted runner参照が配布物へ混入しないことを検査する。
- hybrid: #274固定SHAのSol/xhigh PASS、非gate CI、owner承認、PR Review used-key、admin mergeを照合する。

## checkpointと完了判定

各変更単位をテストと同じcommitへまとめてpushする。#274が固定される前は共有契約の実装を開始しない。
全自動検証と独立implementation/validation gateが通り、App backendの実リポジトリsmoke test後にReadyへ遷移する。
順序だけの変更は本PLANを更新し、責務・信頼境界・backend変更はDESIGN再レビューを要求する。
