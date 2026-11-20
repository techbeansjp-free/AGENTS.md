# GitHub Actionsの費用

CIがGitHub Actionsで、課金額が制約のときに読む。検出能力を落として費用を下げない。手段の順序の正本は[同等性・並列化・結果再利用](equivalence-and-reuse.md)の「CIのテスト構成を設計する」であり、ここではGitHub Actions固有の課金の仕組み、手段、計測、通知を扱う。

## 費用の決まり方

次は2026-11-21に公式文書で確かめた内容である。料金・枠・APIは変わるため、判断に使う前に出典で現在の値を確かめる。ここの数値を固定値や目標として使わない。

- **public repository**：標準のGitHub-hosted runnerは無料。larger runnerはpublicでも課金される。
- **private・internal repository**：標準runnerの費用は、所有者（個人またはorganization）のplanに含まれる月の利用額から差し引かれ、超えた分が課金される。含まれる利用額は分数ではなく金額で示され、repositoryごとではなく所有者単位で共有される。支払い方法が未登録なら、含まれる利用額を使い切った時点で実行が止まる。
- **切上げ**：jobごとに、使った分の端数を1分へ切り上げる。20秒のjobも1分になる。
- **単価**：runnerのOSとcore数で分単価が決まる。確認時点でLinux 2-coreは$0.006、Windows 2-coreは$0.010、macOSは$0.062で、macOSはLinux 2-coreの約10倍だった。
- **失敗・取消・再実行**：失敗や取消までの経過分も課金される。再実行した分は合算される。
- **self-hosted runner**：GitHubへのrunnerの分の課金はない。代わりに基盤・待機・保守・隔離の費用がかかるため、総額で比べる。
- **保存**：artifactはplanの枠（GitHub Packagesと共有）を超えると課金される。cacheはrepositoryごとに10 GBの枠が別にあり、その上限を枠より大きく設定した場合だけ超過分が課金される。どちらも時間ごとの使用量で積算される。

出典：[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)、[Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)。

## 費用が増える要因を分ける

費用は、実行回数 × jobごとの切上げ後の分 × runnerの単価の合計になる。どの項が増えたかを計測で分けてから手段を選ぶ。

| 項 | 増える要因 |
| --- | --- |
| 実行回数 | push回数、同じcommitを流す二重のtrigger（`push`と`pull_request`等）、base branchの更新で全PRを流し直す設定、botのPR、`schedule`、`workflow_run`等の連鎖、全jobの再実行、flakyなテスト |
| jobの数 | matrixの組合せ、jobの細分化、shard |
| jobの時間 | job内の準備（checkout、依存の導入、build、imageの取得）、テスト本体、止まったjobの待機 |
| 単価 | macOS・Windows、larger runner |

## 手段を選ぶ

検出への影響で3群に分け、前の群から使う。

### 1. 検出を変えない手段

- 同じcommitを二度流すtriggerをまとめる。
- `concurrency`の`cancel-in-progress: true`で、同じPRの古いcommitの実行を取り消す。最新のcommitは全部検査されるが、取り消した途中のcommitの結果は残らない。releaseやdeployのように途中で止めてはいけない処理では取り消さない。
- jobに`timeout-minutes`を実測から決めて設定する。既定は360分で、止まったjobがその間課金され続ける。
- 同じrunnerで同じ準備をする短いjobをまとめる。20秒のjob 6個は切上げで6分だが、1個にまとめて合計120秒なら2分になる。まとめると並列で走らなくなり、どの検査が失敗したかの分かりやすさも下がるため、step名と終了値で失敗を区別できるようにする。
- OSに依存しない検査はLinuxで流し、macOS・Windowsは、そのOSでなければ検出できない失敗の検査だけにする。どのOS固有の失敗を検出する責任があるかを先に書き出し、それを外さない。
- 依存のcacheは取得時間を減らすが、復元・保存の時間と枠を使う。効果を測ってから入れる（上の「CIのテスト構成を設計する」の**cache**）。
- 失敗したjobだけを再実行し、flakyなテストは原因を直す。失敗を隠す自動の再実行は加えない。
- artifactの`retention-days`を、使う期間に合わせる。
- ローカルで検証してからpushし、小さな修正ごとのpushで全jobを流し直さない。

### 2. 同等性の確認が要る手段

重複の削除、下の層への移設、準備の共有、影響範囲での絞り込みは、[CIのテスト構成を設計する](equivalence-and-reuse.md)の条件に従う。GitHub Actionsでは次も確かめる。

- workflow全体を`paths`で飛ばすと、そのworkflowの必須checkはPendingのまま残り、mergeできなくなる。必須checkを持つworkflowは起動させ、job内で変更pathを判定し、集約jobで実行計画と結果を照合する。

