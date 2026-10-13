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

## 2026-10-14: 元rolloutでの失敗原因と対策

同じCoordinator rollout（SHA-256 `30866167...`）のtool呼出しを再確認した。Step 1 Worker実行中、親は04:26:42〜04:29:32 UTCに`write_stdin`を11回呼び、うち大半は`yield_time_ms=1000`だった。並行調査のtool出力も親履歴に追加されていた。待機方法を変えた場合のWorker実行時間への影響は測定していない。親の無内容pollと再投入される履歴は削減対象になる。現行`asc-step`には長めのhost待機を明示し、待機中の追加探索を止める。これはhost実装に依存する指示であり、削減量は次の同条件実走まで未測定とする。

review準備の失敗は、独立reviewの判定失敗ではなく経路・環境準備の失敗だった。

| 観測した拒否 | 原因 | 処置 |
|---|---|---|
| `candidate-adopt`が「detachedのCandidate結果用worktreeが必要」で拒否 | 元worktreeでStep 0/1/4のstagingを作り、候補commitを先に元branchへfast-forwardした | `workflow candidate`の返却`candidateWorktree`を正式stagingと採用previewの起点にする |
| `review round --init`が「Candidate結果worktreeに未記録の変更」で拒否 | stagingと配布資産を後から結果worktreeへ手動移動・コピーした | 最初から同worktreeにstagingを作り、資産は既存の正式install/updateで配置し、Git状態を確認する |
| `verify run --reuse`が「追跡fileと未追跡fileが現在HEADと完全一致するworktreeでだけ実行」で拒否 | dummyの依存物をsymlinkで結果worktreeへ持ち込んだ | 検証前に実際のworktree状態を確認する。trusted検証のclean-worktree gateは緩めない |

同rolloutには、存在しないStep 0 skill名の推測、`rg`の存在しない`docs/` path、`.git`をdirectoryと思って検索する失敗もあった。これらはASC CLIの故障ではなく、返却済みのSkill索引・Git worktree参照を使わなかった重複探索である。`review round --init`の`--base`・`--head`は実Git SHA、`--ac`・`--invariant`は封印済み00、`--out`はstaging外という既存contractを利用する。拒否後に別commandを試す前に、診断対象の状態だけを直す。

Step 1の長い出力は、既存の基準やCandidate差分から確定できる事実の再記述と、目的・AC・不変条件・設計判断の意味的確定を分ける。template契約は確認したうえで、生成済み00の変更欄だけを編集する。`issue validate`、Planning Seal、独立reviewは維持する。これらの案内変更だけで145秒の生成時間やE2Eの改善率を約束しない。

## 2026-10-14: Quick要求の証明責務による実行選択

実装先行のCandidateで小さな変更が済んでいても、従来経路はStep 1の別Workerで00を再生成していた。現行試行でこのWorkerは227.008秒、338,100処理tokensを消費した。これを削減可能量と同一視しない。今回、Step番号だけでWorkerを起動する選択を一部改め、隔離CandidateのGit出自・差分・HEAD、完成済み00の正式形式検証を再観測できるQuick Step 1では、既存`workflow advance`による記録を選ぶ。記録時もplan時のCandidate HEADを照合し、Git条件と文書を再検証する。条件が不明、出自がない、認可等の危険差分がある場合はfresh Workerの経路を維持する。

00の形式とStep 1 journal記録は要求・受け入れ条件・設計の意味的妥当性を証明しない。O-01〜O-03は記録後も`unknown`とし、現在HEADに拘束したStep 10独立review sessionが正式記録と一致するまで充足扱いにしない。Step 4の同期、Planning Seal、検証、独立review、Deliveryの既存gateは維持する。今回の変更はProof責務に基づく実行選択の一経路であり、全工程の実行制御を置換したものではない。

確認したBDDは、正常なCandidateでのWorker省略、Step 1だけの正式記録、Candidate出自欠落、危険path、plan後のHEAD移動、review失効とreview後修正commitを含む。これらは機能・安全の検証であり、実際の要求からPR/CIまでの時間や全Agent tokensの削減結果ではない。同条件の隔離E2Eと比較試行が完了するまでは性能受入条件を未達として扱う。
