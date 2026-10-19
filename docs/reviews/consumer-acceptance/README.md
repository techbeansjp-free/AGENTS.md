# 利用者シナリオによるASC v0.5受入調査

## 現在の目標と未達事項

PR #1606の現在の完了条件は[自律完走・品質・費用の受入条件](context-cost-plan.md#再設定した目標と完了条件進行中)を正本とする。下記C01–C23/J01–J06の導入・操作調査だけでは完了しない。性能改善と中断・再開を含む自律完走の目標は進行中である。

| Codex current-hostの実証 | 対象証拠 | 判定・限界 |
|---|---|---|
| 小規模の元要求からDraft PR/CI | [自動完走](native-auto-delivery-results.json) | 無介入の合成1件。任意Issueの保証ではない |
| 複雑な予約・請求Issueの分担・統合 | [複雑Goal](native-complex-delivery.json) | 実装・修復・独立レビュー・固定oracle・Draft PR/CI成功。4 Contextのusage取得 |
| 共有契約の変更と旧データ再実行 | [契約変更](native-shared-contract-delivery.json) | 元の安全条件と旧レコード互換性を含め完走。中断再開は含まない |
| 時間と全Agent tokensの削減 | [対比較集計](native-small-progressive-summary.json) | 2組で両指標の改善は不成立。5組の受入条件は未達。欠測・失敗を除外して合格にしない |
| 保存途中の中断から自律再開 | [中断再開](native-interruption-delivery.json) | Linuxの単一書込み担当で、保存後中断・全子終了・新Context継続からDraft PR/CIまで成功。複数worker同時中断や総tokensは未証明 |

主な利用HostとしてClaude Codeを評価する。上表はCodexの記録であり、Claude Codeの代用にしない。Claude Codeで確認した範囲は次のとおり。モデルは同HostのSonnetを使用し、Codexへ委譲していない。

| Claude Code current-hostの実証 | 対象証拠 | 判定・限界 |
|---|---|---|
| 小規模実装・独立レビュー・Draft PR/CI | [小規模](claude-small-delivery.json) | 成功。提出は評価用Host処理。製品単体の全自動提出を意味しない |
| 複雑な複数Issueの並列実装・統合 | [複雑Goal](claude-complex-implementation.json) | 分担・固定oracle・CIは成功したが、後続の反例で入力getter例外の見逃しを検出。初回品質合格に読み替えない |
| 共有契約変更・修復・再レビュー | [契約変更](claude-shared-contract.json)、[修復](claude-review-repair.json) | 保存レコード互換性と具体的な反例を確認し、修復後に独立レビュー・CI成功。全usageに欠測あり |
| 実Git競合・保存後中断・再開 | [中断再開](claude-conflict-interruption.json) | 同じHost sessionで保存済み成果から再開しCI成功。単一書込み担当のみ。停止・再開の起動は評価用Host処理 |
| 2workerの保存成果から統合・再開 | [worker再開](claude-worker-recovery.json) | 両worktreeの中断時bytesを最終commitへ保持、独立レビュー・6 oracle・Draft PR104の両CI成功。4 Contextの取得usage照合成功。片方は停止前に完了済み、評価器修復を挟むため無中断性能には不使用 |
| 複雑2 Issue・通貨契約変更の無介入実装 | [候補診断](claude-complex-currency-diagnostic.json)、[同条件の対照](claude-complex-currency-baseline.json) | 双方6 oracle・独立レビュー・Draft PR128/129両CI・全usage照合成功。候補568.65秒/3,740,727 tokens、対照398.88秒/2,849,262で改善不成立。候補の二重worktree起動とpatch転記失敗を既存Skillで是正。単発比較で性能保証とはしない |
| 時間・全Agent tokensの削減 | [登録有無の固定5組v8](claude-matched-v8/summary.json)、[v7](claude-matched-v7/summary.json)、[v6](claude-matched-v6/summary.json) | v8は同一alpha.36の登録有無のみを比較。全10件品質・usage・PR/CI成功。時間中央値103.19→96.19秒、tokens中央値362,563→395,352、最大値も悪化し性能不合格。費用対効果が成立せず未公開の登録機能を取り下げた |
| 取り下げた登録Reviewer候補の小規模Draft PR/CI | [配布・委譲](claude-registered-reviewer.json)、[提出まで](claude-registered-reviewer-delivery.json) | canonical手順を組み込んだ同一Reviewer定義を使用。提出HEADを承認したtaskの種別も照合。単発の実装・レビュー54.13秒、提出・CIを含め76.03秒・314,226 tokens、品質・全usage・PR136/CI成功。一般的な性能改善の証明ではない |

