# PLAN: verify spec-bdd / verify design-diagram が本文中の正当な `<...>` パス変数表記を未置換プレースホルダと誤判定する不具合を修正する

- Issue: `ISSUE-461`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 判定ロジックの置き換え | `src/commands/verify.ts` に `TECHNICAL_TOKEN_RE` と `hasUnfilledPlaceholder()` を追加し、`specBdd()`・`designDiagram()` 内の5箇所の `UNFILLED_PLACEHOLDER_RE.test(...)` 呼び出しを `hasUnfilledPlaceholder(...)` に置き換える。エラーメッセージ文言・終了コード・検査項目構成は変更しない | `AC-1, AC-2, AC-3, AC-4, AC-5` | なし |
| 2 | 回帰テストの追加 | `test/integration/verify.test.ts` に、(a) Thenフィールドに正当なパス変数表記（例: `` `reviews/<gate>.yaml` ``）を含むが全項目実内容化済みのSPEC.mdが成功すること、(b) Thenフィールドの一部に説明的プレースホルダ（例: `<期待される結果>`）が残っている場合は従来通り検出されること、(c) DESIGN.mdの根拠フィールドに正当なパス変数表記を含むが判断・根拠が実内容化済みの場合に成功すること、を検証するテストケースを追加する。既存の `verify spec-bdd`/`verify design-diagram` のテスト（テンプレート丸ごと複製ケース含む）が変更後も全てパスすることを確認する | `AC-1, AC-2, AC-3, AC-4, AC-5` | `#1` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
