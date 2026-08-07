# PLAN: lint-vocab: gh CLIサブコマンド引数リテラル'issue'を禁止語として誤検知し全PR CIが恒久赤化する

- Issue: `ISSUE-469`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `isQuotedLiteralContext()` の新設 | `src/commands/lint.ts` に、禁止語と完全一致する識別子runが単一引用符で直接囲まれ、直前直後（空白を挟んでよい）が配列要素・関数呼び出し引数の構文境界（`[`/`(`/`,` と `]`/`)`/`,`）であることを判定する関数を追加する。既存の `prevNonSpaceChar`/`nextNonSpaceChar` を再利用する。既存関数（`isCodeIdentifierContext`・`isYamlIdentifierContext`・`isCliSubcommandContext`・`isExternalVocabAllowlisted`）は変更しない | `AC-1, AC-2` | なし |
| 2 | `isIdentifierContext()` への統合 | `isIdentifierContext()` に `!isProseFile(ext) && isQuotedLiteralContext(...)` の分岐を1行追加する（既存の `isCliSubcommandContext` 呼び出しと同じ `!isProseFile(ext)` ガード方式）。判定順序上、既存4分岐の後に追加し、既存分岐の挙動・優先順位を変更しない | `AC-1, AC-2, AC-3` | `#1` |
| 3 | 回帰テスト追加（誤検知解消・一般ケース） | `test/integration/lint.test.ts` に、(a) `review-light.ts:60` 相当の `.ts` ファイル中 `gh(['issue', 'view', ...], root)` 形式の行が誤検出されないケース、(b) 配列要素・関数呼び出し引数のそれぞれで単一引用符の禁止語リテラルが単独トークンとして出現する一般ケース（複数箇所）が誤検出されないケースを追加する | `AC-1, AC-2` | `#1, #2` |
| 4 | 回帰テスト追加（散文の非退行） | `test/integration/lint.test.ts` に、`.md` 中で単一引用符により禁止語を囲んだ表記を含む散文誤用が引き続き検出されることを確認するケースを追加する（要件2・要件3の固定） | `AC-3` | `#1, #2` |
| 5 | 既存テストスイート全体実行 | `npm test`（または該当テストランナー）で `test/integration/lint.test.ts` の既存ケース（識別子文脈・YAML文脈・CLIサブコマンド文脈・屈折形・外部語彙許可リスト等）が全て現行の期待結果のまま成功することを確認する | `AC-4` | `#1, #2, #3, #4` |
| 6 | `lint vocab` 実機実行によるCI回復確認 | `node bin/agents-md.js lint vocab`（ビルド後）をリポジトリ全体に対して実行し、`src/lib/review-light.ts:60` の誤検知が解消され、他に新規違反が発生していない（終了コード0）ことを確認する。PRマージ後、main・既存オープンPRの `agent-skill-chain / ci` workflow `verify` ジョブの実行結果を進行役が確認する | `AC-5` | `#1, #2, #3, #4, #5` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
