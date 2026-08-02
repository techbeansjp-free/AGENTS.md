# PLAN: project固有ポリシー(manifest.yaml登録文書)がsegment start経由でワーカーへ配布されない

- Issue: `ISSUE-326`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `src/lib/project-policy.ts` 新規作成 | manifest.yaml読込・スキーマ検証・`documents.common`＋`documents.roles.<segment>`のファイル内容解決を行う `loadProjectPolicyDocuments(root, segment)` を実装する。manifest.yaml自体の読込は `fs.existsSync` による事前チェックを使わず、`readYamlFile(manifestPath)` の呼び出しをtry/catchし `error.code === 'ENOENT'` の場合のみ空配列を返す（AC-3）。`ENOENT` 以外（`EACCES`等）はcatch節で再送出しAC-4(c)へ委ねる。登録パスに対応する実ファイルが存在しない・読み取れない場合は `fs.readFileSync` の例外送出をそのまま呼び出し元へ伝播させ、自ら捕捉して空文字列等へフォールバックしない | `AC-1, AC-2, AC-3, AC-4, AC-6` | なし |
| 2 | `src/commands/segment.ts` 修正 | `start()` から `loadProjectPolicyDocuments` を呼び出し、返却された文書内容をワーカー起動プロンプトへ追加する。`loadProjectPolicyDocuments` が送出する例外は `start()` 内で捕捉せず、既存の `guard()`（`start()` の呼び出し元）が非0終了コードへ正規化する共通経路にそのまま委ねる | `AC-1, AC-2, AC-3, AC-6` | `#1` |
| 3 | 単体テスト追加（`test/unit/project-policy.test.ts` 新規） | manifest.yaml有無・documents.common・documents.roles.<segment>・スキーマ不正・登録文書の実体欠落（ファイル不在）の各ケースを検証する | `AC-1, AC-2, AC-3, AC-4, AC-6` | `#1` |
| 4 | `src/lib/project-policy.ts` へ `resolveContainedDocumentPath(projectDir, documentPath)` を追加 | DESIGN.mdの定義どおり、(1) 絶対パスを無条件拒否、(2) `path.resolve` の字句解決結果が `projectDir` 配下でなければ拒否、(3) `fs.realpathSync` によるsymlink解決結果が `fs.realpathSync(projectDir)` 配下でなければ拒否、のいずれにも該当しなければ実体パス（文字列）を返す。`loadProjectPolicyDocuments` は `documents.common`＋`documents.roles.<segment>` の各パスをこのヘルパーへ通してから内容を読み込むよう変更する | `AC-7` | `#1` |
| 5 | `loadProjectPolicyDocuments` へ実体パスの重複排除を追加 | `#4` が返す実体パスを `Set<string>` に蓄積し、既出の実体パスと一致する登録は文書内容を出力配列へ追加しない（`documents.common` と `documents.roles.<segment>` の連結順を維持したまま、実体パス単位で初出のみ採用する） | `AC-8` | `#4` |
| 6 | 単体テスト追加（`test/unit/project-policy.test.ts`） | `../` 脱出・絶対パス・`.agent-skill-chain/project/` 配下外を指すsymlinkの3パターンでAC-7の拒否を検証する。`documents.common`内の同一パス2重登録・`documents.common`と`documents.roles.<segment>`間の重複登録・表記違いの重複（`RULES.md` と `roles/../RULES.md`）・symlinkエイリアスによる重複の4パターンでAC-8の出力1回のみを検証する | `AC-7, AC-8` | `#4, #5` |
| 7 | CLIレベル統合テスト追加（`test/integration/project-policy-cli.test.ts` 新規） | ACが規定するCLI可観測契約（標準出力・終了コード）を、ビルド後の `bin/agents-md.js` への subprocess 実行（`test/helpers/cli.ts` の `runCli`）＋ `test/helpers/tmp-repo.ts` の `createTmpRepo` によるtmpリポジトリで検証する。(1) manifest.yamlに正当な `documents.common`・`documents.roles.<segment>` を登録した状態で `segment start` を実行し、標準出力に登録文書の内容が含まれ終了コード0であること（AC-1/AC-2、他セグメント向け文書が含まれないことを含む）、(2) `documents.common` に `../` による範囲外脱出パス（解決先の実体は実在・可読）を登録した状態で、標準出力が空（先行する正当文書の部分出力も無い）・終了コード非0であること（AC-7）、(3) 登録パスに対応する実ファイルが存在しない状態で、同様に標準出力が空・終了コード非0であること（AC-6） | `AC-1, AC-2, AC-6, AC-7` | `#2, #4` |
| 8 | 既存テスト確認（`test/integration/issue-lifecycle.test.ts`・`test/integration/worker-adapters.test.ts`・`test/integration/github-backend.test.ts`） | 本リポジトリのmanifest.yamlが実在するため、`segment start` をCLI実行している既存integrationテストを確認する。各テストの正規表現部分一致（`assert.match`）・不在検証（`assert.doesNotMatch`）はproject policy文書追加後の出力（末尾への追記）でも壊れないことを確認済みのため、既存アサーションの更新は不要 | `AC-5` | `#2` |
| 9 | `npm test` 全件実行・確認 | 回帰なしを確認する | `AC-5` | `#1〜#8` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
