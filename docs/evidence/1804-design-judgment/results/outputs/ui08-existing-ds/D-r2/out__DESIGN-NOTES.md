# 設計メモ：請求先の編集画面

| 設計判断 | 対応する根拠 |
|---|---|
| `billing.html` は `tokens.css`→`components.css`→`billing.css` の順に読み込み、既存ファイルは変更していない | 依頼の制約 |
| ヘッダー・ナビは `members.html` と同じ構成にし、「請求先」に `aria-current="page"` を付けた | DESIGN-SYSTEM「ヘッダーとナビは全画面で同じ構成」 |
| 部品は `.page` `.card` `.field` `.btn--primary` `.alert` のみ使用。`billing.css` は幅・並び・必須/任意表示・無効入力欄の見た目だけで、色・余白は全て `var(--…)` | DESIGN-SYSTEM「トークンの変数だけを使う」「部品を作り直さない」 |
| 全入力欄に見える `label`。必須/任意は色だけでなく「必須」「任意」の文字で示す | DESIGN-SYSTEM（見える label）、依頼の入力項目 |
| 誤りは項目直下の `.field__error` に「何を・どう直すか」を書き、`aria-invalid` と `aria-describedby`（ヒント＋エラー）で結び付け。最初の誤り項目にフォーカス | DESIGN-SYSTEM、依頼「項目の近くに示す」 |
| 検証は `novalidate` で自前実行（名称50文字以内、メール形式、郵便番号は7桁数字でハイフン任意）。誤りがあっても入力値は消さない | 依頼の入力項目・「入力した内容は消さない」 |
| 検証結果の概要と保存の成功・失敗は `.alert--danger/--success` を `role="status"` 領域に表示し、文言（「保存しました」「保存に失敗しました」）で区別 | DESIGN-SYSTEM「通知は .alert、文言で区別」、依頼 |
| 保存中はボタンを `disabled`＋「保存中…」、フォームに `aria-busy`。送信ガードで二重送信も防止。模擬保存は1秒後に成功、`fail@example.com` は失敗 | 依頼「保存中は押せない」「模擬でよい」 |
| `?role=viewer` では全入力欄と保存ボタンを無効化し、理由と依頼先を `.alert--danger` で表示（`.alert` に警告色がないため既存の danger を流用） | 依頼「編集できない理由を示した状態」 |
| 書体は `--font-sans`（Noto Sans CJK JP）のまま。外部読込みなし、スクリプトは画面内のインラインのみ | 依頼の制約、FONTS.md |
| 操作領域は `.btn` / `.field__input` の高さ44px、フォーカスは既存の `--focus-ring` を利用 | components.css の既存定義 |

## 未対応・留意点
- 閲覧権限の状態は `.alert--danger` を流用した。警告・情報用の `.alert` バリアントがデザインシステムに無いため。必要なら別途デザインシステム側への追加を検討してほしい。
- ブラウザーでの実表示確認は行っていない（コードの静的確認のみ）。
