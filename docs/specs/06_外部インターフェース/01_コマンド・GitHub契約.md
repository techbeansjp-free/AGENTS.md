# CLI・GitHub契約

CLIは引数を構造化入力として受け、適用を伴う操作は既定でdry-runとする。外部プロセスは引数配列で呼び、`gh`操作は`src/adapters/github.ts`、providerのread-only観測は`src/adapters/provider.ts`だけに閉じ込める。

| 境界 | 事前確認 | 適用 | 適用後確認 |
|---|---|---|---|
| Issue同期 | 認証、完全なrepository同一性、staging構造 | create/edit | Issue番号、repository、本文hashを再読取 |
| PR作成 | 認証・write authority、provider default branch/tip、remote base/head OID、trusted policy commit、Issue終了参照、Step 0〜10のjournalと`sync-verified`、同じIssue stagingへ耐久化した`create-prepared` | provider create直前にone-shot `dispatchClaimedAt`をstaging digestとともに耐久化し、claimを取得した1回だけcreateする。Issue参照規約は[開発ワークフロー](../../../.agent-skill-chain/docs/01_開発ワークフロー.md)が所有する | repository、PR番号・URL、canonical Issue、same-repository head、base/head ref、headRefOid、canonical title/body、closing Issue 1件を再読取して`pr-bound`へ固定する。PoCとdisabledは`outcome=pull-request`のStep 11へ進み、assistedのauthority待ちとautomaticはStep 11を未記録にする |
| review証拠 | exact repositoryと明示したH_impl/H_final/PR/run/review ID、H_implからreview artifact 1件だけを加えた単一親H_final | read-only | commit author、PR current head/author、Actions event/head/conclusion/関連PR、immutable review commit/user/submittedAt/stateを再読取し、artifact path/digest・CI run ID・review ID・`reviewEvidenceId`を同じH_finalへ固定する |
| policy authority | exact repositoryと明示したPR ID、base SHA/ref、default branch/tip、trusted policy commit | read-only | PR baseRefName/baseRefOid/headRefOidとrepository defaultBranchRef name/tip OIDをtrusted providerから再読取し、同一tupleへ固定 |
| merge | PR作成時と同じstagingの`pr-bound`、Step 0〜10・`sync-verified`・PoCでないこと、provider default branch tip・PR base SHA・trusted policy commitの一致、base branchに対する`branchMethods`の積集合、base/headの長命branch判定、mergeを保護するclassic protectionまたはruleset、成功check、固定H_finalの独立approval | method、認可head/base/ref、trusted policy commit、H_impl、固定review Evidence、intent IDを`merge-prepared`へ耐久化し、provider merge直前にone-shot `dispatchClaimedAt`をfsyncする。claim取得後だけ1回、許可methodとexact HEAD CASで実行する | auto-merge・queue・merged状態と固定identityを再読取する。mergedAt、merge commit SHA、dispatch以後のprovider request、method別commit topologyを立証した後だけ`outcome=merged`のStep 11を記録する |
| provider availability | provider名の許可文字と実行入口 | Codexは`codex app-server --stdio`をinitializeして`model/list`、その他はprovider固有の`models list --json`をread-only実行 | stdoutだけを厳密に解析し、available、unavailable、unknown、model一覧、recommended default、対応reasoning effort、観測時刻、確認済み入口を返す。10秒以内に完了しない、起動失敗、非0終了、解釈不能、未取得pageありはunknownとし、stderr本文を転記しない |

GitHubエラーの機械diagnosticは表示言語に依存せず、秘密情報の伏字化と行動可能な根拠・次行動を保持する。表示言語はproject choiceを読むcaller adapterが選択する。

## usageと必須入力の提示

`src/cli-usage.ts`がsubcommandごとの要約、必須flag、条件付きflag、任意flagと既定値、位置引数、実行例を保持する単一正本である。CLIはcommandとsubcommandを解決した直後にこの定義を引き、次の順で評価する。

1. `--help`または`-h`があればusageをJSONで返し終了code 0とする。必須flag検証より先に評価する。
2. 値をとるflagが`--flag=値`形式でない場合、`--flagは空白区切りでは受理しません。--flag=値の形式で指定してください`を返す。無言で未指定として扱わない。
3. subcommand固有のtrusted boundary評価を行う。`worktree create`の明示`--path`はここで評価し、必須flag検証より先に拒否する。
4. 不足している必須flagを1回の実行で全件`reasons`へ列挙する。1件ずつ返さない。`next`は当該subcommandの`--help`を案内する。

