# PLAN: gate submit-evidenceがMarkdownコードフェンス付きverdict JSONを解釈できない

- Issue: `ISSUE-303`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `stripJsonCodeFence`関数を追加 | `src/commands/gate.ts`にフェンス除去関数を実装 | `AC-1`〜`AC-4` | なし |
| 2 | `submit-evidence`の解釈箇所を差し替え | `JSON.parse(verdictText)` を `JSON.parse(stripJsonCodeFence(verdictText))` へ変更 | `AC-1`〜`AC-4` | `#1` |
| 3 | 回帰テスト追加 | フェンス無し・```json```フェンス・言語指定無しフェンス・除去後も不正なJSONの4パターンを検証するテストを追加 | `AC-1`〜`AC-4` | `#1, #2` |
| 4 | 検証 | `npm run build`・`npm test` | `AC-1`〜`AC-4` | `#1, #2, #3` |

## 実装順序の見直しについて

実装中に作業順序のみを見直す場合は本ファイルのみを更新する。
