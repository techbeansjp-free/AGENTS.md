# v0.4.xからv0.5.0への移行契約（評価実装・正式切替未完了）

この文書は実行済みの移行Evidenceではない。v0.5.0の配布形式・対応環境を確定し、dummyでの往復試験は後述の範囲で完了したが、正式対応環境・本番切替の受入までは既存projectへ適用しない。

## 保持するもの

利用者所有の要求、仕様、Gherkin、テスト、project policy、ドメイン知識、Git履歴は保持する。利用者が変更した旧設定を製品既定値と区別せず自動削除しない。旧版の実装・Step・Hook・テンプレートをv0.5へ同梱する必要はなく、旧タグまたは固定版の配布物から再導入する。過去のJournal・Seal・レビュー記録はv0.5の移行対象・配布対象・保存必須データに含めない。旧記録の専用保管・変換・復元機構は設けず、rollbackの前提にもしない。既存Git履歴を改変して消去する必要はないが、新版の運用では旧記録を使用しない。v0.5の変更に必要な検証・独立レビューは、新しい要求と対象差分に対して成立させる。

## テストの継承と契約変更

v0.4のテスト全件をv0.5製品のrelease gateとして継承するわけではない。権限・変更範囲・独立レビュー・Evidence有効性など、防ぐべき失敗を引き継ぐ。廃止したStep列、専用Worker、SealやJournalの形式だけを要求するテストは、新しい保証の検証へ置換するか、旧製品の保守用に残す。

利用者プロジェクトが所有する必須テスト・Lint等は別であり、ASCの都合で削除・skip・成功扱いしない。移行で意図的に変更する実行契約とテストが衝突する場合は、その非互換と変更するアサーションを明示し、権限ある移行判断に基づいて更新する。実装Agentが失敗を消すために判定基準を変更してはならない。

隔離評価の`evaluation/adapt-legacy-entry-test.mjs`は、この区別を検証する限定fixture変換である。既知の旧入口アサーションをhashで固定し、その区間だけをGoal・許可範囲・利用者規約・独立レビュー等の入口契約へ置換する。他の旧製品アサーションは維持し、未知の変更を検出したら停止する。これは一般プロジェクトのテストを自動変換する製品機能ではない。文面の検査だけでは実行時の保証は証明できず、隔離・レビュー・実テストの別のEvidenceが必要である。

## 非破壊移行

1. dry-runで旧version、起動入口、利用者/製品所有path、active workflow、policy schema、Git状態を読取り、非互換を列挙する。Unknownは停止する。
2. 進行中の旧Workflowは旧版で完了するか、明示的に中断して新しい要求として開始する。途中の承認を新方式へ持ち込まない。
3. 元projectを変更しない独立worktreeにv0.5配布物を固定し、ownerが許可した検証コマンドと権限・提出先を確認する。projectの設定に自己承認させない。
4. 小規模変更・高risk変更・失敗再開をdummyで検証し、旧版との差分と残る制約を提示する。
5. 正式な切替は必要な承認と受入成立後。元の版・設定・起動入口を復元できる状態を残す。

## Rollback

ASC本体は、利用していた正確な旧versionの配布物を再インストールするか、保持している固定CLIを再選択する。v0.5内に旧実行系を残すことは切戻しの条件ではない。プロジェクトの設定を変更していなければ、設定復元は不要である。変更していれば、その設定commitだけをGitでrevertし、競合は解決してから進める。再インストールだけでは利用者が変更した設定は復元されない。v0.5が実装したsource変更を無条件にresetせず、成果物はGit branchに保持する。旧版の品質判断を新しいHEADに流用せず、旧版が必要とする検証を実行する。失敗した移行でも利用者file・未commit変更が不変であることをtestで確認する。

## リリースまでの必須試験