### 3. 検出の時期や範囲を変える手段

次は費用を下げるが、検出の時期や範囲が変わる。勧める手段ではなく選択肢であり、採否はリスクを受け入れる利用者側が決める（[判断の所有](../../decision-ownership/SKILL.md)）。提案するときは、何をいつ検出しなくなるか、その時点がmergeやreleaseの条件に入っているかを書く。

- **Draftの間は流さない**：Draftの間の失敗はCIで検出されず、Draftを解除するまで分からない。commitが積み重なり、原因のcommitの特定に費用がかかる。`pull_request`の既定のtypesは`opened`・`synchronize`・`reopened`だけなので、`ready_for_review`を加えないと解除しても次のpushまで流れない。Draft PRを出してCIで確かめる運用とは両立しない。間を取る案として、Draftでは安い検査（Linuxのlintや単体テスト）だけを流し、高い検査（macOS・Windows・E2E）を解除時に流す方法がある。
- **PRで流すmatrixを減らす**：減らした組合せの失敗は、全部を流す段まで検出されない。
- **後段へ移す**：上の「CIのテスト構成を設計する」の3（最後の手段）に従う。重い検査を毎晩決まって流す構成は応急処置であり、標準にしない。後段で流す場合も、前回の成功から入力が変わっていなければ流さない。

## 並列化とshardは費用を増やす

並列化やshardは待ち時間を縮めるが、課金額は減らない。shardごとに準備が重複し、jobごとに切り上げられるため、多くの場合は増える。費用が制約なら増やさない。待ち時間が制約で費用に余裕があるときだけ、増える分を見積もってから採る。

## 費用を計測する

- **請求の正本**：所有者のBilling画面の使用量（[Viewing your usage of metered products and licenses](https://docs.github.com/en/billing/how-tos/products/view-productlicense-use)）。repository・SKU単位で見られ、詳しいreportではworkflow単位も見られる。workflow単位の詳しいreportはWeb画面でだけ取れ、REST APIの使用量のendpointからは取れない（[Billing reports reference](https://docs.github.com/en/billing/reference/billing-reports)）。
- **内訳の推定**：jobs API（`GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs?filter=all`）で、job名、`started_at`、`completed_at`、`conclusion`、runnerの`labels`を取る（[REST API endpoints for workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs)）。repositoryの読取り権限で使える。推定費用は、jobごとに`completed_at − started_at`を分へ切り上げ、labelsから決めたrunnerの単価を掛けて合計する。
  - `filter=all`で再実行したattemptも含め、全pageを取る。既定（`latest`）は最新のattemptだけを返す。
  - 失敗・取消したjobも経過分を数える。
  - 未終了、取得の失敗、単価の分からないrunnerは0として扱わず、「不明」として件数を報告する。
  - 結果は推定であり、請求額とは呼ばない。public repositoryと標準runnerの組合せは無料なので分けて示す。self-hosted runnerは分の課金がないので分けて示す。
  - 集計の軸はworkflow、job、OS、event（`pull_request`・`push`・`schedule`等）、PRにする。どの項（実行回数・jobの数・時間・単価）が増えたかを分けられる。
- **前提にしないAPI**：workflow runの使用量のendpoint（`/actions/runs/{run_id}/timing`）は廃止の途中にあると公式文書が警告しているため、新しく使わない（[REST API endpoints for workflow runs](https://docs.github.com/en/rest/actions/workflow-runs)）。organizationの使用量のREST API（`/organizations/{org}/settings/billing/usage`）は使える組織と権限が限られるため、全利用者の前提にしない（[Billing usage](https://docs.github.com/en/rest/billing/usage)）。
- 計測や通知のworkflow自身も課金の対象になる。

## 増え方に気付く

- まずGitHubのbudgetとalertを使う。product・SKU・repository・account単位で予算を作り、75%・90%・100%で通知を受けられる。「Stop usage when budget limit is reached」を選ぶと上限で実行が止まる。止まるとCIの検査も流れないため、そのときに提出やreleaseを止める扱いを決めてから選ぶ。productとSKU、accountとrepositoryの予算を重ねると、意図しない停止が起きる（[Setting up budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets)）。
- budgetは総額しか示さない。増えたときは、上の推定の内訳で、どの項が増えたかを特定する。
- 標準の通知で足りないときだけ、案件の権限の範囲で集計と通知のworkflowを組む。`schedule`と`issues: write`の権限が要る。通知は毎回新しいIssueを作らず、既存のIssueを更新する。
- しきい値は案件の予算と実測から決める。参考の事例の数値を規範にしない。
