# ADR

```yaml
id: ADR-0037
status: superseded
title: lint-vocabにおける単一引用符コード値リテラル文脈は非散文ファイルの単一行コメント部分に適用しない
tags: [lint-vocab, false-negative, comment-scope]
supersedes: [ADR-0036]
superseded-by: ADR-0038
deprecated-reason: null
```

## Context

ADR-0036（Issue #469）は `.agent-skill-chain/scripts/lint-vocab.sh`（`src/commands/lint.ts` の `vocab()`）に `isQuotedLiteralContext()` を新設し、単一引用符 `'` で囲まれた禁止語一致の単独文字列リテラルが、配列要素・関数呼び出し引数の構文境界（前: `[`・`(`・`,`、後: `]`・`)`・`,`）に位置する場合、コード値リテラル文脈として散文誤用検出から除外する決定をした。この判定は行内容だけを見る純粋に構文的な境界判定であり、その行が実際のコード（配列要素・関数呼び出し引数）なのか、`//`（`.ts` 等）・`#`（`.sh`/`.yaml`/`.yml` 等）で始まる単一行コメント（散文相当）なのかを区別していない。

このためISSUE-484 SPEC.mdが指摘する通り、非散文ファイル（`.ts`・`.sh`・`.yaml` 等）中のコメント行で、禁止語を配列風・関数呼び出し風の括弧・カンマで囲んだ表記（例: `// deprecated values: ('issue', 'legacy')`）が、実際のコード値リテラルと誤って同一視され、禁止語検査から漏れる。`.md`（散文ファイル）であれば `isProseFile` により `isQuotedLiteralContext` 自体が適用されず正しく検出されるため、この盲点は非散文ファイルのコメント行に固有である。

検討した実現アプローチ：

- (a) `isQuotedLiteralContext` の判定条件（単一引用符＋構文境界）自体を変更し、コメント記号の有無を境界判定の一部として組み込む: 既存の境界文字集合の判定と、コメント記号検出という性質の異なる2つの判定を1つの条件式に混在させることになり、ADR-0036が確定した境界文字集合の判定条件（要件2・要件5の非退行対象）を書き換える必要が生じる。SPEC.md要件5（`src/lib/review-light.ts:60` 相当の既存除外効果の非退行）を機械的に保証しづらくなるため採らない。
- (b) `isQuotedLiteralContext` の冒頭に独立したコメント位置ガードを追加する（本決定）: 既存の境界文字集合判定はそのまま維持し、その前段で「対象位置が単一行コメント部分かどうか」を判定する独立した純関数を呼び出し、真であれば即座に `false` を返す。既存の判定条件・境界文字集合には一切手を加えないため、要件4・要件5（既存判定関数・既存除外効果の非退行）を構造的に担保しやすい。採用する。
- (c) `isIdentifierContext()` 側でコメント判定を行い、非散文ファイルのコメント部分では `isQuotedLiteralContext` の呼び出し自体をスキップする: `isQuotedLiteralContext` 以外の分岐（`isCliSubcommandContext` 等）の呼び出し順序・ガード条件（`!isProseFile(ext)`）にコメント判定という新しい関心事を混在させることになり、SPEC.md要件4（`isQuotedLiteralContext` 以外の既存識別子文脈判定関数の実装・判定順序・戻り値を変更しない）には抵触しないが、`isIdentifierContext()` 自体の可読性・責務が肥大化する。(b) は変更を `isQuotedLiteralContext` 内部に閉じ込められるため、こちらを優先する。

## Decision

`src/commands/lint.ts` に以下の2つの純関数を新設する。

- `commentMarkerFor(ext: string): string | undefined`: `lint vocab` が対象とする拡張子の閉じた集合（`TEXT_EXTENSIONS`、`src/lib/scan.ts`: `.md`・`.yaml`・`.yml`・`.sh`・`.json`・`.ts`）に基づき、拡張子ごとの単一行コメント開始記号を返す。`.ts` には `'//'`、`.sh`・`.yaml`・`.yml` には `'#'` を返す。`.md`（`isProseFile` により本判定自体が呼ばれない）・`.json`（単一行コメント構文を持たない）には `undefined` を返す。
- `isInSingleLineComment(line: string, pos: number, ext: string): boolean`: `commentMarkerFor(ext)` が記号を返す場合に限り、`line.indexOf(marker)` の結果が `-1` でなく、かつ `pos` より前であれば `true` を返す。記号が無い拡張子では常に `false`。

`isQuotedLiteralContext(line: string, run: IdentifierRun, banned: string, ext: string): boolean` に `ext` 引数を追加し、冒頭で `isInSingleLineComment(line, run.runStart, ext)` を判定して真であれば直ちに `false` を返すガードを追加する。それ以外の既存判定条件（禁止語と完全一致する識別子runであること、直前直後が単一引用符 `'` であること、その外側が配列要素・関数呼び出し引数の構文境界であること）は一切変更しない。呼び出し元 `isIdentifierContext()` は当該1行の呼び出しに `ext` 引数を追加するのみで、判定順序・他の分岐（`isCodeIdentifierContext`・`isYamlIdentifierContext`・`isCliSubcommandContext`・`isExternalVocabAllowlisted`）には一切手を加えない。

## Consequences

- 利点: 非散文ファイル（`.ts`・`.sh`・`.yaml`/`.yml`）の単一行コメント中に、配列要素・関数呼び出し引数と同じ構文境界で単一引用符に囲まれた禁止語一致リテラルが出現する場合、`lint vocab` が引き続きこれを禁止語違反として検出できるようになる。ADR-0036 が確定した既存の境界文字集合判定・`src/lib/review-light.ts:60` 相当の実コード行に対する誤検知抑制効果は変更せず維持される。新設2関数は `TEXT_EXTENSIONS` という既存の閉じた拡張子集合のみに依存し、個別ファイル・個別行のハードコード例外を持たない一般規則である。
- 欠点・フォローアップ: 文字列リテラル内部に偶然コメント記号（`//`・`#`）を含むがコメント開始ではない行（例: URL文字列 `'https://example.com'` を含むコード行の後続に配列要素・関数呼び出し引数が続く場合）では、`isInSingleLineComment` がその位置をコメント開始と誤判定し、コメント外の正当なコード値リテラル除外を局所的に再発させる可能性がある。ISSUE-484 SPEC.mdはこの字句解析の高度化をスコープ外と明示しており、本決定でも対応しない。将来この誤判定が実際に問題化した場合は、単純な `indexOf` ベースの判定から文字列リテラル境界を考慮した字句解析への拡張を別途検討する必要がある。
- スコープ外の扱い: `/* ... */` 等の複数行コメント構文の一般的な解析、`isQuotedLiteralContext` 以外の既存識別子文脈判定関数（コード識別子文脈・YAML識別子文脈・CLIサブコマンド文脈・外部語彙許可リスト）の判定ロジック自体の変更・再設計は本決定の対象外とする（SPEC.mdスコープ外）。
