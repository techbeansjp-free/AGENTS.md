# v0.5評価CLIの実行手順

正式リリース前の評価用。現在、要求からDraft PR/CIまで実証した実行環境はLinux。Node.js 20以上、Git、GitHub CLI、Codex CLI、bubblewrap、prlimit、稼働中のsystemd user managerとcgroup v2が必要。Codex 0.153.4で検証した。macOS/Windowsのpackage・移行テストと、AgentのOS隔離対応は別である。

`agent-skill-chain --help`（別名`asc-v05 --help`）で開始・再開・移行の入口と、この手順書の配布先を確認できます。引数なしも案内のみを表示し、Agent起動やGit変更は行いません。

## 作業場所

通常入口の`run`/`run-goal`はlinked worktreeを要求する。新規作成時の標準命名はv0.4と同じく、directoryを`.worktrees/<YYYYMMDD_HHMMSS>-<Issue番号>-<slug>`、作業branchを`<type>/<Issue番号>-<slug>`とする。時刻は作成環境のlocal time、slugは小文字英数字とハイフン、標準typeは`feature`・`fix`・`refactor`・`test`・`docs`・`chore`。Issue番号とslugはdirectoryとbranchで揃える。プロジェクトが明示した命名規約を優先する。同じIssueを並列分担する場合はslugへ担当名を含める（例: `account-api` / `account-ui`）。

例: `git worktree add -b fix/123-login-message .worktrees/20261015_143000-123-login-message <base>`。専用作業先の絶対pathを`repo`に指定する。名前が衝突したら別slugを選び、既存branchの強制reset・worktree上書きを行わない。必要に応じてownerがmerge/rebaseでbase変更を取り込み、更新した要求で検証・reviewを再実行する。ASCは自動fetch・stash・reset・base更新を行わない。

命名は作成時の標準であり、安全性の証拠ではない。既存worktreeの改名や時刻の鮮度を再開条件にしない。`asc-v05 worktree-create <root> <issue> <type> <slug> <base>`で標準名の作業先を作成できる。checkout filterやhookを実行せず、既存branch/pathは上書きしない。途中失敗した作業先は調査用に保持する。独自規約の作業先はownerが作成して`run`へ渡せる。実行時は名前ではなくGitの実体、変更範囲、ContractとEvidenceを検証する。独自規約や過去の名前だけを理由に正常な作業を一律拒否しない。

移行や隔離実験の独立cloneを使う場合だけ、外部owner入力へ`"workspaceMode": "isolated-clone"`を明記する。未指定はworktree、未知値とrepo配下のサブディレクトリは拒否する。これはGit上の作業場所の確認であり、同時編集者がいないことの証明ではない。cloneの独立した準備はowner責務で、共有object storageの有無まではこの検査で判定しない。従来のclean状態・差分検査は継続する。内部APIを直接使うhost integrationは専用作業場所を自ら用意する。

利用者が編集中の作業場所を直接渡さない。専用のclean worktreeまたは移行用独立cloneを使う。候補の検分はtracked file全体とindexを確認する。owner入力・署名鍵・配布物は候補外へ配置する。通常の未追跡fileは停止対象だが、Gitの無視対象の生成物は変更範囲と重ならない場合にHostへ保持する（末尾の「Hostに残る生成物」を参照）。

`asc-v05 migration-inspect <旧project>` で非互換を確認できる。`migration-prepare <旧project> <新しい保存先>` は旧repoを変更せず、新しい保存先のprojectへ独立cloneを作る。旧承認は引き継がない。既存の保存先を削除・上書きしない。

## Owner入力

候補外のhost管理JSONへ次を記入する。これは書式例であり、実際の要求・権限・検証コマンドを決めるのはowner。Agentの出力をそのままこの入力へ置き換えない。

