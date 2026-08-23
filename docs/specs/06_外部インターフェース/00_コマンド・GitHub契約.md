# CLI・GitHub契約

CLIは引数を構造化入力として受け、適用を伴う操作は既定でdry-runとする。外部プロセスは引数配列で呼び、`gh`操作は`src/adapters/github.js`だけに閉じ込める。

| 境界 | 事前確認 | 適用 | 適用後確認 |
|---|---|---|---|
| Issue同期 | 認証、完全なrepository同一性、staging構造 | create/edit | Issue番号、repository、本文hashを再読取 |
| PR作成 | 認証、base/head、HEAD SHA、同一SHAの証拠 | `Relates to #824`で作成 | URL、base/head、headRefOidを再読取 |
| review証拠 | exact repositoryと明示したH_impl/PR/run/review ID | read-only | commit author、PR current head/author、Actions event/head/conclusion/関連PR、immutable review commit/user/submittedAt/stateを再読取 |
| policy authority | exact repositoryと明示したPR ID、base SHA/ref、default branch | read-only | PR baseRefName/baseRefOid/headRefOidとrepository defaultBranchRefをtrusted providerから再読取 |
| merge | 既定branch上policy、branch保護、成功check、全pageから時刻順に決めた同じHEAD SHAの最新独立approval | 許可されたmethodで実行 | 直前に同じtrusted観測で再認可し、merged SHAと状態を再読取 |

GitHubエラーの機械diagnosticは表示言語に依存せず、秘密情報の伏字化と行動可能な根拠・次行動を保持する。表示言語はproject choiceを読むcaller adapterが選択する。

| Policy CLI | 入力 | 出力・終了code |
|---|---|---|
| `policy validate` | policy JSON。PR CIは`--trusted-commit / --expected-base-sha / --candidate-head-sha / --base-ref / --default-branch / --repo / --pr`を明示 | 有効性、全error、project policy `v0.3.0`には`v0.3.1` staged migration案。唯一のGitHub adapterがexact repo/PRのbase OID/ref、head OID、repository default branchとcurrent tip OIDを観測し、base refとdefault branch、base OIDと両base SHA、head OIDとcandidate head SHA、provider tip OIDとlocal remote default tipの一致を検証する。trusted SHAはそのtipのancestorでなければならず、feature-only commit、stale local ref、非default base、provider不明を拒否する |
| `policy evaluate` | `--trusted`と`--candidate` | 許可は0、自己緩和はASC-TRUST-001を含む1 |
| `policy migrate` | trusted/candidate、`--dry-run`または`--apply`、state変更時はcall-siteの`--approved-plan-hash`と`--expected-revision` | plan、snapshot、history、rollback、retry、recover。state内の自己申告approvalをauthorityにせず、dry-runはfileを書き込まない |
| `review evidence` | `--repo --pr --run-id --review-id`と`H_impl/H_final`、artifact path | Gitと唯一のGitHub adapterから観測した二段階証拠。caller actor option、任意JSON、別PR run、不一致・未完了・自己reviewは非承認 |
| `review validate` | tracked review file | rubricと構造だけを検証する。file内のGitHub metadataをauthorityにせず、承認はtrusted provider観測待ちのpending |
| `trace validate` | project adapterが作成した`--evidence` JSONとproject choices | runner・file形式・表示言語・Gherkin方言を所有せず、stable ID、canonical step role、選択層、禁止file証拠を検証 |

外部authorityを要しないpolicy CLIはofflineで動作する。PR CIのexplicit authority検証などGitHub必須gateは接続障害・不完全な観測時に`pending`としてfail-closed（exit非zero）とし、local安全結果は保持して成功扱いしない。観測済みtupleと入力の不一致は`rejected`、検証中のtuple変更は`pending`として再実行を案内する。

`pr create --dry-run`はtrusted Git policyとlocal review/test/spec/ownership evidenceの構造を判定するが、GitHub authorityをattestしない`unverified-preview`とし、GitHub/`gh`を呼ばない。`--apply`は明示authorizationを必須とし、唯一のGitHub adapterが作成直前にexact repositoryのwrite authority、remote head/base refのOIDを観測し、作成後のrepository/base/head/head OID/base OIDまで再読取する。local evidence JSONのprovenance自己申告をauthorityとして扱わない。

`pr merge`はCLI flagをhuman approvalとして扱わない。GitHub review APIをpaginationして全pageのreview ID、submittedAt、commit SHA、actorを取得し、配列順でなく時刻とstable IDからactorごとの最新状態を決める。現在のHEAD SHAに一致してPR authorとHEAD commit authorの両方から独立したapprovalだけを数える。観測値・時刻・repository・SHA・branch protectionの欠落や矛盾はfail-closedとし、適用直前にPR、check、review、protectionを再取得して同じ条件で再認可する。

PR CIで`origin/HEAD`がない場合も、workflowはevent値をquoted environment経由の明示入力とし、read-only tokenを使う唯一のGitHub adapterがexact repository/PRのbase ref/OID、head OID、repository default branchとcurrent tip OIDを再観測する。provider tip OIDが`refs/remotes/origin/<default>` tipと完全一致し、base refがobserved default branchで、observed base OIDが両SHAに一致し、そのSHAがtipのancestorである場合だけauthorityとする。explicit modeのcandidateはfilesystemでなくprovider-observed head commitのGit objectからentrypointと全fragment inventoryを読み、manifestを正本として検証する。そのcommitにないhead、monolith、mixed inventory、orphan/missing fragment、stale local remote refをfail-closedにし、dirty/missing/orphan worktreeが検証対象を差し替えることを許さない。初回bootstrapのproject set不在はtrusted commit側だけに認める。候補側の環境変数やcheckout中のfile、feature-only commitをtrusted SHAの代替にしない。
