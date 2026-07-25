# PLAN: npm testの間欠的失敗の原因調査・再発防止（テスト実行ログ保全の整備）

- Issue: `ISSUE-236`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | CI ログ保存 | `set -o pipefail` と `npm test 2>&1 | tee` で stdout/stderr を保存し、常時 artifact upload する workflow とテンプレートを更新 | `AC-1` | なし |
| 2 | 手動検証手順 | `TEST_POLICY.md` にログ保存、`VALIDATION.md` 証跡、テストファイル・テストケース・エラー・スタックトレースを含む Issue #236 追記、および四つの原因類型を評価する follow-up 手順を追加 | `AC-2`, `AC-3` | なし |
| 3 | 構造テスト | workflow の `pipefail` と always upload、ポリシーの必須契約を検査し、テスト失敗がマスクされないことを確認する unit test を追加 | `AC-1`, `AC-2`, `AC-3` | `#1`, `#2` |
| 4 | 検証 | 型検査、対象 unit test、全 `npm test`、CI artifact を確認して `VALIDATION.md` に記録 | `AC-1`, `AC-2`, `AC-3` | `#3` |

## 実装順序の見直しについて

変更単位 #1 と #2 は独立して実装できるが、構造テストは両方の確定内容を検査するため後続に置く。設計要素・責務・境界を変えずに順序だけを変更する場合はこの計画のみを更新する。