位置引数を持つsubcommandでは、位置引数が先頭の必須flagを代替する。`workflow`のsubcommandは既存互換のため空白区切りのflagを受理する。

`scripts/check_cli_usage.ts`はTypeScript ASTで`src/cli.ts`のdispatchを走査し、実装が`required`で要求するflagがusageの必須・条件付きにあること、usageが必須・条件付きと宣言したflagを実装が読むこと、実装が読む全flagがusageに記載されていること、全dispatchにusage定義があることを双方向に検証する。この検査は`npm run build`が呼ぶ`checkCliContract`から実行し、prepackの連鎖に入る。

## worktree作成・merge完了コマンド

| コマンド | 入力 | 出力・終了code |
|---|---|---|
| `worktree create` | `--issue --slug --branch --base --remote-default-branch --remote-default-sha`、任意の`--root --path --repo` | `--path`省略時はCLI層の現在local time、Issue番号、slugから`.worktrees/{YYYYMMDD_HHMMSS}-{issueNumber}-{slug}`を構成する。明示pathは未来または10分超の過去を拒否する。作成結果は絶対path、branch、base、作成元状態の保持を返す |
| `worktree survey` | `--root=<repository root>`、任意の`--format=json\|text`。`--apply`は拒否 | 登録済みworktreeの`primary / in-progress / cleanup-ready / retain`、日本語理由、分類別path、走査errorをJSONまたは日本語要約表で返す。追跡対象変更、未追跡file、stash、未push・remote branch、既定branchへのmerge、復旧到達性、配置、ignore対象をfinalizeと同じ判定で評価し、cleanup-readyはfinalizeの同じ安全事実を満たす。directory名とbranch名のIssue番号・slug不一致は`reasons`へ加えるが分類を変えない。候補の存在だけでは終了codeを非0にせず、走査失敗だけを非0にする |
| `worktree finalize --dry-run` | `--root --path --evidence` | 対象を削除せず、finalize report、保持理由、cleanup計画を返す。allowlist外のignore対象はpathごとに`allowlist外`と報告し、allowlist内のpathは理由へ含めない。reportとcleanupがともにsafe／readyなら0、それ以外は非0 |
| `worktree finalize --complete --dry-run` | `--root --path --evidence --merge-sha`。cleanup authorityと承認digestは任意 | 副作用なしで全phase、`state`、`requiredAuthority`、日本語`recovery`、最新`previewDigest`、対象pathをJSONで返す。未承認は`pending`かつ非0 |
| `worktree finalize --complete --apply` | preview入力に`--authorize=approved`を加える。cleanup適用にはさらに`--cleanup-authority --approved-digest=<64桁hex>`が必要 | merge確認後にrootを更新する。cleanup authorityなしはroot更新済み・cleanup pendingで非0。全検証成功は`completed`で0、拒否または部分完了は非0 |

`--authorize=approved`は既存finalizeとroot更新のauthorityであり、cleanup operationのauthorityとして流用しない。`--cleanup-authority`は実行ごとの明示authorityで、project policyへ保存しない。apply直前にfinalize reportを再生成し、そのSHA-256 hashを最新cleanup preview digestとして`--approved-digest`と完全一致させる。cleanupは既存`applyFinalize`が発行する対象1件の`worktree.remove`だけをGit公式commandへ渡し、branch削除、prune、他worktree探索を行わない。

`worktree create`は現在時刻を1回だけ取得し、path構成と明示path検証へ同じ値を渡す。明示`--path`はGit内部領域などのtrusted boundaryへ最初に通し、その後で配置、directory名、timestamp、Issue番号、slugを検証する。domainは現在時刻を取得しない。現在時刻が未指定または不正ならtimestamp検証をskipせずfail-closedで拒否する。`YYYYMMDD_HHMMSS`は実行環境のlocal timeとして暦上の実在性まで検証し、未来には猶予を設けない。

