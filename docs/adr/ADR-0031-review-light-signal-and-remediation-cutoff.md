# ADR

```yaml
id: ADR-0031
status: proposed   # proposed | accepted | superseded | deprecated
title: review:light軽量レビュープロファイルの独立シグナル化と打ち切りラウンド数
tags: [process, gate, review-profile, guardrail]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

現状のレビュープロファイルはStandard（既定、レビュア1体がconformance→falsificationを1パス実行）とStrict
（`risk != normal` OR `autonomy == full`、または`model_selection.core_review`該当時に専任2名必須）の2種のみである。
2026-08-05、Issue #446のdesign-gate（Strict）でblocking finding対応が6ラウンドの反復修正を要した。核心インフラ
変更としては妥当な厳密さだったが、「とりあえず動くものを早く」という意図の軽量な変更にまで同じ反復コストが
一律適用されると、既存の`size:quick`（成果物作成義務の免除、ADR-0022）とは別の軸で速度が損なわれる。

進行役が当初「ユーザーが明示的にPoC/quickと言った時だけ簡略化する」という裁量運用で対応しようとしたところ、
ユーザーから「進行役の裁量任せは代わりが大きい。構造化ラベルにして機械的に検査可能にすべき」との指摘を受けた。
設計着手前にfable・codexへアドバイザーとして意見を求め（SPEC.md参照）、両者から一致して得た助言は次の3点：
(1) Strict必須トリガーは軽量プロファイルより常に優先されるべきであり、ADR-0022と同型の独立ガードレールを持つ
べきである、(2) ゲート自体の省略は不変条件I1/I7を壊すため不可、Standard相当の1体・1パスとしつつ反復ループの
打ち切り基準は既存の`human_required`パターンと整合させるべきである、(3) 軽量プロファイルは`size:quick`と独立
した新規シグナルであるべきである（`size:quick`＝成果物量、軽量プロファイル＝検証強度で関心が直交する）。

検討したトレードオフ：

- 軽量プロファイルを`size:quick`の副作用として自動導出する案：シグナルが1つで済み単純だが、「成果物量」と
  「検証強度」という無関係な2軸を暗黙に結合してしまい、`size:quick`だけを使いたいIssue（成果物は省略したいが
  レビューの厳密さは変えたくない）を表現できなくなるため採らない。
- 打ち切りラウンド数を無制限（既存Standard/Strictと同じ）とする案：軽量プロファイル導入の主目的（反復コスト
  抑制）を達成できないため採らない。
- 打ち切り検知をGitHubモードでもCheck Run等の恒久ストアに必須で持たせる案：現状GitHub Coordination Backendに
  対する自動verifier workflowはIssue #386で削除済みであり、I2はGitHubモードでガイドライン（自動CI強制なし、
  AGENTS.md I2）である。恒久ストアを新設する設計は本Issueのスコープ（レビュープロファイル軽量化）を超える
  インフラ変更になるため採らない。

## Decision

1. **独立シグナル**: GitHubモードのIssueラベル`review:light`、ローカルモードの`state.yaml`の`review_intensity:
   light | full`（既定`full`、未設定は後方互換でfullとして解決）を新設する。`size:quick`とは別モジュール
   （`src/lib/quick-mode.ts`と`src/lib/review-light.ts`）・別フィールドで実装し、一方の判定が他方に影響しない。
2. **Strict優先の3層ガードレール**: 本ガードレールの生の判定（3層のいずれかへの新規該当性の計算）は
   `review:light`が要求されている（`requested=true`）Issue/PRにのみ作用する。ただし、直前ラウンドの
   `gate-report`から読み取る`strict_locked`永続値（`persistedStrictLocked`）の参照と`gate.review_profile`
   への反映は、`requested`の現在値と**独立に**毎ラウンド行う。一度でも`strict_locked=true`が確定した
   Issue/PRでは、その後`review:light`ラベルを外す・`review_intensity`を`full`へ戻す等で`requested=false`
   へ変化しても、`gate.review_profile`のStrict固定は解除されない（**ratchet-bypass-via-label-removal対策**
   ——軽量シグナルはセグメント作業ワーカーが操作可能な調整状態プリミティブであり、ラベル除去だけでStrict
   要件を回避できる経路をI8の安全側ラチェット原則に基づき塞ぐ）。一度も`review:light`が要求されたことが
   なく、かつ`strict_locked`も一度も`true`になったことがない（`persistedStrictLocked=false`）Issue/PR
   （既存Issueを含む）では、`gate.review_profile`は既存の`resolveReviewProfile()`（I8ロジック）のみで
   確定し続け、本ADRの決定によって一切変化しない（要件12・AC-1、後方互換の担保はこの条件下でのみ成立する）。
   `requested=true`の場合、軽量プロファイルは次のいずれかに該当する場合、常に無効化
   されStrictが強制される。(a) 既存I8ロジック（`risk != normal` OR `autonomy == full`）、(b) `model_selection.core_review`の
   既存トリガー（ラベル・状態値・`exact_paths`・`path_prefixes`）、(c) 変更差分が`docs/adr/`・
   `.agent-skill-chain/config/segments.yaml`・`AGENTS.md`・`.agent-skill-chain/schemas/`のいずれかを含む
   （ADR-0022と同一のパス集合を`src/lib/self-reference-guardrail.ts`として共有・再利用する独立条件。(b)の
   `core_review.triggers`設定が将来縮小されても本条件単独で安全側を維持する）。3層すべてが「無効化のみ」に
   作用する片方向のガードレールであり、軽量プロファイルがこれらを上書きする経路は存在しない。この3層判定の
   生の該当・非該当自体はremediationラウンド（blocking finding対応の再レビュー）ごとに毎回ステートレスに
   再評価する（前ラウンドの生判定結果はキャッシュしない）。ただし最終的な適用可否は`light_review.strict_locked`
   という一方向ラチェット（直前ラウンドの`strict_locked`と当該ラウンドの生判定結果のOR）を介して確定するため、
   前ラウンドでは非該当だった条件に新たなラウンドで該当しStrictへ切り替わった後、後続ラウンドで差分・ラベルが
   ガードレール非該当側へ戻っても`strict_locked`は`true`のまま維持され、軽量プロファイルへは復帰しない
   （AGENTS.md I8「危険信号による降格は自動、昇格は人間の明示行為のみ」という安全側ラチェット原則の適用）。
   新たに`strict_locked=true`が確定したラウンドからは即座に専任2名によるconformance/falsificationの最初から
   の実施へ切り替える。昇格前ラウンドの1体レビュー結果は証跡として保持するが、Strictレビューの合否判定入力
   としては再利用しない。
3. **打ち切りラウンド数**: 軽量プロファイルが適用されたゲートの、blocking finding解消のための再レビューは
   **最大1ラウンド**（初回レビュー＝`remediation_round=0`＋修正後の再レビュー1回＝`remediation_round=1`、
   合計2回）までとする。`remediation_round=1`のラウンド（2回目のレビュー）でも
   blocking findingが残る場合、当該ラウンドの`record-verdict`は`inconclusive`を強制し、既存の`deriveFinal()`
   ロジック（`inconclusive === true → human_required`）をそのまま経由して`human_required`を記録する。新しい
   最終判定ロジックを追加せず、既存の安全側収束経路を再利用する。数値「1」は、本Issue自身のspec-gate
   （Strict）が実際に1回の修正ラウンドで収束した実績（round1でblocking finding 1件検出→修正→round2で
   pass）を最小の目安とし、Strictで許容されている反復回数（Issue #446で6ラウンド）よりも大幅に切り詰めた
   値として設計時に確定する。将来的に運用実績から不足が判明した場合は、値の変更自体を新たなADRで記録する
   （本ADRの決定は現時点の値の妥当性のみを主張し、将来の再検討を妨げない）。
4. **ラウンド計数・ラチェット状態の格納先**: 直前ラウンドの`gate-report`（`remediation_round`・`strict_locked`
   の両方を含む）は、既存の`reviewFilePath()`（ローカルモード: `reviews/<gate>.yaml`としてGit管理下、
   GitHubモード: `os.tmpdir()`配下のスクラッチ、Issue #399で導入済みの既存パターン）から同一読み取り処理で
   取得する。新規の恒久ストアは作らない。ローカルモードはGit管理下でありI3（耐久性）の保証対象内である。
   GitHubモードでスクラッチが失われた場合、`remediation_round`は0から再開し打ち切りまでの許容回数が実質1回分
   増えるだけであり、`strict_locked`はその時点の3層ガードレール判定を再度ステートレスに評価し直すため、差分・
   ラベルが実際にStrict相当のままであれば同ラウンドで再確定され実害は生じない。スクラッチ喪失かつ差分が
   ガードレール非該当へ戻っている場合に限りラチェットが意図せずリセットされうるが、いずれの場合も
   AC-6/AC-7の独立した自動blocking昇格という多層防御には影響しない。速度上の利益が目減りするに留まり
   安全性は損なわれないため、恒久化コストに見合わないトレードオフとしてGitHubモード限定で許容する。
5. **severityの機械的書き換えはしない**: AC未達・セキュリティ/データ喪失/互換性破壊/不変条件違反の
   自動blocking昇格（SPEC.md要件7・8）は、`gate reviewer-prompt`のルーブリック強化（レビュアへの明示指示）
   でのみ実現し、`code`・`evidence`のテキストからキーワード等で機械的にseverityを書き換える機構は設けない。
   誤検知・見落としの双方でテキスト照合が不適切であり、SPEC.mdも当該AC-6/AC-7の検証方法見込みを`hybrid`と
   明示しているため、レビュアの判定を最終的な正とする設計が妥当と判断する。
6. **付与主体の人間性検証（SPEC.md要件9・AC-9）**: GitHubモードでは、GitHub REST issue events API
   （`gh api repos/{owner}/{repo}/issues/{number}/events`）で`review:light`ラベルの直近`labeled`イベントを
   特定し、その`actor.type`が`'User'`のときのみ人間による付与と確認する（`'Bot'`・イベント未特定・API呼び出し
   失敗はすべて未確認として扱う）。ローカルモードは、フィールドを設定したactorの種別を記録する仕組みが構造的
   に存在しない（Gitのcommit authorは人間の対話操作とエージェント操作を区別できない）ため、`grantorConfirmed`
   を常に`false`として扱う。付与主体が未確認の場合は要件9のとおり軽量プロファイルを適用せず、既存のI8ロジック
   に基づく通常プロファイルへ倒す。この設計判断の帰結として、軽量プロファイルの速度上の利益は当面GitHubモード
   限定になる（Consequences参照）。ローカルモード向けの確認手段を追加する場合は別ADRで扱う。

## Consequences

- 利点: `size:quick`と同一パターン（成果物非依存の調整状態シグナル＋自己参照ガードレール）を踏襲するため、
  ADR-0022で確立済みの安全性の論拠（循環定義の回避、悪用防止）をそのまま継承できる。
- 利点: 打ち切り判定が既存の`deriveFinal()`/`inconclusive`経路を再利用するため、`final`の意味論
  （approved/rejected/pending/human_required）を増やさずに済み、下流（進行役の差し戻し判断）への影響がない。
- 利点: `review-profile.ts`抽出により、I8ロジック（risk/autonomy→standard/strict）の実装箇所が1箇所に統一され、
  既存の`gate.ts`内インライン式との乖離リスクが解消する。
- 欠点: GitHubモードのラウンド計数はベストエフォート（スクラッチ格納）であり、耐久性（I3）の保証対象外である。
  恒久化するにはGitHub Coordination Backend向けの構造化された証跡ストアが必要になり、本ADRのスコープ外とする。
- 欠点: 打ち切りラウンド数「1」は実測に基づく仮の値であり、Strictで許容されている反復回数との比較のみを根拠に
  設計時点で確定した。運用実績が蓄積した段階で見直しが必要になる可能性がある。
- 欠点: 付与主体の人間性検証（Decision 6）はローカルモードで構造的に確認手段を持たないため、ローカルモードの
  Issueでは軽量プロファイルが`applied=true`になることが現状ない。速度上の利益はGitHubモード限定になる。
- 欠点: GitHubモードの付与主体検証（`actor.type === 'User'`）は、個人アクセストークンを用いた自動化スクリプト
  がhuman identityを借用した場合を区別できない。これは本リポジトリの既存コード（review-evidence.ts等）にも
  共通する、GitHub Identityを信頼の代理指標とする設計全体の既知の限界であり、本ADRのスコープでは追加対策を
  導入しない。
- フォローアップ: `review:light`ラベルは`setup-labels.sh`によるGitHub Labels APIへの適用を行うまで実体として
  存在しない。適用前は`review:light`を付与しても効果を持たず、`resolveLightReview()`は`requested: false`として
  安全側に解決される。

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
