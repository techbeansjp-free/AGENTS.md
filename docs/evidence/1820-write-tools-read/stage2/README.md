# 書込みのtoolとASCの読込み：段階2（#1820）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

**結果：未測定**（測定の前の準備の記録）。

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

   長さは51文字から64文字（＋13文字）。`v05/USAGE.md`のSkill一覧の予算（200k Contextで8,000文字）の注意に対して、ASCの16件の説明文の合計の増分は13文字である。予算の超過は測っていない（限界）。

- 候補のtarball（`agent-skill-chain-0.5.111.tgz`、sha256 `c51f17ec…`）をv0.5.111のrelease asset（sha256 `e7df164a…`）と展開して比べ、違うfileは`package/release-identity.json`・`package/skills/asc/SKILL.md`・`package/v05/USAGE.md`の3件だけだった。`release-identity.json`の違いは、その2件のsha256だけである。案内文とdescriptionは導入時に`v05/USAGE.md`と`skills/asc/SKILL.md`から読まれるため、他のsourceやdataに文面の写しは無い。
- 製品の変更に合わせて、`test/test_project_read_trigger.mjs`に、新しい文面（変更を伴う依頼・fileを探す前・除外の文の維持）と、登録した入口`.claude/skills/asc/SKILL.md`のdescriptionが同梱の`skills/asc/SKILL.md`と同じになることの試験を加えた。

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
  - 線までに使える1試行の平均は約0.155 USD。これを超えると、最後の試行が起動せず`cap-reached`で判定する。

## 実行の手順

統括が行う。`<scratch>`は一時directory、`<repo-root>`はこのrepositoryのcheckoutを指す。harnessはsandboxの外のshellで実行する。台帳を手で編集しない。

```text
EV=docs/evidence/1820-write-tools-read/stage2
LEDGER=<scratch>/rel1820/ledger/ledger-1820-s2.jsonl
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

- 最初の記録のcommit：（固定の後に記入）
- 固定したfile：`decision-criteria.md`・`cases.json`・`conditions.json`・`release.json`・`run-order.json`と、`harness/`の15件（`dry-run.mjs`と試験を除く）。
- 台帳：repositoryの外の新しい台帳`<scratch>/rel1820/ledger/ledger-1820-s2.jsonl`（予約0件）。段階1の台帳とは別で、段階1の費用は`conditions.json`の`budget`で数える。台帳idは`results/fixation.json`にあり、`run-trial.mjs`と`judge.mjs`はこの台帳だけを使う。

## モデルを呼ばない確認

（固定の後に記入）

## 段階1のharnessからの変更

[harness/](harness/)は段階1の[harness](../harness/)の写しで、段階1・#1814・#1815・#1817のfileは変えていない。`guard`・`ledger`・`install-asc`・`condition-i`は#1817と、`probe-check`は段階1とbyteで同じ（試験で照合）。変更は各fileの先頭に注記した。主なもの：

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
- 画面の依頼の「適用」は、referenceまで読んだことだけで、referenceの規則に従ったか（作業場所の決定等）は見ない。Bashが無く、`start`等のcommandは実行できない。
- 「ASC本文の読込み」は、#1817と同じく期待するSkillの本文（目的別の依頼では目的別Skill）で数える。`asc`だけの値は依頼ごとの記号で示す。
- descriptionを13文字長くした。Skill一覧の予算の超過（`v05/USAGE.md`の注意）は、この測定の設定（ASCの16件と同梱のSkill）では確かめていない。
- 候補の文面は、`v05/USAGE.md`の同じ節の「#1814の測定では…この文例を置いた状態で」の記述（旧の文面での測定）を変えていない。採用する場合は記述を合わせて直す。
- 段階1と同じく、水準Wには#1815にあったbrowser MCPとその注意書きが無い。probeはfixture Aだけで行い、画面の依頼のフォルダの隔離は同じ設定の作り方による（dry runの`fixtureDenied`）。

## 結果

未測定。
