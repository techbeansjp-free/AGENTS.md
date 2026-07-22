<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
-->

# PLAN: main リポジトリルート直下に混入した stray なセグメント成果物ファイルの削除

- Issue: `ISSUE-200`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md で定義した通り、変更内容は削除のみであり単一の変更単位で完結する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | root 直下 stray ファイルの削除 | `git rm SPEC.md DESIGN.md PLAN.md VALIDATION.md` を worktree ルート直下で実行し、削除内容を commit する。`.agent-skill-chain/templates/issue/` 配下の雛形ファイルおよび `.worktrees/` 配下の他 Issue 成果物には触れない | `AC-1` | なし |
| 2 | CI 通過確認 | #1 の commit を push した PR に対し、既存 CI ワークフロー（`.github/workflows/agent-skill-chain-ci.yml` 等、`verify-branch-name`・`verify-worktree-path`・`verify-template-sync`・`verify-artifacts`・`verify-ac-coverage`・`verify-adr` を含む）が全て成功することを確認する | `AC-2` | `#1` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

## 補足: 実際の削除実行タイミング

本 design セグメントでは実際のファイル削除は行わない。削除の実行は上表 #1 の通り**実装セグメントの責務**とし、design セグメントの成果物は本 DESIGN.md・PLAN.md の執筆に限定する。
