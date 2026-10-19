# Contextと是正コストの比較

対象: PR #1606。性能改善は未証明。利用者から提供された集計・プロジェクト情報・ログは転載しない。

## 再設定した目標と完了条件（進行中）

以前の「レビュー可能なPR」の完了判定を撤回する。以下を満たすまで、本目標を完了にしない。過去の試験は個別の根拠として残し、人手の統合・修復を自律成功へ読み替えない。

- 主対象は標準current-host/worktree経路。ownerの元要求、許可範囲、必要な依存と検証環境から開始する。別Hostを強制せず、CodexとClaude Codeの結果を分ける。
- 主要な利用環境はClaude Code。Claude進行役→Claude委譲で小規模・複雑な複数Issue・復旧・Draft PR/CIを受入対象とする。Codex専用試験をClaudeの成立証拠に代用しない。モデルは利用者指定を優先し、比較時は実モデルIDとeffortを記録する。Claudeの子・孫管理は版ごとの実測で判断し、未確認機能を前提にしない。
- 小規模・指摘修復・複雑な並列Issue・共有契約変更・競合・中断再開を対象にする。必要な判断、実装、独立レビュー、是正、統合を実Hostで行い、許可済み合成repoのDraft PRと対象commitのCI成功まで追う。
- 実装・計画・競合解消を評価driverが代行した場合は介入として失敗/未達を記録する。自動継続に必要な仕様質問は記録し、事前確定済みの合成要求ではownerへの追加判断なしを合格条件とする。権限の追加を勝手に認めない。
- 固定oracle、未公開の反例、元要求からの独立レビューを全て満たし、未解決の契約違反がないこと。変更範囲、依存Issueの成果、再開時の保存内容、提出commitを確認する。
- baselineは改善前の同じ実行経路・配布版を固定する。同一fixture/model/effort/依存/oracleで5組の対比較を行い、順番を交互にする。cacheは実測・別記し、統制できなければその条件の結果に限定する。通常の小規模ケースから開始し、修正が必要な場合は残る高価な試行を開始しない。
- 開始からDraft PR/CI確認までの実時間と、進行役・担当・Reviewer・再試行のinput/cache/output/呼出し数を集計する。CI待ち時間とモデル処理時間を分ける。欠測があれば総量の改善は未達とする。
- 品質成功率を下げず、時間と総processed tokensの対比較中央値が両方改善し、最悪値の悪化も説明可能であること。全試行を公開し、単発の最速値や別のfixtureとの倍率を採用しない。5組の結果はその評価範囲の実証であり、任意の開発への普遍保証ではない。
- 最小実装を優先し、試行回数を重ねるだけで未達を隠さない。未達の原因を修正し、条件変更後は旧結果と分離する。PR #1606で継続し、merge/releaseは行わない。

上記は新しい受入条件であり、実装・実証済みではない。snapshot専用Controllerの成功を標準Host経路の保証へ流用しない。

## 問いと変更範囲

標準current-host経路のSkillはContext寿命をHostへ委ねる。snapshot経路のfresh contextやController内usageだけから、標準経路の費用削減を推定できない。今回の候補はIssue単位の必要な分担、成果を保持したContext引継ぎ、PR後の差分中心の是正である。自動交代エンジン、固定Agent階層、時間切れによる成果破棄は追加しない。

仮説: 全体進行役が詳細履歴を保持せず、担当が必要な資料だけ読むことで再読込みを減らせる。一方、引継ぎ、追加起動、Skill本文の増分で小規模変更は悪化し得る。Agent数の減少だけでは仮説を支持しない。

## 比較条件

baselineは9f19ce4bd76a8e59eedd01adec8ec8a3a825fea7のSkill。候補との差はSkill指示のみとし、同じ合成ソース・要求・モデル・oracle・開始終了条件を使う。秘密情報、利用者コード、実際の利用者Issueは投入しない。モデル実行と決定論的シナリオ試験の結果を分離する。

| シナリオ | 品質oracle | 観測対象 |
| --- | --- | --- |
| 小規模変更 | 要求した変更と回帰テスト、無関係な変更なし | 不要な担当追加、開始からレビュー完了まで |
| PR後是正 | 再現する欠陥の修正、解決済み指摘の再発なし、影響先の回帰 | 再調査・再実装、古い結果の誤再利用 |
| 複数Issue | 独立Issueと契約依存Issueの統合、成果保持、Issue境界 | 親/担当の重複読込み、引継ぎ後の正しさ |

現行の単一進行役と、候補指示で選択された実行構成を比較する。階層を必ず使わせず、選択された担当構成と理由も記録する。比較対象ごとの新しい作業領域とContextを使用する。試行順と試行数を明記し、単発結果を一般的な性能優位としない。

時間は準備・実装・レビュー・是正を区別する。usageはproviderの定義を記録し、cache等の部分集合を重複加算しない。読込みの重複は同一内容の再取得と変更後の必要な取得を区別する。欠測はnull/未取得とし、ゼロ補完しない。非公開の会話全文をEvidenceへ保存しない。

## 受入状況の参照先

