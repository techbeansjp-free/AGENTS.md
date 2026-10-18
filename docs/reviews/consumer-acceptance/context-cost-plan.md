# Contextと是正コストの比較

対象: PR #1606。性能改善は未証明。利用者から提供された集計・プロジェクト情報・ログは転載しない。

## 再設定した目標と完了条件（進行中）

以前の「レビュー可能なPR」の完了判定を撤回する。以下を満たすまで、本目標を完了にしない。過去の試験は個別の根拠として残し、人手の統合・修復を自律成功へ読み替えない。

- 主対象は標準current-host/worktree経路。ownerの元要求、許可範囲、必要な依存と検証環境から開始する。別Hostを強制せず、CodexとClaude Codeの結果を分ける。
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

## 現在の証拠

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
