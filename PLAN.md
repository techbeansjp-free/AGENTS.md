# PLAN: human gateのtrusted session復帰を実装する

- Issue: `ISSUE-278`
- 対応する DESIGN: `DESIGN.md`

## 目的・依存・出力

承認済みSPEC/DESIGNを入力とし、trust backendのフェーズ分類とpublisher選択、durable Review inbox、gate別session、
artifact集合、nonce recovery、Strict slot adapter、`workflow_dispatch`による再評価入口と再評価証跡、配布同期と
自動テストを出力する。実装前に`verifyGithubReviewEvidence`（#283 / PR #284由来、mainへ取り込み済み）の実在と
テスト成功を確認する。ADR-0013は現在`status: proposed`であり、そのaccepted化とtrust backendの実配備は本Issueの
対象外である。実装開始はこれらの配備を待たない。現行環境はフェーズA（`absent`）であり、フェーズAでの動作、
`inconsistent`でのfail-closed停止、フェーズB（`consistent`）での専用App置換有効化の三経路をすべて実装し、
GitHub API stub・fixture・workflow定義検査で検証する。類似reducerの新規実装、別App、フェーズBからフェーズAへの
自動fallbackは作らない。

## 実装順序

| # | 変更単位 | 内容 | AC-ID | 依存 |
|---|---|---|---|---|
| 1 | 依存確認 | `verifyGithubReviewEvidence`のI/F確認、専用App/environment/ruleset契約の入力形を固定 | AC-2, AC-6 | なし |
| 2 | フェーズ分類 | `TrustBackendClassifier`（`absent`/`consistent`/`inconsistent`の決定的分類）と`PublisherSelector` | AC-2, AC-10 | #1 |
| 3 | 再評価証跡 | `RerunEvidenceRecord`のスキーマ、Check outputへの上書き保存、LegacyPublisher経路への配線 | AC-9, AC-10 | #2 |
| 4 | artifact domain | gate別path分類、A/M/D record、tombstone、集合digest、双方向比較、`evaluation_input_digest`導出 | AC-1, AC-5 | #1 |
| 5 | session domain | gate順導出、決定的key、parent一意化、slot envelope、状態写像 | AC-1, AC-7 | #4 |
| 6 | inbox/replay | PR Review marker、review API再取得、同digest no-op、相反拒否 | AC-3, AC-4 | #5 |
| 7 | publisher条件付き置換 | フェーズBでのみopener/submit/gate-publish/reconcileを専用Appへ一本化し、フェーズAはLegacy維持 | AC-1〜AC-4, AC-10 | #2, #5, #6 |
| 8 | ownership recovery | 直列lane、nonce、取消run確認、postcondition retry、sweeper drain | AC-3, AC-4 | #7 |
| 9 | Strict seam | durable envelopeを既存`verifyGithubReviewEvidence`の入力形へ写像しreplayを外部化 | AC-6 | #6〜#8 |
| 10 | 復帰入口 | `GateRerunWorkflow`（`workflow_dispatch`、`pr_number`/`target_sha`入力、head照合）と通知本文への一意結線 | AC-9 | #3, #5 |
| 11 | workflow/配布 | フェーズBのcandidate `checks:none`、`workflow_run`→protected publisher、root/template同期 | AC-2, AC-8 | #7, #10 |
| 12 | 検証 | unit/integration/security/distribution/full regression証跡を保存 | 全AC | #1〜#11 |
| 13 | ADR参照確定 | ADR-0013がacceptedになった時点でDESIGNの`related_adrs`へ`id/relation: adopts` objectで追加し再gate | 全AC | #12 |

## BDD conformance・falsification

