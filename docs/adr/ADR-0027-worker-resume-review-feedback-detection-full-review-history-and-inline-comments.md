# ADR

```yaml
id: ADR-0027
status: proposed
title: resumeしたセグメント作業ワーカーへの既存レビューフィードバック検出は、reviewer毎の最新提出のみを見る`latestReviews`ではなく全レビュー履歴を、PR会話コメントに加えインラインレビューコメントも対象とする
tags: [worker-resume, review-status, github-backend, i5-progression-role-purity]
supersedes: [ADR-0026]
superseded-by: null
deprecated-reason: null
```

## Context

ADR-0026（Issue #446、本ADRと同一Issue）は、resumeされたセグメント作業ワーカーへ同梱する「未対応の既存レビューフィードバック」の判定基準を、(a) レビューは `gh pr view --json latestReviews` が返すreviewer毎の最新1件のうち `state === 'CHANGES_REQUESTED'` のものを未対応とみなす、(b) 単純コメント（Issue/PR会話コメント）は時刻カットオフを廃止し定型marker以外を常に未対応とみなす、(c) ローカルモードは`spec`/`design`/`implementation`/`validation`全segmentのgate reportを走査する、と確定した。ADR-0026は設計ゲート（strict、独立2レビュア）を通過し `accepted` へ遷移、実装（commit `2d786fa7`）まで完了した。

2026-08-05、Issue #446自身のPR #447に対するimplementation-gate（strict、独立2レビュア、attempt_id違いの2組が同一target_shaへ投稿）で、両attemptが一致して次の2件の実装上のblocking findingを検出した。

1. `LATEST-REVIEWS-MASKS-CHANGES-REQUESTED`: `gh pr view --json latestReviews` はreviewer毎に「直近の提出」1件だけを返す。reviewer-aが`CHANGES_REQUESTED`を提出した後、同じreviewer-aが（`APPROVED`ではなく）`COMMENTED`を追加提出すると、GitHub上はそのreviewerの変更要求が解除されていないにもかかわらず、`latestReviews`ではそのreviewerの状態が`COMMENTED`として観測され、`unresolved_reviews`から消える。PRの`comments`にもレビュー本文は含まれないため、未解除の変更要求とその本文が`review_status`から完全に消える。これは本Issue自身が解消対象とする「未対応レビューを見失う」失敗モードそのものである。
2. `REVIEW-THREAD-COMMENTS-NOT-FETCHED`: `gh pr view --json comments` が返すのはPRのissueレベル会話コメントのみで、差分行に紐づくレビュースレッド（インラインレビューコメント、review thread comment）は含まれない。レビュアが差分行にインラインコメントで修正依頼を残し、レビュー本文を空のまま提出した場合、その指摘はどこからも取得されない。

いずれの指摘も、ADR-0026のDecision本文が明記した判定基準そのものに起因する。ADR-0026は設計ゲート承認済み（`status: accepted`）でありDecision本文は不変であるため、本文修正ではなく本ADR（新規、`supersedes: [ADR-0026]`）によって決定を置き換える。

検討した選択肢（(a) レビュー判定基準について）:

1. **`latestReviews`基準を維持する（ADR-0026のまま）**: 上記1.の欠陥をそのまま残す。本Issueの目的そのものを損なうため不採用。
2. **`gh pr view --json reviewDecision`（GitHub自身が計算する権威ある`APPROVED`/`CHANGES_REQUESTED`/`REVIEW_REQUIRED`フィールド）を判定基準に採用する**: implementation-gateの修正依頼コメントが提案した案。本ADR起票にあたり本リポジトリ自身のPR #447で実機検証（`gh pr view 447 --json reviewDecision`）したところ、空文字列が返ることを確認した。原因は本リポジトリの`main`ブランチに「レビュー必須」のbranch protectionが設定されていないこと（`gh api repos/techbeansjp-free/AGENTS.md/branches/main/protection`が404 `Branch not protected`を返す）で、GitHubは必須レビュー設定が無いリポジトリでは`reviewDecision`を計算せず空文字列を返す。`reviewDecision`を採用すると、レビュー必須のbranch protectionを設定していない任意のリポジトリ（consumer projectを含む）で`unresolved_reviews`が常に空になり、本Issueが解消対象とする失敗モードより深刻な退行（未対応レビューの完全な握りつぶし）を静かに再導入するため不採用。
3. **`gh pr view --json ...,reviews`（全レビュー提出履歴）を取得し、reviewerごとに`state`が`APPROVED`または`CHANGES_REQUESTED`である提出のみを対象に時系列で最新の1件を求める（`COMMENTED`提出は比較対象から除外し無視する）方式を採用する（採用）**: GitHub上、reviewerの`COMMENTED`追加提出は当該reviewerの`CHANGES_REQUESTED`を解除しない（解除するのは`APPROVED`提出または明示的なdismiss操作のみ）という実際の挙動に合わせ、`COMMENTED`を時系列比較から除外することで欠陥1.を解消する。`reviews`フィールドは`gh` CLI実測（本リポジトリPR #447、`gh pr view 447 --json reviews`）で`author`/`state`/`body`/`submittedAt`等を含むことを確認済みであり、`reviewDecision`と異なりbranch protection設定に依存せず、レビュー提出履歴のみから自己完結して計算できる。

検討した選択肢（(b) インラインレビューコメントの取得について）:

1. **取得しない（ADR-0026のまま、対象外とする）**: 上記2.の欠陥をそのまま残す。SPEC.md「スコープ外」節が対象外とするのは「コメントのスレッド解決状態（resolved/unresolved）」の判定のみであり、インラインコメント自体の存在・内容の検出は対象外に含まれないため、対象外とする根拠が無く不採用。
2. **GraphQL APIの`reviewThreads`で取得する**: スレッド解決状態（resolved/unresolved）まで取得できるが、既存の`gh` CLI呼び出し（REST/`gh pr view`ベース）に加えGraphQLクエリの組み立て・パースという新しい依存様式を導入することになり、本Issueが解決対象とする失敗モード（インラインコメントの見落とし）の解消に対して過剰な実装コストとなる。スレッド解決状態の判定自体はADR-0026時点から既に対象外と確定済みであり、本ADRでもこの対象外判断は変更しない。
3. **REST API（`gh api repos/{owner}/{repo}/pulls/<pr番号>/comments`）で取得する（採用）**: 差分行に紐づくインラインレビューコメントを取得できる。スレッド解決状態は取得できないが、対象外のままで問題ない（選択肢2参照）。既存コード（`src/commands/bootstrap.ts`の`pagedCheckRuns()`等）と同じ`gh api repos/{owner}/{repo}/...`呼び出し形式を再利用でき、新しい依存様式を追加しない。PR側検出（`gh pr view`成功・PRがOPEN）に付随する追加呼び出しとして位置づけ、取得した各コメントは既存のPR会話コメント・Issueコメントと同じ「定型marker除外・時刻カットオフ無し」基準で`unresolved_comments`へ統合する（`source: 'review_thread_comment'`で区別）。

## Decision

resumeされたセグメント作業ワーカーへ同梱する「未対応の既存レビューフィードバック」の判定基準を、ADR-0026の決定を置き換えて次のとおり確定する（ADR-0026から変更の無い項目も、成果物の自己完結性のため本ADRへ完全に再掲する）。

