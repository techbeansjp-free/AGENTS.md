# DESIGN: lint-vocab: gh CLIサブコマンド引数リテラル'issue'を禁止語として誤検知し全PR CIが恒久赤化する

- Issue: `ISSUE-469`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1 / AC-1 | `isQuotedLiteralContext()`（新設） | `review-light.ts:60` の `'issue'` を含め、単一引用符で囲まれた単独の禁止語リテラルを識別子文脈として認識する |
| 要件2 / AC-3, AC-4 | `isProseFile(ext)` によるスコープ限定＋既存4関数（A-1〜A-4）を無変更のまま維持 | 新設関数を `isIdentifierContext()` への追加分岐としてのみ組み込む加算的変更。既存の判定順序・戻り値には影響しない |
| 要件3 / AC-2 | `isQuotedLiteralContext()` の境界文字集合（配列要素 `[`/`,`/`]`、関数呼び出し引数 `(`/`,`/`)`） | 個別ファイル・個別行のハードコードではなく、構文的境界のみに基づく一般規則 |
| 要件4, 要件5 / AC-5 | 回帰テスト（`test/integration/lint.test.ts`）＋実 `lint vocab` 実行結果 | PLAN.md 変更単位3・5 |

## 責務・境界

### コンポーネント構成

- `isQuotedLiteralContext(line, run, banned)`（新設、`src/commands/lint.ts`）: 禁止語と完全一致する識別子runが、単一引用符 `'` で直接囲まれ、かつ直前直後（空白を挟んでよい）が配列要素・関数呼び出し引数の構文境界（`[`/`(`/`,` と `]`/`)`/`,`）であることを判定する。既存の `isYamlIdentifierContext`・`isCliSubcommandContext` と並列の、単一責務の独立判定関数として追加する。
- `isIdentifierContext()`（既存、変更箇所）: 新設関数への呼び出しを1行追加するのみ。既存の `isCodeIdentifierContext` → `isYamlIdentifierContext` → `isCliSubcommandContext` → `isExternalVocabAllowlisted` の判定順序・各関数の実装には一切手を加えない。

### 依存関係

新設関数は既存の `prevNonSpaceChar` / `nextNonSpaceChar`（YAML flow-sequence文脈判定で既に使用中のヘルパー）を再利用するのみで、新規の外部依存・新規ヘルパーを追加しない。

```text
isIdentifierContext → isQuotedLiteralContext → prevNonSpaceChar / nextNonSpaceChar（既存）
```

### 図示要否の判断

- 判断: `不要`
- 根拠: 追加する依存関係は1本（`isIdentifierContext` → `isQuotedLiteralContext`）のみ、責務境界も1コンポーネント追加に留まり、状態遷移も発生しないため、上記いずれの図示必須基準にも該当しない。

## 設計の要点（既存4文脈判定との差異）

既存の `isCliSubcommandContext` はダブルクォート（`"`）を境界文字として扱い、かつ前後いずれかのトークンが `cliVerbs()`（agent-skill-chain自身のCLIルートから導出した動詞ホワイトリスト）に含まれることを要求する。`gh issue view` の `'view'` はこのホワイトリストに含まれない外部CLI（`gh`）の語彙であり、この判定を流用または拡張すると、外部CLIツールごとの動詞を新たに網羅・保守する対象を作ることになる（SPEC.mdスコープ外「`gh` CLI固有の全サブコマンド・全引数を網羅する個別ホワイトリストの整備」に抵触）。

`isQuotedLiteralContext` は動詞ホワイトリストに依存せず、純粋に構文的な境界（単一引用符＋配列・関数呼び出しの区切り文字）のみで判定する。これにより `gh` に限らず、単一引用符で囲まれた禁止語一致リテラルが配列要素・関数呼び出し引数として単独で出現する一般ケースを、外部語彙の追加登録なしに解決する。

非散文ファイル（`.md` 以外）に限定して適用する点は既存の `isCliSubcommandContext` と同じ制約方式を踏襲する（散文中では正当なコード参照はバッククォートで示すのが既存の規範であり、単一引用符での言及はむしろ散文中の誤用でありうるため除外しない）。

## 障害・ロールバック考慮

- 想定される失敗モード: 境界文字集合（`[`/`(`/`,` と `]`/`)`/`,`）が実際には想定していない構文パターンに一致し、散文とは言えないコード中の禁止語誤用（例: 意図的な旧語彙の埋め込み）まで誤って除外してしまう過剰除外。
- ロールバック手順: `isIdentifierContext()` に追加した `isQuotedLiteralContext` 呼び出しの1行を削除するだけで、既存4関数・既存の判定順序・既存の戻り値のいずれにも変更が無いため完全に修正前の挙動へ戻る。
- 影響を受ける既存機能: 無し。既存4文脈判定関数（`isCodeIdentifierContext`・`isYamlIdentifierContext`・`isCliSubcommandContext`・`isExternalVocabAllowlisted`）・`hasProseViolation`・`isCodeLikeReference` の実装・呼び出し順序はいずれも変更しない加算的実装であるため、要件2が求める既存動作の非退行はコード変更そのものの構造によって担保される。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0033
    relation: references
```

ADR-0033（未置換プレースホルダ判定における技術トークン許容リスト、Issue #461）は本Issueと同種の「lintツールが規範文書用の検査ルールで正当なコード記法を誤検知する」再発パターンへの対応であり、判断の背景として参照する（供する採否ロジック自体は独立）。
