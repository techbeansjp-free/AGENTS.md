# GitHub Actionsのrunnerの選び方

GitHub Actionsの費用が制約で、runnerの種類を変えて単価を下げるかを判断するときに読む。課金の仕組み・仕事量を減らす手段・計測の基本は[GitHub Actionsの費用](github-actions-cost.md)にある。runnerを変えても実行回数とjobの無駄は残るため、仕事量の削減と並べて比べる。手段の順序は[CIのテスト構成を設計する](equivalence-and-reuse.md)に従い、runnerの変更は、検出の時期や範囲を変える手段（後段への移設等）より前に比べる。仕事量の削減とrunnerの変更のどちらを先に行うかは、見込める削減額と手間で選ぶ。

ここでは選ぶ基準と導入前に確かめることを書く。runnerを立てるworkflowやIaCのコードは配らない。案件側で実装し、検証する。採否・費用の負担・運用の担当は利用者側が決める（[判断の所有](../../decision-ownership/SKILL.md)、見積と運用の責任は[見積と対応範囲](../../estimate-and-scope/SKILL.md)）。

## 選択肢

次は2026-11-21に一次資料で確かめた内容である。料金と提供条件は変わるため、判断の前に出典で確かめる。数値を目標や規範として使わない。

表は運用の手間が小さい順に並べた。下の行ほど、patch・監視・scalingを案件側が担う。

| 選択肢 | 費用の形 | 主な制約 | 運用・導入 |
| --- | --- | --- | --- |
| GitHub-hostedの標準runner | publicは無料。privateは分単価（Linux 2-core x64 $0.006、arm64 $0.005、Windows $0.010、macOS $0.062） | 同時数の上限（例：Free 20・Team 60、macOSは5） | 不要。`runs-on`だけ |
| `ubuntu-slim`（Linux 1-core） | privateは$0.002 | containerの中で非特権。Docker-in-Docker・mount不可、jobの上限15分 | 不要。`runs-on`だけ |
| arm64の標準runner | x64より安い | 依存（native module、配布されるbinary、action、container image）がarm64で動くこと | 不要。依存の確認が要る |
| larger runner | core数に応じた分単価。publicでも課金 | GitHub TeamとEnterprise Cloudのorganizationだけ。分単価は高いが、短くなれば総額が下がる場合がある | organizationでrunnerを作る |
| 外部のrunnerサービス（`runs-on`を替えて使う） | 従量、月額＋含まれる分、runnerごとの定額、利用者のクラウドの費用＋license等、事業者で異なる | ソース・秘密情報・cacheを事業者の環境へ渡す型と、利用者のクラウドで動く型がある。事業の終了がありうる | GitHub Appの導入と`runs-on`の変更。契約・委託の確認が要る |
| self-hosted（クラウドで使い捨て） | クラウドの費用＋運用の人件費。GitHubへの分の課金は現行なし（告知後に延期中） | 起動の待ちとimageの取得も課金される。運用の担当が要る | 起動の仕組み・image・権限・監視・更新を案件側が担う。EC2のSpotは中断への備えも要る |
| self-hosted（常時起動の手元の機械） | 機械の償却・電力・保守＋運用の人件費 | 使い捨てにしにくく、job間で状態や秘密情報が残る | 機械の保守・隔離・故障の対応を案件側が担う |