[登録Reviewerの複雑2 Issue確認](claude-registered-reviewer-complex.json)は、進行役による互換性修復・6 oracle・独立レビュー・Draft PR137/両CIまで完走した（全体530.64秒）。観測tokensは2,811,301だがworkerの終端usageが1件欠け、Hostのoutput集計との差は1,180。別ストリームにも終端がなく、補間せず性能判定を未成立とした。再実走で置き換えない。

[複雑ケースの修正後確認](claude-complex-currency-followup.json)はDraft PR130/両CI・全usage照合まで成功（561.82秒、2,891,961 tokens）。二重worker起動は解消したが、担当commitが返っても進行役はパッチを転記し、書出し先の拒否・再試行が残った。対照398.88秒/2,849,262を上回り、性能条件は未達。手順追記の効果を過大評価せず、追加cohortではなく保存ログから残るコストを分析する。

直近の原因別確認では、[同じworktreeへのレビュー依頼](claude-review-worktree-followup.json)が87.55秒・327,707 tokensでDraft PR115/CIまで完走した。別worktree作成は起きなかったが、レビュー手順の参照が依頼から欠落したため、依頼項目を整理した。この1件を固定比較の代替や性能改善の証明にはしない。 続く[依頼項目整理後の確認](claude-review-handoff-followup.json)では、手順参照の受け渡しと実読取り、同じworktreeでの独立レビュー、Draft PR116/CIまでを109.65秒・366,035 tokensで確認した。両記録を保持し、後者だけを選んで性能合格とはしない。 [読取り規則の配置変更後](claude-read-batching-followup.json)も品質・提出は成功したが、狙った一括化は徹底されなかった。追加の固定比較を繰り返さず、保存ログの呼出し内訳から改善対象を再検討する。

次の比較に備えた未公開固定artifactは候補alpha.30（SHA256 `a3fd341a65b486fe2ea0219627fc13e46e458304006c2afaa8598a354de8eb05`）と対照alpha.31（`ec96cc97194160af501ed3aafd776a2ea9ff4eb49eadcf193eb1ddb59a1b66c6`）。両者は現行runtimeが同一で、対照のSkillだけalpha.25の内容に戻した。v7として実走済みで、上表のとおり性能改善は不成立。結果を保持し、同条件の追加試行は打ち切った。

一般的な仮想設計問題だけをclaude-opus-advisorへ1回read-only諮問した（コード・PR情報・実測値は送信していない）。既存Git/テストの再利用、固定した比較条件、未達結果保持を採用する。全作業でcommitする案は権限と未commit成果保護のため採用せず、助言を性能・安全性の証明とは扱わない。先の非公開PR情報送信の拒否とは入力範囲が異なり、その承認待ちを解除したものではない。

実走で発生した `worktree-create --help` の全Usageエラーを修正し、標準4コマンドの個別helpを追加した。隔離した配布物の8通りのhelpで成功・副作用なしを確認。修正前の同じ呼出しはexit 1/872 bytes、修正後はexit 0/353 bytes（モデル呼出し0）。これはコマンド応答の改善であり、開発全体の時間・tokens改善を証明しない。

評価入力の不足も修正した（`bf4277c6`）：既知の検証argvを持つowner契約をAgent終了後ではなく起動前に読取り専用で渡し、終了後の内容一致を検査する。通信しない模擬Hostで起動時の6コマンド取得・書込み拒否設定・模擬実行の成功扱い拒否・未提出を確認した（モデル呼出し0）。これはsandbox強制の実証や性能合格ではない。従来の実走は契約提示条件が異なるので、新条件の比較試行へ混ぜない。