- 既存projectがdirty、symlink、未対応policy、進行中Workflowの場合の安全停止。
- dry-runの無変更性、途中中断、再試行、版の往復、管理fileと利用者fileの所有境界。
- 配布物だけからのCLI起動・検証・独立review・Draft/CI。
- v0.4の証拠をコピーしてもv0.5の承認にならないこと。
- 文書だけでなく実行可能なmigration/rollbackのEvidence。

Python prototypeを正式なNode配布物の代替として導入しない。v0.5.0の現在の受入対象はowner指定のnative Linuxで、Node.js >=20のCLI配布を維持する。必要なLinux隔離・実行依存はUSAGE.mdに従う。macOS・Windows・WSL2は今回の正式実行対象に含めず、旧版のOS対応を自動継承したとは扱わない。

## 読取り専用入口（実装済み）

`node migration_inspect.mjs <project-root>` は既存policy・Git HEAD・要求/仕様/feature fileのdigestと変更状態を調べる。Git filterやproject scriptを実行しない。元projectには書き込まない。未知policy、未commit変更、扱えないfile、runtimeの存在を報告する。runtime存在は保守的な停止条件であり全てが稼働中Workflowだとは判定しない。検査だけでは切替の承認・検証は成立しないため、結果は常にreadyToMigrate=false。診断コード`migration-execution-not-performed`は、この読取り専用操作が移行を実行していないことを示す。旧コード`migration-and-rollback-not-implemented`から名称を変更したが、承認や安全条件の解除ではない。prepareはこの診断だけを、明示的な設定計画を受け取るstageはこれと`manifest-policy-cutover-required`を許容し、dirty・未対応file・未解決policy等は引き続き拒否する。owner指定のCLI・Skill・Hook・CI設定候補は後述のmigration-stageで作成・検分できる。評価workspaceの準備・rollback選択は末尾のNode評価実装を参照。旧Evidenceは承認へ昇格しない。Node20/24とLinux/macOS/WindowsのCIへ追加した。

2026-10-14: 移行調査だけのNode20/24 × Ubuntu/macOS/Windowsの6ジョブはすべて成功した（commit f5d1bc2、run 38504444052）。これはAgent実行・sandbox・正式配布全体の3OS対応を意味しない。


## Node評価実装：準備とrollback選択

`asc-v05 migration-prepare <legacy-root> <new-location>` は検査を通った旧projectを独立cloneへ複製する。選択branchから到達可能なGit履歴と利用者fileを保持する。他branch固有の履歴・参照は新cloneへの保持対象外で、元repoには残る。sourceのhook/filterをcheckout時に実行せず、固定blobを取り出す。upload-pack hookの実行を無効にする反例テストもある。

進行中runtime・dirty・未知policyなどは事前停止。新しい制御metadataはcandidate外へ置き、旧Evidenceを有効承認へ変換しない。destinationの既存fileを上書きしない。準備完了後の再試行ではcandidateの編集を保持する。途中停止したdestinationは保全して拒否し、新しいdestinationで再試行できる。未完了cloneを自動削除して成功扱いしない。

`asc-v05 migration-rollback <new-location>` は選択をlegacyへ戻す。v0.5候補のsource編集を削除せず、旧repoもresetしない。旧版の承認を復元したとは扱わず、旧版での再検証を要求する。

これは評価workspaceの準備・entry選択の往復であり、既存projectの全CLI・Skill・CI設定をv0.5正式版へ切り替える移行の完成ではない。releaseReady=falseを維持する。dummyで3テスト（clone/往復/中断/既存編集保持/Git hook非実行）が成功。元利用者projectへはまだ適用していない。


旧 `.codex` / `.agents` は元projectと移行candidateのGitに保持するが、v0.5 fresh Agentへは配置しない。これらを変更許可pathに含めた実行は停止し、owner管理の移行として扱う。旧設定を削除したり、新方式のauthorityへ昇格させたりしない。prepare→新Workflow→rollbackを実Git・実隔離検証で接続する回帰試験を追加した。この結合試験のAgentとGitHubはtest doubleであり、実モデル移行試験の代替とはしない。

