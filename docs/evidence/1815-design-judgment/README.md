# デザイン判断の取込み候補の評価（#1815）

開発時の検証資料であり、配布対象に含めない。

**結果：未測定**（モデルは一度も呼んでいない。この資料は測定の準備と、測る前に固定した規則である）。

## 目的

外部のデザイン判断Skillから選んだ上位3案（両幅の初期表示の確認、判断の一文から情報の優先順位と密度を決める、意匠が未定のときだけ2案を描画して比べる）を、ASCの既存のSkillへ追記した版（S）が、現状のASC（B）より、題材と利用目的に合った画面を作らせるかを測る。ASCのSkillが読まれる状態（#1814の条件I）で比べる。効果が無ければ取り込まない。

## ownerの判断

[Issue #1815のコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1815#issuecomment-7159922599)（2026-11-25）：

- 審美：Fable・Codexの盲検の順位を各2回、採点の再現性を記録。測れる指標を併用し、両方が同じ向きのときだけ効果あり。
- 条件：条件I（現状）と、上位3案を既存のSkillへ追記した版。UI-03を含む3ケース×各3回。
- 費用の上限：40 USD。
- 配布するSkill本文には外部Skillへのリンクを載せない（Sの追記はリンクを含まない）。

2026-11-25の会話でのownerの承認（統括の記録）：

- 判定の規則の水準を、[decision-criteria.md](decision-criteria.md)のとおり承認：両評価者のU≥8/9、再現性0.5未満の評価者はそのケースで除外、効果ありが3ケース中2以上、害0、費用の中央値の比3以下、Sの3試行中2以上で本文とreferenceが読まれなければ未判定。
- 描画用のimage `asc-1807-tools:1`の作成を承認。統括が#1807の`env/Dockerfile`（`tools`段階）から作った。image id `sha256:03213dc6…fcb8`を[conditions.json](conditions.json)の`images`に固定した。

## 条件と作り方

| 条件 | 導入するASC | 固定 |
| --- | --- | --- |
| B | release v0.5.109（target `af2ab12e`）のtarball | sha256 `05901c4b…9a4f`。SHA256SUMSとGitHubのasset digestに一致 |
| S | 候補のtarball。このbranchのcommit `c997f274`で`node scripts/pack-candidate.mjs <新しいdirectory> --version=0.5.109` | sha256 `12c6e2c9…32ba`。別のdirectoryへの2回目のpackも同じsha256 |

両tarballを展開して比べ、違うのは`package/release-identity.json`、`package/skills/asc/references/implementation.md`、`package/skills/user-journey-acceptance/references/journeys.md`の3つだけだった。2つのreferenceは、`af2ab12e`と`c997f274`のgit上のfileとbyte単位で一致した（[release.json](release.json)の`differsOnly`）。

試行ごとに、新しいsample projectを作る（[harness/make-sample.mjs](harness/make-sample.mjs)）：

1. repositoryと実際のHOMEの外に、祖先に`CLAUDE.md`・`AGENTS.md`・`.claude`・`.git`等の無いdirectoryを作る（#1814 `guard.mjs`）。
2. ケースの`BRIEF.md`・`data.json`と`FONTS.md`を置き、Gitで初期commitする。`CLAUDE.md`は置かない（#1807のfixtureと同じ）。
3. 専用のworktreeで、条件のtarballから`npm install --offline`→`project-assets --register-claude-skill --apply --adopt-read-trigger claude-md@…`で導入し、commitしてmainへfast-forwardする（#1814 `install-asc.mjs`。利用者の手順と同じ）。`project-assets`が`CLAUDE.md`を作り、案内文のblockを入れる。
4. 空の`out/`を作る。

`run-trial.mjs`は、渡されたtarballのsha256が条件に固定したものでなければ（他方の条件のもの、固定されていないもの）起動しない。導入後に、2つのreferenceの2つの写し（`skills/`・`managed-runtime/skills/`）のhashが条件の値と違う場合、`CLAUDE.md`にblockが無い場合も起動しない。dry runで、BとSのsample projectの違いが、2つのreferenceの2つの写しと、それらのhashを記録した`distribution.json`だけであること、`CLAUDE.md`が両条件で同じであることを確かめた。

生成の環境は#1807と同じ：hostの`claude -p`（`sonnet`、組込みtoolは`Read,Write,Edit,Glob,Grep,Skill`、`acceptEdits`）と、CLIが使い捨てのcontainerとして起動するMCP server `browser`（`fetch_page`・`view_page`・`screenshot`）。containerは内部専用のnetworkにあり、外への経路はallowlistのproxyだけ（#1807 `env/`をそのまま使う）。依頼文は#1807の手順を指示しない`env/gen-prompt.txt`で、両条件・全ケースで同じ。隔離は#1814と同じ：試行ごとに空のHOMEと`CLAUDE_CONFIG_DIR`（試行の後に削除）、設定の読込み元は既定（userは空）。

## ケース

[cases.json](cases.json)。#1807でgold・2幅の描画・browser環境がそろい、既存のdesign systemが無い3ケース。

| ケース | 選んだ理由 | 初期表示の答え（cases.json `firstView`） |
| --- | --- | --- |
| UI-03 出荷監視dashboard（800/1440） | ownerの指定。#1807で手順を指示した条件だけが上位だった。監視画面で、密度と構成の段落が当たる | しきい値超えのKPI・レーンと、取得失敗のデータ源 |
| UI-07 バス停の発車案内（390/1440） | #1807で、手順の指示が無い条件は全試行が狭幅だけを確認した。表示幅の段落が直接当たる | バス停名、お知らせ、各のりばの次の便の時刻、遅れの分数、運休、のりば |
| UI-04 部品の検索（390/1440） | 比較・入力の画面で、PCとスマートフォンで求める初期表示が違う | 検索欄、件数、先頭の部品の品番と在庫（広幅は納期等の詳細も） |

除外：UI-02（goldとbrowser環境が無く、答えを決定論で定められない）、UI-08（既存のdesign systemの上で、候補の段落を適用しない場面）、UI-10（画面が無い）。

## 指標・順位・判定の規則

[decision-criteria.md](decision-criteria.md)に固定した。要点：

- **指標**：I1＝狭幅・広幅の初期表示（scroll無し）に依頼の問いへの答えがすべて見える幅の数（[harness/first-view.mjs](harness/first-view.mjs)、#1807の描画image）。I2＝操作しないと見えない必須情報の数。非劣化は#1807と同じ。生成Agentが両幅を描画したか・2案を描画したか（#1807 `core-steps.mjs`）と、本文・`implementation.md`・`journeys.md`を読んだか（[harness/reads.mjs](harness/reads.mjs)）は試行ごとに記録する。
- **順位**：ケースごとに6画面を盲検にし（IDと見る順は回ごとに変える）、Fable・Codexが独立に2回ずつ順位を付ける。2回の平均で、SがBより上の組が9組中8以上なら「改善」。2回の相関が0.5未満の評価者は、そのケースで根拠に使わない。
- **判定**：ケースごとに、候補の文がSの2試行以上で読まれ、両評価者が「改善」、指標が悪くなく、非劣化の失敗が無ければ「効果あり」。2ケース以上で効果があり、害が無く、費用の比が3以下なら取り込む。読まれた試行が足りないケースは「未判定」とし、効果の判定から分けて数える。
- **実行の順と置換え**：[run-order.json](run-order.json)で固定（反復が外側、UI-03→UI-07→UI-04、奇数回B→S・偶数回S→B）。[harness/run-all.mjs](harness/run-all.mjs)だけがこの順で実行し、`run-trial.mjs`は順に合わない試行を拒否する。k番目の生成の失敗は番号3+kの試行で必ず置き換え、置換えは再び置き換えない。実行器と採点は同じ関数（[harness/order.mjs](harness/order.mjs)）で数える。
- **probeの回数**：各条件1回。1回目が判定済みで不合格の場合だけ再試行を1回。測定の予約が台帳にある後のprobeは拒否する。
- **名前の一致**：採点と盲検の作成の前に、台帳の測定の予約・試行のdirectory・採点が数える（置き換えた・使わないを含む）試行の名前が一致しなければ拒否する。予約した試行のdirectoryを消すと採点できない。
- **未判定になる場合**：計画の試行と必要な置換えが欠けたまま止まった（台帳で上限に達したと示せる場合を除く。ただし測定の開始後にprobeを予約していれば、この例外は使えない）、または有効な試行の無い条件・ケースがある。採点と盲検の作成は、固定の確認に失敗するか、試行の`meta.json`の固定の記録が今の記録と違えば拒否する。

## 隔離の確認（probe）

測定の前に、各条件1回、測定と同じ起動にdebugの記録を加えて行う（[harness/probe.mjs](harness/probe.mjs)。#1814の`probe-check.mjs`の方式を、生成のtoolとMCPがある構成に合わせた）。少なくとも次を確かめる：生成Agentの文脈に祖先の`CLAUDE.md`・ownerのmemory・ownerの設定とSkill・このrepositoryの指示が無い。実HOMEとこのrepositoryの目印fileのReadが拒否され、目印の文字列がどの記録にも無い。debugの記録の指示・memory・設定のpathが試行のdirectoryかprogramの場所だけ。hookが無い。B・Sでtool・Skillの一覧・gitの件名・modelが同じ。

目印fileは実HOMEとこのrepositoryのgit管理外の`.agent-skill-chain/local/`に一時的に置くので、ownerの確認が要る。**統括がownerの確認を`results/probe-approval.json`（`{"ownerConfirmed": true, "at": "...", "reference": "..."}`）に記録してcommitするまで、目印の作成とprobeの起動は拒否される。** 計画の試行は、両条件のprobeと比較が合格するまで拒否される。

## 実行の手順

`<W>`はこのworktree、`<scratch>`はrepositoryとHOMEの外のdirectory。固定の記録：[results/fixation.json](results/fixation.json)。最初の記録のcommitは`877f83728b29c7f622cad97a16e5fec0b2f2d3ff`、今の記録（測定に使う最後の記録）のcommitは下の「固定」に書く。台帳：`<scratch>/rel1815/ledger/ledger.jsonl`（予約なし）。

```sh
cd <W>/docs/evidence/1815-design-judgment
node --test harness/harness.test.mjs
node harness/dry-run.mjs <B.tgz> <S.tgz> <scratch>/run1815-dry --out <scratch>/dry-run.json   # モデルを呼ばない
L=<scratch>/rel1815/ledger/ledger.jsonl
# 0. 隔離の確認（results/probe-approval.jsonのcommitの後）
node harness/probe.mjs markers create <W> --ledger $L
for c in B S; do
  ASC1815_ALLOW_PAID=1 CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" node harness/run-trial.mjs <scratch>/runs probe $c 1 \
    --tarball <$c.tgz> --home-marker <home目印> --repo-marker <repo目印> --ledger $L --run
  node harness/probe.mjs check <scratch>/runs/probe/$c-r1 $c <home目印> <repo目印> <W>
done
node harness/probe.mjs compare <scratch>/runs/probe/B-r1/probe-check.json <scratch>/runs/probe/S-r1/probe-check.json --out <scratch>/runs/probe/compare.json
node harness/probe.mjs markers remove <W>
# 1. 生成（run-order.jsonの順だけ。止まったら同じcommandで続きから）
ASC1815_ALLOW_PAID=1 CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" node harness/run-all.mjs planned <scratch>/runs --tarball-B <B.tgz> --tarball-S <S.tgz> --ledger $L --run
ASC1815_ALLOW_PAID=1 CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" node harness/run-all.mjs replacements <scratch>/runs --tarball-B <B.tgz> --tarball-S <S.tgz> --ledger $L --run
# 2. 描画と指標（caseごと、--network none、固定したimage idだけ）
node harness/run-indicators.mjs <scratch>/runs ui03-dashboard <scratch>/render
# 3. 盲検（2回分）。keysは評価者に渡さない
node harness/make-blind.mjs <scratch>/runs <scratch>/render 1 <scratch>/blind <scratch>/keys $L
node harness/budget.mjs reserve $L rank-fable-1   # Fableの前に予約、後で settle
# 順位：host-sessionで Fable・Codex に harness/rank-prompt.txt を渡し、<scratch>/ranks/<fable|codex>-<1|2>.json に保存
node harness/decide.mjs <scratch>/runs <scratch>/render <scratch>/ranks <scratch>/decision.json --ledger $L
node harness/collect.mjs <scratch>/runs <scratch>/render results/run
```

### 中断からの再開

- **拒否で止まった**（上限・順・固定等）：`run-trial.mjs`は予約の前に止まるので、理由を直してから同じ`run-all.mjs`のcommandを実行する。予約済みの試行は飛ばされ、次の試行から続く。
- **モデルの実行中にCtrl-Cやkillで止まった**：予約は台帳に残り（予算額で数える）、lock file（`$L.lock`）が残る。次の順で戻す。
  1. 実行中の`run-all.mjs`・`run-trial.mjs`・`claude`のprocessが無いことを確かめる（`ps`で確認。lock fileの中身は止まったprocessのpid）。
  2. その試行のcontainerとnetworkを消す：`docker rm -f -v <prefix>-mcp <prefix>-proxy`、`docker network rm <prefix>-gen <prefix>-egress`（prefixは`asc1815-<ui03|ui07|ui04>-<b|s>-r<n>`。label `asc.evidence=1815`で一覧できる）。
  3. 試行のdirectoryの`home/`と`config/`（認証の情報を含み得る）だけを消す。**試行のdirectory自体は消さない。** `meta.json`の無い試行は生成の失敗として数えられ、計画の後に番号3+kの試行で置き換えられる。directoryを消すと、台帳の予約と合わず、採点が拒否される。
  4. lock file `$L.lock`だけを消す。台帳の行は消さない・書き換えない。
  5. 同じ`run-all.mjs planned`（計画の後なら`replacements`）のcommandで続ける。
- probeの実行中に止まった場合も1〜4は同じ。そのprobeの目印をまだ消していなければ、`probe.mjs check`で判定する（traceの欠けたprobeは不合格になる）。判定済みで不合格なので、その条件の再試行を1回だけ行える。再試行も止まった・不合格なら、その条件は測定しない。

tokenは親processの環境変数`CLAUDE_CODE_OAUTH_TOKEN`からだけ受け取り、harnessはfileを読まず、値を表示しない。子processの環境（HOME・config・PATH・DOCKER_HOSTとtoken等の固定の一覧）だけに渡し、trace・stderr・debug・proxyの記録では置き換え、試行の後に子のHOME・configを検索して件数だけを記録してから削除する。containerがmountする#1807の`env/`のfileは試行のdirectoryへ写して使い（byteで照合）、MCPの設定とdebugの記録にrepositoryのpathが出ないようにした。

### Docker image

| image | 固定したid | このmachine |
| --- | --- | --- |
| `asc-1807-tools:1`（MCP server・描画・判定） | `sha256:03213dc6d4b230f35252f8077c5a5407d1d7c40cec2fb81d5e971103b750fcb8` | あり（統括が2026-11-25に作成。playwright-core 1.49.1・axe-core 4.10.2のtgzはregistryのsha512と一致） |
| `node:22-alpine`（proxy） | `sha256:8049382e2048cff27289992d304206b4208b5b4f5110a19a5dbe21c18a0b8603` | あり |

`run-trial.mjs`・`run-indicators.mjs`は、localのimageのidが固定のidと違えば起動しない。全てのcontainerは`--pull never`で起動する。

## 準備の段階の確認（モデルを呼ばない）

| 確認 | 結果 |
| --- | --- |
| harnessの試験（[results/harness-tests.txt](results/harness-tests.txt)） | 34件すべて合格 |
| dry run（[results/dry-run.json](results/dry-run.json)） | すべて合格：組合せの受理と拒否、tarballの差が3fileだけ、3ケース×2条件のsample projectの導入と差、imageのidが固定と一致、空のHOMEでのdocker CLI、networkの作成と削除、imageでの判定（下）、`run-all.mjs`が固定の順の18試行だけを出す、`run-order.json`の妥当性 |
| imageでの判定（dry runの`imageChecks`） | 固定のimageで、#1807の`run-render.mjs`（描画・axe・gold）と`first-view.mjs`を合成の画面に実行。UI-07・UI-04の良い例は両幅でI1を満たし網羅率1.0、悪い例は満たさない。閉じた`details`・非表示・画面外の要素を含む合成の画面（[harness/dryrun/ui07-hidden.html](harness/dryrun/ui07-hidden.html)）では、閉じた`details`の中のお知らせを初期表示に無いと判定し、I2に数えた。描画の失敗0件 |
| 初期表示の判定器のhostでの確認（[results/first-view-dryrun.txt](results/first-view-dryrun.txt)） | 上と同じ判定（hostのplaywright-core 1.60.0。imageが無かった時点の記録） |

注：#1807の`gold-check.mjs`の`firstViewportMissing`は、閉じた`details`の中の文字も見えるものとして数える（ui07-hiddenで欠けを検出しない）。#1815の判定はfirst-view.mjsのI1を使い、#1807のその項目は使わない。

試行あたりの費用の見込みは0.25〜0.6 USD（#1807の手順の指示なし0.15〜0.20、2案と両幅の描画を指示した条件0.28〜0.50、ASCの本文とreferenceの読込みで増える）。18試行で約4.5〜11 USD、probe 2回で約0.3〜0.6 USD、Fableの順位2回で約4〜6 USD、合計で約8.8〜17.4 USD。置換えの無い最悪（全試行が予算1.5 USD、probeが0.5 USD、Fableが予約額4 USD）は36 USDで、停止線38 USD（上限40−余裕2）の内。置換えが要る場合は、停止線で止まり、上限に達したことが台帳で示せれば、その時点の試行で判定する。Codexの費用はHostで計算されず欠測になる（#1807と同じ）。

## #1807・#1814からの違い（意図したもの）

- 生成のfixtureを、repositoryのworktreeの配下（#1807）から、repositoryとHOMEの外へ移し、ASCをtarballから利用者の手順で導入した（#1814）。#1807では祖先の`CLAUDE.md`とmemoryが文脈に入り、ASCのSkillは`.claude/skills/`への複製だった。
- 設定の読込み元を`--setting-sources project`・hookの無効化（#1807）から、既定（userは空）・hookを無効にしない（#1814）へ変えた。利用者の状態に合わせた。導入されたsample projectにproject設定のhookは無い（dry run）。
- 認証を、hostの保管場所（#1807）から、`CLAUDE_CODE_OAUTH_TOKEN`だけで渡す方式（#1814）へ変えた。空のHOMEにはdockerのcontextが無いので、親のdocker contextから解決した`DOCKER_HOST`だけを子に渡す。
- 組込みtoolは#1807と同じ（Read・Write・Edit・Glob・Grep・Skill）。#1814のRead系だけの構成では画面を作れない。
- containerに`--pull never`とlabel `asc.evidence=1815`を付け、imageのidを固定した。mountする`env/`は試行ごとの写し。
- 隔離の確認は#1814と同じ考え方で、toolとMCPの確認を加え、ownerの確認の記録を起動の条件にした。
- 審美は、ownerの順位（#1807の計画）ではなく、Fable・Codexの2回ずつの順位（#1807の2回目と再採点の方式）。
- 指標に、初期表示の答え（両幅）と操作なしでは見えない必須情報を加えた（#1807はUI-07の狭幅・広幅の2項目だけ）。

#1807と#1814の既存のfileは変えていない。harnessはそれらを読み込んで使い（`core-steps.mjs`・`run-render.mjs`・`render.mjs`・`gold-check.mjs`・`env/`・`install-asc.mjs`・`guard.mjs`・`ledger.mjs`・`collect.mjs`・`probe-check.mjs`の関数）、固定の対象に含めた。

## 限界

[decision-criteria.md](decision-criteria.md)「限界」に加えて：

- **候補の文とケースの適合**：Sの追記（両幅の初期表示の確認、判断の一文から優先順位と密度、方向が未定のときの2案）と、3ケースの選び方（2幅の要求があり、design systemが無い）と、指標（両幅の初期表示の答え）は、同じ考え方から作った。効果が出ても、この種の依頼に限った結果であり、選んだケースと指標が候補に合わせてあることを割り引いて読む。適用しない場面（既存のdesign systemの上、1幅だけの画面）での害は測っていない。
- **偶然**：各条件3回で、1ケース6画面である。差が無くても、1評価者あたり約0.1の確率でU≥8になる。2評価者・指標・2ケース以上を同時に求めて偶然の採用を減らしたが、除き切れない。逆に小さな効果は検出できない。
- モデルの順位であって人の評価でないこと、3案を一括で入れたのでどれが効いたかは分からないこと。

## 固定

最初の記録：`877f83728b29c7f622cad97a16e5fec0b2f2d3ff`（計画の初版）。今の記録（2件目、refix）：`ff3dba9eabdc03a3ae0477d1a2be730d2ee57dd0`（統括の指摘による測定前の是正。台帳に予約なし。独立レビューは未実施）。測定はこの記録で行う。

## 未決

- 隔離の確認（目印fileの一時的な作成）のownerの確認。統括が`results/probe-approval.json`に記録する。
- 独立レビュー。
- 測定の開始（有料）は、ownerの許可を得てから。
