---
name: cleanup
description: Safely remove an agent-skill-chain Issue's git worktree after the PR is complete, using the cleanup command instead of a direct git worktree remove.
when_to_use: Use after a PR has merged (or the Issue is otherwise complete) and the worktree for that Issue needs to be removed.
---

# cleanup

## 目的

Issue完了後にworktreeを安全に削除する。直接 `git worktree remove` を実行せず、削除前条件（writer lease不在・未commit変更なし・未push commitなし・PR/Integration Record完了済み）を機械的に検査してから削除する。

## 対象範囲

1つのIssueに対応するworktreeの削除判定・削除実行を担当する。PRのマージ判断自体は `pr-merge` スキルが担当する。

## 前提

- 対象Issueの作業（PRマージ、またはIssue自体の完了判断）が済んでいること。

## 用語

- **削除前条件**: writer leaseが存在しない、未commitの変更が無い、未pushのcommitが無い、PR/Integration Recordが完了済み、の4条件。

## 入力

- Issue ID

## 出力

- worktreeの削除結果（`git worktree remove` → `git worktree prune`）

## 手順

1. `.agent-skill-chain/scripts/cleanup.sh <issue_id>` を実行する。
2. スクリプトは削除前条件（writer lease不在・未commit変更なし・未push commitなし・PR/Integration Record完了済み）をこの順で検査する。
3. いずれかの条件を満たさない場合、削除は中断され理由が報告される。理由を確認し、必要な対応（leaseの解放、commit・pushの完了、PRのマージ）を行ってから再実行する。未commitの変更が残っている場合は、価値を確認せずに削除しない。
4. 全条件を満たす場合、`git worktree remove` を実行し、続けて `git worktree prune` で参照を整理する。
5. 削除後、`git worktree list --porcelain` で対象worktreeが一覧から消えていることを確認する。

## 制約

- `cleanup` を経由しない直接の `git worktree remove` は行わない（`enforce on` を配線したプロジェクトではPreToolUse hookが拒否する）。
- 削除前条件の検査を省略・迂回しない。untracked成果物が残っている可能性がある場合は、削除前に価値を確認する。

## 完了条件

- worktreeが削除され、`git worktree list --porcelain` の一覧から消えている。
- `.worktrees/` 配下に対象ディレクトリが残っていない。

## 検証方法

- `git worktree list --porcelain` の出力を目視確認する。

## 未決事項

なし。

## 対象外

- PRのマージ判断・実行（`pr-merge` スキル）。
- ゲート審査（`gate-review` スキル）。