finalize時に削除可能なignore対象は、package既定の`node_modules/`と`dist/`に、project policy manifestの`policy.worktree.finalizeIgnoredPathAllowlist`を加えて解決する。追加値は末尾`/`を持つrepository相対のdirectory名またはpath prefixだけとし、絶対path、親参照、`.`、`.git`、Unicode制御文字、非NFC、backslash、glob・正規表現meta文字、重複、64件超をruntimeとschemaで拒否する。`.gitignore`への記載だけでは削除可能にせず、`.agent-skill-chain/tmp/`、`issues/`、`memo/`、`.claude/`は既定allowlistへ含めない。

適用後はroot HEAD、`git worktree list --porcelain`、対象path、他worktree snapshotを再読取する。対象削除後のrepository直下`.worktrees/`がsymlinkでない実在する空directoryの場合だけ、既存workspace hygieneの最新reportと明示path `.worktrees`を使って非再帰に除去する。非空、symlink、root外、不明は保持する。

## Issue検証コマンド

| コマンド | 入力 | 出力・終了code |
|---|---|---|
| `issue validate` | `--path=<directory>`と任意の`--stage=requirements\|design`、変更fileを検査する場合は`--changed` | mode、valid、全error、PoC禁止操作をJSONで返す。validは0、invalidは1 |

`--stage=requirements`はfullの`00_要求定義.md`と`01_要件定義.md`だけを必要成果物とし、Step 4で使用する。`--stage=design`はfullの`00_要求定義.md`から`03_実装計画.md`までを必要成果物とし、Step 8で使用する。未指定は後方互換のため`design`相当の全件検証とする。quickとpocは成果物を00へ集約するためstageで必要成果物を変えない。全mode・全stageでP-01〜P-07、開発考慮事項、未解決placeholder、Gherkin scenario IDを検証し、`--stage=requirements`でもGherkinを省略できない。未知のstageは入力errorとして非0で拒否する。

| Policy CLI | 入力 | 出力・終了code |
|---|---|---|
| `policy validate` | policy JSON。PR CIは`--trusted-commit / --expected-base-sha / --candidate-head-sha / --base-ref / --default-branch / --repo / --pr`を明示 | 有効性、全error、長命branchへ`merge`なしでsquashまたはrebaseだけが解決される場合の`warn`、project policy `v0.3.0`には`v0.3.1` staged migration案。警告だけなら終了codeは0。唯一のGitHub adapterがexact repo/PRのbase OID/ref、head OID、repository default branchとcurrent tip OIDを観測し、base refとdefault branch、base OIDと両base SHA、head OIDとcandidate head SHA、provider tip OIDとlocal remote default tipの一致を検証する。trusted SHAはそのtipのancestorでなければならず、feature-only commit、stale local ref、非default base、provider不明を拒否する |
| `policy evaluate` | `--trusted`と`--candidate` | 許可は0、自己緩和はASC-TRUST-001を含む1 |
| `policy migrate` | trusted/candidate、`--dry-run`または`--apply`、state変更時はcall-siteの`--approved-plan-hash`と`--expected-revision` | plan、snapshot、history、rollback、retry、recover。state内の自己申告approvalをauthorityにせず、dry-runはfileを書き込まない |
| `review evidence` | `--repo --pr --run-id --review-id`と`H_impl/H_final`、artifact path | Gitと唯一のGitHub adapterから観測した二段階証拠。caller actor option、任意JSON、別PR run、不一致・未完了・自己reviewは非承認 |
| `review validate` | tracked review file | rubricと構造だけを検証する。file内のGitHub metadataをauthorityにせず、承認はtrusted provider観測待ちのpending |
| `trace validate` | project adapterが作成した`--evidence` JSONとproject choices | runner・file形式・表示言語・Gherkin方言を所有せず、stable ID、canonical step role、選択層、禁止file証拠を検証 |

## Workflowサブコマンド

