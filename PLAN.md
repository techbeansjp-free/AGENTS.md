# PLAN: project固有ポリシー(manifest.yaml登録文書)がsegment start経由でワーカーへ配布されない

- Issue: `ISSUE-326`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `src/lib/project-policy.ts` 新規作成 | manifest.yaml読込・スキーマ検証・`documents.common`＋`documents.roles.<segment>`のファイル内容解決を行う `loadProjectPolicyDocuments(root, segment)` を実装する。登録パスに対応する実ファイルが存在しない・読み取れない場合は `fs.readFileSync` の例外送出をそのまま呼び出し元へ伝播させ、自ら捕捉して空文字列等へフォールバックしない | `AC-1, AC-2, AC-3, AC-4, AC-6` | なし |
| 2 | `src/commands/segment.ts` 修正 | `start()` から `loadProjectPolicyDocuments` を呼び出し、返却された文書内容をワーカー起動プロンプトへ追加する。`loadProjectPolicyDocuments` が送出する例外は `start()` 内で捕捉せず、既存の `guard()`（`start()` の呼び出し元）が非0終了コードへ正規化する共通経路にそのまま委ねる | `AC-1, AC-2, AC-3, AC-6` | `#1` |
| 3 | 単体テスト追加（`test/unit/project-policy.test.ts` 新規） | manifest.yaml有無・documents.common・documents.roles.<segment>・スキーマ不正・登録文書の実体欠落（ファイル不在）の各ケースを検証する | `AC-1, AC-2, AC-3, AC-4, AC-6` | `#1` |
| 4 | `src/lib/project-policy.ts` へ `resolveContainedDocumentPath(projectDir, documentPath)` を追加 | DESIGN.mdの定義どおり、(1) 絶対パスを無条件拒否、(2) `path.resolve` の字句解決結果が `projectDir` 配下でなければ拒否、(3) `fs.realpathSync` によるsymlink解決結果が `fs.realpathSync(projectDir)` 配下でなければ拒否、のいずれにも該当しなければ実体パス（文字列）を返す。`loadProjectPolicyDocuments` は `documents.common`＋`documents.roles.<segment>` の各パスをこのヘルパーへ通してから内容を読み込むよう変更する | `AC-7` | `#1` |
| 5 | `loadProjectPolicyDocuments` へ実体パスの重複排除を追加 | `#4` が返す実体パスを `Set<string>` に蓄積し、既出の実体パスと一致する登録は文書内容を出力配列へ追加しない（`documents.common` と `documents.roles.<segment>` の連結順を維持したまま、実体パス単位で初出のみ採用する） | `AC-8` | `#4` |
| 6 | 単体テスト追加（`test/unit/project-policy.test.ts`） | `../` 脱出・絶対パス・`.agent-skill-chain/project/` 配下外を指すsymlinkの3パターンでAC-7の拒否を検証する。`documents.common`内の同一パス2重登録・`documents.common`と`documents.roles.<segment>`間の重複登録・表記違いの重複（`RULES.md` と `roles/../RULES.md`）・symlinkエイリアスによる重複の4パターンでAC-8の出力1回のみを検証する | `AC-7, AC-8` | `#4, #5` |
| 7 | 既存テスト確認・更新（`test/unit/segment.test.ts` 等） | 本リポジトリのmanifest.yamlが実在するため、`segment start` の出力を固定文字列で比較している既存テストがあれば、project policy文書追加後の出力に合わせて更新する | `AC-5` | `#2` |
| 8 | `npm test` 全件実行・確認 | 回帰なしを確認する | `AC-5` | `#1〜#7` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
