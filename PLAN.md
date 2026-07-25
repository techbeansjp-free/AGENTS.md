# PLAN: release bump のbase更新競合を再同期・再試行して自動統合を継続する

- Issue: `ISSUE-266`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 競合識別と限定再試行 | `Base branch was modified` だけを判定し、再同期・再検査・同一PRへの一度だけのmerge再試行を追加する。 | `AC-1`, `AC-2`, `AC-4` | なし |
| 2 | 競合再現用GitHubスタブ | PR作成後のmerge時にmainを進めるテスト制御と、成功mergeをmainへ反映するテスト制御を追加する。 | `AC-1`, `AC-3` | #1 |
| 3 | 結合テスト | 実競合でのbranch再構築・同一PR再試行・最新mainへのtag・Release作成までを検証する。 | `AC-1`, `AC-2`, `AC-3`, `AC-4` | #1, #2 |
| 4 | 全体検証 | typecheck、release統合テスト、全テスト、artifact/gate検査を実行しVALIDATIONへ証跡を残す。 | `AC-1`, `AC-2`, `AC-3`, `AC-4` | #1, #2, #3 |

## 実装順序の見直しについて

テスト制御は本番のGitHub操作に影響しないhelperに限定する。本番コードの再試行上限や安全側停止条件を変更する必要が生じた場合は、先にDESIGN.mdの責務と障害時契約を更新する。
