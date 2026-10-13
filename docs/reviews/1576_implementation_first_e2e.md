# Issue #1576 実装先行の隔離E2E（2026-10-13）

## 結果と再現対象

同じprivate dummy repositoryで、通常の修正要求「`greeting()` の `Helo` を `Hello` に直す」を、Codex Candidate実装からASCの正式PR、GitHub CIまで通した。対象は [private dummy Issue #1](https://github.com/adachi-tatsuru/asc-1576-implementation-first-e2e-20261013/issues/1) と [private dummy PR #2](https://github.com/adachi-tatsuru/asc-1576-implementation-first-e2e-20261013/pull/2)。PRはopenで、merge・releaseしていない。GraphQLiteは導入していない。

- 基点 `fabdfaae0c7d854b7b8336d3ed22288d0b283b66`。隔離Candidate HEAD `3a7508841439665533adc29eaa80d832069fd574`。review Evidenceだけを追加したfinal HEAD `cf9aebd95da00d276604df011285f1c21a2ee581`。PRのbase/headはGitHubから再観測した。
- `workflow candidate`の事前判定はcandidate、Codex Workerの結果は`authority:none`。元Candidate worktreeは未変更。結果用worktreeの許可された2ファイルだけが変わり、対象テストはCLI観測でexit 0（正式Evidenceではない）。
- fresh Codex reviewerが基点から実装HEADまでの全差分を独立検分し、指摘なし。Claude Opusへの独立検分も試みたがOAuth期限切れで使用量0・検分なし。正式review roundのdigestは`d0512f7e37cf3210c7f8a10f3f4728c051f82120bed38b671ba61a221c92f99d`。
- quick Step 0/1/4、private Issue同期の読み戻し、Planning Sealを通し、`candidate-adopt`が同一base・HEAD・reviewの収束を再観測して正式Step 9を記録。採用previewの出自表示は`git-lineage-only`、`coordinatorOriginVerified:false`であり、Coordinator出自を証明済みとは扱わない。
- trusted `verify run --scope=full -- node --test`は実装HEADで9件成功、0件失敗。記録digestは`edea740a450d449f5dac5637c38d602354aec371aeacea9ce8bcc8316392c8df`。Step 10は採用前と同じreview sessionを再利用し、fresh reviewerを再起動せず、review exportとEvidence-only commitを正式記録した。別途、実装済み`greeting()`をimportして`assert.equal(greeting(), "Hello")`を実行する独立oracleも成功した。
- `pr create`の正式gateでPR #2を作成し、Step 11は`pull_request_complete`。GitHub Actions `test`はbranch pushとPRに対応する2 runとも成功（11秒・12秒）。
- 同じ基点の別隔離worktreeで認可変更を事前判定し、`authorization:triggered`に対して`route=upstream`、Worker・Git変更なしを観測した。正しさの基準が空で認可riskが`unknown`の入力は`route=clarify`で停止した。両結果とも`authority:none`、`formalWorkflowUnchanged:true`で、riskの出所はcaller申告として表示された。

## 測定値と限界

Candidate WorkerのProvider報告値はinput 99,063、うちcache read 90,112、cache write 0、output 576、reasoning output 10 tokens。Worker実行時間は34,853 ms。これはWorker一人分で、Coordinator、独立reviewer、CLI内処理を含む全Agent総tokensではない。未観測値は`null`として扱い、inputとcache readを足して二重計上しない。

quick staging作成時刻は2026-10-13 01:03:16 UTC、PRのGitHub作成時刻は01:09:15 UTC、PR CI完了は01:09:32 UTCで、**staging作成→PR CI完了は376秒**。Candidate実装はstaging作成より前に行ったため、これを要求→CI時間とは呼ばない。候補実装開始時刻、独立Reviewer tokens、全Agent tokens、正確なcontext high-water mark、同一条件の旧ASC・ASCなし試行は未測定。この一例から速度やコストの削減率は算出しない。

親Codexのlocal session JSONLに残る`token_usage_record`を、Issue作成（00:59:17 UTC）からCI完了（01:09:32 UTC）までの同一`root_turn_id`に限定し、`response_id`重複を除いて再集計した。45 call、input 4,503,186（うちcache read 4,303,616）、cache write 0、output 4,050（うちreasoning 1,405）、処理tokens 4,507,236。cache readはinputの約95.6%で、新規inputとoutputの和は203,620 tokens。最大観測input/callは136,145であり、正確なcontext high-waterではない。Candidate Workerと合わせた観測下限は4,606,875で、独立Reviewer usageが欠測のため全Agent合計ではない。請求額・tool待ちは未取得で、cache readをinputへ再加算しない。

この親ログを取得可能な2区間だけで切ると、Issue作成→quick staging作成の239秒に10 call・1,128,773処理tokens、staging作成→CI完了の376秒に35 call・3,378,463処理tokensがある。後者に親処理tokensの約75%が集中した。ただし、Candidate実装・review・verification・Deliveryの個別開始終了時刻は揃わず、後者のどの操作が主因かは特定できない。`scripts/report_codex_e2e.ts`はhost JSONLと`codex exec --json`の`turn.completed`を同じ計数規則で集計し、manifestに列挙したAgentの欠測を`null`で示す。次回は各Worker/Reviewerの生JSONLと工程境界時刻をその場で保存して比較する。会話本文とtool入出力は集計結果に含めない。

基点commitは既存のAケース試行（`docs/reviews/1576_performance.raw.json`の`revisionConsistentAFullE37.fixedFixtureSha`）と一致する。旧ASCは要求→CI 1,194.33秒、全Worker処理tokens 6,673,928、ASCなしは94.06秒・168,829 tokensの各単発観測が記録されている。一方、今回の新方式はCandidate開始を含む要求→CIと全Agent総tokensを取得しておらず、前後の配布物とアクセス可能資料も同一と証明できないため、数値を同条件の改善率へ変換しない。

このE2Eは一件の明確な低リスク変更で、実装先行の正式Delivery到達とreview再利用を示す。認可や未確定仕様は既存のrisk判定・quick失格と上流Stepへ送る。標準入口の広範な性能優位性や安全同等性を、この一件だけで主張しない。
