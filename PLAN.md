# PLAN: release bump が package-lock.json 不在の consumer project で必ず失敗する

- Issue: `ISSUE-243`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | stage 対象選択 | lockfile の実在に応じて `git add` 引数を構成する共有ヘルパーを追加する | AC-1, AC-2 | なし |
| 2 | bump 経路適用 | 新規 bump と main 基準の再構築の両経路で共有対象選択を使う | AC-1, AC-2 | #1 |
| 3 | 結合テスト | lockfile なしの既知ギャップを成功条件へ変え、lockfile ありの更新も明示確認する | AC-1, AC-2, AC-3 | #2 |
| 4 | 回帰検証 | 型検査、全テスト、artifact/AC coverage と PR CI を確認する | AC-1, AC-2, AC-3 | #3 |

## 完了条件

実在しない lockfile の pathspec を git に渡さず、両構成の CLI 結合テストが成功する。許可外ファイルを含む PR を拒否する既存テストも維持する。