Hostごとの結果、任意snapshot Controllerの結果、評価者が計画・統合・修復した結果を合算しない。以下は以前からの導入・利用者操作調査の記録として残す。

登録Reviewerは比較後に配布実装から取り下げた。`--register-claude-reviewer`は現行CLIに含めず、別Contextの独立レビューと既存の手順参照は維持する。既存の利用者所有Agentファイルは削除しない。以下は取り下げた候補の実証記録であり、現行機能の案内ではない。

登録Reviewerの提出確認では、配布物から生成する定義をClaudeの`--agents`へ渡した。プロジェクトの`.claude/agents/`からの検出・委譲は別の配布試験で確認している。二つの起動方法を同一の実走として扱わない。

## 導入・利用者操作調査の範囲

利用者が実配布物を導入して開発・更新・復旧できることを、開発checkoutに依存しない隔離した疑似プロジェクトで確認する。既存unit test件数を利用者の一連の作業の完了証明へ読み替えない。

この導入・操作調査の確認範囲は、以下の各領域について、期待結果・対象版/commit・実行経路・結果・限界が対応し、既知の不具合が修正/再検証され、残存未確認事項が明示された状態とする。未実行を成功としない。PRのmergeとreleaseはこの調査の完了条件に含めない。

| 領域 | 利用者の目的・期待結果 | 現在の証拠 |
|---|---|---|
| 初回導入 | 配布tarballをoffline導入、既存manifest/lockfileを保存 | C01–C04 成功 |
| 既存規約 | scoped/nested規約を選び、欠落時は黙って省略しない | C05/C15 成功。意味的な遵守は未評価 |
| 非Git・統合親 | Git初期化を要求せず開始、複数repoの対象を混同しない | C02/C10 成功 |
| Git共有 | clone/worktreeで同梱本体を起動、ASC_CLI/外部prefix不要 | C06 成功 |
| 更新・版指定 | 一つのworktreeを更新しても兄弟worktreeは旧版で継続 | C07/C08 成功 |
| 更新競合・復旧 | ローカル編集のある資産を無断上書きせず、解消後再試行 | C09/C18 成功。Git apply中のfile-size障害で部分書込みを再現し、選択復元後に再更新。実ディスク枯渇/電源断そのものは未実施 |
| ビルド・依存 | 既存の依存symlinkを利用し、ignore生成物を維持 | C11/C19 成功。pnpm 10.0.0、TypeScript 5.9.3で2 packageを実ビルド・実行テスト。Reactは未実施。別途J01–J06でブラウザ/SQLiteを確認 |
| 失敗・再試行 | 失敗が別worktreeや次の正常検証を拒否しない | C12/C16 成功 |
| 検証の否定例 | 範囲外の変更、検証中のsource変更を成功扱いしない | C13/C14 成功 |
| 削除 | manifest列挙の配布資産のみ撤去、利用者成果/規約を保持 | C17 成功。hash不一致の編集済み配布資料を保存。文書に従う手動撤去でありuninstall CLIの実装ではない |
| 意味的実装・独立レビュー | 元要求から実装し、不足シナリオをReviewerが発見・是正 | J01–J06。親Hostが合成業務機能を実装、別Contextが未検査のemail反例を発見・是正。自動モデル起動のE2Eではない |
| PR・CI・後始末 | 正しいbaseへ提出、CI遅延/失敗を扱い、merge後に利用者資産を保護 | 外部提出は別のHost経路で合成PR #27へ到達、対象HEADのCI成功。merge後の整理は未実施（merge未承認） |
| 複数作業の調整 | 契約変更・依存・競合から復旧し、独立Issueを維持 | C20–C22成功。Hostの判断を固定した試験であり、AIの自律分解・再計画品質は未証明 |
| 別OS/Host | Mac/Windows、Codex/Claude Codeの実利用 | 本記録はLinux CLIのみ。他OSのCIをこの試験の実施とみなさない |

上表は実行済みシナリオと適用限界を示す。snapshot専用の状態管理を標準current-hostの実装済み能力と混同しない。過去の受入記録は対象commitと差分の適用範囲を照合してから再利用する。

