# 毎回読む規則を縮めた案の測定（#1823 段階2、候補S2）：設定

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。測定の仕組みは共通のもの（[../../../shared-harness/](../../../shared-harness/)）を使い、このdirectoryには設定だけを置く。段階1の設定と結果は[../../config/](../../config/)。

**状態：測定の準備（モデルを呼ばない確認まで）。固定の記録・台帳・probe・測定はまだ行っていない。**

## 目的

段階1の候補S（merge関係の規則をreferenceへ移した案）は、読む量を15%減らしたが、場面ごとの基準（m-revoked・m-release）を満たさず採用しなかった。段階2の候補S2は、merge関係の規則（merge許可・Draft・auto-merge・release起動・許可の記録と取消し）と判断者の規則を`skills/asc/SKILL.md`にそのまま残し、merge以外の重複と言い回しだけを縮める（[../rule-move-map.md](../rule-move-map.md)。`SKILL.md` 32,764 → 30,687 byte、−2,077、−6.3%）。S2が、現状Bと比べて品質（読まれるべきものが読まれて規則どおりに動くこと）を許容の範囲で保ったまま、読む量・トークン・時間を減らすかを、段階1と同じ環境で測る。

## ownerの判断（2026-11-27）

- 段階2はS2（merge関係の規則は変えない。merge以外の重複と言い回しだけ）。
- 判定の規則はモデル実行の前に固定する（[decision-criteria.md](decision-criteria.md)）：本文の読込みと手順の適用は該当する76試行でB − 2以上、場面ごとの手順の適用はB − 1以上（4回のうち）、該当しない依頼での余計な読込みはB ＋ 1以下、1試行あたりのASCの読んだbyte・入力トークン・時間はB以下。
- 費用の上限40 USD。段階1と同じ22依頼、各4回、B・S2の176試行、同じ共通の仕組み。
- 独立レビューは測定の前に1回、Medium以上を直した場合は差分に絞った再レビューを1回まで。

## 条件

| | B（現状） | S（候補S2） |
| --- | --- | --- |
| tarball | release v0.5.113（対象commit `72d6524c`、sha256 `750e0e73…`） | S2のcommitから作る候補（`release.json`のS。sha256 `e9e577a6…`、元commit `1704d347`） |
| 導入 | 利用者の手順（専用のworktreeで`project-assets --register-claude-skill --apply`）。`project-assets`の提案から読む契機`claude-md`を採用（段階1と同じ） | 同じ |
| 規則を持つfile | 場面の規則はB・Sとも`skills/asc/SKILL.md`。S2で移した規則は`coordination.md`・`review.md`・`workspace.md`・`controller.md`（既存のreference） | |

- 条件の名前は共通の仕組みの都合で`B`・`S`（`S`がS2）。
- toolは段階1と同じ水準Wだけ：Read・Write・Edit・Glob・Grep・Skill、`--permission-mode acceptEdits`、Bashなし。隔離も同じ。
- 条件の違いは、導入したtarballだけである。B・S2の導入後の差は、asc Skillの本文と4つのreference（とその写し）、導入の記録だけ（dry runで確認）。
- B・S2の`SKILL.md`以外の配布物は、`release-identity.json`を除いて同じ（S2を展開して確認）。新しいreference fileは無いので、`package.json`・`src/runtime-files.json`・assetの上限は変えていない。

## 依頼

[cases.json](cases.json)。段階1の22依頼と同じ依頼文・fixture・目印（`cases.json`の`references`・`referencesByCondition`だけが違う）。各条件各4回、計176試行（＋probe 2回）。場面の5依頼（`m-grant`・`m-revoked`・`m-draft`・`m-release`・`m-decision`）は、B・Sのどちらでも規則が本文にあるので、規則を持つreferenceは無い（B・Sとも空）。順序は[run-order.json](run-order.json)（段階1と同じ）。

## 指標と規則

[decision-criteria.md](decision-criteria.md)で固定する（`conditions.json`の`rule`）。許容は共通の仕組みの`rule.tolerance`（試行の数。`score.mjs`の`toleranceOf`。無ければ0で、段階1の判定は変わらない）。

