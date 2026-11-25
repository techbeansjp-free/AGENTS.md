# ASCのSkillが読まれる仕組みの測定の準備（#1814）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 現在の状態

**段階0〜3の測定を終えた（2026-11-25）。結論は末尾の「[段階3（条件I）の結果と最終の結論](#段階3条件iの結果と最終の結論2026-11-25)」。この節の下の箇条と「実施したこと」「行っていないこと」は、モデルを呼ぶ前の準備の段階の記録として残している。**

- 測定の計画：[EVAL_PLAN.md](EVAL_PLAN.md)。条件はR（登録だけ）・P（`CLAUDE.md`に文例）・H（SessionStartのhookで文例を注入）。PH（両方）・S（強い文面のhook）は費用の上限の外に置いた。
- 合格の水準と判定の規則：[decision-criteria.md](decision-criteria.md)。ownerの決定（費用の上限30 USD、Claude Codeだけ、本文の読込み80%以上かつ手順の適用が現状より多い、該当しない依頼での過剰な読込みは現状＋1試行まで）を反映した。
- 依頼とgold：[cases.json](cases.json)（14件。#1783の9件を変えずに使い、asc-3・ui-1・es-1・do-1・neg-3を追加）。条件：[conditions.json](conditions.json)。導入するrelease：[release.json](release.json)（v0.5.106、tarballのsha256）。
- harness：[harness/](harness/)。モデルを呼ばずに、release tarballからの導入・入口の照合・条件の適用・hookの出力・配置の検査・試行の計画までを通せる。
- 改善の設計案：[IMPROVEMENT_DESIGN.md](IMPROVEMENT_DESIGN.md)（未実装）。

## 実施したこと（モデルを呼ばない）

| 項目 | 結果 | 記録 |
| --- | --- | --- |
| 採点器・隔離の判定器・配置の検査・台帳・固定・中立のcommit・導入の照合・記録の取り出しの試験（合成の記録） | 49件すべて合格 | [results/harness-tests.txt](results/harness-tests.txt)（command・HEAD・Nodeの版・終了code付き） |
| 全体のdry run | 合格。採点器のSkillの一覧がreleaseの配布一覧と一致、全条件のcommitの件名が同じ（中立の1件）。導入（16件の入口がすべてあり、`distribution.json`の記録と一致し、本文へのlinkだけの薄い入口で、本文がpackageと一致）、goldのSkill本文とreferenceがreleaseにある、依頼が名指すfileがある、sample projectと条件ごとの複製の配置が合格、5条件の適用（`CLAUDE.md`の文例の有無、hookの出力が文例と一致・終了コード0・発火のlog）、試行の計画116試行・計画の費用25.04 USD | [results/dry-run.json](results/dry-run.json) |
| 起動の経路の拒否（反例） | 許可の環境変数が無い、台帳・上限が無い、`results/fixation.json`が無い、固定したfileが記録と違う、`--model`の指定、repositoryと実HOMEの下、releaseに無いdigest、tarballとdigestの不一致、dry runの代用品で作ったsample projectでの有料の試行を、それぞれ拒否した。`fixation.mjs check`の合格も記録した | [results/refusals.txt](results/refusals.txt) |

dry runで使ったtarball：**releaseの本物ではない。** この作業の始めにHEAD `51c3e022`（v0.5.106の対象commitと同じ）で`npm pack`して作った代用品（版の表記は0.5.0、sha256 `8a01707f…`）である。このbranchは配布物に入るfileを変えていないので、配布物の内容はv0.5.106の対象commitと同じである。dry runそのものは、各記録のlabelにあるHEADで実行した。GitHubからのdownloadを、この準備の段階では行わないため。測定では[release.json](release.json)のtarballを取得し、sha256を照合してから使う。

導入の手順はUSAGEのとおり「Git管理済みの対象では専用worktreeで実施する」に従った（最初の試行で、main checkoutに直接`project-assets`を実行すると`Use a dedicated Git worktree`で止まったため、sample projectの中に作業用worktreeを作って導入・commitし、mainへ取り込む形にした）。

## ownerの決定と、残る確認事項

| 事項 | 状態 |
| --- | --- |
| 費用の上限 | 決定：30 USD（Hostの計算値） |
| 測定するHost | 決定：Claude Codeだけ。Codexは対象外 |
| 改善の合格の水準 | 決定：[decision-criteria.md](decision-criteria.md) |
| 改善で標準にする仕組みの採否 | 測定の後にownerが決める |
| 測定に使うmodel | 統括の決定：`sonnet`の別名（#1807の生成と同じ）。解決後のmodel idを試行ごとに記録。[decision-criteria.md](decision-criteria.md)で固定 |
| toolの制限 | 統括の決定：`Read`・`Glob`・`Grep`・`Skill`だけ。利用者の環境との意図した違いとして記録（[EVAL_PLAN.md](EVAL_PLAN.md#利用者の環境との意図した違い)）。ownerが了承（2026-11-25、Issueのコメント「ownerの判断（2回目）」） |
| 認証の渡し方 | ownerの決定（同上）：`claude setup-token`のtokenを、測定を動かすprocessの環境変数`CLAUDE_CODE_OAUTH_TOKEN`だけで子processへ渡す。統括が`CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" node harness/run-trial.mjs …`の形で起動し、harnessはfileを読まず、値を表示・記録しない |
| releaseの取得・実HOMEへの目印fileの作成 | 目印fileは実HOMEに一時的に置き、確認の後に削除することをownerが了承（同上）。どちらも測定の開始時に行う（[EVAL_PLAN.md](EVAL_PLAN.md#手順)） |

## 測定の前の固定

`results/fixation.json`の最初の記録のcommitは`d1ba482e5c4d315f6d4506a2372601104cb4c235`である（`run-trial.mjs`はこの記載を照合する）。費用の台帳（repositoryの外）の台帳idも同じ記録にあり、`run-trial.mjs`はこの台帳だけを使う。以後の記録は追記だけで、段階0の後の是正（refix）と段階3の記録の条件は[EVAL_PLAN.md](EVAL_PLAN.md)「固定の記録と変えてよい範囲」による。

## 段階0（隔離の確認）の結果

統括が実行した（R・P・H各1回、Hostの計算値で合計約0.22 USD、解決後のmodelは`claude-sonnet-5-5`）。判定の記録は[results/stage0/first/](results/stage0/first/)（実行時）と[results/stage0/recheck/](results/stage0/recheck/)（probe-checkの是正の後、同じ記録で判定し直したもの。モデルは呼んでいない）。

- 実行時は3条件とも、次の3項目を除いてすべて合格した：`noPlugins`、`debugPathsInsideTrial`、`noRealHomeOrRepoInDebug`。
  - `noPlugins`：Claude Codeの同梱plugin 3件（`cc-plugin-agents-md`・`cc-plugin-privacy`・`cc-plugin-plugin-authoring`、`path: "builtin"`、`source: "<名前>@builtin"`）がinit eventに載っていた。利用者の環境にも必ずあるので許可し、名前を結果の`builtinPlugins`に記録して条件の間で比べる。それ以外のpluginは不合格のまま。
  - `debugPathsInsideTrial`・`noRealHomeOrRepoInDebug`：原因は3つだった。(1) 目印のReadが拒否されたときにClaude Codeが書く`Permission suggestions for Read`の行（各probe 2行。ruleContentは2つの目印のfileの親directory）。実HOMEとrepositoryのpathが現れたのは、各probeでこの2行だけだった。repository側の行が`debugPathsInsideTrial`でも数えられたのは、repositoryのdirectory名に`AGENTS.md`が含まれ、keywordの絞り込みに当たったため（各probe 1行）。(2) 機械の管理用policyのpath（`/Library/Application Support/ClaudeCode/managed-settings.json`）が空白を含むため、「missing file」の行（各probe 6行）で途中から切れた断片が外のpathと数えられた。(3) Hではhookの出力の行（3行）にある文例の相対path`.agent-skill-chain/skills/asc/SKILL.md`の断片が外のpathと数えられた。加工していないdebug logはlocalのpathを含むのでrepositoryに入れない。代わりに、各probeのtrace・debug.log・stderrのsha256と、原因ごとの行数（pathの文字列は含まない）を[results/stage0/sources.json](results/stage0/sources.json)に記録した。
- 是正（段階0の後の是正。`harness/probe-check.mjs`だけを変更）：(1) は、行のすべてのruleContentが2つの目印のfileかその親directoryで、他の絶対pathを含まない場合だけ除外する。目印のpathを含む他の行も、他の絶対pathが無い場合だけ除外する。(2) は「missing file・broken symlink」の行に限り、管理用policyのpathを全体として除いてから断片を取る（存在して読み込まれた管理用のfileは外のpathとして残り、存在する管理用のfileの名前を`managedPolicyPresent`に記録する。今回は無し）。(3) は`.agent-skill-chain/`・`.claude/`で始まる相対path（直前がpathの文字でないもの）を全体として除く。`/x/.claude/…`・`~/.claude/…`は検査に残る。反例（同梱でないplugin、名前の違う同梱plugin、条件で違う同梱pluginの一覧、提案の行の外の実HOMEのpath、別のdirectoryを含む提案、目印と同じ行の別の絶対path、読み込まれた管理用のfile、相対pathと同じ行の実HOMEのpath等）が不合格になることを試験した。
- 判定し直した結果：3条件とも、`markerTokensAbsent`を除くすべての項目が合格。条件の間の比較は差が無い（`differ: []`）。`markerTokensAbsent`は、目印のfileを確認の後に消したため照合する文字列が無く、判定し直しでは不合格になる（実行時の判定では3条件とも合格。この項目のcodeと入力は是正で変わっていない）。どの1回の実行でも全項目が合格した記録はまだ無いので、規則6を満たすため、refixの後に目印を新しく作り、R・P・Hのprobeを`probe 2`として再実行する（統括が行う）。
- 完了：この是正は独立レビューを通し、統括が`fixation.mjs refix`で固定の記録に追記した。その後、目印を新しく作り、R・P・Hのprobeを`probe 2`として再実行した。比較（`compare`）でcommitの件名の前の短いidの有無だけが違ったため、`probe-check.mjs`の`gitSubjects`をもう一度だけ直し（独立レビューを通して2回目のrefix）、**R・P・Hとも全22項目が合格、比較も合格（差なし）**を確かめた。費用はR 0.067・P 0.068・H 0.070 USD。記録：[results/stage0/probe2/](results/stage0/probe2/)（localのpathを置き換えたもの）。順序（UTC）：1回目のrefixの記録 05:14:16 → 台帳の予約 seq 3〜5（R-probe-2 05:14:37、P-probe-2 05:15:05、H-probe-2 05:15:33。精算は05:15:59まで）→ 比較の是正の独立レビュー → 2回目のrefixの記録 05:17:45（`results/fixation.json`）。probe 2の各probeの合否は2回目のrefix（`gitSubjects`、比較だけに使う）の影響を受けない。

## 独立レビュー（1回目、HEAD `e2477706`）への対応

Medium 5件・Low 10件（Highなし）。すべて是正した。

| 指摘 | 是正 |
| --- | --- |
| M1 P・Hだけにcommitの件名「ASC read trigger」が入る | 全条件で同じ中立の件名（`Update project files`）のcommitを1件（Rは空のcommit）。dry runで全条件の件名が同じことを確認。段階0で回答のgitの状態を照合し、`compare`で条件の間の差がCLAUDE.md・hookの出力だけであることを確かめる（system context自体は観測できない限界を明記） |
| M2 本体の場所の除外が`~/.claude`等へ広がり得る | 実行fileのディレクトリだけを除外。そのディレクトリが実HOME・利用者の設定ディレクトリ・repositoryを含む、またはその中にある場合は不合格。反例の試験を追加 |
| M3 ownerの指示・memory・Skill・hookの混入を照合していない | `~/.claude`と`CLAUDE_CONFIG_DIR`の`CLAUDE.md`・各memoryの索引の先頭の行を照合（出力は件数だけ）、個人用Skillの名前との重なり、trace中の条件以外のhook eventを不合格に |
| M4 停止の規則が1つのruns-rootの中だけ | 全段階で1つの台帳、起動前に予算額を予約・終了後に精算、未精算は予算額、lockで1つずつ順に実行 |
| M5 modelが固定されていない | `sonnet`の別名に固定（統括の決定）、`--model`を拒否、解決後のidを記録 |
| L1 目印が同じ名前 | 名前を分け、完全なpathでそれぞれ照合 |
| L2 目印が読めないと検査が素通り | 2つの文字列がそろうことを必須に |
| L3 `#`の有無で不合格 | `#`を除いて照合 |
| L4 Grep・Globでの読取りを見逃す | Read・Grep・Globの入力を照合 |
| L5 init eventの無い記録が未選択になる | 失敗として数える |
| L6 hookが発火しなかったHの試行 | 失敗として数える（規則5に追記） |
| L7 digestを`release.json`と照合していない | 一致を必須に。dry runだけ`--allow-unreleased` |
| L8 meta・trials.jsonに版・HEADが無い | sample projectのHEAD・ASCの版・tarballのsha256・Claude Codeの版・解決後のmodelを記録。`collect`の存在しない欄の参照を削除 |
| L9 試行のHOME・設定に認証の情報が残る | 試行の後に消す。公開する記録のメールアドレス・key・アカウントの欄を置き換え、件数を記録 |
| L10 試験・拒否の記録にcommand等が無い | command・HEAD・Nodeの版・終了code付きで記録 |
| 注記：固定 | `results/fixation.json`（測定の前のHEADとfileのsha256）を別のcommitで記録。`run-trial.mjs`は一致しなければ起動しない。2回目のレビューの是正で形式を追記型に変えたため、測定の前に作り直した（下の表のN2） |
| 注記：Skillの名前の直書き | dry runで配布一覧と一致することを確認 |

## 再レビュー（2回目、HEAD `2c38a7a5`）への対応

Medium 3件・Low 7件（Highなし）。すべて是正した。

| 指摘 | 是正 |
| --- | --- |
| N1 台帳を試行名で数えるので、同じ名前の再実行で少なく数える | 予約ごとに一意なidを付けてidで数える。同じ試行名の2回目の予約は拒否する（再実行は新しい反復の番号）。台帳を手で書き換えて同じ名前が入っても、両方の予約を数えることを試験した |
| N2 段階3では固定し直すしかなく、手順も制約も無い | `fixation.json`を追記だけの記録に変えた（`init`は既存のfileを上書きしない）。段階3の記録は、最初の記録と比べて`conditions.I`の追加と`release.json`の`phase3`の記入だけを許し、それ以外の固定fileはbytesで同じことを`fixation.mjs stage3`が確かめる。各試行の`meta.json`・`trials.json`に`fixation.json`のsha256・記録のcommit・段階を残す。条件Iは、導入のときに採用した選択肢を承認する形（`make-fixture.mjs --adopt`）で作れるように、今のうちに実装した（段階3でscriptを変えずに済むようにするため） |
| N3 条件Pの隔離の確認が構造的に不合格になる | probeの質問を「最初の1行と最後の1行」に変えた。Pの合成の記録を、実際の質問への回答の形（最後の行が文例）で書き直し、最後の行に文例が無ければ不合格になる反例も加えた |
| L-1 hook eventの照合が合成の`command`欄に頼る | event名で分け、SessionStart以外のevent、条件以外のcommand、fixtureのhookのlogの件数を超えるSessionStartの応答を不合格にする。名前だけのeventの形でも合格・不合格になることを試験した。実際の形は段階0で確かめ、合わなければ報告する |
| L-2 起動の経路でreleaseからの導入を強制していない | 有料の試行は、導入の記録が`released: true`、tarballのsha256が`release.json`にある、複製の入口と`distribution.json`が記録と同じ、採用の選択肢が条件と同じ、の場合だけ起動する |
| L-3 「各条件2回」がコードで固定されていない | `conditions.json`の`runs`で固定。採点は反復の番号1〜2だけ。失敗した試行に限り、次の番号の試行1回で置き換えられる。それ以外は採点に含めず別に報告する（規則5に追記） |
| L-4 試験の記録がcommitの前の状態のもの | 是正をcommitした後のHEADで、試験・dry run・`fixation.mjs check`・拒否の反例（固定したfileが違う場合を含む）を実行して記録した |
| L-5 最後の試行の超過で30 USDを超え得る | 上限から余裕1 USDを引いた29 USDで止める |
| L-6 `meta.json`の無い試行で`collect`が止まる | 失敗の行として記録して続ける |
| L-7 `compare`がgitの行を文字列のまま比べる | commitの件名の集合として比べる |
| 注記：Skillの名前の直書き | 測定の手順2で、本物のreleaseでもdry run（`--allow-unreleased`なし）を行い、配布一覧との一致を確かめる |
| 注記：toolの制限 | ownerが了承した（2026-11-25） |

## 3回目のレビュー（HEAD `34323b5f`）への対応

Medium 1件・Low 6件（Highなし）。すべて是正した。

| 指摘 | 是正 |
| --- | --- |
| M-1 条件Iが、まだ無い製品のinterfaceを前提にしているのに、実物と違ったときに直す道が無い | 条件Iに固有の部分（計画の`readTrigger`の形と`--adopt-read-trigger`、条件Iのprobeの期待、製品のhookの発火の数え方）を`harness/condition-i.mjs`に集めた。段階3で変えてよいのはこのfileだけで、fileごとに理由と独立レビューの参照を記録する。採点・gold・判定の規則・R/P/Hの経路はbytesで同じであることを`fixation.mjs stage3`が確かめる。条件Iのprobeの期待は、文例の頭が回答のどこかに現れることにした。probeに質問8（`.agent-skill-chain/skills/asc/SKILL.md`を含む文を原文で答える）を足した。段階0の後にprobe-check等を直す場合の固定のやり直し（refix）は、段階1・2の試行が台帳に無い間だけ、独立レビューを通して行える |
| L-a 上限と1試行の予算が引数で変えられる | `conditions.json`の`budget`（上限30・余裕1・1試行0.6 USD）だけから取る。`--stop-usd`・`--budget`は拒否する |
| L-b 複製の照合が入口と`distribution.json`だけ | 複製の直後に、HEADが`sampleHead`と同じで、未commit・未追跡のfileが無いことを必須にした（本文の改変と後から置いたfileを反例で確かめた） |
| L-c `fixation.json`自体を照合していない | 起動時に、`fixation.json`がcommit済みで変更が無いこと、各記録のcommitがHEADの履歴にあること、最初の記録のcommitがこのREADMEに書かれていることを確かめる |
| L-d `conditionISchema`を強制していない | `fixation.mjs stage3`が強制する（判定は`condition-i.mjs`ではなく`fixation.mjs`に置き、段階3で緩められないようにした） |
| L-e 段階3で`trials.json`を上書きする | 追記にし、既に集めた試行名は、何も書く前に拒否する |
| L-f READMEの代用品の説明がdry runのlabelと食い違う | tarballを作ったHEADとdry runを実行したHEADを分けて書いた |

ownerの判断（2回目、2026-11-25）：認証、目印file、toolの制限の3つを了承。上の表と[EVAL_PLAN.md](EVAL_PLAN.md)に反映した。

## 4回目のレビュー（HEAD `d3232bfe`）への対応

Medium 1件・Low 5件（Highなし）。すべて是正した。

| 指摘 | 是正 |
| --- | --- |
| N-1 refixが存在しない`--ledger`で段階1・2の後にも使え、固定したfileを何でも変えられる。`run-trial`の`--ledger`の差替えで累計を戻せる | (b) refixは、記録した台帳idと同じ台帳fileが存在し、probeの予約が1件以上、段階1・2の予約が0件の場合だけ。(c) refixで変えてよいのは`probe-check.mjs`だけ（`conditions.json`の`budget`・`model`・`runs`、判定の規則、gold、採点はbytesで同じ）。(d) 台帳の1行目に一意なidを書き、`fixation.json`の`init`で記録する。`run-trial`は別の台帳を拒否し、試行の記録に台帳idと予約の番号を残し、`collect`・`score`は違うidや重なった番号を拒否する。(a) refixの記録が最初の段階1・2の予約より後なら`run-trial`は起動しない |
| L-1 `condition-i.mjs`の変更で採点を変えうる | exportの名前・importの行が最初の記録と同じで、最上位の処理が無いことを`stage3`で確かめる。独立レビューで確かめる点をEVAL_PLANに書いた |
| L-2 条件Iの文例の頭がprobe-checkにある | `condition-i.mjs`の`pointerHeadI`へ移した |
| L-3 条件Iで`hookFired`がfalseと数えられる | 製品のhookではtraceの証拠から取る |
| L-4 READMEの試験の件数 | 下の「実施したこと」を最新の件数に直した |
| L-5 強制終了で試行のHOME・設定が残る | lockが残ったときに手で消す手順をEVAL_PLANに書いた |

## 5回目のレビュー（HEAD `d7e1e525`）への対応

High・Mediumなし、Low 2件。固定したfileは変えず（変えてよいのは`probe-check.mjs`だけのため）、文書で対応した。

| 指摘 | 対応 |
| --- | --- |
| L-α 同じidの台帳を前の状態に戻すと、累計と記録を戻せる | codeでは防げないことをEVAL_PLANに正しく書き直した。各段階の後にただちに記録を集めてcommitし、統括が台帳の行数とsha256をIssueに記録し、次の段階の前に照合する手順を必須にした |
| L-β 形の検査が字下げした文や初期化式の中の処理を見落とす。`condition-i.mjs`は起動の経路でも読み込まれる | 見落とす形と、読み込む経路（run-trial・collect・score・probe-check）をEVAL_PLANに書き、Reviewerが本文を読んで、読込みの時の処理・globalの変更・見落とす形が無いことを確かめる点として加えた |

## 費用の見込み

計画の単価（#1783・#1801の実績から1試行0.22 USD、隔離の確認1回0.1 USD）で、段階0〜3の合計116試行・25.04 USD（上限30 USD、起動を止める線は余裕を引いた29 USD）。各条件2回の反復にしたのは、3回では段階3（改善の後）が上限を超えるため。段階ごとに実績の単価で残りを見積もり、上限を超える見込みなら次の段階へ進まずに報告する。

## 行っていないこと

- モデルの実行（隔離の確認・段階1〜3）。統括が最終確認の後に段階0を実行する。
- releaseのtarballの取得（dry runは代用品）。
- 実HOMEへの目印fileの作成（了承済み。測定の開始時に行い、確認の後に消す）。
- 改善の実装（不足の有無とownerの採否が決まってから）。
- Codexの測定（ownerの決定で対象外）。

## 未解決の懸念

- `claude -p`を空のHOMEで動かしたときに、projectのSessionStart hookが発火するか、projectの信頼（trust）がどう扱われるかは、隔離の確認で初めて分かる。発火しなければ条件Hは測れない（`hookMatchesCondition`で検出する）。
- init eventに`skills`が無い版では、Skillの一覧の確認が成り立たない（`ascListed`が不合格になり、測定へ進まない）。
- 200k Contextのmodelでは、#1801の観測で一覧の予算の余裕がほぼ無い。同梱Skillが増えた版ではASCの説明文が省かれ得る。隔離の確認の説明文の照合で検出する。
- 各条件2回では、水準の境界付近（該当する22試行で18試行前後）の判定がぶれ得る。
- 試行のsample projectの外への読書きの拒否はClaude Codeの権限の仕組みによる（OSの境界ではない）。隔離の確認の反例で確かめる。

## file

| file | 内容 |
| --- | --- |
| [EVAL_PLAN.md](EVAL_PLAN.md) | 測定の計画（環境・条件・依頼・測る値・段階と費用・隔離の確認・手順・限界） |
| [decision-criteria.md](decision-criteria.md) | 合格の水準と判定の規則（モデル実行の前に固定） |
| [cases.json](cases.json) | 依頼とgold、数え方 |
| [conditions.json](conditions.json) | 条件の定義（文例は導入したreleaseのUSAGEから取り出す） |
| [release.json](release.json) | 導入するreleaseの版とsha256 |
| [IMPROVEMENT_DESIGN.md](IMPROVEMENT_DESIGN.md) | `project-assets`で読む契機を提案する設計案（未実装） |
| [harness/make-fixture.mjs](harness/make-fixture.mjs)・[harness/install-asc.mjs](harness/install-asc.mjs) | sample projectの作成とreleaseからの導入・入口の照合 |
| [harness/apply-condition.mjs](harness/apply-condition.mjs) | 条件の適用（文例・hook） |
| [harness/guard.mjs](harness/guard.mjs) | 配置の検査 |
| [harness/run-trial.mjs](harness/run-trial.mjs) | 1試行の起動（既定はdry run） |
| [harness/probe-check.mjs](harness/probe-check.mjs)・[harness/markers.mjs](harness/markers.mjs) | 隔離の確認の判定と目印file |
| [harness/collect.mjs](harness/collect.mjs)・[harness/score.mjs](harness/score.mjs) | 記録の取り出し（local pathと認証情報の形の文字列の置換）と採点・判定 |
| [harness/condition-i.mjs](harness/condition-i.mjs) | 条件Iに固有の部分（段階3で理由と独立レビュー付きで変えてよい唯一のfile） |
| [harness/ledger.mjs](harness/ledger.mjs)・[harness/fixation.mjs](harness/fixation.mjs) | 全段階の費用の台帳（台帳id、予約ごとのidと番号、同じ名前の拒否）と順次実行のlock、追記だけの固定（refixと段階3の制約付き）と照合 |
| [harness/dry-run.mjs](harness/dry-run.mjs) | モデルを呼ばない全体の確認 |
| [harness/score.test.mjs](harness/score.test.mjs)・[harness/probe.test.mjs](harness/probe.test.mjs) | 合成の記録による試験 |
| [results/](results/) | dry run・試験・拒否の反例の結果、測定の前の固定（`fixation.json`）、段階1〜3の記録と判定（`traces/`・`stage1-R-score.json`・`stage2-judge.json`・`stage3-judge.json`） |

## 段階1（現状R）の結果（2026-11-25）

- 28試行（14依頼×2回）、失敗0、費用2.27 USD（Hostの計算値）、model `claude-sonnet-5-5`。記録：[results/traces/](results/traces/)（localのpathを置き換えたもの）、採点：[results/stage1-R-score.json](results/stage1-R-score.json)。
- **採点の手順の変更（逸脱）**：`collect.mjs`がpathを`<trial>`等へ置き換えた記録を`score.mjs`にかけると、`projectRelative`が置き換えた文字列を相対pathとして解決し、本文・referenceのReadを一致させられない（本文の読込みが全件0になる）。固定したcodeは変えず、置き換える前の記録（scratchの`runs/<trial>/trace.jsonl`）を同じ名前の並びにし、`collect.mjs`が作った`trials.json`と一緒に`score.mjs`へ渡して採点した。全条件に同じ手順を使う。公開する記録は置き換えたものだけである。
- 結果：該当する依頼22試行で、入口（Skill tool）20、**本文の読込み20/22（91%）**、手順の適用（本文・reference・回答の目印）15/22（68%）、誤選択1、未選択1。該当しない依頼6試行で過剰な読込み0。
- 規則1により「不足なし」（本文の読込みが80%以上）。ただし手順の適用は68%で、規則1の但し書きによりownerへ報告する。
- 依頼ごと：本文を読まなかった2試行は、どちらも`asc-3`（「docs/BRIEF.md の依頼に対応して。」という、#1807と同じ形の依頼）だった。1回は何も選ばず（未選択）、1回は`user-journey-acceptance`の入口だけを読んだ（誤選択）。開発の依頼であることが明示された依頼（`asc-1`・`asc-2`）では、`asc`の本文が4/4で読まれた。

## 改善の実装（ownerの判断：条件Pを標準、hookは採用しない）

ownerの判断の経緯：規則1では現状Rは「不足なし」（本文の読込み91%）だったが、但し書きにより手順の適用68%と、#1807と同じ形の依頼での未選択・誤選択を報告した。ownerは段階2（条件P・H）も測ると決め（[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1814#issuecomment-7153864082)）、段階2の後に条件Pを標準にし、hookは採用しないと決めた（[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1814#issuecomment-7154406019)）。

`project-assets`が、Claude Codeを登録した利用先で、USAGEの文例をCLAUDE.mdの末尾へ区切り付きで追記する案を差分付きで示し、`--adopt-read-trigger claude-md@<beforeSha256|absent>`で承認した場合だけ追記するようにした（[IMPROVEMENT_DESIGN.md](IMPROVEMENT_DESIGN.md)の先頭の注記）。承認の値は、製品のレビューを受けて`claude-md@<beforeSha256>:<blockSha256>`にした。そのため`harness/condition-i.mjs`を変えており、段階3の固定で理由とレビューの参照を付けて記録する。段階3（条件I）は、この変更を含むreleaseが出た後に行う。

承認の値と組立ての規則（2回目の製品レビューのLow-B）：承認の値は、変更前のfileのsha256と、追記する塊のsha256に結び付く。区切りの改行の入れ方や、CRLFへの変換といった組立ての規則には結び付いていない。それでも次の理由で、承認の形式は変えない（変えると`harness/condition-i.mjs`を再び変える必要がある）。(1) 適用の前に、結果の先頭が既存のbyteと完全に一致することを確かめるので、既存の内容は変わらない。(2) 追記する文はhashで結び付いている。(3) 計画と適用は、通常は同じ導入済みのreleaseで行う。(4) 組立ての規則が食い違いうるのは、計画と適用の間でASCの版を変えた場合だけである。CRLFとLFが混在するfileは、表示する差分と実際の追記が一致しないので、提案せず手で採用に回す。

## 段階2（条件P・H）の結果と判定（2026-11-25）

- 各28試行、失敗0。費用はP 2.44 USD、H 2.40 USD（Hostの計算値）。Hはhookが全28試行で発火した。採点は段階1と同じ手順（置き換える前の記録）で行った。記録：[results/traces/](results/traces/)、判定：[results/stage2-judge.json](results/stage2-judge.json)。

| 条件 | 本文の読込み | 手順の適用 | 過剰な読込み | 規則2の判定 |
| --- | --- | --- | --- | --- |
| R（現状、登録だけ） | 20/22 | 15/22 | 0/6 | （基準） |
| P（`CLAUDE.md`に文例） | **22/22** | **19/22** | 0/6 | **水準を満たす** |
| H（SessionStartのhookで文例を注入） | 22/22 | 15/22 | 0/6 | 満たさない（手順の適用が現状と同じ） |

- #1807と同じ形の依頼（`asc-3`）は、Rでは未選択・誤選択だったが、Pでは2回とも本文・reference・回答の目印まで満たした（`AA`）。Hでは2回とも本文を読んだが、手順の適用までは至らなかった（`BB`）。
- どの仕組みを標準にするかはownerが決める（規則2）。

## 段階3（条件I）の結果と最終の結論（2026-11-25）

### 固定と導入

- 条件I：`conditions.json`の`conditions.I`（`adopt: "claude-md"`、`hook: null`、`pointerDelivered: true`）。`release.json`の`phase3`にv0.5.108（PR #1816を含む、target commit `14801e9e`）を記入した。releaseはdraft・prereleaseではなく、tarballのsha256 `3f470278…`がSHA256SUMSとreleaseのassetのdigestの両方と一致した。
- 固定：`fixation.mjs stage3`で4件目の記録（段階`stage 3`）を足した。変えたfileは`harness/condition-i.mjs`だけで、理由は「承認の値に`:<blockSha256>`が加わった（PR #1816のレビューのMedium-1）。記録にblockSha256を加えた」、レビューの参照は「PR #1816の製品の変更の独立な再レビュー（host-session、opus、HEAD `a1b0e940`）で、condition-iの変更は条件Iの意味を変えないと判断」。それ以外の固定したfileはbytesで同じ（`stage3`の検査が合格、`fixation.mjs check`も合格）。
- sample project：v0.5.108のtarballから`make-fixture.mjs … --adopt claude-md`で新しく作った。`project-assets`の計画が示した`readTrigger`の選択肢`claude-md`（default `claude-md`、action `append`、beforeSha256 `cabbf71a…`＝条件R・Pと同じ基の`CLAUDE.md`、blockSha256 `444b31b5…`）を`--adopt-read-trigger`で承認して適用した。導入の記録は`released: true`、16件の入口が記録・packageと一致。

### 段階3の最初の隔離の確認（規則6）

- 新しい目印fileを実HOMEとこのrepositoryに作り、`I-probe-1`を1回実行した（0.08 USD、`claude-sonnet-5-5`、Claude Code 2.1.323）。`probe-check.mjs`の**全22項目が合格**（文例の頭が回答にある、hookの発火・応答が0、目印の読取りは拒否され文字列はどこにも無い、debug logに外のpathが0、ownerの指示・memory・個人用Skillが無い等）。段階0の実行時の判定（R・P・Hの`probe 2`）と`compare`して、tool・ASC以外のSkill・同梱plugin・gitの件名・modelに差が無い（`differ: []`、合格）。目印fileは確認の後に削除した。記録：[results/stage0/stage3/](results/stage0/stage3/)。

### 測定と採点

- 28試行（14依頼×2回）、失敗0、費用2.32 USD（Hostの計算値）。記録：[results/traces/](results/traces/)の`I-*`（localのpathを置き換えたもの、`trials.json`に追記）。試行はR/P/Hとは別のruns-rootで実行し、台帳は同じfileを使った。
- 採点は段階1・2と同じ手順（置き換える前の記録を同じ名前の並びにし、`collect.mjs`が作った`trials.json`と一緒に`score.mjs`へ渡す）で、`--judge R I`。判定：[results/stage3-judge.json](results/stage3-judge.json)。

| 条件 | 本文の読込み | 手順の適用 | 過剰な読込み | 誤選択・未選択 | 判定 |
| --- | --- | --- | --- | --- | --- |
| R（現状、登録だけ。段階1） | 20/22 | 15/22 | 0/6 | 1・1 | （基準） |
| P（`CLAUDE.md`に手で文例。段階2、参考） | 22/22 | 19/22 | 0/6 | 0・0 | 水準を満たす |
| **I（v0.5.108の`project-assets`の提案を承認して採用）** | **22/22** | **16/22** | **0/6** | 0・0 | **水準を満たす**（規則3） |

- 依頼ごと（I）：`asc-1`・`asc-2`・`rr-1`・`tw-1`・`se-1`・`ma-1`・`ui-1`・`do-1`は2回とも`AA`。`asc-3`・`ri-1`・`es-1`は2回とも`BB`（本文は読んだが、referenceの読込みか回答の目印が欠けた）。
- #1807と同じ形の依頼（`asc-3`）は、Rでは未選択・誤選択だったが、Iでは2回とも`asc`の本文を読んだ。ただしreferenceを読まず、手順の適用まで至らなかった（Pでは2回とも`AA`）。
- 手順の適用は、Rより1試行多いだけで、Pの19/22より少ない。Iの文例の本文はPと1字も違わず、違いは`project-assets`の採用で前後に区切りの注記（`<!-- asc:read-trigger v1 -->`・`<!-- /asc:read-trigger -->`）が付くこととASCの版（v0.5.106→v0.5.108）だけである。この差が手順の適用の差の原因かは、各条件2回の測定では区別できない（「限界」のとおり、境界付近の判定は粗い）。

### 最終の結論（規則3）

- 改善の後の条件I（ownerが採用した条件Pを、v0.5.108の`project-assets`の提案から承認して適用したもの）は、規則3の3つ（本文の読込み22/22＝100%≧80%、手順の適用16/22＞Rの15/22、過剰な読込み0≦Rの0＋1）をすべて満たし、**水準を満たす**。
- 留意点（ownerへの報告）：手順の適用の上積みは1試行で、水準の境界にある。本文まで読ませる効果（R 20/22→I 22/22、誤選択・未選択0）は明確だが、referenceまで読ませる効果は段階2のPより小さかった。

### 費用と台帳

- 段階3の費用：隔離の確認0.08 USD＋測定2.32 USD＝約2.40 USD。全段階の累計は約9.95 USD（台帳の精算額。未精算0件、予約119件）。上限30 USDの内。
- 段階3の前に、台帳が段階2の後の記録（181行、sha256 `3495ef6e0b7c53c6a05e6d3e47b25c92c30ea2a8244193e8c8b9ec725a4f8b58`）と一致することを確かめた。段階3の後も、先頭の181行のsha256は同じだった。
- 段階3の後の台帳：**239行、sha256 `f929c9f4aa06332ff7f11b58c85ab9f9908a0f0f71a672858a75859ba7cad882`**。

## 公開した記録の置換（2026-11-25）

- `results/traces/`等の公開した記録では、取り出しのときに試行のdirectoryを`<trial>`、利用者名を`<local>`に置き換えた（`collect.mjs`）。ただしPR #1816でmainに入った段階1・2の記録（P・Hのtraceの一部）には、一時directoryの名前と、測定を統括したsessionのidが残っていた。段階3のPRのcommitで、次のとおり置き換えた：一時directory以下のscratchのpath→`<scratch>/`、Claude Codeの設定のproject名→`<tmp-project>`、統括のsessionのid→`<session>`、残りの一時directory名→`<tmp>`・`<tmp-user>`。置換前の値はgitの履歴（PR #1816のmerge）に残る。
- P・Hのtraceのpathが`<scratch>/run1814b/runs/…/work/…`、R・Iが`<trial>/work/…`と書き方が違うのは、P・Hを別のruns root（symlink）から取り出したためで、数え方には影響しない（採点は置き換える前の記録で行った）。
- 各試行の`session_id`・message/requestのid・rate limitのevent・socketのpathは、隔離したHOMEで動かした使い捨ての`claude -p`のもので秘密ではないため、置き換えずに残す。

## この文書の古い記述について

「準備の段階の記録」の節と、ファイル一覧のうち`IMPROVEMENT_DESIGN.md`を「未実装」とする記述、「行っていないこと」「未解決の懸念」は、測定の前の時点の記録として残している。現在の状態は、段階1〜3の節と、上の「改善の実装」の節が正である。
