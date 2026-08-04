# ADR

```yaml
id: ADR-0025
status: proposed
title: resumeしたセグメント作業ワーカーへの既存レビューフィードバック検出は「reviewer毎の最新state」と「直近commit以降のコメント」を機械的基準とする
tags: [worker-resume, review-status, github-backend, i5-progression-role-purity]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

Issue #446（本ADRと同一Issue）のSPEC.mdが記録するとおり、2026-08-04にIssue #441のdesign segmentで、design-gateのblocking findingに対し進行役がPRへ修正依頼コメントを投稿したのちresumeしたworkerが、そのコメント・レビュー内容を一切参照せず「DESIGN.md/PLAN.md/ADRが存在しcommit済み」という静的completion checklistだけで完了と自己判定する事象が3回連続で再現した。原因は `segment start`（`src/commands/segment.ts`）が組み立てるworker起動プロンプト（role_contract）が、`.agent-skill-chain/config/roles.yaml` の静的内容のみで構成され、対象Issue/PRの動的なレビュー状態を一切含まないことにある。

この問題への対応として、resumeされたworkerへ「未対応の既存レビュー・コメント」を機械的に検出しプロンプトへ同梱する必要があるが、GitHubのコメントAPIには「対応済み/未対応」を表すフラグが無い（PRレビューの行内コメントスレッドにはGraphQL経由の `resolved` 状態があるが、単純なIssue/PRコメントには無い）。何を「未対応」とみなすかの基準を明確に決めなければ、SPEC.mdのAC-4（誤検出しない）とAC-2/AC-3（検出漏れしない）を両立できない。

検討した選択肢:

1. **GraphQL `reviewThreads.resolved` を使う**: PRの行内レビューコメントスレッドには公式の解決状態があり最も正確だが、(a) 単純なIssue/PRコメント（行に紐付かないコメント）には適用できず本Issueの実害再現シナリオ（進行役が単純コメントとして修正依頼を投稿）をカバーできない、(b) GraphQLクエリの追加実装コストとレート制限考慮が必要、(c) `gh pr view --json` の既存フィールド（`latestReviews`/`comments`、RESTベース）だけで完結する既存パターン（`gh-open-pr.ts` 等）から逸脱する。
2. **「対象ブランチの最新commit時刻より後に作成されたコメントを未対応とみなす」（採用）**: GitHubの公式な解決状態は使わないため近似に過ぎないが、本Issueの実害再現シナリオ（コメント投稿→新規commit無しでworker再起動）と完全に一致し、機械的に判定可能（`git log -1 --format=%cI HEAD` とコメントの `createdAt` の単純な文字列比較）。workerが新しいcommitを1つでも積めば、その後のコメントだけが「未対応」として次回resumeで示される。
3. **PRレビュー（Approve/Request Changes）は `latestReviews`（reviewer毎の最新1件）の `state === CHANGES_REQUESTED` を基準とする（採用）**: GitHub自身のマージブロック判定と同じ基準であり、同一reviewerの後続 `APPROVED` が自動的に古い `CHANGES_REQUESTED` を上書きするため、追加の重複排除ロジックが不要。

## Decision

resumeされたセグメント作業ワーカーへ同梱する「未対応の既存レビューフィードバック」の判定基準を次のとおり確定する。

- **レビュー（Approve/Request Changes）**: `gh pr view <pr> --json latestReviews` が返すreviewer毎の最新reviewのうち、`state === 'CHANGES_REQUESTED'` のものを未対応として扱う。GitHubのマージブロック判定と同一基準であり、reviewer側の解消操作（再レビューでのAPPROVE）だけで自然に解消される。
- **単純コメント（Issue・PR双方）**: 対象ブランチの最新commit時刻（`git log -1 --format=%cI HEAD`）より `createdAt` が後のコメントのみを未対応として扱う。GraphQLの行内コメント解決状態は使わない（採用理由は上記選択肢2参照）。
- **検出処理自体が失敗した場合**（`gh` 呼び出し失敗・JSON解釈失敗等）は、検出結果を「未対応が無い」として扱わず、`detection: 'failed'` として明示的にプロンプトへ含める。役割契約（`role_contracts.*.rules`）には検出成否に関わらず常に「作業再開時は最新レビュー・コメントを確認すること」という静的な指示を含め、自動検出はこれを補強する位置づけとする（自動検出が完全に失敗しても最小限の注意喚起は必ず機能する）。
- ローカルモードでは、対象segmentと同名のgate report（`reviews/<segment>.yaml`）の `gate.blockers` が非空であることを未対応の判定基準とする。GitHub側のような「状態遷移による自動解消」は無く、gate-reconcileによる無効化・再レビューでの上書きが唯一の解消経路になる。

## Consequences

- 利点: 本Issueの実害再現シナリオ（コメント投稿後、新規commit無しでの再起動）は確実に検出される。判定基準がすべて既存CLI（`gh`／`git`）の標準出力の単純な比較で完結するため、追加の外部依存・認証スコープ拡張が不要。
- 欠点・limitation: 「最新commit時刻より後」という基準は近似であり、次のような取りこぼし・過検出が理論上あり得る。
  - workerが（レビューへの対応ではなく）無関係な理由で新しいcommitを積んだ直後に古いコメントへの対応がまだ済んでいない場合、そのコメントは次回resumeで「未対応」として再表示されなくなる（取りこぼし）。
  - 逆に、レビューとは無関係な会話コメント（雑談・進捗確認等）が直近commit後に投稿されただけでも「未対応」として表示される（過検出、ただし内容がそのままプロンプトに含まれるためworker・進行役が誤りに気付ける）。
  - これらの限界はコメント本文の意味解析（NLP）をしない設計（SPEC.mdスコープ外節）である以上避けられないトレードオフとして受け入れる。
- follow-up: プロンプトへ埋め込む情報量のトリミング戦略（SPEC.mdスコープ外節）、GraphQL `reviewThreads.resolved` を将来的に併用するかどうかの判断は、本Issueでは扱わず必要になった時点で別Issueとする。

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
