---
name: gate-review
description: Run conformance and falsification review for a completed agent-skill-chain segment (spec-gate, design-gate, implementation-gate, or validation-gate) and record the verdict.
when_to_use: Use when a segment worker has finished a segment and gate review should be performed before moving to the next segment or merging the PR.
---

# gate-review

## 目的

各セグメント完了時に、立証(conformance)＋反証(falsification)の2観点レビューでゲートを通過させる（AGENTS.md 不変条件I2）。ローカルモードでは不変条件、GitHubモードでは自動CI強制の無いガイドラインであり、実施要否は進行役が判断する。

## 対象範囲

1つのゲート（spec-gate / design-gate / implementation-gate / validation-gate）に対する、レビュア起動から判定記録までを担当する。次セグメントの起動・差し戻し先の決定・マージ可否の判断は進行役が行う（本スキルの対象外）。

## 前提

- 対象セグメントの成果物がcommit・push済みであること（`segment-work` スキル完了後）。
- read-onlyのゲートレビュアは複数並列実行できる（writer leaseとは独立）。

## 用語

- **review profile**: Standard（レビュア1体、既定）／Light（人間の明示要求時のみ、危険信号で自動Strict固定）／Strict（`risk != normal` または `autonomy == full`、専任2体）。
- **gate-report**: `.agent-skill-chain/schemas/gate-report.schema.yaml` 準拠の判定記録。

## 入力

- Issue ID、gate_id（`spec|design|implementation|validation`）、review profile、target_sha

## 出力

- gate-report（`conformance`・`falsification`・`final` の判定、blockers一覧）
- GitHubモード: Check Run（`agent-skill-chain/<gate>-gate`）へ発行した場合はその結果。ローカルモード: `reviews/<gate>.yaml`

## 手順

1. `.agent-skill-chain/scripts/gate-review.sh <issue_id> <gate_id> <profile> [target_sha]` を実行し、レビュアを起動してgate-reportを生成する。
2. レビュアはconformance（成果物が要求・受入条件を満たしているか）を先に判定し、続けてfalsification（見落とし・反証可能な欠陥が無いか）を判定する。
3. Strict profileの場合は専任2体を独立に起動し、両者の判定を集約する。
4. blockingな指摘がある場合、`finding.origin`（`specification|design|implementation|validation`）を確認する。指摘の起源セグメントが対象セグメントより前であれば、進行役へ差し戻し先として報告する。
5. `.agent-skill-chain/scripts/gate-publish.sh <issue_id> <gate_report_path>` でgate-reportを発行する（GitHubモードはCheck Run、ローカルモードは `reviews/<gate>.yaml`）。
6. 承認済み成果物の内容に変更があった場合は `.agent-skill-chain/scripts/gate-reconcile.sh` で当該ゲートおよび下流ゲートの無効化・再照合を行う。

## 制約

- レビュアはread-onlyであり、成果物の著述・修正は行わない。
- `gate-report`（`.agent-skill-chain/schemas/gate-report.schema.yaml` 準拠ファイル）を、判定結果の記録以外の目的で書き換えない。
- Light profileは人間の `review:light` 等の明示シグナルがある場合のみ適用し、危険信号があれば自動的にStrictへ固定する。

## 完了条件

- 対象ゲートの `final` が確定している（pass、または人間判断への昇格 `human_required`）。
- blockersがある場合、差し戻し先（`finding.origin`）が進行役へ報告されている。

## 検証方法

- gate-reportのスキーマ適合を `.agent-skill-chain/ci/verify-gate-report.sh` で確認する。
- GitHubモードでCheck Runへ発行した場合はCheck Run結果を確認する。

## 未決事項

なし。

## 対象外

- 次セグメントの起動判断、人間判断への昇格判断、マージ条件確認（進行役の責務）。
- 成果物自体の作成・修正（`segment-work` スキルの対象）。
