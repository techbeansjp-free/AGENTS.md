# 書込みのtoolとASCの読込み：段階2（#1820）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

**結果（2026-11-26）：判定は「採用の候補」**。書込みのある環境で、案内文とascの説明を直したSは、現状Bよりも、画面の依頼のフォルダでASCの本文を読ませた。下の「結果」を参照。「結果」より前の節は、測定の前の準備の記録である。

## 目的

段階1（[../README.md](../README.md)「結果」）で、#1815でASCの本文が読まれなかった原因は、toolや依頼文ではなくフォルダの違いだと分かった。画面の依頼のフォルダ（`CLAUDE.md`は案内文だけ、コードが無い、新しい画面を作る依頼）では、最初の2ターンで本文を読んだ試行が0/16だった（アプリのrepoでは15/16）。

段階2では、`CLAUDE.md`の案内文と`asc`のdescriptionを、「新しい画面・fileの作成など変更を伴う依頼でも、作業の前にASCを読む」ことが伝わる形に直した候補（S）を、現状（B）と書込みのある環境で比べ、ownerの基準で採用の候補かどうかを判定する。

## ownerの判断（2026-11-26、[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1820)「ownerの判断」）

- 書込みのある環境で、現状と改善版（`CLAUDE.md`の案内文と`asc`の説明を直したもの）を比べる。依頼は14依頼に#1815の形の依頼を加え、各4回。約15 USD。費用の上限は段階1・2の合計で25 USD。
- 採用の候補とする基準（書込みのある環境で、すべて満たすこと）：
  - 該当する依頼でのASC本文の読込みが8割以上で、現状より多い。
  - 手順の適用が現状以上。
  - 該当しない依頼での余計な読込みが、現状＋1回以内。
- 隔離の確認の目印fileは、#1820での使用を承認済み（[../results/probe-approval.json](../results/probe-approval.json)）。

## 候補の文面

候補は、release v0.5.111の対象commit `82d13c49`に2つの変更を加えたcommit `bbf55465`から作った（[release.json](release.json)）。

1. 読む契機の文例（`v05/USAGE.md`「ASCを読む契機を利用先へ採用する（任意）」の`text`の塊。`project-assets`がこの塊を`CLAUDE.md`へ追記する案として示す）の最初の文。残りの文は変えていない（commit `2afea59c`）。

   | | 文面 |
   | --- | --- |
   | 旧（B） | このプロジェクトでASCを使う開発の開始・再開・PR提出・許可されたmergeと後片付けでは、.agent-skill-chain/skills/asc/SKILL.mdを読み、依頼に必要なreferenceだけを参照する。 |
   | 新（S） | このプロジェクトでASCを使う。実装・修正・画面やファイルの新規作成など変更を伴う依頼（依頼の中身がBRIEF.md等のfileにある場合を含む）と、開発の開始・再開・PR提出・許可されたmergeと後片付けでは、fileを探す・読む前に.agent-skill-chain/skills/asc/SKILL.mdを読み、依頼に必要なreferenceだけを参照する。 |

2. `skills/asc/SKILL.md`のdescription（commit `bbf55465`）。利用先の`.claude/skills/asc/SKILL.md`（Claude Codeの入口）は、`project-assets`が導入時にこのfrontmatterを写して作る（`src/project-assets.mjs`の`entryBytes`。既定の引数は旧版からの移行の照合用で、使われない）。

   | | description |
   | --- | --- |
   | 旧（B） | Issue・タスクの開発の開始・再開、worktreeでの実装、PR提出、許可されたmergeで使う。 |
   | 新（S） | Issue・タスクの開発の開始・再開、実装・修正・画面やfileの作成など変更を伴う依頼、PR提出、許可されたmergeで使う。 |

   長さは51文字から64文字（＋13文字）。`v05/USAGE.md`のSkill一覧の予算（200k Contextで8,000文字。同梱Skillの構成によっては既にわずかに超える）の注意に対して、ASCの16件の説明文の合計の増分は13文字である。BとSで予算の状態が違うと、比べているのが文面ではなく一覧の省略になるため、probeで確かめる（下の「隔離の確認とSkill一覧の予算」）。

- 候補のtarball（`agent-skill-chain-0.5.111.tgz`、sha256 `c51f17ec…`）をv0.5.111のrelease asset（sha256 `e7df164a…`）と展開して比べ、違うfileは`package/release-identity.json`・`package/skills/asc/SKILL.md`・`package/v05/USAGE.md`の3件だけだった。`release-identity.json`の違いは、その2件のsha256だけである。案内文とdescriptionは導入時に`v05/USAGE.md`と`skills/asc/SKILL.md`から読まれるため、他のsourceやdataに文面の写しは無い。
- 製品の変更に合わせて、`test/test_project_read_trigger.mjs`に新しい文面（変更を伴う依頼・fileを探す前・除外の文の維持）の試験を加え、`test/test_project_assets.mjs`の既存の試験（登録した入口のdescriptionが同梱の`skills/asc/SKILL.md`と同じになること）に、新しいdescriptionの文面の照合を加えた。入口のdescriptionが同梱のものと同じになることは既存の試験（`.agents`・`.claude`の両方）が見ているため、同じことを見る試験は加えていない（独立レビューL3で重複を除いた）。

