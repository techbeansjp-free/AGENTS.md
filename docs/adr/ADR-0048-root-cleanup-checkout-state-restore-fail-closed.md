<!--
正本: AGENTS.md §ADR・テンプレート・テスト適用性
このファイルは Issue 毎（design セグメント）に複製して使う雛形である。docs/adr/ に保存する。
-->

# ADR

```yaml
id: ADR-0048
status: proposed
title: root-cleanup runのチェックアウト状態復元は、ローカルgit操作完了直後・スコープ検査/マージ実施前に行い、復元失敗時はfail-closedでマージを行わない
tags: [root-cleanup, worktree, checkout-state]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`agent-skill-chain root-cleanup run`（ADR-0007で確定）は、repoRoot直下に混入したIssueセグメント成果物を検出し、短命な作業用ブランチ `chore/root-cleanup-<timestamp>` を作成してcommit・push・PR作成・admin mergeまでを自動実行する。想定実行環境はCIランナーの使い捨てcheckoutだが、進行役が調整状態を直接操作する永続main worktreeから直接実行することもできる（ISSUE-619）。

永続main worktreeから直接実行した場合、コマンド完了後もチェックアウト中のブランチが一時ブランチのまま残り、実行前のブランチ（多くの場合default branch）へ戻らない。この状態のまま進行役が他のコマンド（例: `pr merge`、`main` への `--ff-only` 追従取得）を実行すると、それらのコマンドが「repoRootはmain worktreeでありdefault branchをチェックアウトしている」という前提を満たせず失敗する実害が生じる。

チェックアウト状態の復元をどの時点で行うか（一時ブランチでのローカルgit操作直後か、スコープ検査・admin merge完了後の最後か）、復元自体が失敗した場合にスコープ検査・admin mergeを続行するかどうかが、実装方針として決定を要する論点だった。

## Decision

1. チェックアウト状態の復元は、一時ブランチでのローカルgit操作（`checkout -b`・`git identity保証`・`rm`・`commit`・`push`・`gh pr create`）が完了（成功・失敗を問わず）した直後に行う。スコープ検査・admin mergeは `gh` CLI経由のAPI操作であり、ローカルのチェックアウト状態に依存しないため、復元をこれらより先に行っても既存の成功時の振る舞い（AC-6）に影響しない。
2. 復元処理（`restoreCheckoutState`）自体が失敗した場合は、fail-closedとしてスコープ検査・admin mergeを一切実行せず、即座にエラー終了する。標準エラー出力には復元に失敗した旨と、復元を試みた後の現在のチェックアウト中ブランチ名を含める。復元失敗を握りつぶして成功として終了しない。
   - この時点で一時ブランチのcommit・push・PR自体が既に成立している可能性があるが、それらを自動では破棄・クローズしない。進行役・人間が状況を確認したうえで手動対応できる状態を維持する。
3. チェックアウト状態の記録・復元は、`src/lib/worktree.ts` の `resolveCurrentBranchInfo`（CI環境の `GITHUB_HEAD_REF` によるdetached HEAD代替名解決、検証目的）とは独立した専用関数（`src/lib/checkout-state.ts` の `captureCheckoutState`/`restoreCheckoutState`）として実装する。復元対象は実行前に実際にチェックアウトしていたref（ブランチ名、またはdetached HEADの場合はcommit SHA）そのものであり、CI都合の代替名にすり替えてはならないため、既存の `resolveCurrentBranchInfo` を流用しない。
4. no-op終了（削除対象0件）および既存OPENブランチ・PR再利用（新規チェックアウト切り替えを伴わない）の2経路では、`captureCheckoutState`/`restoreCheckoutState` を一切呼ばない。これらの経路はチェックアウト状態を変更しないため、復元処理自体が不要である。

## Consequences

- 利点: 永続main worktreeから `root-cleanup run` を直接実行しても、完了後にworktreeのチェックアウト状態が実行前と一致するようになり、後続の進行役操作（`pr merge`、`main` への追従取得等）が阻害されなくなる。復元失敗時にfail-closedとすることで、チェックアウト状態が不整合なまま「成功」として扱われる事故を防ぐ。
- 欠点・フォローアップ:
  - 復元が完了するまでスコープ検査・admin mergeを実行しないため、復元失敗時は一時ブランチ・PRが自動でマージされずに残る。これは意図した安全側の挙動だが、進行役が手動でPRの後始末（マージまたはクローズ）を行う運用が必要になる。
  - 本決定は `root-cleanup run` 単体のチェックアウト状態管理のみを扱う。他コマンドが同様の一時ブランチ切り替えを行う場合の共通化は本Issueのスコープ外であり、必要になった時点で別途Issueとして扱う。

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
