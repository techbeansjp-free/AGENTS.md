# Issue #1576 隔離Candidate実走の固定費分析（2026-10-13）

対象はprivate dummy PR #4の隔離実走。固定基点`fabdfaae0c7d854b7b8336d3ed22288d0b283b66`で、最新CLIとdummy側の固定基点skill/template/policyを混用した探索試行である。Claude reviewerの認証失敗と手動再開を含む。旧ASC・ASCなしとの因果的な改善率には使わない。元rolloutのSHA-256はCoordinator `30866167c6efec00669fc225b4ab48fcc249a8b0543b3aa23e94721a01a21509`、fresh Step 1 `06e7e595e13fe860b4b889237367f0a8c4882e2be755c6ed68c42b4f612bd065`。会話本文やtool出力はこの集計に含めない。

Coordinatorの`token_usage_record` 47応答をresponse IDで重複排除し、実行timelineのUTC境界へ帰属させた。inputにはcache readを含む。工程の並列性を差し引いた削減可能時間ではなく、当該Coordinatorが順に処理した観測値である。

| 区間 | Coordinator処理tokens | 備考 |
|---|---:|---|
| 入口・事前判定 | 161,842 | 初回観測・導入確認 |
| Candidate実行 | 265,154 | Worker 55,139 tokensは別集計 |
| Step 0・staging | 45,311 | Candidate完了後 |
| Step 1実行中の親 | 1,028,122 | 18 tool call、うち11回がWorker待機poll |
| Step 4同期 | 220,256 | preview・applyを含む |
| review準備 | 859,088 | 10 tool call、3回の失敗CLI試行を含む |
| Claude認証失敗まで | 282,963 | reviewer使用量は取得できず`null` |
| 合計 | **2,862,736** | input 2,849,962、うちcache read 2,758,528、output 12,774 |

最大の3区間はStep 1実行中の親、review準備、Claude認証失敗までで、合計2,170,173 tokens（親の約75.8%）。親の各応答inputは最初16,869から最後95,034へ増加した。46 tool callと46 tool outputの出力文字数合計は178,026。cache readはinputの約96.8%であり、**処理tokensをそのまま請求額へ換算しない**。再読込・会話履歴・tool出力それぞれの寄与率はこのログだけでは分離できないが、Worker待機中に短間隔pollが繰り返され、親の履歴が後続応答へ再投入されたことは観測できる。

fresh Step 1 Workerは227.008秒、338,100処理tokens。9応答のうち04:27:05→04:29:30 UTCの145.116秒では`00_要求定義.md`の長い生成差分へ5,555 output tokensを使った。Worker全体のtool callは8回、tool outputは計63,222文字。区間のtool待ち時間と正確なcontext high-water markは取得できず`null`。この試行では正式要求文書の生成と親の短間隔pollが大きいが、各々の削減効果は未測定である。

次の実装は、完了したrolloutの応答単位usageを工程へ帰属し、無応答区間の0と欠測を区別することから始める。Worker待機中の不要な短間隔pollを抑え、正式Evidenceから取得できるHEAD・差分・検証状態の再探索を減らす。新たな永続cache、daemon、Hookは追加しない。これらの効果を同条件で測定する前に速度・token削減を主張しない。