実モデルを使った配布CLIのprepare→run→Draft/CI→rollbackも `NODE_MIGRATION_CLI_EVIDENCE.json` に記録した。2 fresh Agentで完走し、元HEAD・元file・clean状態を保持、rollback後も新candidateの変更を保持した。固定legacy fixtureの結果であり、本番の全管理資産・CI移行を証明するものではない。

## 設定形式と切替対象の棚卸し

実旧版のinstall直後でproject設定がまだ作成されていない場合、検査は`missing-project-policy`を返し、既存CLI・Skill等の棚卸しを保持する。policyの既定値を推測せず、prepare/stageは停止する。ownerがプロジェクト契約を確定するまでは移行可能と扱わない。

移行検査は最外層のschemaで形式を判定する。未知wrapperの内側に既知policy版が書かれていても受理しない。現行の`project-policy-manifest/v1`は参照先と設定hashを棚卸しできる。自動の意味変換は行わず、`manifest-policy-cutover-required`でmigration-prepareを止める。ownerが全設定のretain/replaceを指定したmigration-stageは、この形式にも対応する。参照規約を新ContractのpolicyRefsへ対応させ、実コマンドによる検証と新しい独立レビューを行う。既知schemaやretain指定だけでは正式移行可とはしない。

`configurationInventory`はCLI依存file、Agent入口、CI、project policyのGit上のhashと、ownerによる切替確認が必要なことを返す。秘密や設定内容を出力せず、コマンド・Skill・CIを実行しない。参照はGit管理されたproject配下のJSONだけを候補とし、未解決参照を別に報告する。これは詳細schema検証や新しい権限の生成ではない。

prepareの再試行はHEADだけでなく元projectのindex・作業file・runtime状態を再検査する。元projectが未commit変更された場合は停止し、元fileと移行候補の編集をどちらも保存する。

利用者規約の引継ぎ先として、新Contractはownerが選択した`policyRefs`を持てる。現在Gitの内容hashを固定し、既存の実装・reviewへ渡す。legacy規約・Step文書を自動承認したり、host権限へ昇格させたりしない。全設定を自動変換する機構は提供しない。後述のdummyではowner指定の設定切替と通常開発を実証しているが、任意の利用者設定への適合とremote CIは別途確認が必要である。


## Owner指定の設定切替候補（本番適用ではない）

`asc-v05 migration-stage <旧project> <新しい保存先> <外部owner-plan.json>` は、設定の置換を新しい独立cloneにだけ準備する。旧project・グローバルCLI・Skillの登録先・GitHub設定は変更しない。計画は`schema: asc-v05-cutover/v1`、`sourceHead`、`files`を持ち、検査の`configurationInventory`全件に`path`、`beforeSha256`、`action: retain | replace`を指定する。replaceにはUTF-8の`content`を付ける。未列挙・重複・未知path・古いhash・HEADを拒否する。新規fileの追加と削除はこの入口の対象外。

manifest形式でもownerの明示的な全設定判断を受け取れるが、自動的なpolicy翻訳は行わない。設定・package script・Skill・CIは実行しない。候補は未commitの差分であり、独立レビューと新しい検証が必要。実行可能な設定へ変更しただけで検証・承認を得たとは扱わない。rollbackは元projectを選択し直し、候補の設定と追加編集を保存する。途中失敗はpreparingのまま保存し、自動rollback成功を返さない。

owner規約参照を既存2 Agentへ渡した実モデル試験は`NODE_OWNER_POLICY_EVIDENCE.json`に記録した。Draft PR76/CI、87.96秒、観測151,555処理tokens。新しい規約付きbaseの単発試行であり、旧方式との性能比較や本番移行の実証ではない。

