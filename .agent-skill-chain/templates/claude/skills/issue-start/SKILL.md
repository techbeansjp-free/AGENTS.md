---
name: issue-start
description: Create the GitHub Issue (or local state.yaml), the dedicated branch, and the dedicated git worktree that agent-skill-chain requires before any segment work begins.
when_to_use: Use when the user asks to start work on a new agent-skill-chain Issue, or when a new feature/bugfix/hotfix/refactor/docs/process/chore unit of work needs its own branch and worktree before SPEC.md can be written.
---

# Issue起票とworktree開始

## 目的

1 Issue = 1 ブランチ = 1 worktree という agent-skill-chain の分離規約（AGENTS.md 不変条件I4）に従い、Issueに対応するブランチとworktreeを機械的な命名規約で作成する。

## 対象範囲

Issueの起票（GitHubモードではGitHub Issue作成、ローカルモードでは `state.yaml` 作成）から、最初のworktreeが使える状態になるまでを担当する。SPEC.md以降の成果物作成、writer lease取得、checkpoint pushは `segment-work` スキルが担当する。

## 前提

- `.agent-skill-chain/config/agent-skill-chain.yaml` が導入済みで、`coordination.backend`（github | local）が確定していること。
- `agent-skill-chain` CLI（`bin/agents-md.js` またはインストール済みバイナリ）が利用可能であること。

## 用語

- **worktree**: 1 Issueに対応するgit worktree。パスは不変（`immutable_path: true`）。
- **timestamp**: worktreeパス・ブランチ命名に使うIssue起票日時（Asia/Tokyo、`%Y%m%d_%H%M%S`）。

## 入力

- Issue ID（`ISSUE-<番号>` 形式）
- type（`feature|bugfix|hotfix|refactor|docs|process|chore` のいずれか、`.agent-skill-chain/config/agent-skill-chain.yaml` の `issue.allowed_types` が許可する集合）
- slug（英数字とハイフンで構成する短い識別子、`worktree.slug_max_length` 以内）
- issue_created_at（Issue起票日時、ISO 8601）

## 出力

- ブランチ: `<type>/<issue_id>-<slug>`（`branch.pattern`）
- worktree: `.worktrees/<timestamp>-<type>-<issue_id>-<slug>/`（`worktree.path_pattern`）
- GitHubモード: GitHub Issue。ローカルモード: `state.yaml`

## 手順

1. `.agent-skill-chain/scripts/issue-start.sh <issue_id> <type> <slug> <issue_created_at>` を実行する（`agent-skill-chain issue start` サブコマンドの薄いラッパー）。省略可能なオプションは `issue-start.sh -h` で確認する。
2. スクリプトはIssue ID・type・slug・起票日時から決定的にブランチ名とworktreeパスを導出し、`git worktree add` でworktreeを作成する。
3. 作成後、`git worktree list --porcelain` を実行し、意図したパス・ブランチで作成されたことを確認する（worktreeの正本は `git worktree list --porcelain` であり、本スキルの出力メッセージだけを信頼しない）。
4. 中断が発生した場合（type不正・slug超過・ブランチ名衝突等）はエラーメッセージをそのまま報告し、推測で値を補正しない。
5. 既存Issueへの復帰（worktreeを保持したまま作業を再開する場合）は `.agent-skill-chain/scripts/issue-resume.sh <issue_id>` を使う。新規worktree作成は行わない。

## 制約

- ブランチ名・worktreeパスは `.agent-skill-chain/config/agent-skill-chain.yaml` の `branch.pattern`・`worktree.path_pattern` が定める命名規約から外れてはならない（`.agent-skill-chain/ci/verify-branch-name.sh`・`.agent-skill-chain/ci/verify-worktree-path.sh` が機械検査する）。
- worktreeパスは作成後不変（`immutable_path: true`）。作成し直す場合は `cleanup` スキルで削除してから再作成する。

## 完了条件

- ブランチとworktreeが命名規約どおりに作成され、`git worktree list --porcelain` から確認できる。
- GitHubモードではIssueが作成されている。ローカルモードでは `state.yaml` が作成されている。

## 検証方法

- `git worktree list --porcelain` の出力を目視確認する。
- `.agent-skill-chain/ci/verify-branch-name.sh`・`.agent-skill-chain/ci/verify-worktree-path.sh` を実行し、命名規約適合を機械的に確認する。

## 未決事項

なし。

## 対象外

- SPEC.md以降の成果物作成、writer lease取得、Draft PR作成（`segment-work` スキルの対象）。
- worktreeの削除（`cleanup` スキルの対象）。
