# PLAN: release publish の gh release create が --generate-notes を使わず、GitHub Release から What's Changed / Full Changelog の自動生成が失われている

- Issue: `ISSUE-226`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `previousSemverTag` 純粋関数 | `src/lib/release-version.ts` に起点タグ選定関数を新設し、`test/unit/release-version.test.ts` に単体テスト（target 未満の最大 semver タグ選択・タイムスタンプ形式タグ除外・target 自身と以上の除外・該当なし時 `undefined`・数値比較）を追加 | `AC-1, AC-2, AC-3` | なし |
| 2 | `publish()` の引数組み立て変更 | `src/commands/release.ts` の `publish()` で `git tag --list` からタグ一覧を取得し、`--generate-notes`（常時）と `--notes-start-tag`（起点タグ存在時のみ）を `gh release create` 引数へ追加。`PUBLISH_USAGE` の説明も更新 | `AC-1, AC-2, AC-3` | `#1` |
| 3 | 統合テストの追加・回帰確認 | `test/integration/release.test.ts` に、semver・タイムスタンプ混在タグ環境で `--notes-start-tag` に直前 semver タグが選ばれるケースと、semver タグ不在で `--notes-start-tag` が付かず exit 0 となるケースを追加。既存の冪等スキップ・二重発火・semver 検査テストが無修正で成功することを確認（`npm run build && npm test` 全件成功） | `AC-1, AC-2, AC-3, AC-4` | `#1, #2` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる。
