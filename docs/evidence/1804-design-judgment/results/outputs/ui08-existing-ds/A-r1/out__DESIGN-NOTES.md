# 設計メモ：請求先の編集（app/billing.html）

| 設計判断 | 対応する根拠 |
|---|---|
| `tokens.css`・`components.css` を読み込み、色・余白・書体はすべて変数経由。`billing.css`にも色の値・書体名は書かない | DESIGN-SYSTEM.md 1行目、制約「既存DSに従う」 |
| 部品は `.app-header` `.page` `.card` `.btn--primary` `.field` `.alert` を再利用。作り直しなし | DESIGN-SYSTEM.md 2行目 |
| ヘッダー・ナビは `members.html` と同一構成。`aria-current="page"`のみ「請求先」に付け替え | DESIGN-SYSTEM.md 5行目 |
| 全入力に見える`label`。必須/任意を文言（「（必須）」「（任意）」）で明示し、色だけに頼らない | DESIGN-SYSTEM.md 3行目、要件の入力項目 |
| 誤りは`aria-invalid`＋項目直下の`.field__error`（`aria-describedby`で結合）。「何をどう直すか」を文言で示す（例：7桁の数字、メール形式の例） | DESIGN-SYSTEM.md 3行目、要件「どの項目をどう直すか」 |
| 検証失敗時は入力値を消さない。上部に件数付きのエラー要約を出し、各項目へのリンクとフォーカス移動を行う | 要件「入力した内容は消さない」 |
| 検証は`novalidate`＋自前。ブラウザ標準の吹き出しだと文言・位置がDSと揃わないため | 要件、DESIGN-SYSTEM.md 3行目 |
| 保存中は`disabled`＋`aria-busy`＋「保存しています…」表示で二重送信防止 | 要件「保存中は押せない」 |
| 成功・失敗は`.alert--success`/`.alert--danger`＋太字の文言（「保存しました」「保存に失敗しました」）。`role=status`で読み上げ。失敗時は再試行の案内を添える | DESIGN-SYSTEM.md 4行目、要件 |
| 模擬保存：1秒後に成功、`fail@example.com`は失敗 | 要件 |
| `?role=viewer`では`fieldset disabled`で全入力を編集不可、保存ボタンも無効、理由と依頼先を`.alert`で上部に表示（ボタンに`aria-describedby`で関連付け） | 要件「編集できない理由を示した状態」 |
| 郵便番号は全角数字・ハイフン有無を許容して判定 | 要件「ハイフンは任意」 |
| 画面専用CSSは`billing.css`（フォーム幅、操作行の並び、無効時の入力欄表示）。共通CSSには追加しない | components.css冒頭コメント、制約 |
| 書体はトークンの`--font-sans`（Noto Sans CJK JP）のみ。外部読込みなし | 制約、FONTS.md |

## 補足・未確定事項
- 初期値は架空のサンプル。実際は保存済みの請求先を読み込む想定。
- 入力欄の無効時の見た目（背景を`--color-bg`、文字を`--color-text-muted`）はDSに規定がなく、`billing.css`で暫定対応。DSに取り込むかはDS管理者の判断。
- `.alert`のフォーカス表示（`--focus-ring`）も同様に画面側で補った。
- 要約`<fieldset>`のリセットはインラインstyleで行っている（色値なし）。
- ブラウザでの実機確認は未実施。
