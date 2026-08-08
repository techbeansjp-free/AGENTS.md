---
name: segment-work
description: Run one of the four agent-skill-chain segments (spec, design, implementation, validation) inside an Issue worktree, from writer lease acquisition through checkpoint push and gate review request.
when_to_use: Use when acting as a segment worker (spec_worker, design_worker, implementation_worker, or validation_worker) producing SPEC.md, DESIGN.md/PLAN.md, code, or VALIDATION.md for an Issue that already has a worktree.
---

# segment-work

## 目的

①要求・要件 ②設計・実装計画 ③実装 ④独立検証の4セグメントに共通する作業手続き（writer lease取得→worker起動→成果物作成→checkpoint push→ゲートレビュー依頼）を1つのスキルとして提供する。①セグメントのみ、初回checkpoint push直後にDraft PR作成という追加ステップを持つ。

## 対象範囲

Issue worktree内での1セグメント分の作業手続きを担当する。Issue・worktree自体の作成は `issue-start` スキル、ゲート審査の実施は `gate-review` スキル、Draft PRのReady化・マージは `pr-merge` スキルが担当する。

## 前提

- 対象Issueの `issue-start`（新規）または `issue-resume`（再開）が完了し、worktreeが存在すること。
- 直前セグメントのゲートが通過している（または①セグメントで直前セグメントが無い）こと。

## 用語

- **writer lease**: 1 Issueに同時1つのみ許可される書込み権（`.agent-skill-chain/schemas/lease.schema.yaml`、既定 `ttl_seconds: 3600` / `renewal_interval_seconds: 900`）。
- **checkpoint**: セグメント完了時のcommit+push。耐久性（不変条件I3）の単位。

## 入力

- Issue ID、対象segment（`spec|design|implementation|validation`）
- 直前セグメントのゲート結果（①以外）

## 出力

- 対象セグメントの成果物（`SPEC.md`／`DESIGN.md`・`PLAN.md`／コード・単体テスト結果／`VALIDATION.md`）
- 対象branchへのcommit・push
- ①セグメントのみ: Draft PR（`Closes #<issue_id>`）
- worker報告（`.agent-skill-chain/schemas/worker-report.schema.yaml` 準拠）

## 手順

1. `.agent-skill-chain/scripts/lease-acquire.sh <issue_id> <segment>` でwriter leaseを取得する。同一Issueで他のwriter leaseが有効な場合は取得できない（1 Issue = 同時1 writer lease）。
2. `.agent-skill-chain/scripts/worker-launch.sh <issue_id> <segment>` でセグメント作業ワーカーを起動する。アダプタ・モデル選択は `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.segment_overrides.<segment>` → `worker.adapter` → 既定 `human` の順で解決される。
3. 対象セグメントの成果物を作成・編集する。
   - ①specセグメント: `SPEC.md`
   - ②designセグメント: `DESIGN.md`・`PLAN.md`（ADRを伴う場合は `docs/adr/` へ追加、`status: proposed`）
   - ③implementationセグメント: コード・単体テスト
   - ④validationセグメント: `VALIDATION.md`
4. `.agent-skill-chain/scripts/checkpoint.sh "<commit message>"` でcommit+pushする（不変条件I3、durability.backendを参照）。
5. **①specセグメントのみ**: 初回checkpoint push直後に `.agent-skill-chain/scripts/pr-create.sh <issue_id> <branch>` を実行し、Draft PR（GitHubモード）またはIntegration Record（ローカルモード）を作成する。②③④セグメントでは実行しない（Draft PRは既に存在する同一PRのheadブランチへcommit/pushを続ける）。
6. `.agent-skill-chain/scripts/report-status.sh <issue_id> <role> <segment> <status> <target_sha> [blocked_reason] [human_escalation_requested]` で進行役へ完了またはblocked状態を報告する（`role` は `spec_worker|design_worker|implementation_worker|validation_worker`）。
7. `.agent-skill-chain/scripts/lease-release.sh <issue_id> [token]` でwriter leaseを解放する（`report-status.sh` が正常完了報告と併せて解放する場合はこの手順は不要、`worker-launch.sh` の終了コードで確認する）。
8. 進行役がゲートレビューの実施を判断した場合、`gate-review` スキルへ引き継ぐ。

## 設定項目追加時の手順（②designセグメント向け）

`.agent-skill-chain/config/agent-skill-chain.yaml` へ新規設定項目を追加する設計判断を行う場合は、次の手順を経る。

1. ハードコードでは対応できない理由を明示する。
2. 利用者・プロジェクト単位で値が変わる必要性を明示する。
3. `.agent-skill-chain/schemas/config.schema.yaml` を更新する。
4. 既定値を定義する。
5. migration（後方互換性）を定義する（加算のみで済む場合は「値が無い場合の既定扱い」の明記で足りる）。
6. 破壊的変更・分岐の場合はADRを作成する。

## 制約

- writer leaseを保持しない状態での成果物編集・commit・pushを行わない。
- 承認済みSPEC/DESIGNを、当該セグメント外で変更しない。
- ゲートレビューの実施要否・次セグメント起動は進行役が判断する（本スキルは実施しない）。

## 完了条件

- 対象セグメントの成果物がcommit・pushされている。
- worker報告（`report-status.sh`）が送信されている。
- writer leaseが解放されている（正常完了時）。

## 検証方法

- `git log`・`git push` の結果でcommit・push済みであることを確認する。
- `.agent-skill-chain/scripts/report-status.sh` の出力、または対象Issue/PRのコメントで報告済みであることを確認する。

## 未決事項

なし。

## 対象外

- ゲート審査そのもの（`gate-review` スキル）。
- Draft PRのReady化・マージ（`pr-merge` スキル）。
- worktreeの作成・削除（`issue-start`・`cleanup` スキル）。
