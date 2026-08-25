# CLI・GitHub契約

CLIは引数を構造化入力として受け、適用を伴う操作は既定でdry-runとする。外部プロセスは引数配列で呼び、`gh`操作は`src/adapters/github.ts`、providerのread-only観測は`src/adapters/provider.ts`だけに閉じ込める。

| 境界 | 事前確認 | 適用 | 適用後確認 |
|---|---|---|---|
| Issue同期 | 認証、完全なrepository同一性、staging構造 | create/edit | Issue番号、repository、本文hashを再読取 |
| PR作成 | 認証、base/head、HEAD SHA、同一SHAの証拠、Issue終了参照 | canonical Issueを`Closes #番号`、後続Issueを`Relates to #番号`で作成 | URL、base/head、headRefOidを再読取 |
| review証拠 | exact repositoryと明示したH_impl/PR/run/review ID | read-only | commit author、PR current head/author、Actions event/head/conclusion/関連PR、immutable review commit/user/submittedAt/stateを再読取 |
| policy authority | exact repositoryと明示したPR ID、base SHA/ref、default branch | read-only | PR baseRefName/baseRefOid/headRefOidとrepository defaultBranchRefをtrusted providerから再読取 |
| merge | 既定branch上policy、branch保護、成功check、全pageから時刻順に決めた同じHEAD SHAの最新独立approval | 許可されたmethodで実行 | 直前に同じtrusted観測で再認可し、merged SHAと状態を再読取 |
| provider availability | provider名の許可文字と実行入口 | Codexは`codex app-server --stdio`をinitializeして`model/list`、その他はprovider固有の`models list --json`をread-only実行 | stdoutだけを厳密に解析し、available、unavailable、unknown、model一覧、recommended default、対応reasoning effort、観測時刻、確認済み入口を返す。10秒以内に完了しない、起動失敗、非0終了、解釈不能、未取得pageありはunknownとし、stderr本文を転記しない |

GitHubエラーの機械diagnosticは表示言語に依存せず、秘密情報の伏字化と行動可能な根拠・次行動を保持する。表示言語はproject choiceを読むcaller adapterが選択する。

## worktree merge完了コマンド

| コマンド | 入力 | 出力・終了code |
|---|---|---|
| `worktree finalize --complete --dry-run` | `--root --path --evidence --merge-sha`。cleanup authorityと承認digestは任意 | 副作用なしで全phase、`state`、`requiredAuthority`、日本語`recovery`、最新`previewDigest`、対象pathをJSONで返す。未承認は`pending`かつ非0 |
| `worktree finalize --complete --apply` | preview入力に`--authorize=approved`を加える。cleanup適用にはさらに`--cleanup-authority --approved-digest=<64桁hex>`が必要 | merge確認後にrootを更新する。cleanup authorityなしはroot更新済み・cleanup pendingで非0。全検証成功は`completed`で0、拒否または部分完了は非0 |

`--authorize=approved`は既存finalizeとroot更新のauthorityであり、cleanup operationのauthorityとして流用しない。`--cleanup-authority`は実行ごとの明示authorityで、project policyへ保存しない。apply直前にfinalize reportを再生成し、そのSHA-256 hashを最新cleanup preview digestとして`--approved-digest`と完全一致させる。cleanupは既存`applyFinalize`が発行する対象1件の`worktree.remove`だけをGit公式commandへ渡し、branch削除、prune、他worktree探索を行わない。

適用後はroot HEAD、`git worktree list --porcelain`、対象path、他worktree snapshotを再読取する。対象削除後のrepository直下`.worktrees/`がsymlinkでない実在する空directoryの場合だけ、既存workspace hygieneの最新reportと明示path `.worktrees`を使って非再帰に除去する。非空、symlink、root外、不明は保持する。

