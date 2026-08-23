# CLI・GitHub契約

CLIは引数を構造化入力として受け、適用を伴う操作は既定でdry-runとする。外部プロセスは引数配列で呼び、`gh`操作は`src/adapters/github.js`だけに閉じ込める。

| 境界 | 事前確認 | 適用 | 適用後確認 |
|---|---|---|---|
| Issue同期 | 認証、完全なrepository同一性、staging構造 | create/edit | Issue番号、repository、本文hashを再読取 |
| PR作成 | 認証、base/head、HEAD SHA、同一SHAの証拠 | `Relates to #824`で作成 | URL、base/head、headRefOidを再読取 |
| review証拠 | exact repositoryと明示したH_impl/PR/run/review ID | read-only | commit author、PR current head/author、Actions event/head/conclusion/関連PR、immutable review commit/user/submittedAt/stateを再読取 |
| merge | 既定branch上policy、branch保護、check、approval | 許可されたmethodで実行 | merged SHAと状態を再読取 |

GitHubエラーは秘密情報を伏字化し、日本語で行動可能な診断を返す。

| Policy CLI | 入力 | 出力・終了code |
|---|---|---|
| `policy validate` | policy JSON。PR CIは`--trusted-commit`と`--expected-base-sha`にGitHub PR base SHAを明示 | 有効性、全error、v0.3にはv0.4 staged migration案。明示SHAは40hex・相互一致・repository内commit実在を検証 |
| `policy evaluate` | `--trusted`と`--candidate` | 許可は0、自己緩和はASC-TRUST-001を含む1 |
| `policy migrate` | trusted/candidate、`--dry-run`または`--apply`、state変更時はcall-siteの`--approved-plan-hash`と`--expected-revision` | plan、snapshot、history、rollback、retry、recover。state内の自己申告approvalをauthorityにせず、dry-runはfileを書き込まない |
| `review evidence` | `--repo --pr --run-id --review-id`と`H_impl/H_final`、artifact path | Gitと唯一のGitHub adapterから観測した二段階証拠。caller actor option、任意JSON、別PR run、不一致・未完了・自己reviewは非承認 |
| `review validate` | tracked review file | rubricと構造だけを検証する。file内のGitHub metadataをauthorityにせず、承認はtrusted provider観測待ちのpending |

外部接続を要しないpolicy CLIはofflineで動作する。GitHub必須gateは接続障害時にpendingとし、local結果を失敗へ読み替えない。

`pr create --dry-run`も`--apply`と同じtrusted Git policyとownership evidenceの事前判定を必須とする。dry-runはGitHub/`gh`を呼ばずpreviewまでに限定し、applyはその上で明示authorizationを必須とする。trusted authority不明時はどちらもfail-closedにする。

PR CIで`origin/HEAD`がない場合も、workflowがGitHub eventから明示したbase SHAだけをauthorityとする。explicit modeのcandidateはmanifestと全inventoryを持つfragmented setに限定し、monolith、project directoryとの混在、orphan/missing fragmentをschema分岐前からfail-closedにする。初回bootstrapのproject set不在はtrusted commit側だけに認める。候補側の環境変数やcheckout中のfileをtrusted SHAの代替にせず、checkoutはbase commitとその全fragmentをGit objectから読める履歴を取得する。
