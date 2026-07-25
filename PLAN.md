# PLAN: human adapterの復帰案内と実行可能なWorkflow入口を一致させる

- Issue: `ISSUE-278`
- 対応する DESIGN: `DESIGN.md`

## 目的・入力・出力

承認済みSPEC/DESIGNを入力とし、trusted manual workflow、context/verdict発行command、
human通知、配布同期、回帰テストを出力する。変更は同一writer leaseで順に実施する。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | context検証 | PR・repository・head SHA・branch・gate・artifact pathを検証 | AC-2, AC-4 | なし |
| 2 | trusted発行 | 共通final導出とconfig由来Check名でCheck Runを発行 | AC-3, AC-4 | #1 |
| 3 | 手動workflow | dispatch入力、最小権限、default branch build、target fetchを追加 | AC-1〜AC-4 | #1, #2 |
| 4 | human通知 | eventからPR番号を解決し実在workflow commandを通知 | AC-1, AC-5 | #3 |
| 5 | 配布同期 | templateと展開先を同一内容にする | AC-5 | #3 |
| 6 | 変更範囲テスト | 正常/stale/closed/external/bad gate/bad verdict/pendingを検査 | AC-1〜AC-5 | #1〜#5 |
| 7 | 全体検証 | 型・全test・lint・secret・template syncを実行しログ保存 | AC-1〜AC-5 | #6 |

## テスト適用性

- 常時必須: lint/format、型検査、単体、変更範囲結合、SAST、依存・secret scan。
- API・権限境界: gh stubでAPI応答、Checks発行先、外部PR、stale SHA、最小permissionsを検査する。
- 運用・障害復旧: workflow dispatch入力とadapter通知の完全一致、API/fetch失敗を検査する。
- 外部連携: 実GitHub APIはPR上のworkflow構文・権限を確認し、破壊的な実Check発行は行わない。
- 画面、DB、性能、アクセシビリティ: 対象境界を変更しないため非該当。
- リリース単位: 全体E2Eと配布後の実repository dispatchは統合時に確認する。

## checkpoint・完了条件・見直し

- design checkpoint後、read-only design gateで責務・権限・反例を検査する。
- implementationではSPEC/DESIGN/PLANを変更せず、各変更単位と自動テストをcommit/pushする。
- validationでは保存ログと全AC証跡を`VALIDATION.md`へ記録する。
- 順序だけの変更はPLANを更新する。信頼境界、入力、Check発行規則の変更はDESIGN再承認を要する。