## 条件

| | B（現状） | S（改善版） |
| --- | --- | --- |
| 導入するtarball | release v0.5.111（段階1と同じ） | 上の候補 |
| 導入の手順 | 利用者の手順（専用のworktreeで`project-assets --register-claude-skill --apply`）。`project-assets`の提案から読む契機`claude-md`を採用する | 同じ |
| 採用される`CLAUDE.md`の塊 | 旧の文面 | 新の文面（最初の文だけが違う） |
| `asc`の入口のdescription | 旧 | 新 |

- toolは段階1の水準Wだけ：Read・Write・Edit・Glob・Grep・Skill、`--permission-mode acceptEdits`、Bashなし。隔離の`--settings`は段階1と同じ（水準Wのprobeが合格した設定）。
- model・認証・隔離（試行ごとの空のHOME・設定、repositoryと実HOMEの外）・中立のcommit・1つの台帳と順次実行は段階1・#1817と同じ。
- 条件の違いは、導入したtarballだけである。

### 隔離の確認とSkill一覧の予算（独立レビューM1）

- probe（B・S各1回）は段階1と同じく`--debug-file`で実行する（dry runの`probeDebugLog`）。
- probeの項目に次を加えた。`compare`と、測定の前の照合（`run-trial.mjs`が各probeを`trace.jsonl`・`meta.json`・`debug.log`から計算し直す。ただし台帳の精算に結び付けるのは`trace.jsonl`・`meta.json`のsha256だけで、`debug.log`は結び付けていない。下の限界）の合格の条件である。
  - (a) `skillListingRecorded`と`compare`：debug logがあり、`Skill listing over budget`の行がBにもSにも無い、または超過の状態（超過の有無、超過ならSkillの件数と予算。文字数はdescriptionの長さで違うので比べない）と、説明文が省かれたASCのSkill（`ascOmitted`）がBとSで同じ。違えば`compare`の`differ`に`skillListing`・`ascOmitted`が入り、不合格。
  - (b) `ascDescriptionsInContext`：ASCの16件のdescriptionがすべてContextにある。initのeventにはSkillの名前しか無く、debug logにも一覧の件数（`Sending 30 skills via attachment`）と超過の行しか無い（段階1のprobeの記録で確かめた）。このため、probeの質問2（Skillの一覧を名前とdescriptionの原文で書く。fileを読まずに）への回答に、16件のdescriptionが原文のまま含まれ、Skillのfileを読む・探す操作が無いことで確かめる。段階1の水準Wのprobeは16/16だった（[../results/probes/probe-WSA.json](../results/probes/probe-WSA.json)の`descriptionsVerbatimCount`）。
- debug logは、説明文が省かれた同梱Skillの名前を出さない。両方が超過した場合に同梱Skillの省略が同じかは確かめられない（限界）。

## 依頼

[cases.json](cases.json)。17依頼、各条件各4回、計136試行。

- fixture A（アプリのrepo、段階1・#1817と同じ）：#1814・#1817の14依頼をそのまま使う（依頼文・期待するSkill・reference・#1817の緩めた回答の目印）。該当する依頼11件（`asc` 3件、目的別Skill 8件）と該当しない依頼3件。`--max-turns`なし（#1817と同じ）。
- 画面の依頼のフォルダ（#1815の形）：`d-ui03`・`d-ui04`・`d-ui07`。#1815と同じ`BRIEF.md`・`data.json`・`FONTS.md`と空の`out/`（sha256を[conditions.json](conditions.json)で固定）。`CLAUDE.md`は採用した塊だけ。依頼文は段階1の依頼文G（#1815の文面からbrowserの注意書きを除いたもの）。
  - `--max-turns 3`：本文を読むかは最初のmessageで決まり、referenceは次のmessageで読まれる（#1817のtrace）。読まなかった場合、#1815のtraceは3番目のmessageで画面を書いていた。最初の3つのmessageで、本文とreferenceの読込みを見て、画面の生成の残り（#1815では約10ターン、0.215 USD）には払わない。

## 指標

[decision-criteria.md](decision-criteria.md)で固定した。#1817の採点（[harness/score.mjs](harness/score.mjs)）に、画面の依頼の規則を加えた。

- 本文の読込み（`bodyRead`）：期待するASCのSkillの本文の読込み（#1817と同じ。`asc`の依頼と画面の依頼では`asc`の本文）。
- 手順の適用（`applied`）：
  - fixture A：本文・必要なreferenceのどれか・回答の目印のすべて（#1817と同じ）。
  - 画面の依頼：`asc`の本文と、`implementation.md`か`workspace.md`のどちらかを、最初の3つのmessageの中で読むこと。新しい画面を作る依頼に当てはまるascの手順は、変更を伴う依頼の作業場所の決定（`workspace.md`）と、UIの変更・新規作成の規則（`implementation.md`）である。#1817のasc-3（依頼の中身がBRIEFにある依頼）と同じreferenceと同じ「どれか1つ」の規則にした。打ち切るので回答の目印は使わない。
