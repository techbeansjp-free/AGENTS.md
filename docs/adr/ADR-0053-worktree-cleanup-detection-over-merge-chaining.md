# ADR

```yaml
id: ADR-0053
status: proposed
title: マージ済みworktree放置は、マージ操作へのCLI自動連鎖ではなくdoctor検知＋手順明記で解消する
tags: [worktree, doctor, cleanup, git-conventions]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/scripts/cleanup.sh`（`agent-skill-chain cleanup <issue_id>` の薄いラッパー）は、対応するPR/Integration Recordが完了済み（merged/closed）であり、writer lease不在・未commit/未push差分が無いことを検査した上でworktreeを削除する機能を既に持つ。しかし、この検査・削除を「いつ」呼び出すかの仕組みが存在せず、PRマージ後に手動実行を忘れると`.worktrees/`配下は無期限に放置される。2026-08-02、別の消費者プロジェクトでの実害reportに加え、本リポジトリ（`techbeansjp-free/AGENTS.md`）自身の`.worktrees/`配下でも、対応PRが全てmerged/closed済みであるIssue 12件が長期間放置されていたことが発見された（ISSUE-351、SPEC.md参照）。

放置を防ぐ標準手順の実現方式として、以下2案を検討した。

1. **手順明記＋機械検知案**: `.agent-skill-chain/standards/GIT_CONVENTIONS.md`（進行役向け手順文書）へ「PRマージ完了直後に`cleanup <issue_id>`を実行する」という標準手順を明記し、加えて`doctor`へ「merged/closed済みPRに対応する残存worktreeを検知して警告する」検査を追加する。
2. **マージ操作へのCLI自動連鎖案**: 進行役のPRマージ操作自体を、新規CLIサブコマンド（例: `agent-skill-chain pr merge <issue_id>`）でラップし、`gh pr merge`実行後に自動で`cleanup`を連鎖実行する。

案2は、現状のCLIに存在しない新規コマンド（`pr create`はあるが`pr merge`相当は無い）を新設し、進行役のマージ操作そのものを本CLIの制御下に置くことになる。SPEC.mdは本Issueのスコープを「`cleanup`を`いつ・誰が呼び出すか`」の問題に限定し、「`cleanup`自体の削除条件判定ロジックの変更」を明示的に対象外としている。案2は削除条件判定そのものは変更しないが、マージ操作という別の権限境界（`roles.yaml`の`pr.merge`capability）を新たにCLIコマンド化する点で、本Issueが解決しようとする問題（cleanup呼び出しタイミングの欠落）に対して不釣り合いに大きい変更になる。加えて、`cleanup`自体が「writer lease不在・未commit/未push差分無し・PR完了済み」の4条件を安全側に検査してから削除するため、連鎖呼び出しのタイミングを多少誤っても実害（意図しない削除）は`cleanup`自身の既存ガードで防がれ、自動連鎖が案1に対して追加で得られる安全性向上は限定的である。

案1は`doctor`の既存`checks`配列パターンへの1項目追加のみで実現でき、新規コマンド・新規権限境界を導入しない。実害report 2（本リポジトリ自身での12件放置）は、そもそも`doctor`にこの検知が存在しなかったために気づけなかったものであり、検知の追加自体が実害の再発防止として機能する。「手順明記」だけでは実行を忘れるリスクが残るが、`doctor`検知がその見逃しを機械的に拾う安全網として働くため、両者の組み合わせでSPEC.mdの要件（進行役向け手順への明記、または自動連鎖のいずれか、もしくは組み合わせ）を満たす。

## Decision

案1（手順明記＋機械検知）を採用する。

- `doctor`に新規検査「マージ済みworktree残存」を追加し、`.worktrees/`配下の各worktreeについて対応するPR/Integration Recordの状態を`resolveIntegrationStatus()`（`src/lib/integration-status.ts`、新設）で判定する。`merged_or_closed`と判定されたもの全件をIssue ID付きで警告（NG）として列挙し、`open`および状態を判定できない`undetermined`（gh到達不能・PR未特定・Integration Record不在等）は警告対象に含めない。
- `resolveIntegrationStatus()`は、現在`src/commands/cleanup.ts`に直書きされているPR/Integration Record状態判定ロジックを抽出したものであり、`cleanup.ts`・`doctor.ts`の双方から共有される唯一の判定ロジックとする。これにより「削除してよい」（cleanup）と「削除すべきだと警告する」（doctor）の判定基準が将来乖離するリスクを構造的に排除する。
- `.agent-skill-chain/standards/GIT_CONVENTIONS.md`（配布物、consumer project共通の正本）と、本リポジトリ自身のdogfooding用project policyである`.agent-skill-chain/project/自己拡張ワークフロー.md`の双方に、「PRマージ完了直後に`cleanup <issue_id>`を実行する」標準手順を明記する。
- マージ操作自体をラップする新規CLIコマンドは本Issueでは新設しない（案2は不採用）。

## Consequences

- 利点: 新規コマンド・新規権限境界を追加せず、既存の`doctor`拡張パターンと`cleanup`の既存4条件ガードを再利用して実現できるため、変更範囲が小さく副作用のリスクが低い。判定ロジックの共有化により、`cleanup`と`doctor`の判定基準乖離を防ぐ副次的な保守性向上も得られる。
- 欠点・フォローアップ: 「手順明記」は進行役が実際にそれに従うかに依存し、`doctor`が定期的に実行されない環境では放置が一定期間検知されないままになりうる（`doctor`自体を自動実行するトリガーの整備は本Issueのスコープ外）。将来、手順明記だけでは放置の再発が防げないという新たな実害reportが生じた場合、マージ操作へのCLI自動連鎖（案2、または`doctor`の定期自動実行）を別Issueとして再検討する。
- ブランチ（ローカル/リモート）の削除自動化は本Issue・本ADRの対象外のまま据え置く（SPEC.mdのスコープ外事項と同一）。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。
