# PLAN: CI/gate運用の本番導入とE2Eフロー実地一周

- Issue: `ISSUE-171`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

本Issueは実地実行が先行し、CI上で発見された問題への対応を都度追加した経緯があるため、実際に実施した順序をそのまま記録する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `init`実行・config変更 | `npm ci` → `init --dry-run` → `init`実行 → `review.adapter`を`human`へ編集 | `AC-1, AC-2, AC-3, AC-4` | なし |
| 2 | branch-name/既存テスト確認 | `verify branch-name`実行、`npm test`実測（初回314/322pass、8fail特定） | `AC-5, AC-6` | `#1` |
| 3 | テストfixtureの実リポジトリ状態結合解消 | `test/helpers/tmp-repo.ts`が本リポジトリの可変な現在状態（`.installed_version`・`review.adapter`）に結合していた問題を修正（commit `9fb39e9`） | `AC-6` | `#2` |
| 4 | CI単一checkout対応（`findIssueWorktree`） | `.worktrees/`型レイアウトが無いCI単一checkoutでもissueを解決できるようフォールバック追加（commit `edd5990`） | `AC-6` | `#1` |
| 5 | detached HEAD対応（`findIssueWorktree`） | `GITHUB_HEAD_REF`フォールバックを追加（commit `7182636`） | `AC-6` | `#4` |
| 6 | `GITHUB_OUTPUT`形式エラー修正 | gate workflowの複数行標準出力から`gate_report_path:`のみ`sed`抽出（commit `686bbd3`） | `AC-6` | `#5` |
| 7 | `GH_TOKEN`欠落修正 | gate/reconcile workflowの`gh`呼び出しステップに`GH_TOKEN`を付与（commit `37b96b2`） | `AC-6` | `#6` |
| 8 | detached HEAD対応の共有ヘルパー統一 | `resolveCurrentBranchInfo()`/`resolveCurrentBranch()`を新設し、`verify branch-name`・`checkpoint`・`findIssueWorktree`から共通利用（commit `bae0fda`）。副次的に`checkpoint`のpush refspecを`HEAD:refs/heads/<branch>`へ修正 | `AC-5, AC-6` | `#5` |
| 9 | 正式成果物規約への対応 | `segments.yaml`が定める`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`をリポジトリルートへ新設し、旧`docs/maintainer/workflow/`形式から正式規約へ対応させる | `AC-7` | `#1〜#8` |

## 実装順序の見直しについて

#1〜#8は既に完了・commit済みである。本ファイルは#9（本セッションの作業）着手前の実施済み内容を含めて記録した。#9以降に作業順序のみを見直す場合は本ファイルのみ更新すればよく、DESIGN.mdの更新は不要である。