使い捨てのrunnerの実装の例（下の2つは運用の大半をクラウドや公式の部品に任せられる。残りは案件側で組む）：
- **Kubernetes**：Actions Runner Controller（ARC）。GitHubが最新のAutoscaling Runner Setsだけをサポートする（[Actions Runner Controller](https://docs.github.com/en/actions/concepts/runners/actions-runner-controller)、[Support for ARC](https://docs.github.com/en/actions/concepts/runners/support-for-arc)）。
- **AWS CodeBuild**：クラウドが提供する使い捨てのrunner。webhookで受けたjobごとにrunnerを起動し、job後に終了する（[CodeBuild-hosted GitHub Actions runner](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner.html)）。
- **AWS Fargate・EC2**：`workflow_job`のwebhookを受け、JIT runnerの設定を作り、1 jobに1つのtaskまたはinstanceを起動する。Fargateは秒課金（最低はLinuxで1分、Windowsで5分）でimageの取得の開始から課金され、特権containerが使えない（Docker-in-Dockerは不可）。EC2のSpotは安いが中断がある。公開の実装（例：terraform-aws-github-runner）は、使い捨ての設定が既定で無効の場合があるため既定値を確かめる。
- **macOS**：EC2 Macは最低24時間の割当てで、少量の利用では不利。

出典：[Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)、[GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[Actions limits](https://docs.github.com/en/actions/reference/limits)、[Fargate pricing](https://aws.amazon.com/fargate/pricing/)、[Fargate security considerations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-security-considerations.html)、[EC2 Mac instances](https://aws.amazon.com/ec2/instance-types/mac/)。

## 選ぶ順序

安い順ではなく、使えるかを先に判定する。

1. **信頼の条件で候補を外す**（下の表）。
2. **実行の条件で候補を外す**：必要なOS・CPUの種類、Docker・service container・特権・仮想化、メモリ、jobの時間。
3. **計測で主因を特定する**：GitHubの請求と内訳の推定から、実行回数・jobの数・時間・単価のどれが大きいか、待ち時間と同時数が制約かを分ける（[GitHub Actionsの費用](github-actions-cost.md)の「費用を計測する」）。
4. **小さい変更から比べる**：仕事量の削減、hostedの安いrunner（slim・arm64）、OSの構成の見直し、larger runnerで短くする。
5. **運用を増やさない外部の選択肢を比べる**：外部のrunnerサービス、クラウドが提供する使い捨てのrunner（例：AWS CodeBuild）。
6. **運用の担当がいる場合だけ、使い捨てのself-hostedを比べる**。
7. **採る前に実測する**：同じworkflowを並行して流し、検出・失敗の扱い・費用・待ち時間・hostedへの戻し方を確かめる。

jobごとに違うrunnerを組み合わせてよい。たとえばLinuxの軽い検査はslim、arm64で動く検査はarm64、macOSでしか検出できない検査だけmacOSにする。

### 信頼の条件で外す

| 条件 | 外す候補 |
| --- | --- |
| public repository | self-hosted。GitHubは、public repositoryではself-hostedをほぼ使うべきでないとしている。標準runnerが無料なので、費用の対象はlarger runnerだけ |
| forkからのPRや信頼できない人のcodeを流すjob | そのjobのself-hosted。privateでも、forkしてPRを出せる人はself-hostedの環境を侵害できる |
| ソース・秘密情報を第三者へ渡せない（契約・規制・実行地域） | 事業者の環境で動く外部サービス。利用者のクラウドで動く型は、事業者に与える権限と通信先を確かめて残す |
| 1 jobごとに破棄できない | その構成を、秘密情報を使うjobと、複数のrepositoryで共有するrunnerに使わない |

出典：[Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)（Hardening for self-hosted runners）。

### 案件の条件ごとに最初に比べる組合せ

| 案件・jobの条件 | 最初に比べる組合せ | 注意 |
| --- | --- | --- |
| public、外部からPRを受ける | 標準のhosted | self-hostedは費用の理由が弱く、攻撃される面が増える |
| private、小規模・断続的、運用の担当なし | 標準のhosted＋合うjobだけslim・arm64 | 含まれる利用額の内なら、移しても支払いは減らない |
| 短く軽い検査、特権不要 | `ubuntu-slim` | 1 CPUで遅くなると削減が縮む。15分の上限 |
| arm64に対応済みのLinuxの検査 | hostedまたは外部のarm64 | x64でしか検出できない失敗の検査は残す |
| CPU・メモリ不足で長い | larger runner、外部の大きいrunner | 分単価ではなく、1回の総額で比べる |
| private、超過が続く、外部へ委託できる | 外部のrunnerサービス＋hostedへ戻す切替え | 月額・cache・通信・同時数・解約の条件を含める |
| 自分のクラウドの中で動かす必要がある | クラウドが提供する使い捨てのrunner、利用者のクラウドで動くサービス | 事業者の管理権限・通信先・責任の範囲を確かめる |
| Linux、特権不要、負荷が変動、クラウドの運用担当あり | Fargate等の使い捨てのrunner | 起動・imageの取得・cacheの作り直しが、短いjobでは重い |
| Dockerのdaemonや特権が必要、中断してよい | 使い捨てのEC2（Spot＋通常の容量の予備） | 中断・容量不足・再実行と、image・OSの保守を含める |
| Kubernetesの基盤と担当が既にいる | ARC | CIの費用だけを理由にKubernetesを新しく立てる負担は大きい |
| macOSの負荷が定常的に高い | hosted、外部のmacOS、専用のMacを比べる | 手元のMacは停止・更新・隔離・故障の対応が要る。普段の開発機と共用しない |

## 総額で比べる

分単価ではなく、同じ仕事を終えるのに要る月の総額で比べる。

```text
月の総額 =
  実行の課金（起動・準備・失敗・取消・再実行を含み、各サービスの課金の粒度で数える）
  + 固定費（license、月額、常時起動・待機の容量、NAT等の通信）
  + cache・artifact・log・通信の費用
  + 月の運用時間 × 人件費の単価
  + 導入・移行の費用 ÷ 評価する月数
```

- 公開の単価ではなく、試行で測った実効の単価を使う。起動の待ち、imageの取得、最低課金、cacheが効かない分で、公開の単価より高くなる。
- GitHubの含まれる利用額は所有者単位で共有されるため、定価で換算した削減額と、実際の請求の削減額を分ける。
- 採るのは、hostedから減る実際の請求が、移した先で増える総額を上回り、担当者が1人欠けても続けられるときだけにする。
- 仕事量・cacheの効き・Spotの中断・運用時間に幅を持たせ、悪い側の条件でも差が残るかを確かめる。差が小さければhostedを続ける。
- 小さい案件では、請求と代表的なjobの比較で止めてよい。見積の精度を上げる作業にも費用がかかる。

## 導入前に確かめること

次を満たさない構成は採らない。手順はこの確認項目を案件の実装に当てはめる雛形であり、検証済みの実装ではない。

### self-hosted

| 項目 | 確かめること |
| --- | --- |
| 載せるjob | forkからのPRと信頼できないcodeを載せない。`pull_request`ではPR側のworkflowの定義が使われるため、workflowの中の条件や`runs-on`はPRを出す人が書き換えられ、境界にならない。境界は、runner groupで使えるrepositoryとworkflowを限ることと、repository・organizationの設定（private repositoryの「Run workflows from fork pull requests」、fork PRのworkflowの承認）に置く。`pull_request_target`等で信頼できないcodeを実行する迂回も防ぐ。既定はhostedにする（[Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)） |
| 使い捨て | JIT runnerか`--ephemeral`で1 jobごとに登録を外し、実行環境と書込み領域もjobごとに破棄する。登録を外すだけで完了としない |
| 使える範囲 | runner groupで使えるrepository（と、使えるならworkflow）を限る。labelを認可の境界にしない |
| 制御側の権限 | webhookの署名を検証する。GitHub Appの権限を最小にする。起動できるimage・task・roleを限る。制御用の資格情報をjobへ渡さない |
| jobの権限 | `GITHUB_TOKEN`を最小にする。クラウドの権限が要らないjobにはroleを付けない。要るjobだけOIDCで短命の資格情報を取り、`aud`・`sub`でrepositoryとbranchまたはenvironmentを限る |
| 通信とcache | 内部のサービス、metadata、秘密情報への到達を限る。信頼の境界を越えてcache・artifactを再利用しない |
| 更新 | OS・runner・toolchain・imageの更新の担当と周期、緊急の更新、古い版への戻し方。使い捨てのcontainerでrunnerの自動更新を止める場合も、runnerの版は定期的に上げる（古い版は新しい機能のjobを正しく処理できないことがある） |
| 起動と終了 | webhookの重複、取消、起動の失敗、登録されないrunner、取り残されたtask・instance、同時数・稼働時間・費用の上限 |
| 監視 | 待ち・起動・job・後始末の時間、runnerのlogの外部への保存、異常の通知と担当 |
| hostedへ戻す | 変数等の1か所でhostedへ戻せる。合うrunnerがないjobは待ち続け、24時間で失敗する。GitHubは自動でhostedへ回さない（[Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)）。戻す条件、待っているjobの取消と再実行、必須checkの名前が変わらないことを決める |
| 同等性 | x64からarm64、imageの違いで検出が変わらないことを並行して流して比べる |
| 受入 | 必要な検査・失敗の検出・artifactが保たれ、失敗や中断が成功として扱われないこと |
| やめる条件 | 担当が不在になった、削減額が増えた総額を下回ったときにhostedへ戻す |

構成の例（AWSで1 jobに1 task）：`workflow_job`のwebhookを受ける → 署名・対象・重複を確かめる → JIT runnerの設定を作る → 1 job用のtaskを起動する → logを保存し、環境を破棄し、登録の状態を照合する。

### 外部のrunnerサービス

self-hostedの「載せるjob」「jobの権限」「hostedへ戻す」「同等性」「受入」に加えて確かめる。

- 渡る情報（ソース、秘密情報、cache、log）と、その保存先・保持期間・削除。
- 実行の場所と、1 jobごとに破棄する方式。
- 課金の粒度、含まれる分、同時数の上限、費用の上限の設定。
- GitHub Appに与える権限。
- 事業の継続、解約・障害のときに`runs-on`をhostedへ戻す手順。
- 契約・規制で外部へ委託できるか。

## 計測

- runnerごとに請求の正本が違う。GitHub-hostedはGitHubの使用量、外部サービスは事業者の請求、利用者のクラウドで動くrunnerはクラウドの請求とlicense、手元の機械は償却・電力・保守・運用の時間。
- run・job・attemptと、task・instance・事業者の実行の識別子を対応付ける。jobの開始と終了の時刻からは、クラウドの課金時間（起動・imageの取得を含む）を復元できない。
- 請求額と推定額を分けて示す。GitHubのbudgetは外部や基盤の増加を検出しないため、各請求元の予算と通知も使う。予算で止まった検査を成功として扱わず、必須の検査が欠けたままmergeやreleaseをしない。
- 切り替える前と後で、同じworkflowの実効の単価、待ち時間、失敗率を比べる。