| Policy CLI | 入力 | 出力・終了code |
|---|---|---|
| `policy validate` | policy JSON。PR CIは`--trusted-commit / --expected-base-sha / --candidate-head-sha / --base-ref / --default-branch / --repo / --pr`を明示 | 有効性、全error、project policy `v0.3.0`には`v0.3.1` staged migration案。唯一のGitHub adapterがexact repo/PRのbase OID/ref、head OID、repository default branchとcurrent tip OIDを観測し、base refとdefault branch、base OIDと両base SHA、head OIDとcandidate head SHA、provider tip OIDとlocal remote default tipの一致を検証する。trusted SHAはそのtipのancestorでなければならず、feature-only commit、stale local ref、非default base、provider不明を拒否する |
| `policy evaluate` | `--trusted`と`--candidate` | 許可は0、自己緩和はASC-TRUST-001を含む1 |
| `policy migrate` | trusted/candidate、`--dry-run`または`--apply`、state変更時はcall-siteの`--approved-plan-hash`と`--expected-revision` | plan、snapshot、history、rollback、retry、recover。state内の自己申告approvalをauthorityにせず、dry-runはfileを書き込まない |
| `review evidence` | `--repo --pr --run-id --review-id`と`H_impl/H_final`、artifact path | Gitと唯一のGitHub adapterから観測した二段階証拠。caller actor option、任意JSON、別PR run、不一致・未完了・自己reviewは非承認 |
| `review validate` | tracked review file | rubricと構造だけを検証する。file内のGitHub metadataをauthorityにせず、承認はtrusted provider観測待ちのpending |
| `trace validate` | project adapterが作成した`--evidence` JSONとproject choices | runner・file形式・表示言語・Gherkin方言を所有せず、stable ID、canonical step role、選択層、禁止file証拠を検証 |

## project導入・診断出力

| コマンド | 追加出力 | 契約 |
|---|---|---|
| `doctor` | `projectPolicyStatus`、`projectPolicyMessage` | project policyを`missing / valid / invalid / unsupported-version`のいずれかで報告する。`healthy`は従来どおりinstall健全性だけを表し、policy欠落・不正によって意味や終了codeを変えない |
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

`issue sync`はquick・pocのStep 4またはfullのStep 8という最終同期で`--staging-path --checkpoint`を併記できる。GitHub adapterの本文書き込み後再読取が一致し、同期前後のlocal body digestも一致した場合だけ、tracker URL、同期時刻、checkpoint、期待・再読取digestをstaging記録へ保存して再読取する。fullのStep 4は最終checkpointではないため同期記録を更新しない。

`pr create --dry-run`はtrusted Git policyとlocal review/test/spec/ownership evidenceの構造を判定するが、GitHub authorityをattestしない`unverified-preview`とし、GitHub/`gh`を呼ばない。`--apply`は明示authorizationを必須とし、唯一のGitHub adapterが作成直前にexact repositoryのwrite authority、remote head/base refのOIDを観測し、作成後のrepository/base/head/head OID/base OIDまで再読取する。local evidence JSONのprovenance自己申告をauthorityとして扱わない。

`pr merge`はCLI flagをhuman approvalとして扱わない。GitHub review APIをpaginationして全pageのreview ID、submittedAt、commit SHA、actorを取得し、配列順でなく時刻とstable IDからactorごとの最新状態を決める。現在のHEAD SHAに一致してPR authorとHEAD commit authorの両方から独立したapprovalだけを数える。観測値・時刻・repository・SHA・branch protectionの欠落や矛盾はfail-closedとし、適用直前にPR、check、review、protectionを再取得して同じ条件で再認可する。

PR CIで`origin/HEAD`がない場合も、workflowはevent値をquoted environment経由の明示入力とし、read-only tokenを使う唯一のGitHub adapterがexact repository/PRのbase ref/OID、head OID、repository default branchとcurrent tip OIDを再観測する。provider tip OIDが`refs/remotes/origin/<default>` tipと完全一致し、base refがobserved default branchで、observed base OIDが両SHAに一致し、そのSHAがtipのancestorである場合だけauthorityとする。explicit modeのcandidateはfilesystemでなくprovider-observed head commitのGit objectからentrypointと全fragment inventoryを読み、manifestを正本として検証する。そのcommitにないhead、monolith、mixed inventory、orphan/missing fragment、stale local remote refをfail-closedにし、dirty/missing/orphan worktreeが検証対象を差し替えることを許さない。初回bootstrapのproject set不在はtrusted commit側だけに認める。候補側の環境変数やcheckout中のfile、feature-only commitをtrusted SHAの代替にしない。
