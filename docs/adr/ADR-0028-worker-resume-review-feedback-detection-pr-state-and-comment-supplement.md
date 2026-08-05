# ADR

```yaml
id: ADR-0028
status: proposed
title: resumeしたセグメント作業ワーカーへの既存レビューフィードバック検出は、PRのstateによらず取得済みのレビュー・コメントを保持し、未対応と確定したreviewerの最新COMMENTED本文を補足として同梱する
tags: [worker-resume, review-status, github-backend, i8-safety-ratchet]
supersedes: [ADR-0027]
superseded-by: null
deprecated-reason: null
```

## Context

ADR-0027（Issue #446、本ADRと同一Issue）は、resumeされたセグメント作業ワーカーへ同梱する「未対応の既存レビューフィードバック」の判定基準を、レビューは全レビュー提出履歴（`reviews`）ベース、インラインレビューコメントは`gh api repos/{owner}/{repo}/pulls/<pr番号>/comments`で取得、単純コメントは時刻カットオフ無しと確定した。ADR-0027は設計ゲート（strict、独立2レビュア）の審査対象（target_sha `43e57a87`）となった。

2026-08-05、当該design-gateの4件の判定（attempt_id違いの2組×2スロット、いずれもPLAN.md/SPEC.mdがプロンプトへ完全展開されなかったことを理由に総合verdictは`inconclusive`）のうち、3件が独立に、展開済みのDESIGN.md本文の引用のみに基づき次の実在する設計欠陥（プロンプト未展開部分への依存が無い、内容面の指摘）を一致して検出した（うち1件は`severity: blocking`）。

1. `CLOSED_PR_FEEDBACK_SILENTLY_DISCARDED`/`CLOSED_PR_FEEDBACK_SILENTLY_ZEROED`: ADR-0027時点の設計は、`gh pr view <branch> --json number,state,headRefName,reviews,comments`を1回呼びレビュー・コメントを取得した後、`state`が`OPEN`でない場合（closed/merged）は取得済みの`reviews`・`comments`を破棄し「PR未作成と同一視、0件・非失敗」として扱っていた。これは、同一ADR-0027が確立した「区別できない/取得できないものを『無し』と同一視しない」（AC-5、`PR_RESOLUTION_FAILURE_SILENTLY_TREATED_AS_NO_PR`是正等）という原則と非対称であり、本Issue自身が解消対象とする「未対応のレビューフィードバックを参照せず完了と自己判定する」失敗モードを、closed/mergedなPRの経路でそのまま再現する。反例: PRが誤ってcloseされた状態、またはマージ後に同一branchで追加是正のためsegmentがresumeされた状態で、当該PRに実在する`CHANGES_REQUESTED`レビュー・未対応コメントが一切提示されず、検出失敗の通知も受け取らない。
2. `LATEST_COMMENTED_REVIEW_BODY_DROPPED_FOR_UNRESOLVED_REVIEWER`: ADR-0027時点の設計は、reviewerごとに`state`が`APPROVED`または`CHANGES_REQUESTED`である提出のみを時系列比較の対象とし、`COMMENTED`提出は比較対象から除外して無視する。この結果、reviewer-aが`CHANGES_REQUESTED`（本文A）提出後に`COMMENTED`（本文B、Aへの是正案に対する最新の追加指摘）を提出した場合、reviewer-aは正しく「未対応」と判定されるが`unresolved_reviews`に含まれる本文は古い本文Aのみで、より新しい本文Bはどの経路からも同梱されない。

いずれの指摘も、ADR-0027のDecision本文が明記した判定基準そのものに起因する。ADR-0027は設計ゲート審査対象でありDecision本文は不変であるため、本文修正ではなく本ADR（新規、`supersedes: [ADR-0027]`）によって決定を置き換える。