- **レビュー（2026-08-05再改定、implementation-gate blocking finding `LATEST-REVIEWS-MASKS-CHANGES-REQUESTED`是正）**: `gh pr view <branch> --json number,state,headRefName,reviews,comments`（`latestReviews`ではなく全レビュー提出履歴を返す`reviews`を用いる）を取得する。reviewerごとに、`state`が`APPROVED`または`CHANGES_REQUESTED`である提出のみを対象に`submittedAt`昇順で最新の1件を求める（`COMMENTED`提出はこの時系列比較の対象から除外し無視する）。この最新提出が`CHANGES_REQUESTED`であるreviewerのみを「未対応」とみなし、そのreviewerの当該レビュー本文を未対応として扱う。`gh pr view --json reviewDecision`は、branch protectionでレビュー必須設定が無いリポジトリでは常に空文字列を返すことを実機で確認済みのため採用しない（Context節参照）。
- **インラインレビューコメント（review thread comment、新設、2026-08-05、implementation-gate blocking finding `REVIEW-THREAD-COMMENTS-NOT-FETCHED`是正）**: PR側の検出（branch解決成功・対象Issue紐づけ検証・`gh pr view`成功・PRがOPEN）ができた場合に限り、続けて`gh api repos/{owner}/{repo}/pulls/<pr番号>/comments`（REST API）を呼び、差分行に紐づくインラインレビューコメントを取得する。返る各要素の本文・投稿者・作成時刻を、PR会話コメント・Issueコメントと同じ「定型marker除外・時刻カットオフ無し」基準で未対応コメントへ統合する（`source: 'review_thread_comment'`で区別）。このAPI呼び出しが失敗した場合（非ゼロ終了・JSON解釈失敗）は、新しい失敗カテゴリを追加せず、PR側検出全体を失敗として扱う（`gh pr view`自体の失敗と同じ合成規則へ合流させる）。スレッドの解決状態（resolved/unresolved、GraphQL専用）の判定は引き続き対象外とする。
- **単純コメント（Issue・PR双方、ADR-0026から変更なし）**: 対象ブランチの最新commit時刻による時刻カットオフを行わない。コメント本文が定型marker（`<!-- agent-skill-chain:` で始まる行）で始まらない限り、作成時刻に関わらず常に「未対応」として扱う。`git` 呼び出し（commit時刻取得）は判定・出力のいずれからも用いない。
- **Issue側とPR側の検出を分離する（ADR-0026から変更なし）**: Issue側コメント検出（`gh issue view --json comments`）とPR側検出（`resolveCurrentBranch` → branch命名規則検証 → `gh pr view --json number,state,headRefName,reviews,comments` → PR側インラインレビューコメント取得）を独立した経路として実行し、結果を合成する。Issue側は常に実行し、PR側は解決できた場合のみ実行する。
- **branch解決失敗はPR未作成と区別する（ADR-0026から変更なし）**: `resolveCurrentBranch()` が失敗する場合（detached HEAD等）、PR側を明示的な `detection: 'failed'` として扱う。
- **PR側の解決は`findOpenPrByHead()`を経由せず、`review-status.ts`が`gh pr view <branch>`を直接1回呼ぶ（ADR-0026から変更なし）**: 終了コードが非ゼロで、かつstderrが`gh` CLIの固定文言`no pull requests found`に一致する場合のみ「PR未作成（成功・0件）」として扱う。それ以外の非ゼロ終了・JSON解釈失敗は「失敗」として扱う。state が `OPEN` でない場合はPR未作成と同じ扱い（PR側0件、非失敗）とする。
- **PR側で解決したbranch・PRが対象Issueに紐づくものであることを検証する（ADR-0026から変更なし）**: `resolveCurrentBranch()`が返すbranch名を、`gh pr view <branch>`呼び出しより前に、ブランチ命名規則（`<type>/<issue-id>-<slug>`）へ照らし対象issueNumberと一致するか（正規表現 `^[^/]+/${issueNumber}-`）を検証する。一致しない場合はbranch解決失敗と同じ明示的な失敗として扱う。
- **検出処理自体が失敗した場合の合成規則（ADR-0026から変更なし）**: Issue側・PR側それぞれを「成功」「失敗」に正規化したうえで合成する。両方失敗した場合のみ`detection: 'failed'`（両側の失敗理由を含む`reason`）とする。一方が成功・他方が失敗した場合は`detection: 'succeeded'`とし、成功した側で実際に検出済みの未対応レビュー・コメント（0件でもよい）をそのまま保持したうえで、失敗した側の理由を`partial_failures`として付加する。
- **ローカルモードのgate report走査（ADR-0026から変更なし）**: `spec`/`design`/`implementation`/`validation` 全segmentのgate report（`reviews/<segment>.yaml`）を走査し、`gate.blockers` のうち `origin` が起動対象segmentに対応する値（`spec`→`specification`、他は同名）と一致する `severity: blocking` のfindingのみを収集する。収集した各findingには由来元のgate reportのsegment名を`source_segment`として付加する。
- **ローカルモードのgate report読み込み失敗時（ADR-0026から変更なし）**: `tryReadYamlFile()` を用い、ファイル不存在は正常系として「0件」で継続、YAML解釈失敗のみをsegment単位で捕捉し失敗として扱う。読み込みに成功したsegment（ファイル不存在による0件を含む）から収集した`origin`一致のblocking findingは、他のsegmentの読み込みが失敗していても保持する。全4segmentの読み込みがすべて失敗した場合のみ`detection: 'failed'`とする。

