# PLAN: 配布AGENTS.mdにupgradeコマンドの正確な起動構文が記載されていない

- Issue: `ISSUE-298`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 配布正本AGENTS.mdへ追記 | `.agent-skill-chain/templates/AGENTS.md` の `## GitHub配布・マルチAI対応` 段落末尾へupgrade起動構文の1文を追記 | `AC-1`, `AC-2` | なし |
| 2 | 本リポジトリ展開結果を同期 | ルート `AGENTS.md` を `#1` と同一内容へ更新 | `AC-3` | `#1` |
| 3 | 回帰テスト追加 | 配布正本にコマンド文字列が含まれることを固定化するテストを追加 | `AC-1` | `#1` |
| 4 | 検証 | `npm run build`・`verify doc-length`・`verify template-sync`・`npm test` | `AC-1`〜`AC-3` | `#1, #2, #3` |

## 実装順序の見直しについて

実装中に作業順序のみを見直す場合は本ファイルのみを更新する。