```json
{
  "repo": "/absolute/dedicated-candidate",
  "base": "実在する40桁の基点commit",
  "codexExecutable": "/absolute/codex/bin/codex.js",
  "model": "ownerが選んだモデル",
  "maxRepairs": 1,
  "contract": {
    "intent": "元Issue本文と完全に同じ要求",
    "criteria": ["検証可能な受入条件"],
    "allowedPaths": ["src/example.js", "test/example.test.js"],
    "testArgv": ["/runtime/node", "--test"],
    "riskTestArgv": [],
    "requiredChecks": ["test"],
    "policyRevision": "owner-policy-v1",
    "risks": [],
    "unresolved": [],
    "requiresDesign": false,
    "design": "",
    "verificationAssets": {
      "runtime": {"source": "/absolute/runtime-bin", "digest": "assets-inspectで取得した64桁digest"},
      "dependencies": []
    }
  },
  "delivery": {
    "repository": "owner/private-dummy-repository",
    "issue": 1,
    "branch": "evaluation-change",
    "baseBranch": "main",
    "workflowPath": ".github/workflows/test.yml"
  }
}
```

runtime-binにはhostが信頼するNode実行file等を用意し、`asc-v05 assets-inspect <directory>` でdigestを取得する。共有libraryはLinux検証環境の/usr・/lib等を使う。依存物が必要なら同様に固定し、`dependencies`へ `{source,digest,target:"node_modules"}` 等を指定する。検証中のmountは読み取り専用。CLIはnpm/composer installやinstall hookを自動実行しない。

許可pathは完全一致。変更数は最大500 tracked files、総source量64MB・単一file12MB。runtime・依存物は各inventory最大50,000 entries・512MiB。大きなprojectを黙って切り捨てず停止する。これらの評価上限があるため、任意規模の既存projectに対応済みとはしない。

不明な業務判断は `unresolved` に残す。認可・移行・公開契約は `risks` に `authorization` / `data-migration` / `public-contract` を指定し、設計・固有検証・[署名承認](OWNER_APPROVAL.md)を用意する。低リスクの自己申告だけから承認を生成する機能はない。

## 実行と停止

`asc-v05 run /absolute/owner-request.json` を実行する。hostのprovider認証とGitHub認証はAgent tool環境へ渡さない。Agent起動前にhost dummyの読取り拒否・実体不変と、陽性対照付きloopback通信拒否を実測する。欠測・失敗なら起動せず、権限を緩めて再試行しない。Agentは必要な変更を作り、controllerが固定コマンドを隔離実行する。fresh Reviewerの具体的な指摘または検証失敗だけを、設定回数以内で修正へ戻す。

終了値0はDraft/CI成功、2はowner作業が必要、1は停止。stderrに進行JSON、stdoutに結果を返す。停止時の `blocked.artifact` はhost側診断資料を示す。usage欠測はnull。source・index・要求・base・権限の不一致を自動的に承認したり、隔離なしでやり直したりしない。

再開は同じ入力でrunする。ログを承認として読み込まず、現在のGitを検証し直す。同じ対象の既存Draftは再観測するが、別HEADのPRは勝手に上書きしない。owner署名はrunごとに取り直す。途中の候補変更を捨てない。

## 提出と移行の巻戻し

作成するのはDraft PRのみ。PRのrepo・branch・base・HEAD・状態を確認し、そのPRに結び付いた必要CIを待つ。merge・releaseは実施しない。CIの成功は、指定oracleを超える品質やASC旧版との完全同等性の証明ではない。

