# 設計メモ：請求先の編集画面

| 設計判断 | 対応する依頼・デザインシステム |
|---|---|
| `tokens.css`・`components.css` を読み込み、`.app-header` `.page` `.card` `.btn` `.field` `.alert` をそのまま使用。色・書体の値は書かず、画面専用の `billing.css` も `var(--…)` のみ | DESIGN-SYSTEM.md 1・2項、依頼「既存のデザインシステムに従う」 |
| ヘッダー・ナビは `members.html` と同じ構成。`aria-current="page"` を「請求先」へ移した（既存ファイルは未変更） | DESIGN-SYSTEM.md 5項、依頼「既存ファイルは変更しない」 |
| 全項目に見える `label`。必須/任意は文言で表示（色のみにしない）。形式の条件（50文字、7桁等）は `.field__hint` で入力前に提示 | DESIGN-SYSTEM.md 3項、依頼の入力項目 |
| 誤りは `aria-invalid` と項目直下の `.field__error`（`aria-describedby` で関連付け）。「どの項目をどう直すか」を文言にした。最初の誤り項目にフォーカス。入力値は消さない。入力し直すと該当項目の誤り表示を解除 | DESIGN-SYSTEM.md 3項、依頼「項目の近くに示す・内容は消さない」 |
| 画面上部に誤り件数の `.alert--danger` を出し、スクリーンリーダー向けに `role="alert"` で通知 | DESIGN-SYSTEM.md 4項 |
| 保存中はボタンを `disabled` にし、表示を「保存中…」に。二重送信も JS で防止。完了後に解除 | 依頼「保存中は押せない」 |
| 成功は `.alert--success`「保存しました」、失敗は `.alert--danger`「保存に失敗しました。入力内容は残っています…」。文言で区別。模擬：1秒後成功、`fail@example.com` は失敗 | DESIGN-SYSTEM.md 4項、依頼の保存要件 |
| `?role=viewer`：上部に理由を示す `.alert`、入力欄は `readonly`（`disabled` だと文字が薄く読めないため）、保存ボタンは無効化し隣に理由も表示 | 依頼「閲覧権限向けの状態」 |
| 郵便番号は全角・ハイフン有無を許容して正規化後に7桁判定。名称は文字数をコードポイントで数える。メールは簡易形式確認（`novalidate` で独自メッセージに統一） | 依頼の入力規則 |
| 郵便番号と電話番号のみ2列（640px以上）。他は1列で、狭い画面でも崩れない。タップ領域は既存 `.btn`/`.field__input` の44px | 既存部品の寸法、`billing.css` |
| 外部URLの読込みなし。書体は `--font-sans` 経由（Noto Sans CJK JP） | 依頼の制約、FONTS.md |
| `readonly` 用の見た目などは `billing.css` に限定し、`components.css` は変更しない | components.css 冒頭注記 |

## 未確認事項
- ブラウザでの実表示確認は行っていない（コード上の確認のみ）。
- 電話番号は任意で、形式検査は依頼にないため行っていない。
