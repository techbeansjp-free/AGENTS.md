<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
-->

# PLAN: setup github / sync templates に --dry-run と上書き保護が無く、大文字小文字を区別しないファイルシステムでカスタムPRテンプレート等を無条件上書きする恐れがある

- Issue: `ISSUE-538`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `fs-copy.ts` へ大文字小文字衝突検知を追加 | `CopyOptions` に既定 `false` の `detectCaseCollision` を追加し、`true` の場合のみ `CopyPlan.addFile` が展開先の実エントリ名一覧（`fs.readdirSync`、ENOENT/ENOTDIR は空扱い）を大文字小文字を無視して比較する。配布元ファイル名と完全一致しない大文字小文字違いの既存エントリを検知した場合は `CliError` を送出し、以降の計画・書込みを一切行わず展開全体を中断する。検知は `planTree` の計画段階（`applyPlan` 呼出し前）で行い、`dryRun` の値に依存させない | `AC-4, AC-5, AC-6` | なし |
| 2 | `setup github` へ `--dry-run` を配線 | `github()` で `--dry-run`／positional な `target_dir` を解析し、`githubBundle()` へ `dryRun` を渡す。`dryRun: true` の場合、`syncStep()` は `copyTreeMirror` へ `dryRun: true`・`detectCaseCollision: true` を渡し、`labelsStep()`/`rulesetStep()`（GitHub API 書込み）は呼び出さずスキップ結果を summary へ積む。`dryRun: false` の場合は `syncStep()` へ `detectCaseCollision: true` のみ追加する（既存の label/ruleset 実行は変更しない）。`GITHUB_USAGE` に `--dry-run` の説明を追加する | `AC-1, AC-3` | `#1` |
| 3 | `sync templates` へ `--dry-run` を配線 | `templates()` で `--dry-run`／positional な `target_dir` を解析し、3件の `copyTreeMirror` 呼び出し（`.github/`・`.claude/agents/`・`.claude/skills/`）へ `dryRun`・`detectCaseCollision: true` を渡す。`USAGE` に `--dry-run` の説明を追加する | `AC-2, AC-3` | `#1` |
| 4 | テスト追加 | `test/unit/fs-copy.test.ts` に `detectCaseCollision` の単体テスト（完全一致時は従来どおり上書き／大文字小文字のみ異なる既存エントリがある場合は中断・無書込み／`detectCaseCollision` 省略時は `upgrade.ts` 等の既存呼び出し同様に検知しないことの回帰確認）を追加する。`test/integration/setup.test.ts`・`test/integration/sync.test.ts` に `--dry-run` 指定時の無書込み・出力一覧・`--help` 文言・大文字小文字衝突時の中断（dry-run有無双方）を検証する統合テストを追加する | `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6` | `#1, #2, #3` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