- 本文の読込み・手順の適用：該当する依頼（19依頼×4回＝76試行／条件）で、S ≧ B − 2（率で比べる）。
- 場面の各依頼（5件）で、手順の適用がS ≧ B − 1。
- 余計な読込み（該当しない依頼）：S ≦ B ＋ 1。
- 1試行あたりの読んだASC byte・入力トークン・時間：すべての依頼でS ≦ B（許容なし）。
- 段階1の本文の読込みの下限0.8は置かない（`minBodyRate` 0）。

## 費用とトークン

- 上限40 USD（owner、段階1とは別）、余裕0.8 USD、停止の線39.2 USD。1試行の予算（`--max-budget-usd`と台帳の予約）0.35 USD。
- 見込み（段階1のBの種類ごとの平均。S2はB以下の見込み）：asc 0.136、目的別 0.094、該当しない 0.029、画面 0.184、場面 0.117、probe 0.121 USD。dry runの計算で176試行とprobe 2回で計 **約19.3 USD**（計画の単価で20.5 USD）、入力トークン（入力＋cache）約**1,250万**、出力約**61万**。段階1の実績は176試行で18.57 USD。
- 線までに使える1試行の平均（損益分岐、`breakEvenPerTrialUsd`）は約0.221 USD、見込みの平均は約0.110 USD。

## 手順（統括が行う）

`<scratch>`は一時directory、`<repo-root>`はrepositoryのcheckout。harnessはsandboxの外のshellで実行する。台帳を手で編集しない。

```text
H=docs/evidence/shared-harness
EV=docs/evidence/1823-slim-always-read/stage2/config
LEDGER=<scratch>/rel1823s2/ledger/ledger-1823s2.jsonl
TGZ_B=<scratch>/rel1823s2/release/agent-skill-chain-0.5.113.tgz
TGZ_S=<scratch>/rel1823s2/candidate/agent-skill-chain-0.5.113.tgz
# 0. 済：Sを固定した（S2のcommitで2回packして同じsha256、release.jsonのS）。ownerの目印fileの承認をresults/probe-approval.jsonに記録してcommitする（統括）
node scripts/pack-candidate.mjs <scratch>/rel1823s2/candidate/ --version=0.5.113
# 1. dry run（B・S、新しいdirectory）：済（下の「モデルを呼ばない確認」）
node $H/dry-run.mjs <scratch>/rel1823s2/run1823s2dry --tarball-B $TGZ_B --tarball-S $TGZ_S --config $EV --out <scratch>/rel1823s2/run1823s2dry.json
# 2. 固定：台帳を作り、最初の記録を作る。その記録のcommit（出力のfixedAtCommit）をこのREADMEに書いてcommitする
mkdir -p <scratch>/rel1823s2/ledger
node $H/fixation.mjs init $EV/results/fixation.json --ledger $LEDGER --config $EV
node $H/fixation.mjs check $EV/results/fixation.json --config $EV
# 3. fixture：条件×フォルダの16（固定したsha256だけを受け付ける）
FX=<scratch>/rel1823s2/run/fixtures; mkdir -p <scratch>/rel1823s2/run/tmp
for C in B S; do for F in A D3 D4 D7 MG MA MR MD; do
  TGZ=$([ $C = B ] && echo $TGZ_B || echo $TGZ_S); SHA=$(shasum -a 256 $TGZ | cut -d' ' -f1); mkdir -p <scratch>/rel1823s2/run/tmp/$C-$F
  node $H/make-fixture.mjs $C $F $TGZ $SHA $FX/fixture-$C-$F <scratch>/rel1823s2/run/tmp/$C-$F --config $EV
done; done
# 4. 隔離の確認（B・S各1回、fixture A）。目印fileは確認の後に消す
node $H/markers.mjs create <repo-root> --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-trial.mjs <scratch>/rel1823s2/run/runs B probe 1 --fixture $FX/fixture-B-A --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run --config $EV
node $H/probe-check.mjs <scratch>/rel1823s2/run/runs/B-probe-1 B <home marker> <repo marker> <repo-root> --config $EV > <scratch>/rel1823s2/run/probe-B.json
#   （Sも同じ。不合格の条件だけ回2を1回実行できる）
node $H/probe-check.mjs compare <scratch>/rel1823s2/run/probe-B.json <scratch>/rel1823s2/run/probe-S.json --out <scratch>/rel1823s2/run/runs/probe-compare.json --config $EV
node $H/probe-check.mjs publish $EV/results/probes <scratch>/rel1823s2/run/probe-*.json <scratch>/rel1823s2/run/runs/probe-compare.json --home-marker <home marker> --repo-marker <repo marker> --repo-root <repo-root> --runs-root <scratch>/rel1823s2/run/runs --config $EV
node $H/markers.mjs remove <repo-root> --config $EV
# 5. 測定：固定した順の176試行（止まれば同じcommandで次から続く）、その後に必須の置き換え
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs planned <scratch>/rel1823s2/run/runs --fixtures $FX --ledger $LEDGER --run --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs replacements <scratch>/rel1823s2/run/runs --fixtures $FX --ledger $LEDGER --run --config $EV
# 6. 固定の照合、公開する記録の作成（生の実行記録は公開しない）、判定
node $H/fixation.mjs check $EV/results/fixation.json --config $EV
node $H/collect.mjs <scratch>/rel1823s2/run/runs $EV/results --ledger $LEDGER --config $EV
node $H/judge.mjs $EV/results --runs-root <scratch>/rel1823s2/run/runs --ledger $LEDGER --out $EV/results/judge.json --config $EV
```