- 余計な読込み（`overapplication`）：該当しない依頼で、ASCのSkill tool・入口・本文のいずれか（#1817と同じ）。
- 画面の依頼では、本文を最初に読んだmessageの番号、`Skill(asc)`、本文より前のWrite・Editの有無も記録する。

## 規則

- 採用の候補：該当する依頼の全体（fixture Aの11件と画面の依頼の3件、各条件56試行）で、次をすべて満たすこと（ownerの基準）。
  - (a) 本文の読込みの率が、Sで0.8以上、かつBより高い。
  - (b) 手順の適用の率が、SでB以上。
  - (c) 該当しない依頼での余計な読込みの件数が、SでB＋1以下。
- fixture Aと画面の依頼のそれぞれの値も別に示す。合否には使わない。
- 判定しない場合（完了も費用の線への到達も無い停止、置き換えの欠け、失敗10%超、有効な試行の無い依頼）、失敗と必須の置き換え、隔離の確認、実行の順序は#1817・段階1と同じ（[decision-criteria.md](decision-criteria.md)）。
- 各依頼4回では、数試行の差は偶然の範囲を出ない。判定は目安で、採否はownerが決める。

## 費用

- 上限：段階1・2の合計で25 USD。段階1の費用は2.0281387 USD（公開した台帳[../results/ledger.jsonl](../results/ledger.jsonl)、sha256を`conditions.json`で固定）。
- 段階2の上限は残りの22.97 USD（1セント未満を切り捨て）、停止の線は余裕1 USDを引いた21.97 USD。`run-trial.mjs`は、段階1の台帳のsha256と累計を照合し、段階2の新しい台帳の累計＋その試行の予算（0.6 USD）が線を超えるなら起動しない。2段階の合計は最大で約24.0 USD。
- 1試行の予算（`--max-budget-usd`と台帳の予約）：0.6 USD（#1817と同じ）。probeも0.6 USD。
- 見込み（dry runの`plan`）：
  - 計画の単価：fixture Aの試行0.12 USD（#1817の実績は読取りだけで平均0.085、最大0.141 USD。書込みのtoolでasc-3・ui-1等が長くなりうる分を足した）、画面の依頼0.15 USD（3つのmessage。3番目で画面を書く場合がある。段階1の2ターンの試行は0.033 USD）、probe 0.15 USD（段階1の水準Wのprobeは0.121 USD）。112＋24試行＋probe 2回で約17.3 USD。
  - #1817の平均どおりなら約12.2 USD（ownerの見込み約15 USD）。
  - 線までに使える1試行の平均は約0.156 USD（dry runの`breakEvenPerTrialUsd`）。これを超えると、最後の試行が起動せず`cap-reached`で判定する。

## 台帳の取り替え（2026-11-26）

- 測定の前の独立レビューの後、隔離の確認（probe）をB・S各1回走らせたところ、2回とも、測定に使うアカウントの週の利用上限に当たり、モデルが動かなかった（HTTP 429、費用0 USD）。回2の再実行も、トークンが上限の側のままで同じだった。そのため、固定した規則（probeは条件ごとに回1と、不合格のときの回2だけ）では、旧台帳`ledger-1820-s2.jsonl`にはもうprobeを足せない。
- 旧台帳には、probeの予約と精算が4件（B・Sの回1・回2、費用0 USD）あり、本番の試行の予約は0件だった。
- トークンを、上限が戻っているアカウントのものに置き換えたあと、新しい台帳`ledger-1820-s2b.jsonl`（台帳id `d5d56260-f3f9-4a68-ba7a-69cd30b76b37`）で固定の最初の記録を作り直した。固定したfileは変えていない。段階1・#1817と同じ作り直しで、旧台帳が空だった場合と同じく、本番の試行の記録が無いときだけ許される。
- 旧台帳と旧probeの記録は、scratchに残している（応答が無かったことの記録）。測定の記録は、新しい台帳と新しいruns rootだけを使う。
- 測定の途中で、アカウントが変わった。段階1（2026-11-26 朝）と、この段階2の測定とで、使うトークンのアカウントが違う可能性がある。同じモデル（`claude-sonnet-5-5`）と同じ設定で走らせるが、アカウント差は統制していない。

## 実行の手順

統括が行う。`<scratch>`は一時directory、`<repo-root>`はこのrepositoryのcheckoutを指す。harnessはsandboxの外のshellで実行する。台帳を手で編集しない。

