# PLAN: project固有ポリシー(manifest.yaml登録文書)がsegment start経由でワーカーへ配布されない

- Issue: `ISSUE-326`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `src/lib/project-policy.ts` 新規作成 | manifest.yaml読込・スキーマ検証・`documents.common`＋`documents.roles.<segment>`のファイル内容解決を行う `loadProjectPolicyDocuments(root, segment)` を実装する。登録パスに対応する実ファイルが存在しない・読み取れない場合は `fs.readFileSync` の例外送出をそのまま呼び出し元へ伝播させ、自ら捕捉して空文字列等へフォールバックしない | `AC-1, AC-2, AC-3, AC-4, AC-6` | なし |
| 2 | `src/commands/segment.ts` 修正 | `start()` から `loadProjectPolicyDocuments` を呼び出し、返却された文書内容をワーカー起動プロンプトへ追加する。`loadProjectPolicyDocuments` が送出する例外は `start()` 内で捕捉せず、既存の `guard()`（`start()` の呼び出し元）が非0終了コードへ正規化する共通経路にそのまま委ねる | `AC-1, AC-2, AC-3, AC-6` | `#1` |
| 3 | 単体テスト追加（`test/unit/project-policy.test.ts` 新規） | manifest.yaml有無・documents.common・documents.roles.<segment>・スキーマ不正・登録文書の実体欠落（ファイル不在）の各ケースを検証する | `AC-1, AC-2, AC-3, AC-4, AC-6` | `#1` |
| 4 | 既存テスト確認・更新（`test/unit/segment.test.ts` 等） | 本リポジトリのmanifest.yamlが実在するため、`segment start` の出力を固定文字列で比較している既存テストがあれば、project policy文書追加後の出力に合わせて更新する | `AC-5` | `#2` |
| 5 | `npm test` 全件実行・確認 | 回帰なしを確認する | `AC-5` | `#1, #2, #3, #4` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