なお同レビューが挙げたPLAN.md/SPEC.md未展開起因の指摘（`PLAN_NOT_FULLY_EMBEDDED`等）は、レビュー実行環境のプロンプト構築（`gate.ts`の`buildReviewerPrompt()`）が生成するプロンプトのサイズに起因する既知の制約であり、本ADRの対象外とする（本Issue #446のdesign-gate審査で過去にも複数回観測済みの、プロンプト切断に起因する既知パターン）。また同レビューが挙げた`ADR0027_ARTIFACT_NOT_IN_DIFF`（ADR-0027の実在未確認）は、当該レビュー実行後にADR-0027が`accepted`へ遷移し実在が確定したため解消済み、`DOC_LENGTH_LIMIT_UNVERIFIED`（`.agent-skill-chain/ci/verify-doc-length.sh`のIssue成果物への適用有無）は`src/commands/verify.ts`の`docLength()`実装を直接確認した結果、対象は`AGENTS.md`と`.agent-skill-chain/templates/{issue,adr}/*.md`のテンプレート本体のみであり、Issue成果物として複製・記入済みの`DESIGN.md`/ADR個別ファイルは対象外であることを確認済みである。`PR_SIDE_MAY_ALWAYS_FAIL_IF_CWD_IS_PROTECTED_BASE`（`_asc_cli`起動時のcwdがprotected baseだと常にbranch解決が失敗する懸念）は、`.agent-skill-chain/adapters/claude.sh`・`.agent-skill-chain/scripts/worker-launch.sh`のREPO_ROOT解決が`BASH_SOURCE`基準でありcwdに依存しないことをコード確認済みで、対象worktree外から起動された場合にREPO_ROOTが誤ったworktreeへ解決される既知の別欠陥（本Issueとは別に追跡）に起因するものであり、本ADRの対象外とする。`MARKER_PREFIX_POSITION_ASSUMED`/`MARKER_POSITION_INVARIANT_UNSTATED`（定型marker除外がコメント本文先頭を前提とする不変条件の未明記）はDESIGN.mdの文言強化で対応し、ADRのDecision変更を要しないため本ADRの対象外とする。

検討した選択肢（(a) PRのstate扱いについて）:

1. **`state !== 'OPEN'`を「PR未作成」と同一視する（ADR-0027のまま）**: 上記1.の欠陥をそのまま残す。不採用。
2. **`state !== 'OPEN'`の場合のみ`partial_failures`として明示的な失敗にする**: 取得済みのデータが実際には存在するにもかかわらず「失敗」と扱うのは事実に反し、AC-5が要求する「わからないものは隠さない」の趣旨（区別できないものを失敗扱いする）とも合わない。取得済みデータを活かせないため不採用。
3. **stateによる分岐を撤廃し、`gh pr view`が成功した場合は常に取得済みのレビュー・コメントを通常どおり処理する（採用）**: 「PR未作成（0件・非失敗）」として扱うのは、`gh pr view`が非ゼロ終了し`stderr`が`no pull requests found`に一致する場合のみとする。PRが実在する限り（state不問）、レビュー・PR会話コメント・インラインレビューコメントを取得し、OPEN時と同一の判定基準（未対応の判定基準節）を適用する。stateという追加の分岐軸を無くすことで、ADR-0027が確立した他の失敗系統（branch解決失敗・`gh pr view`失敗・JSON解釈失敗）と対称な「取得できたものは活かす」という単一原則に統一する。

検討した選択肢（(b) 未対応reviewerの補足コメント本文について）:

1. **現状維持（ADR-0027のまま、`COMMENTED`提出は本文含め一切同梱しない）**: 上記2.の欠陥をそのまま残す。不採用。
2. **`COMMENTED`提出も時系列比較の対象に含め、`CHANGES_REQUESTED`の解除とみなす**: ADR-0027が既に却下した選択肢（GitHub上`COMMENTED`は`CHANGES_REQUESTED`を解除しない）を再導入することになり、未対応レビューの見失いという本Issueの主要な失敗モードを再発させるため不採用。
3. **「未対応」と確定したreviewerに限り、その`CHANGES_REQUESTED`提出より後に提出された最新の`COMMENTED`本文を補足情報として追加同梱する（採用）**: reviewerが「未対応」か否かの判定基準（選択肢2の時系列比較ロジック）自体は変更せず、既に未対応と確定した後にのみ、当該reviewerの最新の追加コメントを失わせない。判定基準への影響が無いため、ADR-0027が確立した判定基準の正しさ（`LATEST-REVIEWS-MASKS-CHANGES-REQUESTED`是正）を損なわない。