`asc-v05 migration-rollback <移行保存先>` は評価用の選択記録だけを旧版へ戻し、元repoと新しい候補変更を保持する。旧パッケージの再インストール、PATHの変更、設定の復元は実行しない。実際の切戻しは旧版の再導入・入口の再選択と、変更した場合だけ設定commitのrevertで行う（[移行手順](MIGRATION_PLAN.md#rollback)）。旧版の承認を復元せず、必要な再検証を要求する。利用者のCLI/Skill/CI設定を本番切替する機能はまだ含まれない。


## Host対応の現在地

`capabilities.host` はOS種別と実行候補かを返すが、隔離の証明ではない。通常Linuxでも各runの実検査を必須とする。WSLをLinuxと同一視しない。WSL2はWindowsの正式実行環境とする設計方針だが、Windows側file・interop・Git/Docker/credential連携の実機越境試験が未完了のため、現在のrunはWSLを明示的に拒否する。macOSも実Agent/検証の受入未完了、Windows nativeはv0.5.0の対象外。安全機能を省略するfallbackはない。

中規模・大規模では2 Agentを上限としない。Work Unitの依存順実行・独立cloneでの並列実装・統合・全体レビューは評価CLIに実装されています。部分再計画や本番復旧を含む受入条件は `V05_COMPLEXITY_ACCEPTANCE.md`（評価リポジトリ）に記録し、単一fixtureでの成功を全条件の達成とは扱いません。

### 文書変更の扱い（評価中）

現在の方針は既存の正本文書へ集約し、通常の変更理由はPRへ記録する。進捗、方針の再説明、小さな実装判断のためにADRを追加しない。新しいADRは、後で失われやすい重要な判断について、既存文書・PRでは足りない理由と見直し条件を既存の変更説明へ示せる場合に限定する。その説明のための別文書は作らない。利用者固有の文書規約がある場合はそれを優先する。

実装担当は既存文書の更新を優先し、独立Reviewerは新規ADRの必要性・重複・正本との矛盾を確認する。不要なものは統合を求める。古い判断はGit履歴から必要時だけ参照し、全ADRを毎回の入力にしない。これは指示とレビューで運用する規則であり、意味的な必要性を自動判定するGateではない。


実装担当は、許可された範囲でコード・テストと関連文書を一緒に更新します。Reviewerは一次要求・実差分・関連する要求や設計の整合性を確認します。文書種類ごとの専用Agentは追加しません。必要な文書が変更許可範囲外なら、許可範囲を勝手に拡大せず不足として報告します。

ReviewerにはGit管理情報を含まないsnapshotと、controllerが観測した差分・対象HEAD・検証結果を渡します。変更箇所と関連契約から調べ、不明点や危険性に応じて範囲を広げます。文書不変や形式検証の成功だけで、意味的整合性を保証しません。

`NODE_DOCUMENT_REPAIR_EVIDENCE.json`は古い設計の検出と是正を実Agentで確認した局所試験です。Deliveryはstubです。`NODE_DOCUMENT_COMMON_EVIDENCE.json`は共通fixtureの実Draft/CI試行で、137.86秒と以前の92.05秒より遅い観測でした。単発の時間差から因果効果や性能達成を判断していません。

探索指示を絞った後の共通fixtureは91.86秒・2 Agentで実Draft/CIまで完走しました（NODE_DOCUMENT_FOCUSED_EVIDENCE.json）。各1回の観測であり、恒常的な速度維持の証明ではありません。修復時に許可された文書が削除されていた場合、基点Gitの該当内容だけを参照として渡します。参照の改変は拒否し、参照自体を成果物へ取り込みません。

### 複数Work Unitと限定的な再開

`asc-v05 goal-plan /absolute/owner-plan.json` は依存関係・変更範囲・共有契約の整合性を検査する計画専用入口です。`asc-v05 run-goal /absolute/owner-request.json` は独立cloneでUnitを実行し、個別検証・レビュー後に統合、全体検証・freshレビュー、Draft/CIへ進みます。単純な変更には従来の `run` を使い、Unit計画を必須にしません。入力は [GOAL_EXECUTION.md](GOAL_EXECUTION.md) を参照してください。

失敗した実行groupは統合しません。既に統合済みのgroupは保持します。現時点で `run-goal` はclean baseから開始するため、部分統合済みrootの自動再開には対応していません。任意の旧ログを正式Evidenceとして読み込むこともありません。

ownerは成功したUnitのGit出力を `unitCandidates` で明示できます。契約と宣言済み入力が一致する低リスクの候補だけを取り込みますが、新しい検証・独立レビューは省略しません。契約変更、宣言済み依存変更、高リスクの場合は新しい実装経路に戻ります。単なる旧レビュー合格の申告は受け付けません。

承認用 `approvalCommand` はhost管理の絶対実行pathと、絶対file pathまたはbare flagだけを引数に持たせます。候補repoやGit管理領域内のscript、将来作られる候補path、解決不能aliasを拒否します。外部承認プログラムとその保管場所の保護はhostの責務です。

### 利用者規約の固定参照

必要な利用者規約はowner入力の`contract.policyRefs`へ`{path, sha256}`で指定できます（最大64件）。Git管理された現在のfile内容を毎回hash照合し、実装担当と独立Reviewerへ同じ参照を渡します。文書別Agentは追加しません。参照はAgent変更許可pathと重複できず、snapshotに配置しない`.codex`/`.agents`も指定できません。規約変更が必要ならownerが別の要求・Contractとして確定します。

複数Unitでも親Goalの参照を落としたり置き換えたりできません。これは内容と実HEADの拘束であり、規約の意味的妥当性やAgentが遵守したことの証明ではありません。遵守は検証・独立レビューの対象です。規約の内容がhost権限・隔離・正式承認を変更することはありません。旧ASCの全文書を自動的に参照へ昇格させず、ownerが必要なproject規約を選びます。

設定切替候補は`migration-stage <source> <new-location> <external-owner-plan>`で別cloneに準備できる。全設定の保持／置換と変更前hashをownerが明示する。詳細はMIGRATION_PLAN.md。設定実行・正式切替・旧Evidenceの継承は行わない。

GitHubのPR/CI読取り中に一時的な通信失敗が発生した場合、観測期限内に最大2回まで再試行する。push・PR作成はこの再試行の対象外。HEAD/Draft/CI失敗や認証エラーは停止する。再試行の経過は成功時のDelivery Evidenceへ記録する。個々のAPI呼出しには別のtimeoutがあるため、観測期限は厳密なプロセス終了時刻の上限ではない。

### 品質と性能の継続確認

ソースcheckoutでは`node v05/report_workflow.mjs /absolute/result.json`で、単一Workflow・Goal・複数Issueの保存結果を読み取り専用で集計できる。この評価用scriptは配布物には含めない。失敗した実行の観測usageも含め、並列実行の時間は合算しない。診断記録がないIssueや呼出しは欠測として残し、明示された空の`calls: []`だけを宣言上の起動0回として扱う。宣言された呼出しの集計が完全でも、Provider内部を含む全Agent総量の証明にはならない。

実行経路・Agent入力・検証・Deliveryに影響する変更では、品質検証と同じ変更単位で共通fixtureの性能回帰も確認する。既存の試験driverと実行ログを使い、常駐監視や計測専用Agentは追加しない。文言のみの変更など実行に影響しない場合は、有料E2Eの重複実行を要求しない。

要求からDraft PR/CIまでのwall time、Agent起動数、取得できたinput/output/cache usage、失敗・再試行を記録し、品質oracleの結果と併記する。取得できないusageは欠測とし、観測値を全Agent総量と呼ばない。初期準備や手動中断が計測区間外なら明記する。失敗試行を削除せず、正常完走区間と分ける。

比較ではfixture・開始点・モデル・配布資産・oracle・独立レビュー・終了条件を揃え、対象変更以外の条件差を明示する。単発観測だけで改善率の確定や性能受入合格とはしない。回帰が観測されたら区間別ログで原因を確認し、品質を弱めて速度を達成しない。既存の約92秒は探索的な参考値であり、全変更の一律期限ではない。

複数worktree・複数Issueを同じHostセッションから扱ってよい。セッション全体を単一Issueへ予約しない。各実行のrepo・base・ContractとEvidenceを個別に検査し、別実行の拒否・保留を全体の拒否状態へ伝播させない。同じworktreeを次のIssueで使う場合も、新しい要求と必要な検証を与え、以前の承認を自動継承しない。別worktreeのレビュー流用、同じ作業領域への競合書込みを許可する意味ではない。

### 任意の実行予算

owner requestの`budget`に`maxAgentCalls`と`maxElapsedSeconds`を指定できる（各0〜1,000,000の整数、省略時はその上限なし）。run-goalではGoal全体で1つの予算を共有し、個別unitRequests内へのbudget指定は拒否する。実装・修復・独立レビュー・全体レビューの起動を数え、失敗した起動も返却しない。別のrun/Issueの拒否へ波及させない。

起動回数上限は新規Agent起動を拒否する。既に起動した処理、検証、レビュー済みのDeliveryを起動回数到達だけで取り消さない。時間上限は次の作業・Agent起動・Agent応答後・Goal統合の境界で停止する。Agentへは残り時間（最大360秒）を渡し、隔離preflightに使った時間を差し引いてモデル子プロセスの待機期限を設定する。preflight中に使い切った場合はモデルを起動しない。検証コマンドにもsnapshot準備後の残り時間（既定最大25秒、明示したverificationLimitsでも残予算以下）を渡す。通常・browser-cgroup両方に適用し、複数コマンドでは毎回残り時間を再計算する。ただしpreflight・snapshot準備・cgroup起動/後片付け・外部CI呼出しまで一括で強制終了する厳密な全体deadlineではなく、それらのtimeoutは別に存在する。失敗時もGit候補と診断は保持するが、未検証・未レビューの出力を提出しない。

結果の`budget`は当該実行の観測であり、承認や再開権限ではない。新しい実行では予算も新規になるため、複数実行にまたがる累積費用を制限したことにはならない。料金・tokens上限ではなく、Provider内部起動の数を保証するものでもない。継続/増枠はowner入力を更新し、有効なGit状態から再実行する。自動再試行で予算をリセットしない。

実装中に未確定のowner判断が判明した場合、workerは`{"status":"needs-owner","questions":["具体的な質問"]}`を返せる。Controllerは今回のworker出力をGitへ反映せず、`owner-work-required`と質問を返して停止する。snapshotは診断用に保持し、回答を新しいowner要求へ反映して再開する。repair前に存在した候補commitは保持するため、`candidateApplied:false`は今回出力の未反映のみを表す。質問やsnapshotは承認・検証Evidenceではない。通常の実装要約は引き続き承認として扱わない。

Source observation supports at most 10,000 regular Git files and 64,000,000 total source bytes and 12,000,000 bytes per file. These are bounded-resource limits, not a risk classification. Symlinks, submodules, unsafe paths and case aliases remain refused. Host-pinned dependencies use the separate verification-assets contract. This does not yet establish arbitrary large-repository support.

## 評価配布物の更新・差し戻し

信頼するhost管理のprefixをcandidate worktree外に用意し、固定したlocal tarballをnpmで導入する。例: `npm install --prefix <host-prefix> --offline --ignore-scripts --no-audit --no-fund --save-exact <tarball>`。入口は`<host-prefix>/node_modules/.bin/asc-v05`。Nodeはhostが用意する。更新も同じコマンドで新tarballを指定し、差し戻しでは保持した旧tarballを指定する。package.jsonとlockfileはnpmが更新するため、旧tarballとそのhashを保持する。全世界へのglobal installやcandidate側からの自己更新は行わない。

`NODE_PACKAGE_UPGRADE_EVIDENCE.json`ではLinuxの同一prefixで2つのprivate alpha snapshotを往復し、配布37fileの一覧とbytes、npmのCLI入口、利用者file保持を確認した。公開registry、他OS、v0.4のpolicy/Skill/CI変換、実行中プロセスのhot upgradeは対象外。既存プロセス終了後に切り替え、新しい実行では現在のContractとEvidenceを再確認する。これによって旧版のレビューや承認が新しい変更に引き継がれるわけではない。

### Agentの寿命管理

Providerは呼出しごとの一時user serviceで起動し、Controller専有pipeの切断・期限超過・終了時に同じcgroupの子孫を停止する。常駐ASC daemonやsession共通lockは作らない。Agentのファイル・通信権限は別のCodex sandboxで強制し、user service自体を隔離の証拠とは扱わない。user manager不在や停止未確認では安全停止し、process groupだけの方式へ退避しない。終了確認には最大3回×5秒の制御処理が追加され得るため、設定deadlineは後片付け込みの厳密なwall time上限ではない。

### ブラウザ向け検証資源（Linux限定・明示選択）

所有者のContractに `"verificationResourceProfile": "browser-cgroup-v1"` を指定すると、各検証コマンドを別のsystemd user一時サービスで実行する。既定の検証経路は変更しない。Linuxのuser service/cgroup v2が利用できなければ停止し、通常経路へ自動退避しない。Work UnitとGoalは同じプロファイルを使用する。

既定上限は実メモリ1 GiB、swapなし、256タスク、仮想アドレス8 TiB、既定1ファイル8 MiB（通常プロファイルは1 MiB）。既存のnamespace・通信・ファイル・環境変数隔離、既定25秒command timeout、CPU・出力制限は維持する。大きな仮想アドレス予約を必要とするChrome向けであり、8 TiBの実メモリ使用を許すものではない。必要なブラウザ/runtimeは従来どおりownerがdigestで固定する。

実効command期限の時間超過は`executionError: ETIMEDOUT`と失敗終了値125で記録する。子プロセス消滅を確認できない場合は記録済み失敗への変換もせず停止する。

コマンドが0で終了しても、実行区間のOOM、メモリ上限到達、タスク上限拒否を検出したら不合格にする。各回の固有cgroupで記録するため、前の検証や別worktreeの拒否を引き継がない。終了時の子プロセス消滅、制限・identity、service停止とcgroup削除を確認できない場合も合格にしない。候補へcgroup管理・service manager socketは公開しない。管理者によるHost設定の一時変更まで防ぐ保証ではなく、Host管理者は信頼境界に含む。

この追加経路は静的ブラウザ描画と資源超過反例を検証中であり、UI/API/DB全体の受入合格や対応OS拡大を意味しない。関連実検証は `ASC_TEST_CGROUP=1 npm test` で明示実行する。未指定時の該当skipは隔離合格と扱わない。

既にownerが作成した候補の検証・独立レビューだけを実行するには、
`asc-v05 review /absolute/owner-request.json`を使用する。入力形式とworktree検査は`run`と共通。
GitHubの要求を読み直す代わりに、候補外に置かれたowner要求の読込時点のContractを基準とする。
成功は`reviewed-candidate`であり、PR/CI成功や提出権限を意味しない。
実装・修復・push・Deliveryは実行しない。候補差分がない、検証失敗、レビュー指摘がある場合は停止する。
owner作成済みの`.agents`/`.codex`変更も対象にできるが、Reviewerへ有効な設定として配置しない。
隔離検証と、必要な場合にownerが指定した承認commandは実行される。

実行中の失敗では、Controllerが診断を生成できた場合、そのJSONをstdoutへ返す。
stderrのエラーと終了コード1は維持する。`status: blocked`は成功ではない。
呼出し側は終了コードとstatusの両方を確認し、失敗した検証・Agent起動・観測usageを保存する。
入力検査などController開始前の失敗では構造化診断がない場合もあり、欠測をゼロと扱わない。

LinuxのProvider subprocessと隔離preflightの寿命管理は、上記「Agentの寿命管理」の呼出しごとのsystemd user service・cgroupとController専有pipeを使用する。Toolのfilesystem/network隔離は別のCodex profileが担当する。途中終了時のsnapshot・ログは残り得る。次の実行はGitの実状態から検証・独立レビューをやり直し、未完成ログを承認として使わない。

OwnerはContractの`verificationLimits`で検証の有限予算を指定できる。`timeoutMilliseconds`は既定25000・最大300000、`cpuSeconds`は既定15・最大300、`fileBytes`は通常既定1048576（browser profileは8388608）・最大64000000。指定する各値は正の安全整数で、未知key・null・無制限指定を拒否する。Agentの出力・source容量・stdout上限・cgroupのpids・通信権限は変更しない。CPUはprocess単位、fileBytesは生成する単一fileの上限で、合計disk消費を保証するものではない。

検証設定はContract digestへ拘束し、変更後は以前のEvidenceを再利用しない。Goalの各Unitは親と同じverificationLimitsを継承する。実効timeoutはowner値と現在の残予算の小さい方。cgroupは実効timeoutに起動・観測猶予5秒、observerは10秒を加え、失敗時も固有unitをcleanupする。既定値を無断で拡大せず、実projectのbuild/full検証に必要な場合だけownerが明示する。

`verificationLimits.memoryBytes`は既定1GiB。明示指定は64MiB〜4GiBの1MiB単位に限定し、`verificationResourceProfile: "browser-cgroup-v1"`を必須とする。プロファイル名は互換性のため維持するが、buildやLintにも同じcgroup境界を使用できる。通常経路で指定を無視して続行しない。workerは実行前後の`memory.max`をowner値と照合し、swapなし・256タスク・固有unitのcleanupを維持する。メモリ上限到達・OOM・cleanup未確認は不合格。設定変更はContract digestに含まれ、各Unitが親より勝手に増枠することはできない。

低水準の`Controller` APIでは仮想アドレス上限1GiBも独立して適用される。memoryBytesは実cgroup上限であり、この別上限を引き上げる指定ではない。通常CLIの`AssetController`とbrowser-cgroup profileは既存の仮想アドレス上限8TiBを使う。実メモリ4GiB指定が、すべてのAPI経路で単一processに4GiB確保可能という意味ではない。

memoryBytesは検証unitごとの上限であり、Goal全体の合計上限ではない。並列検証では各unitの予算が同時に使用され得るため、ownerは並列数と合わせてHost容量に収まる値を指定する。セッション全体を予約・拒否する新しい共有状態は導入しない。

### Existing tests that inspect Git

An owner may explicitly set `contract.verificationGit: "shallow-head"` when existing verification commands require `git ls-files`, `git show HEAD:...` or the exact target commit. The default exports source files without Git metadata. The selected mode is bound into the contract and must match across Goal units.

This option reconstructs only the target commit, its trees/blobs and an index in a disposable directory. It does not copy the source Git directory, remotes, local/global configuration, hooks, credentials, branches or tags. The generated `.git` is read-only in verification. Exact commit identity preserves the commit's own author, message and signature metadata; those are not redacted. Parent history is unavailable (shallow, detached HEAD). Commands requiring historical comparisons, branch identity or index writes need a different explicit verification contract; this is not a full repository clone. Existing network/filesystem/process restrictions remain active.

### Hostに残る生成物

Gitの無視対象である未追跡の生成物はHostに保持し、Agent・検証snapshotには転送しません。snapshotはcommitのblobから生成します。除外したディレクトリ内部は読み取り検査しないため、内部のsymlinkや特殊ファイルを個別に拒否したという保証ではありません。対象と許可された変更範囲が一致・親子関係にある場合は上書きを防ぐため停止します。通常の未追跡ファイル、tracked内容やindexの変更は引き続き停止対象です。

### 仕様書の雛形

既存書式がない場合は[任意の仕様書テンプレート](templates/specs/00_利用案内.md)から必要な内容だけ選ぶ。要求・要件・基本設計・詳細設計・画面・検証運用の雛形を配布するが、全種類の生成やAgentへの一括読込みは行わない。既存文書とプロジェクト規約を優先する。