配布CLIの別clone準備→設定置換→rollbackは`NODE_CONFIG_CUTOVER_EVIDENCE.json`に記録した。現行形式から抽出した31設定のうちAGENTS.mdとpackage.jsonだけを置換し、CIはowner判断で保持した。元project不変、候補の追加編集保持を確認した。CIのv0.5変換・本番入口の切替はこの試験の対象外。


設定切替後の実開発・Draft/CI・rollbackを`NODE_CONFIGURATION_MIGRATION_LIVE_EVIDENCE.json`に追加した。dummyのCLI/Agent案内とCI設定をownerが別cloneへ適用し、既存safety/fixtureに設定hash検証を加えた。初回はGitHub観測timeoutで170.56秒後に停止、再開1回目もIssue読取りtimeoutで30.84秒後に停止した。再開2回目は同じ候補にfresh検証・独立reviewを実施し、既存Draft18/CIを確認、rollbackした（30.73秒）。旧project・設定hash・新実装の保持を確認。各区間に準備・手動調査の時間は含まれず、短縮率は主張しない。

この試験はmanifestの意味変換、npm script入口の実行、設定変更そのものの独立レビュー、グローバルSkill導入を証明しない。設定はownerの新baseであり、後続の独立reviewは実装差分を対象とする。本番移行受入は未完了。


複数worktreeの状態分離を`test_migration.mjs`で検証した。cleanな対象Issueを移行・rollbackする際、同じGit repositoryの別Issueにdirtyなfile・未追跡file・runtimeが存在しても、その存在だけでは対象を拒否しない。別Issueの内容・HEAD・statusとworktree登録一覧、元mainのHEAD、移行候補の追加編集を保持した。関連22試験成功。これは静止したdummyの状態分離であり、同時書込み競合や本番CLI/Skill/CI切替の証明ではない。

配布CLIのnpm script入口は`evaluation/check-migration-npm-entry.mjs`で追加検証した。
owner指定のpackage.json変更を独立cloneへstageし、固定したオフライン配布物と
npm/runtimeを読み取り専用で隔離環境へ渡す。実際の`npm run asc`でCLIを起動し、
`npm test`でアプリの既存動作と新CLIのcapabilitiesを確認した。rollback後も元projectは
不変で候補設定を保持した。結果は`NODE_CONFIG_CUTOVER_EVIDENCE.json`に記録。
これはLinux dummyの入口接続であり、設定変更自体の意味的独立レビュー、manifest変換、
グローバル導入、実Agent・remote CIを証明しない。正式移行受入は未完了。

同じdriverの`--review`では、設定変更commitを基点差分・Contract・実検証結果に拘束して
freshな読み取り専用Codexへ渡す。今回のdummy package.json差分は指摘なしで通過し、
その後のrollbackでも元projectと候補を保持した（`NODE_CONFIG_CUTOVER_EVIDENCE.json`
の`npmEntrypointIndependentReview`）。これはこの1件の設定変更の独立レビューであり、
manifest全体の意味変換や本番移行の合格へ拡張しない。モデル通信以外の提出は行っていない。

`npmFailureAndSingleVerification`に、壊れたnpm入口の失敗系も記録した。
未対応CLIコマンドは隔離検証で停止し、Reviewerを起動せず、rollback後も元projectと
候補設定を保持した。正常設定は実Reviewerまで到達した。評価driverの重複検証を除去し、
各試行の正式検証は1回。実モデルの正常系は33.38秒・1 Reviewerだが、単発試行のため
以前の値から速度改善率を算出しない。manifest全体・他OS・remote CIの受入は未完了。

正本の`.agent-skill-chain/skills/`と`.agent-skill-chain/hooks/`も、
設定棚卸しの`agent-entry`として扱う。入口の`.agents/`だけを確認して、
旧Step指示やHookを切替判断から取りこぼさないためである。
stageではこれらにもownerの明示的なretain/replace判断を要求し、内容を実行しない。
保持を選んだことは、v0.5でそのSkillやHookが有効・適合済みという意味ではない。