| コマンド | 入力 | 出力・終了code |
|---|---|---|
| `workflow steps` | 任意の`--mode=<quick｜full｜poc>` | Step定義、mode別列、省略対象、全mode共通の省略不能Stepを機械可読JSONで返す。不明modeは非0 |
| `workflow record` | `--staging --step`、1件以上の`--artifact`、`--evidence`。`--recorded-at`は任意 | Step 1〜10をJSONLへ追記し、順序・省略規則・書込後digestを検証する。Step 11はdelivery終端専用のため拒否する |
| `workflow verify` | `--staging`、任意の`--up-to=<0..11>` | 欠落、対象外、順序違反、mode conflictをStep番号・skill ID・単一責務付きの日本語structured diagnosticで返す。有効時は0、違反時は非0 |
| `workflow verification-set` | `--input=<JSON>`。Requirement ID、Acceptance Criteria ID、変更種別、risk、影響境界、security・data loss・不可逆・外部契約・並行振る舞のImpact Analysis | 入力を保持したrisk比例Verification SetをJSONで返す。Requirement、AC、影響境界の空配列、型不正、未知fieldは非0 |
| `workflow assess-discovery` | `--input=<JSON>`。`discoveryId`、`workflowMode`、目的・scope・AC変更、security境界拡大、不可逆操作、canonical `changedContractKinds[]`、`modeDisqualifiers: { id, evidence }[]` | `continue / rebaseline-affected-contracts / promote-to-full / stop-or-promote-full`、影響成果物、`discoveryId`を含む7項目の必須記録fieldをJSONで返す。PoC停止時の`affectedArtifacts`は空、昇格候補は`promotionArtifacts`へ分離する。不正ID・空Evidence・重複・未知ID・未知fieldは非0 |
| `workflow promote-full` | `--staging --input`、任意の`--root --promoted-at --dry-run --apply`。入力は同じ発見JSON | 無指定と`--dry-run`は副作用なしのpreview、`--apply`だけがfullへ単調昇格する。delivery state存在、既full、mode不一致、非昇格判定、境界外path、既存昇格artifactは副作用前に拒否する |

`pr create`は`--staging`で対象を明示でき、省略時はtrackerがrepository・Issue番号と一致するstagingを一意に解決する。明示時を含め、trackerは`https://github.com/<owner>/<repository>/issues/<number>`形式の絶対GitHub Issue URLでなければならず、`--repo`と`--issue`の双方へ一致しないstagingはGitHub操作前に拒否する。project外、別Issue、symlink経由のstagingもGitHub操作前に拒否する。journal欠落、Step 10までの検証失敗、Step 4・10欠落、`sync-verified`未到達ではdry-runを含めてGitHub操作前に拒否する。`--workflow-override=<JSON file>`は欠落Stepだけを対象とし、`issue / scope=workflow.pr.create / instructedBy / instructedAt / expiresAt / reason`を完全検証する。AI・roleの自己発行、別Issue、失効、未知field、順序等の欠落以外の不整合は迂回できない。

適用時はprovider createより先にwrite authority、provider default branch/tip、remote head SHAを指定repository・base、trusted policy commit、exact HEADへ一致させる。その後、repository、canonical Issueの絶対URL、head ref/SHA、base refと作成時base SHA、canonical title/body digest、本文のclosing契約digestを`create-prepared`として同じstagingへ耐久化する。delivery stateの原子書込み、staging recordのartifact一覧・content digest更新、両fileとdirectoryのfsync、再読取が完了してから、provider create直前にone-shot `dispatchClaimedAt`を同じ手順で耐久化する。`null`だけが未dispatchを立証し、非`null`はprovider callの成否にかかわらず同じcreateの再送禁止を表す。作成後read-backでrepository、PR番号・URL、canonical Issue、same-repositoryかつcross-repositoryでないhead repository、head ref/SHA、canonical title/body、base ref、closing Issue 1件を一致確認して`pr-bound`へ固定する。

timeout、通信切断、応答解釈不能ではcreateを再送せず、固定済みsame-repository head、head/base、canonical title/body、Issue/closing契約に一致するOPEN・CLOSED・MERGED PRをprovider read-backで照合する。provider connectionはcursor終端までpaginationし、不完全page・必須field不明をexact absenceとして扱わない。全状態を通じて一致が1件だけかつOPENの場合だけ`pr-bound`へ復旧できる。CLOSED一致は重複PR作成を禁止し、MERGED一致もASCのmerge認可provenanceなしに自動完了や作り直しをしない。`dispatchClaimedAt=null`、一致PR 0件のexact absence、provider base SHAと固定base SHAの不変がすべて決定的に成立する場合だけ、同一immutable intentのdispatch claimを1回取得できる。baseが前進した場合は固定intentを書き換えずread-only照合に留め、曖昧・複数件とともに`reconciliation-required`を返す。full/quickの`automatic`では適用後を`merge_pending`とし、Step 11を未記録のまま同じstagingによる別操作の`pr merge`へ繋ぐ。