```text
EV=docs/evidence/1820-write-tools-read/stage2
LEDGER=<scratch>/rel1820/ledger/ledger-1820-s2b.jsonl
TGZ_B=<scratch>/rel1820/release/agent-skill-chain-0.5.111.tgz
TGZ_S=<scratch>/rel1820/candidate/agent-skill-chain-0.5.111.tgz
FX=<scratch>/run1820s2m/fixtures
mkdir -p <scratch>/run1820s2m/tmp
# 1. fixture：条件×フォルダの8つ（固定したsha256だけを受け付ける）
for C in B S; do for F in A D3 D4 D7; do
  TGZ=$([ $C = B ] && echo $TGZ_B || echo $TGZ_S); SHA=$([ $C = B ] && echo e7df164a8c132d4d77db270cd8c3fe7ed196906484b0f51d52b4de57125d3be0 || echo c51f17ecc6e62e4fa5ccf2b9da1ab5e57ea6f41da43880bb765cad8a8603775f)
  mkdir -p <scratch>/run1820s2m/tmp/$C-$F
  node $EV/harness/make-fixture.mjs $C $F $TGZ $SHA $FX/fixture-$C-$F <scratch>/run1820s2m/tmp/$C-$F
done; done
# 2. 隔離の確認（B・S各1回、fixture A、水準W）。目印fileは確認の後に消す
node $EV/harness/markers.mjs create <repo-root>
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1820S2_ALLOW_PAID=1 node $EV/harness/run-trial.mjs <scratch>/run1820s2m/runs B probe 1 --fixture $FX/fixture-B-A --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run
node $EV/harness/probe-check.mjs <scratch>/run1820s2m/runs/B-probe-1 B <home marker> <repo marker> <repo-root> > <scratch>/run1820s2m/probe-B.json
#   （Sも同じ：... S probe 1 --fixture $FX/fixture-S-A ...。不合格の条件だけ回2を1回実行できる）
node $EV/harness/probe-check.mjs compare <scratch>/run1820s2m/probe-B.json <scratch>/run1820s2m/probe-S.json --out <scratch>/run1820s2m/runs/probe-compare.json
node $EV/harness/probe-check.mjs publish $EV/results/probes <scratch>/run1820s2m/probe-*.json <scratch>/run1820s2m/runs/probe-compare.json --home-marker <home marker> --repo-marker <repo marker> --repo-root <repo-root> --runs-root <scratch>/run1820s2m/runs
node $EV/harness/markers.mjs remove <repo-root>
# 3. 測定：固定した順の136試行（止まった場合は同じcommandで次の試行から続く）、その後に必須の置き換え
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1820S2_ALLOW_PAID=1 node $EV/harness/run-all.mjs planned <scratch>/run1820s2m/runs --fixtures $FX --ledger $LEDGER --run
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1820S2_ALLOW_PAID=1 node $EV/harness/run-all.mjs replacements <scratch>/run1820s2m/runs --fixtures $FX --ledger $LEDGER --run
# 4. 固定の照合、取り出し、判定
node $EV/harness/fixation.mjs check $EV/results/fixation.json
node $EV/harness/collect.mjs <scratch>/run1820s2m/runs $EV/results/traces --ledger $LEDGER --publish-ledger $EV/results/ledger.jsonl
node $EV/harness/judge.mjs $EV/results/traces --runs-root <scratch>/run1820s2m/runs --ledger $LEDGER --runs-json $EV/results/runs.json --out $EV/results/judge.json
```

- 計画した試行の前に、`run-trial.mjs`は`probe-compare.json`の記録を信用せず、各probeをruns rootの`trace.jsonl`と`meta.json`から計算し直して照合する（段階1と同じ）。
- `--run`を付けない`run-trial.mjs`・`run-all.mjs`は、起動するcommandや試行の一覧を出すだけでモデルを呼ばない。
- 途中で止まった試行からの再開は#1817の[README](../../1817-skill-application/README.md)「途中で止まった試行からの再開」と同じ。

## 測定の前の固定

- 最初の記録のcommit：`results/fixation.json`の最初の記録のcommitは`682123b110c9f41865cda45e83583beec8121abc`である（固定したfileは`db3078ed`の時点と同じ。下の「台帳の取り替え」）。`run-trial.mjs`と`judge.mjs`はこの記載を照合する。`fixation.mjs check`は合格（差なし）。
- 作り直した理由（1回目）：独立レビューの指摘（M1：Skill一覧の予算をBとSで比べていない）を是正し、固定したfile（`decision-criteria.md`・`harness/probe-check.mjs`）が変わったため、台帳に予約が無い（0件、台帳idの1行だけ）ことを確かめたうえで、記録を新しい最初の記録として作り直した（同じ台帳、段階1と同じ手順）。同じレビューのL1（段階1の試験）・L3（重複した試験）・L2・L4（限界の記録）は、固定したfileを変えていない。
- 前の記録（`bfefb93e`）はgitの履歴に残る。
- 固定したfile：`decision-criteria.md`・`cases.json`・`conditions.json`・`release.json`・`run-order.json`と、`harness/`の15件（`dry-run.mjs`と試験を除く）。
- 台帳：repositoryの外の新しい台帳`<scratch>/rel1820/ledger/ledger-1820-s2b.jsonl`（予約0件）。段階1の台帳とは別で、段階1の費用は`conditions.json`の`budget`で数える。台帳idは`results/fixation.json`にあり、`run-trial.mjs`と`judge.mjs`はこの台帳だけを使う。

