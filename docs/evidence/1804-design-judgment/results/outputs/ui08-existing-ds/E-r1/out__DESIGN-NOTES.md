# 設計メモ：請求先の編集（app/billing.html）

| 設計判断 | 対応 |
|---|---|
| 既存ファイルは変更せず、`billing.html` と画面専用の `billing.css` だけを追加 | 依頼の制約 |
| ヘッダーとナビを `members.html` と同じ構成にし、「請求先」を `aria-current="page"` にした | DESIGN-SYSTEM「ヘッダーとナビは全画面で同じ構成」 |
| 色・余白・書体・角丸はすべて `var(--…)` で指定した。`billing.css` に色の値や書体名は書いていない | DESIGN-SYSTEM 1項、tokens.css |
| `.app-header` `.page` `.card` `.field` `.btn` `.alert` を再利用した | DESIGN-SYSTEM 2項 |
| 全項目に見える `label` を付けた。必須・任意をラベル内の文字で示した（色だけに頼らない） | DESIGN-SYSTEM 3項、依頼の入力項目 |
| 誤りは項目直下の `.field__error` に「何を・どう直すか」を書き、`aria-invalid` と `aria-describedby` で結んだ | DESIGN-SYSTEM 3項、依頼「どの項目をどう直せばよいか」 |
| 検証は `novalidate` とJSで行い、`maxlength` は使わなかった。超過しても入力は消さず、文字数付きで示す | 依頼「入力した内容は消さない」「50文字以内」 |
| 誤りがあるときは画面上部の `.alert--danger` に件数と一覧を出し、各項目へ移動できるリンクにした。最初の誤り項目へフォーカスを移す | 依頼、DESIGN-SYSTEM 4項 |
| 郵便番号は全角・ハイフンを許容して7桁の数字か確認する | 依頼「7桁の数字、ハイフンは任意」 |
| 保存中はボタンを `disabled` にして文言を「保存中…」に変える。二重送信も防ぐ。終了後に戻す | 依頼「保存中は押せない」、`.btn:disabled` |
| 成功・失敗は `.alert--success` / `.alert--danger` で、「保存しました」「保存に失敗しました」の文言で区別した。失敗時も入力は残す。`role=status` / `alert` で読み上げられる | DESIGN-SYSTEM 4項、依頼 |
| 保存は模擬：1秒後に成功。メールが `fail@example.com` なら失敗 | 依頼 |
| `?role=viewer` で全入力欄（`fieldset disabled`）と保存ボタンを無効にし、画面上部に理由と次の行動を文章で示した | 依頼「編集できない理由を示した状態」 |
| 閲覧用の案内に使う中立色の `.alert--neutral` を `billing.css` に追加した（既存の変種は成功・失敗のみ。`components.css` は変更不可）。色は既存トークンのみ | 依頼の制約、components.css の注記「画面固有の見た目は画面のCSSへ」 |
| ボタン・入力欄は既存の最小高44px。幅が狭い画面でも1カラムで崩れない | components.css の `.btn` `.field__input` |
| 書体は `--font-sans`（Noto Sans CJK JP）のまま。外部の書体・スクリプト・ライブラリは読み込まない | 依頼の制約、FONTS.md |

## 未確定・仮置き
- 電話番号は任意で、形式の確認はしていない（要件にないため）。
- メールアドレスの形式確認は簡易な正規表現。
- 保存処理は模擬で、実際の送信はしていない。
