# ADR

```yaml
id: ADR-0046
status: proposed
title: Issueセグメント成果物のroot直下混入をマージ前に予防する、常時失敗設計の必須CI checkと自動クリーンアップ連鎖
tags: [root-cleanup, ci-gate, pr-merge]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/config/segments.yaml` は SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md（Issueセグメント成果物）をリポジトリルート直下の裸ファイル名として定義する。これらはIssue完了後は破棄すべき一時成果物だが、配置場所がdefault branchとの合流点（root）と同一であるため、PRマージのたびにdefault branchのrootへ混入する。既存の唯一の対策は `root-cleanup run`（Issue #208、ADR-0007）であり、push to mainを契機とする事後検出・削除にとどまる。ADR-0007は、Issueブランチ自体へ削除commitをpushする案（案1）を、`gate-reconcile.sh` による承認済み成果物のdigest不一致扱い・当該ゲートおよび下流ゲートの無効化という理由で不採用とした。

実運用で、通常フロー（Issue完了→PRマージ）だけで2回連続してroot直下へのSPEC.md等の混入が発生し、`root-cleanup run` 自体も別の不具合（PR作成先base branchのハードコード、別Issueで対応済み）により2回とも失敗し手動対応を要した。事後cleanupのみでは混入そのものを防げず、マージ前の予防側チェックが必要になった（ISSUE-590）。

制約として、`.agent-skill-chain/config/segments.yaml` の `outputs` 定義・AGENTS.md本体・成果物配置パス（root直下）は変更しない前提を維持する必要があり（成果物配置の変更はセグメント自体の変更に該当し破壊的変更となるため）、かつ削除操作はIssueブランチ自体へのcommitとして行えない（ADR-0007が確立した制約と同一理由）。

## Decision

以下の2要素を組み合わせて採用する。

1. **常時失敗設計の必須CI check**: `.github/workflows/agent-skill-chain-ci.yml` の既存必須ジョブ `verify` に、`verify-root-clean (merge-ready)` ステップを追加する。条件は「PRがdraftでない（`ready_for_review` 後）」に限定し、既存の `.agent-skill-chain/ci/verify-root-clean.sh`（`verify root-clean` CLI）をそのまま再利用してrepoRoot直下の対象4ファイルの存在を検査する。Issueブランチには削除commitを一切追加しない設計上の制約により、この検査は「validation-gateまで正常に完了したPR」に対しても原理的に恒常的に失敗する。これは意図した設計であり、GitHub UIからの素の「Merge pull request」操作・非admin経路での `gh pr merge` を一貫してブロックする予防効果として機能する。
2. **`pr merge` コマンドへの自動クリーンアップ連鎖**: `src/commands/pr.ts` の `merge()` を拡張し、`gh pr merge`（`--admin` でのbypassを要求する）成功・既存の `syncMainWorktree()` 完了後に、同一プロセス内で既存の `root-cleanup.ts` の `run()`（Issue #208で導入済み、無変更のまま再利用）を呼び出す。これにより、validation-gateを完了させ `pr merge --admin` でマージを完了させた進行役・作業ワーカーは、追加の `git rm` 等の手動操作を一切要求されない。

既存の非同期 `root-cleanup` workflow（push to main契機）は無変更のまま保険として併存させる。同期呼び出し（2）が失敗した場合でも、非同期workflowが独立に後追いで検出・修復する。

### 検討した代替案

- **案A（本Issueが不採用と確定済みの再検討）**: Issueブランチへ削除commitをpush。ADR-0007の既存理由（gate-reconcileによるゲート自己破壊）により不採用。
- **案B: GitHub API/git plumbingで「Issue branchの内容から対象4ファイルを除いたtree」を持つ独立ブランチ・PRを作成し、それを実際のマージ対象とする**（Issue自身のPRは最終的にクローズのみ）。技術的には実現可能だが、(a) 元PRの「Merged」バッジが自動反映されない場合がありうる、(b) Issueの成果物追跡（PR本文・レビュー履歴）が実際にマージされるコミットと直接one-to-oneで対応しなくなり I1 追跡可能性の可読性を損なう、(c) 新規の「派生ブランチ＋派生PR」という運用概念を追加導入するコストが高い。既存の `root-cleanup` 機構（短命ブランチ＋PR＋admin squash merge）と機能的に重複する新規経路を追加することになり、シンプルさで劣ると判断し不採用とした。
- **案C: 必須checkにせず、警告のみの非必須statusとする**: 実効的な予防（マージのブロック）にならず、SPEC.mdの受け入れ基準（AC-1: 検査失敗によるブロック）を満たさないため不採用。

## Consequences

- 利点: root直下の混入を、GitHub UIからの素のマージ操作に対しては構造的にブロックできる。既存の `root-cleanup` ロジックを完全に再利用するため、削除ロジックの重複実装・new failure modeの追加を避けられる。
- 欠点・トレードオフ: validation-gateを完了した正常なPRであっても、`pr merge` は常に `--admin`（必須status checkのbypass）を要求するようになる。これは意図した設計だが、`--admin` 経路が事実上の標準運用になる点は、必須checkの一般的な使われ方（「満たせば通る」）からは外れた挙動であり、運用文書（`pr-merge.sh` ヘッダコメント・`MERGE_USAGE`・`GIT_CONVENTIONS.md`）での明示が必須になる。
- フォローアップ: `pr merge` の同期クリーンアップ呼び出しが `human_required`（root-cleanup側のスコープ検査失敗等）を返した場合の運用手順（誰がどう対応するか）は、実装セグメントでのエラーメッセージ設計に委ねる。将来、GitHub側でPRマージ時に任意のtree変更を伴う「squash with exclusions」相当のネイティブ機能が提供された場合は、本ADRの案Bを再評価する余地がある。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。

## ライフサイクル

```text
DESIGNワーカー   → ADR を proposed で作成
設計レビュア     → ADR 本文をレビュー（read-only）→ content digest を承認
進行役           → adr-finalize.sh を起動
ADR finalization → writer lease を取得 → status を accepted へ更新
ワーカー           → commit・push → content digest を再検査
```

- `proposed → accepted`: 設計ゲート承認時に遷移する。設計レビュアは ADR 本文をレビューし content digest を承認するのみ（read-only、直接 status を書き換えない）。進行役が `.agent-skill-chain/scripts/adr-finalize.sh` を起動し、専任の ADR finalization ワーカーが writer lease を取得したうえで `status` のみを `accepted` に更新して commit・push する（`.agent-skill-chain/config/roles.yaml` の `adr_finalization_worker`、`scope: adr_status_only`）。finalization ワーカーは書込み前に content digest を再検査する。
- `accepted → superseded`: 新しい ADR を含む同一 PR 内で、新 ADR の作者（ワーカー）が旧 ADR の `status` / `superseded-by` を同一 PR で更新する。`supersedes` ⇔ `superseded-by` の対称性・参照先の実在が機械検査される。
- `accepted → deprecated`: 前提が消滅し後継が無い場合に遷移する。`deprecated-reason` に1行の理由を記録する（存在検査あり）。

## related_adrs 参照ルール

他 Issue の `DESIGN.md` から本 ADR を参照する場合は `related_adrs:` フィールド（構造化リスト）を用いる。stale 参照検査（`adr-lint.sh check`）はこのフィールドのみを対象とし、`accepted` の ADR のみ参照可能とする。本文中の自然文による歴史的言及（例: 「本決定は ADR-0007 を置き換える」）は検査対象外であり許可される。
