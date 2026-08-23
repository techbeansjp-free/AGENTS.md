# CLI・GitHub契約

CLIは引数を構造化入力として受け、適用を伴う操作は既定でdry-runとする。外部プロセスは引数配列で呼び、`gh`操作は`src/adapters/github.js`だけに閉じ込める。

| 境界 | 事前確認 | 適用 | 適用後確認 |
|---|---|---|---|
| Issue同期 | 認証、完全なrepository同一性、staging構造 | create/edit | Issue番号、repository、本文hashを再読取 |
| PR作成 | 認証、base/head、HEAD SHA、同一SHAの証拠 | `Relates to #824`で作成 | URL、base/head、headRefOidを再読取 |
| merge | 既定branch上policy、branch保護、check、approval | 許可されたmethodで実行 | merged SHAと状態を再読取 |

GitHubエラーは秘密情報を伏字化し、日本語で行動可能な診断を返す。
