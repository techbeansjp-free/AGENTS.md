# Skill本文の改善案の測定の準備（#1817）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 目的

#1814の段階3（条件I）では、Skillの本文は22/22で読まれたが、手順の適用（本文・必要なreference・回答の目印のすべて）は16/22だった。#1817の調査（[Issue](https://github.com/techbeansjp-free/AGENTS.md/issues/1817)）で、不適用の多くは回答の目印の表記の揺れで、Skill本文の書き方で直せる候補は2つ（`asc-3`で作業場所の手順を読まない、`es-1`で調査が必要な作業を明示しない）と分かった。commit `4c95f8d4`でこの2か所を`skills/asc/SKILL.md`と`skills/estimate-and-scope/SKILL.md`に書いた。その後、独立レビューの指摘を受けて`asc`の文を2回直した。commit `ee77daa0`で、変更を伴う依頼だけに絞った。commit `6d6e1223`で、除外を作業場所の決定だけに掛かる形にした（「調査・レビュー・見積だけの依頼では作業場所を作らない」）。ここでは、その改善案（S）を現状（B）と同じ隔離環境で比べる準備をする。**モデルはまだ呼んでいない。**

## ownerの判断（2026-11-25、[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1817#issuecomment-7159921981)）

- Skill本文の改善案2つを、隔離環境で測る。
- 回答の目印を、表記の揺れを許す形に見直して固定する。比べる相手（現状）も同じ規則で新しく測る。
- 14依頼×各4回×2条件、費用の上限15 USD。
- 改善後が現状を上回れば採用の候補とし、採否はownerが決める。

## 条件と導入するtarball

| 条件 | 導入するもの | sha256 |
| --- | --- | --- |
| B（現状） | release v0.5.109（target commit `af2ab12e`）。draft・prereleaseではない。SHA256SUMSとreleaseのassetのdigestの両方と一致 | `05901c4b…`（[release.json](release.json)） |
| S（改善案） | commit `6d6e1223`で`node scripts/pack-candidate.mjs <scratch>/rel1817/candidate3 --version=0.5.109`により作った候補。前の候補（`4c95f8d4`の`f8c3eae7…`、`ee77daa0`の`3a016473…`）は文の修正で置き換え、測定には使わない | `7e48d5cf…`（同上） |

- どちらも#1814の条件Iと同じ手順で作る：合成のsample project（同じfile・同じ基の`CLAUDE.md`）に、USAGEの利用者の手順（`npm install`したpackageの`project-assets --register-claude-skill`の計画→`--apply`）で導入し、計画が示す読む契機の選択肢`claude-md`を`--adopt-read-trigger`で承認して`CLAUDE.md`へ追記する。その後、中立のcommitを1件入れる。
- 2つのtarballを展開して比べると、違うのは`package/release-identity.json`（2つの本文のsha256だけ）、`package/skills/asc/SKILL.md`、`package/skills/estimate-and-scope/SKILL.md`の3つだけ。2つの本文は、Bが`af2ab12e`、Sが`6d6e1223`のfileとbyteで同じ（2026-11-25に確認）。
- 対応の強制：`make-fixture.mjs`は、条件ごとに[release.json](release.json)が固定したsha256のtarballしか受け付けない（Bはreleaseだけ、Sは候補だけ）。導入の記録に条件・出所（`release`/`candidate`）・`pinned`を残し、`run-trial.mjs`は条件と記録の組合せが違う、固定したsha256と違う、`--allow-unreleased`で作った（`pinned: false`）sample projectを拒否する。有料の試行で、固定していない候補を導入する経路は無い。

## 回答の目印の見直し

#1814の結果を見た後で、ownerの判断（2026-11-25）により見直した。結果を見た後の変更なので、B（現状）も同じ規則で新しく測り、#1814の数値とは直接比べない。依頼・期待するSkill・referenceは#1814と同じ（[cases.json](cases.json)。各依頼の`relaxed`に元の値と理由）。

