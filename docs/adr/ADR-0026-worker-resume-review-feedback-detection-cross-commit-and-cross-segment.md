# ADR

```yaml
id: ADR-0026
status: proposed
title: resumeしたセグメント作業ワーカーへの既存レビューフィードバック検出は、commit跨ぎのコメント除外を行わずローカルモードは全segmentのgate reportをorigin基準で走査する
tags: [worker-resume, review-status, github-backend, local-backend, i5-progression-role-purity]
supersedes: [ADR-0025]
superseded-by: null
deprecated-reason: null
```

## Context

ADR-0025（Issue #446、本ADRと同一Issue）は、resumeされたセグメント作業ワーカーへ同梱する「未対応の既存レビューフィードバック」の判定基準を、(a) 単純コメントは「対象ブランチの最新commit時刻（`git log -1 --format=%cI HEAD`）より`createdAt`が後のもの」、(b) ローカルモードは「対象segmentと同名のgate report（`reviews/<segment>.yaml`）の`gate.blockers`が非空であること」と確定した。ADR-0025のConsequences節は(a)について「workerが（レビューへの対応ではなく）無関係な理由で新しいcommitを積んだ直後に古いコメントへの対応がまだ済んでいない場合、そのコメントは次回resumeで『未対応』として再表示されなくなる（取りこぼし）」という限界を明示し、「必要になった時点で別Issueとする」としていた。

2026-08-05、Issue #446自身のPR #447に対するimplementation-gate（strict、独立2レビュア）で、両レビュアが一致して次の2件の実装上のblocking findingを検出した。

1. `SINCE_CUTOFF_DROPS_UNADDRESSED_FEEDBACK`: 上記(a)の限界がまさに顕在化する反例（レビュアがT1にコメント→workerが未対応のままT2(>T1)に無関係なcommitを実行→再開時のsince基準ではT1のコメントが消える）が、本Issue自身が防ごうとしている「commit済みであることのみを根拠に完了と判定する」失敗モードを検出機構自身が再導入していると指摘された。
2. `LOCAL_MODE_READS_ONLY_SAME_SEGMENT_GATE_REPORT`: 上記(b)の「同名gate reportのみ」という基準では、AGENTS.mdが定める`finding.origin`基準の差し戻し（例: implementationゲートが`origin: specification`のblocking findingを検出し、進行役がspecセグメントへ差し戻すケース）で、差し戻し先のワーカーが自分のセグメント名と異なるgate report（この例では`reviews/implementation.yaml`）に記録されたblocking findingを一切参照できないという欠落が指摘された。

いずれの指摘も、ADR-0025のDecision本文が明記した判定基準そのものに起因する。ADR-0025は設計ゲート承認済み（`status: accepted`）でありDecision本文は不変であるため、本文修正ではなく本ADR（新規、`supersedes: [ADR-0025]`）によって決定を置き換える。

検討した選択肢（(a)コメント判定について）:

1. **since基準を維持する（ADR-0025のまま）**: 既知の取りこぼしを引き続き受け入れる。本Issueの目的（resumeしたworkerが既存レビューフィードバックを確実に確認する）そのものを損なう既知の欠陥を放置することになり、implementation-gateの指摘と正面から矛盾するため不採用。
2. **since基準を「コメント投稿時点で存在した最新commit」に変更する**: 各コメント個別の投稿時刻と、その時点でのHEAD commitを比較する方式。これでも「投稿直後に無関係なcommitが1つ挟まる」ケースを救えない点はADR-0025と同型の欠陥が残るため不採用。
3. **「対応済み」を判定するための新規永続状態（例: 対応済みコメントIDを記録するファイル）を導入する**: SPEC.mdのスコープ（「本対応は進行役による成果物内容の著述・取り込みを新設しない。プロンプトへ含める内容はCoordination Backend側が既に保持する調整状態の転記に限る」）に反し、Coordination Backendが保持しない新しい調整状態を追加することになるため不採用。
4. **時刻によるカットオフを廃止し、定型marker（`<!-- agent-skill-chain:`）で始まらない全コメントを常に「未対応」とみなす（採用）**: GitHubのコメントAPIには解決状態が無い以上、時刻ベースの近似はいずれも取りこぼしを生む。時刻カットオフ自体を廃止すれば取りこぼしは原理的に発生しない。トレードオフとして、既に別の手段（例えば直後のcommitメッセージでの言及）で実質的に対応済みのコメントも次回resumeのたびに再掲され続けるが、内容がそのままプロンプトに含まれるためworker・進行役が「既に対応済み」と判断して読み飛ばせる。ADR-0025のConsequences節が既に「過検出は内容が見えるため気付ける」という同種の理由で許容していたトレードオフの延長であり、AC-4（レビュー・コメントが実際に存在しない場合の誤検出禁止）は「PR/Issueコメントが1件も無い」ケースを要求するのみで、「過去に存在したコメントを繰り返し示さない」ことまでは要求しない。