## 再現方法と隔離境界

Linux、bubblewrap、Git、Node（npmを含む専用runtime prefix）が必要。

```sh
node scripts/run-consumer-scenarios.mjs
```

このdriverは配布用pack-candidateで未公開tarballを作り（公開版入力時は第1版を指定tarballで置き換え）、Node runtimeとOSコマンドをread-only、生成済みtarball・合成利用者データだけをwrite可能な`/work`として渡す。network/PID等のnamespaceを分離し、HOMEは空、環境変数はallowlist、開発repo・個人HOME・認証情報はmountしない。通常の製品起動にbubblewrapを必須化する変更ではなく、Linuxでの受入試験方法である。

`0.5.900-alpha.0/1`は更新・切戻し用の合成版番号。同じ製品ソースを異なる版番号でpackしている。公開版間の実コード差分を含む移行互換性は証明しない。版番号の合成を実リリースと誤認しない。

結果はdriverが出力する`/var/tmp/asc-consumer-acceptance-*`に保存。`provenance.json`に対象HEAD、tarball SHA256、隔離条件、所要時間、シナリオscript hashとpack内の全source hash、`results.json`にケース別結果を残す。用意したtarballから導入したCLIだけを実行し、製品モジュールを開発checkoutからimportしない。

## 2026-10-18の初回結果（合成版17ケース）

対象製品HEAD `d0cf43c5ae645a095b53d98f22b4955b0e5e30ed`。17ケース成功、隔離環境内の合計6.539秒（pack時間を含まない単発観測）。製品コードは本調査で変更していない。AI呼出し0回であり、モデルのレビュー品質・token消費・実開発の速度改善を示す数値ではない。

初回試験の失敗は試験側の3点（競合時exit 2の誤認、参照規約のコピー漏れ、合成依存のmain解決設定漏れ）だった。製品の期待動作を緩めず試験を修正し、空の環境で再実行した。今回の成功を「全機能に問題なし」や「全利用者シナリオの検証完了」とは扱わない。

独立レビューの指摘を受け、C12はexit 2・passed:false・検証コマンドexit 1を照合し、C17は編集済み配布資料をhash照合で撤去対象から除外する試験に補強した。公開版ではなく配布候補の試験であること、元ソースと試験scriptのhashを記録することも明確化した。

C02のpreview読取専用性は、実行前後の全ファイル内容hash・directory・symlink先・modeの同一性まで確認する。

## 公開済み版からの導入・更新

2026-10-18にGitHub Release v0.5.8の`agent-skill-chain-0.5.8.tgz`を取得し、配布側SHA256SUMSと一致を確認した。

- Release: https://github.com/techbeansjp-free/AGENTS.md/releases/tag/v0.5.8
- SHA256: `cd173b2240f3907421515160e1389edf81bd722f1d2d9dc3cf70554b3db93485`
- 公開側source commit: `c36e914af6bb4a2187261375f965820cb3a7578e`

```sh
node scripts/run-consumer-scenarios.mjs /absolute/path/agent-skill-chain-0.5.8.tgz
```

第1版にこの公開配布物、第2版に現在の配布候補を使い、同じシナリオで導入→更新→切戻しを確認する。公開版と候補の2つを、ともに公開済み版とは説明しない。公開版のダウンロードは試験外で行い、consumer sandboxにはネットワークを渡さない。

C18は検証専用Git shimが実際のgit apply子プロセスへfile-size制限を適用し、正常に書き終えられない状況を作る。製品や通常ユーザーへ制限を追加していない。部分更新したこと、CLIが成功を返さないこと、ownerの未commit編集が残ること、更新前inventoryの配布資産だけをrestoreすれば再実行できることを確認する。USAGEの通常更新手順へこの復旧方法を追記した。自動rollbackが実装済みとは扱わない。

## 追加結果（公開v0.5.8 → 配布候補、19ケース）

