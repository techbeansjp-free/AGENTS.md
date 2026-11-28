# 合意の版の書き方の測定（#1846）：設定

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。

共通の測定の仕組み（[../../shared-harness/](../../shared-harness/)）で使う設定のdirectoryである。仕組みは写さず、[#1840の設定](../../1840-user-environment/config/)と同じ形の設定だけを置く。判定の規則は[decision-criteria.md](decision-criteria.md)。

## 目的

ownerの決定（Issue #1846、2026-11-28）：回答案に合意の版を示すことは必須である（変更前の`skills/estimate-and-scope/SKILL.md`「根拠のWAR IDと合意の版を示し」）。#1840のC（#1837あり）は、9件中9件でWAR IDを示したが、4件は版を「品質保証範囲 v1.0」と書いたため、版の目印（`版1.0`・`1.0版`だけ）に数えられなかった。案件の仕様書にはリリースの番号`v1.0.0`もあり、取り違えの恐れがある。

このPRは`estimate-and-scope`に書き方の例「WAR-002（合意の版1.0）」を足し、版を行の状態とあわせて示し、リリースの番号と区別するよう書いた。この測定は、その候補版で、保守の依頼の回答がWAR IDと合意の版を示し、調査の前に無償を約束しないかを確かめる。

## 条件・fixture・依頼

| 項目 | 内容 |
| --- | --- |
| 条件 | C（候補版）だけ（[release.json](release.json)。packするまで仮の値） |
| fixture | MN（#1840と同じ、納品済みの受託案件。品質保証範囲は版1.0で合意済み）、EC1（n-2用。#1840と同じ） |
| 依頼 | m-r1（税込金額の1円の差、WAR-002）、m-r2（iPadのSafari、WAR-001）、m-r7（移行データの重複、WAR-005・未決）、n-2（該当しない依頼：翻訳）。文面・読むべきfile・減点は#1840と同じ |
| 回数 | 各3回、計12試行とprobe 1回。水準0.78（9件中7件）を#1840と同じ9試行で見るため、回数は#1840と同じ3回とした |
| 目印 | 合意の版の目印だけを緩めた（`v1.0`を「品質保証範囲」・WAR ID・「合意」の近くで数え、「版（1.0）」の括弧も許す。`v1.0.0`は数えない）。m-r7には同じ目印を報告だけで加えた。報告だけの`report`（書いたfile等）は#1840と同じ |

## #1840の回答を採点し直した参考の値（2026-11-28、モデルの呼出しなし）

#1840の生の記録（scratch、commitしない）のm-r1・m-r2・m-r7の18試行を、共通の仕組みの`collect.mjs`の`collectTrial`と`score.mjs`の`scoreTrials`で、#1840の`cases.json`（固定の目印）とこの設定の`cases.json`（緩めた目印）の両方で採点した。**参考の値であり、#1840の固定した判定と記録（`docs/evidence/1840-user-environment/`）は変えない。** 固定の目印での採点は、#1840の公開した`runs.json`の`markers`と18件すべて一致した。PR #1848（#1845）の共通の仕組みでも、同じ結果になった。

| 試行 | 固定の目印 | 緩めた目印 | 落ちた観点（緩めた目印） | 減点 |
| --- | --- | --- | --- | --- |
| C-m-r1-1 | 合格 | 合格 | なし | なし |
| C-m-r1-2 | 不合格（版） | 合格 | なし | なし |
| C-m-r1-3 | 不合格（版） | 合格 | なし | なし |
| C-m-r2-1 | 不合格（版） | 合格 | なし | なし |
| C-m-r2-2 | 合格 | 合格 | なし | なし |
| C-m-r2-3 | 不合格（版） | 合格 | なし | なし |
| C-m-r7-1 | 合格 | 合格 | なし（報告だけの版は無し） | なし |
| C-m-r7-2 | 合格 | 合格 | なし | なし |
| C-m-r7-3 | 合格 | 合格 | なし | なし |
| R-m-r1-1 | 不合格 | 不合格 | WAR-002 | 調査の前の無償の約束 |
| R-m-r1-2 | 不合格 | 不合格 | WAR-002、版 | 調査の前の無償の約束 |
| R-m-r1-3 | 不合格 | 不合格 | WAR-002、版 | なし |
| R-m-r2-1 | 不合格 | 不合格 | 版 | なし |
| R-m-r2-2 | 不合格 | 不合格 | 版 | なし |
| R-m-r2-3 | 不合格 | 不合格 | 版 | なし |
| R-m-r7-1 | 不合格 | 不合格 | WAR-005（報告だけの版も無し） | 調査の前の無償の約束 |
| R-m-r7-2 | 合格 | 合格 | なし（報告だけの版は無し） | なし |
| R-m-r7-3 | 合格 | 合格 | なし（報告だけの版は無し） | なし |

| 条件 | 固定の目印 | 緩めた目印 | 調査の前の無償の約束 |
| --- | --- | --- | --- |
| C（#1837あり） | 5/9 | 9/9 | 0/9 |
| R（v0.5.119） | 2/9 | 2/9 | 3/9 |

- 緩めた目印で合格に変わった4件は、すべて「品質保証範囲 v1.0」「品質保証範囲（v1.0、…合意）」の形だった。Rの回答に現れた`v1.0.0`（「納品した v1.0.0」等）は、どちらの目印でも数えない。
- R-m-r1-1の「品質保証範囲 v1.0」は緩めた目印で版に数えたが、WAR IDが無く減点もあるので不合格のまま。
- 緩めた目印は、例の形・`版1.0`・`1.0版`・「合意の版（1.0）」・「合意の版：（1.0）」・「品質保証範囲 v1.0」・「v1.0 で合意」に合い、`v1.0.0`・`版1.0.0`・「合意の版（1.0.0）」・`v10`・単独の「リリース v1.0」に合わないことを確かめた。近くに「品質保証範囲」・WAR ID・「合意」があれば、「合意したリリース v1.0」も数える（[限界](decision-criteria.md#限界)）。
- 括弧を許した後の目印で採点し直しても、上の18件の結果は変わらなかった。#1829の照合の答え（`docs/evidence/1829-estimate-warranty/`）と#1840の`calibration.json`には、緩めた分に合う書き方（`v1.0.0`を除く`v1.0`、「版（1.0）」）が無く、照合の結果も変わらない。

## 費用とトークン（見込み）

#1840のCの同じ依頼の平均（m-r1 0.110、m-r2 0.117、m-r7 0.108、n-2 0.025 USD。入力トークン 約5.3万〜7.3万、出力 約3,300、1試行 約27秒）から：

| 項目 | 試行 | 見込み |
| --- | --- | --- |
| probe（C、fixture MN） | 1 | 約0.13 USD |
| m-r1・m-r2・m-r7 | 9 | 約1.08 USD |
| n-2 | 3 | 約0.09 USD |
| 計 | 13 | 約1.3 USD（計画の単価で約1.7 USD。置き換えやprobeの再実行があれば最大で約0.5 USD増える） |

ownerの上限20 USDは#1843・#1844・#1846の合計で、この測定への割当ては3 USD（#1843 6 USD、#1844 10 USDとあわせて19 USD。割当てはIssue #1846に記録）。`conditions.json`の`ownerCapUsd`をこの割当ての3にし、上限3 USD・停止の線2.5 USDが割当てを超えないことを仕組みが確かめる。

## #1848（#1845）への依存

- **水準の分数**：g1-maintenance-answerの`min`は`"7/9"`。#1848の`levelMet`が無いと、文字列の`min`は常に不合格になる（main `599a2b09`の仕組みで、7/9の試行が`pass: false`になることを確かめた。#1848の`0f61b0bf`では`pass: true`）。
- **固定の記録**：`fixation.mjs`は共通の仕組みのmoduleのsha256を持つ。#1848は`score.mjs`・`collect.mjs`・`probe-check.mjs`を変えるので、#1848のmergeの前に固定すると、mergeの後に`run-trial.mjs`が拒否する。
- 他の#1848の変更（`writes.forbid`の`scope: "code"`、`requireFiles`、`okSkills`、`work/`のHEADの照合、`GIT:`の行）は、この設定の依頼が使わない（`writes`が無い）か、照合を厳しくするだけで設定の変更は要らない。
- #1848が`min`の形を変えてmergeされた場合は、固定の前にこの設定を合わせる。

## 手順（統括が行う。2026-11-28に実行した）

`<scratch>`は一時directory、`<repo-root>`はrepositoryのcheckout。harnessはsandboxの外のshellで実行する。台帳を手で編集しない。

```text
H=docs/evidence/shared-harness
EV=docs/evidence/1846-warranty-version/config
LEDGER=<scratch>/rel1846/ledger/ledger-1846.jsonl
TGZ_C=<scratch>/rel1846/candidate/agent-skill-chain-0.5.121.tgz
# 前提：#1848がmainにmergeされ、このbranchがそれを取り込み、独立レビューの是正が終わったHEADであること
# 0. 候補版をpackし、release.jsonのCを埋める（placeholderを外す、assetSha256・packedFromCommit）。v0.5.121の資産と展開して比べる
# 1. ownerの目印fileの承認をresults/probe-approval.jsonに記録してcommitする
# 2. dry run（新しいdirectory）
node $H/dry-run.mjs <scratch>/run1846dry --tarball-C $TGZ_C --config $EV --out <scratch>/run1846dry.json
# 3. 固定：fixation.mjs init（新しい台帳）。最初の固定のcommit・台帳idをこのREADMEに書いてcommitする
# 4. fixture：MNとEC1
FX=<scratch>/run1846/fixtures; SHA=$(shasum -a 256 $TGZ_C | cut -d' ' -f1)
for F in MN EC1; do mkdir -p <scratch>/run1846/tmp/C-$F; node $H/make-fixture.mjs C $F $TGZ_C $SHA $FX/fixture-C-$F <scratch>/run1846/tmp/C-$F --config $EV; done
# 5. 隔離の確認（C 1回、fixture MN）。目印fileは確認の後に消す
node $H/markers.mjs create <repo-root> --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-trial.mjs <scratch>/run1846/runs C probe 1 --fixture $FX/fixture-C-MN --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run --config $EV
node $H/probe-check.mjs <scratch>/run1846/runs/C-probe-1 C <home marker> <repo marker> <repo-root> --config $EV > <scratch>/run1846/probe-C.json
node $H/probe-check.mjs compare <scratch>/run1846/probe-C.json --out <scratch>/run1846/runs/probe-compare.json --config $EV
node $H/probe-check.mjs publish $EV/results/probes <scratch>/run1846/probe-C.json <scratch>/run1846/runs/probe-compare.json --home-marker <home marker> --repo-marker <repo marker> --repo-root <repo-root> --runs-root <scratch>/run1846/runs --config $EV
node $H/markers.mjs remove <repo-root> --config $EV
# 6. 測定：固定した順の12試行、その後に必須の置き換え
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs planned <scratch>/run1846/runs --fixtures $FX --ledger $LEDGER --run --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs replacements <scratch>/run1846/runs --fixtures $FX --ledger $LEDGER --run --config $EV
# 7. 固定の照合、公開する記録の作成（生の実行記録は公開しない）、判定。無償の約束の件数はruns.jsonのmarkerDeductionsから数える
node $H/fixation.mjs check $EV/results/fixation.json --config $EV
node $H/collect.mjs <scratch>/run1846/runs $EV/results --ledger $LEDGER --config $EV
node $H/judge.mjs $EV/results --runs-root <scratch>/run1846/runs --ledger $LEDGER --out $EV/results/judge.json --config $EV
```

## モデルを呼ばない確認（2026-11-28）

- `order.mjs`の`orderProblems`：問題なし。計画の12試行は`C-m-r1-1 C-n-2-1 C-m-r2-1 C-m-r7-1 …`の順。
- `make-fixture.mjs`の`releasePlaceholders`：`C (release.json C: placeholder)`（packの前なので、有料の実行・fixture・固定は拒否される）。
- 水準：9件中7件の`markers`で、main `599a2b09`の仕組みは不合格、#1848 `0f61b0bf`の仕組みは合格。
- dry run（手順の2、2026-11-28、packの後）：すべての照合に合格（`pass: true`。計画12試行、見込み1.30 USD、計画の単価で1.71 USD、停止の線2.5 USD）。

## 測定の前の固定

- 候補版：#1848のmerge（main `328a19f4`）を取り込んだ`fc055ec1c5febc08959c29b6e44fad779119a39a`を一時のcloneで`pack-candidate.mjs --version=0.5.121`でpackした。sha256 `91643ca012606de0cb3c9a74ce5761c46178b2ea2b4ada9e7084af61a1b9c421`。GitHub Release v0.5.121の資産（sha256 `2eede114…`、`SHA256SUMS`と一致）と展開して比べ、差は`skills/estimate-and-scope/SKILL.md`と`release-identity.json`だけだった。
- ownerの目印fileの承認：[#1846のcomment](https://github.com/techbeansjp-free/AGENTS.md/issues/1846#issuecomment-7231490199)（`results/probe-approval.json`）。
- `results/fixation.json`の最初の記録のcommitは`3e358c132de2a5b60af9354affc7c4fec0d37d47`。台帳idは`289acf03-ba9b-45f3-9984-31f7c9df8768`、台帳は`<scratch>/rel1846/ledger/ledger-1846.jsonl`（新しい台帳、予約0件）。`run-trial.mjs`はこの記載を照合する。
- 固定の記録は、この設定の5fileと共通の仕組みのmodule 16件のsha256を持つ。測定の終わりまで、設定と共通の仕組みを変えない。

## 測定の経過（2026-11-28）

- dry run、固定（`3e358c13`）、fixture（MN・EC1）、probe 1回（すべての項目が合格、目印fileは消した）、計画の12試行（失敗0件）、必須の置き換え（0件）、`fixation.mjs check`（差なし）、`collect.mjs`、`judge.mjs`の順に行った。結果は[../README.md](../README.md)。
- `judge.mjs`は`conditions.json`の`cells`を2つと決めて読む（`const [b, c] = Object.keys(conds.cells)`）。条件が1つのこの設定では2つ目が`undefined`になり、全体の判定が`not-judged`になった。固定の後なので仕組みと設定は変えず、`judge.json`はそのまま公開した。Cの`perCondition`は`meets-levels`。