`pr merge`は`--repo --pr --method --staging`を必須とする。指定stagingの`pr-bound`、Step 0〜10、`sync-verified`を再検証し、PoCはGitHub観測より前に拒否する。GitHubから観測したPR番号を`--pr`と一致させ、`closingIssuesReferences`がstaging trackerと同じ絶対GitHub Issue URL・Issue番号の1件だけである場合に限り、そのstagingが対象PRのものだと扱う。別repository、別Issue、追加のclosing Issue、close参照欠落は有効なstagingでも拒否する。この同一性は初回観測、merge直前、merge後の各read-backで検証する。

適用では固定HEADへtrusted状態を直前に再認可し、providerのmerge要求も`--match-head-commit`で同じ完全HEAD SHAへ拘束する。H_finalはH_implを唯一の親とし、H_impl..H_finalの差分を許可されたreview artifact 1件だけに限定する。現在H_finalのsuccessful pull_request CI runと独立reviewを観測する。PR authorとH_impl authorのstable IDを必須とし、paginationした全review履歴はactorごとの最新eventだけを有効状態として、後続CHANGES_REQUESTED/DISMISSEDより古いAPPROVEDを採用しない。method、認可HEAD、base ref/SHA、trusted policy commit、H_impl、review artifact path/digest、CI run ID、実際に採用したreview ID、`reviewEvidenceId`、intent IDを`merge-prepared`へ固定する。このstateとstaging digestを耐久化した後、provider merge直前にone-shot `dispatchClaimedAt`を耐久化する。`null`だけが未dispatchの証拠であり、claim後はprovider callの成否が不明でも再送しない。

PR作成時のbase refは固定する。merge intent準備前は同じbase ref上のbase SHA前進を許容するが、provider default branch tip、current PR base SHA、current trusted policy commitの三者を一致させてから最新base SHAを固定する。準備後のbase・trusted policy・H_impl・review Evidenceの変化は固定intentを書き換えずread-only照合と再認可の失敗とし、mergeを再送しない。classic protectionが404の場合はexact branchへ適用されるrulesetを取得する。`pull_request`、`required_status_checks`、`required_signatures`、`non_fast_forward`、`required_linear_history`のいずれかを含む場合だけmerge保護とし、`deletion`だけのrulesetはknownだがunprotectedとして拒否する。classic protectionとrulesetの両方を観測できないときもfail-closedとする。

timeout、通信切断、応答解釈不能ではmergeを再送せず、auto-mergeとmerge queueを含むprovider read-backで結果を照合する。`dispatchClaimedAt=null`、OPEN PR、auto-mergeとqueue entryのexact absence、固定head/base・trusted policy・H_impl・review Evidenceの不変がすべて成立する場合だけ、同一immutable intentのdispatch claimを1回取得できる。それ以外の曖昧状態は固定intentを保持して`reconciliation-required`とする。

native auto-merge要求またはmerge queue登録だけをStep 11として記録しない。auto-mergeはmethod・requestedAt・head/base OID、queueはentry ID・state・requestedAt・head/base OIDを`merge-observed`へ保存する。同じPRのrepository、Issue絶対URL、HEAD、closing契約、`merged`状態、dispatch claim以後のprovider mergedAt、merge commit SHAをproviderから再観測する。通常mergeはmerge commitの2親を固定base/headの順に一致させ、squashは単一親を固定baseへ一致させ、squash/rebaseはさらに固定methodのauto-merge request Evidenceを必須とする。全methodで固定base/headから決定的に計算したmerge-result treeをproviderのmerge commit treeへ一致させ、そのmerge commitがprovider既定branchのcurrent tipと同一またはancestorであることもprovider compareで確認する。merged後のbase tip前進はcurrent authorityで再認可せず、保存済み認可tuple・固定review Evidence・commit topologyのread-only検証で復旧する。これらを立証した後だけ`outcome=merged`のStep 11を記録する。

PoCとdisabledは固定PR bindingのdigestを`outcome=pull-request`のStep 11にし、assistedのauthority待ちは`pr-bound`のままとする。どちらの終端もjournalを先にfsyncし、journal追記が更新したstaging recordのartifact一覧・content digestを耐久化した後、journal digest・outcome・evidence IDをdelivery stateへ保存する。journal保存後・state保存前の停止は、復旧判定前とapply直前のwriter lock内で、実artifact一覧とcontent digestがstaging recordに一致することを検証する。その後、同じ`pr create`または`pr merge`の再実行が既存Step 11 entryのjournal digest・outcome・evidence IDを検証し、stateだけを前向きに復旧する。provider副作用とjournal追記を再送しない。dry-runはdelivery state遷移もStep 11書込も行わない。

