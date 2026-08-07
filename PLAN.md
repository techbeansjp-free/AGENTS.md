# PLAN: lint-vocab: isInSingleLineCommentが文字列リテラル内のコメント記号を誤ってコメント開始と判定する

- Issue: `ISSUE-487`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `findUnquotedCommentMarkerIndex` の新設 | `src/commands/lint.ts` に、単一引用符・二重引用符の文字列リテラル内部を無視して `marker` の最初の出現位置（外側限定）を返す純関数を追加する。バックスラッシュエスケープ（`\'`・`\"`）は文字列リテラルの終端とみなさない。 | `AC-1, AC-4`（要件1・要件4の実体） | なし |
| 2 | `isInSingleLineComment` の内部実装置換 | `isInSingleLineComment` 内の `line.indexOf(marker)` 呼び出し1箇所を `findUnquotedCommentMarkerIndex(line, marker)` に置き換える。関数シグネチャ・戻り値の組み立て（`markerPos !== -1 && markerPos < pos`）・呼び出し元は変更しない。 | `AC-1, AC-2, AC-3, AC-4`（要件2の非退行確認を含む） | `#1` |
| 3 | 単体テスト追加 | `test/integration/lint.test.ts` に、AC-1（URL文字列リテラル＋後続コード値リテラル配列要素）、AC-2（文字列リテラルを含まない実コメント、既存Issue #484テストの非退行として明示）、AC-3（同一行でのコード値リテラル除外と実コメント検出の共存）、AC-4（`.sh`/`.yaml`/`.yml` の `#` での同等ケース）に対応するケースを追加する。 | `AC-1, AC-2, AC-3, AC-4` | `#2` |
| 4 | proposed ADR（ADR-0038）の作成 | `docs/adr/ADR-0038-*.md` を `status: proposed` で作成し、`supersedes: [ADR-0037]` を設定する。DESIGN.md 記載の決定内容（検討した代替案・採用理由）を記述する。 | 全AC（設計判断の記録） | `#1, #2` |
| 5 | リポジトリ全体への `lint vocab` 実行による回帰確認 | 変更適用後のソースツリー全体に対し `lint vocab` を実行し、修正前と比較して新規の禁止語違反が増えていないこと（exit code・件数が同じか改善）を確認する。 | `AC-5` | `#1, #2, #3` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
