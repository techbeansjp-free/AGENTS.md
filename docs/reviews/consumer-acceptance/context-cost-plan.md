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
