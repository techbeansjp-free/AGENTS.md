# PLAN: Dependabot PR で verify/reconcile CI が issue_id 抽出失敗により恒久的に落ちる問題の修正

- Issue: `ISSUE-215`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md の設計要素A〜Dを、影響範囲の小さい単位に分割して実装する。本体2ファイルを先に確定させ、次にテンプレート正本へ同一変更を反映し、最後に同期検査で整合を機械確認する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | ci.yml 本体（Derive issue_id 3分岐化） | `.github/workflows/agent-skill-chain-ci.yml` の「Derive issue_id」ステップに `ACTOR: ${{ github.actor }}` env を追加し、抽出成功=`skip_checks=false` / Dependabot許可リスト該当=`skip_checks=true` / それ以外=`exit 1` の3分岐へ書き換える（設計要素A） | AC-1, AC-3 | なし |
| 2a | ci.yml 本体（追跡系固有検査群への if: 付与） | 「Derive issue_id」以降の**ブランチ・Issue 追跡系**検査ステップ（verify-branch-name / verify-worktree-path / verify-artifacts / verify-ac-coverage / verify-adr / lint-vocab / lint-references / Fetch base branch for secret scan / lint-secrets / adr-lint）へ `if: steps.ctx.outputs.skip_checks != 'true'` を付与し許可リスト該当時は完全スキップ。既存 `if: github.base_ref != ''` を持つ2ステップは AND 併記。npm ci/build/test と「Fetch base branch for diff-based checks」は変更しない。**verify-template-sync はこのリストに含めない（#2b で別扱い）**（設計要素B1） | AC-1, AC-3 | #1 |
| 2b | ci.yml 本体（verify-template-sync の continue-on-error 付与） | verify-template-sync ステップには `if:` を**付けず常に実行**し、`continue-on-error: ${{ steps.ctx.outputs.skip_checks == 'true' }}` を付与する。Dependabot PR では非ブロッキング（可視化のみ）、Issue ブランチでは `false` に評価され従来どおりブロッキング。他の固有検査（#2a）とは扱いが異なる点に注意（設計要素B2） | AC-1, AC-3, AC-4 | #1 |
| 3 | reconcile.yml 本体（トリガーレベル早期スキップ） | `.github/workflows/agent-skill-chain-reconcile.yml` の `jobs.reconcile` へ `if: >- !(github.actor == 'dependabot[bot]' && startsWith(github.ref_name, 'dependabot/'))` を付与。既存 steps・「Derive issue_id」の exit 1 ガードは二重の安全網として変更しない（設計要素C） | AC-2, AC-3 | なし |
| 4 | テンプレート正本 ci.yml への同期 | `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml` へ #1・#2a・#2b と**同一**の変更を反映（設計要素D） | AC-4 | #1, #2a, #2b |
| 5 | テンプレート正本 reconcile.yml への同期 | `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-reconcile.yml` へ #3 と**同一**の変更を反映（設計要素D） | AC-4 | #3 |
| 6 | 同期整合の機械確認 | `./.agent-skill-chain/ci/verify-template-sync.sh` を実行し本体とテンプレート正本の一致（exit 0）を確認。差異があれば #4・#5 を修正 | AC-4 | #4, #5 |

## 実装順序の見直しについて

実装中に作業順序（上記変更単位の並び）のみを見直す場合は本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は DESIGN.md の更新および設計ゲートの再通過が必要になる。#1〜#5（#2a・#2b を含む）は同一 PR head ブランチへの連続 commit で実装し、#6 の検査は実装ゲート前に緑化する。