`published-results.json` / `published-provenance.json` が現在の追加試験結果。19ケースすべて成功。C19はpnpm 10.0.0とTypeScript 5.9.3の公式npm tarballをネットワーク外で取得し、sandbox内ではoffline installのみ実施。workspace linkを持つshared/appの両方を実際にtscでコンパイルし、appの実行結果をassertで確認した。検証対象は実在の利用者コードではなく合成コードであり、React・ブラウザ・DBの検証には代えない。

```sh
node scripts/run-consumer-scenarios.mjs /absolute/agent-skill-chain-0.5.8.tgz /absolute/tooling
```

`tooling`には`pnpm-10.0.0.tgz`と`typescript-5.9.3.tgz`を置く。省略時、C19はnot-runで記録する。driverは指定tarballの公開元を認証する機構ではない。公開版の入手先とSHA照合は上記の記録に基づき、任意に渡したファイルは単にsupplied-artifactとして扱う。CLIによる19ケースの成功は意味的レビュー・外部PR完走の証明ではない。

Toolingは公式npm registryの各固定版dist.integrity（SHA512）と実tarballを照合して`consumer-tooling.json`へpinした。driverは各tarballのSHA256と内包package name/versionを検査し、不一致ならsandboxへ渡す前に拒否する。

## 業務操作の受入（画面・API・SQLite、2026-10-18）

最新の設計入力は、画面単体ではなく利用者の目的を達成する一連の操作を小さな単位で実装し、正常系だけでなく回復・権限・server入力検証を確認すること。配布元 `skills/asc/SKILL.md` の実装・独立レビュー双方へ組み込んだ。新たな専用Agentや固定工程は追加していない。

合成要件 `test/fixtures/consumer-user-management/REQUIREMENTS.md` を基に親Hostが実装し、別ContextのReviewerが元要求から照合した。実ブラウザ試験は配布候補をoffline installした後、developをbaseとするworktreeで、同梱launcherの `start` と `worktree-verify` を使用する。検証はfixture原本ではなく、worktreeにcommitしたserver/pageを起動する。

- J01: 一覧・登録・頁移動・編集・取消・削除・再表示。
- J02: 入力不備と重複からの復旧、利用者文字列のHTML非実行。
- J03: UI迂回時の型・値・未知field・権限・存在チェック。不正emailのPOST/PUT拒否と保存データ不変。
- J04: 同時更新による古い編集の拒否、入力維持、再読込み。
- J05: 通信失敗時の入力保持と再試行。
- J06: server再起動後の保存状態。

初回は全ケース成功したが、独立Reviewerは未検査だった `a@@b.com` の受理を発見した。旧処理を隔離環境で再現すると期待400に対し201だった。合成実装を修正し、email4反例を追加した後も6ケース成功。別頁へ追加された登録結果には末頁への案内を表示する。これは合成アプリで見つかった欠陥であり、ASC runtimeの欠陥とは分類しない。

さらにworktree内のcandidateだけに旧email処理を戻してcommitした負例では、同じ配布CLIの検証がexit2・passed:false・テストexit1になった（`journey-negative.json`）。正しいfixture原本を参照するだけの偽陽性ではないことを確認した。元の成功対象commitは `journey-verification.json`、fixtureとtarballのhashは `journey-provenance.json` に記録した。

```sh
# 別のtooling prefixへplaywright-core 1.56.1を用意する。Chromeも必要。
node scripts/run-consumer-journey.mjs /absolute/browser-tooling
```

試験はLinuxのnetwork namespace内で完結。空HOME、認証情報なし、合成入力のみで、個人repoをmountしない。Chromeの内部sandboxを無効にする代わりに、全体をbubblewrap内へ隔離している。これは合成受入試験の構成であり、通常利用者のブラウザ/Host設定を変更するものではない。

単発観測はブラウザ6ケース2.200秒、CLI検証2.620秒、offline導入から検証まで3.648秒（pack時間を除く）。runner自身のモデル呼出しは0回だが、事前の親Host実装と独立レビューにはAIを使用している。総tokensとAI実装時間はこの計測に含まれず、費用削減やCodeRabbit同等性は未証明。少ない機構で具体的な不足を発見・修正できた一例として扱う。

