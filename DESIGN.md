# DESIGN: release bump の既存ブランチ再利用が main 基準で内容を作り直さずマージ不能なコンフリクトを生む

- Issue: `ISSUE-228`
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲

`release bump <target>`（`src/commands/release.ts` の `bump()`）は、既存の `release/bump-v<target>`
ブランチをそのまま再利用し中身を更新しない。この再利用は「実行間で main が不変」の一時 API レース
のみを想定しており、main の内容が進んだ場合に古い base のまま取り残されマージ不能コンフリクトを起こす。
本設計は、既存ブランチ再利用時に **base 乖離を検知し、乖離時のみ現行 main 基準へ作り直す** ことで、
どのような呼ばれ方でも常に正しい `<現行version>→<target>` 差分でマージを試みる状態を保証する。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 乖離時に main 基準へ作り直す | `detectBumpBaseDivergence` + `rebuildBumpBranchToMain` | merge-base 比較で乖離判定し、乖離時のみ再構築 |
| AC-2 一致時は再生成せずマージ再試行のみ | `detectBumpBaseDivergence`（`diverged=false` 時は再構築を呼ばない） | 不要な force push・再生成を発生させない |
| AC-3 実障害シナリオ（0.2.5→0.2.7 を 0.2.6→0.2.7 へ是正） | AC-1 機構の具体適用 | main を 0.2.6 へ進めた状態で再実行し是正 |
| AC-4 既存挙動の非回帰 | `bump()` の分岐骨格（`!branchExists` 作成・スコープ検査・admin merge 経路）を不変に保つ | 新規経路は「既存ブランチかつ乖離あり」の枝にのみ挿入 |

## 責務・境界

### コンポーネント構成

- `detectBumpBaseDivergence(root, branch)`: 現行 origin/main を fetch し、
  `merge-base(origin/<branch>, origin/main)` と `origin/main` の HEAD を比較する。両者が一致すれば
  「main はブランチ作成後に進んでいない（乖離なし）」、不一致なら「main が進んでいる（乖離あり）」。
  結果は `{ diverged: boolean; error?: string }`。fetch/rev-parse 失敗は `error` に載せる。
  版数フィールド比較ではなく merge-base を採る理由: 要件が定める乖離の定義そのもの（＝ base 前進）を
  直接判定でき、main 側の版数変更有無に依存せず、SPEC の実障害（main が 0.2.5→0.2.6 へ前進）を正しく捕捉する。
- `rebuildBumpBranchToMain(root, branch, target, message)`: 乖離時のみ呼ぶ。
  `git checkout -B <branch> origin/main`（作業木を現行 main へ揃える）→ `ensureGitIdentity` →
  `writeBumpedVersionFiles`（`<現行version>→<target>` 差分を再生成）→ `git add package.json package-lock.json`
  → `git commit -m <message>` → `git push --force-with-lease origin <branch>`。エラー時は理由文字列を返す。
- `bump()`（既存）: 既存 `branchExists === true` の枝で、現状の「何もせず merge 再試行」を
  「乖離検知 → 乖離時のみ再構築」へ置き換える。それ以外（`!branchExists` 作成経路、`findOpenBumpPr`、
  `checkBumpPrScope`、`gh pr merge --admin`）は不変。再構築後も PR head は force push で自動更新され、
  同一 PR 番号・スコープ検査通過のまま admin merge へ進む。

### 依存関係

```text
bump() → detectBumpBaseDivergence → git(fetch/rev-parse/merge-base)
      → rebuildBumpBranchToMain → { ensureGitIdentity, writeBumpedVersionFiles, git(checkout/add/commit/push) }
      → findOpenBumpPr → checkBumpPrScope → gh(pr merge --admin)
```

循環依存なし。`writeBumpedVersionFiles`・`ensureGitIdentity` は既存関数を再利用する。

## CI 実行前提と force push 可否

`agent-skill-chain / release` ワークフローは `actions/checkout@v7`（`fetch-depth: 0`）で単一 checkout
し、bump ステップへ `RELEASE_MAIN_PAT` を渡す。main の branch protection ruleset は `refs/heads/main`
のみを対象（`deletion`・`non_fast_forward`・`pull_request`・`required_status_checks`）とし、
`release/bump-v*` ブランチは保護対象外である。既存の作成経路が同ブランチへ `git push` に成功している
実績から、同一認証で **非保護ブランチへの force push は技術的に可能**。`--force-with-lease` は fetch 済み
remote-tracking ref を期待値に使うため、`concurrency: {group: release}` の直列化と相まって競合時のみ安全に失敗する。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0005
    relation: references
```

ADR-0005 は「短命ブランチ `release/bump-v<target>` を PR 経由 admin merge で main へ反映」「同一 target の
既存ブランチ・PR は再利用（冪等・自己修復）」を確定済み。本設計はその枠内で、再利用時の base 乖離という
未対処の失敗モードを是正するバグ修正であり、新規 ADR を要さない（版数体系・反映方式・スコープ検査は不変）。

## 障害・ロールバック考慮

- 想定失敗モード1: `git push --force-with-lease` が競合（remote-tracking 期待値不一致）で失敗 →
  安全側で `human_required` として停止する（自動 delete+recreate は open PR を閉じ状態を複雑化するため採らない）。
- 想定失敗モード2: `git fetch`/`merge-base`/`rev-parse` 失敗 → `detectBumpBaseDivergence` が `error` を返し、
  `bump()` は `fail(...)` で停止（既存の各 git 失敗ハンドリングと同型）。
- ロールバック手順: 本修正は `bump()` の既存ブランチ枝に条件分岐を追加するのみ。切り戻しは当該コミットの
  revert で足り、作成経路・スコープ検査・merge 経路は無変更のため他機能へ波及しない。
- 自己修復性: 作成経路が checkout 時点の main を基準にするため単一 run 内で僅かに古い枝を作りうるが、
  次回 run の乖離検知が必ず再構築するため、最終的に常に現行 main 基準へ収束する。
- 影響を受ける既存機能: `release bump` の既存ブランチ再利用のみ。`resolve-version`/`tag`/`publish` は無影響。
