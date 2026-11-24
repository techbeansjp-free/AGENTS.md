# 管理画面のデザインシステム

- 色・余白・書体・角丸・影は `tokens.css` の変数だけを使う。画面のCSSで色の値（`#...`、`rgb()`等）や書体名を直接書かない。
- 部品は `components.css` のクラス（`.app-header`、`.page`、`.card`、`.btn`、`.field`、`.alert`、`.badge`、`.table`）を使う。同じ役割の部品を画面ごとに作り直さない。
- 入力欄には見える`label`を付け、誤りは`aria-invalid`と項目の近くの`.field__error`で示す（`aria-describedby`で結び付ける）。
- 成功・失敗の通知は`.alert`を使い、色だけでなく文言で区別する。
- ヘッダーとナビゲーションは全画面で同じ構成にする（`members.html`を参照）。