## モデルを呼ばない確認

HEAD `db3078ed`（作り直した最初の記録と同じ。`fixation.mjs check`は差なし）で行った。

| 項目 | 結果 | 記録 |
| --- | --- | --- |
| harnessの試験（合成の記録） | 20件すべて合格。写したfile（`guard`・`ledger`・`install-asc`・`condition-i`は#1817と）がbyteで同じこと、`probe-check`は段階1からSkill一覧の予算の追加だけが違うことも試験で照合した。予算の試験は合成のdebug log（Sだけ超過→`compare`と照合が不合格、両方が同じ状態で超過→合格、記録の書換え→照合で検出、ASCのdescriptionが1件欠ける→不合格）。`npx eslint`（harness）は指摘なし。段階1の試験（Xを外した後）29件、#1817の試験68件も合格 | [results/harness-tests.txt](results/harness-tests.txt) |
| 製品の変更の試験 | `test/test_project_read_trigger.mjs`・`test/test_source_quality.mjs` 16件合格（重複を除いて1件減）、`npx eslint src bin test v05`は指摘なし。`test/test_project_assets.mjs`・`test/test_package.mjs`の7件は、是正の前のcommit `70e93ae0`と候補の変更の無い基のcommit `7606d740`でも同じく失敗する（この環境のGit操作とnpmの出力による）。CIで確かめる | [results/harness-tests.txt](results/harness-tests.txt) |
| dry run（本物の2つのtarball、`--allow-unreleased`なし、記録した台帳。fixtureは新しい`<scratch>/run1820s2b/`） | 全16項目が合格（下の箇条。`probeDebugLog`を加えた） | [results/dry-run.json](results/dry-run.json) |

dry runの内容：

- 8つのfixture（B・S×A・D3・D4・D7）を、Bはrelease（`e7df164a…`）、Sはcandidate（`c51f17ec…`）から利用者の手順で導入し、16件の入口が記録とpackageに一致し、`claude-md`を採用した。Aは基の`CLAUDE.md`への追記（`append`）、D3・D4・D7は案内文だけの`CLAUDE.md`の作成（`create`）。Bの塊のsha256は`444b31b5…`（段階1・#1814の条件Iと同じ）、Sは`9a1de39f…`。
- BとSの比較（4つのフォルダのすべてで）：
  - `CLAUDE.md`の塊は最初の文だけが違い、その後の186文字と、塊の外（基の`CLAUDE.md`と区切りの行）はbyteで同じ（`readTriggerFirstSentenceOnly`）。
  - `.claude/skills/asc/SKILL.md`のdescriptionはBが旧、Sが新の文面で、入口の他の部分と他の15件の入口はbyteで同じ（`ascDescriptionAsIntended`）。
  - 導入後のfileで違うのは7件：`CLAUDE.md`、`.claude/skills/asc/SKILL.md`、`.agent-skill-chain/distribution.json`、`.agent-skill-chain/skills/asc/SKILL.md`・`.agent-skill-chain/v05/USAGE.md`とそれぞれの`managed-runtime/`の写し（`installedDiffExpected`）。
- 試行の写しに中立のcommitを入れた後、commitの件名は8つで同じ（`Update project files`・`Install ASC`・`initial`）。
- 計画：probe 2回と136試行（fixture Aの該当する依頼88、画面の依頼24、該当しない依頼24。各条件68）。計画の単価で17.34 USD、平均の見込みで12.16 USD。段階1の費用2.0281387 USDを台帳から照合し、段階2の線21.97 USD、2段階の合計は最大23.998 USD（`stage1Spend`・`budgetBothStages`）。
- 全138件の起動のcommand（引数と依頼文）を出した。どれも水準Wの`--tools`・`--disallowedTools`・`--permission-mode acceptEdits`・`--settings`・`--max-budget-usd 0.6`で、`--max-turns`はfixture Aの試行に無く、画面の依頼は3、probeは30（`levelFlags`・`maxTurns`）。probeの操作は6（`probeStepsCounted`）。
- 隔離の`--settings`の例を、fixture Aの試行（`B-asc-1-1`）と画面の依頼の試行（`B-d-ui03-1`）で記録した。どちらも試行のfixtureを読込み・書込みの禁止に入れる（`fixtureDenied`）。
- probe（B・S）の起動にだけ`--debug-file debug.log`がある（`probeDebugLog`、独立レビューM1）。
- 前のdry run（`<scratch>/run1820s2/`、HEAD `bfefb93e`）では、`run-trial.mjs`を`--run`なしで実行すると計画だけを出し、`--run`は許可の環境変数が無いと拒否した。`--max-turns`の指定、Bの条件へのSのtarballも拒否した。`run-trial.mjs`はその後変わっていない（固定の記録のsha256が同じ）ため、今回のdry runでは繰り返していない。台帳は1行（台帳idだけ）のまま。