| 依頼 | #1814 | #1817 | 理由 |
| --- | --- | --- | --- |
| `ri-1` | `受入条件`（完全一致）と`未決` | `受入\|受け入れ`と`未決` | 7試行が`decisions.md`の形どおり決定ごとに「受入:」と書き、`受入条件`の完全一致で落ちた。「受入」は手順の受入の項目そのもの |
| `asc-2` | `start\|未commit\|未保存`のどれか | 加えて`未コミット` | 3試行が「未コミット」（カタカナ）と書いた。意味は同じ |
| `ui-1` | 空の状態：`0件\|空の?状態\|empty\|該当なし` | 加えて`空にな\|空の(とき\|場合)` | 「一覧が空になる」「空のときの案内」と空の状態を確認していた。`空白`・`空き`は一致しない |
| `es-1` | 前提：`前提\|仮定` | 加えて`仮置き` | 「仮置き」はestimate-and-scopeの本文の語。**`調査`の組は変えない**：調査が必要な作業を分けることは改善案Sが狙う手順なので、`確認が必要`等では代えない |

確認（モデルを呼ばない）：[harness/rescore-1814.mjs](harness/rescore-1814.mjs)で、公開した#1814のtraceをこのharnessで採点し直した（[results/rescore-1814.json](results/rescore-1814.json)）。#1814の`cases.json`では公開した数値と同じ（R 15/22、P 19/22、H 15/22、I 16/22）。#1817の`cases.json`では、手順の適用がR 18/22、P 22/22、H 19/22、**I 18/22**（本文の読込みと過剰な読込みは変わらない）。Iで残る4試行は`asc-3`（referenceを読まない、2）と`es-1`（`調査`が無い、2）で、どちらも改善案が狙う依頼である。Issueの調査で「中身で数え直すと20/22」としたのとの差は`es-1`の2試行で、上のとおり`調査`の組を意図して緩めていないため。

## 判定の規則

[decision-criteria.md](decision-criteria.md)（モデル実行の前に固定）。該当する11依頼×4回＝各44試行で、Sが次の3つをすべて満たせば「採用の候補」とする。

- 手順の適用がBより多い（ownerの判断）。
- 本文の読込みがBの−1以上（2026-11-25 ownerが承認）。
- 該当しない依頼での過剰な読込みがBの＋1以下（2026-11-25 ownerが承認）。

2つ目と3つ目は、作業者が#1814の水準とIssueの「してはいけないこと」から導いた案で、ownerが会話で承認した（統括が記録）。次の場合は判定しない。

- 測定が完了しておらず、費用の上限にも達していない。結果を見た後の打切りを含む（規則7）。判定してよいのは次の2つの場合だけで、どちらに当たったかを判定の出力の`basis`に記録する。
  - `complete`：計画の112試行と必要な置き換えがすべて台帳に予約された。
  - `cap-reached`：台帳の累計＋0.6 USDが14 USDを超えて止まった。最初の計画した試行より後に予約されたprobeがあれば、これを認めない。また`cap-reached`でも、必須の置き換えが欠けていれば判定しない。置き換えは計画した試行の後に行うので、実際には上限までに失敗が1件も無い場合だけ判定できる。
- 該当しない依頼の有効な試行が0件。
- 有効な試行の無い依頼がある。
- 必須の置き換えが欠けている。
- 失敗が10%を超える。

`asc-3`と`es-1`は依頼ごとに別に示す。各依頼4回では小さな差は偶然の範囲を出ず、採否はownerが決める。

失敗した計画の試行は、失敗の数だけ次の番号（5、6、…）で1回ずつ必ず置き換える。置き換えの失敗はもう置き換えない。計画の後に`run-trial.mjs`が受け付けるのは、置き換えの計画の次の試行だけである。隔離の確認は#1814と同じ。probeは計画した試行の予約の前だけで、各条件1回と、失敗・不合格の場合の再実行1回（回2）だけを`run-trial.mjs`が受け付ける。

実行の順序は[run-order.json](run-order.json)で固定した。回を外側にし、各回の中は14依頼を決まった順（該当しない依頼を間に挟む）で、各依頼の中はB、Sの順。

## 測定の前の固定

