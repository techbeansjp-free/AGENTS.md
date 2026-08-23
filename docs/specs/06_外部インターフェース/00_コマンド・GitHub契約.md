# CLI・GitHub契約

CLIは引数を構造化入力として受け、適用を伴う操作は既定でdry-runとする。外部プロセスは引数配列で呼び、`gh`操作は`src/adapters/github.js`だけに閉じ込める。

| 境界 | 事前確認 | 適用 | 適用後確認 |
|---|---|---|---|
| Issue同期 | 認証、完全なrepository同一性、staging構造 | create/edit | Issue番号、repository、本文hashを再読取 |
| PR作成 | 認証、base/head、HEAD SHA、同一SHAの証拠 | `Relates to #824`で作成 | URL、base/head、headRefOidを再読取 |
| review証拠 | exact repositoryと明示したH_impl/PR/run/review ID | read-only | commit author、PR current head/author、Actions event/head/conclusion/関連PR、immutable review commit/user/submittedAt/stateを再読取 |
| policy authority | exact repositoryと明示したPR ID、base SHA/ref、default branch | read-only | PR baseRefName/baseRefOid/headRefOidとrepository defaultBranchRefをtrusted providerから再読取 |
| merge | 既定branch上policy、branch保護、check、approval | 許可されたmethodで実行 | merged SHAと状態を再読取 |

GitHubエラーの機械diagnosticは表示言語に依存せず、秘密情報の伏字化と行動可能な根拠・次行動を保持する。表示言語はproject choiceを読むcaller adapterが選択する。

| Policy CLI | 入力 | 出力・終了code |
|---|---|---|
| `policy validate` | policy JSON。PR CIは`--trusted-commit / --expected-base-sha / --candidate-head-sha / --base-ref / --default-branch / --repo / --pr`を明示 | 有効性、全error、v0.3にはv0.4 staged migration案。唯一のGitHub adapterがexact repo/PRのbase OID/ref、head OID、repository default branchを観測し、base refとdefault branch、base OIDと両base SHA、head OIDとcandidate head SHAの一致を検証する。trusted SHAはremote default tipのancestorでなければならず、feature-only commit、非default base、provider不明を拒否する |
| `policy evaluate` | `--trusted`と`--candidate` | 許可は0、自己緩和はASC-TRUST-001を含む1 |
| `policy migrate` | trusted/candidate、`--dry-run`または`--apply`、state変更時はcall-siteの`--approved-plan-hash`と`--expected-revision` | plan、snapshot、history、rollback、retry、recover。state内の自己申告approvalをauthorityにせず、dry-runはfileを書き込まない |
| `review evidence` | `--repo --pr --run-id --review-id`と`H_impl/H_final`、artifact path | Gitと唯一のGitHub adapterから観測した二段階証拠。caller actor option、任意JSON、別PR run、不一致・未完了・自己reviewは非承認 |
| `review validate` | tracked review file | rubricと構造だけを検証する。file内のGitHub metadataをauthorityにせず、承認はtrusted provider観測待ちのpending |

外部authorityを要しないpolicy CLIはofflineで動作する。PR CIのexplicit authority検証などGitHub必須gateは接続障害・不完全な観測時に`pending`としてfail-closed（exit非zero）とし、local安全結果は保持して成功扱いしない。観測済みtupleと入力の不一致は`rejected`、検証中のtuple変更は`pending`として再実行を案内する。

`pr create --dry-run`も`--apply`と同じtrusted Git policyとownership evidenceの事前判定を必須とする。dry-runはGitHub/`gh`を呼ばずpreviewまでに限定し、applyはその上で明示authorizationを必須とする。trusted authority不明時はどちらもfail-closedにする。

PR CIで`origin/HEAD`がない場合も、workflowはevent値をquoted environment経由の明示入力とし、read-only tokenを使う唯一のGitHub adapterがexact repository/PRのbase ref/OID、head OID、repository default branchを再観測する。base refがobserved default branchで、observed base OIDが両SHAに一致し、そのSHAが`refs/remotes/origin/<default>` tipのancestorである場合だけauthorityとする。explicit modeのcandidateはfilesystemでなくprovider-observed head commitのGit objectからentrypointと全fragment inventoryを読み、manifestを正本として検証する。そのcommitにないhead、monolith、mixed inventory、orphan/missing fragmentをfail-closedにし、dirty/missing/orphan worktreeが検証対象を差し替えることを許さない。初回bootstrapのproject set不在はtrusted commit側だけに認める。候補側の環境変数やcheckout中のfile、feature-only commitをtrusted SHAの代替にしない。
