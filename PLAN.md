# PLAN: 強制可能なattested gate Check

- Issue: `ISSUE-283`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存 |
|---|---|---|---|---|
| 1 | #274契約取込 | v3 verifier、latest attempt、canonical aggregate/report型を共有APIとして取込む | AC-1, AC-3 | #274 |
| 2 | trust backend | dedicated AppとRequired Workflowの起動・再実行・ruleset強制を分離する | AC-2, AC-5 | #1 |
| 3 | recorder | workflow run tuple、context再取得、in_progress、attest、success-lastを実装する | AC-1〜AC-3 | #1, #2 |
| 4 | durable ledger | 48 KiB inlineまたは45,000 byte PR comment chunks+attested manifestへ保存する | AC-1, AC-2 | #3 |
| 5 | materializer | latest workflow tuple選択、manifest/App/attestation再検証、cache復元を実装する | AC-1, AC-2 | #4 |
| 6 | ADR連携 | GitHubモードの`adr finalize`がcache欠落時にmaterializerを必須実行する | AC-1 | #5 |
| 7 | fresh reconcile | previous head reportを復元し期待path集合と全digestを双方向比較する | AC-2, AC-4 | #5 |
| 8 | prepare | versioned environment/secret/workflowとlocal stagingを旧active系を変えず作る | AC-5 | #2〜#7 |
| 9 | activate | main smoke test後、ruleset digest CASの単一PUTで切替え、旧資産を保持する | AC-5 | #8 |
| 10 | bootstrap | #274固定keyをprepared→冪等merge/resume→completedへ二相遷移する | AC-6 | #1〜#9 |

## テスト設計

- unit: backend解決、workflow tuple順序、canonical manifest、結論写像、path集合差分、bootstrap状態機械。
- integration: wrong App/environment/ruleset、stale SHA、別Check replay、新しい非success、不完全latest attemptを反証する。
- attestation: signer workflow/ref/digest、run attempt、Check ID、subject digestの各一点改変を全て拒否する。
- reconcile: fresh checkoutで同一・追加・削除・改変・取得不能を検証し、下流無効化を確認する。
- boundary: 同時刻・in_progress・out-of-order応答、48 KiB境界、chunk 1 byte超過、4 MiB超過を検証する。
- distribution: local rename失敗、secret登録後ruleset失敗、CAS競合で旧active系とlocal byte列を維持する。
- required workflow: 証跡不足failure→同一run再実行→successと、custom Check単独ではmerge不可を検証する。
- regression: local backendを維持し、AI provider key・self-hosted runner参照が配布物へ混入しないことを検査する。
- hybrid: #274固定SHAのSol/xhigh PASS、非gate CI、owner承認、PR Review used-key、admin mergeを照合する。

## checkpointと完了判定

各変更単位をテストと同じcommitへまとめてpushする。#274が固定される前は共有契約の実装を開始しない。
全自動検証と独立implementation/validation gateが通り、App backendの実リポジトリsmoke test後にReadyへ遷移する。
順序だけの変更は本PLANを更新し、責務・信頼境界・backend変更はDESIGN再レビューを要求する。