| Given | When | Then | AC-ID |
|---|---|---|---|
| target/baseに複数segment変更 | open再実行 | 固定順各gateに同SHA/name/App parent一件を再利用する | AC-1 |
| parent 0/1/2件、別App同名 | open | 0はcreate、1はreuse、2は停止し別Appはrequired sourceにならない | AC-1, AC-2 |
| trust backend `absent` | publish | Legacyだけが従来基準でrequired Checkを書き、`publisher_phase: legacy`とtrust主張なしを明記する | AC-2 |
| trust backend `consistent` | publish | candidate `GITHUB_TOKEN checks:none`で、専用Appだけが全required Checkを更新する | AC-2 |
| trust backend `inconsistent` | publish | sessionを開始せず設定エラーで停止し、既存`action_required`を維持する | AC-2, AC-10 |
| 任意のフェーズ | publish | 同名required Checkに有効writerが同時に二つ存在しない | AC-2 |
| 同時提出/PATCH応答不明 | retry | 同一laneとnonce再読取で一結果へ収束する | AC-3 |
| processing中run取消 | sweeper | terminal runを確認後に新nonceで再開しpostconditionを満たす | AC-3 |
| terminal同digest/逆結論 | replay | 前者はno-op、後者は既存結果を変えず拒否する。再評価証跡は双方で更新する | AC-3, AC-9 |
| Review記録後dispatch取消 | 定期drain | 未消費reviewを失わず一度だけslotへ記録する | AC-4 |
| pending 101件相当 | queue超過 | Actions取消に依存せずdurable inboxから全Reviewをdrainする | AC-4 |
| gate別A/M/D | derive/submit | tombstoneを含む保存集合と再導出集合が双方向一致する | AC-5 |
| path欠落/余分/重複/未分類/digest差 | submit | successを発行しない | AC-5 |
| Strict独立2 slot（`run_id`・`slot`非重複、token digest一致）のapprove | reduce | `verifyGithubReviewEvidence`がapprovedを返しparent successへ写像する | AC-6 |
| Strict不足/重複/replay/混合 | reduce | 同関数外でreplay拒否し、同関数はfailure/action_requiredを返す | AC-6 |
| コア分類でhuman証跡2 approve | reduce | 能力証明不能として承認せず`human_required`のままparentをaction_requiredに保つ | AC-6 |
| writer actor未解決/0件 | reduce | 判定へ進まず`human_required`とし、写像側でactor集合を補完しない | AC-6 |
| deferral状態の案内入口 | 案内の対象PR/対象SHAで起動 | 新しいrunが作られ`rerun_invocation_id`・`evaluated_at`が更新される。結論の種別は問わない | AC-9 |
| コア分類×adapter=humanのdeferral | 同じ入口を起動 | 証跡は更新されるがCheckは`action_required`のまま維持され、AC-6の停止系と両立する | AC-6, AC-9 |
| 案内SHAとPR headの不一致 | 同じ入口を起動 | 再評価を開始せず`sha_mismatch`証跡で停止しsuccessへ倒さない | AC-9 |
| 起動しても新runも証跡更新も起きない実装 | 反証テスト | 不合格として検出する（no-opを合格にしない） | AC-9 |
| 通知本文とworkflow定義 | 乖離検査 | 実在しない入口・不足入力・required名不一致を検出して失敗する | AC-9 |
| trust backend `inconsistent` | 復帰入口を起動 | `config_error`証跡を残して停止し、deferral状態の`action_required`を維持する | AC-9, AC-10 |
| フェーズB稼働中に前提が崩れる | publish | フェーズAへ自動fallbackせず`inconsistent`として停止する | AC-10 |
| 各domain状態 | publish | status/conclusion表どおりでawaitingはmergeを停止する | AC-7 |
| local backend | open/submit | GitHub API、local report、成果物を変更しない | AC-7 |
| template/root/ruleset | sync・probe | byte一致、integration ID一致、旧publisher write不在（フェーズBのみ）となる | AC-8 |

## テスト適用性

- unit: フェーズ分類の3値判定と根拠列挙、publisher選択、gate順、一意key、classifier、tombstone、
  canonical digest、state mapper、nonce reducer、`verifyGithubReviewEvidence`写像seam、再評価証跡の生成・
  一意性・スキーマ。
- integration: gh stubでApp source、0/1/2 parent、Review drain、PATCH不明、run取消、sweeper、相反terminalを検査する。
- workflow: フェーズBのmain限定environment、App tokenのpublisher step限定、candidate/reconcileの`checks:none`、
  PR code非実行、`queue: max`構文、secret/verdict非出力を検査する。復帰入口については、案内された入口が
  workflow定義に実在すること、`pr_number`と`target_sha`を入力として受理すること、通知本文とworkflow定義の
  入口識別子・入力名・required名が一致することを検査する。
- rerun: gh stubで案内どおりの起動を再現し、(1) 新しいworkflow runが作られ再評価証跡の`rerun_invocation_id`と
  `evaluated_at`が起動前と異なる値へ更新されること、(2) 結論が`action_required`のままでもこれを合格とすること、
  (3) 何も起きない実装（run未作成・証跡未更新）を不合格として検出すること、(4) head不一致では`sha_mismatch`で
  停止すること、(5) `inconsistent`では`config_error`証跡を残して停止し`action_required`が維持されることを検査する。
- core分類: `coreReviewRequired`真のfixtureでhuman証跡2 approveが`human_required`のまま停止すること、その状態で
  復帰入口の起動が証跡だけを更新しCheck結論を変えないこと、非コア分類でのみ成功系へ到達することを検査する。
- artifact: gateごとのA/M/D、削除、renameのD+A、空、追加/欠落、target変更、集合順をfixtureで反証する。
- distribution: template sync、setup/upgrade、ruleset `context+integration_id`、dedicated App probeを検査する。
- regression: Standard、自動adapter、local gate、ADR finalize、gate reconcile、全既存テストを維持する。

## checkpoint・完了条件

implementation writerが変更単位ごとにcommit/pushする。validation workerは全ACの正常・反例証跡、取消回復、
全回帰を`VALIDATION.md`へ保存する。ADR-0013がacceptedになった時点でrelated ADR追加のためdesign gateを
再通過する。フェーズ分類の定義、有効publisherの選択規則、gate集合、artifact分類、reducer API、状態写像、
再評価証跡のスキーマを変える場合はdesignへ差し戻す。未決事項はない。