## 段階1のharnessからの変更

[harness/](harness/)は段階1の[harness](../harness/)の写しで、段階1・#1814・#1815・#1817の固定したfileは変えていない。`guard`・`ledger`・`install-asc`・`condition-i`は#1817とbyteで同じ（試験で照合）。変更は各fileの先頭に注記した。主なもの：

- `probe-check.mjs`：段階1とbyteで同じだったが、独立レビューM1でSkill一覧の予算の項目（上の「隔離の確認とSkill一覧の予算」）を加えた。段階1の行は、`compare`の結果の行と`FACT_KEYS`の2行のほかは変えていない（試験で照合）。

- 条件：B・Sの2つ（どちらも水準W）。セルは条件で、試行のフォルダは依頼で決まる（`cases.json`の`fixture`）。水準の削除（`drop-level`）は除いた。
- `make-fixture.mjs`：fixtureを条件×フォルダ（A・D3・D4・D7）で作る。tarballは条件ごとに`release.json`で固定したsha256だけを受け付ける（Bはrelease、Sはcandidate）。
- `run-trial.mjs`：`--max-turns`は依頼のフォルダの種類で決める（Aはなし、画面の依頼は3、probeは30）。段階1の台帳のsha256と累計を照合し、段階2の停止の線で止める。許可の環境変数は`ASC1820S2_ALLOW_PAID`。install記録の条件・フォルダ・出所を照合する。
- `score.mjs`：#1817の全試行の採点に、画面の依頼の規則（打切り後の結果の無いReadを数える、適用はascの本文とreference、目印なし）と、段階1のinitの照合を加えた。判定は`judge1820s2`（ownerの基準）。
- `order.mjs`：#1817の順序（回×依頼×条件）と置き換え・完了の規則に、段階1のprobeの照合を加えた。同じ種類の画面の依頼が隣り合う順序を拒否する。
- `judge.mjs`：段階1の`analyze.mjs`の照合をそのまま行い、ownerの基準で判定する。
- `collect.mjs`：行に条件・依頼の種類・フォルダ・導入の出所を記録する。一時directoryの利用者番号（`claude-<番号>`）を`<tmp-user>`に置き換える（段階1は分析の後に手で置き換えた）。
- `markers.mjs`：#1820の承認は段階1の記録（[../results/probe-approval.json](../results/probe-approval.json)）を使う。目印fileの名前は段階1と同じ。
- `dry-run.mjs`：8つのfixtureを作り、BとSの違いを確かめる（下の「モデルを呼ばない確認」）。

## 限界

- 各依頼4回。数試行の差は偶然の範囲を出ない。
- 画面の依頼は最初の3つのmessageだけを見る。4番目以降のreferenceの読込みや、画面の出来は見ない。fixture Aの依頼は全体を見る（#1817）ので、2つの種類で観測の長さが違う。全体の率はこの2つを合わせたものである。
- 3回目の独立レビュー（HEAD `99154333`）の軽い指摘2件は、固定したfileの変更と再レビューが要るので直さずに測定する。
  - Low-1：(b)の「探す操作」の検出は、tool入力にSkillのfileの名前があるかだけで行う。作業directoryへの`Grep`（patternが`description`等）で16件のdescriptionが出る場合は検出されない。probeの依頼文が指定外のtoolを禁じ、traceにも残るので、起きる見込みは低い。
  - Low-2：`debug.log`のsha256は台帳の精算に含めない。このため、(a)を`debug.log`から計算し直しても、probeの後の書換えは検出できない（削除は`skillListingRecorded`で不合格になる）。統括が測定の記録を手で書き換えないことが前提である。
  - 測定の後に、probeの`trace.jsonl`に作業directoryへの`Grep`が無いことと、公開した`results/probes/`の`debug.log`由来の値が測定の時点の記録と合うことを確かめ、結果に書く。
- 画面の依頼の「適用」は、referenceまで読んだことだけで、referenceの規則に従ったか（作業場所の決定等）は見ない。Bashが無く、`start`等のcommandは実行できない。
- 「ASC本文の読込み」は、#1817と同じく期待するSkillの本文（目的別の依頼では目的別Skill）で数える。`asc`だけの値は依頼ごとの記号で示す。
- descriptionを13文字長くした。Skill一覧の予算は、probeの時点のBとSの状態が同じことだけを確かめる（上の(a)(b)）。測定の各試行のdebug logは取らない。両方が超過した場合に、省かれた同梱Skillが同じかは確かめられない。
- 候補の文面は、`v05/USAGE.md`の同じ節の「#1814の測定では…この文例を置いた状態で」の記述（旧の文面での測定、独立レビューL2）を変えていない。Sを採用する場合はこの記述を新しい文面とこの測定に合わせて書き直し、採用しない場合は文例とdescriptionの変更（commit `2afea59c`・`bbf55465`）を元に戻す。
- 新しいdescriptionの「修正」は、`review-and-remediation`のdescriptionの「レビュー指摘を是正・再検証する」と重なる（独立レビューL4）。「レビューの指摘を直して」の依頼は`asc`と`review-and-remediation`のどちらにも読めるが、17依頼にこの依頼は無い。画面の依頼のフォルダ（fixture D）には該当しない依頼（変更を伴わない依頼）も無く、Sの案内文が変更を伴わない依頼で余計な読込みを増やすかは、fixture Aの該当しない依頼3件だけで見る。
- 段階1と同じく、水準Wには#1815にあったbrowser MCPとその注意書きが無い。probeはfixture Aだけで行い、画面の依頼のフォルダの隔離は同じ設定の作り方による（dry runの`fixtureDenied`）。

