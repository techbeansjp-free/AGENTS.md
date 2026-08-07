# DESIGN: lint-vocab: isInSingleLineCommentが文字列リテラル内のコメント記号を誤ってコメント開始と判定する

- Issue: `ISSUE-487`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1 / AC-1 / AC-4 | `findUnquotedCommentMarkerIndex`（新設） | 文字列リテラル内部のコメント記号相当文字列を無視し、外側で最初に出現する記号位置のみを返す |
| 要件2 / AC-2 | `isInSingleLineComment`（内部実装のみ変更） | 文字列リテラルを含まない行では従来どおり `//`・`#` 以降をコメントと判定する（非退行） |
| AC-3 | `findUnquotedCommentMarkerIndex` + `isQuotedLiteralContext`（既存） | 同一行でコード値リテラル除外と実コメント検出が共存する場合、それぞれ独立して正しく働く |
| 要件3 | （変更対象外の明示） | `commentMarkerFor(ext)` の拡張子対応表、`isQuotedLiteralContext` の境界文字集合判定は変更しない |
| 要件4 | `findUnquotedCommentMarkerIndex`（新設） | バックスラッシュエスケープ（`\'`・`\"`）を走査中に考慮する（必須要件ではないが低コストで一般性が上がるため採用） |
| 要件5 / AC-5 | スコープ外として実装しない | テンプレートリテラル式展開・複数行文字列/コメントは対象としない。AC-5はリポジトリ全体実行による回帰確認で担保する |

## 責務・境界

### コンポーネント構成

- `findUnquotedCommentMarkerIndex(line: string, marker: string): number`（`src/commands/lint.ts` に新設）: 行を先頭から1文字ずつ走査し、単一引用符 `'` ・二重引用符 `"` で囲まれた文字列リテラル内部にある `marker` の出現を無視する。文字列リテラルの外側で最初に出現する `marker` の開始位置を返し、無ければ `-1` を返す。バックスラッシュによるエスケープ（`\'`・`\"`）は文字列リテラルの終端とみなさない。既存の `commentMarkerFor`・`isQuotedLiteralContext` の境界文字集合判定には一切依存せず、`line` と `marker` のみを入力とする独立した純関数とする。
- `isInSingleLineComment(line, pos, ext)`（既存、内部実装のみ変更）: `commentMarkerFor(ext)` で記号を取得する処理と、`markerPos !== -1 && markerPos < pos` という戻り値の組み立ては変更せず、`line.indexOf(marker)` の呼び出し1箇所だけを `findUnquotedCommentMarkerIndex(line, marker)` に置き換える。関数シグネチャ・呼び出し元（`isQuotedLiteralContext`）への影響はない。

### 依存関係

```text
isIdentifierContext → isQuotedLiteralContext → isInSingleLineComment → findUnquotedCommentMarkerIndex
                                                                     ↘ commentMarkerFor（変更なし）
```

`findUnquotedCommentMarkerIndex` は `isInSingleLineComment` からのみ呼ばれる末端の純関数であり、他コンポーネントへの依存を持たない。循環依存は無い。

### 図示要否の判断

- 判断: `不要`
- 根拠: 変更は既存の呼び出し連鎖（`isIdentifierContext` → `isQuotedLiteralContext` → `isInSingleLineComment`）の末端に新しい純関数を1つ追加し、`isInSingleLineComment` 内部の1呼び出しを置き換えるだけの線形な変更である。関与するコンポーネントは2つ（変更対象1・新設1）で責務境界3つ未満、依存関係も3つ未満、状態遷移は無い。上記基準（依存3以上／状態遷移2以上／責務境界3以上）のいずれにも該当しないため、テキスト矢印表記で十分と判断する。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0037
    relation: supersedes
```

`ADR-0037` の Decision は `isInSingleLineComment` の内部実装を「`line.indexOf(marker)` の結果が `-1` でなく `pos` より前であること」と具体的に規定しており、この本文は accepted 後不変である。本Issueはこの具体的な検索アルゴリズムそのものを文字列リテラル境界を考慮した走査に置き換えるため、ADR-0037の本文を書き換えず、新しい ADR-0038（本Issueで作成、`supersedes: [ADR-0037]`）を作成して置き換える。`commentMarkerFor` の拡張子対応表、`isQuotedLiteralContext` の境界文字集合判定自体（ADR-0036由来、ADR-0037で `ext` 引数とコメント位置ガードを追加）は本Issueでは変更せず、ADR-0036・ADR-0037のいずれの決定内容も無効化しない。

## 障害・ロールバック考慮

- 想定される失敗モード: `findUnquotedCommentMarkerIndex` の引用符状態追跡に誤りがあると、(a) 文字列リテラル外の実コメントを見逃す（AC-2の回帰、禁止語検出漏れ＝偽陰性）、(b) 引用符の対応が崩れた行（例: 未対応の単一引用符を含む行）でコメント記号位置の誤検出が発生する、の2方向のリスクがある。(a) は既存テスト（Issue #484 AC-1・AC-2相当のテストケース）で回帰検知できる。(b) は本Issueのスコープ外（複数行文字列・高度な文字列構文はSPEC.mdスコープ外）であり、対象拡張子（`.ts`・`.sh`・`.yaml`/`.yml`）の通常のコード記述では単一行内で引用符は対で閉じるため実害は限定的と判断する。
- ロールバック手順: `src/commands/lint.ts` 内の変更（新設1関数＋`isInSingleLineComment`内の1行）のみを対象とした `git revert` で、`commentMarkerFor`・`isQuotedLiteralContext` の既存判定・他コンポーネントに影響を与えずに戻せる。設定ファイル・スキーマ・CI定義の変更を伴わないため、ロールバックは当該PRのrevertのみで完結する。
- 影響を受ける既存機能: `lint vocab` サブコマンドの禁止語検出のうち、`isQuotedLiteralContext` によるコード値リテラル除外判定（Issue #469／ADR-0036）と、単一行コメント文脈の判定（Issue #484／ADR-0037）。両者の呼び出し順序・戻り値の意味（`isInSingleLineComment`の戻り値がtrueならコメント内として扱う）は変更しないため、`lint vocab` 以外のサブコマンド・他ファイルへの影響は無い。
