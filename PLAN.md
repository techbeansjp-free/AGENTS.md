# PLAN: gate submit-evidenceがverdict JSON前後の説明文・tool-call試行テキストを解釈できない

- Issue: `ISSUE-312`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `extractFirstJsonObject`関数を実装 | `src/commands/gate.ts`に中括弧対応関係抽出ロジックを実装（`stripJsonCodeFence`を置換） | `AC-1`〜`AC-6` | なし |
| 2 | `submit-evidence`の解釈箇所を差し替え | `JSON.parse(stripJsonCodeFence(verdictText))` を `JSON.parse(extractFirstJsonObject(verdictText))` へ変更 | `AC-1`〜`AC-6` | `#1` |
| 3 | 回帰テスト追加 | 素のJSON・フェンス付き（#303回帰防止）・前置文あり・後置文あり・リテラル内中括弧・抽出後も不正、の6パターンを検証するテストを追加 | `AC-1`〜`AC-6` | `#1, #2` |
| 4 | 検証 | `npm run build`・`npm test` | `AC-1`〜`AC-6` | `#1, #2, #3` |

## 実装順序の見直しについて

実装中に作業順序のみを見直す場合は本ファイルのみを更新する。
