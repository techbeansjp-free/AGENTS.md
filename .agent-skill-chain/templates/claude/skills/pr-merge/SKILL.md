---
name: pr-merge
description: Move an agent-skill-chain Issue's Draft PR to Ready for Review after validation-gate passes, confirm CI, and merge (auto-merge or human merge).
when_to_use: Use when validation-gate has passed and the Draft PR created by the spec segment needs to become Ready for Review and be merged.
---

# pr-merge

# pr-merge

## 目的

④独立検証セグメントのゲート通過後、①セグメントで作成済みのDraft PRをReady for Reviewへ遷移させ、CI結果を確認したうえでマージする。Draft PR自体の新規作成は `segment-work` スキルの①条件分岐が担うため、本スキルはReady化以降のみを対象とする。

## 対象範囲

既存Draft PRのReady化、CI結果確認、マージ実行（auto-mergeまたは人間マージ）を担当する。Draft PRの新規作成・Issue/worktree自体の作成は対象外。

## 前提

- 対象Issueに、①セグメントで作成済みのDraft PR（`Closes #<issue_id>`）が存在すること。
- validation-gateの `final` が確定している（進行役がマージ可否を判断できる状態）こと。

## 用語

- **auto-merge**: `.agent-skill-chain/config/agent-skill-chain.yaml` の `merge.autonomous: true` の場合に、進行役が `pr merge` コマンド自体でマージしてよいこと。既定は `false`（人間の明示マージを要求）。
- **branch protection**: `main` への変更をPR経由のみに限定するGitHub側の強制（不変条件I4）。

## 入力

- Issue ID、対象PR番号
- validation-gateの判定結果

## 出力

- Ready for Review状態のPR
- マージ済みPR（`main` へのマージcommit）

## 手順

1. 対象PRのCheck Run結果（`agent-skill-chain/{spec,design,implementation,validation}-gate` と `verify`）を確認する。エラーがあれば原因を特定し、対応するセグメントへ差し戻すか人間へ報告する。CI結果を未確認のままマージ判断へ進めない。
2. `gh pr ready <pr_number>`（またはGitHub UI相当）でDraft PRをReady for Reviewへ遷移させる。
3. `.agent-skill-chain/config/agent-skill-chain.yaml` の `merge.autonomous` を確認する。
   - `true` の場合: `.agent-skill-chain/scripts/pr-merge.sh <gh pr merge に渡す引数...>` でマージする（`gh pr merge` への薄いラッパーであり、引数をそのまま透過する。マージ後にmain worktreeを `origin/<default-branch>` へfast-forward同期する）。
   - `false`（既定）の場合: 人間の明示マージを待つ。進行役・作業ワーカーは自動マージを実行しない。
4. branch protectionにより拒否される場合、`--admin` 付きマージが承認済み運用であるかを確認したうえで判断する（既定は人間確認を要求する安全側）。
5. マージ後、GitHub Issueがcloseされ、branch上の成果物がdefault branchの履歴へ入ったことを確認する。

## 制約

- CI結果未確認のままマージしない。
- `merge.autonomous: false`（既定）のプロジェクトで自動マージを行わない。
- branch protectionを回避する設定変更は行わない。

## 完了条件

- PRがマージされ、対象Issueがcloseされている。
- worktreeの削除は本スキルでは行わない（`cleanup` スキルへ引き継ぐ）。

## 検証方法

- `gh pr view <pr_number>` でマージ済み状態・Issue close状態を確認する。
- マージ後のmain worktreeが `origin/<default-branch>` と一致していることを確認する。

## 未決事項

なし。

## 対象外

- Draft PRの新規作成（`segment-work` スキルの①条件分岐）。
- ゲート審査そのもの（`gate-review` スキル）。
- worktreeの削除（`cleanup` スキル）。