## 結果（2026-11-26）

### 実行

- 隔離の確認（probe）：B・Sとも回1で合格した。比較でも差は無かった（Skill一覧の予算の超過は両方で無し、ASCの16件のdescriptionは両方でContextにあった）。費用は約0.22 USD。目印fileは確認の後に削除した。なお、旧台帳での最初の隔離の確認は、測定に使うアカウントの週の利用上限（HTTP 429）で2回とも応答が無く、台帳を取り替えて固定を作り直した（上の「台帳の取り替え」）。
- 測定：固定した順の136試行がすべて完了した。失敗は0件、置き換えは0件。画面の依頼のフォルダの24試行は、設計どおり最初の3ターンで止めた（`error_max_turns`）。
- 費用：新しい台帳の累計は13.32 USD（probe 0.22 USDを含む）。段階1の2.03 USDとあわせて約15.4 USDで、全体の上限25 USDの内。
- 判定は`judge.mjs`で行った。固定（最初の記録のcommit `682123b1`）・台帳・試行ごとの記録・取り出した実行の記録（手元）の作り直しの照合をすべて通過した。完了の根拠は`complete`。記録：[results/judge.json](results/judge.json)、[results/runs.json](results/runs.json)、[results/ledger.jsonl](results/ledger.jsonl)、[results/probes/](results/probes/)。実行の記録（`traces/`）は加えていない（下の「公開した記録について」）。

### 判定（ownerの基準、14の該当する依頼×4回＝56試行／条件）

| 条件 | 本文の読込み | 手順の適用 | 該当しない依頼での過剰な読込み |
| --- | --- | --- | --- |
| B（現状、v0.5.111） | 44/56 | 40/56 | 0/12 |
| S（案内文とascの説明を修正） | **56/56** | **45/56** | 0/12 |

- ownerの基準の3つ（本文の読込みが8割以上で現状より多い、手順の適用が現状以上、過剰な読込みが現状＋1回以内）を、すべて満たした。**判定：採用の候補**。採否はownerが決める。
- 本文の読込みは、期待するSkillの本文で数える（ownerの承認、2026-11-26）。

### 内訳（判定には使わない）

| フォルダ | 条件 | 本文の読込み | 手順の適用 |
| --- | --- | --- | --- |
| A（アプリのrepo、該当する11依頼×4回） | B | 44/44 | 40/44 |
| | S | 44/44 | 41/44 |
| D（画面の依頼のフォルダ、3つ×4回） | B | **0/12** | 0/12 |
| | S | **12/12** | 4/12 |

- **効いたのはDだった。** 画面の依頼のフォルダでは、Bは12試行すべてでASCの本文を読まなかった。Sは12試行すべてで読んだ。段階1で見つけた原因（フォルダの違い）に、案内文の最初の文を直すことが効いた。
- Aでは、Bも本文を44/44で読んでいたので、差は出ない（手順の適用は40/44と41/44で、偶然の範囲）。
- Dの手順の適用（本文に加えて`implementation.md`か`workspace.md`を最初の3ターンで読む）は、Sで4/12。本文は読むが、referenceまで読むのは3分の1だった。最初の3ターンで止めているので、それ以降に読んだ分は数えていない。
- Bで画面の依頼のフォルダの9試行は、ASCの本文を読む前に書込み（`Write`）に進んだ。Sでは0試行だった。
- 入口の経路が変わった。Bは入口のSkill（Skillのtool）を24回通って本文へ進み、Sは入口を7回しか通らず、案内文のpathから本文を直接読んだ（56/56）。

### ownerの判断（2026-11-26）

