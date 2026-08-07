# ADR

```yaml
id: ADR-0036
status: proposed
title: lint-vocabにおける単一引用符コード値リテラル文脈の追加
tags: [lint-vocab, false-positive, ci]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/scripts/lint-vocab.sh`（`src/commands/lint.ts` の `vocab()`）は、散文中の禁止語誤用を検出しつつ、コード識別子文脈・YAML識別子文脈・CLIサブコマンド文脈・外部語彙許可リストの4種（`isCodeIdentifierContext`・`isYamlIdentifierContext`・`isCliSubcommandContext`・`isExternalVocabAllowlisted`、Issue #178・#187）で正当なコード上の利用を除外している。

`src/lib/review-light.ts:60` の `gh(['issue', 'view', issueNumber, '--json', 'labels'], root)`（PR #460／Issue #449 でmainへ混入）は、配列要素 `'issue'`（単一引用符で囲まれた禁止語一致の単独文字列リテラル）を含み、既存4種のいずれの除外にも該当せず誤検知する。この誤検知は2026-08-06時点でmain上に混入したまま解消されておらず、`agent-skill-chain / ci` workflowの `verify` ジョブがmain・全オープンPRで恒久的にfailし続けている（Issue #469 SPEC.md）。

検討した実現アプローチ：

- (a) 個別ファイル・個別行のハードコード例外（`review-light.ts:60` を対象から除外する等）：SPEC.md 要件3が「一般化された規則」を明示的に要求しており、AGENTS.md が禁じる特例の積み上げにあたるため採らない。将来同種の混入（例: `gh(['pr', 'view', ...])` に禁止語相当の語が含まれるケース）を都度個別対応する運用コストも生じる。
- (b) 既存 `isCliSubcommandContext` の拡張（ダブルクォート境界判定に単一引用符を追加し、隣接トークンの動詞ホワイトリスト判定を流用する）：`isCliSubcommandContext` は `cliVerbs()`（agent-skill-chain自身のCLIルートから導出した動詞ホワイトリスト）への一致を要求する。`gh issue view` の `'view'` はこのホワイトリストに含まれない外部CLI（`gh`）固有の語彙であり、この判定を流用するには外部CLIツールごとの動詞ホワイトリストを新設・保守する必要がある。SPEC.mdスコープ外「`gh` CLI固有の全サブコマンド・全引数を網羅する個別ホワイトリストの整備」に抵触するため採らない。
- (c) 新規の独立した文脈判定関数（単一引用符＋配列要素・関数呼び出し引数の構文境界のみで判定、動詞ホワイトリストに依存しない）：外部CLIの語彙を一切参照せず、純粋に構文的境界だけで判定するため、`gh` に限らず単一引用符で囲まれた禁止語一致リテラルが配列要素・関数呼び出し引数として単独出現する一般ケースを解決できる。既存4種の判定関数・判定順序には一切手を加えない加算的変更のため、要件2（既存動作の非退行）を構造的に担保できる。採用する。

## Decision

`src/commands/lint.ts` に `isQuotedLiteralContext(line: string, run: IdentifierRun, banned: string): boolean` を新設する。禁止語と完全一致する識別子run（`runText.length === banned.length`）が、直前直後で単一引用符 `'` に直接囲まれ（`line[run.runStart - 1] === "'"` かつ `line[run.runEnd] === "'"`）、かつその引用符の直前直後（空白を挟んでよい。既存の `prevNonSpaceChar`/`nextNonSpaceChar` を再利用）が配列要素・関数呼び出し引数の構文境界（前: `[`・`(`・`,`、後: `]`・`)`・`,`）である場合に真を返す。

`isIdentifierContext()` に、既存の `isCliSubcommandContext` 呼び出しと同じ `!isProseFile(ext)` ガード方式で `isQuotedLiteralContext(...)` の呼び出しを1行追加する。`.md`（散文）ファイルには適用しない。既存4種の判定関数・呼び出し順序・戻り値は一切変更しない。

## Consequences

- 利点: `review-light.ts:60` の誤検知（Issue #469 の直接原因）が解消し、main・全PRの `verify` ジョブが本誤検知を原因として恒久failする状態から回復する。動詞ホワイトリストや外部CLIツール固有の語彙整備を一切要さず、修正範囲が `src/commands/lint.ts` の判定ロジック追加1関数とそのテストに閉じる。既存4種の判定関数を無変更のまま維持する加算的実装のため、既存挙動の後退リスクが構造的に低い。
- 欠点・フォローアップ: 境界文字集合（`[`/`(`/`,` と `]`/`)`/`,`）は配列要素・関数呼び出し引数という構文パターンに限定した経験的な集合であり、将来これら以外の構文位置（例: オブジェクトリテラルのプロパティ値、代入文の右辺）で同種の誤検知が発生した場合は、本判定ロジックの境界文字集合を再検証・拡張する必要がある。本Issueでは `review-light.ts:60` を含むSPEC.mdが明示する配列要素・関数呼び出し引数の範囲にスコープを閉じる。
- スコープ外の扱い: `gh` CLI固有の全サブコマンド・全引数を網羅する個別ホワイトリストの整備、既存のダブルクォート境界判定・CLIサブコマンド動詞ホワイトリストの仕組み自体の再設計は本決定の対象外とする（SPEC.mdスコープ外）。