- `--run`を付けない`run-trial.mjs`・`run-all.mjs`は、起動するcommandや試行の一覧を出すだけでモデルを呼ばない。
- 目印の名前は`markerTag` `1823s2`（`asc1823s2-home-marker.txt`等。段階1の目印と分ける）。
- 固定の記録は、この設定の5file（`decision-criteria.md`・`cases.json`・`conditions.json`・`release.json`・`run-order.json`）と、共通の仕組みのmoduleのsha256を持つ。測定の終わりまで、共通の仕組みも変えない。
- 公開するのは`results/`の`trials.json`・`runs.json`・`ledger.jsonl`・`published.json`・`judge.json`・`probes/`だけ（段階1と同じ）。生のtraceはscratchに残す。

## モデルを呼ばない確認（2026-11-27）

- 共通の仕組みの試験：31件合格（段階1の28件と、許容・段階2の設定の3件）。
- dry run（B・S両方、本物のrelease tarballと候補のtarball、新しい`<scratch>/rel1823s2/run1823s2dry/`）：全16項目が合格。条件ごとに8つのfixture（A・D3・D4・D7・MG・MA・MR・MD）の導入と`claude-md`の採用、場面のfixtureのfile（`caseNeeds`）、B・Sの導入後の差が許される範囲（asc Skillの本文と4つのreference、その写し、導入の記録）に収まり、本文と4つのreferenceが必ず違うこと、probe 2回と176試行の起動command。見込み176試行・約19.3 USD、入力約1,247万トークン、損益分岐0.221 USD/試行。

## 限界

- 各依頼4回。数試行の差は偶然の範囲を出ない。許容はその幅を判定に入れたもので、許容の中の低下を「同じ」と言うものではない。
- 場面は手順を書かせて目印で見る（段階1と同じ）。目印と`ruleLines`はmain `6e950366`の行番号で、v0.5.113（`72d6524c`）の`SKILL.md`も同じ本文である。S2では同じ規則が本文の別の行（L25はL23等）にある。
- S2で移した規則（進行役の分担、レビュー後の再読込み・再実行の条件、旧設定のnotice、Controller・snapshot）を直接に確かめる依頼は無い。それらは、22依頼の本文の読込み・手順の適用と効率の中でだけ見る。
- 読んだbyteは、読んだfileの大きさで数える（offset・limitで一部だけ読んだ場合もfile全体）。トークンと時間は試行ごとのばらつきが大きい。