## Consequences

- 利点: reviewer毎の全レビュー提出履歴を時系列で評価することにより、「reviewerが`CHANGES_REQUESTED`の後に`COMMENTED`のみを追加提出すると未対応レビューが見失われる」という、本Issue #446自身が解決対象とする失敗モードと同型の欠陥が解消される。`reviewDecision`という一見権威あるフィールドが、branch protection未設定のリポジトリでは機能しないという実機検証済みの事実に基づき、レビュー提出履歴のみに依拠する自己完結した判定基準を採用したことで、branch protection設定の有無に関わらず正しく動作する。インラインレビューコメントの取得により、差分行への修正依頼コメントも検出対象に含まれるようになり、AC-3の要求範囲がより実質的に満たされる。
- 欠点・limitation:
  - reviewerが自身の`CHANGES_REQUESTED`提出をGitHub UI上でdismiss（却下）した場合、`reviews`配列の`state`は引き続き`CHANGES_REQUESTED`のまま残るため、本設計はdismiss後も当該レビューを「未対応」として再掲し続ける（過検出）。これはADR-0026のコメント時刻カットオフ廃止と同種のトレードオフ（見せすぎる方が安全側、AGENTS.md I8）であり、AC-4（誤検出しない）はレビューが実際に存在しない場合の誤検出禁止のみを要求するため抵触しない。
  - インラインレビューコメントのスレッド解決状態（resolved/unresolved）は取得しないため、レビュアが差分行のコメントを「解決済み」としてマークした後も、その内容が定型marker以外である限り次回resumeで再掲され続ける（過検出）。同上のトレードオフに含まれる。
  - PR側の検出経路が`gh pr view`（1回）＋`gh api pulls/comments`（1回以上）の計2種類のAPI呼び出しに増えるため、PR側検出全体の呼び出し回数はADR-0026時点（`gh pr view`1回のみ）より増加する。
  - `gh pr view --json reviewDecision`を採用しなかったことにより、GitHub自身が計算する権威あるマージブロック判定値との突き合わせ（クロスチェック）は行わない。本設計の判定結果とGitHubのマージブロック判定が将来的なGitHub仕様変更により乖離する可能性は、レビュー提出履歴の解釈をGitHubの実際の挙動（`COMMENTED`はCHANGES_REQUESTEDを解除しない）に基づいて実装することで最小化するが、完全な一致を保証するものではない。
- follow-up: dismissされたレビューを正しく「解除済み」として扱う必要が実運用で生じた場合、GraphQL APIでのdismiss検出を別Issueで検討する余地がある（本ADR選択肢(b)-2で不採用としたGraphQL依存の再検討を含む）。インラインレビューコメントのスレッド解決状態が実運用で必要になった場合も同様に別Issueで検討する。

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