- 最初の記録のcommit：`results/fixation.json`の最初の記録のcommitは`8ae7b145c18801a188583286256e2a3651b443c6`である。`run-trial.mjs`と`judge.mjs`はこの記載を照合する。
- 作り直した理由：レビューの是正で固定したfileが変わったため、記録を新しい最初の記録として作り直した。前の6つの記録はgitの履歴に残る。
  - commit `5bbd96f2`を固定し、`89d90c46`でcommitしたもの。
  - commit `992c98b6`を固定し、`e5293fae`でcommitしたもの。
  - commit `6131acb1`を固定し、`196110f3`でcommitしたもの。
  - commit `31cc0e90`を固定し、`aec1e065`でcommitしたもの。
  - commit `6c68ea58`を固定し、`576a00bd`でcommitしたもの。
  - commit `f1cdb02b`を固定し、`b2ba91d7`でcommitしたもの。
- 追記（`refix`）にしなかった理由：`fixation.mjs`のrefixは、台帳にprobeの予約があり、変わったのが`probe-check.mjs`だけの場合に限る。今回はどちらも満たさない。`stage3`は#1817では拒否する。
- 作り直してよい状態だった：作り直す前に、台帳が見出しの1行だけ（予約0件、lockのfileなし）であることを確かめた。測定は始まっていない。
- 記録の段階名：`stages 0-2`は#1814の写しのままで、#1817の測定全体を指す。
- 固定したfile：`cases.json`・`conditions.json`・`decision-criteria.md`・`release.json`・`run-order.json`と、起動・採点・順序・判定に関わる`harness/`の15件。
- 台帳：repositoryの外の`<scratch>/rel1817/ledger/ledger-1817.jsonl`（台帳id `69997fe4-4f0f-4c84-823e-1e895722af24`、予約0件）。前の記録と同じ台帳である。その台帳idも同じ記録にあり、`run-trial.mjs`と`judge.mjs`はこの台帳だけを使う。
- 予算：上限・余裕・1試行の予算は[conditions.json](conditions.json)の`budget`（15・1・0.6 USD）だけから取る。

## 実行の手順

統括が行う。`<scratch>`は一時directory、`<repo-root>`はこのrepositoryのcheckoutを指す。

**測定全体の前提：統括は台帳（`$LEDGER`）を手で編集しない。** 台帳に行を足すのは`run-trial.mjs`と`fixation.mjs init`だけである。`run-trial.mjs`・`run-all.mjs`・`collect.mjs`・`judge.mjs`は、同じ予約の2回目の精算、予約の無い精算、別の試行名の精算を手の編集として拒否する。精算の`costUsd`は、sha256で結んだ`meta.json`の`costUsd`と照合する。台帳は取り出しのときに`results/ledger.jsonl`として公開し、`judge.mjs`は読んだ台帳と同じことを確かめる。台帳に秘密は無い（id、試行名、費用、sha256、時刻だけ）。

手順2（隔離の確認）は、実HOMEとこのrepositoryに目印fileを一時的に作る。#1817での実行は、2026-11-25にownerが会話で承認した（統括が記録）。手順3は手順2の合格が前提である（decision-criteria.mdの規則5）。

