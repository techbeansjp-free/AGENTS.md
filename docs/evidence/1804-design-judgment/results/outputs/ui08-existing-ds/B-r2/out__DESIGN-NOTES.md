# 設計メモ：請求先の編集画面

| 判断 | 対応先 |
|---|---|
| ヘッダー・ナビを `members.html` と同じ構成にし、「請求先」を `aria-current="page"` にした | DESIGN-SYSTEM「ヘッダーとナビは全画面で同じ構成」 |
| 色・余白・書体は `tokens.css` の変数のみ。`billing.css` にも色値・書体名を書いていない。Webフォント・外部読込なし | DESIGN-SYSTEM 1項、BRIEF 制約、FONTS.md |
| `.app-header` `.page` `.card` `.btn` `.field` `.alert` `.badge` を再利用。既存ファイルは未変更 | DESIGN-SYSTEM 2項、BRIEF 制約 |
| 全入力に見える `label`。誤りは `aria-invalid` と `.field__error`（`aria-describedby` で結合）で項目の近くに表示 | DESIGN-SYSTEM 3項、BRIEF「項目の近くに示す」 |
| 誤りの文言は「何をどう直すか」（例：7桁の数字、例示つき）。入力値は消さない（再描画しない） | BRIEF 画面の要件 |
| 画面上部に誤りの一覧（項目へのリンク付き）を出し、最初の誤り項目へフォーカス移動 | BRIEF（誤りの把握しやすさ）。補助的な追加 |
| 必須／任意を `.badge` の文言で明示（色だけに頼らない） | BRIEF の必須・任意、DESIGN-SYSTEM 4項の考え方 |
| 保存中はボタンを `disabled`＋「保存中…」、二重送信も script で防止 | BRIEF 保存中の要件 |
| 成功／失敗は `.alert--success` / `.alert--danger` に、「保存しました」「保存に失敗しました」の文言で区別。`role="status"` で読み上げ。失敗時も入力は保持 | DESIGN-SYSTEM 4項、BRIEF |
| 模擬保存：1秒後に成功、`fail@example.com` は失敗 | BRIEF |
| `?role=viewer`：入力欄を `readonly`、保存ボタンを無効化し、理由と対処を画面上部に表示（ボタンに `aria-describedby`） | BRIEF 閲覧権限の要件 |
| 閲覧権限の通知は既存 `.alert` に中立の変種がないため、`billing.css` に `.alert--notice` を追加（トークンのみ）。共通部品は変更していない | `components.css` の「画面固有は画面のCSSへ」 |
| 郵便番号は全角数字も受け付け（NFKC正規化）、ハイフン任意。電話番号は仕様がないため形式検査をしていない | BRIEF（仕様外は厳しくしない） |
| フォーム幅は640pxに制限。タッチしやすい高さ（44px）は既存部品のまま | `--content-max` 内、既存 `.btn`/`.field__input` |

## 未確認
ブラウザでの実表示確認は行っていない（コード上の確認のみ）。
