# 毎回読む規則を縮めた案の測定（#1823）：設定

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。測定の仕組みは共通のもの（[../../shared-harness/](../../shared-harness/)）を使い、このdirectoryには設定だけを置く。

**結果：未測定**（Sのtarballが未作成で、`release.json`のSは仮の値）。

## 目的

`skills/asc/SKILL.md`の毎回読む部分から条件付きの規則（merge許可の記録・取消しの検索と手続き、Draft・auto-mergeの扱い、release起動の判定、merge・releaseの問い方、判断者の細則）を条件付きのreferenceへ移した候補Sが、現状Bと比べて、読まれるべきものが読まれて規則どおりに動くこと（品質）を保ったまま、読む量・トークン・時間を減らすかを、#1820の段階2と同じ隔離した利用者同等の環境で測る。

## ownerの判断（2026-11-26）

[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1823#issuecomment-7186299740)：

- 縮める範囲は保守案（上の条件付きの規則を移す。merge以外の作業の規則は変えない）。
- 費用の上限は測定40 USD。独立レビューは合計3回まで（測定前の計画1回、提出前1回、差分に絞った再レビュー1回）で、統括が行う。超えそうなら止めて相談する。
- 今後の評価の記録に生の実行記録を加えない（Issueの決定B）。この測定は共通の測定の仕組みで行い、Issueごとにコピーしない。

## 条件

| | B（現状） | S（縮めた案） |
| --- | --- | --- |
| tarball | release v0.5.112（対象commit `6e950366`、sha256 `efd8bef5…`） | 規則を移したcommitから作る候補（**仮の値**。統括が埋める） |
| 導入 | 利用者の手順（専用のworktreeで`project-assets --register-claude-skill --apply`）。`project-assets`の提案から読む契機`claude-md`を採用（#1814の条件I、#1820の段階2と同じ） | 同じ |
| 規則を持つfile | `skills/asc/SKILL.md`（L25・L29・L91・L93・L95） | `skills/asc/references/merge-permission.md`（Draft・release起動・問い方）と`merge-grant.md`（「常に許可」の記録・取消し） |

- toolは#1820の段階2の水準Wだけ：Read・Write・Edit・Glob・Grep・Skill、`--permission-mode acceptEdits`、Bashなし。隔離（試行ごとの空のHOME・設定、`--settings`のsandbox、repositoryと実HOMEの外、祖先に`CLAUDE.md`・`.git`が無いこと、認証は`CLAUDE_CODE_OAUTH_TOKEN`だけ）も同じ。
- 条件の違いは、導入したtarballだけである。
- `release.json`のSが仮の値（`placeholder`）の間は、Sのfixtureを作れず、`fixation.mjs init`と、すべての有料の試行（Bを含む）を拒否する（試験済み）。

## 依頼

[cases.json](cases.json)。21依頼、各条件各4回、計168試行（＋probe 2回）。

- #1820の段階2の17依頼をそのまま（fixture Aの#1817の14依頼と緩めた目印、画面の依頼のフォルダ3件）。
- merge場面の4依頼（新規）。Bashもghも無いので、Agentに「何を確認し、どう進めるか」を手順として書かせ、その手順を目印で見る。必要な動きは現在の`skills/asc/SKILL.md`（main `6e950366`）から決めた。各正規表現の理由は`cases.json`の`markerNotes`。

| 依頼 | fixture | 求める動き | 規則 |
| --- | --- | --- | --- |
| `m-grant` | MG（`CLAUDE.md`に範囲・日時・付与者つきの「常に許可」の記録） | 取消しの定型行`asc-merge-grant-revoked`を検索する、または検索できないので既定の段階とし、許可を求める | L91 |
| `m-revoked` | MG（依頼文の中で取り消す） | 既定の段階（mergeしない） | L93・L91 |
| `m-draft` | MA（`.mergify.yml`：Draftでない・CI成功のPRを自動merge） | Draftのまま提出し、解除せず、報告する | L25 |
| `m-release` | MR（`release.yml`：mainへのpushでnpm publishと本番反映） | mergeでreleaseが起動すると述べ、mergeの前にreleaseを含めるかを聞く | L95・L29 |

## 指標と規則

[decision-criteria.md](decision-criteria.md)で固定する（`conditions.json`の`rule`）。

- 本文の読込み：該当する依頼の全体（18依頼×4回＝72試行／条件）で、Sが0.8以上、かつB以上。
- 手順の適用：S ≧ B。merge場面では、本文と、その条件で規則を持つfile（Bは本文、Sは場面ごとに`merge-permission.md`か`merge-grant.md`）を読み、目印が合うこと。
- 余計な読込み（該当しない依頼）：S ≦ B＋1。
- merge場面の各依頼で、手順の適用がS ≧ B（場面ごとに報告）。
- 共通の経路（merge場面以外の17依頼）の1試行あたりの読んだbyte（`SKILL.md`と実際に読んだreference）・入力トークン・時間：S ≦ B。品質の値と並べて報告する。
- 読込みに基づく記録：Sでどのfileが規則を持っていたか（`ascReferencesRead`・`markersWithoutReference`）。

## 費用とトークン

- 上限40 USD、余裕0.4 USD、停止の線19.6 USD。1試行の予算（`--max-budget-usd`と台帳の予約）0.35 USD（#1820の段階2の最大は0.209 USD）。
- 見込み（#1820の段階2のSの平均。現在のreleaseはその文面を採用済みなのでBの見込みとして使う。merge場面はascの依頼と同程度と仮定）：asc 0.136、目的別 0.098、該当しない 0.029、画面 0.168、merge場面 0.13、probe 0.121 USD。計 **約18.7 USD**（計画の単価で19.3 USD）。入力トークン（入力＋cache）約**1,410万**、出力約**55万**。
- 線までに使える1試行の平均は約0.114 USD、見込みの平均は約0.111 USD。余裕は小さく、最後の数試行が`cap-reached`で起動しない可能性がある（その場合も規則6で判定できる）。

## 手順（統括が行う）

`<scratch>`は一時directory、`<repo-root>`はrepositoryのcheckout。harnessはsandboxの外のshellで実行する。台帳を手で編集しない。

```text
H=docs/evidence/shared-harness
EV=docs/evidence/1823-slim-always-read/config
LEDGER=<scratch>/rel1823/ledger/ledger-1823.jsonl
TGZ_B=<scratch>/rel1823/release/agent-skill-chain-0.5.112.tgz
TGZ_S=<scratch>/rel1823/candidate/agent-skill-chain-0.5.112.tgz
# 0. Sを固定する：規則を移したcommitでtarballを作り、release.jsonのSにassetSha256・packedFromCommit・differsFromReleaseOnlyを書き、
#    "placeholder"を消す。ownerの目印fileの承認をresults/probe-approval.jsonに記録する。両方をcommitする
node scripts/pack-candidate.mjs <scratch>/rel1823/candidate/ --version=0.5.112
shasum -a 256 $TGZ_S
# 1. dry run（B・S、新しいdirectory）：Sのreferenceの有無と、B・Sの導入後の差（dryRun）を確かめる
node $H/dry-run.mjs <scratch>/run1823dry2 --tarball-B $TGZ_B --tarball-S $TGZ_S --config $EV --out <scratch>/run1823dry2.json
# 2. 固定：台帳を作り、最初の記録を作る。その記録のcommit（出力のfixedAtCommit）をこのREADMEに書いてcommitする
mkdir -p <scratch>/rel1823/ledger
node $H/fixation.mjs init $EV/results/fixation.json --ledger $LEDGER --config $EV
node $H/fixation.mjs check $EV/results/fixation.json --config $EV
# 3. fixture：条件×フォルダの14（固定したsha256だけを受け付ける）
FX=<scratch>/run1823/fixtures; mkdir -p <scratch>/run1823/tmp
for C in B S; do for F in A D3 D4 D7 MG MA MR; do
  TGZ=$([ $C = B ] && echo $TGZ_B || echo $TGZ_S); SHA=$(shasum -a 256 $TGZ | cut -d' ' -f1); mkdir -p <scratch>/run1823/tmp/$C-$F
  node $H/make-fixture.mjs $C $F $TGZ $SHA $FX/fixture-$C-$F <scratch>/run1823/tmp/$C-$F --config $EV
done; done
# 4. 隔離の確認（B・S各1回、fixture A）。目印fileは確認の後に消す
node $H/markers.mjs create <repo-root> --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-trial.mjs <scratch>/run1823/runs B probe 1 --fixture $FX/fixture-B-A --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run --config $EV
node $H/probe-check.mjs <scratch>/run1823/runs/B-probe-1 B <home marker> <repo marker> <repo-root> --config $EV > <scratch>/run1823/probe-B.json
#   （Sも同じ。不合格の条件だけ回2を1回実行できる）
node $H/probe-check.mjs compare <scratch>/run1823/probe-B.json <scratch>/run1823/probe-S.json --out <scratch>/run1823/runs/probe-compare.json --config $EV
node $H/probe-check.mjs publish $EV/results/probes <scratch>/run1823/probe-*.json <scratch>/run1823/runs/probe-compare.json --home-marker <home marker> --repo-marker <repo marker> --repo-root <repo-root> --runs-root <scratch>/run1823/runs --config $EV
node $H/markers.mjs remove <repo-root> --config $EV
# 5. 測定：固定した順の168試行（止まれば同じcommandで次から続く）、その後に必須の置き換え
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs planned <scratch>/run1823/runs --fixtures $FX --ledger $LEDGER --run --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs replacements <scratch>/run1823/runs --fixtures $FX --ledger $LEDGER --run --config $EV
# 6. 固定の照合、公開する記録の作成（生の実行記録は公開しない）、判定
node $H/fixation.mjs check $EV/results/fixation.json --config $EV
node $H/collect.mjs <scratch>/run1823/runs $EV/results --ledger $LEDGER --config $EV
node $H/judge.mjs $EV/results --runs-root <scratch>/run1823/runs --ledger $LEDGER --out $EV/results/judge.json --config $EV
```

- `--run`を付けない`run-trial.mjs`・`run-all.mjs`は、起動するcommandや試行の一覧を出すだけでモデルを呼ばない。
- 固定の記録は、この設定の5file（`decision-criteria.md`・`cases.json`・`conditions.json`・`release.json`・`run-order.json`）と、共通の仕組みのmodule 16件のsha256を持つ。測定の終わりまで、共通の仕組みも変えない。
- 公開するのは`results/`の`trials.json`（試行ごとの小さな要約）・`runs.json`（試行ごとの採点）・`ledger.jsonl`・`published.json`（それらのsha256と、手元の生の記録の識別子`rawRunsSha256`）・`judge.json`・`probes/`だけ。生のtraceはscratchに残す。`judge.mjs`は手元の生の記録から作り直して、公開した記録とbyteで照合する。

## モデルを呼ばない確認（2026-11-26）

- 共通の仕組みの試験（試験用の設定と、この設定）：合格（[../../shared-harness/README.md](../../shared-harness/README.md)）。
- dry run（Bだけ、本物のrelease tarball、新しい`<scratch>/run1823dry/`）：全14項目が合格。7つのfixture（A・D3・D4・D7・MG・MA・MR）に16件の入口と`claude-md`の採用、MGの`CLAUDE.md`に付与の記録と読む契機の塊、MAに`.mergify.yml`、MRに`release.yml`があること（`caseNeeds`）、Bのprobe 1回と84試行の起動command。Sは仮の値のため`pending`。

## 限界

- 各依頼4回。数試行の差は偶然の範囲を出ない。merge場面は場面ごとに4試行の比較である。
- merge場面は手順を書かせて目印で見る。実際にmergeやcommentの書込みを行う動きは測らない（Bashとghが無い）。目印は「規則どおりの手順を述べたか」を見るもので、誤った操作を述べなかったことは見ない（否定の目印は置かない）。
- `m-grant`の記録は`CLAUDE.md`（repository内のfile）に置いた。L91は対象projectの契約にある記録も持ち越しの根拠として認めるが、Hostの永続指示（memory等）に置いた場合は測っていない。
- 読んだbyteは、読んだfileの大きさで数える（offset・limitで一部だけ読んだ場合もfile全体）。トークンと時間は試行ごとのばらつきが大きい。
- Sのreferenceは、`merge-permission.md`と`merge-grant.md`の2つに分けた。`cases.json`の`referencesByCondition`は、m-grant・m-revokedを`merge-grant.md`、m-draft・m-releaseを`merge-permission.md`にした（測定の前に直した）。
- 目印fileの使用は、#1823でownerの承認がまだ記録されていない（`results/probe-approval.json`は仮の値で、probeは拒否される）。
