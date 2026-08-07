# ADR

```yaml
id: ADR-0038
status: proposed
title: lint-vocabの単一行コメント記号検索を文字列リテラル境界を考慮した走査に変更
tags: [lint-vocab, false-positive, comment-scope]
supersedes: [ADR-0037]
superseded-by: null
deprecated-reason: null
```

## Context

ADR-0037（Issue #484）は `src/commands/lint.ts` に `commentMarkerFor(ext)` と `isInSingleLineComment(line, pos, ext)` を新設し、`isQuotedLiteralContext` の冒頭に `isInSingleLineComment` によるコメント位置ガードを追加した。`isInSingleLineComment` の内部実装は `commentMarkerFor(ext)` が返す記号（`.ts` の `//`、`.sh`/`.yaml`/`.yml` の `#`）を `line.indexOf(marker)` で単純検索し、その位置が `pos` より前かどうかだけを見る。この検索は文字列リテラル（`'...'`・`"..."`）の内部かどうかを一切考慮しない。ADR-0037自身の「Consequences」節は、この限界（文字列リテラル内に偶然コメント記号を含む行での誤判定）を既知のフォローアップ事項として明示していた。

Issue #484／PR #485マージ後、Codexによるstop-time reviewが実際に発生しうる誤検知として、この限界の解消を求めた。具体例：`const cfg = { url: 'https://example.com', tags: ['issue', 'other'] };` という `.ts` の1行では、`'https://example.com'` という文字列リテラル内部の `//` が `isInSingleLineComment` によりコメント開始と誤判定され、それより後ろにある配列要素 `'issue'`（本来 `isQuotedLiteralContext` の境界文字集合判定でコード値リテラルとして除外されるべき）が「コメント内」として扱われてしまい、コード値リテラル除外自体が適用されず禁止語誤検知が再発する（Issue #487 SPEC.md）。

検討した実現アプローチ：

- (a) 行を先頭から1文字ずつ走査し、単一引用符・二重引用符の文字列リテラル内部にある記号出現を無視して、文字列リテラルの外側で最初に出現する記号位置だけを探す専用の走査関数を新設する（本決定で採用）: 状態は「現在の引用符文字（無し／`'`／`"`）」の1つだけであり、バックスラッシュエスケープ（`\'`・`\"`）も併せて考慮できる。`commentMarkerFor` の拡張子対応表、`isQuotedLiteralContext` の境界文字集合判定条件には一切依存せず、`line` と `marker` のみを入力とする独立した純関数として追加できるため、Issue #487 SPEC.md 要件3（`commentMarkerFor`・`isQuotedLiteralContext` の既存判定は変更しない）を構造的に担保しやすい。
- (b) 正規表現で文字列リテラル部分を先に除去してから `indexOf` を適用する: 引用符の種類混在・エスケープを正しく扱う正規表現は後方参照や状態を要し可読性・検証容易性が低い。文字列除去後の位置ズレをコメント記号位置の算出に反映する変換も追加で必要になり、(a) より複雑になるため採らない。
- (c) URL特有のパターン（`://`）だけを特別扱いして無視する: `.sh`/`.yaml`/`.yml` の `#` には適用できず、URL以外の文字列リテラル（コメント記号相当文字列を含む一般の文字列値）にも対応できない場当たり的な対処であり、Issue #487 SPEC.md 要件1（文字列リテラル内部に出現するコメント記号を一般的に無視する）を満たさないため採らない。

## Decision

`src/commands/lint.ts` に純関数 `findUnquotedCommentMarkerIndex(line: string, marker: string): number` を新設する。この関数は `line` を先頭から1文字ずつ走査し、現在「単一引用符 `'` または二重引用符 `"` で開始した文字列リテラルの内部」にあるかどうかを1つの状態（開始した引用符文字、または未開始）として保持する。文字列リテラルの内部ではバックスラッシュの直後の1文字を無条件でスキップし（`\'`・`\"` を終端とみなさない）、状態と一致する引用符文字が現れた時点で文字列リテラルを終了する。文字列リテラルの外側にいる位置でのみ `marker` の出現をテストし、最初に一致した開始位置を返す。一致が無ければ `-1` を返す。

`isInSingleLineComment(line: string, pos: number, ext: string): boolean` は、`commentMarkerFor(ext)` を呼び出す処理と、戻り値の組み立て（`markerPos !== -1 && markerPos < pos`）は変更せず、`line.indexOf(marker)` の呼び出し1箇所だけを `findUnquotedCommentMarkerIndex(line, marker)` に置き換える。関数シグネチャ・呼び出し元（`isQuotedLiteralContext`）は変更しない。`commentMarkerFor` の拡張子対応表、`isQuotedLiteralContext` の境界文字集合判定条件自体（ADR-0036・ADR-0037で確定した既存の要件2・要件5相当の非退行対象）には一切手を加えない。

## Consequences

- 利点: `.ts` の `//`、`.sh`/`.yaml`/`.yml` の `#` のいずれについても、単一引用符・二重引用符の文字列リテラル内部に偶然コメント記号相当の文字列（URL等）を含む行で、その後ろにある正当なコード値リテラル（Issue #469／ADR-0036の境界文字集合判定対象）の除外判定が誤って阻害されなくなる。文字列リテラルの外側にある実際のコメント中の禁止語は引き続き検出される（Issue #484／ADR-0037の効果を維持）。
- 欠点・フォローアップ: テンプレートリテラル（バッククォート）内の式展開（`${...}`）の解析、複数行にまたがる文字列リテラル・複数行コメント（`/* ... */`）の解析は対象としない（Issue #487 SPEC.mdのスコープ外）。これらは字句解析の一般化を要する別種の問題であり、実際に問題が顕在化した場合に別Issueとして検討する。
- スコープ外の扱い: `commentMarkerFor` の拡張子対応表の変更、`isQuotedLiteralContext` の境界文字集合判定条件自体の変更、`isQuotedLiteralContext` 以外の既存識別子文脈判定関数（コード識別子文脈・YAML識別子文脈・CLIサブコマンド文脈・外部語彙許可リスト）の判定ロジックの変更は本決定の対象外とする（SPEC.mdスコープ外）。