固定dummy headerは権限別操作を模擬するだけで、実認証・session・CSRF・tenant保証は対象外。合成アプリの外部PR/CI、複雑Goalの再計画、Mac/Windowsの実走をこの記録で完了扱いにしない。レビュー完了を自動認定するコードも追加していない。

## 公開合成Draft PR・CIと失敗後の再開

[合成PR #27](https://github.com/adachi-tatsuru/asc-public-synthetic-eval-20261016/pull/27)へ提出し、HEAD `ce268b5e8887efc588e9f94fbb3ba619d6b793f1` の両CIが成功。配布CLIの検証HEADとPR HEADは一致する（`delivery-results.json`）。提出操作は認証を持つHost側で行い、networkを遮断したブラウザ試験と同じ隔離境界とは説明しない。

server/page/requirementsは隔離ブラウザ試験の入力とbyte一致を確認。追加APIテストとworkflowは別Contextでレビューした。CIはAPIと既存greeting oracleに限定し、画面操作やserver再起動後の永続化はローカルJ01–J06の証拠を併用する。外部CIでブラウザを実施したとは扱わない。

最初のCIでは既存合成fixtureの `Helo` が `Hello` oracleで失敗。既存oracleは変更せず、合成コードと弱い型だけのunit assertionを修正した。再レビュー・新commitのCLI検証・同じDraft PRへのpush・CI再観測で完走した。最初の失敗runも結果に残している。これはASC製品不具合でなく、既存fixtureの不具合からの通常開発復旧である。

提出時にはHTTPS資格情報未設定とOAuth workflow scope不足が発生した。本体PRでも使用している既存のSSH認証で同じ承認済み合成repoへ提出した。Token scope・Host設定・CI検査の緩和は行っていない。

公開差分は合成アプリ3ファイル、API試験1ファイル、PR workflow1ファイル、既存合成greeting修正2ファイルのみ。利用者コード・個人パス・認証情報・ASC導入資産・生ログを含めない。merge/releaseは実施していない。全開発wall timeと全Agent tokensは欠測であり、CI時間を開発総コストに代用しない。

## 複数worktree・契約変更・競合の復旧

`coordination-results.json` / `coordination-provenance.json` は公開v0.5.8からの利用者シナリオ22件すべてが成功した追加実行。C01–C19を維持し、以下を同じnetwork隔離環境と配布候補で追加した。

- C20: API変更をproducer、呼出側をconsumer、無関係な作業を独立Issueのworktreeへ分離。依存未統合時は実コマンドのAssertionErrorで拒否し、Gitで統合後に同じコマンドが成功。他worktreeのHEADは変わらない。
- C21: 受入済み候補の要求とAPIを変更すると、旧HEAD/contract hashとは異なり、新しい検証が失敗する。影響するconsumerのみ修正し、新しいCLIプロセスでGit/owner入力から再検証して成功。旧結果を自動失効する機構の証明ではなく、Hostが対象と契約を照合して再検証する経路。
- C22: 同一ファイルへの競合commitで実際にGit unmerged状態を発生させ、CLIが検証を拒否することを確認。同時に独立Issueの検証は成功。cherry-pickをabortすると元HEAD・内容へ戻り、その候補を再実装せず検証できる。

C20–C22は計約2.40秒の単発観測。意味的判断は事前定義したowner選択であり、runnerはAIを起動しない。共有領域を操作しないことと試験の偽陽性を別Contextでレビュー済み。実アプリをAIが自律分解する能力、未知のサービス間依存の発見、実モデルのContext圧縮からの復旧、並列プロセスの全競合を保証したとは扱わない。

## 目標に対する証拠の対応

| 今回の調査目標 | 証拠と判定 |
|---|---|
| 現行契約から利用者シナリオを定義 | 本表、C01–C22、合成業務要件とJ01–J06。標準current-hostと任意snapshotを区別 |
| 実配布物、隔離疑似利用者環境 | 公開tgz/SHAと候補pack identity、network namespace・空HOME・開発checkout非mount |
| 導入・起動・Git/非Git・複数repo/worktree | C01–C06/C10/C16。main/developと作業先の区別を確認 |
| 固有設定保護、更新・版指定・削除・復旧 | C05/C07–C09/C15/C17/C18。削除は資料に従う手動撤去で、自動CLIとは主張しない |
| 実装・ビルド・検証・独立レビュー | C11/C19、合成業務実装、別Context反例発見、J01–J06、意図的candidate退行の拒否 |
| PR到達・失敗時再開 | 合成PR27の同一対象HEAD/CI成功、初回CI失敗保持。C12/C18/C20–C22 |
| 再現した不具合だけの是正 | 今回のアプリemailと既存合成greetingを是正。ASC runtimeの新規欠陥とは扱わない。配布Skillと更新復旧案内を改善 |
| 回帰・配布整合性・コスト | 22シナリオ、package7件、Lint、Skill validator。原本/source/script hashを保存。決定論的処理のAgent起動0、総開発tokens/時間は欠測 |
| レビュー可能なPR、未承認操作を行わない | 本体PR1606と合成Draft PR27。merge/release・実利用者資産の変更なし |

残存課題は製品全体の追加保証であり、成功したシナリオへ含めない：実モデルによる複雑Goalの分解/再計画、全体コストの比較、別OS/Host実走、実認証、merge後の整理。特にmerge後整理は今回は未承認なので実行しない。今回の調査結果は既存不具合が皆無という宣言でも正式release承認でもない。

## 新規worktree命名の監査（2026-10-19）

正本USAGEの標準は `.worktrees/YYYYMMDD_HHMMSS-Issue番号-slug` と `type/Issue番号-slug`。CLIの `createWorktree` は既にこの形式を生成していたが、配布Skillには作成前の確認と具体的な形式が抜けていた。私たちの旧作業先 `20261018-consumer-scenarios` も時刻・Issue番号を欠いた。Skillを修正し、対象repoの明示規約を優先、新規標準作成、結果確認、Issue未指定時の扱いを明記した。既存名やプロジェクト独自名での再開を一律拒否しない。

C23は実配布候補CLIで標準worktreeを作り、directory・branch・base・実Git HEADと配布Skillを照合する。同名作成拒否、同Issue別slug分担、旧名での再開も確認。C01–C23すべて成功（naming-results/provenance.json）。C06などの任意名は既存/独自worktreeの互換性を試すための合成入力であり、新規作成例として推奨しない。過去の記録のpathも事実を保つため書き換えない。

ローカルの実作業先はreflogの作成時刻と対応Issue1579に基づき `20261018_210640-1579-consumer-scenarios`、local branchは `test/1579-consumer-scenarios` へ変更。既存PR接続のためremote head名は維持。利用者の既存worktreeを無断改名せず、配布元Skillの改善を次の配布へ反映する。今回検査した利用者環境は隔離した合成プロジェクトであり、実利用者環境を一括変更していない。


## Context・是正コストの追加調査

[比較条件・判断](context-cost-plan.md)とsmall/repair/multi/handoffのJSONに、同一モデルの旧・新Skill各1試行を記録した。全ケースの要件・独立レビューは合格したが、時間・tokensの一貫した改善は未証明。小規模に固定のAgent階層・Context交代を要求しない。引継ぎと階層化はHostが選択する指示であり、自動実行機能を追加したわけではない。

CodeRabbitの不正emailドメイン指摘は現行fixtureで再現した（POSTが400ではなく201）。ドメインラベルを検証する最小修正と拒否・許可境界を追加し、ネットワーク隔離された6操作シナリオを再実行して成功。最新fixtureの証拠は `domain-journey-results.json` / `domain-journey-provenance.json`。既存の外部Draft PR #27は旧fixtureの証拠であり、この修正を外部CIで検証済みとは扱わない。

複雑な予約・請求Issueの実モデル比較、共有契約変更、実Git競合、実装中断と別Context継続、レビュー指摘からの修復は [context-cost-plan.md](context-cost-plan.md) と `context-complex-results.json` に記録。固定の合成要求・直接管理するworkerによる試験であり、任意Goalの自律分解や全体費用削減の証明ではない。Claude Codeの入れ子・停止の限定観測は `claude-descendant-capability.json` を参照。
