# PLAN: 並列テスト中のnpm pack用ビルドがCLI成果物を競合更新する

- Issue: `ISSUE-279`
- 対応する DESIGN: `DESIGN.md`

## 目的・入力・出力

承認済みSPECとDESIGNを入力とし、隔離package probe、既存package契約の移行、決定論的race/cleanup
回帰テスト、保存済み検証ログを出力する。各単位は同一writer leaseのもとで順に実装する。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 隔離probe | source/依存の物理copy、timeout付きnpm、JSON parse、合成error、finally cleanup | AC-1, AC-2, AC-5 | なし |
| 2 | package契約移行 | 既存2テストをasync helperへ接続し必須/禁止集合を保持 | AC-1, AC-2 | #1 |
| 3 | race回帰 | entered/release、両側timeout、finally release、join/killで元CLI不変を検査 | AC-1, AC-3 | #1 |
| 4 | failure回帰 | prepare失敗、cleanup失敗、複合失敗のerror/path証跡とtest側回収を検査 | AC-5 | #1 |
| 5 | 変更範囲検証 | package統合テスト、lint統合テスト、型検査を実行 | AC-1, AC-2, AC-3, AC-5 | #1〜#4 |
| 6 | 全体反復 | 既定`npm test`を3回以上実行しログを別ファイルへ保存 | AC-4 | #5 |
| 7 | 独立検証 | ACごとの結果・手順・executor・evidenceをVALIDATIONへ記録 | AC-1〜AC-5 | #6 |

## checkpoint とwriter lease

- design: `DESIGN.md`、`PLAN.md`、proposed ADRをcommit/pushし、read-only gateを通す。
- ADR finalization: design承認digestを保ったまま専用leaseでstatusだけをacceptedへ更新する。
- implementation: helperとtestだけをcommit/pushし、変更範囲・全体検査を通す。
- validation: implementation writerと分離したleaseで検証ログと`VALIDATION.md`をcommit/pushする。

## テスト適用性

- 常時必須: 文書/語彙/参照lint、型検査、単体テスト、変更範囲の結合テスト、secret scan。
- API・認証・DB・画面・性能・デプロイ・外部サービス: product境界を変更しないため非該当。
- 障害系: npm process失敗時のcleanupとerror伝播を自動検査する。
- 並行性: 二相marker、timeout、release/join/killでschedulerの偶然とhangへ依存させない。
- リリース単位: package公開そのものは行わず、実際の`npm pack --dry-run --json`で収録契約を検査する。

## 完了条件・見直し

全変更単位、AC証跡、3回以上の全テストログ、Draft PRへのcheckpointが揃えば完了する。
作業順序だけの変更はPLANを更新する。snapshot境界、cleanup owner、package契約を変更する場合は
DESIGNを更新し、設計ゲートを再通過する。
