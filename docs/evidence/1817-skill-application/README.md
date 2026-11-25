# Skill本文の改善案の測定の準備（#1817）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 目的

#1814の段階3（条件I）では、Skillの本文は22/22で読まれたが、手順の適用（本文・必要なreference・回答の目印のすべて）は16/22だった。#1817の調査（[Issue](https://github.com/techbeansjp-free/AGENTS.md/issues/1817)）で、不適用の多くは回答の目印の表記の揺れで、Skill本文の書き方で直せる候補は2つ（`asc-3`で作業場所の手順を読まない、`es-1`で調査が必要な作業を明示しない）と分かった。commit `4c95f8d4`でこの2か所を`skills/asc/SKILL.md`と`skills/estimate-and-scope/SKILL.md`に書いた。ここでは、その改善案（S）を現状（B）と同じ隔離環境で比べる準備をする。**モデルはまだ呼んでいない。**

## ownerの判断（2026-11-25、[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1817#issuecomment-7159921981)）

- Skill本文の改善案2つを、隔離環境で測る。
- 回答の目印を、表記の揺れを許す形に見直して固定する。比べる相手（現状）も同じ規則で新しく測る。
- 14依頼×各4回×2条件、費用の上限15 USD。
- 改善後が現状を上回れば採用の候補とし、採否はownerが決める。

## 条件と導入するtarball

| 条件 | 導入するもの | sha256 |
| --- | --- | --- |
| B（現状） | release v0.5.109（target commit `af2ab12e`）。draft・prereleaseではない。SHA256SUMSとreleaseのassetのdigestの両方と一致 | `05901c4b…`（[release.json](release.json)） |
| S（改善案） | commit `4c95f8d4`で`node scripts/pack-candidate.mjs <scratch>/rel1817/candidate --version=0.5.109`により作った候補 | `f8c3eae7…`（同上） |

- どちらも#1814の条件Iと同じ手順で作る：合成のsample project（同じfile・同じ基の`CLAUDE.md`）に、USAGEの利用者の手順（`npm install`したpackageの`project-assets --register-claude-skill`の計画→`--apply`）で導入し、計画が示す読む契機の選択肢`claude-md`を`--adopt-read-trigger`で承認して`CLAUDE.md`へ追記する。その後、中立のcommitを1件入れる。
- 2つのtarballを展開して比べると、違うのは`package/release-identity.json`（2つの本文のsha256だけ）、`package/skills/asc/SKILL.md`、`package/skills/estimate-and-scope/SKILL.md`の3つだけ。2つの本文は、Bが`af2ab12e`、Sが`4c95f8d4`のfileとbyteで同じ（2026-11-25に確認）。
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

[decision-criteria.md](decision-criteria.md)（モデル実行の前に固定）。該当する11依頼×4回＝各44試行で、Sが次の3つをすべて満たせば「採用の候補」：手順の適用がBより多い、本文の読込みがBの−1以上、該当しない依頼での過剰な読込みがBの＋1以下。`asc-3`と`es-1`は依頼ごとに別に示す。各依頼4回では小さな差は偶然の範囲を出ず、採否はownerが決める。失敗・置き換え（次の番号で1回だけ）・隔離の確認は#1814と同じ。

## 測定の前の固定

`results/fixation.json`の最初の記録のcommitは（固定の後に記入する）である（`run-trial.mjs`はこの記載を照合する）。台帳はrepositoryの外の`<scratch>/rel1817/ledger/ledger-1817.jsonl`で、その台帳idも同じ記録にあり、`run-trial.mjs`はこの台帳だけを使う。上限・余裕・1試行の予算は[conditions.json](conditions.json)の`budget`（15・1・0.6 USD）だけから取る。

## 実行の手順（統括が行う。`<scratch>`は一時directory、`<repo-root>`はこのrepositoryのcheckout）

