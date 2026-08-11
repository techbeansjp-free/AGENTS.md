# PLAN: docs/adr/でADR番号が重複しており(ADR-0016×3・ADR-0008×2・ADR-0039×2)、adr-lintがID一意性を検査していないためCIで検出されない

- Issue: `ISSUE-539`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `adr-consistency.ts` へのID一意性検査追加 | `collectAdrFileRecords()`（全ファイル非重複列挙）・`checkAdrIdUniqueness()`（重複IDグループごとに `重複ADR ID '<id>': <file1>, <file2>, ...` 形式の違反を生成）を追加。`collectAdrRecords()` は `collectAdrFileRecords()` の結果から後勝ちで `Map` を構築するよう内部実装のみ変更し、戻り値の型・呼び出し契約は不変に保つ | `AC-1` | なし |
| 2 | `lint.ts` `adr()` への組み込み | `checkAdrIdUniqueness()` を `checkAdrSymmetry()` より先に実行し、両者の違反を1配列へ結合してから出力・終了コード判定する既存制御構造に渡す | `AC-1, AC-2` | `#1` |
| 3 | 単体テスト追加（重複検出・一意性維持） | `test/integration/lint.test.ts` に「重複IDを含む自作 `docs/adr/` で `lint adr check` が非ゼロ終了し、エラー出力に重複IDと該当ファイル名2件以上が含まれる」テストと、「重複を解消すると終了コード0に戻る」テストを追加する。既存の非対称検出テスト（supersedes/superseded-by）・「実物 `docs/adr/` は違反0で通る」テストとの独立性を保つ | `AC-1, AC-2` | `#2` |
| 4 | 既存重複7ファイルの再採番 | DESIGN.md「既存重複7ファイルの再採番マッピング」節の対応表どおりに、7ファイルそれぞれの `git mv` によるファイル名変更と、frontmatter `id:` フィールドの書き換えを行う（`ADR-0008-npm-package-asset-allowlist.md`→`ADR-0048-...`、`ADR-0008-test-execution-log-preservation.md`→`ADR-0049-...`、`ADR-0016-codex-exec-unsupported-flag-as-config-override.md`→`ADR-0050-...`、`ADR-0016-reconcile-workflow-run-trust-boundary.md`→`ADR-0051-...`、`ADR-0016-worktree-cleanup-detection-over-merge-chaining.md`→`ADR-0052-...`、`ADR-0039-pr-merge-freshness-check-mergestatestatus-optin-update.md`→`ADR-0053-...`、`ADR-0039-upgrade-stale-file-ownership-record.md`→`ADR-0054-...`） | `AC-3` | `#1, #2` |
| 5 | バレテキスト直接参照の更新 | `docs/adr/ADR-0044-ruleset-template-drift-and-dedicated-app-binding-condition.md`（3箇所）・`docs/ASC_GATE_APP_ID_RUNBOOK.md`（1箇所）の `ADR-0016` 表記を、DESIGN.md「参照影響調査」節の対応表どおり `ADR-0051` へ更新する | `AC-4` | `#4` |
| 6 | 参照断線の再検証 | `grep -rn "ADR-0016\|ADR-0008\b\|ADR-0039" --include="*.md" --include="*.ts" --include="*.sh" --include="*.yaml" --include="*.yml" .`（`node_modules/`・`.worktrees/` 除外）を再実行し、旧番号への残存参照が0件であること、および `docs/adr/` 内の `related_adrs:`/`supersedes`/`superseded-by` に断線が無いことを確認する | `AC-4` | `#4, #5` |
| 7 | 全体検査の実行 | `npm run build && ./.agent-skill-chain/scripts/adr-lint.sh check`（`docs/adr/` 全体が違反0）、`npm test`（`test/integration/lint.test.ts` を含む既存スイート） を実行し結果を記録する | `AC-1, AC-2, AC-3` | `#3, #4, #5, #6` |
| 8 | ADR作成 | `docs/adr/ADR-0055-adr-id-uniqueness-check-and-duplicate-renumbering.md`（`status: proposed`）を作成し、本Issueの決定（検出方式・再採番方針・残余リスク）を記録する | `AC-1, AC-3` | なし（design セグメントで作成済み） |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