GitHubのmerge適用が原子的に拘束できるのはHEAD OIDであり、PR本文、base ref、closing Issueなど全metadataのCASは提供されない。この残余競合は適用直前の二重read、HEAD CAS、protection/ruleset、適用後read-backで検知し、完全予防できるとは報告しない。不一致を観測した場合は成功扱いせず、固定identityとprovider観測を保持して照合待ちとする。

## project導入・診断出力

| コマンド | 追加出力 | 契約 |
|---|---|---|
| `doctor` | `projectPolicyStatus`、`projectPolicyMessage`、`workflow`、`worktrees` | project policyを`missing / valid / invalid / unsupported-version`のいずれかで報告する。各Issue stagingのモード判定成果物、journal、実施済みStep、現在Step、次Step、妥当性を追加する。CLIが注入した走査結果のcleanup-ready、retain、in-progress件数とcleanup-ready pathの日本語diagnosticも報告し、走査失敗もdiagnosticへ保持する。`healthy`は従来どおりinstall健全性だけを表す |
| `project bootstrap` | `generatedScope`、`projectPolicyStatus`、`projectPolicyNotice`、`nextSafeOperation` | `docs/specs/`だけを生成し、project policyは生成も検証もしない。利用project ownerがmanifestと列挙資産を作成し、`policy validate`と`conformance validate`を行う次操作を日本語で返す |

`doctor`の`unsupported-version`は入力を保持したstaged migrationを案内する。`missing`と`invalid`はinstall成功に隠さず明示するが、package資産の導入状態とconsumer所有policyの妥当性を同じhealth判定へ混在させない。

## Routingサブコマンド

| コマンド | 入力 | 出力・終了code |
|---|---|---|
| `routing observe` | `--provider` | read-onlyのProviderAvailability。availableは0、unavailableまたはunknownは非0 |
| `routing resolve` | `--root --scope --coordinator --implementer --reviewer --evaluator-ref` | project choice、trusted mapping、provider観測からroleとmodelを解決する。resolvedは0、pendingまたはrejectedは理由、確認済み入口、安全なfallback候補、必要authority、停止点、再開条件を含めて非0 |
| `routing roles` | `--scope --assignments=<JSON>` | 6 roleの重複、未知role、coordinator欠落、implementerとreviewerのidentity・context兼務を検証する。違反は日本語構造化診断と非0 |
| `routing tier` | `--risk --mode --scope --model --selected [--justification]` | risk・mode・scopeとproject choice mappingから必要tierを決め、降格・mapping不明・不一致を非0で拒否する |
| `routing ceiling` | `--provider --selection --issue --scope [--override=<JSON>]` | provider自律選択上限とIssue・scope拘束の人間overrideを検証し、alias・自動routing・失効・自己発行を非0で拒否する |
| `routing independence` | `--implementer --reviewer --candidate-paths --trusted-ref --candidate-head --evaluator-ref` | identity分離とcandidate自己評価を検査する。independentは0、violatedまたはpendingは構造化診断付きで非0 |
| `routing evidence issue` | store設定と`--base-sha --issue --scope --role --route-mode --provider --model --model-selection --routing-reason --mapping-version --reasoning-effort --service-tier --identity --evaluator-ref` | 無指定は発行preview、`--apply`はCodex優先またはClaude fallbackを拘束した書換不能なrouting evidenceを排他的に1件発行する |
| `routing evidence complete` | store設定と`--evidence-id --implementation-head --end-state` | 無指定は追記preview、`--apply`はcompletedまたはinterruptedのcompletion recordを1件追記する |
| `routing evidence state` | store設定と`--evidence-id --state --reason` | 無指定は追記preview、`--apply`はsupersededまたはinvalidatedのEvidenceStateRecordを追記する |
| `routing evidence prune` | project choiceの保持方針。適用時は`--digest --target-ids` | 無指定は削除せず対象IDとdigestを返す。適用は`--apply --authorize=approved`とpreview一致を要求し、不一致またはauthority欠落は非0で拒否する |
| `issue staging` | `--root [--now] [--retention-days]`。無指定はpreview | `.agent-skill-chain/tmp/issues/`直下の候補、除外理由、同期証拠、fingerprint、SHA-256 report hashをJSONで返しfileを変更しない |
| `issue staging --apply` | preview入力と`--approved-hash=<64桁hex>` | 同じroot・保持条件の再plan hashが一致した候補だけを削除する。completedは0、rejectedまたはpartially-completedは日本語structured diagnosticまたはrecovery付きで非0 |