```text
EV=docs/evidence/1817-skill-application
LEDGER=<scratch>/rel1817/ledger/ledger-1817.jsonl
mkdir -p <scratch>/run1817e/tmp
# 1. sample project（固定したsha256だけを受け付ける）
node $EV/harness/make-fixture.mjs B <scratch>/rel1817/release/agent-skill-chain-0.5.109.tgz 05901c4bbc0de3805ec2895328cfdf370afdd23aa4cf0536197f0c6ba9789a4f <scratch>/run1817e/fixture-B <scratch>/run1817e/tmp
node $EV/harness/make-fixture.mjs S <scratch>/rel1817/candidate3/agent-skill-chain-0.5.109.tgz 7e48d5cfac449506fd4f2cc7d741d926c122a860ab2a4a9cd2bc7ab2f0075939 <scratch>/run1817e/fixture-S <scratch>/run1817e/tmp
# 2. 隔離の確認（B・S各1回）。目印fileは確認の後に消す
node $EV/harness/markers.mjs create <repo-root>
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1817_ALLOW_PAID=1 node $EV/harness/run-trial.mjs <scratch>/run1817e/runs B probe 1 --fixture <scratch>/run1817e/fixture-B --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run
node $EV/harness/probe-check.mjs <scratch>/run1817e/runs/B-probe-1 B <home marker> <repo marker> <repo-root> > <scratch>/run1817e/probe-B.json
#   （Sも同じ）
node $EV/harness/probe-check.mjs compare <scratch>/run1817e/probe-B.json <scratch>/run1817e/probe-S.json
node $EV/harness/markers.mjs remove <repo-root>
# 3. 測定：固定した順の112試行（止まった場合は同じcommandで次の試行から続く）、その後に必須の置き換え
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1817_ALLOW_PAID=1 node $EV/harness/run-all.mjs planned <scratch>/run1817e/runs --fixture-B <scratch>/run1817e/fixture-B --fixture-S <scratch>/run1817e/fixture-S --ledger $LEDGER --run
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1817_ALLOW_PAID=1 node $EV/harness/run-all.mjs replacements <scratch>/run1817e/runs --fixture-B <scratch>/run1817e/fixture-B --fixture-S <scratch>/run1817e/fixture-S --ledger $LEDGER --run
# 4. 固定の照合、取り出し、判定（judge.mjsは固定・試行ごとの固定の記録・台帳・完了を照合してから採点する）
node $EV/harness/fixation.mjs check $EV/results/fixation.json
node $EV/harness/collect.mjs <scratch>/run1817e/runs $EV/results/traces --ledger $LEDGER --publish-ledger $EV/results/ledger.jsonl
node $EV/harness/judge.mjs $EV/results/traces --runs-root <scratch>/run1817e/runs --ledger $LEDGER --runs-json $EV/results/runs.json --out $EV/results/judge.json
```

`--run`を付けない`run-all.mjs`は、起動する試行の一覧を出すだけでモデルを呼ばない。`run-trial.mjs`を直接使う場合も、固定した順の次の試行以外は拒否される。判定は`judge.mjs`だけで行い、`score.mjs --judge`は拒否する。

tokenは測定を動かすprocessの環境変数`CLAUDE_CODE_OAUTH_TOKEN`だけで子processへ渡す。harnessはfileを読まず、値を表示・記録しない（#1814と同じ）。

費用の見込み：#1814の段階3の実績は1試行約0.083 USDだった。計画の単価を0.1 USDとし、隔離の確認2回＋測定112試行で11.4 USD（置き換えを除く）。1試行の平均が約0.12 USDを超えると、14 USDの線で最後の数試行が起動しない（decision-criteria.mdの規則7。この場合は`cap-reached`として判定する）。

### 途中で止まった試行からの再開

`run-trial.mjs`は、試行のdirectoryを作り、台帳に予約してからモデルを呼ぶ。終わると精算の行（費用、終了code、`trace.jsonl`・`meta.json`のsha256）を台帳に足し、試行の`home/`・`config/`を消す。processが止まった時点（Ctrl-Cやkillを含む）によって、残るものが2通りある。どちらも自動では消さない。

まず共通の確認：`run-trial.mjs`のprocessが動いていないこと（例：`pgrep -fl run-trial.mjs`が何も出さない）。動いている間は何も消さない。

共通の後片付け：止まった試行の`<scratch>/run1817e/runs/<試行名>/home/`と`config/`を消す。試行用の空のHOMEと設定で、アカウントの情報が残りうる。失敗の判断には使わない。消すのはこの2つのdirectoryだけで、同じ試行の`trace.jsonl`・`meta.json`・`work/`には触れない。

(1) 予約がある場合（`grep '"trial":"<試行名>"' $LEDGER`が予約の行を出す）。モデルの実行中に止まった場合がこれに当たる。