最新の実証・未達事項は[利用者受入調査の冒頭](README.md#現在の目標と未達事項)へ集約する。以下の表はClaude修復・worker再開・固定5組比較を反映する前の棚卸しとして保存する。現在の合格判定には使用しない。

### 過去の受入棚卸し

| 要求 | 現在の証拠 | 未達・限定 |
| --- | --- | --- |
| 標準Hostと任意Controllerの責務分離 | 本文の実装照合、current-host実走 | Controllerの成功を標準Host全体へ流用しない |
| 小規模の実装→レビュー→Draft PR/CI | Codex各試行、Claude `claude-small-delivery.json`・PR85 | Claudeの実装/レビュー成功・usage照合済み。Host提出scriptは評価者が実走後作成。五組の性能比較は未合格 |
| 複雑な複数Issueの並列実装・統合 | Codex PR69/80、Claude `claude-complex-implementation.json`・PR86 | Claude2 Issue・統合・独立PASS・5 oracle・CI成功。ただし追加の入力取得例外反例に失敗し品質受入は未達。Codex80は手動復旧あり |
| 指摘修復・独立再レビュー | `native-input-boundary-pilot.json`、PR68と`native-review-turn-audit.json` | alpha.13で無介入修復・再レビュー。alpha.14では修復未発生のため同じ実証とは扱わない |
| 共有契約変更・旧保存データの再利用 | `native-shared-contract-delivery.json`、PR32 | 単一の明示的JPY変更での実証 |
| 競合からの回復 | `native-conflict-recovery.json`、PR61 | 明示的な事前故障注入。任意の競合を保証しない |
| 中断時の並列成果保持 | `native-worker-write-recovery.json`、PR77 | alpha.15で別々のworkerの未commit成果を統合前に中断し、同一内容を復旧・レビュー・Draft/CIまで保持。中断区間usageは不完全。worker命名逸脱あり |
| 同一進行役セッションでの継続 | `native-clean-same-session-continuation.json`、PR69→70 | alpha.14で無介入の共有契約変更・旧データ互換・独立レビュー・CIまで成功。任意長期の継続保証ではない |
| 品質を保つ時間・tokens削減 | `native-small-scope-summary.json`、`native-review-worktree-pilot.json` | alpha.14の新規2組は両方悪化し早期終了。alpha.15でレビューの余計なコピーは解消したが、時間・tokens双方の改善は未証明。五組の合格比較なし |

全体目標は未完了。過去の成功は記録したcommit・条件に限る。以下は時系列の実験履歴であり、後から判明した欠陥や介入を無視して現在の合格判定に読み替えない。

## 初期段階の証拠（履歴）

- Skillの構文検査: 成功。動作・性能の証明ではない。
- 別Contextの独立設計レビュー: 具体的な矛盾・品質後退の指摘なし。性能比較ではない。
- 配布テスト: `TMPDIR=/var/tmp npm run package:check`、7件成功・失敗0。配布・導入互換性の確認であり、Context戦略の性能試験ではない。
- モデルによる同条件比較: 小規模の実装部分を各1回実施（`context-small-results.json`）。両方のoracle成功、同一モデル・medium・fresh context。旧15.43秒/77,140 processed tokens、新15.76秒/68,230 processed tokens。単発・cache条件未統制であり削減効果は未証明。各1回のまとめたソース読込みで重複読込みなし。子Agent無効のため階層選択は未評価。修復・複数Issue・引継ぎの観測は後述。独立Reviewerのusage・時間は未取得。

比較で品質が落ちる場合は候補を是正する。改善しない構成を既定にせず、条件付き選択の妥当性を再評価する。merge/releaseは本作業の対象外。

## 修復ケースの観測

`context-repair-results.json`: 旧30.81秒/99,738 processed tokens、新32.79秒/104,706 processed tokens。両方とも全件数の欠陥を修正し、既に拒否するpage 0の指摘と範囲外のclass化を見送り、独立レビューとテストに合格した。新Skill側はこの単発では低コストになっていない。新側の修正後読戻しは変更済み内容の確認であり、不要な同一内容の再読込みとは数えない。長寿命Contextからの再開や実PRでの追加指摘は未再現。

## 複数Issueの観測

`context-multi-results.json`: 旧62.54秒/191,436 processed tokens、新60.60秒/168,164 processed tokens。Aの価格契約、Aに依存するBの集計、独立Cの表示を同一の許可範囲で実行した。両方の外部oracleが成功。担当分割を利用可能にしても両者は小規模・共有テストを理由に単一writerを選んだ。階層化や並列化を実際に行った試験ではない。候補はCに要求されていない不正値のRangeErrorも追加したため、指定入力で合格しても出力や作業量が完全に同一とはしない。

この3ケースは各1回の限定観測であり、長寿命Contextのtoken膨張を再現していない。小規模では不要な分担を選ばないこと、既存成果を壊さず必要な修正・統合ができることは確認できるが、階層担当・Context交代による削減効果は未確認。追加Skillを理由に高速化完了とは報告しない。引継ぎの限定確認は次節。

## 引継ぎケースと判断

`context-handoff-results.json`: 共通の完成済みA/B/Cファイルと元要求・許可範囲・旧テストの適用範囲を記した短い引継ぎを新Contextに渡し、Dの追加変更を実行。旧36.51秒/144,622 processed tokens、新40.62秒/146,136 processed tokens。両oracle成功、別Issueの価格・表示ファイルはbyte一致で保持した。実行ハーネスが交代を行った試験であり、自動交代や長い会話を継続する場合との速度差を証明しない。

結論: 全4ケースで指定要件の品質を維持したが、時間・tokensの一貫した削減は示されなかった。小規模への固定階層や交代閾値は導入しない。追加Skillは必要な場合の責務分担・引継ぎ・PR後是正を明確にする指示として扱い、性能最適化済みとは表示しない。階層委譲が常に有利だという根拠は得られていない。

現行実装で直接確認したこと: 標準current-hostの`start`は作業場所・規約参照を返し、会話の寿命を管理しない。`src/project-context.mjs`は規約本文でなく参照を返す。任意snapshotの`src/restricted-agent.mjs`はfresh contextを確認するが標準経路ではない。`v05/report_workflow.mjs`はControllerが記録した呼出しを集計し、標準Host全体やPR後の会話を網羅しない。従って、標準経路の長寿命Context・親子の重複読込み・PR後是正が原因という説明は、利用者集計と整合する仮説であり因果確定ではない。

計測上の制限: 試行は各1回、順序は旧→新でcache未統制。独立レビューは別途実施したがその時間・usageは欠測。費用換算は行わない。再読込みはログ上の内容取得で評価し、変更後の確認を同一内容の無駄な再取得と混同しない。利用者の非公開資料は転載せず、公開Evidenceは合成入力・出力に限定する。

引継ぎログでは旧側がHANDOFF/REQUIREMENTSを変更前に2回読み、新側は各1回だった。変更後の実装・テスト読戻しは両側にあり、必要な検証として別扱いにした。これは取得コマンドの観測であり内部Context長ではない。読込みの重複が減ったケースでも総tokens・時間が減るとは限らなかった。

## 複雑な並列Issueの受入条件

ユーザー指摘により、小規模な複数Issueでの成功を完了根拠にしない。以下を**同じPR #1606内で**実施・是正した。別PRへの先送りは禁止。

合成の予約・請求を使う（`test/fixtures/complex-issues/REQUIREMENTS.md`）。各Issueが永続化、権限/tenant境界、入力拒否、冪等性、状態遷移を持つ。単一進行役方式と、全体進行役が別ContextのIssue担当を管理する方式を、同一要求・oracleで比較する。実際の別worktree・並列稼働を確認し、一覧上の役割名だけを委譲実績にしない。

1. 独立した予約/請求を同時に実装し、実予約eventで統合する。
2. 共有event契約を明示的に変更し、影響するIssueだけ再評価する。
3. レビューで欠陥を発見し、片側修復中も他方の成果を維持する。
4. Git競合・担当交代を発生させ、writer重複なく再開・統合する。

進行役・Issue担当・独立Reviewer・統合・是正を計測対象とする。未取得usageや終了未確認の配下を除外して全体完了とは言わない。Hostが孫まで観測/停止できない場合は、Issue担当から分担案を受け、全体進行役が直接管理するAgentへ割り当てる。固定階層のエンジンは追加しない。

現Hostの限定診断は`descendant-host-probe.json`。親終了後も孫が生存したが、rootから直接一覧・連絡・interruptが可能だった。OS子プロセス終了は未確認であり、Agent停止と同一視しない。

Claude Codeについては`claude-descendant-capability.json`に公式資料とローカル2.1.282の実測を分離して記録した。認証更新後、実際の二段のAgent起動を統計とtool呼出しで確認。親が返した孫IDにメインからSendMessageを送り、再開受付とTaskStop成功を観測した。応答ACK、ID未知時の全配下一覧、OS子プロセス終了、過去版の同等能力は未証明。Agent Teamsの入れ子禁止を、通常subagentの入れ子禁止と混同しない。

複雑ケースの比較は同じSkillの**実行戦略比較**であり、旧/新SkillのA/Bではない。旧/新Skillの限定比較は前節の4ケースに限る。`prepare-complex-context.mjs`が固定Skillと同一契約からGit worktreeを作り、`run-complex-context.mjs`が単一Contextまたは計画Context＋並列Issue担当を起動する。後者は計画Agentの出力をdriverが担当へ渡し、メインが直接各プロセスを所有する構成であり、孫Agent方式を実走したと扱わない。

試験準備の独立レビューで、返却値の凍結を誤って拒否するoracleと、Skillの実行間変化・driver終了判定の弱さを指摘された。凍結した独立オブジェクトも受理し、同じ固定Skillを照合し、Agent非0終了とdriverによる独立oracle結果を別々に判定するよう是正した。開始済み単一側には同じoracle修正を適用して独立再実行した。比較に使う原ログ・修正版oracle・対象commitの対応を残す。

## 複雑ケースの実測

`context-complex-results.json`には合成の出力ソース、対象commit、各Contextのusage・時間・レビュー判定を保存した。初期実装は単一担当170.93秒、計画担当72.49秒＋並列の予約140.98秒/請求286.54秒。後者の請求担当は追加検査のstdin/TTY操作に手間取り、並列化そのものの因果効果と混同できない。

単一側は最初の独立レビューで未知の非列挙/symbolキーを受理する欠陥が見つかった。新Contextで両Issueを順次修復し、予約修復中の請求ファイルbyte一致、固定oracle・新しい反例・統合・再レビューPASSを確認した。並列側は初回の独立レビューPASS。ここまでの観測processed tokensは単一1,283,594（5呼出し）、計画＋並列1,414,154（4呼出し）。cacheはinputの内数、root作業費用は欠測であり、課金額・全体費用・一般的な速度改善を示す数字ではない。レビューは別試行の実装と時間的に重なったため、phase時間から厳密なE2E倍率を作らない。

後続の共有契約変更では、別worktree・新Contextの2担当がJPY属性の追加と検証を更新した。既存DB・保存済み冪等結果の読戻し、実予約eventからの請求、拒否後の同じkeyでの再試行が成功し、独立レビューもPASS。計画専用Agentは追加しなかった。この別要求での時間を初期実装と直接比較しない。

共有要求文の競合をdriverが意図的に注入し、Gitのcherry-pick失敗を実際に確認。明示したREVISIONから共有記述を統合し、両サービスの実装を保持した状態で再検証した。任意の競合をASCが自動解決する機能の証明ではない。複雑な予約Issueを実際のファイル変更後に中断し、元プロセスの終了後に新Contextへ引き継いだ。保存済みソースのSHA-256は再開前後で一致し、追加編集せず予約・請求・統合・既存DB互換oracleを通過した。中断した呼出しのusageは欠測であり、再開分だけを全体コストとは扱わない。Claudeの小さなcheckpoint試験とは別の実測である。

判断: 同じ内容の計画を追加Agentへ再調査させる費用が観測された。担当範囲・依存・要求が既に明確なときは進行役が直接割り当てるようSkillを補足した。この追記の性能効果は未測定。固定の階層数・Context寿命・時間上限は追加しない。

再実行用入口（モデル利用には認証・利用枠が必要。合成専用）:

```sh
node scripts/prepare-complex-context.mjs /absolute/packaged/bin/asc-v05.mjs > setup.json
node scripts/run-complex-context.mjs setup.json single /absolute/codex
node scripts/integrate-complex-context.mjs setup.json single
node scripts/review-complex-context.mjs setup.json single /absolute/codex
node scripts/run-complex-context.mjs setup.json coordinated /absolute/codex
node scripts/integrate-complex-context.mjs setup.json coordinated
node scripts/review-complex-context.mjs setup.json coordinated /absolute/codex
node scripts/prepare-complex-revision.mjs setup.json
node scripts/run-complex-context.mjs setup.json revision /absolute/codex
node scripts/integrate-complex-context.mjs setup.json revision
node scripts/review-complex-context.mjs setup.json revision /absolute/codex
node scripts/summarize-complex-context.mjs setup.json results.json
```

独立レビューを実行する前に統合HEADの証拠と実体を照合し、未統合・古い対象をモデル起動前に拒否する。上記の標準統合コマンドは競合を勝手に解消しない。今回の競合注入・限定是正・中断試験は追加操作として記録しており、標準コマンドを順に実行しただけで全障害ケースまで再現したとは扱わない。

再開後の独立レビューでは、旧請求の冪等記録をJPY付きで再実行するとCONFLICTになる欠陥が判明した。先のrevisionレビューPASSと旧oracle成功はこの経路を保証していなかった。旧BillingServiceで記録したDBを新版で開く反例を追加し、修正前の失敗と修正後の成功を確認した。請求だけを別Contextで是正し、予約・請求・統合・旧DB互換を再検証した。初回PASSを無かったことにせず、後続FAIL・是正をEvidenceに併記する。

中断試験の原記録はexit時点で取得したため、usage末尾の取得完全性も未保証。今後の再実行用scriptはstdioが閉じるclose後に記録するよう独立レビュー指摘を反映した。欠測を0へ変換しない。

請求修正後の独立再レビューはPASS。旧記録の払込・返金後リプレイ、権限/tenant境界、無効通貨、別入力、複数instance、再起動、失敗keyの非消費を確認した。修正後HEADは`0a0c578fee0766487d8065ed5b39b650c696fc9b`（合成repo）であり、ASC本体のcommitとは区別する。

## 集計器の再レビュー

PR #1606の再レビューで、集計器がHostのGit参照環境を引き継ぐ点と、export時点のoracle hashを過去実行時のhashと誤認できる点を是正した。Git場所指定環境を除外し、`oracleHashesAtExport`と適用範囲を明記する。過去のoracleを現在のファイルから復元したとは主張しない。call単位のusage欠測も明示する。旧集計器は汚染Git環境で失敗し、修正後は通常環境とbyte一致。専用回帰テスト、保存ソース12件のhash、usage合計、失敗/再レビュー記録の保持を確認した。AIの再実行は不要で、既存の原記録から再集計した。

### 最初の実装改善：規約探索内の重複読込み

`projectContext()`が同じ祖先規約を変更pathごとに再読込みしていたため、1呼出し内だけで読込みを共有した。optionalとrequiredは別キーとし、次回呼出し・別projectへキャッシュを持ち越さない。必須参照の欠落・symlink拒否・変更検出を維持する。対象テスト7件成功、独立レビューで具体的な回帰指摘なし。

合成規約983,040 bytesと同一ディレクトリの100 pathで5組を交互順に測定。baselineは`48bbe171`の実装。返却JSONは各組で完全一致。旧/新のmsは221.61/3.24、227.37/2.69、217.32/2.49、213.35/2.51、213.91/2.58。同一規約のopen回数は100→1。これは決定論的な規約探索の局所比較であり、AIの総tokens・自律開発E2Eの改善条件を満たした証拠ではない。

## 標準Hostの親子usage計測（再開後）

`native-host-usage-probe.json` は、Codex CLI 0.153.4で親が同一モデルの独立子Contextを1つ起動し、固定応答を受け取る合成試験。親のJSONのprocessed tokensは47,083、子のrollout累積usageは15,534、合計62,617。親のusageだけでは全量を表さないことを実測した。cacheはinputの内数として扱う。本文・認証情報は保存していない。

`scripts/native-host-usage.mjs` は明示指定された合成rolloutだけを集計する評価用関数。最終累積値を一度だけ採用し、親子関係がない記録や安全な整数範囲外の合計は拒否する。usageが欠けるthreadはnullとして残す。呼出し一覧の完全性と終了確認は別に必要で、この関数だけで未観測の子を検出できるとは主張しない。親子・孫、cache、欠測、混入、overflowを4テストで確認した。

これは計測経路の確認であり、自律開発の完走や性能改善の証明ではない。配布物と実worktreeを使った小規模pilotでは、Agentが実装と実テストを行ったが、合成Host境界でGit管理領域がread-onlyとなりcommitが拒否された。加えてstartの内部Git起動がEPERMとなった。境界を外して成功扱いにせず、試験設定と製品の責務を切り分ける。これらを解消しない限り、このpilotを正常完走のEvidenceには数えない。

### pilotの停止原因と修正

合成repoのGit管理領域を明示的な書込み先として渡すとcommit停止は解消した。実プロジェクトやネットワークへの権限は増やしていない。別のEPERMは、Node 24.19.0の`spawnSync`で未使用stdinをpipeにした場合に再現した。同じCodex境界でstdinだけを`ignore`にすると、stdout/stderrを取得したまま正常終了した。標準`start`/`worktree-verify`の4呼出しをこの非対話設定へ変更し、エラーの無視や隔離解除はしていない。既存worktreeテスト10件と独立レビューに合格。

`native-host-pilot-results.json`に失敗した2試行も含めて記録した。修正済みtarballの3試行目は、実worktreeのstart、Agent自身の実装、テスト、別Contextレビュー、commitまで60.84秒で完走し、親子合計275,971 processed tokensだった。試験側が実装を修正した回数は0。同じ隔離条件で配布物のworktree-verifyも成功した（この最終確認は試験側の実行として区別）。PR/CIはこのpilotでは実行しておらず、5組の性能比較や複雑Goalの受入を代替しない。比較条件が変わった診断試行から速度改善率を算出しない。

### 標準Host候補のDraft PR/CI到達

`native-host-delivery-results.json`: 公開合成Issue #1の元要求を配布物と実worktreeへ渡し、Agentが修正・厳密な回帰テスト・commit・同一HEADの独立レビューまで実施した。Host所有の提出アダプターで[Draft PR #28](https://github.com/adachi-tatsuru/asc-public-synthetic-eval-20261016/pull/28)を作成し、そのHEADに対応する既存CI（回帰テストと独立Hello oracle）が成功した。変更は合成の2ファイルだけで、試験側の実装修正・計画代行は0回。認証情報はAgentへ渡していない。

ただし、この試行では評価側が独立ReviewerのHEADを確認し、提出アダプターを別途起動した。その引継ぎを無人の統合実行と偽らない。Agent実装・レビュー、提出・CI観測、引継ぎを含む実経過を分離して記録した。親子usageは取得したが、外側の評価進行役は欠測。単発の提出実証であり、完全な自律制御や複数試行の低コスト保証は未達。

### 評価経路の自動引継ぎ

`scripts/run-native-delivery-candidate.mjs --deliver`は公開合成repoのIssue #1に限定した評価入口。Agentの終了後、Host所有のrolloutから親子関係・全記録の最終turn完了・起動呼出し数と観測thread数・独立Reviewerの最終PASSとcommitを照合する。親の自己申告、古いHEAD、引用されたPASS、未終了・再開中のReviewer、欠測usage、欠けた子の記録は提出条件にしない。実テストと許可範囲を配布物で再検証した後、既存GithubアダプターでDraft PR/CIへ進む。評価用であり、利用者へ新しい固定工程や常設Agentを追加するものではない。

最初の試行はUTC/ローカル日付の違いによりrolloutを発見できず、提出前に安全に停止した。日付解決を修正して保持済み成果から再開し、Draft PR #29とCI成功へ到達した（`native-auto-delivery-recovery.json`）。再実装・成果破棄なしだが評価driverの修正介入があるため、初回無介入成功とはしない。

独立レビューで子の記録欠落とambient Git環境の混入を指摘され、起動数照合とHost Gitの環境分離で是正した。CIの固定期限はユーザーの方針に従い追加しない。無期限観測が続く場合は成功とは判定しない。レビュー照合の反例とローカル/UTC日付境界を5テストで確認した。

修正後の新規試行（`native-auto-delivery-results.json`）は、元要求からAgent実装・独立レビュー・実検証・[Draft PR #30](https://github.com/adachi-tatsuru/asc-public-synthetic-eval-20261016/pull/30)・CI成功まで89.85秒で完走した。提出への手動引継ぎ0、試験側実装修正0、評価driver失敗なし。これは小規模合成Issueの自動完走1件の証拠であり、性能改善の比較結果や複雑Goal全般の保証とはしない。

### PR review follow-up (2026-10-19, candidate after 2410ac94)

Five still-valid CodeRabbit findings were corrected: a missing interruption checkpoint now fails the trial; acceptance review requires a successful integration oracle at the recorded HEAD; the user-management fixture rejects invalid email local-part symbols; the delivery runner names itself in Usage; and native trials record Git configuration/hooks before Agent launch and compare them before Host-side Git inspection or delivery. These records live outside Agent-writable directories. Missing records fail closed; older runs are not retroactively treated as having this protection.

The earlier domain/dot validation, empty integration target and shared SQLite namespace observations were already addressed. Table namespace coordination remains an intentional integration requirement, not a prescribed implementation prefix.

Targeted evidence: 9 tests passed (failed/missing oracle, config/hook/link changes, native review/usage/completion binding), and the isolated consumer browser journey passed. No performance superiority claim follows from these regression tests.

The native complex run completed in 238.54 seconds, but its reviewer inherited the parent conversation (`forked_from_id`); strict Host evidence validation rejected it. It is not an accepted independent-review or autonomous-delivery result, and aggregate usage remains unvalidated because inherited session records require separate accounting. The services and logs are preserved; no public delivery occurred. New trials explicitly require `fork_turns="none"` for the independent reviewer.

Validation after these changes: required `npm run quality` passed (333 passed, 11 skipped, zero failed); the subsequently added interruption-termination regression passed separately. Changed-script lint passed. An optional lint of every script exposed a pre-existing `fetch` no-undef in unchanged `scripts/release.mjs`; this is not a clean all-script lint claim.

### Fresh-context candidate

The distributed ASC Skill now explicitly requires a reviewer without inherited implementer conversation, and asks Issue delegates to receive bounded requirements/paths rather than duplicate the parent history. This addresses the observed independence failure and a potential context-cost cause without adding a reviewer or fixed workflow. Candidate `0.5.900-alpha.3` SHA256 is `b213187206b6ffc09762ca904467860269f9929652063258fbde83c51836f02d` (unpublished). Package tests: 7 passed; project-assets installation/update tests: 14 passed. The preceding rejected complex trial is retained in `native-complex-rejected.json`, including its missing total usage. A rejection is not a zero-token success.

The fresh-context complex trial completed original requirements through Draft PR #31 and both CI jobs in 412.36 seconds (389.45 seconds implementation/review, 22.40 seconds Host delivery). Four observed threads used 2,781,286 processed tokens, including 2,580,480 cached input tokens (already included in input; not added twice). Parent and reviewer each account for roughly one third of total processing. A billing unknown-key rejection defect was detected during integration and corrected by the native parent, with no driver implementation edit or manual delivery handoff. Evidence: `native-complex-delivery.json`. This proves one complex original-contract run, not shared-contract revision/restart or a performance improvement. A same-condition paired baseline is still required.

### Shared-contract revision and cost attribution

The follow-on fixture preserves accepted reservation/billing sources under `complex/previous`, authorizes only the two current service files, and applies the already specified JPY event contract. The reservation and billing lifecycle oracles accept an explicit `revised` phase with JPY expectations; all prior authorization/persistence/state assertions remain. Integration and unknown-key oracles are unchanged, and the old-data replay revision oracle is added. Original-contract regression: 6 cases passed. Independent review found no concrete defect in fixture preparation, scope binding or oracle changes.

`native-complex-context-cost.json` records diagnostic counts for PR31. Each initial model input was about 16k tokens; parent/reviewer accumulated substantial repeated-context processing and respectively about 88k/126k tool-output bytes. Those bytes and usage updates are not interchangeable with tokens or model-request counts. No performance claim is made from this attribution.

For the next paired Skill comparison, baseline package `0.5.900-alpha.4` SHA256 `2d63a2e538fe4f1ee5e320b72e658ee7bf2b254dc6446d2952d9a7dd3d69c8f7` uses the alpha.3 runtime with only `skills/asc/SKILL.md` replaced by commit `9f19ce4bd76a8e59eedd01adec8ec8a3a825fea7`. The package version and identity metadata necessarily differ. It is an unpublished evaluation baseline, not a release or a comparison against all v0.4 runtime behavior.

The explicit shared-contract revision completed through Draft PR #32 and both CI jobs in 192.90 seconds (170.11 seconds implementation/review), using two fresh-context Agents and 725,512 processed tokens, including 635,520 cached input tokens. No evaluator implementation edit or delivery handoff occurred. Host verification ran all four original oracle families with the explicit revised shape plus the legacy-data revision oracle. Evidence: `native-shared-contract-delivery.json`. This establishes one follow-on contract change; it is neither a comparison with PR31's larger initial implementation nor an interruption/restart proof.

The paired small-case runner supplies the same fresh-review (`fork_turns="none"`) protocol to both Skills. Before starting trial 1, all archived package file hashes were compared: only `skills/asc/SKILL.md`, `package.json` and `release-identity.json` differ. No model trial runs concurrently with the pair, to avoid an avoidable wall-time confound. Cache state remains observable but uncontrolled.

### Paired pilot: fresh-context instructions alone did not reduce tokens

The same-runtime baseline Skill (9f19ce4b, unpublished alpha.4) and full fresh-context Skill (alpha.3) each completed the fixed synthetic Issue with two Agents, fresh independent review and Draft PR/CI. Baseline PR #33 took 109.693 seconds and 272,907 processed tokens; candidate PR #34 took 108.779 seconds and 331,298 tokens. Cached input is included, not added again. These diagnostic observations do **not** establish an improvement: token use increased. Local package tests overlapped the candidate run, so timing is not a controlled performance claim. The remaining expensive repetitions of this candidate were not run blindly.

### Progressive disclosure candidate under evaluation

The common Skill entry was reduced from 21,714 to 11,721 bytes by moving conditional review, multi-Issue/recovery coordination, post-merge and explicitly selected Controller instructions into linked references. Applicable references remain mandatory; instructions were moved, not waived. The references ship both with the runtime and beside the shared Skill, and package tests check their contents and relative links. This input-size change alone is not a token or quality improvement claim.

Unpublished alpha.5 (candidate SHA256 `a131ce29a55943791167ea39bd4976a6de26e48ea045462a342fc95e47dc224b`) and alpha.6 (baseline SHA256 `904d2e9b9d7f5cc74a6844dd13f1c7f8a03bc87818c2cdfa0e898f7411da230e`) use the same runtime and reference assets. Only the entry Skill, package version and release identity differ. Candidate-first pair 1 reached Draft PR #35/CI in 98.864 seconds with 267,340 processed tokens and two observed Agents. The paired baseline reached Draft PR #36/CI in 96.264 seconds with 300,177 processed tokens. Candidate tokens were lower but elapsed time was higher; this pair does not meet the joint improvement criterion. Both completed with two Agents, no driver implementation edits and no manual handoff. Host rollout tool records confirm that the candidate reviewer read references/review.md. The remaining alternating pairs and complex/restart acceptance are pending.

Pair 2 ran baseline then candidate: PR #37 took 90.262 seconds / 275,757 tokens; PR #38 took 98.514 seconds / 317,040 tokens. All four runs passed the same quality conditions without handoff or driver implementation edits. The two-pair medians are baseline 93.263 seconds / 287,967 tokens and candidate 98.689 seconds / 292,190 tokens: **not an accepted improvement**. Remaining repetitions of this unchanged candidate were stopped to avoid spending more on a presently non-improving approach. The five-pair criterion has not been weakened.

`native-small-progressive-summary.json` is derived by an evaluation-only helper which rejects differing requirements/commands/model/effort/base and duplicate observations, and does not grant acceptance with missing usage, failed quality, manual intervention, fewer than five pairs or improvement in only one metric. Three counterexample tests cover these conditions. It does not prove the original trial inventory is exhaustive or replace inspection of the recorded runs.

Diagnostic Host records show that candidate pair 2 made 10 implementer tool calls versus baseline's 8. One was recovery from reading `v05/references/review.md` instead of the actual `skills/asc/references/review.md`; the implementer also read the detailed reviewer procedure before the fresh reviewer read it again. The Skill now explicitly anchors relative links to its own directory and leaves detailed review reading to the Reviewer unless implementation itself needs it. This is a concrete observed redundancy correction, not a claim of measured performance improvement. New trials must use a newly fixed candidate and a matching-runtime baseline; alpha.5 results remain unchanged.

Validation of the progressive-reference distribution and paired-summary changes: `npm run quality` completed with 337 passed, 11 skipped, zero failed. A separate read-only reviewer found no concrete defect in the comparison conditions/failure handling or the Skill reference clarification. These are code/packaging checks, not completion of performance or interruption/restart acceptance.

### Native interrupted-work continuation trial

`run-native-revision.mjs --interrupt-restart <absolute-candidate-tarball>` adds an explicit synthetic fault-injection mode: after the first saved service edit, the Linux evaluator sends SIGINT to the attempt's exclusive transient service, confirms the supervisor's signal termination and the disappearance of the entire cgroup, and only then starts a fresh current-host context on the same unchanged working tree. The evaluator neither repairs nor commits the unfinished implementation. The original and revision requirements and all fixed oracles remain the acceptance contract; resumed independent review and Draft PR/CI use the existing delivery path.

This is a Linux evaluation mechanism, not a new systemd requirement for ASC users. A real-service regression confirms saved bytes remain and a detached/setsid child stops before handoff. A second test rejects missing required checkpoint/usage records and an unconfirmed stop. The initial exec-service probe exposed that systemd may report SIGINT as exit 0; a retained-exit experiment also waited for explicit service stop. Neither was accepted. The final oneshot service records the actual termination signal with no start-time budget and passes the two tests. Independent review found the missing-checkpoint fallback, which was corrected and re-reviewed.

The interrupted attempt's last observable cumulative usage is recorded separately with `complete:false`; the all-attempt total stays null because in-flight usage may be missing. Resumed parent/descendant usage is not presented as the full cost. The live trial uses unpublished alpha.7 SHA256 `0fd386148a2011c3807ef0ca80313c3acbc557083684ac7c2b6ba00ab33b9edd`. Its result is pending and does not yet prove autonomous recovery or performance.

The live alpha.7 interruption trial completed at reviewed HEAD `34cac398736c4fd34cfb52bf838453c747c5f549`, [Draft PR #39](https://github.com/adachi-tatsuru/asc-public-synthetic-eval-20261016/pull/39), with both `complex` and `test` CI successful. The first attempt saved a reservation-service edit and was interrupted after 20.790 seconds; the entire synthetic service stopped before the fresh continuation started. Continuation, actual tests, independent review and local commit took 107.559 seconds; total elapsed through CI was 150.632 seconds. No evaluator repair/commit/integration or manual delivery handoff occurred.

`native-interruption-delivery.json` retains 640,742 processed tokens for the resumed parent and reviewer and 36,350 last-observed tokens for the interrupted attempt. The latter may omit in-flight work, so the whole-run total is **null**, not their sum. This demonstrates this Linux single-writer saved-work continuation case; it does not prove simultaneous multi-worker interruption, cross-OS process cleanup or a cost reduction.


### 利用者の追加計測を踏まえた評価範囲

提供された非公開報告は問題発見の入力として扱い、個別Issue・利用者情報・元ログは転載しない。単独稼働と単一実装担当は異なる分類であり、並走率・変更規模・生成物・共有進行役の帰属誤差がある観測から、並列化やAgent数の因果効果を断定しない。追加の内訳集計は元ログ・算出コードを未確認であり、独立検証済みの数値として扱わない。

- 既存のDraft PR/CIまでの対比較は継続するが、それだけで開発全体の費用改善を完了扱いしない。PR後のレビュー指摘・修正・再検証からmerge可能な状態までを別区間として測る。実際のmergeをこの評価のために行わない。
- processed tokens、モデル呼出し数、役割別入力・cache・出力、実時間、待ち時間、再試行、欠測を分ける。tool呼出しやusage更新をモデル呼出し数と同一視しない。providerごとの包含関係を確認し、cacheを重複加算しない。仮定の単価による換算は請求実績ではない。
- 複数Issueを扱う進行役の費用を直前に操作したIssueへ全額帰属させない。共有調整分・帰属不明分を残し、担当分に加えてセッション全体の費用を比較する。
- 文脈を一定値で切った反実仮想の試算は、引継ぎ、必要資料の再取得、cache再作成、品質低下による手戻りを含まない。固定のContext上限や、主担当による実装の一律禁止は導入しない。必要な作業境界でのfresh contextと継続を同条件で比較する。
- 次の原因分析では規約・要求・コード・テスト出力・CIログ・進捗確認・レビュー是正に分類し、同一内容の再取得と変更後の必要な読戻しを分ける。tool出力bytesをtoken量へ換算したり、長い出力だけで費用原因と断定したりしない。
- 改善候補は、不要な全文取得・反復確認・担当間の履歴複製を減らすこと。関連コードの確認、独立レビュー、実テストは維持する。固定Stepや固定Agent階層の復活は改善の前提にしない。

この更新は評価条件の明確化であり、性能改善の実証ではない。長寿命ContextとPR後是正を再現しない小規模試験だけで、本目標を完了にしない。


### Anchored-reference comparison: token reduction without time improvement

The alpha.7 candidate and alpha.6 baseline completed two alternating pairs: candidate/baseline Draft PRs 40/41, then baseline/candidate PRs 42/43. All four passed the same exact-HEAD tests, independent review and CI with two observed Agents and no evaluator implementation or manual handoff. Median elapsed time was baseline 88.334 seconds versus candidate 101.4545; median processed tokens were 314,621 versus 276,963. Tokens decreased about 12%, but time increased about 15%, so this is **not an accepted improvement**. The five-pair requirement remains; further unchanged repetitions are deferred pending a concrete latency hypothesis.

The shared runtime identity is now computed from verified release-identity source hashes excluding the entire `skills/asc/` bundle. Each arm separately pins the entire Skill bundle, including references, across observations. Different reference contents must not masquerade as the same candidate, and a deliberate reference-only variant is not a runtime mismatch. Existing observations were re-exported from their preserved distributions without rerunning models. The summary reports worst-case time/tokens and requires assessment of regressions rather than automatically accepting better medians. Four focused tests and changed-script lint passed.

`native-small-anchored-diagnostics.json` separates delivery (about 20–21 seconds) from implementation/review. Candidate implementation/review took 83.916/78.206 seconds versus baseline 61.964/74.366. Candidate parent tool calls were 9/9 versus 10/11; every reviewer made two tool calls. Therefore fewer tool calls did not establish lower elapsed time, and CI waiting does not explain the gap. Reviewer output bytes were higher with the candidate, but bytes alone do not establish a latency cause. Cache/model latency remains uncontrolled. No fixed Context limit or extra Agent is justified by these results.


### Independent-check batching candidate

Inspection of the preserved pair-2 tool records found that the candidate re-ran `start` before review as required to detect changed project rules. This is not a redundant guarantee to remove. Independent Git checks, rule discovery and tests were nevertheless spread across several AI/tool round trips. The entry Skill now asks for already-determined independent read/check operations in a single tool invocation with each exit status checked; adaptive investigation, edits, commits, approvals and dependent verification retain ordering. This is a performance hypothesis, not proven acceleration or permission to omit validation.

Unpublished alpha.8 SHA256 `8ce77864e65cf7922ee3cce79173e66ee52c86b393354c55d7b3ca3809a9f142` has exactly the alpha.6 baseline source inventory except `skills/asc/SKILL.md`. Package checks passed 7/7 with TMPDIR=/var/tmp. The initial default-/tmp run failed the non-Git start case with `Migration Git operation failed`; a subsequent direct Git check found no /tmp repository. The environmental failure is unresolved and is not represented as a passing default-/tmp run. The new model trial is pending; no improvement claim follows from the instruction change.


Alpha.8 candidate-first trial reached synthetic Draft PR #44 and CI success in 82.214 seconds with 242,069 processed tokens, two Agents, no missing final usage and no evaluator implementation/manual handoff. The matching baseline is running; this is not a paired improvement claim.

The default-/tmp package-test failure was subsequently traced to an existing `/tmp/.git` directory: `projectLocation` detects ancestor metadata and `assertWorkLocation` rejects invalid Git state instead of silently enabling the non-Git path. `git rev-parse` saying “not a git repository” did not establish absence of that directory. No unrelated temporary metadata was removed or bypassed. The clean /var/tmp package test remains the successful isolated test; default-/tmp was contaminated and remains a recorded failure.


The first alpha.8 pair completed: candidate PR44 82.214 seconds / 242,069 tokens; baseline PR45 125.114 seconds / 335,269 tokens. Both passed quality with complete observed final usage. This single candidate-first pair improves both metrics but is not accepted under the five-pair criterion; the next pair reverses order. A bounded independent code review found no concrete defect in Skill-bundle provenance, worst-case rejection or batching instructions. No model comparison was performed by that reviewer.


### New CodeRabbit findings and second batching pair

The second pair ran baseline first: PR46 162.754 seconds / 354,721 tokens, candidate PR47 135.699 seconds / 303,393 tokens. Both passed exact-HEAD tests, independent review and CI with complete observed usage. Two-pair medians are baseline 143.934 seconds / 344,995 tokens and candidate 108.9565 seconds / 272,731 tokens. Five pairs remain the acceptance requirement; these two are not a general performance guarantee.

A subsequent CodeRabbit finding exposed missing worktree Git-pointer protection in the synthetic evaluator. The guard now pins each explicitly Host-used worktree's `.git` pointer and corresponding `commondir`/`gitdir` bytes before Agent execution and compares the same list before Host Git use. It rejects pointer symlinks/redirects, missing files and changed administration. Other worker worktrees can still be created: only Host-used pointers are pinned, while all config.worktree files and common config/hooks remain monitored. The two batching pairs above used the older guard loaded when their processes started; they must not be described as having the new protection, and old baselines are not retroactively regenerated.

The user-management fixture also now rejects email local parts above 64 bytes and tests both 64-byte acceptance and 65-byte rejection. Two Git-boundary tests and changed-file lint passed. The network-isolated installed-package browser journey passed all six scenarios, including direct API validation and authorization, stale edit recovery, connection failure and restart persistence. This is a deterministic fixture check, not an AI autonomous-development trial. Independent read-only review found no concrete defect in either fix.


Pair 3 candidate completed with the new pinned-worktree guard: Draft PR48, CI success, 116.780 seconds and 279,052 processed tokens. Baseline is pending. This is the first batching-series candidate with the new pre/post pointer check; previous observations retain their earlier coverage limitation.

For forthcoming complex paired trials, only the evaluator-owned preparation commit uses fixed author/committer dates and disabled signing. Identical source trees, parent and identities therefore yield the same base commit rather than differing solely by execution time. Agent commits retain ordinary dates. Two disposable repositories produced identical preparation hashes, and changed-script lint passed. This check does not establish complex performance; it prevents an avoidable condition mismatch before those runs.


Pair 3 baseline PR49 finished in 91.790 seconds / 275,048 tokens, faster and slightly smaller than its candidate. Both passed the strengthened pointer guard and quality checks. Across three pairs, medians are baseline 125.114 seconds / 335,269 tokens and candidate 116.780 seconds / 279,052 tokens. The unfavorable pair is retained; acceptance remains false with only three pairs.

Exported batching records now identify whether the Host worktree pointer was present in the original pre-execution Git-control record. Assertions confirm false for pairs 1–2 and true for pair 3 and the next baseline; no record was reconstructed to upgrade past protection. Pair 4 baseline PR50 finished in 76.832 seconds / 255,062 tokens; its candidate is in progress. These observations also show substantial timing variability.


### Completed batching series: rejected performance hypothesis

All five predeclared alternating pairs completed (synthetic Draft PR44–53), with all fixed tests, exact-HEAD independent reviews and CI successful, no evaluator implementation/manual handoff, and no missing final per-thread usage. Candidate elapsed median was 116.780 seconds versus baseline 102.571; candidate processed-token median was 303,393 versus baseline 275,048. Only two of five pairs improved both. Worst observed values were lower for the candidate, but both medians worsened, so `accepted:false`. Neither extra repetitions nor omission of the unfavorable last three pairs will be used to reverse this result.

The candidate combines progressive references, fresh-context instructions and independent-check batching; this experiment does not isolate the causal effect of the last sentence. These instructions remain quality/coordination guidance, not a demonstrated speed optimization. Their small-case overhead must not be concealed by a claim based on the first two pairs. Small-case performance acceptance is unresolved. The next investigation targets actual complex multi-Issue coordination and repeated-context costs rather than adding more fixed gates or Agent roles.

All pair-specific deltas are exported. Earlier pairs retain their pre-pointer-guard limitation; later pairs record the pre-execution pointer binding. Export identity and paired-regression reporting tests passed (five tests), with changed-script lint successful. The full objective is not complete.

### Complex comparison baseline and integration cost

The first alpha.6 complex baseline reached synthetic Draft PR54 with both CI workflows successful: 365.854 seconds, 2,206,547 observed processed tokens, four observed threads, no missing final usage, no evaluator implementation or manual handoff. The original requirements are hashed from the preparation commit, not mutable working files; both CI results must bind to the delivered HEAD. Candidate alpha.8 is still pending, so this observation is not a performance comparison.

Role diagnostics show 1,049,161 parent tokens (about 48% of the observed total), 19 parent `exec` tool calls and seven waits. Usage-update counts are not model-request counts. The parent detected a real pagination defect during integration and corrected it before fresh independent review, so its entire cost cannot be classified as redundant coordination. `scripts/check-complex-pagination.mjs` separately checks maximum-safe page numbers, legal page sizes, empty tenant results and unchanged ordinary listing for both services. It fails with VALIDATION on the pre-fix parent commit and passes on the delivered baseline. This additional counterexample does not change the fixed comparison fixture or retroactively turn prior narrow oracle success into full requirement coverage. It will also be applied to the candidate.

Absolute command arguments are exported as path hashes, preserving comparison equality without publishing local installation locations. These hashes identify paths, not executable contents or versions. The export regression test confirms path removal without changing relative arguments.


### Complex candidate: negative performance result retained

Alpha.8 completed synthetic Draft PR55, both CI workflows and the additional pagination counterexample: 646.611 seconds / 2,522,949 tokens against baseline 365.854 / 2,206,547. Both have four completed threads and exact-HEAD independent review. The single pair worsens time by 280.757 seconds and tokens by 316,402; acceptance is false. The remaining four expensive repetitions of this unchanged candidate are not started. This is not a five-pair performance claim.

Parent processed tokens decreased from 1,049,161 to 917,063, but one worker and the reviewer increased. The candidate reviewer used 17 exec calls versus baseline 10, including a newly written concurrency test with an ESM/require error and several operations locating/cleaning its temporary directory. These are observed contributors, not a causal attribution of the entire elapsed difference. The revised review reference recommends reusing existing test helpers/execution forms, keeping setup/run/cleanup together, retaining generated temporary paths, and distinguishing test-harness failure from product failure. It adds no dedicated Agent, fixed gate, or reduced review requirement. The effect of this guidance remains unmeasured. No performance improvement is claimed from this change.


### Next handoff acceptance and model confounding

Additional private observations do not support attributing the reported regression to a lighter model. No provider/model name or private trial table is reproduced here. Comparisons keep model and effort fixed; task-boundary context handoff, repair history and retained evidence are investigated before model substitution. Shorter contexts are a hypothesis, not proof: handoff/re-read/cache rebuild and subsequent repair costs remain part of the total. Fixed Step-driven spawning is not restored, and model changes can also change call counts and rework.

The evaluation-only `run-native-revision.mjs --interrupt-parallel-restart` variant requests separate reservation/billing worktrees and interrupts after a saved integration-source edit. Existing single-writer mode is unchanged. The setup records only that parallel work was requested; delivery explicitly records `parallelInterruptionCoverage.verified:false` until distinct worker worktrees, preserved commits and integration timing are observed. A successful resumed Draft PR cannot alone pass this scenario. This does not test interruption during concurrent worker writes or cross-platform process cleanup. The first live result and its limitations are recorded below.


The newest private grouped observations motivate bounded work ownership rather than merely increasing Agent counts. Group medians are observational, include size/complexity confounding, and do not prove a causal reduction ratio. The historical lifetime thresholds are analysis labels, not product limits. Coordination guidance now defaults new completed-task follow-on work to fresh context while permitting bounded continuation of the same unfinished question when handoff would add unnecessary rework. This is Host guidance, not automatic CLI enforcement; performance and compliance remain to be measured.

Recent original-complex trial diagnostics report maximum per-update inputs below 50,000 tokens. They do not reproduce the much longer sessions described in user observations. Their negative result rejects the tested candidate comparison, not all long-context handoff strategies. A relevant future comparison must use the same sequential tasks/repair workload and include retained results, handoff, cache rebuild and PR aftercare in both arms; it must not replace actual work with arbitrary padding and claim real-project savings.

Owner clarification: one coordinator session must continue handling multiple Issues; no one-session/one-Issue restriction is introduced. Independent work remains parallel. Bounded subagent ownership and context handoff must not serialize otherwise independent Issues or require the user to restart their session. Acceptance must include this multi-Issue session behavior alongside cost and quality.


### Parallel work retained across integration interruption

`native-parallel-recovery-observation.json` records the alpha.10 synthetic trial: two worker worktrees each committed only its assigned service, and those commit blobs match both the saved interruption checkpoint and the final submitted service bytes. A fresh parent completed revision/legacy-replay tests and independent review, followed by synthetic Draft PR56 and both exact-HEAD CI workflows. Elapsed time was 271.701 seconds. Resumed usage was 465,419 processed tokens; the interrupted attempt has only a last observation of 734,746, so total cost remains missing rather than a complete sum. The Linux evaluation supervisor confirmed all processes stopped before handoff.

This is evidence of retained worker work and recovery at integration, not interruption during concurrent worker writes, an uninterrupted long-running multi-Issue session, cross-platform termination, or a performance improvement. It is not full acceptance: evaluator branch naming contained an underscore and mismatched directory/branch slugs; worker names also mismatched. The historical trial is unchanged. Future evaluator setup now uses one matching hyphen-only slug in directory and branch. Runtime safety does not start rejecting older worktree names.


### Bounded-work candidate comparison (in progress)

Candidate alpha.10 completed synthetic Draft PR57 and both exact-HEAD CI workflows in 332.431 seconds, with four fresh-context threads and 1,431,284 observed processed tokens. `native-complex-bounded-pair1-candidate.json` retains the original intent, unchanged runtime/fixture/commands, reviewer HEAD and usage. The separately executed maximum-safe-page counterexample passed; its first evaluator invocation used the trial directory instead of the complex source directory and failed to load the module, then the corrected invocation passed. This evaluator-only invocation error is not an Agent repair or part of the native E2E timing.

Cache-write counters are now preserved separately when the Host reports them. All four threads reported zero in this run; missing counters in older records must not be reinterpreted as zero. No cache-write value is added to processed tokens or treated as a billing estimate.

This candidate includes the existing reviewer temporary-test guidance and bounded work ownership, with multiple Issues still coordinated in one session. It is a combined-candidate comparison, not an ablation assigning causality to either change. A fresh alpha.6 baseline is running with the same evaluator naming correction and model. Pair order starts candidate then baseline; subsequent pairs alternate baseline/candidate and candidate/baseline. Five complete pairs remain necessary for performance acceptance; this single successful candidate is not a performance guarantee. Prior negative series remain part of the record. Long-lived multi-Issue follow-on and PR-repair workloads are still outside this original-contract fixture's demonstrated scope.


The paired baseline completed its native implementation/review in 397.101 seconds but the pre-delivery observer rejected a paginated inherited helper rollout containing both its own and its parent's session metadata. `native-complex-bounded-pair1-baseline-observation-failure.json` preserves this failure; it is not a clean autonomous delivery or accepted performance pair. The source is retained and is not reimplemented.

The observer now supports only the observed unambiguous paginated form: own metadata, one matching parent metadata, an explicit own-thread settings boundary, and matching thread-bound cumulative usage. Ambiguous or incomplete boundaries remain rejected; inherited-context review cannot replace the separate fresh reviewer. Synthetic counterexamples cover missing ancestor metadata, wrong parent/boundary/usage identity, duplicate inherited usage and a helper attempting to authorize delivery. Saved native logs can be re-read without a new model execution, but observer repair/delay remains part of the historical trial rather than disappearing from performance acceptance.

Saved-log validation of the observer repair exposed an additional false rejection: `history_mode:paginated` also appears on ordinary fresh/root contexts. The one-metadata path therefore rejects inheritance markers (fork/ordinal), not storage mode alone. A regression test and the actual saved baseline verification pass after this correction; the unsuccessful repair attempt is retained in the observation-failure record.

The retained baseline source subsequently reached Draft PR58 and both exact-HEAD CI workflows without model re-execution. Its five threads report 1,773,793 processed tokens; elapsed time 749.158 seconds includes observer repair and delayed delivery. `native-complex-bounded-pair1-baseline.json` retains `priorDriverFailure`; `native-complex-bounded-summary.json` rejects this pair for clean performance acceptance. These delayed wall times must not be used to advertise candidate speedup.

The next scheduled baseline (pair 2, baseline first) completed without observer repair or model restart: synthetic Draft PR59, both CI workflows, 473.972 seconds total / 449.097 seconds implementation-and-review / 2,226,305 processed tokens. `native-complex-bounded-pair2-baseline.json` has no prior driver failure. Its candidate is running with the same repaired observer. Pair 1 remains failed and is not silently replaced. Until the fixed comparison series finishes, individual favorable observations do not establish performance acceptance.


### Native conflict recovery

`run-native-revision.mjs --conflict-recovery` reuses the accepted original synthetic services and explicit currency revision. Before Agent launch, the evaluator creates two conflicting, intentionally invalid reservation validation-error edits and leaves a real unresolved cherry-pick in the disposable worktree. The original requirements remain authoritative; neither fault is a new requirement. Billing and previous accepted source are preserved. The Agent must recover, implement the revision, run fixed oracles and obtain a fresh independent review before Draft delivery. The evaluator does not resolve conflicts or repair final source.

The isolated Git fixture test confirms actual conflict state and CHERRY_PICK_HEAD, exactly one affected service, unchanged billing and refusal of dirty or incompatible setup. These checks validate fault injection only, not autonomous recovery. The finish record separates pre-launch fault injection from Agent work and binds eventual tests/review to the recovered HEAD. No claim about arbitrary merge conflicts or performance follows from this scenario.

Pair 2 completed cleanly in both arms: baseline PR59 473.972 seconds / 2,226,305 processed tokens; candidate PR60 435.087 seconds / 1,605,279. Both have exact-HEAD review, fixed oracles and both CI workflows, no driver repair or missing usage. The observed difference is -38.885 seconds / -621,026 tokens; one clean pair is insufficient for acceptance. The all-attempt summary still contains failed pair 1 and remains rejected.


The live trial completed synthetic Draft PR61 at `6381de214d47d2a5c188427eb2d575fb752576ef`, with both exact-HEAD CI workflows and fresh independent review passing. `native-conflict-recovery.json` records 217.998 seconds total, 706,430 observed processed tokens across two threads, five successful revision/integration/security/legacy-replay checks, zero evaluator implementation repairs and zero manual handoffs after the explicit pre-launch fault injection. The submitted source contains neither injected invalid error code and Git has no unresolved conflict. This proves recovery for this injected conflict plus revision only; arbitrary conflicts, long-lived parallel sessions and performance superiority remain unproven.


### Same-coordinator continuation measurement preparation

The original complex fixture runs two Issues in one coordinator session, but revision/restart trials currently create a fresh parent. They do not establish continued multi-Issue work in the same conversation. The next continuation scenario will reuse the completed synthetic parent session explicitly, apply the existing shared-contract revision in another worktree, preserve earlier work and require current-HEAD independent review and fixed oracles before Draft delivery. Plan/delegation/implementation remain Agent-owned. This is not yet executed.

The installed Codex 0.153.4 `exec resume --help` supports an explicit session ID; [official non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode#resume-a-non-interactive-session) likewise documents this path. A new parent with copied summary cannot count as the same session. Before reusing the parent, save its completed thread inventory and cumulative counters; after continuation, count each thread once, retain newly spawned descendants, and calculate phase deltas separately from final whole-session totals. Missing or reset counters cannot become zero. `nativePhaseUsage` prepares this measurement only; it does not prove continuation or performance.


### Accessor counterexample rejects the bounded candidate

During pair 3 baseline independent review, the native reviewer found billing input read/validation/use inconsistencies and requested Agent repairs. Applying the same additional counterexample to saved exact-HEAD clean sources reproduces persistence of a negative invoice amount in all three completed alpha.10 candidate runs (PR57/60/62) and both earlier baseline runs (PR58/59). `native-accessor-counterexample.json` records these results and the oracle hash. Original fixed-oracle successes remain historical observations, not full quality acceptance. This counterexample is separate from the fixed performance fixture; no previous trial is silently upgraded.

The unchanged candidate series will not be extended after the already-running pair 3 baseline completes: known quality failure makes further speed measurements of it insufficient. Review guidance now asks the existing reviewer to trace validated/authorized values to persistence and effects, testing reachable mutable/re-read cases without requiring new Agents or irrelevant input classes. This guidance is not itself proof of defect detection. Its effect, repair cost and same-session follow-on behavior still require native execution. Earlier favorable pair 2 time/token observations do not establish quality-preserving improvement.


Pair 3 baseline completed native repair and independent re-review at `69e1284cea60812eb6c7d9c016df86329b1440ff`, Draft PR63 and both CI workflows, in 577.031 seconds / 2,107,730 processed tokens. The additional accessor oracle passes this repaired baseline and fails the other five saved original runs. Oracle review strengthened the observation to inspect `get` persistence before reporting a negative stored amount, and to confirm zero stored rows after rejection plus one row after same-key retry. All six observations were rechecked. No evaluator fixed the service source. The same baseline coordinator is now the input to the continued-session revision trial; it is not relabeled as an improved-candidate performance run.


The first same-session revision attempt failed before any source edit: resume selected `:read-only` rather than the requested named restricted profile. The Agent reported denied patch/temp writes and no reviewer; the final observer rejected the subsequent aborted turn rather than publishing. `native-continuation-launch-failure.json` preserves the failure. This is not a successful continuation, and process exit 0 is not acceptance. The proposed driver correction moves config overrides into resume's own option list; an isolated synthetic write/denied-read probe must verify it before a continuation retry.


The minimal resume probe confirmed the correction: placing the same `-c` permission overrides after `resume` selected `asc_minimal_agent`, permitted the workspace write, denied the outside dummy read, retained root-deny and restricted network. The first developer trial remains failed. This permission probe does not prove the full revised development task or establish performance.

### Quality-corrected complex cohort (registered before execution)

The previous three-pair cohort remains rejected: its additional accessor counterexample exposed missed quality defects. A new cohort uses the same two-Issue requirements plus the immutable accessor oracle for BOTH variants. Baseline remains alpha.6; candidate alpha.11 adds bounded-context guidance and the reviewer trace from validated input to persisted effect. Candidate tarball SHA256 is `25f88250d7fcb0e5c02a1694617c2ae0113d3ed1601b767f5ba2a2b28baa9d4c`. Runtime, original requirements, additional oracle, model (`gpt-5.6-sol`, medium), Host and delivery checks must match within each pair. New fixture commits are not pooled with earlier results.

Run candidate then baseline for pair 1, alternate order thereafter, with five paired trials required for acceptance. Both elapsed-time and processed-token medians must improve, with quality failures, interventions, missing usage and worst cases reported. Stop this candidate cohort on a confirmed quality defect or a clear negative pilot rather than repeat a known bad variant. A stopped cohort is not accepted and is not silently replaced by selected successful runs. The evaluator does not implement or repair service code. All results reach the authorized synthetic Draft PR and exact-HEAD CI path, or retain the failure. No production release is implied.

The same-session continuation separately reached synthetic PR64 with both CI workflows passing. It required driver repairs and is therefore not clean autonomous acceptance. `native-same-session-continuation.json` preserves the intervention, elapsed delay, cumulative usage and phase-only usage. `native-usage-counter-audit.json` confirms the six previous original-run totals were unchanged by the resumed-thread accounting correction.

The quality-corrected candidate pilot reached Draft PR65 at `9182d43a19bd13103c5f45f8c52e1a1ee7c0d1b7`, with five fixed checks, fresh re-review and both CI workflows passing: 560.524 seconds / 2,349,860 processed tokens. The reviewer discovered a reservation accessor TOCTOU defect, which the native Agent repaired without evaluator code edits. The Host reserves completed task names, so the fresh re-review used `independent_review_2`. The observer previously recognized only the initial name; its recognition was corrected during this trial. `native-quality-pilot-candidate.json` preserves this intervention, and this run is not counted as clean performance acceptance. Direct-parent identity, non-inherited context, current-turn completion, exact-HEAD PASS and current-HEAD FAIL rejection remain enforced; arbitrary or nested reviewer names are not accepted. The corresponding baseline uses the same additional oracle and corrected observer.

The candidate pilot's saved Host records contain 72 observed model responses and 67 tool calls across five contexts. The coordinator accounts for 1,505,932 of 2,349,860 processed tokens (about 64%); its largest response input is 53,492 tokens. The two implementation contexts contribute 418,680 tokens and the two review contexts 425,248. Tool-result bytes include both function and custom-tool output and are not converted into tokens. This is a short synthetic run, not a reproduction of the user's 800k–970k long-session context. The breakdown is retained in `native-quality-pilot-cost-breakdown.json`; no new model calls were needed to obtain it. It motivates examining coordinator rereads and repair integration, but does not justify dropping independent review or imposing one session per Issue.

Baseline pilot PR66 completed at `7f639737f8d88da60603a025a8e030a89d393966` in 436.177 seconds / 2,192,739 processed tokens with no evaluator intervention. Both CI workflows and the separate post-trial reservation accessor check passed. Against candidate PR65, this pilot is **not an improvement** (+124.347 seconds, +157,121 tokens), and the candidate's observer intervention independently prevents clean acceptance. The unchanged candidate cohort stops; these observations are retained rather than replaced.

Saved-log breakdown shows candidate implementation workers used 418,680 tokens versus baseline 951,312; candidate review contexts used 425,248 versus baseline 519,813. But the candidate coordinator used 1,505,932 versus baseline 721,614 and made 40 versus 23 model responses. Its repair/integration burden erased the worker savings. This one pair is confounded by different generated defects and cannot establish causality. The next concrete hypothesis is to retain a lightweight coordinator during nontrivial repair by assigning a bounded, fresh repair context when that avoids rereading and rewriting the worker's implementation; this must not add a mandatory Agent to trivial repairs or change the shared requirements/quality checks.

### Bounded repair-context candidate (registered before execution)

Unpublished alpha.12 SHA256 `63668cf0f25d0abce600ec54a2ce73401a5c88d010d1ccd11afb65553a0eba2e` changes only the conditional repair guidance relative to alpha.11. For delegated implementation requiring new understanding or multi-site repairs, prefer a bounded fresh repair context; allow cheap understood local repairs directly. No fixed Agent count, model change, timeout or quality waiver is introduced. Skill validation and all seven package scenarios pass; independent instruction review found no scope/quality conflict.

Run one diagnostic candidate with the same five-oracle fixture and separate reservation-accessor post-check. Compare descriptively to the already-saved PR66 baseline to avoid paying for an unchanged control during hypothesis screening. This reused control is NOT a fresh pair and cannot satisfy the five-pair acceptance criterion. If the hypothesis survives, use newly executed alternating paired trials; otherwise retain the negative result and revise the concrete cause. A run with no repair cannot demonstrate repair-delegation savings. Runtime, model, requirements and oracle identity remain checked. No merge or release.

The alpha.12 diagnostic completed PR67 at `a90e9161a238dbf4c9215f7acb0bd45d623b3b9a` without evaluator intervention: 557.091 seconds / 3,160,960 tokens, all fixed checks, independent review, both CI workflows and the separate reservation-accessor check passed. The coordinator directly repaired billing accessor handling and then exception normalization in both services; it did not exercise fresh repair delegation. The reused baseline is lower on both metrics, so no performance acceptance follows. Records are `native-repair-context-pilot.json` and its summary; zero fresh comparison pairs are claimed.

The unproven repair-specific paragraph is removed rather than accumulated as another default. The next narrow change targets the repeated implementation defects directly: use the values actually validated/authorized through persistence and effects, and preserve contracted errors/state/retry keys when input extraction or conversion can fail at the actual call boundary. This adds no Agent or Gate and does not require arbitrary proxy tests on unreachable input types. Review still independently checks the behavior. Performance impact remains unproven; no unchanged alpha.12 repetitions are scheduled.


### Input-boundary prevention diagnostic (registered before execution)

Unpublished alpha.13 SHA256 `d87e2452f6d890fe2da597f1c3f15ecb8e1c19d2ab95220baf39ec34101df2ff` removes the unexercised alpha.12 repair paragraph and adds two implementation sentences about validated values and contracted input-extraction failures. The hypothesis is fewer implementation defects and therefore less repair/integration work, not additional mandatory review or Agents. Run one diagnostic on the same five-oracle complex fixture, model and delivery path; retain the separate reservation-accessor post-check. Compare descriptively with saved PR66 only. This is zero fresh pairs and cannot establish performance acceptance. Preserve failures and all observed usage. A promising result still requires fresh alternating pairs and remaining continuation/recovery acceptance.

Package validation before alpha.13 execution initially failed one of seven scenarios because the shared `/tmp` contained an invalid `.git` ancestor. It was not deleted or altered. Re-running all seven scenarios with a dedicated `/var/tmp` temporary root passed. The packaged Skill contains the intended input-boundary guidance. This environment-specific failure is retained; it is not a model performance result.


Alpha.13 completed synthetic PR68 at `dcf07245e3bba353a92fb8044050e7cd7e81f861` without evaluator intervention: 607.218 seconds / 2,793,898 processed tokens, all five fixed checks, independent review and both CI workflows passed. The separate reservation-accessor counterexample also passed. Two reservation input-inspection repairs were still required. Against the reused PR66 baseline, both metrics regress (+171.041 seconds / +601,159 tokens). This diagnostic is not accepted and unchanged repetitions stop. Worker delegation message text is encrypted in the available Host records, so transmission of the new implementation guidance is not directly verified. No missing observation is inferred from the final quality result.

A separate synthetic-log counterexample exposed stale review reuse: a completed new reviewer turn with no verdict could inherit the preceding turn's same-HEAD PASS. After PR68 finished, the observer was restricted to messages between the current turn's start and completion. Eleven reviewer cases and eleven usage cases pass; the three prior pilots and PR68 were rechecked from saved logs with identical reviewer identities and token totals. `native-review-turn-audit.json` records that audit. No model rerun was needed, and prior performance failures remain failures.


Saved alpha.13 logs attribute 1,581,369 of 2,793,898 tokens to the coordinator (45 model responses, 43 tool calls, maximum observed input 50,663). Its largest tool result (22,550 bytes, not tokens) reread both services during reservation repair. It also loaded PR post-merge cleanup immediately after a local worker merge, despite this being a pre-PR integration task. `native-input-boundary-cost-breakdown.json` preserves role totals. These observations motivate two narrow instruction corrections: PR post-merge cleanup applies to submitted PR merges, not local integration; coordinator investigation starts at the finding/callers/shared contract rather than pre-reading complete worker code and test bodies merely for coordination. Expand inspection when cause or impact is unknown. No quality waiver, extra Agent, fixed budget or session restriction is added. This is a new unmeasured candidate, not a performance result.


### Coordinator inspection scope diagnostic (registered before execution)

Unpublished alpha.14 SHA256 `7907e559ce80a2a1b87318800833b71b26a3bb36f70be8e4c5e7ea52df867e3c` contains the two instruction corrections above. Run one diagnostic with the unchanged five-oracle two-Issue fixture, fixed model/effort and automated synthetic Draft delivery. Compare descriptively with saved PR66, retaining zero fresh pairs. Record whether local integration wrongly triggers post-PR cleanup and whether repair loads unrelated full service bodies, alongside total elapsed time/tokens and failures. These behavior observations are not causal savings estimates. Retain the separate reservation accessor check. A negative result stops unchanged repetitions; a promising pilot still requires the original fresh paired and continuation/recovery acceptance.


### Clean same-session follow-on preparation

After the running alpha.14 original trial finishes successfully, reuse its exact coordinator session and distribution for the existing currency revision in a separate authorized worktree. Freeze original rollout observations before resuming; report original cost, added phase usage and cumulative whole-session usage separately. This is continuation/shared-contract acceptance, not a new performance pair. No evaluator code repair or planning handoff is allowed. The revision driver now permits an unused numbered independent reviewer task name because Host task names remain reserved across turns; the already-tested direct-parent/fresh-context/current-HEAD review contract is unchanged. No extra reviewer or wrapper Agent is required solely for naming. If the original trial fails, retain that failure and do not start this follow-on as accepted-source continuation.


Alpha.14 completed synthetic PR69 at `592b8fd87f88a7930e1b65b63ad5eb8f655b0dbb` without evaluator intervention: 405.051 seconds / 1,715,462 tokens, five fixed checks, independent review, both CI workflows and the separate reservation accessor counterexample passed. Relative to reused PR66, the diagnostic is lower by 31.126 seconds / 477,277 tokens. This is not fresh paired acceptance or a causal attribution to either instruction. No post-merge reference/command was observed during local integration. The original observed source is now input to the preregistered same-coordinator follow-on; the original export remains frozen before resume.


After the same-session run terminates, screen alpha.14 on the existing small greeting fixture before starting the expensive fresh complex cohort. Use the same model, requirements, exact-Hello oracle, independent review and automated Draft/CI path. Compare descriptively to the saved small baseline distribution; one observation is not acceptance. Do not overlap model trials when measuring elapsed-time comparisons. The alpha.14 Skill entry is 12,750 UTF-8 bytes versus alpha.6's 18,106 bytes; bytes alone do not establish token/time savings.


The alpha.14 same-coordinator continuation completed PR70 at `0cf2b919e57c0180683caf761a02f0214c5fd786`: 311.177 seconds for the revision phase, 1,945,036 added processed tokens and 3,660,498 whole-session cumulative tokens. Six fixed checks, independent current-HEAD review and both CI workflows passed without evaluator implementation edits, handoffs or observer repair. The previous PR69 worktree remains clean at its accepted HEAD. `native-clean-same-session-continuation.json` separates phase and cumulative usage, with no missing reported usage. This proves this two-Issue original plus shared-currency follow-on in the same coordinator session, not arbitrary duration or cost superiority. The previous failed/intervened PR64 record remains unchanged.


Alpha.14 small diagnostic reached PR71 and exact-HEAD CI without intervention: 125.065 seconds / 325,889 tokens across implementation coordinator and independent reviewer. This is above the saved alpha.6 small-cohort medians (102.571 seconds / 275,048 tokens), but within its observed maxima (162.754 seconds / 354,721 tokens). No improvement is claimed and the observation is not a fresh pair. Avoid another speculative instruction change based on one observation; measure fresh paired runs with the fixed candidate before deciding.

### Alpha.14 fresh small cohort (registered before execution)

Fix candidate alpha.14 (`7907e559ce80a2a1b87318800833b71b26a3bb36f70be8e4c5e7ea52df867e3c`) and baseline alpha.6 (`904d2e9b9d7f5cc74a6844dd13f1c7f8a03bc87818c2cdfa0e898f7411da230e`), unchanged greeting fixture, model/effort, independent exact-Hello oracle, current-turn independent review and synthetic Draft/CI. Five fresh pairs, order B/C, C/B, B/C, C/B, B/C. Do not overlap model executions. Preserve every observation and do not replace slower results with additional trials. Existing pilots are excluded. Stop on a confirmed quality defect or measurement failure and retain it; do not start the expensive complex cohort if the small cohort fails acceptance. Compare both medians and worst cases using the existing summary, retaining cache and missing data. This is a measurement plan, not a guarantee.


Fresh small pair 1 completed without intervention or missing usage. Baseline PR72: 117.220 seconds / 303,362 tokens. Candidate PR73: 221.643 seconds / 450,146 tokens. Both fixed quality/review/CI checks pass, but the candidate regresses by 104.423 seconds / 146,784 tokens. The pair is retained unchanged in `native-small-scope-summary.json`; it is not replaced with the earlier pilot. Pair 2 follows the preregistered candidate-first order.


Fresh small pair 2: candidate PR74 137.266 seconds / 312,483 tokens; baseline PR75 112.907 seconds / 281,845 tokens. Both pairs pass quality with complete usage but both regress in time and tokens. The five-pair schedule is **stopped early after two pairs**, a deviation retained explicitly; no five-pair acceptance or statistical superiority is claimed. The remaining unchanged runs are not executed merely to fill a quota. `native-small-scope-pair1-breakdown.json` shows the first regression concentrated in review: 9 model responses / 178,774 tokens versus baseline 3 / 50,628. The candidate reviewer attempted a review-only Git archive snapshot, investigated Python isolated-mode cache behavior, then reran tests in the existing worktree. The main Skill already says to test in the existing dependency environment, but the separately loaded review reference omitted this constraint. The next minimal correction carries that execution contract into the reviewer reference, using existing no-write settings when necessary and reporting unverified work if permissions do not permit execution. It grants no new write authority and does not waive actual tests. This correction is unmeasured.


### Reviewer worktree diagnostic (registered before execution)

Unpublished alpha.15 SHA256 `ecba8b89cc697fe55a9072ee0f592654af16a08b813e86d38746a8ff233dbdfa` changes only the reviewer execution paragraph relative to alpha.14. Run one unchanged small fixture/model/oracle/Draft/CI diagnostic, checking actual review behavior and full usage. Compare descriptively with saved baseline observations, not as a fresh pair. Skill validation and packaged reference-content checks pass. A positive pilot is not acceptance; a negative pilot will not be repeated unchanged. Prior alpha.14 results remain rejected and are not pooled with this candidate.


Alpha.15 completed PR76 without evaluator intervention: 138.008 seconds / 286,779 tokens, required tests, exact-HEAD independent review and CI successful. The reviewer used the existing worktree, used Python's no-bytecode option for the independent exact oracle, and made four tool calls with 93,750 tokens; the coordinator made eight calls with 193,029 tokens. No review-only archive snapshot or cache-recovery detour was observed. This supports the intended behavior correction for this one run, not causal time/token superiority. Runtime is still above recent baseline observations; acceptance remains false and no five fresh pairs are claimed. Raw model/tool content is not exported; the observation file records only counts and behaviors.

### Worker-write interruption (registered before execution)

Use the accepted synthetic PR69 source and fixed alpha.15 tarball (`ecba8b89cc697fe55a9072ee0f592654af16a08b813e86d38746a8ff233dbdfa`), same model/effort, explicit currency revision and immutable quality oracles. The evaluator observes registered worker worktrees inside the disposable origin only. Interrupt only after reservation and billing source changes exist in two distinct worker worktrees while both integration sources remain unchanged; recheck this after the whole transient service stops. Then a fresh coordinator must discover and recover saved worker work without evaluator edits or integration, pass revised and legacy-replay tests, independent review and synthetic Draft/CI. Preserve failures and missing interrupted usage; this is recovery acceptance, not a performance pair. Existing integration-interruption results do not cover this condition. No product OS restriction is added. Local observer and process-stop checks pass (3 tests, no skips), and modified scripts pass ESLint.


Worker-write trial completed synthetic Draft PR77 at `0d086093ba98c865b544db1ffe35a9ed31a0626b`: 462.789 seconds total, 172.491 interrupted and 266.733 resumed implementation/review seconds. Both worker source hashes survived unchanged into the final commit; six prescribed oracles, independent review and both CI workflows passed without evaluator implementation/integration. Resumed usage is 726,851 tokens; interrupted last observation 748,497 is incomplete, so total tokens remain null. `native-worker-write-recovery.json` records this scoped recovery acceptance. Worker worktree names omitted required timestamps, so full naming-contract acceptance is false. A subsequent minimal coordination-reference correction points workers to the existing standard `worktree-create`; it is validated structurally but not credited to the alpha.15 run. Unpublished alpha.16 (`7486a30bfbd72eaf20b1d5d30105ea6696628c53ef928f806bc3c9a95676fa1d`) contains that correction. Performance acceptance remains unresolved.

### Conditional implementation guidance diagnostic (registered before execution)

Alpha.17 (`712d15b7c8d78e596ee59a0fb95c19ae6e64e76870e3327c92ff620f20f9c235`) moves the unchanged detailed business-operation/input-boundary guidance into a packaged reference, selected before implementation for UI/API/business/persistence/input-boundary changes or uncertainty. The main entry retains the outcome and applicability rule. It also includes alpha.16 worker naming clarification. No test, review or authority requirement is removed. Inspecting saved alpha.15 synthetic calls showed the full main Skill read on the small spelling fixture, despite those detailed branches being irrelevant. Measure one fresh baseline alpha.6 then candidate alpha.17 small diagnostic with the unchanged model/fixture/oracle and Draft/CI; preserve both results regardless of direction. This is not the five-pair performance acceptance. A complex diagnostic must also confirm relevant guidance is selected and the quality oracle still passes before accepting the routing change. No reuse of older pilot times as a fresh control.

Before candidate execution, the isolated package test rejected alpha.17: the new reference was absent from `runtime-files.json`, so consumer-installed Skill links were broken. Six tests passed, one failed; alpha.17 was not run as a model candidate. Added the reference to the source inventory, confirmed the moved quality text is byte-identical to its former main-Skill section, and reran all seven package tests successfully in a dedicated temporary root. Candidate is now frozen as alpha.18 SHA256 `f15007634e4000c220e18a287546b82f76d8d479348b2d2e3c85fb3b9804e390` before its execution; the already running fresh alpha.6 baseline remains unchanged. This correction is packaging only and does not alter the fixture or oracle.


Fresh alpha.6 baseline completed PR78: 207.621 seconds / 275,977 tokens, exact-HEAD review and CI passed. Alpha.18 then terminated after 7.041 seconds with provider error `Selected model is at capacity`, before any model work; no token count is available. The failed attempt is retained in `native-conditional-pilot-capacity-failure.json`, not assigned zero cost or accepted as a comparison. Do not switch models to manufacture comparable performance. Any later retry is a separately identified attempt. The runtime inventory changed to deliver the new reference, so these two package identities cannot pass the strict same-runtime paired summary; this diagnostic alone must not count toward five-pair acceptance. A formal cohort needs both variants packaged with the identical runtime/inventory.

Matched control alpha.19 SHA256 `fa3b85bad1ff3bb26b6f0859f0d0bc3950a50e85638049814a84e25a8c0a2c72` was built in a disposable checkout from the current source, replacing only existing Skill files with the fixed alpha.6 contents. The new implementation reference remains packaged but is not referenced by the old Skill. Compared source-file identities with alpha.18: all non-Skill files are identical; differences are exactly main Skill, coordination, post-merge and review references. No runtime hash relaxation was made. This control is for a future preregistered matched cohort, not a relabeling of PR78. Retry the failed alpha.18 diagnostic as a distinct attempt after recording provider capacity failure, preserving model and candidate.


The separately identified alpha.18 retry also ended before work with the same provider capacity error (15.281 seconds). Preserve it as `native-conditional-pilot-capacity-retry.json`; do not issue further immediate identical model calls or claim candidate quality/performance. Current PR commit ff21ba22 Linux CI completed successfully along with Host/worktree platform checks. CodeRabbit status says Review paused, so the badge is not a fresh review.

The new worker-write driver now explicitly requires the checkpoint scope, two distinct worker directories, both expected changed-file hashes and their equality with submitted commit blobs. A resumed PASS alone cannot satisfy this scenario. Changed bytes are not declared equivalent without additional evidence. Historical older integration-interruption runs are not retroactively upgraded. 34 focused usage/review/pair/Git/interruption tests and ESLint passed, with no skips. A read-only audit of PR77's existing checkpoint and committed blobs passed in `native-worker-write-recovery-audit.json`; no additional model call was used.

Matched alpha.19 control was independently installed into a disposable non-Git consumer directory: all 187 distribution hashes matched, all 82 relative Markdown links resolved, and the bundled launcher executed `start` successfully without creating Git. This validates delivery of the comparison control, not performance. The third alpha.18 diagnostic attempt entered real model work after the two retained capacity failures; it is tracked separately and must not erase those failures. Current PR review-thread query returned no unresolved non-outdated inline threads; CodeRabbit's paused status still is not a fresh review.


The third alpha.18 diagnostic failed with the same model capacity error after 157.930 seconds, now after implementation and a valid independent reviewer PASS at `5d16b39bf68c25504113567a72c5edda52e4d747`. Last observed usage is 257,326 tokens across coordinator and reviewer; mark full-attempt usage incomplete and completion false. Exact-HEAD review was independently recovered from stored logs; no need to repeat it. The driver correctly did not publish a normal success after coordinator exit 1. No Draft PR or performance acceptance is claimed. Saved work and review remain available for a future explicitly identified recovery; do not silently replace this failed observation.

### Alpha.18 complex applicability diagnostic (registered before execution)

After the capacity failures, a data-free READY-only same-model availability probe completed normally (15,488 input / 5 output reported tokens; not fixture/performance evidence). Run the fixed alpha.18 tarball on the existing original two-service fixture with `--accessor-oracle`, same model/effort, immutable requirements/oracles and synthetic Draft/CI. Check whether the moved implementation reference is actually read before relevant business/input changes, whether delegated worktrees obey existing naming, and whether full quality/review/CI succeeds without evaluator intervention. This is one applicability/quality diagnostic, excluded from matched performance acceptance. Preserve any capacity failure; do not pool resumed or failed attempts with fresh pairs.

The complex alpha.18 applicability trial terminated with the recurring provider capacity error after 87.278 seconds. The implementation reference was actually read, and both workers were created through `worktree-create` with timestamp/Issue/slug matching their branches. These observations verify only routing and naming, not complex implementation quality or performance. The short availability probe did not predict sustained capacity. Model-dependent acceptance remains externally blocked after repeated failures across continuations; do not run further expensive identical retries or claim goal completion. Preserve the failed small commit/review and all trial roots for resumption. Required remaining work: full current-candidate complex quality, then fresh matched same-model paired performance acceptance, plus current-head independent review. Existing completed recovery and package tests remain valid within their recorded scope.


### Explicit resumption after provider capacity failure

User requested resumption. The saved small alpha.18 coordinator resumed with its original implementation and exact-HEAD review, and completed Draft PR79 / CI at `5d16b39bf68c25504113567a72c5edda52e4d747`. Original failure and bootstrap setup rejection remain recorded. No evaluator implementation/integration occurred, but evaluator-triggered resumption is one manual handoff. Observed cumulative usage is 305,760 tokens; whole elapsed time is 2,032.042 seconds including blocked downtime. This is recovery evidence, **not** a fresh autonomous performance pair. The original incomplete failed-attempt record remains unchanged.

With actual resumed model work now succeeding, run one separately identified fresh alpha.18 complex applicability diagnostic using the previously frozen model, fixture, accessor oracle and Draft/CI conditions. Preserve the earlier complex failure; no pooling with performance pairs. Required observations remain implementation-reference selection, standard worker naming, complete tests and independent review. This is an explicit retry after availability changed, not evidence that capacity is guaranteed.

The exporter now treats recorded coordinator recovery as at least one manual handoff, even when the delivery driver retained its default zero. Six export/pair-summary tests and ESLint pass. This prevents later re-export from silently presenting this recovery as uninterrupted autonomy; no product execution behavior or performance threshold changed.

The fresh complex retry again ended with provider capacity failure after 232.908 seconds. Partial worker work remains saved; no Draft/CI or full-quality acceptance. Two invalid multi-operation patch attempts were also observed, but the terminal error was capacity. Total tokens remain unasserted. Do not repeat unchanged expensive trials or reinterpret this as a performance success.

Latest failed complex retry: all four selected coordinator/descendant rollouts have terminal events. One descendant has missing usage, so total processed tokens remain null; last observations are retained without upgrading incomplete usage. Current PR has no unresolved non-outdated inline review threads, but CodeRabbit reports Review paused, not a fresh review.

### User-directed model update

New trials use `gpt-6-sol` / medium, as directed by the user. Fresh small/complex drivers record and execute the same model. Follow-on drivers inherit the accepted original model and effort instead of silently changing existing sessions. Earlier gpt-5.6-sol observations remain historical; no cross-model paired comparison. Candidate alpha.18 and matched control alpha.19 stay byte-identical. First verify a fresh complex candidate to complete quality applicability; only then run fresh alternating matched performance pairs. The prior error text alone does not establish service-wide capacity, account quota, or obsolete-model root cause. Local CLI is 0.153.4 with ChatGPT authentication, openai provider, and no API-key/proxy/base-URL overrides observed in the launch environment.

The first gpt-6-sol attempt was rejected before implementation after 6.688 seconds with HTTP 400: model not supported using this ChatGPT account invocation. A metadata-not-found warning preceded it. The local refreshed model cache lists gpt-6-sol, so cache visibility is not sufficient evidence of successful availability; root cause remains unresolved. No automatic fallback or comparison pooling.

Fresh evaluation drivers now require `ASC_EVAL_MODEL` and accept `ASC_EVAL_EFFORT` (medium by default). The evaluator chooses an actually available, user-authorized model before fixing a comparison cohort; this helper does not claim to implement product dynamic model routing. Example invocation: `ASC_EVAL_MODEL=<verified-model> ASC_EVAL_EFFORT=medium node scripts/run-native-complex-candidate.mjs <tarball> <codex> --deliver --accessor-oracle`. Continuations inherit recorded model/effort and reject conflicting environment overrides before clone or model execution. Seven model-condition/pair-acceptance tests and ESLint pass. Historical trial files are unchanged.

Same-model READY-only probe using existing Codex CLI 0.155.0-alpha.16.3 succeeded under the same ChatGPT authentication (15,764 input / 5 output tokens), unlike 0.153.4. No tools or project files were used. Use this verified CLI for new gpt-6-sol trials and both sides of future paired comparisons; preserve old failures. The existing native-executable runtime resolver supports this binary without widening read roots. Register one fresh complex alpha.18 applicability run with this CLI before performance acceptance.

New CLI complex attempt failed before thread start (0.360 seconds): filesystem sandbox helper reported mountinfo path is not absolute. This is distinct from model rejection/capacity and does not establish model unavailability. No isolation bypass performed. CLI versions are now recorded for future trials and required by matched-performance acceptance; missing/different versions are rejected. Nine targeted tests and ESLint pass. This diagnostic began before automatic CLI-version recording and is retained separately, not upgraded to a matched observation.

Model-free diagnosis isolates the new CLI failure to interaction with mount topology: old CLI exits 0 and new CLI fails on the host topology; new CLI sandbox exits 0 inside a minimal disposable user/mount/network namespace with no credentials. Host has an nsfs mount whose root field is not absolute. This correlation is not proof that this specific entry causes the failure. The temporary namespace first omitted CLI read permission; the corrected invocation explicitly grants its binary and succeeds. No host mount/service changes, isolation bypass, or model requests occurred. Full model execution under a compatible topology is still pending.

Minimal new-CLI/model/tool probe passed inside the disposable mount namespace after adding only the real resolver-file target: gpt-6-sol / medium, 20.794 seconds, workspace write succeeded, outside dummy read denied, dummy unchanged. One shell call and provider usage retained. Earlier DNS-failing probe was deliberately interrupted after 135.562 seconds, not treated as a model timeout. Agent network remained disabled but was not exercised here. This validates an execution route, not full quality/performance or universal isolation. Host mounts/services were unchanged.

Register fresh complex applicability run: alpha.18, gpt-6-sol / medium, CLI 0.155.0-alpha.16.3, explicit `ASC_EVAL_MOUNT_MODE=clean-linux`. The evaluator-only wrapper reconstructs a disposable mount environment, retaining unchanged inner Codex tool permissions, provider authentication and network. It does not change product defaults or host mounts. Both future comparison sides must use the same recorded mount mode and CLI. Twelve targeted tests and ESLint pass; the full complex run follows, without evaluator planning or implementation.

The gpt-6-sol / new CLI / clean-mount complex trial progressed through two worker commits, integration, independent review and repairs, then failed with the same capacity message after 584.905 seconds. Final saved HEAD is `86d485b6d93a4690944fe076fa0a04aad9e8cfa6`, without completed final re-review or Draft/CI. Five selected thread logs report 2,808,835 observed processed tokens; full failed-attempt usage remains incomplete. No evaluator implementation edits occurred. The old model name alone cannot explain the recurring error. Preserve source/commits/reviews for recovery; do not start fresh expensive repetitions or performance pairs before quality completion.

Complex alpha.18 / current Sol recovery completed Draft PR80 at `86d485b6d93a4690944fe076fa0a04aad9e8cfa6`: five fixed oracles, direct non-forked exact-HEAD reviewer PASS, both complex and greeting CI successful. Same coordinator resumed for 91.225 seconds after the original 584.905-second failed attempt. Cumulative observed usage 3,280,152; original failed usage remains marked incomplete. Evaluator initially rejected valid reviewer name independent_review_recheck because only numbered suffixes were accepted. Added explicit recheck recognition while preserving direct-parent, non-forked, final-turn, exact-HEAD and conflicting-verdict checks; 12 regression tests and ESLint pass. Test initially expected the later rejection message while inherited-identity guard rejected earlier; corrected the expected error, not the guard. Record both manual resumption and post-observation evaluator correction; exclude this run from fresh performance pairs. Product quality applicability now has completed synthetic evidence, but uninterrupted latest-candidate autonomy and performance superiority remain unproven.

### Current Sol matched small cohort (registered before execution)

Fixed baseline alpha.19 SHA256 fa3b85bad1ff3bb26b6f0859f0d0bc3950a50e85638049814a84e25a8c0a2c72 vs candidate alpha.18 SHA256 f15007634e4000c220e18a287546b82f76d8d479348b2d2e3c85fb3b9804e390. Model gpt-6-sol / medium; CLI 0.155.0-alpha.16.3; clean-linux evaluation mount. Fixed simple fixture/oracles, independent review, Draft/CI. Five fresh pairs ordered BC, CB, BC, CB, BC, sequential runs to avoid concurrent-load confounding. Retain all errors and missing usage; stop on a failed run without silently replacing it. Predeclared futility stop if both first two pairs regress in both time and tokens; that cannot establish five-pair acceptance. Otherwise finish five and use unchanged median/worst-case/quality acceptance. This is small-fixture performance only, not complex-performance proof.

Current Sol matched small cohort stopped at pair 3 baseline under the preregistered failure rule: capacity error after 28.663 seconds following source edits. Four complete runs / two pairs pass quality and both pairs improve time/tokens; the fifth attempted run failed and is not replaced. No five-pair performance acceptance; summary explicitly records incomplete cohort and retains failed usage as incomplete. Latest environment can execute some requests but sustained model availability remains unreliable; repeated fresh trials would spend more without satisfying the fixed cohort contract.

### Capacity回復のController修正（2026-10-19、未実走）

任意ControllerのCodex adapterで、実測したprovider終端`turn.failed`のcapacity応答を`ASC_PROVIDER_CAPACITY`へ分類する。通常のツール出力、認証・未対応モデル、終了確認失敗は対象外。実装中の当該エラーは既存の変更範囲検査・checkpoint保存後、同一内容につき一度だけ1秒待って継続する。内容が変化しない反復は停止しcheckpointを残す。これは開発全体の時間上限ではなく即時再呼出しを避ける間隔であり、最適な間隔の実測値ではない。ownerのAgent予算・時間予算は維持し、provider失敗をコード修復回数には加算しない。失敗usageは欠測として保持し、独立レビューと検証を省略しない。

検証：provider分類とworkflow回帰43件成功、追加の範囲逸脱・Agent予算回帰1件成功。Git・隔離検証は実行したがAgent/providerは試験用代替である。current-host経路とHost adapterへのエラー伝達、実モデルの自動再開はまだ未確認。この修正を既存の手動復旧観測や性能比較の成功へ遡及適用しない。

同日の追加修正：同梱Codex Hostはcapacityのみを呼出しID・操作に拘束した失敗応答として返し、Controller側で分類を維持する。既存のHost transport失敗・timeout・出力超過をcapacityへ読み替えない。Host/protocol関連16件と別プロセスHostの成果再開シナリオ1件が成功（実Git・実Node検証、モデルとGitHubは代替）。current-hostの進行役自体が停止した場合の再開はこのController接続では解決していない。

#### current-host進行役の再開境界

`run-native-delivery-candidate.mjs`はCodex進行役を起動し、そのprocess終了後に結果を書いて終了する。capacity後の自動resumeは実装されていない。従って今回の実走停止を、任意Controllerの修正のみで解消したとは扱えない。current-hostは利用者が起動したHostの中でSkillを実行する経路であり、Skill自身は停止済みの進行役を起動できない。既存Hostのresume機能を使う外側の起動主体との接続が必要。

[OpenAI公式non-interactive資料](https://learn.chatgpt.com/docs/non-interactive-mode)（2026-10-19確認）は`codex exec resume <SESSION_ID>`を示している。これは再開APIの存在の根拠であり、capacityから自動復旧する保証ではない。複数Issueが並走するため`--last`での対象推定は使わず、対象session・worktree・権限を保持して再開する必要がある。既存手動復旧観測を自動復旧実績へ書き換えない。

Claude主要環境の前提確認：`claude-session-continuity.json`は同一session IDの2turn、`claude-sandbox-probe.json`はClaude Bashから正常書込みと外部dummy拒否を実測。最初のBash拒否も除外せず記録した。通信、並列Issue、子Agent境界、PR/CIの証拠には代用しない。

Codex合成評価runnerには同一sessionへのcapacity再開を最大一度だけ追加。モデル・権限・Git controlの対応を維持し、各attemptを別ログに残す。通常の認証失敗は再開せず、繰返すcapacityは終了する。評価補助であり配布製品のcurrent-host supervisorではない。再開試行のusage完全性が未確定な間はexportに欠測を追加し、旧比較条件とはrecoveryPolicyで分離する。合成プロセス試験とexport回帰3件成功。実モデルの自動復旧は未検証。

Claude小規模実走：配布alpha.18をClaude Code 2.1.282のSonnet進行役で使用し、実装→実テスト→独立Claude ReviewerがPASS。Hostで差分・対象commitを再確認し、公開合成Draft PR #85とCI成功に到達した。126.456秒は実装・レビューのCLI計測、503,022 tokensは親13messageとReviewer4messageをID重複排除した入力・出力・cacheの延べ合計で、Host modelUsageと4区分すべて一致。請求額ではない。実装・計画への人手修正0。ただし公開用Hostスクリプトは実走後に評価者が作成したため、配布製品の完全自律Deliveryや比較性能の合格証拠にはしない。詳細は`claude-small-delivery.json`。複雑Goal・複数Issue・中断復旧は引き続き未受入。

Claude複雑2Issueの実走開始：固定base `b7a906256f6f0aa2705d2517e69f7d3a6503ccff`、配布alpha.18、Claude Code 2.1.282、Sonnet。予約9001と請求9002を同一進行役が別worktreeへbackground委譲したことを実イベントで確認。作業中のため成功・性能の判定は未実施。評価用`claude-usage.mjs`は明示した親・配下transcriptをmessage IDで重複排除し、HostのmodelUsageと照合する。欠測・配下欠落・不一致はcompleteにせず、2反例試験と既存小規模実走の4区分一致で確認した。

独立レビュー中のcapacityも、対象が不変なら同じ検証結果を維持し、新しいReviewer呼出しだけを一度再試行する。実装・検証の再実行やコード修復予算消費はしない。対象変更・同じ対象での再失敗は停止。Controller/Host/provider分類の関連回帰57件が成功（レビュー回復と持続失敗を含む）。モデル実走で当該障害を再現した証明ではない。

Claude複雑2Issueの実装・統合・独立レビューが完了。HEAD `a8ae6d11e9cbe46abf1b7f276982ff728c84064b`でHostが5 oracleを再実行し全成功、許可2ファイルのみ・clean treeを確認した。実装2 AgentとReviewer1 AgentはいずれもClaude。`claude-complex-implementation.json`に記録。複数resultイベントの末尾durationを全体時間に流用しない。配下usage照合、Draft/CI、契約変更・中断復旧、比較性能は未完了であり、この観測を全体受入へ読み替えない。

Claude複雑初期契約は合成Draft PR #86・complex/test CI成功まで到達。親28message、予約19、請求10、Reviewer7をID重複排除し、4区分の合計3,131,529 tokensがHost modelUsageと一致。532.591秒はtranscript時刻範囲でありprocess全体実時間とは区別する。配布製品外のHost提出scriptを使った介入は残す。同じClaude sessionで共有通貨契約の後続変更を開始した。元成果の再実装は指示せず、immutable previous実装を移行oracle入力として準備し、改修前にcurrency assertion失敗を確認。評価者は製品実装を修正しない。

Claude PR86の追加反例：`reserve`のquantity getterがthrowすると、要求するstable code `VALIDATION`ではなくcodeなしの例外が漏れる。inventoryと再試行キーは保持。独立ReviewerのPASSと5 oracle/CI成功だけではこの呼出し境界を保証できなかったためqualityAccepted=falseとした。評価者は実装を直さず、進行中の共有契約変更後に根拠付き指摘として渡して是正と再レビューを評価する。

Claude同一sessionの共有契約変更：283.028秒、HEAD `8185b6e17b024ea02d990ca81cfcccb48ec3903e`、独立Reviewer PASS、旧保存データ互換を含む6 oracleをHostでも全成功。小さく結合した変更として進行役が直接修正し、Reviewerだけを新Contextにした。追加の入力例外指摘の是正を同じsessionで開始。累積transcriptとHost modelUsageの出力tokensに1,720の差がありusage未完として保持し、性能合格へ使わない。既存レビュー参照に、到達可能な入力取得・変換例外の契約拒否確認を1文追加。Skill専用validatorはPyYAML未導入で実行不可。既存の配布Skill更新・他Issue保持テスト1件とdiff検査は成功。これだけでレビュー精度改善済みとは扱わない。

Claude usage照合差の診断：共有契約Reviewer最終message `msg_011CgBJym8me39LZvFpMcGAH`は本文が記録されている一方、usageはstream途中値output_tokens=3・stop_reasonなしで終わる。残る3区分はHost集計と一致。差を推定補完せず、評価用集計器がmessage終端snapshot欠落を明示するよう修正した。合計が偶然一致してもcompleteにしない反例を含む3試験とESLint成功。製品runtimeに計測Agentや工程は追加していない。

Claude同一sessionの指摘是正：284.250秒、HEAD `4394ed49d3a4fa1e1197f03e1e2e0e88a92d5a32`。独立Reviewer PASS、6固定oracle、Hostの入力/actor/event取得例外・状態/再試行キー保持反例が成功。合成Draft PR87とcomplex/test CI成功。`claude-review-repair.json`へ保存。評価者が具体的指摘を渡した事実と当初レビューの見逃しは保持し、実装修正代行は0。累積observed 7,075,544 tokensは前段の終端usage欠落を含む不完全値。原レビューの精度や時間/tokens削減の合格へ読み替えない。

Claude競合・中断試験を開始。受入済み修正HEAD4394ed4から別worktreeに2つの誤ったvalidationコード変更を注入し、実cherry-pick競合を確認。Claudeがsourceを修正して保存した直後36.064秒で試験用process群へSIGINTを送り、全停止・保存後hashを確認。同一sessionを実ファイルから再開中。これは進行役1 writerの中断であり複数稼働workerの中断には代用しない。

次の比較候補を固定：candidate alpha.20 SHA256 a09fb246613f3647c5d61eb0be0d0aaac5596a894898adfe88b1420b2879cc84、baseline alpha.21 SHA256 c56efd5aef98bf290e7e90a4a4e6d020037cf31dcfcac2774a5ef533243d1401。runtime全ファイル一致、差分はSkill4ファイルと版/identityのみ。baselineは凍結済みalpha.19のSkillを再利用。candidateのoffline install/CLI版一致成功。性能試行は未開始、旧alpha.18の結果と合算しない。

Claude競合・保存後中断の復旧完了：再開126.067秒、HEAD `8b78cf2419ec389f3ee82ecd97782c58e24424e1`、独立PASS、6 oracle・合成Draft PR88・両CI成功。最終service内容は受入済み修正とbyte一致。中断前36.064秒と別記、欠測や評価runner介入を保持。

Claude小規模対比較を実行前登録：alpha.21 baseline対alpha.20 candidate、5組順序BC/CB/BC/CB/BC、逐次実行、CLI2.1.282・Sonnet alias・effort medium固定（実modelUsageのmodel一致を別途確認）、base c37e08e05abc46b5a26af131f134d42a3c8a3b80、Issue1・exact Hello oracle・fresh独立Reviewer・Draft/CIを同一条件。runner `run-claude-delivery.mjs`は実装代行なし、起動から提出CIまで計時、親子全transcriptを照合。失敗・欠測があれば試行を置換せず停止。最初の2組が時間/tokens両方悪化なら費用節約のため停止し不合格。残りは従来の5組中央値/品質/最悪値基準を維持。Codex比較や過去Claude単発と合算しない。parserとusage反例5件・ESLint成功。runnerはこのcohortの前に固定した評価器であり製品CLIの自律実行機能とは区別する。

Claude対比較の最初のbaselineは53.661秒で実装・独立レビュー完了後、Git control検査で停止。差分は2つの空config.worktree追加だけで値変更なし。Agentによる改ざんと断定せず、失敗とusageを`claude-cohort-initial-failure.json`に保持し当該cohortを打切り。評価setupで2ファイルを事前作成してpinする修正を行い、値変更・削除を引き続き拒否する8回帰とlint成功。修正後は新cohortとしてBC/CB/BC/CB/BCを同じモデル/effort/fixture/5組/停止基準で開始する。旧失敗を成功側へ混ぜない。

修正後Claude cohortのbaseline1はDraft PR89/CI成功、total130.346秒・598,233 processed tokens・全usage照合済み。`claude-cohort-v2-first-baseline.json`へ記録。固定runnerで残りC/CB/BC/CB/BCを逐次開始。実model/effort/CLI/base一致と全usageを毎回確認し、失敗・欠測・2組futilityで停止する。評価用runner以外の実装/計画/修復介入はしない。全組終了前の性能改善判定はしない。

Claude cohort v2は4試行目baselineのレビューhash対応付けで停止。完走3試行はB130.346秒/598233 tokens、C97.408秒/396084、C86.566秒/284326。失敗BはReviewerがPASS 62ed2beと短縮hashで返し、評価器が拒否した。`claude-matched-v2/`へ全3成功と失敗・停止を記録し五組不合格。評価器は短縮hashをGitで一意にcommitへ解決し提出HEADと一致した場合だけ受理するよう修正。文字列prefix一致、曖昧hash、短縮FAILとの矛盾を受理しない。関連10回帰とlint成功。旧失敗や待機時間を隠して完走に変更せず、今後の比較とは条件を分ける。

再実行前登録：短縮hashの一意Git解決を含む固定評価器でClaude cohort v3を新規10試行BC/CB/BC/CB/BCとして実施する。パッケージalpha21/20、Sonnet medium、CLI2.1.282、同一fixture/同一oracle、逐次、欠測/失敗/2組futility停止、5組の同一合格基準は維持。v1/v2の停止を消さず、v3へ旧成功試行を移植しない。これは評価器欠陥修正後の別条件であり旧失敗を取り替えた同一cohortとは説明しない。

### Fable consultation: prefer information preparation over a new dispatcher

The owner explicitly authorized Fable consultation and the detailed prompt. Claude CLI returned `success` using `claude-fable-5-1` with tools disabled. The detailed answer used the approved prompt unchanged. The consultation is architectural advice, not implementation, independent code verification or performance acceptance.

Fable recommends consolidating delegation facts and workspace preparation into one deterministic operation rather than introducing a dispatcher. The useful hypothesis is that a ready-to-use reference bundle may remove redundant discovery more effectively than another prohibition. Requirements interpretation and decomposition remain Host work; original requirements, scopes, exact test argv and review procedure references must remain accessible. The bundle must not invent acceptance criteria from filenames or oracle comments, hide necessary project rules, or imply authority to create worktrees or publish.

The implementation direction is to inspect reuse of existing `start`, `worktree-create`, project-context selection and workspace guidance before adding a command. No mandatory handoff document, fixed Step sequence, provider switch, snapshot or new Agent is justified by the present evidence. The current Host remains responsible for native delegation. Programmatic scheduling is not selected: `compileGoal` validates supplied plans but cannot invoke the parent's native Agent tool, while `runGoal` currently depends on snapshot execution.

Corrections to the adviser’s reasoning:

- The recorded 18 Bash tool calls are not necessarily 18 model turns. Neither bytes-times-calls nor tool counts alone establish token savings.
- Alpha.39/40 single observations do not establish that discovery ownership caused any reduction; alpha.40 still pre-read implementation and oracles.
- The previous registered-reviewer and compaction comparisons remain failed against their preregistered acceptance criteria. A statistical lack of superiority cannot retroactively change their acceptance outcome.
- Three pairs and a tolerance threshold do not by themselves prove noninferiority. Do not drop user-visible time from acceptance or replace the goal of lower time/tokens with merely fewer preparation calls.
- A preparation helper cannot guarantee the Host will stop further reading. Any benefit remains a hypothesis until tested, and generic advice about hiding handoff files from reviewers is not adopted; reviewers still need original contracts and factual references.

Before another live trial, a concrete candidate must demonstrate deterministic preservation of owner requirements, paths, verification argv and project contracts, including ordinary/non-Git/multi-repository cases as applicable. A finite diagnostic should then test whether it actually reduces predelegation discovery without losing quality. Only a prospectively fixed same-fixture/model/oracle comparison can support end-to-end performance acceptance; no reruns until a favorable outcome and no changes to historical failures. Current performance acceptance remains unmet.

### Opt-in preparation bundle diagnostic (alpha.42)

The first bounded candidate added packaged workspace/coordination guidance and command templates to `start --coordination`; it did not automate workspace creation or construct a complete delegation contract. The single preregistered complex run completed six oracles, independent review and synthetic Draft PR157/both CI without evaluator implementation intervention: 360.540673553 seconds, 2,076,645 processed tokens, complete reported usage. The coordinator invoked the bundle successfully but read both guides again and read implementation/oracle bodies before delegation (21 predelegation Bash calls). The intended duplicate-discovery reduction was not observed. Withdraw this candidate rather than retain an unproven additional API or repeat identical runs. This does not reject every deterministic preparation approach or prove a general regression. See `claude-coordination-bundle-protocol.json` and `claude-coordination-bundle-result.json`.

### Final verification deduplication diagnostic (alpha.46, withdrawn)

Three successful alpha.44 transcripts showed the coordinator executing owner commands directly and then again through final `worktree-verify`. A one-paragraph candidate clarified that the latter can be the final test, while retaining developmental checks, changed-target retests and independent reviewer checks. Independent review found no weakened obligation. The predeclared single diagnostic completed PR165/CI, review and two inner/outer oracles with complete usage (107.586573467 seconds, 423,880 processed tokens), but the parent still ran both commands before commit and again through `worktree-verify`. Candidate withdrawn byte-for-byte; no paired repetitions. See `claude-final-verification-protocol.json` and `claude-final-verification-result.json`.

This narrows the next action: more prose does not enforce duplicate-work avoidance. Any further candidate must change an actual execution behavior or supply a directly usable existing result without weakening identity, independent review or project verification; another instruction-only repeat of this experiment is not justified. There is still no accepted time/tokens improvement.

### Tool-output observations without another model trial

`claude-tool-output-observations.json` records explicit parent/child transcripts for two alpha.44 small baselines, its successful complex run and the withdrawn alpha.46 diagnostic. The pure evaluator `scripts/claude-tool-observations.mjs` deduplicates repeated observations by tool ID, retains separate repeated executions, rejects conflicting identities, records unmatched/missing results, and publishes hashes/counts rather than transcript bodies or local paths. Two regression tests and ESLint passed. This is evaluation-only and adds no product invocation or Agent.

The complex parent used 19 Bash calls with 71,877 UTF-8 result bytes plus four Agent calls; workers produced 27,832 and 19,796 Bash result bytes and the reviewer 30,790. Small baseline parents produced 21,743 and 22,848 Bash result bytes. No exact serialized tool-input repetition was found within a thread. This does not contradict semantic duplication through different shell commands. Two complex-review failures were invalid `sed` expressions, not failed product tests; the small reviewer failure included a broad recursive grep. More output is not automatically waste, and bytes do not measure token count or causal savings. A command-key cache would miss the observed semantic overlap and risk stale results if expanded carelessly. Do not implement that cache or claim these byte counts as saved tokens.

### Complex matched cohort stopped on evaluator failure

The prospective alpha.47 baseline (frozen alpha.21 entrypoint, common alpha.44 runtime/reference assets) versus alpha.44 complex comparison stopped at its first baseline under the registered failure rule. The model completed implementation and independent review in 312.305838805 seconds, with complete observed usage of 1,998,395 tokens. Six inner and outer oracles passed, but the evaluator initially rejected a successful JSON result preceded by the exact target HEAD line from a batched Git command. The minimal parser correction accepts only that exact single prefix; other HEADs, arbitrary prefixes, duplicate prefixes, mismatched results and failed tool results remain rejected. Seven parser/export regression tests and independent review passed.

Original failure retained. Without model restart or implementation edits, the same saved HEAD was re-evaluated and submitted as synthetic Draft PR166; both CI workflows passed. No candidate trial or replacement baseline was launched. This is not an accepted matched comparison or a lower-cost claim. Protocol and failure/recovery record are `claude-complex-matched-protocol.json` and `claude-complex-matched-failure.json`.

### Complex matched v2: evaluator status suffix failure

The first baseline completed its model run in 390.752 seconds with 2,295,328 observed processed tokens (all six contexts reconciled). Its six in-Host checks passed at `7270a802dd23816ccead4c09243b9e2487deadba`, but the evaluator rejected the appended `EXIT: 0` shell status. The cohort stopped before the candidate; no trial was replaced. The parser now recognizes this exact suffix only when the Bash command ends with the corresponding immediate `echo "EXIT: $?"` idiom. Failed status, arbitrary output, stale identity and mismatched checks remain rejected. Eight related tests and an independent read-only review passed.

The saved commit was rechecked without model restart or implementation edits and reached synthetic Draft PR #167; both CI workflows passed. This is evaluator recovery, not uninterrupted autonomous completion or matched performance evidence. Protocol, redacted terminal status, full usage and recovery are retained in `claude-complex-matched-v2-protocol.json` and `claude-complex-matched-v2/`. Do not repeat expensive implementation merely to replace a measurement failure.

### Prepared worker worktrees: avoid duplicate Host allocation

The saved complex baseline in `claude-complex-matched-v2/recovery.json` launched two workers with Claude's `isolation: "worktree"` after creating their ASC worktrees. The coordinator then stopped both and launched replacements because the Host had allocated different worktrees. The two stopped contexts consumed 77,504 observed processed tokens; additional coordinator overhead is not causally isolated. This identifies a concrete avoidable operation, not a measured improvement.

`references/coordination.md` now specifies that a prepared worker worktree must not be combined with another Host worktree-allocation option. The final change is two sentences; existing standard creation, naming and identity checks remain. Independent review found no remaining concrete defect, and two existing asset update/relocation tests passed.

A single prospective alpha.48 diagnostic is recorded in `claude-worktree-delegation-protocol.json`. Its fixed package differs from alpha.44 only in coordination.md. It also contains a third sentence allowing Host creation; independent review identified ambiguity with the existing standard creation rule, and that sentence was removed from final source without modifying the running package. Therefore this run does not prove exact final-package behavior. Do not treat the ongoing observation as quality or performance acceptance.

The alpha.48 diagnostic completed at `0e780886fa08e65aa5ceb6d2c82909d14e6ad9aa`, synthetic Draft PR #168, both workflows successful. Total time was 407.426 seconds (model run 377.708), with 2,292,593 processed tokens and complete usage. Two workers were launched before either completion notification and no redundant isolation option or restart was observed. All six in-Host and external checks and the submitted-HEAD independent review passed. This validates the observed behavior in that candidate; one nonrandomized run and the removed third sentence prevent an exact final-source or performance claim.

A counterexample occurred in complex matched v3 candidate run 2 (`02-candidate.json`, Draft PR171). Despite the final two-sentence guidance, the coordinator again supplied `isolation: "worktree"` for both prepared workers, then stopped them and relaunched without it. Six checks, independent review and both CI workflows passed; all contexts and retry costs remain included (351.686 seconds, 2,117,583 processed tokens). Therefore the guidance is not an enforced guarantee against duplicate allocation. The comparison continues under its original fixed conditions; no in-run instruction or package changes are made. Do not characterize the earlier successful diagnostic as reliable prevention.

Complex matched v3 candidate run 3 (`03-candidate.json`, Draft PR174) detected a legacy idempotency replay conflict in the integration oracle. The coordinator inspected the changed billing canonical-input handling, delegated correction to the billing worker, integrated the corrected commit, and completed independent review, six in-Host/external checks and both CI workflows without evaluator implementation edits. Full participant usage was reconciled. Total 540.679 seconds and 3,904,975 processed tokens include the repair and initial duplicate worktree launches. This is observed autonomous test-driven correction in the fixed scenario, not performance improvement; do not exclude it from the matched cohort.

The saved v3 candidate run 2 also attempted `worktree-create .worktrees ...` for both workers before correcting the source to the checkout root. CLI help, workspace guidance and USAGE now name the argument `<repo-root>` and explain that the CLI creates/uses `.worktrees` below it. Runtime behavior is unchanged; actual help output, ESLint, whitespace checks and independent read-only review passed. The running v3 comparison uses frozen alpha.49/50 packages without this later wording fix; its performance results must not be attributed to this fix.

### v3 interim parent-tool diagnosis (seven completed executions)

`claude-complex-matched-v3-parent-diagnostic.json` separates parent events from streamed child events (`parent_tool_use_id`) and deduplicates tool-use IDs. This is diagnostic evidence, not a performance acceptance result. Candidate pair 4 completed all quality checks, independent review, Draft PR #175 and both CI workflows with complete usage: 348.266716152 seconds and 2,148,385 processed tokens. The five-pair cohort remains running.

Candidate pair 2 and pair 3 each requested two additional Host worktrees for already prepared worker worktrees, then stopped and relaunched those workers. Pair 3 had issued a full `cat` of the coordination reference at parent tool call 4 before the erroneous Agent calls 10 and 11; this directly contradicts treating reference availability/reading as sufficient prevention. Pair 4 omitted the extra Host isolation but retried two `worktree-create .worktrees` calls with the actual repository root. That argument ambiguity is addressed by the later CLI help change, which is absent from the frozen comparison packages.

Do not infer token savings from parent call counts: candidate pair 1 used 24 parent tool calls versus baseline 34 but took longer overall. Calls, successful completion, all-context usage and wall time answer different questions. The next implementation should address the observed point of failure rather than mandate another full guide read. No change to this running cohort's fixtures, packages, acceptance thresholds or trial count is made.

### Point-of-use worktree guidance after the v3 counterexample

The successful `worktree-create` CLI response now adds a short `notice`: use the returned `repo` for the worker and do not request another automatic worktree (including Claude `isolation: "worktree"`). Existing fields and creation behavior are unchanged. This puts the existing rule beside the concrete returned path without another guide read, Agent, dispatcher or persistent state. It is a behavioral hint, not enforcement or proven prevention.

The existing CLI-driven worktree creation test passed (source edits preserved, separate worktrees, existing branch not repurposed), as did CLI ESLint and diff checks. Independent review found no concrete compatibility/authority defect. Frozen v3 alpha.49/50 packages do not include this notice; their performance results cannot establish its benefit. A follow-up measurement is justified only as evaluation of this changed behavior, not a replacement of the negative v3 cohort.

The unpublished alpha.51 package (SHA-256 `089c2c76934dd6de95b6cc35f327520a615c2d38d2c00e6da3b08300c41901c7`) passed a synthetic packaged-CLI check under bubblewrap with network unshared and neither user HOME nor source checkout mounted. It created the standard worktree, returned the correct branch/base, allowed editing that returned worktree, and preserved the source checkout's uncommitted owner edit. `prepared-worktree-package-check.json` records scope and package identity. Compared with alpha.49, only CLI, workspace reference and USAGE source hashes differ. This confirms distribution behavior, not Agent compliance or performance improvement.

### Parent-context duplication observed in v3 pair 4

The completed pair 4 candidate's parent Bash results included 19,344 Unicode characters for “Read the two service files to be modified” and 18,132 for “Read remaining oracle check files” before delegation. Parent usage was 1,593,771 processed tokens versus baseline 884,350; non-parent usage was 554,614 versus baseline 835,047. These are measured context partitions, not a causal saving estimate. The same-pair baseline did not perform those two full-source pre-reads. Pair 3's billing-source read occurred during actual repair diagnosis and must not be indiscriminately removed.

The existing coordination guidance already says not to pre-read implementation/test contents solely to coordinate. This case demonstrates that keeping that guidance only in an optional reference does not reliably change execution. Any further change must preserve original requirements, contract understanding, worker source/test inspection and independent reviewer inspection, while addressing redundant parent reading at the delegation decision. Character counts are diagnostic sizes, not tokenizer counts; all-context usage remains the performance metric.

### Final v3 result: quality complete, performance rejected

All five fixed pairs completed without evaluator implementation/planning intervention. All ten runs passed the six in-Host and external oracles, independent review, synthetic Draft PR and both CI workflows, with complete reconciled usage. Final exports, status and summary are in `claude-complex-matched-v3/`; no trials were substituted or removed.

Baseline median: 321.555273226 seconds / 2,003,710 processed tokens. Candidate median: 348.266716152 seconds / 2,148,385 tokens (approximately 8.3% and 7.2% worse). Candidate worst case: 540.678727977 seconds / 3,904,975 tokens versus baseline 386.07100282 / 2,485,274. No pair improved both metrics. The preregistered acceptance fails. This preserves evidence of bounded-scope autonomous delivery and repair, but does not establish the objective's cost/time improvement.

Do not run this unchanged candidate again to seek a better sample. Observed repair, redundant worker worktrees, ambiguous worktree root arguments and parent source pre-reading remain distinct causes to address. The later alpha.51 CLI/workspace guidance is a separate change with a packaged isolation check, not a successful performance result. The active overall goal remains incomplete.

### Delegation reading split at the entrypoint

Moved the existing allocation-only pre-read guidance from coordination detail into the main Skill beside ordinary implementation guidance, removing duplicate prose. The parent still reads original requirements/contracts and resolves partitioning/design questions; direct implementation, worker investigation, independent review and diagnosis of failures retain their required inspection. This is a behavioral instruction, not enforced exclusion of files. Independent review found no concrete quality regression. Existing Skill relocation/update tests passed (2); the bundled Skill validator could not run because PyYAML is unavailable and is not counted as passed.

Unpublished alpha.52 will receive exactly one diagnostic run under `claude-delegation-read-split-protocol.json`, using the unchanged v3 fixture, runner, model and oracles. Its purpose is to inspect the three observed failure mechanisms after the changed guidance. A successful single run does not satisfy performance acceptance or replace any v3 result.

### alpha.52 diagnostic outcome

The sole planned diagnostic completed: synthetic PR #179, all six in-Host/external oracles, independent review and both CI workflows passed; reconciled usage is complete. Total elapsed time was 305.260659654 seconds and processed tokens 2,150,631. `claude-delegation-read-split-result.json` preserves the full export. This is not a matched-pair performance result.

The parent inspected requirements/contracts and directory structure, then assigned two workers without first reading both service implementations and oracle bodies. No extra Agent worktree isolation or erroneous `.worktrees` source argument occurred. These observations support the changed delegation behavior in this one run only.

A stored-record replay still failed during integration and was autonomously repaired before review. The billing delegation explicitly referenced the original requirements, revision, previous implementation and replay oracle; its summary emphasized existing invoices being readable, but the integration test exposed an idempotency-key conflict for an old record. Thus the remaining failure is not explained by simple absence of requirement references. The relevant cross-service oracle can stop before checking the billing replay when the other service is not yet revised. An incomplete cross-service check must not be mistaken for validation of the worker's own compatibility obligation. No evaluator code or planning was supplied during this run.

The single run is faster than v3's baseline median but has more processed tokens; neither this cross-cohort observation nor improved initial behavior meets the five-pair performance condition. Do not claim the active goal complete or repeat alpha.52 unchanged to select a cheaper result.

### Unreached assertions are not worker verification

The alpha.52 billing worker report explicitly acknowledged that the legacy replay assertion was not reached after reservation's earlier assertion, but still characterized it as consistent with correct billing validation. The integrated run then failed at that billing assertion. This is a concrete incomplete-verification reasoning failure, not evidence to delete the oracle or broaden the worker's change scope.

The existing coordination paragraph now tells the parent to include the unreachable-assertion distinction in delegation: independently check applicable own conditions with existing/permitted means, report genuinely integration-dependent obligations, and rerun the original complete checks after integration. No universal new test file, Agent, Gate or wider scope is required. Independent review found no concrete defect. Exactly one changed-package diagnostic is preregistered in `claude-unreached-verification-protocol.json`; neither it nor the earlier diagnostic constitutes five-pair performance acceptance.

### alpha.53 diagnostic outcome: integration repair avoided, cost benefit absent

The one preregistered execution completed as synthetic PR #180 with all six in-Host/external oracles, independent review, both CI workflows and complete reconciled usage. Elapsed time: 373.93549912700007 seconds; processed tokens: 2,164,764. The full record is `claude-unreached-verification-result.json`. The parent integrated both worker commits, ran all six checks and proceeded to independent review without a further integration-fix commit. This supports successful integration in one changed-policy execution, not guaranteed prevention.

The result does not show a cost/time advantage over the previous diagnostic or the fixed v3 baseline medians. Preserve this negative cost observation alongside the successful quality result. Do not retry the unchanged candidate to select a favorable outcome. Additional instruction and pre-integration investigation have costs; reducing integration repairs is not by itself proof of lower total cost. The overall performance acceptance remains unfulfilled.

### Batched worktree materialization: isolated package comparison

Commit `19da5137` replaces per-small-file Git invocations with existing bounded batch framing; large assets still stream directly to disk. The migration suite passed all 22 tests, including mixed binary/empty/executable/large assets, source edits, filters, aliases, interruption and SHA-256 repositories. Independent code review found no concrete defect.

[Five paired package measurements](worktree-materialization-benchmark.json) compare unpublished alpha.53 and alpha.54 with identical synthetic Git input (2,004 files, 14,489,030 bytes), alternating BC/CB order in a network-unshared Linux namespace with no source checkout or user HOME mounted. Median worktree creation fell from 5.364963125 to 0.224827042 seconds; maximum from 5.979963851 to 0.228956529 seconds. All ten outputs retained exact bytes, executable mode, commit identity, a clean worktree and the original uncommitted owner edit. Fixture setup and validation are outside the timed interval. The reproducible script and package hashes are retained alongside the result.

This is a deterministic worktree operation improvement on this fixture and environment, not proof of lower overall development time or model tokens. No AI was called for this comparison. Prior failed model comparisons remain failed; overall performance acceptance remains incomplete.

### Worker call batching: delegation omission diagnostic

The alpha.53 trace contains 22 reservation-worker tool calls, including separate reads of already located requirements, revision, service and oracle files. The parent delegation omits the entrypoint's existing batching guidance. `claude-delegation-call-diagnostic.json` retains deduplicated per-context tool descriptions and usage; neither call counts nor this single observation prove savings. The independent review reference already contains batching guidance, so instruction availability is not enforcement.

Coordination guidance now passes the existing known-input batching rule to workers while preserving per-command status, sequential dependent investigation and scope. No Agent, Gate or mandatory document was added. Independent code review found no concrete defect; the asset installation/update preservation test passed. Exactly one unpublished alpha.55 diagnostic is frozen in `claude-worker-batching-protocol.json`. Its quality and complete usage are evaluated, but it cannot replace the failed v3 cohort or establish performance acceptance.

### alpha.55 failure retained: ambiguous evaluator topology instruction

The single diagnostic stopped before implementation/review/delivery after 172.918863102 seconds. `claude-worker-batching-failure.json` retains the failed execution, observed usage and missing evidence. The parent interpreted “two direct … workers” plus “No nested agents” as prohibiting native children, attempted Bash-launched Claude CLI workers, and received authentication/network failures. The Host init tool list and model match alpha.53; this is not established as a capacity or version failure. No permission relaxation, evaluator implementation or replacement successful trial was performed.

The evaluator wording now explicitly requires native parent-to-child Agent/Task delegation, prohibits grandchildren, and excludes a separate CLI substitute. This clarifies the intended topology, not the implementation plan or acceptance oracle. The failed alpha.55 observation remains failed. Any subsequent trial must pin the changed runner and cannot be pooled with frozen v3 or represented as a rerun under identical conditions. No performance saving is inferred from a short failed execution.

### Explicit native-child diagnostic outcome

With the clarified evaluator input, unpublished alpha.55 completed synthetic Draft PR #181, both CI workflows, all six in-Host/external oracles and independent review. `claude-native-child-result.json` retains complete reconciled usage: 312.88803652800004 seconds and 2,363,403 processed tokens. No evaluator implementation, planning or repair was supplied. This single changed-condition observation does not replace the prior failure or constitute paired performance acceptance. Tokens remain above v3's baseline median; no joint time/token improvement is claimed.

`claude-native-child-diagnostic.json` shows that the parent did not read the coordination reference and did not transmit its new batching instruction. It instead pre-read oracle contents and previous/current implementation differences, ran non-revised baseline checks, and issued two no-op wait calls. Parent usage was 1,291,047 processed tokens; workers 419,561 and 441,267; reviewer 211,528. Thus this trial does not establish the proposed delegation-batching mechanism at all, even though native child delegation and quality completion succeeded. More reference prose alone is not a demonstrated fix. Do not rerun the unchanged package seeking a better number; inspect how entrypoint/reference selection affects actual delegation before another model comparison.

### Reference routing at the delegation decision

The explicit-native-child trial read the Skill but skipped its coordination reference. `startWorktree` returns project context and the Skill location; it neither launches agents nor enforces reference application. Adding more coordination prose had no demonstrated effect in that trial.

Moved the existing “複数IssueとContextの引継ぎ” heading and paragraph from the later entrypoint section to immediately before the existing delegation guidance. No wording, requirements, links or byte count changed; removing the moved block from before/after yields identical content. This is reference routing, not a new workflow, runtime enforcement or proven performance reduction. The asset install/update preservation test passed. The prior failed/negative performance observations remain unchanged; behavioral benefit requires new evidence before another matched comparison.

### Coordination-routing diagnostic outcome and pruning

Unpublished alpha.56 completed synthetic Draft PR #182, all six in-Host/external oracles, independent review and both CI workflows with complete usage: 380.20755335 seconds and 2,533,153 processed tokens. `claude-coordination-routing-result.json` retains the result. The parent read coordination before delegation, but still issued separate preparation reads and no-op waits. Integrated legacy billing replay failed and the parent repaired canonical idempotency input before full verification and review; the evaluator supplied no implementation or repair.

Reference placement changed observed discovery, not a proven cost reduction. Neither this single observation nor the prior alpha.55 run meets matched performance acceptance; do not pool changed conditions or erase failures. Removed the two experimental sentences requiring delegation to repeat the entrypoint batching rule: observed benefit was absent, while repeated prose adds maintenance/context cost. The original entrypoint batching guidance, all scope/quality constraints and the zero-byte-growth reference relocation remain. This withdrawal is not itself a claimed performance improvement.

Further wording accumulation and unchanged-candidate reruns are not justified by these results. Existing preparation-bundle alpha.42 also failed to prevent repeated discovery. The next investigation should distinguish semantic work/repair cost from avoidable deterministic preparation, and evaluate an actual execution change before another expensive matched cohort.