ownerが改善版Sを採用すると決めた（[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1820#issuecomment-7185835235)）。採用したのは、`v05/USAGE.md`の文例の最初の文と、`skills/asc/SKILL.md`のdescriptionの変更である。測ったSと同じ内容で、`v05/USAGE.md`の説明の段落（#1814の測定への言及）だけを、この測定に合わせて書き直した。文例の塊の文面は変えていない。

### トークンと時間（ASCの原則1）

試行ごとの入力トークン（入力＋cache書込み＋cache読出し）と所要時間。

| 依頼 | 条件 | 入力トークン／試行 | 出力 | 秒 | USD |
| --- | --- | --- | --- | --- | --- |
| 該当しない依頼（12） | B | 13,509 | 451 | 4.3 | 0.029 |
| | S | 13,620 | 456 | 4.1 | 0.029 |
| アプリのrepoの依頼（44） | B | 81,418 | 2,947 | 23.9 | 0.100 |
| | S | 94,017（+15%） | 3,159（+7%） | 25.5（+7%） | 0.108（+8%） |
| 画面の依頼のフォルダ（12、最初の3ターン） | B | 33,850 | 6,665 | 41.3 | 0.104 |
| | S | 59,870（+77%） | 7,363（+10%） | 46.5（+13%） | 0.168（+62%） |

- 画面の依頼のフォルダの増加は、ASCを読む費用で、本文の読込みが0/12から12/12になったことと対応する。Bはこの3ターンの間に画面をほぼ書き終えており、Sは読むために使うので、**画面を作り終えるまでの全体の費用は測っていない**。
- アプリのrepoの依頼の増加（+12.6k、標準誤差の約1.6倍、11の依頼のうち9で増える向き）は、本文・目的別Skillの読込み回数がほぼ同じ（asc本文0.27回、目的別本文0.77回と0.75回）で、referenceが1試行あたり0.80回と0.89回の差では説明できない。**原因は未解明**で、品質（手順の適用40/44と41/44）への寄与も確認できていない。未解決の項目として残す。
- 測定の外のトークン（測定の仕組みの作成、独立レビュー、結果の整理）は、台帳に入らない。この作業では大きく、原則1の観点で見直す対象にした。

### 公開した記録について

- 実行の記録（`traces/`、136試行、約9.9MB）は、リポジトリに加えていない。理由は大きさである（このPRの追加の約半分で、結論は採点・判定・台帳に残る）。統括の手元（scratch）に残している。#1817までの方式（公開した記録からの作り直しの照合）は、この段階2では行えない。判定は、記録を集めた時点（`collect.mjs`・`judge.mjs`、実行の記録がある状態）で行い、完全性・固定・台帳の照合を通過している。
- 公開しているのは、試行ごとの採点（[results/runs.json](results/runs.json)）、判定（[results/judge.json](results/judge.json)）、台帳（[results/ledger.jsonl](results/ledger.jsonl)。精算の行に、実行の記録のsha256が残る）、probe（[results/probes/](results/probes/)）である。
- 後続の置換えの記述（下の「取り出した実行の記録（手元）の置換え」）にある`results/traces`のsha256は、加えなかった実行の記録の集合の識別子として残した。

### 取り出した実行の記録（手元）の置換え

- 取り出しの時点で、一時directoryの名前は自動で伏せた。2つのfile（`S-se-1-2`・`B-se-1-4`）に、この作業を統括したsessionのidが残っていたので、`<session>`に置き換えた（#1814と同じ扱い）。
- `results/traces`のsha256（全fileをpath順に連結したもの）は、置換えの前が`9c2b02d7c664bf31b2d92161ffd44de7f2a8bfac4da24756190ac521ca3b77c7`、後が`6bd6d7568950982b850ae586048917a88398e3af34d65700051288b31c3e1079`。この集合は公開していないので、第三者が`judge.mjs`を実行し直すことはできない。手元の記録は、置換えの前後とも統括が保管している。

### 測定の後の確認（READMEの限界で約束した2点）

- probeの`trace.jsonl`に、作業directoryへの`Grep`・`Glob`は無かった。あったのは、目印のpathを読もうとした意図した操作だけだった（B・Sとも`Glob`1回・`Grep`1回）。**この確認は、手元のprobeの`trace.jsonl`で行った。公開した`results/probes/`にはtoolの入力が無いので、公開した記録からは確かめられない。**
- 公開した`results/probes/`は、測定の時点の記録を伏せた写しである。

### 限界

- 新しいdescriptionと文例の「fileの作成など変更を伴う依頼」には「開発の」という限定が無い。ASCを入れたrepoで、開発でないfileの作成（メモ・まとめ等）の依頼でも、ASCの本文が読まれうる。該当しない依頼の測定は、アプリのrepoの3つ（翻訳・質問等）だけで、この種類の依頼は測っていない。測った文面を変えると採用の根拠が崩れるので、文面は変えず、限界として記録する。
- 各依頼4回で、Aの差（手順の適用40/44と41/44）は偶然の範囲である。
- 画面の依頼のフォルダはui03・ui04・ui07の3つで、どれも新しい画面を作る依頼。変更を伴わない依頼や、レビュー指摘の是正（新しいdescriptionの「修正」と重なる）は、この環境では測っていない。
- 最初の3ターンで止めているので、Dで本文を読んだあとに作業の中身が変わったか、referenceに従ったかは分からない。
- モデルは`claude-sonnet-5-5`だけ。Claude Code以外のHostは測っていない。
- 段階1と段階2とで、使ったトークンのアカウントが違う可能性がある。
- Skill一覧の予算は、probeの時点のBとSで同じ状態（超過なし）だったことだけを確かめた。測定の各試行のdebug logは取っていない。