- 試行のdirectory（`home/`・`config/`以外）は消さない。精算の行が無い予約は、どのfileがあっても失敗として数える（`collect.mjs`は`not settled`として出す）。必須の置き換えの対象になる。
- 台帳は、精算の行の無い予約を予約額（0.6 USD）で数える。
- ほかに消してよいのは、古い`<ledger>.lock`だけである。台帳の行は変えない。
- その後、同じ`run-all.mjs planned`で次の試行から続け、計画の後に`run-all.mjs replacements`で置き換える。

(2) 予約が無い場合。directoryを作った後、予約の前に止まった場合がこれに当たる。計画の段階でも置き換えの段階でも同じである。

- `run-all.mjs`と置き換えの計画は、台帳の予約だけを開始済みとみなす。そのため、この試行を次に起動しようとし、`run-trial.mjs`が`exists`で拒否する。
- 消してよいのは、その試行のdirectory（`<scratch>/run1817e/runs/<試行名>/`）全体と、古い`<ledger>.lock`だけである。台帳の行は変えない。
- その後、同じ`run-all.mjs`のcommandで、その試行から続ける。

どちらの場合も、行った操作は統括が記録する。次の操作をすると、採点が拒否される。

- 予約のある試行を消す：`judge.mjs`が、台帳の予約・`trials.json`・traceの不一致として拒否する。
- 精算済みの試行の`trace.jsonl`・`meta.json`を消す、または変える：`collect.mjs`・`judge.mjs`が拒否する。置き換えの計画もその試行を失敗として扱わず、拒否する。

## モデルを呼ばない確認（HEAD `8ae7b145`、clean tree）

| 項目 | 結果 | 記録 |
| --- | --- | --- |
| harnessの試験（合成の記録） | 68件すべて合格。`test/test_source_quality.mjs` 2件合格、`npx eslint src bin test v05`は指摘なし | [results/harness-tests.txt](results/harness-tests.txt) |
| dry run（本物の2つのtarball、`--allow-unreleased`なし。sample projectは`<scratch>/run1817h/`） | 全7項目が合格（下の箇条） | [results/dry-run.json](results/dry-run.json) |
| 拒否の反例 | 下の箇条 | [results/refusals.txt](results/refusals.txt) |
| #1814のtraceの採点し直し | 上の「回答の目印の見直し」 | [results/rescore-1814.json](results/rescore-1814.json) |
| 固定の照合 | `fixation.mjs check`が合格（差なし） | [results/fixation.json](results/fixation.json) |

dry runの内容：

- B：出所`release`・`pinned`。16件の入口が記録とpackageに一致し、`claude-md`を採用した（blockSha256 `444b31b5…`、#1814の条件Iと同じ）。
- S：出所`candidate`（`7e48d5cf…`）で、ほかはBと同じ。
- 両方の`CLAUDE.md`は同じで、基の内容の後に区切り付きの塊とUSAGEの文例がある。
- 導入済みの`.agent-skill-chain/skills`の差は`asc/SKILL.md`・`estimate-and-scope/SKILL.md`だけ。project全体の差も、この2つ（と`managed-runtime`の複製）と`distribution.json`だけで、入口（`.claude/`）は同じ。
- Sの本文だけが2つの変更を含む（`asc`は6d6e1223の文）。
- commitの件名は両条件で同じ。
- 計画は114試行・11.4 USD。

拒否の反例（出力は加工せずに載せた。加工した行はその旨を書いた）：

- 組合せの取り違え：Sのsample projectをBとして、Bのsample projectをSとして使うと、`run-trial`の導入の検査が拒否した。
- tarballの取り違え：`make-fixture`は、他方の条件のtarballと、置き換えた前の2つの候補を拒否した。
- 順序：順序の外の試行を拒否した。計画の途中の置き換えと、置き換えの計画の無い置き換えも拒否した。
- probe：測定の開始（計画した試行の予約）の後のprobe、回3のprobe、回1の無い回2を拒否した。
- `collect.mjs`：`--publish-ledger`の無い起動を拒否した。`judge.mjs`：`--runs-root`の無い起動を拒否した。公開した`trials.json`が作り直しと違う場合と、公開した台帳が無い場合も拒否した。
- `run-all.mjs planned`（`--run`なし）の実際の出力：固定した順の112試行の一覧。
- 判定の入口：`score.mjs --judge`は拒否した。`judge.mjs`は、固定の記録が未commit、READMEに固定のcommitが無い、別の台帳、の場合に拒否した。
- 許可の環境変数なしの`--run`を拒否した。