移行metadataは保存・再読込みの両方で同じ16MiB未満の上限を適用する。
以前は保存側にない64KiB制限が読取側にだけあり、受理した多数設定の切替後に
rollbackできない場合があった。240 Skill設定を含むdummyで往復と繰り返しrollback、
候補側の追加編集保持を検証した。これは無制限の設定数を保証するものではない。
上限を超えたmetadataは読み込まず、候補の成果物も削除しない。

ownerが既に作成した設定差分は、Node APIの`runWorkflow`に
`reviewOnly: true`を渡して検証・独立レビューできる。このモードはsubmitを無効化し、
実装・修復Agentを起動しない。差分がない場合、検証失敗、レビュー指摘では停止する。
`.agents` / `.codex`はfresh Reviewerの実ディレクトリへ配置せず、許可範囲内の
現在の内容だけをレビューmetadataへデータとして渡す。通常の実装経路の書込禁止は維持する。
隔離検証と必要なowner承認commandは実行されるため、全処理が読取り専用という意味ではない。
これはowner-managed migrationの設定検分用APIであり、グローバルSkill登録や本番切替を行わない。

`evaluation/check-migration-npm-entry.mjs --configuration-suite --review --packaged-review`
は、manifestと参照する利用者規約を保持し、npm入口、AGENTS、入口Skill、正本Skill、
明示実行Hook、CI設定を同じowner計画で切り替えるdummy試験である。
規約・アプリ仕様はhash付きpolicyRefsとして独立Reviewerへ渡す。
Hookは暗黙に登録せず、固定した配布パッケージ入口を使って隔離検証で明示実行する。
CIのアプリ検証コマンドはローカルでも実行するが、YAMLをGitHub上で実行した証拠とはしない。
旧manifestを保持することは自動的な意味変換ではなく、この試験ではownerが明示した規約を
新Contractへ対応させる。グローバル登録・本番切替・全利用者設定の互換性は別途受入が必要。

`evaluation/check-migration-local-install.mjs <configuration-suiteのevidence.json>`
は、その検証済みdummy候補から別cloneを作り、固定tarballを`vendor/`に同梱して
project-local依存として導入する。新clone・空npm cacheで`npm ci --offline --ignore-scripts`
を実行し、CLI入口・アプリCIコマンド・明示Hookが動作することを確認する。
元project・設定・規約は保持し、package/lockと同梱tarballだけをdummyに記録する。
変更後のpackage/lockへ以前の独立レビューを流用しない。これは配布経路の検証であり、
registry公開、署名検証、グローバル導入、remote CI、移行先差分の新レビューは別途必要である。

## 正式名の非公開候補パッケージ

`node scripts/pack-candidate.mjs <既存の絶対出力directory>` は、npmの配布対象だけを
一時directoryへコピーし、`agent-skill-chain`名のv0.5 prerelease tarballを生成する。
`agent-skill-chain`と`asc-v05`は同じ新CLIへの入口であり、旧`workflow advance`等を
新方式へ暗黙変換しない。旧コマンドを使うscriptはownerが明示的に更新する。
評価パッケージ自体や既存グローバルインストールは変更しない。

候補は`private: true`、`releaseReady: false`を維持し、公開承認を意味しない。
`release-identity.json`のv2では、`sourceFiles`は変換しない配布fileのhash、
`sourceManifestSha256`は変換前のpackage.json、`distributionManifestSha256`は配布用package.jsonのhashを記録する。これらは署名や独立した
信頼の根拠ではない。同名tarballを上書きしない。承認された候補を別prefixへ
`npm install --offline --ignore-scripts <tarball>`で導入して検証する。
この生成経路はregistry公開・署名・正式release・旧CLIの完全互換を実装しない。

