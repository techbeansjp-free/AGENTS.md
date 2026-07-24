# PLAN: release bump の既存ブランチ再利用が main 基準で内容を作り直さずマージ不能なコンフリクトを生む

- Issue: `ISSUE-228`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md の設計要素を、依存関係に沿って以下の順で実装する。実装は `src/commands/release.ts`
（および必要なら `src/lib/exec.ts` の既存ラッパー再利用）に閉じ、外部 I/F・スキーマ変更を伴わない。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `detectBumpBaseDivergence` 追加 | `git fetch origin` 後、`merge-base(origin/<branch>, origin/main)` と `origin/main` HEAD を比較し `{ diverged, error? }` を返す純粋度の高い関数を新設する | `AC-1, AC-2` | なし |
| 2 | `rebuildBumpBranchToMain` 追加 | `checkout -B <branch> origin/main` → `ensureGitIdentity` → `writeBumpedVersionFiles` → `add`/`commit` → `push --force-with-lease` を行い、失敗理由文字列（force push 競合時は human_required 文言）を返す関数を新設する | `AC-1, AC-3` | `#1` |
| 3 | `bump()` の既存ブランチ枝へ配線 | `branchExists === true` の枝で `detectBumpBaseDivergence` を呼び、`error` 時は `fail`、`diverged` 時のみ `rebuildBumpBranchToMain` を呼ぶ。以降の `findOpenBumpPr`/`checkBumpPrScope`/admin merge は不変に保つ | `AC-1, AC-2, AC-4` | `#1, #2` |
| 4 | 統合テスト追加（乖離あり） | main を古い版数で用意→`failNextMerge` で stale な bump ブランチ・OPEN PR を残す→main を進める→再実行で `<新main版数>→<target>` へ是正され parent が現行 main になることを検証 | `AC-1, AC-3` | `#3` |
| 5 | 統合テスト追加（乖離なし） | base が現行 main と一致する既存ブランチを用意し再実行、ブランチ commit SHA が不変（force push が発生しない）ことを検証 | `AC-2` | `#3` |
| 6 | 非回帰テスト確認 | 既存の bump 系テスト（新規作成・スコープ違反 human_required・self-heal 冪等・identity 系）が引き続き通過することを確認する | `AC-4` | `#3` |

<!-- テストは既存 test/integration/release.test.ts のスタイル（実 git + bare remote + gh-stub、
     bin/agents-md.js を子プロセス実行）に揃える。gh-stub の failNextMerge/prsByBranch を再利用し、
     乖離状態は「1回目 bump を merge 失敗させて OPEN PR を残す → main を進める」で構成する。 -->

## 実装順序の見直しについて

作業順序のみの見直しは本ファイルの更新で足りる。DESIGN.md が定めた関数分割（乖離検知と再構築の分離）・
merge-base による乖離判定方式・force push 失敗時の human_required 降格を変更する場合は、DESIGN.md の
更新と設計ゲート再通過が必要になる。
</content>