CIのsource検査（`test/test_source_quality.mjs`、`scripts/check_source_quality.ts`を使う）は2件とも合格し、`npx eslint src bin test v05`は指摘なしだった（[results/harness-tests.txt](results/harness-tests.txt)）。ESLintの対象に`docs/evidence`は入っていない。参考までに`npx eslint docs/evidence/1817-skill-application`を実行すると、`harness/probe-check.mjs`の正規表現の不要なescape（`no-useless-escape`）2件が出る。このfileは#1814とbyteで同じで、#1814の写しにも同じ2件が出る。固定したfileを変えないため、直していない。

`skills/asc/SKILL.md`を変えた後（commit `6d6e1223`の時点）、`test/test_project_read_trigger.mjs`は14件すべて合格した。`test/test_package.mjs`は3件が失敗したが、`ee77daa0`の前と同じ3件である。どれもnpmの出力をJSONとして読む所での失敗で、この環境の問題であり本文の変更とは関係しない。`test/test_project_assets.mjs`（`ee77daa0`の後に43件合格・4件失敗。失敗はどれもGitの操作の失敗の文言の照合で、本文の文言には依存しない）は、`6d6e1223`の後には試していない。

## #1814のharnessからの変更

[harness/](harness/)は#1814のharnessの写しで、#1814のfileは変えていない。変更したのは次だけで、各fileの先頭に注記した。`apply-condition`・`condition-i`・`guard`・`install-asc`・`probe-check`は#1814とbyteで同じ。

- `make-fixture.mjs`：条件（B/S）を引数に取り、[release.json](release.json)のその条件のsha256だけを受け付ける。導入の記録に`condition`・`source`・`pinned`を加えた。
- `run-trial.mjs`：
  - 許可の環境変数を`ASC1817_ALLOW_PAID`にした。
  - 導入の記録の検査を「release.jsonにあるdigest」から「条件とtarballの組合せ（Bはrelease、Sは候補、固定したsha256）」に変えた。
  - 固定した順の次の試行だけを起動する。置き換えは、計画した試行のすべての後に、置き換えの計画の次の試行だけ。
  - 精算の行に、終了codeと`trace.jsonl`・`meta.json`のsha256を記録する。
- `order.mjs`・`run-all.mjs`・`judge.mjs`（新規）：
  - `order.mjs`：実行の順序、probeの制限（`probeRefusal`）、必須の置き換えの計画、完了・上限の判断（`completionStatus`）。
  - `run-all.mjs`：その順だけを実行するrunner。
  - `judge.mjs`：判定の唯一の入口。固定・試行ごとの`fixationSha256`・台帳を照合し、台帳の予約・`trials.json`・traceが同じ試行の集まりで予約の番号に欠けが無いこと、精算済みの試行の`trace.jsonl`・`meta.json`のsha256が精算の行と同じことを確かめる。さらに`--runs-root`の元の記録から作り直した出力と、公開したtrace・`trials.json`がbyteで同じこと、公開した台帳が読んだ台帳と同じことを確かめてから採点する。`--runs-root`は取り出しのときと同じpathで渡す（置換がそのpathを使うため）。
- `score.mjs`：
  - `collect.mjs`が置き換えたpath（`<trial>/work/…`）も採点できるようにした。#1814では、置き換える前の記録で採点する逸脱が必要だった。実際の絶対pathの扱いは変わらない。
  - 判定を`judge1817`（[decision-criteria.md](decision-criteria.md)）にした。
  - 置き換えを「k番目の失敗は回`4+k`だけ」に厳密にした。
  - 判定しない場合を加えた：完了も上限も無い停止、該当しない依頼の有効な試行が0件、有効な試行の無い依頼がある、置き換えの欠け。
  - `--judge`は拒否する。
