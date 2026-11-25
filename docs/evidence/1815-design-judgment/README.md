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

## 実行の手順

`<W>`はこのworktree、`<scratch>`はrepositoryとHOMEの外のdirectory。固定の記録：[results/fixation.json](results/fixation.json)（最初の記録のcommit：未記録。固定の後にここへ書く）。台帳：`<scratch>/rel1815/ledger/ledger.jsonl`。

```sh
cd <W>/docs/evidence/1815-design-judgment
node --test harness/harness.test.mjs
node harness/dry-run.mjs <B.tgz> <S.tgz> <scratch>/run1815-dry --out <scratch>/dry-run.json   # モデルを呼ばない
# 生成（18試行。順はconditions.jsonのorder。1つずつ）
ASC1815_ALLOW_PAID=1 CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" \
  node harness/run-trial.mjs <scratch>/runs ui03-dashboard B 1 --tarball <B.tgz> --ledger <scratch>/rel1815/ledger/ledger.jsonl --run
# 描画と指標（case ごと、--network none）
node harness/run-indicators.mjs <scratch>/runs ui03-dashboard <scratch>/render
# 盲検（2回分）。keysは評価者に渡さない
node harness/make-blind.mjs <scratch>/runs <scratch>/render 1 <scratch>/blind <scratch>/keys
node harness/budget.mjs reserve <scratch>/rel1815/ledger/ledger.jsonl rank-fable-1   # Fableの前に予約、後で settle
# 順位：host-sessionで Fable・Codex に harness/rank-prompt.txt を渡し、<scratch>/ranks/<fable|codex>-<1|2>.json に保存
node harness/decide.mjs <scratch>/runs <scratch>/render <scratch>/ranks <scratch>/decision.json
node harness/collect.mjs <scratch>/runs <scratch>/render results/run
```

tokenは親processの環境変数`CLAUDE_CODE_OAUTH_TOKEN`からだけ受け取り、harnessはfileを読まず、値を表示しない。子processの環境（HOME・config・PATH・DOCKER_HOSTとtoken等の固定の一覧）だけに渡し、trace・stderrでは置き換え、試行の後に子のHOME・configを検索して件数だけを記録してから削除する。

### 必要なDocker image

- `asc-1807-tools:1`（MCP server・描画・判定）：**このmachineに無い**。#1807の`env/Dockerfile`の`tools`段階から作る（Playwright公式imageのpull、aptの書体の取得でnetworkを使う。#1807でownerが承認した操作）。作るまで生成も描画もできない。
- `node:22-alpine`（proxy）：あり。

全てのcontainerは`--pull never`で起動し、試行の途中でimageを取りに行かない。

## 準備の段階の確認（モデルを呼ばない）

| 確認 | 結果 |
| --- | --- |
| harnessの試験（[results/harness-tests.txt](results/harness-tests.txt)） | 24件すべて合格 |
| dry run（[results/dry-run.json](results/dry-run.json)） | 組合せの受理と拒否（他方の条件のtarball・固定されていないtarballを`run-trial.mjs`が拒否）、tarballの差が3fileだけ、3ケース×2条件のsample projectの導入と差、空のHOMEでのdocker CLI、networkの作成と削除：合格。imageの有無：`asc-1807-tools:1`が無い |
| 初期表示の判定器（[results/first-view-dryrun.txt](results/first-view-dryrun.txt)） | #1807の合成の画面（良い例・悪い例）と、閉じた`details`・非表示・画面外の要素を含む合成の画面（[harness/dryrun/ui07-hidden.html](harness/dryrun/ui07-hidden.html)）で、期待どおりに判定した。ただし実行はhostのplaywright-core 1.60.0で、本番のimage（1.49.1）ではない |

試行あたりの費用の見込みは0.25〜0.6 USD（#1807の手順の指示なし0.15〜0.20、2案と両幅の描画を指示した条件0.28〜0.50、ASCの本文とreferenceの読込みで増える）。18試行で約4.5〜11 USD、Fableの順位2回で約4〜6 USD、合計で約8.5〜17 USD。最悪（全試行が予算1.5 USDで停止、Fableが予約額4 USD）でも35 USDで、停止線38 USD（上限40−余裕2）の内に収まる。Codexの費用はHostで計算されず欠測になる（#1807と同じ）。

## #1807・#1814からの違い（意図したもの）

- 生成のfixtureを、repositoryのworktreeの配下（#1807）から、repositoryとHOMEの外へ移し、ASCをtarballから利用者の手順で導入した（#1814）。#1807では祖先の`CLAUDE.md`とmemoryが文脈に入り、ASCのSkillは`.claude/skills/`への複製だった。
- 設定の読込み元を`--setting-sources project`・hookの無効化（#1807）から、既定（userは空）・hookを無効にしない（#1814）へ変えた。利用者の状態に合わせた。導入されたsample projectにproject設定のhookは無い（dry run）。
- 認証を、hostの保管場所（#1807）から、`CLAUDE_CODE_OAUTH_TOKEN`だけで渡す方式（#1814）へ変えた。空のHOMEにはdockerのcontextが無いので、親のdocker contextから解決した`DOCKER_HOST`だけを子に渡す。
- 組込みtoolは#1807と同じ（Read・Write・Edit・Glob・Grep・Skill）。#1814のRead系だけの構成では画面を作れない。
- containerに`--pull never`とlabel `asc.evidence=1815`を付けた。
- 審美は、ownerの順位（#1807の計画）ではなく、Fable・Codexの2回ずつの順位（#1807の2回目と再採点の方式）。
- 指標に、初期表示の答え（両幅）と操作なしでは見えない必須情報を加えた（#1807はUI-07の狭幅・広幅の2項目だけ）。

#1807と#1814の既存のfileは変えていない。harnessはそれらを読み込んで使い（`core-steps.mjs`・`run-render.mjs`・`render.mjs`・`gold-check.mjs`・`env/`・`install-asc.mjs`・`guard.mjs`・`ledger.mjs`・`collect.mjs`）、固定の対象に含めた。

## 限界

[decision-criteria.md](decision-criteria.md)「限界」。特に、各条件3回で偶然の差を除き切れないこと、モデルの順位であって人の評価でないこと、3案を一括で入れたのでどれが効いたかは分からないこと。

## 未決

- `asc-1807-tools:1`のimageを作る操作（networkを使う）の実行。
- 測定の開始（有料）は、ownerの許可を得てから。