外部authorityを要しないpolicy CLIはofflineで動作する。PR CIのexplicit authority検証などGitHub必須gateは接続障害・不完全な観測時に`pending`としてfail-closed（exit非zero）とし、local安全結果は保持して成功扱いしない。観測済みtupleと入力の不一致は`rejected`、検証中のtuple変更は`pending`として再実行を案内する。

`issue sync`はquick・pocのStep 4またはfullのStep 8という最終同期で`--staging-path --checkpoint`を併記できる。GitHub adapterの本文書き込み後再読取が一致し、同期前後のlocal body digestも一致した場合だけ、tracker URL、同期時刻、checkpoint、期待・再読取digestをstaging記録へ保存して再読取する。`promotion-active`のStep 4と8は、記録済みabsolute GitHub tracker URLが`--repo`と`--issue`から導くURLに完全一致する場合だけ元Issueへの同期を許可する。この拘束はGitHub副作用前に検証し、Step 8の同期記録更新時にも再検証する。`promotion-active`のStep 4では`--staging-path --checkpoint=4`を検証専用入力として要求するが、fullの最終checkpointではないため同期記録を更新しない。通常の`local-active` full Step 4では従来どおり両引数を渡さない。

`pr create --dry-run`はtrusted Git policyとlocal review/test/spec/ownership evidenceの構造を判定するが、GitHub authorityをattestしない`unverified-preview`とし、GitHub/`gh`を呼ばない。`--apply`は明示authorizationを必須とし、唯一のGitHub adapterが作成直前にexact repositoryのwrite authority、remote head/base refのOIDを観測し、作成後のrepository/base/head/head OID/base OIDまで再読取する。local evidence JSONのprovenance自己申告をauthorityとして扱わない。

`pr merge`はCLI flagをhuman approvalとして扱わない。GitHub review APIをpaginationして全pageのreview ID、submittedAt、commit SHA、actorを取得し、配列順でなく時刻とstable IDからactorごとの最新状態を決める。現在のHEAD SHAに一致してPR authorとprovider観測済みH_impl commit authorの両方から独立したapprovalだけを数える。base branchが`branchMethods`の複数entryに一致するときは全methodsの積集合を使い、空ならfail-closedで拒否する。未一致時はglobalな`merge.methods`を使い、branch単位指定によるglobal許可の拡大はpolicy検証で拒否する。baseRefとheadRefの双方が`merge.branches`へ文字列として列挙された長命branch同士なら、squashとrebaseを`ASC-MERGE-METHOD-001`で拒否し、merge方式での再実行を案内する。観測値・時刻・repository・SHA・branch protectionの欠落や矛盾はfail-closedとし、適用直前にPR、check、review、protectionとmethodを再取得して同じ条件で再認可する。

PR CIで`origin/HEAD`がない場合も、workflowはevent値をquoted environment経由の明示入力とし、read-only tokenを使う唯一のGitHub adapterがexact repository/PRのbase ref/OID、head OID、repository default branchとcurrent tip OIDを再観測する。provider tip OIDが`refs/remotes/origin/<default>` tipと完全一致し、base refがobserved default branchで、observed base OIDが両SHAに一致し、そのSHAがtipのancestorである場合だけauthorityとする。explicit modeのcandidateはfilesystemでなくprovider-observed head commitのGit objectからentrypointと全fragment inventoryを読み、manifestを正本として検証する。そのcommitにないhead、monolith、mixed inventory、orphan/missing fragment、stale local remote refをfail-closedにし、dirty/missing/orphan worktreeが検証対象を差し替えることを許さない。初回bootstrapのproject set不在はtrusted commit側だけに認める。候補側の環境変数やcheckout中のfile、feature-only commitをtrusted SHAの代替にしない。
