# 請求先の編集画面：設計メモ

| 設計判断 | 対応する根拠 |
|---|---|
| `tokens.css`・`components.css` をそのまま読み込み、色・余白・書体は変数のみ使用。`billing.css` にも色の値・書体名は書かない（書体は `--font-sans` 経由で、FONTS.md の閲覧環境書体に含まれる） | DESIGN-SYSTEM.md 1項、BRIEF「既存のデザインシステムに従う」「外部URLから読み込まない」 |
| ヘッダー・ナビは `members.html` と同一構成。`aria-current="page"` を「請求先」に移した | DESIGN-SYSTEM.md 5項 |
| `.page` / `.card` / `.btn--primary` / `.field` / `.alert` を再利用。既存ファイルは未変更 | DESIGN-SYSTEM.md 2項、BRIEF 制約 |
| 画面専用の最小限のCSS（2列配置、操作行、閲覧専用の案内枠、読取専用の入力欄）だけを `billing.css` に置いた | components.css 冒頭「画面固有の見た目は画面のCSSへ」、BRIEF「必要なら billing.css」 |
| 全項目に見えるラベルを付け、必須／任意をラベル内の文言で明示（色だけに頼らない）。形式・文字数の条件は入力前にヒントで提示 | DESIGN-SYSTEM.md 3項、BRIEF 入力項目 |
| 誤りは項目直下の `.field__error` に「何をどう直すか」を文言で表示。`aria-invalid` と `aria-describedby` で結び付け。入力値は消さず、最初の誤り項目にフォーカス。上部の `.alert--danger` に件数を表示 | DESIGN-SYSTEM.md 3項、BRIEF「どの項目をどう直せばよいか」「入力した内容は消さない」 |
| 検証はブラウザー標準の吹き出しに任せず `novalidate` で自前表示（文言と位置を統一するため）。郵便番号は全角数字・全角ハイフンも許容し、ハイフンは任意 | BRIEF 入力項目 |
| 保存中はボタンを `disabled` にしラベルを「保存中…」へ。送信処理側でも二重送信を防止。`aria-busy` を付与 | BRIEF「保存中は保存ボタンを押せない状態」 |
| 成功・失敗は `.alert--success` / `.alert--danger` で、文言（「保存しました」「保存に失敗しました」）でも区別。失敗時は入力を保持し再試行を案内。`role=status` / `role=alert` で支援技術にも通知 | DESIGN-SYSTEM.md 4項、BRIEF 保存の成功・失敗 |
| 模擬保存：1秒後に成功、`fail@example.com` で失敗 | BRIEF 例示どおり |
| `?role=viewer` で入力欄を `readonly`（フォーカス・コピーは可能）にし、保存ボタンを無効化。画面上部に編集できない理由と次の行動（権限付与の依頼）を表示、ボタン脇にも理由を表示 | BRIEF 閲覧権限の状態 |
| 閲覧専用の案内には、既存の `.alert`（成功/失敗のみ）を流用せず、トークンのみで組んだ中立の `.billing-notice` を用意（エラーでも成功でもないため） | DESIGN-SYSTEM.md 4項（`.alert` は成功・失敗用）、トークンのみ使用 |
| 狭い画面では2列を1列に切替。入力欄は既存どおり高さ44px以上 | components.css（`.field__input`/`.btn` の最小高さ） |

## 留意点
- 電話番号は任意で、形式の指定が依頼にないため形式検査をしていない（要望があれば追加可能）。
- 初期値と保存処理は模擬。実装時はAPIに置き換える。
- 実ブラウザーでの目視確認は行っていない（静的に確認）。