移行中断の回帰試験では、prepare/stageの実clone・export・設定置換後、`prepared` metadata確定直前にSIGTERM/SIGKILLを送る。未完成の保存先は`preparing`のまま保持し、同じ保存先の上書きとrollback成功扱いを拒否する。元projectを確認し、新しい保存先で再試行できる。これはGit操作の任意の途中や電源断の耐久性を保証するものではない。

`evaluation/check-representative-migration.mjs <source絶対path> <固定HEAD>`は、既存projectのtracked内容を独立cloneへコピーし、全設定のretain判断とpackage.jsonの追加入口`asc:v05`だけをstageする。既存script・Hook・Skill・規約を置換せず、外部prefixの固定候補packageをOS隔離されたnpm実行へ供給する。capabilitiesのschemaと非release・非legacy fallbackを検証後、rollbackで候補と元projectを保持する。元project観測にはclean filterを呼び得る`git status`を使わず、Git object・index列・nofollow読取りの内容を照合する。これは段階導入の評価であり、旧Workflowからの全面切替、既存アプリ全検証、remote CI、未追跡runtimeの移行は実施しない。元projectにdirty tracked内容があれば試験を拒否する。

実projectのbuild検証では、最初の隔離用runtimeにnpm実行入口がなく、修正後は既定1MiBの生成file上限で`dist/vendor/typescript.cjs`のcopyが`EFBIG`になった。前者は試験資産の不備、後者は必要なbuildを妨げる製品上限として別々に記録した。新しい固定runtimeとowner指定の`verificationLimits`（file 12,000,000 bytes・command 120,000ms・CPU 90秒）、既存cgroup profileで実buildが成功した。元projectや既定上限は変更していない。`NODE_CONFIG_CUTOVER_EVIDENCE.json.representativeBuildVerification`を参照。この結果だけで全品質commandや移行後通常開発の受入を完了とはしない。

既存Lintは同じsource・依存物で1GiBと2GiBのcgroup上限に達してOOMとなり、ownerが明示した4GiBで成功した。既定1GiBは維持する。必要な資源を無制限にするのではなく、固定した有限予算・実kernel値・資源超過counter・cleanupをEvidenceへ残す。`representativeBuildVerification.memoryBudget`に失敗と成功を分離して保存した。これは予算をAIが自動拡張する許可ではない。

### Existing tests that inspect Git

An owner may explicitly set `contract.verificationGit: "shallow-head"` when existing verification commands require `git ls-files`, `git show HEAD:...` or the exact target commit. The default exports source files without Git metadata. The selected mode is bound into the contract and must match across Goal units.

This option reconstructs only the target commit, its trees/blobs and an index in a disposable directory. It does not copy the source Git directory, remotes, local/global configuration, hooks, credentials, branches or tags. The generated `.git` is read-only in verification. Exact commit identity preserves the commit's own author, message and signature metadata; those are not redacted. Parent history is unavailable (shallow, detached HEAD). Commands requiring historical comparisons, branch identity or index writes need a different explicit verification contract; this is not a full repository clone. Existing network/filesystem/process restrictions remain active.

代表projectの配布CLI入口も`evaluation/check-client-distribution-cli.mjs`で確認した。
compile/buildせず、隔離コピー内に20万件の入力イベントを生成して、
`dist/bin/agent-skill-chain.js workflow metrics`の実出力を検証する。
修正済み配布物は成功し、隔離コピー内のmetrics配布ファイルだけを既知の旧版へ戻すと元のスタック超過を検出した。
元の移行候補のHEAD・statusは不変。最初のfixture記録不足による失敗もEvidenceへ保持した。
`NODE_CONFIG_CUTOVER_EVIDENCE.json.representativeDistributionCliRegression`を参照。
これは配布CLIの当該回帰を埋める検証であり、移行全体・remote CI・正式releaseの合格ではない。

