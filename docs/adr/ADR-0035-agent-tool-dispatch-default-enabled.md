# ADR

```yaml
id: ADR-0035
status: accepted
title: worker.agent_tool_dispatch.enabledの既定値をfalseからtrueへ反転する
tags: [worker-launch, agent-tool, config-default, subagent-visibility]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

ADR-0030（`ISSUE-448`、accepted、2026-08-05マージ）は、進行役がClaude Code CLIセッションである場合に`worker-launch.sh`が起動するsegment workerを、進行役自身のAgent tool呼び出しとしてサブエージェントツリー上に可視化する機構を確定した。同ADRのConsequencesは、この機構を`worker.agent_tool_dispatch.enabled`（既定`false`）のopt-inとして導入する理由を、進行役セッションとworkerの生存期間結合・Bashコマンド単位のツール許可粒度低下・`contract.md`へのRead残存リスク・Agent tool戻り値のコンテキスト漏えいという4種の既知の残存リスクに基づいて記録している。

しかし機構の実装（PR #457マージ）後も既定値が`false`のままであったため、この機能は導入後も未使用の状態が続いた。2026-08-06、進行役がIssue #461/#462/#429を並行対応中、ユーザーから「Agent tool使うように前に指示したはず」との指摘を受けた。ユーザーはADR-0030の目的（可視性の実現）が実際に有効な状態として動作することを期待しており、実装済みだが既定offのままという状態はこの期待に反していた。`ISSUE-470`はこの既定値を反転し、期待と実際の挙動を一致させることを目的とする。

## Decision

`.agent-skill-chain/config/agent-skill-chain.yaml`の`worker.agent_tool_dispatch.enabled`を`false`から`true`へ変更する。

`resolveWorkerSelection`（`src/lib/worker-selection.ts`）の真偽値の厳密等価比較（`agent_tool_dispatch?.enabled === true`）、および`.agent-skill-chain/adapters/claude.sh`のClaude Code CLIセッション判定分岐（ADR-0030 Decision 1）は一切変更しない。この既存ロジックは設定値の真偽とセッション種別だけを入力に機械的に分岐を評価する設計であるため、既定値を反転するだけでISSUE-448 AC-2（Claude Code CLIセッション判定が真の場合はAgent tool経由が選択される）・AC-3（それ以外はheadlessへフォールバックする）・AC-8（明示的な`false`は引き続き`false`として解決される）のいずれの挙動にも矛盾なく到達する。

`.agent-skill-chain/schemas/config.schema.yaml`の`examples`ブロック2箇所、および`.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md`の既定値に関する叙述は、実効設定の値と矛盾しないよう`true`へ更新する。後者は「明示的に`false`を設定した場合は引き続きheadlessのままである」という説明を保持し、既定値の反転がopt-outの選択肢自体を失わせないことを明記する。

進行役セッションとworkerの生存期間結合の制約自体（進行役セッション終了でworkerも終了する）は本Issueの対象外とし解消しない。

## Consequences

- ADR-0030のConsequences（accepted、不変）が述べる「opt-in（既定false）を有効化しない限り、既存のheadless subprocess方式は一切変更されない」という記述は、機構自体の性質としては引き続き正しい——`enabled: false`へ戻せば即座に旧来のheadless専用挙動へ復帰する。本ADRが変更するのは、本リポジトリの実効設定ファイルがどちらの値を既定として出荷するかのみである。
- ADR-0030が「既定offのopt-in」という前提のもとで受容した4種の残存リスク（進行役セッションとworkerの生存期間結合、Bashコマンド単位のツール許可粒度低下、`contract.md`へのRead残存リスク、Agent tool戻り値のコンテキスト漏えい）は、本Issue以降、opt-inした一部プロジェクトだけでなく、本リポジトリでClaude Code CLIセッションが進行役を務めるすべての運用で既定として発生するようになる。この露出範囲の拡大を、以下2点を根拠に受容する：(a) ISSUE-448 AC-2/AC-3のセッション判定分岐は変更しないため、human運用・CI・cronでは既定でheadless専用のまま無影響である、(b) 機構自体・リスク低減設計（役割分離、SHA256監査証跡、TTL失効安全網等）・ロールバック手段はADR-0030で既に確定・レビュー済みであり、本ADRはそれらを変更しない。
- 進行役セッションとworkerの生存期間結合の制約自体は未解消のまま残る。解消は本Issueのスコープ外であり、必要であれば別Issueで扱う。
- ロールバックは`.agent-skill-chain/config/agent-skill-chain.yaml`の当該値を`true`から`false`へ書き戻す1行の変更のみで完結し、ADR-0030が確立した機構・コード自体には一切影響しない。

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