```text
EV=docs/evidence/1817-skill-application
LEDGER=<scratch>/rel1817/ledger/ledger-1817.jsonl
mkdir -p <scratch>/run1817/tmp
# 1. sample project（固定したsha256だけを受け付ける）
node $EV/harness/make-fixture.mjs B <scratch>/rel1817/release/agent-skill-chain-0.5.109.tgz 05901c4bbc0de3805ec2895328cfdf370afdd23aa4cf0536197f0c6ba9789a4f <scratch>/run1817/fixture-B <scratch>/run1817/tmp
node $EV/harness/make-fixture.mjs S <scratch>/rel1817/candidate/agent-skill-chain-0.5.109.tgz f8c3eae78b36951746a4e615a173cc3c91777131fb06c4cdaae53b32aa512b1e <scratch>/run1817/fixture-S <scratch>/run1817/tmp
# 2. 隔離の確認（B・S各1回）。目印fileは確認の後に消す
node $EV/harness/markers.mjs create <repo-root>
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1817_ALLOW_PAID=1 node $EV/harness/run-trial.mjs <scratch>/run1817/runs B probe 1 --fixture <scratch>/run1817/fixture-B --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run
node $EV/harness/probe-check.mjs <scratch>/run1817/runs/B-probe-1 B <home marker> <repo marker> <repo-root> > <scratch>/run1817/probe-B.json
#   （Sも同じ）
node $EV/harness/probe-check.mjs compare <scratch>/run1817/probe-B.json <scratch>/run1817/probe-S.json
node $EV/harness/markers.mjs remove <repo-root>
# 3. 測定：依頼ごと・回ごとにB、Sの順で交互に（112試行）
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC1817_ALLOW_PAID=1 node $EV/harness/run-trial.mjs <scratch>/run1817/runs <B|S> <case> <1..4> --fixture <scratch>/run1817/fixture-<B|S> --ledger $LEDGER --run
# 4. 取り出しと採点（置き換えた公開用の記録をそのまま採点できる）
node $EV/harness/collect.mjs <scratch>/run1817/runs $EV/results/traces
node $EV/harness/score.mjs $EV/cases.json $EV/results/traces B S --runs-json $EV/results/runs.json --judge B S
```

tokenは測定を動かすprocessの環境変数`CLAUDE_CODE_OAUTH_TOKEN`だけで子processへ渡す。harnessはfileを読まず、値を表示・記録しない（#1814と同じ）。費用の見込みは、#1814の段階3の実績（1試行約0.083 USD）から計画の単価0.1 USDで、隔離の確認2回＋測定112試行＝11.4 USD。1試行の平均が約0.12 USDを超えると、14 USDの線で最後の数試行が起動しない（規則6）。目印fileを実HOMEに一時的に置くことは#1814でownerが了承した手順であり、#1817でも同じ扱いでよいかは統括が確かめる。

## モデルを呼ばない確認（このcommitでの結果）

| 項目 | 結果 | 記録 |
| --- | --- | --- |
| harnessの試験（合成の記録） | 下の「固定と確認の記録」に記入 | [results/harness-tests.txt](results/harness-tests.txt) |
| dry run（本物の2つのtarball、`--allow-unreleased`なし） | 同上 | [results/dry-run.json](results/dry-run.json) |
| #1814のtraceの採点し直し | 上の「回答の目印の見直し」 | [results/rescore-1814.json](results/rescore-1814.json) |

## #1814のharnessからの変更

[harness/](harness/)は#1814のharnessの写しで、#1814のfileは変えていない。変更したのは次だけ（各fileの先頭に注記）。`apply-condition`・`condition-i`・`guard`・`install-asc`・`ledger`・`probe-check`は#1814とbyteで同じ。

- `make-fixture.mjs`：条件（B/S）を引数に取り、[release.json](release.json)のその条件のsha256だけを受け付ける。導入の記録に`condition`・`source`・`pinned`を加えた。
- `run-trial.mjs`：許可の環境変数を`ASC1817_ALLOW_PAID`にした。導入の記録の検査を「release.jsonにあるdigest」から「条件とtarballの組合せ（Bはrelease、Sは候補、固定したsha256）」に変えた。
- `score.mjs`：(1) `collect.mjs`が置き換えたpath（`<trial>/work/…`）も採点できるようにした（#1814では置き換える前の記録で採点する逸脱が必要だった。実際の絶対pathの扱いは変わらない）。(2) 判定を`judge1817`（[decision-criteria.md](decision-criteria.md)）にした。
- `fixation.mjs`：段階3（`stage3`）を拒否する（#1817には無い）。初期化・refix・照合は同じ。
- `dry-run.mjs`：B・Sそれぞれのsample projectを本物のtarballから作り、2つの導入済みSkillの差が2つの本文だけであることを確かめる形に書き直した。
- `collect.mjs`・`markers.mjs`：記録の欄と目印の名前だけ。
- 試験：#1814のR/P/Hのprobeの試験は、#1814の条件の定義を試験の中で与えて残した。B/Sのprobe、中立のcommit、release/候補の組合せの拒否、緩めた目印、`judge1817`、置き換えたpathの採点の試験を加えた。
- 測定の計画（環境・隔離・限界）は#1814の[EVAL_PLAN.md](../1814-skill-invocation/EVAL_PLAN.md)による。hookの条件・段階3の仕組みは使わない（codeには残るが、条件B・Sでは通らない）。

## 限界

- 各依頼4回、条件の差は2つのSkill本文だけ。数試行の差は偶然の範囲を出ない。
- toolは`Read`・`Glob`・`Grep`・`Skill`だけ（#1814と同じ）。`asc-3`のように実装を求める依頼では、利用者の環境（Write・Bashあり）と振る舞いが違いうる。
- 回答の目印は文字列の一致で、回答の中身の正しさは見ない。目印は#1814の結果を見た後に見直した。
- 候補のtarballは公開していない。測定後にSを採用する場合は、通常のrelease手順で改めて配布する。

## 結果

未測定。
