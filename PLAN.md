# PLAN: 自己拡張ポリシーの必須資産・追跡規則と実リポジトリを整合させる

- Issue: `ISSUE-245`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | project policy 定義 | manifest、RULES、登録文書の責務を現行構成に揃える | AC-1, AC-2 | なし |
| 2 | GitHub-native lifecycle 文書化 | 成果物を branch で追跡する方針と close の条件を明記する | AC-2, AC-3 | #1 |
| 3 | ignore ルールの明文化 | transient と追跡成果物の境界を `.gitignore` に記録する | AC-3 | #2 |
| 4 | 隔離 lifecycle 検証 | worktree 作成、checkpoint、PR 記録、merge を自動テストする | AC-1, AC-3, AC-4 | #1, #2, #3 |

## 実装順序の見直しについて

文書と ignore ルールを先に確定してから、同じ規約を隔離環境で実行する。テスト失敗時は規約と実際の Git 挙動のどちらが不一致かを判定して修正する。