検討した選択肢（(b)ローカルモードのgate report走査について）:

1. **同名gate reportのみを読む（ADR-0025のまま）**: origin基準の差し戻しという主用途を機械的に検出できず、AGENTS.mdが定める差し戻し機構の一部が実質的に機能しない。不採用。
2. **全segmentのgate reportを走査し、origin値が起動対象segment（差し戻し先）と一致するblocking findingのみを収集する（採用）**: `origin`列挙値（`specification|design|implementation|validation`）とsegment名（`spec|design|implementation|validation`）は`spec`↔`specification`を除き1:1対応するため、追加のマッピング表は`spec`↔`specification`の1エントリのみで済む。走査対象を全segmentに広げても、フィルタ条件（origin一致）は変わらないため誤検出（無関係なblocking findingの混入）は生じない。

## Decision

resumeされたセグメント作業ワーカーへ同梱する「未対応の既存レビューフィードバック」の判定基準を、ADR-0025の決定を置き換えて次のとおり確定する。

- **レビュー（Approve/Request Changes）**: ADR-0025の決定を維持する。`gh pr view <pr> --json latestReviews` が返すreviewer毎の最新reviewのうち、`state === 'CHANGES_REQUESTED'` のものを未対応として扱う。
- **単純コメント（Issue・PR双方）**: 対象ブランチの最新commit時刻による時刻カットオフを廃止する。コメント本文が定型marker（`<!-- agent-skill-chain:` で始まる行。worker完了報告・gate-review-evidence双方が用いる既存prefix）で始まらない限り、作成時刻に関わらず常に「未対応」として扱う。
- **検出処理自体が失敗した場合**（`gh` 呼び出し失敗・JSON解釈失敗等）は、ADR-0025の決定を維持する。検出結果を「未対応が無い」として扱わず、`detection: 'failed'` として明示的にプロンプトへ含める。
- **ローカルモードのgate report走査**: 起動対象segment（差し戻し先）と同名のgate reportだけでなく、`spec`/`design`/`implementation`/`validation` 全segmentのgate report（`reviews/<segment>.yaml`）を走査し、`gate.blockers` のうち `origin` が起動対象segmentに対応する値（`spec`→`specification`、それ以外は同名）と一致する `severity: blocking` のfindingのみを収集する。
- **ローカルモードのgate report読み込み失敗時**: 個々のgate reportファイルの読み込み（YAML解釈）自体が失敗した場合、GitHubモードの`detection: 'failed'`と対称に、ローカルモードでも `detection: 'failed'` として明示する（ADR-0025では「blocker無し」と区別せずundefinedを返す設計だったが、AGENTS.md I8（安全側ラチェット）に照らし、検出失敗と検出結果ゼロを区別しない状態は是正する）。

## Consequences

- 利点: コメント判定の時刻カットオフ廃止により、「未対応フィードバックが無関係なcommitの存在によって不可視化される」という、本Issue #446自身が解決対象とする失敗モードと同型の取りこぼしが原理的に発生しなくなる。ローカルモードの全segment走査により、AGENTS.mdが定めるorigin基準の差し戻し機構が実際に機能するようになる。
- 欠点・limitation:
  - コメント判定は時刻カットオフを廃止したことで、既に別の手段で実質的に対応済みの過去コメントも、そのPRが存在する限り毎回のresumeで再掲され続ける（過検出）。内容がそのままプロンプトに含まれるため、worker・進行役が既知の対応済みコメントと判断して読み飛ばせることを前提とする。プロンプト肥大化のトリミング戦略はSPEC.mdスコープ外節のとおり引き続き別Issue対応とする。
  - ローカルモードの全segment走査は、対象Issueのsegment数（最大4ファイル）分のファイル読み込みが増えるが、いずれも小さいYAMLファイルでありパフォーマンス上の懸念は無い。
- follow-up: 過検出が実運用で許容できないほど頻発する場合、コメント単位の既読管理（新規永続状態の導入）を別Issueで検討する余地がある（本ADRの選択肢3を参照）。

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