## Decision

resumeされたセグメント作業ワーカーへ同梱する「未対応の既存レビューフィードバック」の判定基準を、ADR-0027の決定を置き換えて次のとおり確定する（ADR-0027から変更の無い項目も、成果物の自己完結性のため本ADRへ完全に再掲する）。

- **レビュー（ADR-0027から変更なし）**: `gh pr view <branch> --json number,state,headRefName,reviews,comments`（`latestReviews`ではなく全レビュー提出履歴を返す`reviews`を用いる）を取得する。reviewerごとに、`state`が`APPROVED`または`CHANGES_REQUESTED`である提出のみを対象に`submittedAt`昇順で最新の1件を求める（`COMMENTED`提出はこの時系列比較の対象から除外し無視する）。この最新提出が`CHANGES_REQUESTED`であるreviewerのみを「未対応」とみなし、そのreviewerの当該レビュー本文を未対応として扱う。
- **未対応reviewerの補足コメント本文（新設、2026-08-05、design-gate finding `LATEST_COMMENTED_REVIEW_BODY_DROPPED_FOR_UNRESOLVED_REVIEWER`是正）**: 上記により「未対応」と確定したreviewerについて、同reviewerの提出履歴のうち`state === 'COMMENTED'`かつ`submittedAt`が当該`CHANGES_REQUESTED`提出より新しいものが1件以上あれば、そのうち最新の1件の本文を、未対応レビューのフィールド（`latest_comment_body`、任意項目）として同一エントリへ追加する。この追加は「未対応」の判定基準（上記レビュー項）そのものを変更しない——`COMMENTED`提出のみを行ったreviewer（`CHANGES_REQUESTED`を一度も提出していない、またはその後`APPROVED`を提出したreviewer）を新たに未対応とすることはない。該当する`COMMENTED`提出が無ければ`latest_comment_body`は含めない。
- **インラインレビューコメント（review thread comment、ADR-0027から変更なし）**: PR側の検出（branch解決成功・対象Issue紐づけ検証・`gh pr view`成功）ができた場合に限り、続けて`gh api repos/{owner}/{repo}/pulls/<pr番号>/comments`（REST API）を呼び、差分行に紐づくインラインレビューコメントを取得する。返る各要素の本文・投稿者・作成時刻を、PR会話コメント・Issueコメントと同じ「定型marker除外・時刻カットオフ無し」基準で未対応コメントへ統合する（`source: 'review_thread_comment'`で区別）。このAPI呼び出しが失敗した場合（非ゼロ終了・JSON解釈失敗）は、新しい失敗カテゴリを追加せず、PR側検出全体を失敗として扱う。
- **PRのstateによる分岐の撤廃（変更、2026-08-05、design-gate finding `CLOSED_PR_FEEDBACK_SILENTLY_DISCARDED`是正）**: `gh pr view <branch>`が成功した場合、PRの`state`（`OPEN`/`CLOSED`/`MERGED`のいずれか）に関わらず、取得したレビュー・PR会話コメント・インラインレビューコメントを上記の基準でそのまま処理する。「PR未作成（PR側0件・非失敗）」として扱うのは、`gh pr view`が非ゼロ終了し`stderr`が`gh` CLIの固定文言`no pull requests found`に一致する場合のみとする。stateは判定に一切用いない。
- **単純コメント（Issue・PR双方、ADR-0027から変更なし）**: 対象ブランチの最新commit時刻による時刻カットオフを行わない。コメント本文が定型marker（`<!-- agent-skill-chain:` で始まる行）で始まらない限り、作成時刻に関わらず常に「未対応」として扱う。`git` 呼び出し（commit時刻取得）は判定・出力のいずれからも用いない。
- **Issue側とPR側の検出を分離する（ADR-0027から変更なし）**: Issue側コメント検出（`gh issue view --json comments`）とPR側検出（`resolveCurrentBranch` → branch命名規則検証 → `gh pr view --json number,state,headRefName,reviews,comments` → PR側インラインレビューコメント取得）を独立した経路として実行し、結果を合成する。Issue側は常に実行し、PR側は解決できた場合のみ実行する。
- **branch解決失敗はPR未作成と区別する（ADR-0027から変更なし）**: `resolveCurrentBranch()` が失敗する場合（detached HEAD等）、PR側を明示的な `detection: 'failed'` として扱う。
- **PR側の解決は`findOpenPrByHead()`を経由せず、`review-status.ts`が`gh pr view <branch>`を直接1回呼ぶ（ADR-0027から変更なし）**: 終了コードが非ゼロで、かつstderrが`gh` CLIの固定文言`no pull requests found`に一致する場合のみ「PR未作成（成功・0件）」として扱う。それ以外の非ゼロ終了・JSON解釈失敗は「失敗」として扱う。
- **PR側で解決したbranch・PRが対象Issueに紐づくものであることを検証する（ADR-0027から変更なし）**: `resolveCurrentBranch()`が返すbranch名を、`gh pr view <branch>`呼び出しより前に、ブランチ命名規則（`<type>/<issue-id>-<slug>`）へ照らし対象issueNumberと一致するか（正規表現 `^[^/]+/${issueNumber}-`）を検証する。一致しない場合はbranch解決失敗と同じ明示的な失敗として扱う。
- **検出処理自体が失敗した場合の合成規則（ADR-0027から変更なし）**: Issue側・PR側それぞれを「成功」「失敗」に正規化したうえで合成する。両方失敗した場合のみ`detection: 'failed'`（両側の失敗理由を含む`reason`）とする。一方が成功・他方が失敗した場合は`detection: 'succeeded'`とし、成功した側で実際に検出済みの未対応レビュー・コメント（0件でもよい）をそのまま保持したうえで、失敗した側の理由を`partial_failures`として付加する。
- **ローカルモードのgate report走査・読み込み失敗時（ADR-0027から変更なし）**: `spec`/`design`/`implementation`/`validation` 全segmentのgate reportを走査し、`origin`一致の`blocking` findingのみを収集する。ファイル不存在は0件で継続、YAML解釈失敗のみをsegment単位で捕捉し失敗として扱う。全4segmentの読み込みがすべて失敗した場合のみ`detection: 'failed'`とする。

