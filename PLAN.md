# PLAN: human gateのtrusted session復帰を実装する

- Issue: `ISSUE-278`
- 対応する DESIGN: `DESIGN.md`

## 目的・依存・出力

承認済みSPEC/DESIGN/ADRを入力とし、durable Review inbox、gate別session、専用App単一publisher、
artifact集合、nonce recovery、Strict slot adapter、配布同期と自動テストを出力する。実装前に
`verifyGithubReviewEvidence`（#283 / PR #284由来、mainへ取り込み済み）の実在とテスト成功、および
ADR-0013のacceptedを確認する。依存未成立時は実装を開始せず、類似reducerの新規実装、別App、
旧publisher fallbackを作らない。

## 実装順序

| # | 変更単位 | 内容 | AC-ID | 依存 |
|---|---|---|---|---|
| 1 | 依存統合 | #283をrebaseしAPI・App/environment/ruleset契約を固定、`verifyGithubReviewEvidence`のI/F確認 | AC-2, AC-6 | なし |
| 2 | ADR参照確定 | ADR-0013がacceptedになった時点でDESIGNの`related_adrs`へ`id/relation: adopts` objectで追加し再gate | 全AC | #1 |
| 3 | artifact domain | gate別path分類、A/M/D record、tombstone、集合digest、双方向比較 | AC-1, AC-5 | #1 |
| 4 | session domain | gate順導出、決定的key、parent一意化、slot envelope、状態写像 | AC-1, AC-7 | #3 |
| 5 | inbox/replay | PR Review marker、review API再取得、同digest no-op、相反拒否 | AC-3, AC-4 | #4 |
| 6 | publisher置換 | opener/submit/gate-publish/reconcileを#283 App publisherへ一本化 | AC-1〜AC-4 | #4, #5 |
| 7 | ownership recovery | 直列lane、nonce、取消run確認、postcondition retry、sweeper drain | AC-3, AC-4 | #6 |
| 8 | Strict seam | durable envelopeを既存`verifyGithubReviewEvidence`の入力形へ写像しreplayを外部化 | AC-6 | #5〜#7 |
| 9 | workflow/配布 | candidate checks write廃止、`checks:none`、`workflow_run`→protected publisher、root/template同期 | AC-2, AC-8 | #6〜#8 |
| 10 | 検証 | unit/integration/security/distribution/full regression証跡を保存 | 全AC | #1〜#9 |

## BDD conformance・falsification

| Given | When | Then | AC-ID |
|---|---|---|---|
| target/baseに複数segment変更 | open再実行 | 固定順各gateに同SHA/name/App parent一件を再利用する | AC-1 |
| parent 0/1/2件、別App同名 | open | 0はcreate、1はreuse、2は停止し別Appはrequired sourceにならない | AC-1, AC-2 |
| candidate workflow | token権限検査 | `GITHUB_TOKEN checks:none`でcustom Check APIを呼ばない | AC-2 |
| main以外/environment不正/App不一致 | publish | parent/slotをcreate/PATCHせず設定エラーにする | AC-2 |
| 同時提出/PATCH応答不明 | retry | 同一laneとnonce再読取で一結果へ収束する | AC-3 |
| processing中run取消 | sweeper | terminal runを確認後に新nonceで再開しpostconditionを満たす | AC-3 |
| terminal同digest/逆結論 | replay | 前者はno-op、後者は既存結果を変えず拒否する | AC-3 |
| Review記録後dispatch取消 | 定期drain | 未消費reviewを失わず一度だけslotへ記録する | AC-4 |
| pending 101件相当 | queue超過 | Actions取消に依存せずdurable inboxから全Reviewをdrainする | AC-4 |
| gate別A/M/D | derive/submit | tombstoneを含む保存集合と再導出集合が双方向一致する | AC-5 |
| path欠落/余分/重複/未分類/digest差 | submit | successを発行しない | AC-5 |
| Strict別actor/invocation 2 approve | reduce | `verifyGithubReviewEvidence`がapprovedを返しparent successへ写像する | AC-6 |
| Strict不足/重複/replay/混合 | reduce | 同関数外でreplay拒否し、同関数はfailure/action_requiredを返す | AC-6 |
| 各domain状態 | publish | status/conclusion表どおりでawaitingはmergeを停止する | AC-7 |
| local backend | open/submit | GitHub API、local report、成果物を変更しない | AC-7 |
| template/root/ruleset | sync・probe | byte一致、integration ID一致、旧publisher write不在となる | AC-8 |

## テスト適用性

- unit: gate順、一意key、classifier、tombstone、canonical digest、state mapper、nonce reducer、
  `verifyGithubReviewEvidence`写像seam。
- integration: gh stubでApp source、0/1/2 parent、Review drain、PATCH不明、run取消、sweeper、相反terminalを検査。
- workflow: main限定environment、App tokenのpublisher step限定、candidate/reconcileの`checks:none`、
  PR code非実行、`queue: max`構文、secret/verdict非出力を検査する。
- artifact: gateごとのA/M/D、削除、renameのD+A、空、追加/欠落、target変更、集合順をfixtureで反証する。
- distribution: template sync、setup/upgrade、ruleset `context+integration_id`、dedicated App probeを検査する。
- regression: Standard、自動adapter、local gate、ADR finalize、gate reconcile、全既存テストを維持する。

## checkpoint・完了条件

依存rebaseとrelated ADR追加でdesign gateを再通過後、implementation writerが変更単位ごとにcommit/pushする。
validation workerは全ACと公式仕様の実API smoke、取消回復、全回帰を`VALIDATION.md`へ保存する。App source、
gate集合、artifact分類、reducer API、状態写像を変える場合はdesignへ差し戻す。未決事項はない。