正式名候補の更新・rollbackは、`node evaluation/check-package-upgrade.mjs 1a48804 --canonical`
でも検証できる。固定commitから候補tarballを作り、同じ一時consumerへ旧候補→新候補→旧候補を
オフライン導入する。全配布fileの内容、両CLI入口、manifest identity、利用者file保持を確認する。
破損tarballの導入は実際のarchiveエラーで拒否され、既知の配布file内容・package.json・lockfileを保持した。後続のconsumerTreeFailureTrialでは、破損導入直後のconsumer全56項目について追加・削除、内容、type、mode、2つのbin symlinkの参照先が不変と確認した。timestamp/inode、consumer外のnpm cache/log、任意の中断点の原子性は対象外。
`NODE_PACKAGE_UPGRADE_EVIDENCE.json.canonicalNameTrial`に記録した。これはLinux上の
非公開v0.5候補間の往復であり、v0.4の意味的移行・registry公開・他OSの保証ではない。

正式version番号での候補確認は`node scripts/pack-candidate.mjs <出力directory> --version=0.5.0`で行える。省略時は評価版のversionを維持する。番号指定は公開承認ではなく、生成物は引き続きprivate・unapproved-candidateである。source manifestと変換後manifestのhashを両方保存し、既存インストールを変更せず別consumerへ導入する。registry公開・tag・releaseは実行しない。


## 配布とプロジェクト切替の境界

本体repository rootの標準packageはv0.5へ切り替え済みで、通常の`npm pack`もrootの`src/`・`bin/`・`skills/`にある新実装と選択された文書・移行入口を`agent-skill-chain`として配布対象にする。旧実装のversion番号だけを変更する方式ではない。`agent-skill-chain`と`asc-v05`は同じv0.5 CLIを指す。旧CLIのStep command互換は提供しない。現在のtarballは未承認候補で、生成・offline install・動作成功だけでは公開可能にならない。

導入先は候補repositoryの外にある専用prefixとし、実行時はその固定CLIの絶対pathを用いる。global PATHや既存のv0.4インストールを上書きしない。project側は専用worktreeで、新しいowner requestに要求・許可範囲・規約参照・検証方法・Delivery先を明示する。旧Step用SkillやHookが残っていることを、新Controllerがそれらを実行・承認した根拠にはしない。

プロジェクト設定を変える必要がある場合だけ、`migration-stage`で全設定の保持／置換をownerが指定し、その差分を通常のGitレビューと検証にかける。stageは設定変更を承認・commit・mergeしない。既存のGitレビューで足りる範囲に別のactivate daemonや全セッション共通の切替状態は追加しない。進行中の旧Issueは旧入口、新Issueは新入口という併用時も、実行対象worktreeとContractを分ける。

切戻しは旧版の固定CLIを再選択することと、必要ならレビュー済みの設定差分をGitで戻すことを分ける。`migration-rollback`は保存先の選択記録を戻すだけで、source・設定commit・利用者の作業をresetしない。設定差分のrevertはownerが対象と影響を確認し、旧版で必要な再検証を行う。候補の成果はbranchに保持する。

この境界は導入手順の定義であり、任意の既存projectでの全面切替を実証した宣言ではない。Linuxの配布CLI実走、設定候補、通常開発、利用者成果保持、選択rollbackの証拠と、未検証の本番設定切戻しを区別する。正式な公開・tag・releaseは別の承認操作として残す。

## 本体CI契約の切替（未完了）

本体repositoryの`scripts/quality-support/`や旧形式のpolicy資産は、既存CI契約への対応用である。利用者データでも、製品のrollback用データでもなく、v0.5配布物には含めない。CI契約の切替とは別に、利用者の設定保護を理由としてこれらを恒久保持しない。

PR #1578のbase `2d64b8d50b173f29914a8f231c0c5efa9a7e0af5` は、v0.4のscript文字列・qualityContractVersion・保護fileのhashを検査する。この検査は新版の標準入口への置換を拒否する。candidate内のvalidatorを変更しても、baseから実行する検査の結果は変わらない。新版のLinux CI成功と、このbase検査の失敗は別々に報告する。

