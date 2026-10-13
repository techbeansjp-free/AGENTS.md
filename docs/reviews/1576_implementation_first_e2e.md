# Issue #1576 実装先行の隔離E2E（2026-10-13）

## 結果と再現対象

同じprivate dummy repositoryで、通常の修正要求「`greeting()` の `Helo` を `Hello` に直す」を、Codex Candidate実装からASCの正式PR、GitHub CIまで通した。対象は [private dummy Issue #1](https://github.com/adachi-tatsuru/asc-1576-implementation-first-e2e-20261013/issues/1) と [private dummy PR #2](https://github.com/adachi-tatsuru/asc-1576-implementation-first-e2e-20261013/pull/2)。PRはopenで、merge・releaseしていない。GraphQLiteは導入していない。

- 基点 `fabdfaae0c7d854b7b8336d3ed22288d0b283b66`。隔離Candidate HEAD `3a7508841439665533adc29eaa80d832069fd574`。review Evidenceだけを追加したfinal HEAD `cf9aebd95da00d276604df011285f1c21a2ee581`。PRのbase/headはGitHubから再観測した。
- `workflow candidate`の事前判定はcandidate、Codex Workerの結果は`authority:none`。元Candidate worktreeは未変更。結果用worktreeの許可された2ファイルだけが変わり、対象テストはCLI観測でexit 0（正式Evidenceではない）。
- fresh Codex reviewerが基点から実装HEADまでの全差分を独立検分し、指摘なし。Claude Opusへの独立検分も試みたがOAuth期限切れで使用量0・検分なし。正式review roundのdigestは`d0512f7e37cf3210c7f8a10f3f4728c051f82120bed38b671ba61a221c92f99d`。
- quick Step 0/1/4、private Issue同期の読み戻し、Planning Sealを通し、`candidate-adopt`が同一base・HEAD・reviewの収束を再観測して正式Step 9を記録。採用previewの出自表示は`git-lineage-only`、`coordinatorOriginVerified:false`であり、Coordinator出自を証明済みとは扱わない。
- trusted `verify run --scope=full -- node --test`は実装HEADで9件成功、0件失敗。記録digestは`edea740a450d449f5dac5637c38d602354aec371aeacea9ce8bcc8316392c8df`。Step 10は採用前と同じreview sessionを再利用し、fresh reviewerを再起動せず、review exportとEvidence-only commitを正式記録した。別途、実装済み`greeting()`をimportして`assert.equal(greeting(), "Hello")`を実行する独立oracleも成功した。
- `pr create`の正式gateでPR #2を作成し、Step 11は`pull_request_complete`。GitHub Actions `test`はbranch pushとPRに対応する2 runとも成功（11秒・12秒）。

## 測定値と限界

Candidate WorkerのProvider報告値はinput 99,063、うちcache read 90,112、cache write 0、output 576、reasoning output 10 tokens。Worker実行時間は34,853 ms。これはWorker一人分で、Coordinator、独立reviewer、CLI内処理を含む全Agent総tokensではない。未観測値は`null`として扱い、inputとcache readを足して二重計上しない。

quick staging作成時刻は2026-10-13 01:03:16 UTC、PRのGitHub作成時刻は01:09:15 UTC、PR CI完了は01:09:32 UTCで、**staging作成→PR CI完了は376秒**。Candidate実装はstaging作成より前に行ったため、これを要求→CI時間とは呼ばない。候補実装開始時刻、親Agent tokens、全Agent tokens、context high-water mark、同一条件の旧ASC・ASCなし試行は未測定。この一例から速度やコストの削減率は算出しない。

基点commitは既存のAケース試行（`docs/reviews/1576_performance.raw.json`の`revisionConsistentAFullE37.fixedFixtureSha`）と一致する。旧ASCは要求→CI 1,194.33秒、全Worker処理tokens 6,673,928、ASCなしは94.06秒・168,829 tokensの各単発観測が記録されている。一方、今回の新方式はCandidate開始を含む要求→CIと全Agent総tokensを取得しておらず、前後の配布物とアクセス可能資料も同一と証明できないため、数値を同条件の改善率へ変換しない。

このE2Eは一件の明確な低リスク変更で、実装先行の正式Delivery到達とreview再利用を示す。認可や未確定仕様は既存のrisk判定・quick失格と上流Stepへ送る。標準入口の広範な性能優位性や安全同等性を、この一件だけで主張しない。