## Consequences

- 利点: PRのstateを判定から排除したことで、closed/mergedなPRに実在するレビュー・コメントを「PR未作成」と偽装しなくなり、AC-5（区別できない/取得できないものを『無し』と同一視しない）がPR側検出のあらゆる分岐で一貫する。未対応reviewerの最新`COMMENTED`本文を補足として同梱することで、「未対応」の判定基準（ADR-0027、`COMMENTED`提出を時系列比較対象から除外する設計）を維持したまま、当該reviewerが実際に書いた最新の指摘内容を取りこぼさなくなる。
- 欠点・limitation:
  - closed/mergedなPRのレビュー・コメントも毎回のresumeで再掲され続ける（過検出）。既存の「時刻カットオフ廃止のトレードオフ」（ADR-0026）と同種であり、見せすぎる方が安全側というAGENTS.md I8の判断に合致する。
  - `latest_comment_body`はreviewerが実際に`CHANGES_REQUESTED`後に`COMMENTED`を追加した場合のみ付与される任意項目であり、reviewerがレビュー本文を使わずIssue/PR会話コメントで補足指摘を行った場合は本項の対象外（単純コメント側の判定基準でカバーされる）。
  - dismissされたレビューの扱い（ADR-0027の既知の限界）は本ADRでも変更しない。
- follow-up: `_asc_cli`起動時のcwd・REPO_ROOT解決の妥当性（本ADR対象外と確定した`PR_SIDE_MAY_ALWAYS_FAIL_IF_CWD_IS_PROTECTED_BASE`）は、別途追跡されているworker-launch起動経路の欠陥修正Issueで扱う。

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