- `fixation.mjs`：段階3（`stage3`）を拒否する（#1817には無い）。固定するfileに`run-order.json`・`order.mjs`・`run-all.mjs`・`judge.mjs`を加えた。初期化・refix・照合は同じ。
- `dry-run.mjs`：B・Sそれぞれのsample projectを本物のtarballから作る形に書き直した。2つの導入済みSkillの差が2つの本文だけであることを確かめる。
- `ledger.mjs`：精算の行に終了codeと`trace.jsonl`・`meta.json`のsha256を加えた。精算済みの試行のfileの欠け・改変と、精算と`meta.json`の`costUsd`の違いを検出する関数、手で編集した台帳を検出する関数（`ledgerProblems`）を加えた。
- `collect.mjs`：
  - 記録の欄（組合せ、`trace.jsonl`・`meta.json`のsha256）を加えた。
  - 出力を、元の記録だけから決まる関数（`buildCollection`・`collectTrial`）で作る形にした。`judge.mjs`が同じ関数で作り直して照合する。
  - `--ledger`と`--publish-ledger`を必須にした。手で編集した台帳、精算済みの試行のfileの欠けや改変、予約の無い試行のdirectoryは、何も書かずに拒否する。精算の無い予約は`not settled`として出す。台帳を`results/ledger.jsonl`に公開する。
  - 1回だけ、空のdirectoryへ取り出す（#1814の段階ごとの追記は無くした）。
- `markers.mjs`：目印の名前だけ。
- 試験：
  - #1814のR/P/Hのprobeの試験は、#1814の条件の定義を試験の中で与えて残した。
  - 加えた試験：B/Sのprobe、中立のcommit、release/候補の組合せの拒否、緩めた目印、`judge1817`と判定しない場合（途中の停止の合成の記録を含む）、置き換えたpathの採点、実行の順序、置き換えの計画と次の置き換えだけの受付け、測定の後のprobeの拒否と遅いprobeでの`cap-reached`の否認、判定の入口の拒否（予約した試行を消した記録を含む）、精算済みの試行のtraceの消去・改変とmetaの消去の拒否（置き換えも計画しない）、予約の無いdirectoryを開始済みとみなさないこと、公開したtrace・`trials.json`の改変の拒否、精算の無い予約を失敗とすること、手で編集した台帳と違う公開した台帳の拒否。
- 測定の計画（環境・隔離・限界）は#1814の[EVAL_PLAN.md](../1814-skill-invocation/EVAL_PLAN.md)による。hookの条件・段階3の仕組みは使わない。codeには残るが、条件B・Sでは通らない。

## 限界

- 各依頼4回で、条件の差は2つのSkill本文だけ。数試行の差は偶然の範囲を出ない。
- toolは`Read`・`Glob`・`Grep`・`Skill`だけ（#1814と同じ）。`asc-3`のように実装を求める依頼では、利用者の環境（Write・Bashあり）と振る舞いが違いうる。
- Sの`asc`の文は「依頼の中身が`docs/`等のfileにある場合を含む」と書いている。これは`asc-3`の依頼（「docs/BRIEF.md の依頼に対応して。」）の形そのものである。そのため`asc-3`でSがBを上回っても、その一部は、この依頼の形に合わせた書き方の効果でありうる。依頼の中身が別の形（会話の中、Issue、別のpath）の場合に同じ効果があるかは、この測定では分からない。
- 回答の目印は表面の語の一致だけを見て、回答の中身の正しさは見ない。目印は#1814の結果を見た後に見直した。具体的には次の2つの弱さがある。
  - `es-1`の`調査`：「調査が必要な作業」を分けていない回答でも、別の意味で「調査」と書けば一致する。そのためBも一致しやすく、BとSの差が小さく出る向きに働く。
  - `ui-1`の`空の(とき|場合)`：理論上は「検索欄が空のとき」（入力が空）にも一致しうる。#1814のtraceで一致したのは、どれも検索の結果が0件の状態についての記述だった。
- 候補のtarballは公開していない。測定後にSを採用する場合は、通常のrelease手順で改めて配布する。

## 結果

未測定。
