# ASCのSkillが読まれる仕組みの測定の準備（#1814）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 現在の状態

**モデルを呼ばない準備だけを終えた段階である。モデルの実行（隔離の確認を含む）はまだ1回も行っていない。測定の結果は無い。**

- 測定の計画：[EVAL_PLAN.md](EVAL_PLAN.md)。条件はR（登録だけ）・P（`CLAUDE.md`に文例）・H（SessionStartのhookで文例を注入）。PH（両方）・S（強い文面のhook）は費用の上限の外に置いた。
- 合格の水準と判定の規則：[decision-criteria.md](decision-criteria.md)。ownerの決定（費用の上限30 USD、Claude Codeだけ、本文の読込み80%以上かつ手順の適用が現状より多い、該当しない依頼での過剰な読込みは現状＋1試行まで）を反映した。
- 依頼とgold：[cases.json](cases.json)（14件。#1783の9件を変えずに使い、asc-3・ui-1・es-1・do-1・neg-3を追加）。条件：[conditions.json](conditions.json)。導入するrelease：[release.json](release.json)（v0.5.106、tarballのsha256）。
- harness：[harness/](harness/)。モデルを呼ばずに、release tarballからの導入・入口の照合・条件の適用・hookの出力・配置の検査・試行の計画までを通せる。
- 改善の設計案：[IMPROVEMENT_DESIGN.md](IMPROVEMENT_DESIGN.md)（未実装）。

## 実施したこと（モデルを呼ばない）

| 項目 | 結果 | 記録 |
| --- | --- | --- |
| 採点器・隔離の判定器・配置の検査・台帳・固定・中立のcommit・導入の照合・記録の取り出しの試験（合成の記録） | 35件すべて合格 | [results/harness-tests.txt](results/harness-tests.txt)（command・HEAD・Nodeの版・終了code付き） |
| 全体のdry run | 合格。採点器のSkillの一覧がreleaseの配布一覧と一致、全条件のcommitの件名が同じ（中立の1件）。導入（16件の入口がすべてあり、`distribution.json`の記録と一致し、本文へのlinkだけの薄い入口で、本文がpackageと一致）、goldのSkill本文とreferenceがreleaseにある、依頼が名指すfileがある、sample projectと条件ごとの複製の配置が合格、5条件の適用（`CLAUDE.md`の文例の有無、hookの出力が文例と一致・終了コード0・発火のlog）、試行の計画116試行・計画の費用25.04 USD | [results/dry-run.json](results/dry-run.json) |
| 起動の経路の拒否（反例） | 許可の環境変数が無い、台帳・上限が無い、`results/fixation.json`が無い、固定したfileが記録と違う、`--model`の指定、repositoryと実HOMEの下、releaseに無いdigest、tarballとdigestの不一致、dry runの代用品で作ったsample projectでの有料の試行を、それぞれ拒否した。`fixation.mjs check`の合格も記録した | [results/refusals.txt](results/refusals.txt) |

dry runで使ったtarball：**releaseの本物ではない。** このworktreeのHEAD（`51c3e022`、v0.5.106の対象commitと同じ）を`npm pack`で作った代用品（版の表記は0.5.0、sha256 `8a01707f…`）である。GitHubからのdownloadを、この準備の段階では行わないため。測定では[release.json](release.json)のtarballを取得し、sha256を照合してから使う。

導入の手順はUSAGEのとおり「Git管理済みの対象では専用worktreeで実施する」に従った（最初の試行で、main checkoutに直接`project-assets`を実行すると`Use a dedicated Git worktree`で止まったため、sample projectの中に作業用worktreeを作って導入・commitし、mainへ取り込む形にした）。

## ownerの決定と、残る確認事項

| 事項 | 状態 |
| --- | --- |
| 費用の上限 | 決定：30 USD（Hostの計算値） |
| 測定するHost | 決定：Claude Codeだけ。Codexは対象外 |
| 改善の合格の水準 | 決定：[decision-criteria.md](decision-criteria.md) |
| 改善で標準にする仕組みの採否 | 測定の後にownerが決める |
| 測定に使うmodel | 統括の決定：`sonnet`の別名（#1807の生成と同じ）。解決後のmodel idを試行ごとに記録。[decision-criteria.md](decision-criteria.md)で固定 |
| toolの制限 | 統括の決定：`Read`・`Glob`・`Grep`・`Skill`だけ。利用者の環境との意図した違いとして記録（[EVAL_PLAN.md](EVAL_PLAN.md#利用者の環境との意図した違い)）。ownerの了承を求める |
| 認証の渡し方 | 統括の確認事項。試行ごとの空のHOMEではOSの資格情報の保管場所を使わないため、`CLAUDE_CODE_OAUTH_TOKEN`または`ANTHROPIC_API_KEY`を実行するshellの環境変数で渡す |
| releaseの取得・実HOMEへの目印fileの作成 | 測定の開始時に行う（[EVAL_PLAN.md](EVAL_PLAN.md#手順)） |

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
| 注記：toolの制限 | ownerの了承待ちのまま。測定の前に了承の記録が必要 |

## 費用の見込み

計画の単価（#1783・#1801の実績から1試行0.22 USD、隔離の確認1回0.1 USD）で、段階0〜3の合計116試行・25.04 USD（上限30 USD、起動を止める線は余裕を引いた29 USD）。各条件2回の反復にしたのは、3回では段階3（改善の後）が上限を超えるため。段階ごとに実績の単価で残りを見積もり、上限を超える見込みなら次の段階へ進まずに報告する。

## 行っていないこと

- モデルの実行（隔離の確認・段階1〜3）。認証・modelの確定と、統括の許可を待つ。
- releaseのtarballの取得（dry runは代用品）。
- 実HOMEへの目印fileの作成。
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
| [harness/ledger.mjs](harness/ledger.mjs)・[harness/fixation.mjs](harness/fixation.mjs) | 全段階の費用の台帳（一意なid、同じ名前の拒否）と順次実行のlock、追記だけの固定（段階3の制約付き）と照合 |
| [harness/dry-run.mjs](harness/dry-run.mjs) | モデルを呼ばない全体の確認 |
| [harness/score.test.mjs](harness/score.test.mjs)・[harness/probe.test.mjs](harness/probe.test.mjs) | 合成の記録による試験 |
| [results/](results/) | dry run・試験・拒否の反例の結果、測定の前の固定（`fixation.json`） |