切替レビューでは、旧Step専用コマンドを新版に復活させて通過させない。リポジトリのCI設定変更を事前承認する世代番号は、製品のStep実行とは別の契約として扱う。必要な保証は、検査の自己緩和を独立して確認すること、権限を持つ実行で候補codeを動かさないこと、新版の実テスト・隔離試験を実行すること、提出commitを固定することである。旧Cucumber全件実行そのものは新版の受入条件にしない。

実施順は、(1) repository ownerが新版CIの保護対象・必須checkと移行差分をレビュー、(2) base側の検査契約を先に更新、(3) 同じ候補HEADでbase検査とLinux CIを再実行、(4) 実結果に基づいてrelease readinessを更新、とする。既存の保護変更承認はbaseへの事前登録を要求するため、candidateだけの登録を承認成立と扱わない。baseへのmerge・branch保護の変更・失敗checkの免除は本実装作業では実行しない。必要なowner操作が未実施の間、全CI成功・正式release可能とは報告しない。

## 旧入口の除去・新入口の追加と設定の復元

`migration-stage`は既存inventoryのretain/replaceを扱い、新規file追加・旧file削除は扱わない。この場合は、flat policyなら`migration-prepare`、manifest型policyなら全inventoryのretain/replaceをownerが指定した`migration-stage`で独立cloneを作る。その作業branchで、ownerが指定した追加・削除を通常のGit変更として作る。manifest型を`migration-prepare`で強行しない。旧Step用登録を除去し、新Skill登録は配布済み`skills/asc/SKILL.md`とCLIの固定pathへの案内にする。配布Skill本文を登録先へそのままコピーすると相対linkの基準が変わるため、行わない。利用者固有のAGENTS規約・permissions・無関係なHookは残す。設定差分をアプリ変更とは別commitにし、その内容の独立レビューと必要なHost設定検証を経て選択する。

設定の復元は`git revert <設定切替commit>`で行い、後続のアプリcommitをresetしない。設定が競合すれば停止してownerが解決し、無条件のours/theirs選択や強制復元は行わない。操作を取り消す場合はrevertをabortする。`migration-rollback`はこの設定復元を代行せず、入口の選択記録だけを戻す。旧版の承認Evidenceも復活しない。

`node evaluation/configuration-roundtrip.mjs <導入済みagent-skill-chain packageの絶対path> [flat|manifest]`で合成fixtureの実証を再現できる。省略時はmanifest型を使い、通常のroot配布テストからは両形式を検証する。検証範囲は、配布CLIのprepareまたはstage／rollback、新旧Skill登録の追加・削除、規約・権限・他Hookの保持、後続アプリ変更を残した設定revert、競合停止・abort、元projectとdirtyな別worktreeの保持。HostによるSkillの自動発見・実際の旧CLI起動・任意の利用者設定の意味的移行・remote CIはこのfixtureの検証対象外である。

2026-10-16: 旧本体commit `2d64b8d5`をsource buildし、実際の旧`install --apply`で導入した隔離dummyでも、新版`6f61b8ee`の標準tarballから設定切替・Git revert・入口rollbackを確認した。dummy ownerが旧既定policyを明示選択した後、40件の設定を棚卸しし、旧Skill・observer登録を外し、新CLIへ切り替えた。利用者規約・deny permission・無関係なHookを保持し、切戻し後も後続のアプリcommit・元project・dirtyな別worktreeが不変だった。配布物作成・offline導入を含む観測時間20.30秒、Agent起動0回。これは実旧版導入資産の設定往復であり、HostのSkill自動発見・実モデル開発・任意設定の移行・remote CIの証明ではない。結果は`RELEASE_READINESS.json.configurationGitRoundtrip.realLegacyInstallation`に保存した。
