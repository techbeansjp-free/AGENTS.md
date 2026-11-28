# デザイン評価の層1・層2の材料（#1835）

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。

[Issue #1835](https://github.com/techbeansjp-free/AGENTS.md/issues/1835)の「手段の案」のうち、層1（適合性の下限の機械判定）と層2（評価者の校正）の材料を、新たな生成なしで作る道具である。対象は#1804の生成物（`docs/evidence/1804-design-judgment/results/outputs/`のui02・ui03・ui08、4条件×3試行＝36件）。

（本番の前に書いた節。本番の結果は末尾の「本番の結果（2026-11-28）」にある。）この節の段階では、モデルを呼ばず、外部へも送信しなかった。評価の軸・層3の件数・SSRの扱いは、その後ownerが決め、計画は[EVAL_PLAN.md](EVAL_PLAN.md)に固定した（`91e8cbd0`、上限の変更は`b9b66638`）。

## 道具

#1852が、この道具に互換の変更（組の明示・方式ごとの束・`owner-page.mjs --config`）を加えた。#1835の設定での動作は変わらない（[1852-p-good-pairs](../1852-p-good-pairs/README.md)）。

| file | 内容 |
| --- | --- |
| `harness/degrade.mjs` | 1つの画面から、1か所だけを変えた劣化版と陰性対照を作る。乱数は使わない。`manifest.json`に、どの要素をどう変えたかを書く |
| `harness/html.mjs` | 依存の無い、静的なHTMLの走査。要素の位置（開始・終了のoffset）を求める |
| `harness/probe.mjs` | 元の画面を描画して、計算後の色と部品の位置を取る（container内）。結果は`config/page-probe.json`に固定する |
| `harness/browser.mjs` | probe・compareで共通の、画面の開き方（時計の固定、reduced motion、animation停止、外部要求の遮断） |
| `harness/compare.mjs` | 元の画面と各版の、全体screenshotのbyte比較（container内） |
| `harness/layer1.mjs` | 層1の記録の組立て（純粋な関数） |
| `harness/run-layer1.mjs` | host側。probe、または描画・初期表示の判定・比較をcontainerで実行し、`layer1.json`を出す |
| `harness/summarize.mjs` | `layer1.json`から、repositoryに置く小さな要約を作る |
| `harness/degrade.test.mjs` | `node --test`の試験 |
| `config/cases.json` | ケースごとの設定（描画の2幅、初期表示の項目、劣化を当てる要素の見つけ方） |
| `config/page-probe.json` | `probe.mjs`の結果（36件） |
| `results/layer1-trial.json` | 試行の結果の要約（下の「試行の結果」） |
| `harness/eval-common.mjs` | 層2・層3の道具の共通部分（設定、seed付きの乱数、PNGのmetadataの除去、組の一覧） |
| `harness/make-packets.mjs` | 評価者に渡す盲検の束と、対応表（key）を作る |
| `harness/run-eval.mjs` | 評価者（Fable・Codex）の呼出し、台帳、予算の停止、`--dry-run`、予算の見込み（`plan`） |
| `harness/ssr.mjs` | SSRの式（講評と基準文の類似度→5段階の確率→期待値）。本番で実行した`ssr.py`（embeddingを含む）から式だけを移した。下の「SSR」 |
| `harness/owner-page.mjs` | 層3でownerが比べる1枚のローカルHTMLと、その対応表 |
| `harness/aggregate.mjs` | 計画6・7節の指標と採否 |
| `harness/eval.test.mjs` | 上の道具の`node --test`の試験 |
| `config/eval.json` | 層2・層3の設定（画面・組・評価者・上限・出力とturnの上限・SSR） |
| `prompts/` | D・P・F講評・F採点の依頼文 |
| `anchors.json` | F採点とSSRの基準文（5段階×3組） |
| `negation-pairs.json` | 否定の反例（10対） |

### 再利用したものと、新しく書いた理由

| 用途 | 使ったもの | 扱い |
| --- | --- | --- |
| 描画・axe-core（WCAG 2.1 A/AA、両幅）・横scroll・screenshot | #1807 `harness/render.mjs` | 変更せず、containerに読取り専用で載せて実行する。#1804の`render-in-container.mjs`はimage `asc-1804-render:1`がこの環境に無いので使わない。#1807版は同じ指標を持ち、両幅でaxe-coreを走らせる |
| 答えの初期表示・操作しないと見えない必須項目 | #1815 `harness/first-view.mjs` | 変更せず実行する。ケースの設定は`first-view.mjs`の書式で渡す（ui03は#1815 `cases.json`の`ui03-dashboard`をそのまま読む）。正解の必須項目は#1804 `gold.json` |
| 時計の固定 | #1815 `harness/clock.mjs` | `browser.mjs`からimportする |
| image | `asc-1807-tools:1` | #1815 `conditions.json`に固定したimage idと一致しなければ、`run-layer1.mjs`が拒否する |

新しく書いた部分と理由：

- **`render.mjs`の幅**：`render.mjs`の幅の表（`VIEWPORTS`）は#1807のケースのkey（ui03・ui04・ui07）しか持たない。そこで、同じ2幅を持つkeyを借りる（`config/cases.json`の`renderAlias`。ui02→ui07、ui08→ui04）。ui08の広幅は、#1804の1280pxではなく1440pxになる。
- **`render.mjs`・`first-view.mjs`はCLIのscript**（top-levelのawaitで引数を読む）で、関数としてimportできない。そのため、subprocessとして実行する。
- **劣化版の生成・probe・比較・層1の組立て**は、既存のharnessに無い。
- **共通測定基盤（`docs/evidence/shared-harness/`）には置かなかった。** shared-harnessは、Skillの読込み・適用の測定の仕組みであり、画面の描画と劣化は扱わない。3層の手順を使い続けると決めた場合は、`shared-harness/README.md`からこのdirectoryへの参照を足す（[EVAL_PLAN.md](EVAL_PLAN.md)の9）。道具を移す（統合する）かは、別のIssueでownerが判断する。

## 使い方

```sh
cd docs/evidence/1835-design-eval-layers
P=<scratchのdirectory>/pages
node harness/degrade.mjs $P                                   # 36件×12版。manifest.jsonも出す
node harness/run-layer1.mjs probe $P --write-config           # 色と部品のprobe（約30秒）。config/page-probe.jsonを更新
node harness/degrade.mjs $P                                   # probeを使う版（contrast・inconsistency）を作り直す
node harness/run-layer1.mjs layer1 $P <scratch>/l1-ui03 --case ui03-dashboard --trial A-r1   # 1画面12版で約2〜7分
node harness/summarize.mjs results/layer1-trial.json <scratch>/l1-...
node --test harness/                                          # 静的な試験
ASC1835_DOCKER=1 ASC1835_LAYER1=<scratch>/l1-ui03 node --test harness/   # 描画の差の試験も含める
```

出力の配置は`<pages>/<case>/<trial>/<版>/index.html`である。ui08は、同じdirectoryに`tokens.css`・`components.css`（#1804 `cases/ui08-existing-ds/app/`）と`billing.css`（生成物）を置く。screenshot・`render.json`は、scratchの出力directoryにだけ残す。commitしない。

containerの条件は#1807・#1815と同じである：`--network none`、read-only root、`--cap-drop ALL`、`no-new-privileges`、資源上限、label `asc.worktree`・`asc.issue=1835`。

## 描画の2幅

依頼文の利用環境による。

| ケース | 広幅 | 狭幅 | 出典 |
| --- | --- | --- | --- |
| ui02 | 1440×900（desktop） | 390×844（mobile） | 依頼文「多くはスマートフォン。PCで見る人もいる」、#1804と同じ |
| ui03 | 1440×900（desktop） | 800×1280（tablet） | 依頼文「PC（幅1440px程度）とタブレット（幅800px程度）。スマートフォンは対象外」、#1815と同じ |
| ui08 | 1440×900（desktop） | 390×844（mobile） | 依頼文に幅の指定は無い。#1804は1280×800と390×844。`render.mjs`の幅の表の都合で広幅を1440にした |

ui03の狭幅は、依頼（desktopとmobileの2幅）と違い、tabletにした。依頼文が狭幅をtabletと定めるためである。

## 変換の定義

どの版も、元のHTMLの文字列を、決まった位置で書き換えて作る（静的な書換え）。scriptが実行時に作る要素は、静的なHTMLには無いので、移す・属性を変える対象にしない。CSSの規則は、実行時に作られた要素にも当たる。

### 群と版

| 版 | 群 | 変えるもの | 強度 |
| --- | --- | --- | --- |
| `contrast-strong` | 層1で検出され得る | 本文の文字色。`body`と`p,li,dd,dt,td,th,caption,label,figcaption,blockquote,address`の`color`を、背景に対するコントラスト比1.6になる色へ（`!important`の規則を1つ、最後の`<style>`の末尾に足す） | 強：1.6 |
| `contrast-weak` | 同上 | 同上 | 弱：3.2（WCAG AAの本文4.5は割るが、大きい文字の3.0は満たす） |
| `pushout` | 同上 | 依頼の必須情報を初期表示の外へ押し出す。対象の要素のinline styleに`margin-top`（ui03は`margin-bottom`）`120vh` | 1段階 |
| `hierarchy-strong` | 層1を通る | 依頼で最も重要な情報のまとまりを、最下段へ移す（要素の移動。script・footerより前） | 強：最下段 |
| `hierarchy-weak` | 同上 | 同じまとまりを1つ下へ移す（次の兄弟の後ろ。ui02で次の兄弟が`main`なら、`main`の最初の子の後ろ） | 弱：1つ下 |
| `spacing-strong` | 層1を通る | まとまりを壊す余白。見出し（ui08は項目名の`label`）のinline styleに`margin-bottom:128px` | 強：128px |
| `spacing-weak` | 同上 | 同上 | 弱：48px |
| `inconsistency-strong` | 層1を通る | 同じ役割の部品のうち2番目だけ、見た目を変える：角丸の反転（元が0なら12px、それ以外は0）、`inset`の枠3px（`currentColor`）、背景の色付け（`currentColor`の12%） | 強：3つ |
| `inconsistency-weak` | 同上 | 同上：角丸の反転と`inset`の枠1px | 弱：2つ。どちらも配置は動かさない |
| `control-attr-order` | 差の無い組 | 属性が2つ以上ある全ての開始tagで、属性の並びを逆にする（同名の属性を持つtagは除く。script・styleの中は変えない） | － |
| `control-whitespace` | 差の無い組 | 要素の間にある、改行を含む空白だけのtextを、1つの改行にする（`pre`・`textarea`・script・styleの中は除く） | － |

`contrast`の色は、`probe.mjs`が描画後に求めた「最も多くの文字が持つ（文字色、背景色）の組」から、文字色を背景色へsRGBで近づけ、二分法で目標の比にした色である（`degrade.mjs`の`colorAtRatio`）。背景色は、祖先の背景色を不透明なものまで合成した色で、背景画像は見ない。

`inconsistency`の部品は、`config/cases.json`の`peers`の候補のうち、描画後に3つ以上見えた最初のselectorで決める（`probe.mjs`）。2番目の部品は、idのある祖先からの`:nth-child`の経路で指す。経路が1つの要素だけに当たることを、probeで確かめた。

### ケースごとの対象（`config/cases.json`の`targets`）

| ケース | hierarchy（最も重要なまとまり） | pushout（押し出す要素） | spacing（見出し） | peers |
| --- | --- | --- | --- | --- |
| ui02 | 「9:30」を含む要素から上がり、「9:30」と「400」（観覧料）を両方含む最小のまとまり。無ければ「9:30」を含む最小のまとまり。最下段は`main`の最後。根拠：rubric.mdのUI-02「会期・開館・料金・予約」 | 「4月10日」（会期）を含む最小のまとまり。初期表示の項目は#1804 `gold.json`の`firstViewportMobile`（展覧会名・会期） | 「関連イベント」の`h2`・`h3` | `#events li`ほか |
| ui03 | idが`summary`・`attention`・`verdict`・`band`の要素（12件すべてにある、対処が必要なものの要約）。根拠：rubric.mdのUI-03「対処が必要なもの」 | 最初の`header`の後ろ（KPI・レーン・データ源が下へ出る）。初期表示の項目は#1815の`ui03-dashboard`（出荷遅延率・LANE-B01・LANE-C02・温度センサー） | 「KPI」「主要指標」「レーン別」の`h2` | `#kpis > *`（KPIのカード） |
| ui08 | 「請求先の名称」の`label`を含む項目（`div.field`）を、同じ部品の最後の後ろへ。根拠：rubric.mdのUI-08「入力と保存」のうち、最初の必須項目 | 同じ項目の前（全ての入力欄が下へ出る）。初期表示の項目は「名称」と入力欄 | 「メールアドレス」の`label` | `.field` |

「まとまり」は、`section`・`article`・`aside`・`div`・`dl`・`table`・`form`・`fieldset`・`ul`・`ol`・`header`・`footer`・`nav`・`figure`・`p`の要素で、親が2つ以上の要素を持つものである。`html`・`body`・`main`になる場合は対象にしない。

### 除外

変換できない版は、理由を`manifest.json`の`excluded`に書いて除く（`degrade.mjs`の`Excluded`）。理由の例：対象が静的なHTMLに無い、既に最下段にある、probeが無い、変更が生じない。

今回の36件では、**除外は0件**だった（36件×11版＝396版をすべて作った。元の画面を含め432件）。ただし、probeの前は`contrast`・`inconsistency`の144版が「probeが無い」で除外され、作り直して0件になった。ui02の3件（A-r2・A-r3・D-r2）では、「9:30」と観覧料を両方含むまとまりが無く、「9:30」だけを含むまとまり（会期と開館時間の段落`p.when`）を移した。

## 層1の判定（暫定）

`harness/layer1.mjs`。判定の項目は、Issueの層1の例（答えが初期表示にある、横scrollが無い、axeの違反が無い）を、既存の測定で機械的に読んだものである。**合格は「使いやすい」ことを意味しない。不合格は、この限られた範囲での反証として扱う。**

| 項目 | 合格の条件 | 出典 |
| --- | --- | --- |
| `answerInitialView` | 両幅で、初期表示の項目が全て見え、指定の要素が範囲内にある | #1815 `first-view.mjs`の`answerAll` |
| `noOverflowX` | 両幅で横scrollが無い | #1807 `render.mjs`の`overflowX` |
| `axeNoSeriousCritical` | 両幅で、axe-coreのimpactがserious・criticalのnodeが0 | #1807 `render.mjs`の`axeSeriousCritical` |
| `noExternalRequests` | 画面のdirectoryの外への要求が0 | `render.mjs`・`first-view.mjs` |

判定に使わずに記録するもの：#1804 `gold.json`の必須項目の網羅率（広幅の本文）、操作しないと見えない必須項目（`hiddenRequired`）、axeの`color-contrast`のnode数、pageのエラー。各版では、元の画面で合格していて版で不合格になった項目と、`color-contrast`のnodeの増加を`newFailures`に書く。元の画面が既に不合格の項目は、版の効果と分けて読む。

描画の差：`compare.mjs`は、両幅で元の画面を2回、各版を1回撮り、PNGのbyteを比べる。元の画面の2回が一致したとき（`baselineEqual`）だけ、差の有無を読む。

## 試行の結果

各ケースのA-r1（条件A、1回目）に加え、ui02のA-r2（hierarchyが会期の段落`p.when`を移す画面）とB-r2（本文の組が暗い背景の画面）の、計5画面で12版（元の画面と11版）を描画した（2026-11-27、`asc-1807-tools:1`）。生成の失敗・描画の失敗・除外は0件。5画面とも、元の画面を2回撮ったpixelは両幅で一致した。結果は[results/layer1-trial.json](results/layer1-trial.json)。

表は、層1の合否（○＝合格、×＝不合格）と、元の画面で合格していて版で不合格になった項目である。「差」は両幅とも元とpixelが違うこと、「同」は両幅とも同じこと。

| 版 | ui02 A-r1 | ui02 A-r2 | ui02 B-r2 | ui03 A-r1 | ui08 A-r1 |
| --- | --- | --- | --- | --- | --- |
| 元の画面 | ○ | ○ | ○ | ○ | ○ |
| contrast-strong | ×axe（color-contrast +57・+57）差 | ×axe（+62・+62）差 | ×axe（+20・+20）差 | ×axe（+64・+46）差 | ×axe（+10・+10）差 |
| contrast-weak | ×axe（+52・+52）差 | ×axe（+61・+61）差 | ×axe（+57・+57）差 | ×axe（+60・+42）差 | ×axe（+9・+9）差 |
| pushout | ×初期表示 差 | ×初期表示 差 | ×初期表示 差 | ×初期表示 差 | ×初期表示 差 |
| hierarchy-strong | ○ 差 | ○ 差 | ○ 差 | ○ 差 | ×初期表示 差 |
| hierarchy-weak | ○ 差 | ○ 差 | ○ 差 | ○ 差 | ○ 差 |
| spacing-strong | ○ 差 | ○ 差 | ○ 差 | ○ 差 | ○ 差 |
| spacing-weak | ○ 差 | ○ 差 | ○ 差 | ○ 差 | ○ 差 |
| inconsistency-strong | ○ 差 | ○ 差 | ×axe（+1・+1）差 | ○ 差 | ○ 差 |
| inconsistency-weak | ○ 差 | ○ 差 | ○ 差 | ○ 差 | ○ 差 |
| control-attr-order | ○ 同 | ○ 同 | ○ 同 | ○ 同 | ○ 同 |
| control-whitespace | ○ 同 | ○ 同 | ○ 同 | ○ 同 | ○ 同 |

axeの括弧は（広幅・狭幅）のcolor-contrastのnodeの増加。描画の時間は1画面12版で115〜436秒（ui02 A-r1が最長）。

読み取れること：

- 「層1で検出され得る」群（contrast・pushout）は、5画面の全てで層1の不合格になった。強・弱のどちらも不合格で、層1では強度の差は出ない（強度は層2で使う）。
- 「層1を通る」群は、25版中23版が層1を通った。例外は2版である。
  - ui08のhierarchy-strong：移した項目（請求先の名称）が、初期表示の項目そのものだった。ui08では、hierarchyの対象と初期表示の項目が重なる。
  - ui02 B-r2のinconsistency-strong：背景の色付けで、その部品の文字のコントラストが基準を割った。
- 陰性対照は、5画面の両幅で元とpixelが同じだった。劣化版は全て、両幅で元とpixelが違った（変換が見た目を変えなかった版は0）。
- 元の画面のui02 A-r1は、#1804 `gold.json`の網羅率が0.885だった（#1804の記録どおり、goldの不備による）。判定の項目ではない。

目視で確かめた画面（scratchのscreenshot。commitしない）：ui03 A-r1のhierarchy-strong（要約が最下段）、inconsistency-strong（2番目のKPIだけ灰色の背景と黒い枠）、ui08 A-r1のspacing-strong（メールアドレスの項目名と入力欄が離れる）、inconsistency-strong（2番目の項目だけに枠）。

## 試験

`node --test harness/`（静的、約15秒）：

1. 36件が見つかる。
2. 全ての版が、作られたか、理由付きで除外されている（黙って落とさない）。
3. 決定性：2回の生成が同じbyteになる。
4. 1か所だけが変わる（contrast・pushout・spacing・inconsistency）：元との差が1つの挿入（と、拡張したstyle属性）だけで、styleの他のtagを足していない。
5. hierarchyは1つの要素を移すだけ：移した要素を両方から取り除くと同じ文字列になり、要素は1回だけ現れる。
6. 陰性対照は、tag・属性（順序を除く）・文字が元と同じ。
7. コントラストの目標色の計算。
8. 対象が無い場合とprobeが無い場合に、版を作らず除外する。
9. 描画（`ASC1835_DOCKER=1`と`ASC1835_LAYER1`がある場合だけ）：陰性対照は両幅で元と同じpixel、劣化版は元の2回の撮影が一致した幅で元と違うpixel。

実行の結果（2026-11-27、Node.js 20.12.2）：静的な試験は8件合格・1件skip（描画の試験）。`ASC1835_DOCKER=1`で、上の5画面の`layer1.json`それぞれを渡すと、9件すべて合格した。描画の試験は、`run-layer1.mjs layer1`が出した`layer1.json`を読む。試験の中でcontainerを起動はしない。

## 未確認事項・判断に迷った点

- **層2の画面の数**：Issueの手段の案は「3ケース×元・弱・強の9画面と差の無い組」である。この道具は、全36件×11版を作れる。評価に使う画面（どの試行・どの版か）は、計画の固定で決める。
- **層1を通る劣化が、実際に層1を通るか**は画面による。ui02では、開館時間と観覧料のまとまりが会期も含むことがあり、hierarchyが初期表示の判定で不合格になり得る（試行の結果を参照）。群は「意図」で、実際の合否は`layer1.json`で読む。
- **微妙な劣化が、元の画面によっては改善になり得る**（Issueの協議の3回目）。依頼文の要求に照らして悪いと言えるものに限ったが、ui08のhierarchy（最初の必須項目を最後へ）と、spacingの見出しの余白は、起票者・ownerの確認を経ていない。
- **contrastの「本文」**：最も多くの文字が持つ色の組を本文とした。ui02の3件（B-r2・D-r3・E-r2）とui03 D-r3では、その組が暗い背景に白い文字だった。この場合、明るい背景の部分の本文は、目標の比より低いコントラストになる。ui08では、最も多いのは補足（`field__hint`）の灰色だった。入力欄の文字はtext nodeでないので数えていない。
- **inconsistencyの見た目**：枠と角丸を、元に枠や背景が無い部品（ui08の`.field`、ui02の`li`）にも付ける。ui08では`.field`に内側の余白が無いので、枠が入力欄に重なり、部品の不統一というより描画の崩れに見える。ui03では、2番目のKPIの灰色の背景と黒い枠が、状態（選択・強調）の表示と読まれ得る。「同じ役割の部品の不統一」として妥当かは、未確認。強ではコントラストの基準割れが起き得る（ui02 B-r2）。
- **ui08のhierarchyと初期表示の重なり**：最初の必須項目を動かすと、初期表示の項目（名称）も動く。層1を通る劣化として使うなら、初期表示の項目か対象を変える必要がある。
- **描画の条件の違い**：`render.mjs`（axe・横scroll）は時計を固定せず、`reducedMotion: no-preference`で描画する。`first-view.mjs`・`probe.mjs`・`compare.mjs`は時計を`fixedNow`に固定する。ui02・ui08の`fixedNow`（2027-03-20、2027-03-08）は、この作業で決めた値で、依頼文に根拠は無い。
- **source（HTML）を読む評価者への漏れ**：劣化はinline styleや`<style>`の末尾の規則で、commentは付けない。それでも、HTMLを読めば変更箇所を推定できる。層2の評価者には、画面（screenshot）だけを渡す想定である。何を渡すかは計画の固定で決める。
- **ui08の幅**：広幅を#1804と違う1440pxにした（上の「描画の2幅」）。
- **全36件の描画は行っていない。** 描画したのは5画面である（1画面12版で約2〜7分。36件で2時間程度と見込む）。劣化版の生成（36件×11版）と、probe（36件）は全件で行った。

## 層2・層3の評価の道具

[EVAL_PLAN.md](EVAL_PLAN.md)の3〜8節を実行する道具である。この節は本番の前に書いた。本番で使った値（上限30 USD・見込みの線28 USD）と結果は、末尾の「本番の結果（2026-11-28）」にある。

### 使い方

```sh
cd docs/evidence/1835-design-eval-layers
R=<scratch>/1835-render         # run-layer1.mjs layer1 の出力（l1-<case>-<trial>/）。A-r1・D-r1・E-r1 の3ケース分
O=<scratch>/1835-eval/<名前>     # 新しいdirectory。commitしない
V=<scratch>/1835-embed           # fastembedのvenvとcache
# 1. 盲検の束と対応表。seedは記録する
node harness/make-packets.mjs --render-root $R --out $O --seed <seed>
# 2. 層3のownerのページ（評価者の結果を見る前に記録してもらう）
node harness/owner-page.mjs --render-root $R --out $O/owner --seed <別のseed>
# 3. 全経路の確認（モデルを呼ばない）
node harness/run-eval.mjs run --packets $O/packets --runs $O/dry --evaluator fable --dry-run
# 4. 本番の前の試行（計画5節の1）：Fableで P 1組、F 1画面（講評と採点）、D 1ケース。--onlyに束のIDを並べる
ASC1835_ALLOW_PAID=1 node harness/run-eval.mjs run --packets $O/packets --runs $O/trial --evaluator fable --methods D,P,Fc,Fs --rounds 1 --only <D束>,<P束>,<F束>
# 5. 予算の見込みと削り方（計画5節の2）。見込みの線（config/eval.jsonのprojectionLimitUsd。本番は28 USD）を超えれば、Dを外す→contrast-strongを外す→止める、の順に決める
node harness/run-eval.mjs plan --packets $O/packets --key $O/key/key.json --per-call D=..,P=..,Fc=..,Fs=..,Neg=.. --prior-ledger $O/trial/ledger.jsonl --skip-out $O/skip.txt
# 6. 本番（評価者ごと。Dを外すなら --methods P,Fc,Fs,Neg）。Codexは読取りを限定しないので、keyとownerの対応表を--lockで閉じる
ASC1835_ALLOW_PAID=1 node harness/run-eval.mjs run --packets $O/packets --runs $O/runs --evaluator fable --skip-packets $O/skip.txt --prior-ledger $O/trial/ledger.jsonl --lock $O/key --lock $O/owner
ASC1835_ALLOW_PAID=1 node harness/run-eval.mjs run --packets $O/packets --runs $O/runs --evaluator codex --skip-packets $O/skip.txt --lock $O/key --lock $O/owner
# 7. SSRと集計
node harness/aggregate.mjs critiques --runs $O/runs --out $O/critiques.jsonl
# 本番では harness/ssr.py（3d4c31f7の版）として、このdirectoryで実行した。今はrepositoryに置かない（下の「SSR」）。
# 再現するときは、Git historyから同じ配置（<写し>/harness/ssr.py と <写し>/config/eval.json）に取り出し、sha256を照合する
$V/venv/bin/python -I <写し>/harness/ssr.py score --anchors anchors.json --in $O/critiques.jsonl --cache-dir $V/cache --out $O/ssr.json
$V/venv/bin/python -I <写し>/harness/ssr.py negation --anchors anchors.json --pairs negation-pairs.json --cache-dir $V/cache --out $O/ssr-negation.json
node harness/aggregate.mjs decide --key $O/key/key.json --runs $O/runs --out $O/result.json --layer1 $R/l1-<case>-<trial>/layer1.json ... \
  --owner <ownerのJSON> --owner-key $O/owner-key/owner-key.json --ssr $O/ssr.json --ssr-negation $O/ssr-negation.json --skip-packets $O/skip.txt
```

### 束（`make-packets.mjs`）

- 束はP（組ごと）・F（画面ごと）・D（ケースごと）の独立なdirectoryで、中身は`BRIEF.md`（#1804 `cases/`の依頼文そのまま）、`TASK.json`（見るID。PはAとB、Dは群ごとの表示順、Fは1画面）、`shots/<ID>-narrow.png`・`<ID>-wide.png`だけである。HTMLは入れない。
- IDは4文字の乱数、束のdirectory名は`pk`と6文字の乱数で、seedから決まる（同じseedなら同じ束）。IDは2回の採点を通して重ならない。
- PNGは、画素の表示に要るchunk（IHDR・PLTE・tRNS・IDAT・IEND・gAMA・cHRM・sRGB・pHYs・sBIT）だけを残す。tEXt・iTXt・zTXt・eXIf・tIME・iCCP等は除く。fileとdirectoryの時刻は2000-01-01に揃える。
- Pの左右：1回目は組の半数（乱数で選ぶ）で元の画面（層3は先の試行）をAにし、2回目は全組で入れ替える。各組は、AとBに1回ずつ出る。
- Dは、層2の群（元の画面と、陰性対照を除く5版）と層3の群（3画面）を1つの束に入れる。元の画面（A-r1）は両方の群に入るので、群ごとに別のIDを付ける。表示順は2回で変える。
- 対応表は`<out>/key/key.json`で、束（`<out>/packets/`）の外に置く。描画の無い画面があれば拒否し、`--allow-missing`のときだけ、その画面を含む組を理由付きで除く。ケースの層2の組が半数未満になれば`l2Undetermined`に記録する。

### 評価者の呼出し（`run-eval.mjs`）

- Fable：`claude -p --model fable --restricted --tools Read,Glob,Grep --permission-mode dontAsk --strict-mcp-config --settings '{"disableAllHooks":true}' --no-session-persistence --output-format stream-json --verbose --max-turns <n> --max-budget-usd <b>`、cwdは束のdirectory。#1815の`asc host-session`の読取り専用の起動（[host-session](../../../skills/asc/references/host-session.md)）と同じ限定で、`--restricted`がfile toolをcwdに閉じる。出力の長さは`CLAUDE_CODE_MAX_OUTPUT_TOKENS`で限る。費用は`total_cost_usd`、tokenは`usage`から取る。
- Codex：`codex exec --ephemeral -s read-only -C <束> --skip-git-repo-check --json -m <model> -c project_doc_max_bytes=0`。費用は報告されないので、tokenと時間だけを記録する。
- F採点（`Fs`）と否定の反例（`Neg`）は、講評・文を依頼文に埋め込み、画面を渡さない。cwdは空のdirectoryである。否定の反例は、各回に20文（10対の両側）を1文ずつ採点する。
- 上限（`config/eval.json`の`limits`）：方式ごとのturn・出力token・1回の予算・時間。講評は800字以内と依頼し、超えたら`overLength`を記録する（欠測にはしない）。
- 台帳：`<runs>/ledger.jsonl`に、試みごとの費用・token・時間を追記する。Fableの合計（`--prior-ledger`の試行分を含む）が上限（`config/eval.json`の`capUsd`。本番は30 USD）に達したら止め、`stop`の行を書く。1回の予算は「残り」と方式の上限の小さい方なので、上限を大きくは超えない。Fableの費用が報告されなかった試みは、その回の予算の額で数える。
- 回答は最後のJSONを読み、形が不正なら欠測（`invalid`、理由`invalid-answer`）として記録する。欠測の理由（`images-not-read`・`isolation-violation`・`invalid-answer`・`no-result-event`・`failed`・`missing-input`、Codexの`images-not-viewed`）は`status.json`の`missingReason`に残り、`aggregate.mjs decide`の結果の`missingByReason`が評価者ごとの理由別の件数を出す。再試行は既定で0回、`--retries 1`のときだけ1回まで行い、回数を`status.json`に残す。`status.json`のある呼出しは、再実行で呼ばない。
- 有料の実行は`ASC1835_ALLOW_PAID=1`が無ければ拒否する。`--dry-run`はCLIを起動せず、同じcommand lineを記録し、CLIと同じ形式の偽の回答（seed付き。`--dry-invalid-every N`でN回ごとに不正な回答）で、読取り・台帳・予算の停止まで通す。dry-runの台帳と有料の台帳は混ぜられない。

### 基準文と否定の反例

- `anchors.json`は、軸（「この画面が、依頼の利用者・目的にどれだけ合っているか」）だけから書いた。**評価対象の画面のscreenshot・HTMLは見ずに書いた**（書いた作業者は、この作業の中で画像を1枚も開いていない）。ケースに固有の語を含めない。F採点では、各段階の3つの文を並べて示す。
- `negation-pairs.json`は、3ケースの依頼の必須事項から、否定だけが違う10対を書いた（9・10は肯定側が否定の形）。
- SSRの否定の反例は、モデルを呼ばずに実行できるので、道具の確認として1回実行した（2026-11-27、`multilingual-e5-large` snapshot `ac6781cd1cf88b8306a536d7c9d18a5bd57cc14b`、両側とも接頭辞`query: `）。失敗は0件だった（期待値は肯定側2.9〜4.1、否定側2.0〜2.3。対のcos類似度は0.948〜0.983）。この結果を見た後に、基準文と否定の文は変えていない。

### SSR（`ssr.py`と`harness/ssr.mjs`）

このrepositoryは実装言語をTypeScript（`.ts`・`.mjs`）に集約し、`.py`を置かない（`scripts/check_source_quality.ts`、`development.json`の`auxiliaryLanguages.python`）。本番のembeddingは`fastembed`（Python）でしか動かせなかったので、本番で実行した`ssr.py`は、Git historyの`3d4c31f7:docs/evidence/1835-design-eval-layers/harness/ssr.py`（sha256 `af4d175da3c06b4514aa319d0f2910a08a55080d9b4908cf00e1c5d2e4af2855`）として参照するだけにし、repositoryからは実行しない。式は`harness/ssr.mjs`へ移し、試験は`results/ssr.json`の96件のpmfと期待値を、記録された類似度から計算し直して照合する（Pythonもembeddingも使わない）。embeddingの部分（類似度そのもの）は、この試験では確かめられない。`ssr.py`は`__file__`から`../config/eval.json`を読むので、取り出すときはこのdirectoryと同じ配置にする。

基準文の組ごとに s_r=cos(講評, 基準文r)、p_r=(s_r−min s)/Σ(s_j−min s)、3組のpmfの平均から期待値Σr·p_rを出す。組の5つの類似度がすべて等しいときは一様分布にして`degenerate`を記録する。embeddingは`HF_HUB_OFFLINE=1`で、取得済みのfileだけを使う。e5の接頭辞は、対称な類似度の用途として講評・基準文とも`query: `にした（`config/eval.json`の`ssr.prefix`）。embeddingを読めなければ`coreFailed`を書き、Sはその評価者について未判定になる。

### 集計（`aggregate.mjs`）

- 組の判断は、組の向き（層2は元の画面が先）で「先・後・同等・欠測」にそろえる。P：A・B・同等。D：同じ群の中の順位。F：講評の点、同点は同等。S：期待値の差が0.1未満は同等。
- 割合はどれも`{n, d, rate}`で出す。感度・誤検出・層3の一致は、組×回（2回）を1件として数える。再現性は、2回とも有効な組を1件とする。
- 層2の感度は、版の種類×強さ×実際の層1の結果（`--layer1`の`layer1.json`）で分ける。最低の基準の「強い劣化」と、条件3の強・弱と弱の感度は、層1を通った版だけで数える。Dは陰性対照を除き、誤検出は測らない。
- 有効の条件・最低の基準・条件1〜4・費用・方式の結論は計画7節のとおり。「全方式で弱の感度が100%」は、評価者ごとにP・F・Sの3つがすべて100%のときとし、その評価者があれば結論を未判定にする。
- 層3：`owner-page.mjs`の画面でownerが選んだJSONと`owner-key.json`を照合する。「同等」「判断しない」の組は分母から除く。

### 試験（`node --test harness/`）

`eval.test.mjs`（合成の1×1のPNGで実行。モデル・network・Dockerを使わない）：束にIDや条件の漏れが無いこと（file名・TASK.json・index・PNGのchunk・時刻）、IDの一意性、2回目でID・左右・表示順が変わること、左右の均衡、描画の無い画面の拒否と除外、有料の実行の拒否、dry-runで両評価者の全方式が通ること（不正な回答・再開・command line・台帳）、予算の停止と再試行の上限、予算の見込みの削り方、集計の合格・不合格・不採用・未判定（欠測・ownerの判断なし・費用・天井・SSRの欠如）と最低の基準の境界、SSRの式（既知のベクトル）、ownerのページ。

本番の後に足した試験：`results/ssr.json`の96件を記録された類似度から再計算する照合、Fableの`tool_result`が誤りのRead、Codexの`images-not-viewed`の判定（誤検出しない例を含む）、計画した否定の反例の欠測（FとS）、層1の計測エラーの扱いと描画のcommandの失敗、予算で外した束の除外。

#1860で足した試験：`--lock`を重ねたときに、終わる順序（2つの両順と3つ）・例外で終わる側（先・後）によらず最後の終了まで000で、最後に元のmodeに戻り、補助のfileが残らないこと。動いていない実行が残した状態のfileで止まること。CLIの`run --dry-run --lock`が、他の実行の間に正常終了・エラー終了してもmodeを戻さないこと。単独の実行で従来どおり元のmodeに戻ること。重ねる実行は、別のprocessで取得したもの（両順・3つ・同時に起動した6つ）とCLIの`run`で試す。

### 未確認事項（層2・層3の道具）

- **予算の見込み**：#1807・#1815の実績から、Fableの1回の費用を見積ると、計画の全呼出し（2回×（D 3・P 27・F講評 27・F採点 27・否定の反例 20））で約24〜42 USDになり、Dとcontrast-strongを外しても約17〜32 USDである。計画5節の2では、本番の前の試行で18 USDを超えると見込まれれば「予算の見込みで未判定」として止まる可能性が高い。試行の実測で決める。**本番の後：** 試行の実測で見込みが26.4〜34.3 USDとなり、ownerが上限を30 USDに改めた（[EVAL_PLAN.md](EVAL_PLAN.md)5節）。
- **Codexの読取りの範囲**：`codex exec -s read-only`は書込みだけを防ぎ、読取りを限定しない（[host-session](../../../skills/asc/references/host-session.md)）。#1815は`asc host-session`の実行ごとのpermission profileで読取りを限定した。この道具は、指定どおり`codex exec`を使い、keyとownerの対応表を`--lock`（mode 000）で閉じる。束の他の回・他の束は読める状態のままである。Codexの出力の長さとturnには、CLIの上限の指定が無く、時間の上限だけを掛ける。
- **`--lock`と並行の実行**：同じpathに`--lock`を付けた`run`を並行して動かしてよい（#1860で直した）。最初の起動でmodeを000にし、最後の実行の終了で元のmodeに戻す。途中で終わる実行は、正常終了でも例外でも、他の実行が動いている間はmodeを戻さない。元のmodeと動いている実行は、対象の隣の`<path>.asc-lock.json`に記録し、最後の実行の終了で消す。`<path>.asc-lock.json`が残っていて、記録された実行がどれも動いていないときは、起動を止める。signal等で止めた実行の残りなので、記録されたmodeを確かめて手で戻し、そのfileを消す。signalで止めたときにmodeを戻す処理は無い。一部の実行だけが止まっていた場合は、最後に生きている実行が終わったときに、modeが000のまま残ることをstderrに出す。状態のfileは`<path>.asc-lock.mutex`（排他的に作る）を持つ間だけ書き換える。mutexが10秒を超えて残っていれば起動・終了を止めるので、動いている実行が無ければ消す。対象の親directoryに書込みの権限が要る（旧版は要らなかった）。同じpathを1回の実行で2回渡しても、1回として扱う。制約：同じ実体を別の綴り（symlink等）で渡すと別のpathとして扱う。止まった実行のpidが別のprocessに再利用されると、その実行を生きているとみなす。
- **Fableの文脈**：`--restricted`でも、user単位の`CLAUDE.md`やmemoryが読み込まれるかは確かめていない。束はrepositoryの外（scratch）にあるので、repositoryの`CLAUDE.md`は祖先に無い。
- **Codexのmodel**：`gpt-6.2-sol`は#1815段階3でownerが答えたもので、#1835での使用は確かめていない。
- **Fableで画像を見たか**（本番の後に、`tool_result`が誤りのReadは読んだと数えないよう直した。中身が画像かまでは見ない。本番の184回では誤りの`tool_result`が0件）：`--output-format stream-json --verbose`（導入済みclaude 2.1.323の`--help`で確認）で、assistantのeventのtool_use（`Read`の`input.file_path`）と、最後のresult event（`result`・`total_cost_usd`・`usage`・`duration_ms`）を記録から取り出す。その呼出しの束のPNGのうち、Readされなかったものが1つでもあれば欠測（理由`images-not-read`）。result eventが無ければ欠測（`no-result-event`）で、費用は1回の予算の額で数える。**実機のstream-jsonの出力は、まだ見ていない**（有料の呼出しをしていない）。eventの形（`type: assistant`の`message.content[]`のtool_use、`type: result`）は、既知のSDKの形に合わせた偽の出力で試験している。Readのpathが相対・symlink経由の場合は、cwdとrealpathで解決して照合する。Readの`tool_result`の中身の種類（画像か）までは見ない。**本番の後：** 実機のstream-jsonはこの形で読め、Fableの184回はすべて有効で、渡した画像をすべてReadしていた。
- **Codexの隔離の判定**：`codex exec --json`（導入済みcodex-cli 0.171.0）のitem.completedのうち`command_execution`の`item.command`（shellの文字列）を取り、文字列を空白・引用符・記号で分けて、絶対path・`~`・`..`を含むものを束のdirectory（`-C`）に対して解決し、外に出れば欠測（理由`isolation-violation`）とする。`/bin`・`/usr/bin`等の実行file・`/dev/null`は除く。`$VAR`・バッククォート・`cd`・`eval`を含む命令、`command_execution`以外で既知でない種類のitem、event自体が無い呼出しは「未確認」（`status.json`の`isolation: unconfirmed`）として記録し、欠測にはしない（集計の`isolationUnconfirmed`）。**実機のeventの形（`command_execution`の項目名`command`、画像を見るtoolのitem種別）は未確認**である。文字列の分解は簡易で、`sed '/x/d'`のような`/`で始まる引数は束の外のpathと誤って判定し、不要な欠測を出し得る（その場合は`attempt-*.stdout`で確かめる）。**本番の後：** 有効な3回目では、Pの全呼出しに`command_execution`のitemがあり、隔離の違反は0件、判定できなかった呼出しは1件だった。画像を見るtoolのitem種別は確かめていない（画像の読取りは、stderrと回答の文で判定した。[EVAL_PLAN.md](EVAL_PLAN.md)5節）。
- **束の大きさ**：実際の画面（3ケース×A-r1・D-r1・E-r1）で作ると約110MBである。

## 本番の結果（2026-11-28）

記録は`results/`にある：`result.json`（集計）・`owner-answers.json`（層3のownerの選択。2026-11-27T19:42Z。評価者の結果を見る前に記録）・`owner-key.json`・`key.json`（束の対応表）・`ssr.json`・`ssr-negation.json`・`skip-packets.txt`（予算で外した束のID）。講評の本文・screenshot・生の実行記録は公開しない（scratchの台帳`ledger.jsonl`のsha256は`07a53fe9…c6bc`、講評`critiques.jsonl`は`db4b4209…b5e0`）。

```sh
node harness/aggregate.mjs decide --key key/key.json --runs runs --out result.json \
  --layer1 <9画面のlayer1.json>... --owner owner-answers.json --owner-key owner-key/owner-key.json \
  --ssr ssr.json --ssr-negation ssr-negation.json --skip-packets skip.txt
```

`--skip-packets`は、本番の前に計画5節の2で外した束の一覧（`run-eval.mjs plan`が書き、`run`が使ったもの）を読み、その束だけで示すはずだった層2の組（contrast-strong、3ケース）を欠測ではなく除外として数える（集計の道具に後から加えた。外す決定は本番の前で、結果を見て決めたものではない）。組の束の一部だけが一覧にある場合と、一覧の束に実行の記録がある場合は拒否する。contrast-strongは9画面とも層1で不合格なので、外しても最低の基準と条件3の分母は変わらない。変わるのは再現性・評価者間の一致の分母（27組→24組）だけである。Dも同じ理由で実行していない（評価者ごとに欠測42件＝陰性対照を除く21組×2回。採否の対象外）。

Codexの P・F講評・F採点は、呼出しの手順を直して全件やり直した結果である。経緯と、やり直さなければ結論が未判定だったことは[EVAL_PLAN.md](EVAL_PLAN.md)5節の「Codexの本番のやり直し」にある。

### 結論（計画7節）

| 方式 | Fable | Codex | 結論 | 理由 |
| --- | --- | --- | --- | --- |
| F（FLR） | 不採用 | 不採用 | **不採用** | 層1を通った強い劣化の検出が Fable 1/10・Codex 0/10 で、最低の基準（2/3以上）を満たさない |
| S（SSR） | 不採用 | 不採用 | **この形では不採用。論文の形のSSRは未判定** | この形（ペルソナ無し・画面ごとの講評1件）では、強い劣化の検出が Fable 2/10・Codex 3/10、再現性が両者とも 11/24（0.46）で、最低の基準（検出2/3以上・再現性0.5以上）を満たさない。論文の条件（用途・調整した基準文・ペルソナと複数の回答者による分布。共有された解説によるもので、原文では確かめていない）で測っていないので、論文の形のSSRについては判定していない（下の「言えない」） |

結果は3ケース・層3は6組（ownerが優劣を付けた組）の規模で、統計的な差の証明ではない。

Sの結論の欄は、2026-11-28に#1862で書き直した。`results/result.json`の値（Sの`不採用`）は、計画どおりに今回の形を判定したものであり、変えていない。書き直したのは、その値が論文の形のSSRには及ばないことを示すためである。ここでの「未判定」は、計画7節の採否の区分（評価者で結論が割れた場合など）ではなく、測っていないという意味である。

### 指標（件数/分母。組×2回を1件、再現性は組を1件）

| 指標 | Fable P | Fable F | Fable S | Codex P | Codex F | Codex S |
| --- | --- | --- | --- | --- | --- | --- |
| 強い劣化の検出（層1合格の版） | 10/10 | 1/10 | 2/10 | 10/10 | 0/10 | 3/10 |
| 弱い劣化の検出（層1合格の版） | 10/12 | 2/12 | 5/12 | 11/12 | 0/12 | 2/12 |
| 陰性対照の誤検出 | 0/6 | 1/6 | 5/6 | 0/6 | 0/6 | 5/6 |
| 再現性 | 22/24 | 15/24 | 11/24 | 23/24 | 17/24 | 11/24 |
| 層3のownerとの一致 | 9/12 | 5/12 | 6/12 | 8/12 | 3/12 | 4/12 |
| 否定の反例の失敗 | — | 0/20 | 0/10 | — | 0/20 | 0/10 |

Sの否定の反例はembeddingだけで計算するので、評価者に依らず同じ値（10対）である。

- 種類別（P）：階層は弱・強とも両評価者で全件検出。余白の弱はFable 4/6・Codex 5/6。ui08の`hierarchy-strong`は層1で不合格（1組×2回）で、Pは2件とも検出。
- 評価者間の一致：P 45/48・F 34/48・S 12/48。
- Fが劣化を見分けない主な理由は同点である（以下の同点・向きの件数は、scratchの判断から親が数えたもので、`result.json`には無い）：層2の組でFの点が同じだった割合はFable 20/24・Codex 21/24。`anchors.json`の5段階の基準文で講評を画面ごとに採点すると、1か所だけの劣化では点が変わらない。
- Sは同点が少ない代わりに、向きが劣化の有無に沿わない（層2の判断が先・後で、Fable 9・10とほぼ半々、Codex 5・12と劣化した側に偏る）。陰性対照（描画がpixelで同一）でも5/6で差を付けた。講評を書き直すだけで期待値が0.1以上動き、劣化の有無より講評の揺れが大きい。否定の反例は、期待値では10対とも否定側が低く（失敗0件、差0.88〜2.10）、区別できた。ただし肯定側と否定側のcos類似度は0.948〜0.983と近い。
- 層1：108画面（9画面×各版）のうち76が合格。陰性対照9件はすべて元の画面と同じ結果だった。
- 層3：ownerは9組のうちui03（ダッシュボード）の3組を「同等」とし、残る6組で優劣を付けた。ownerの判断は「ASCとしての基準」の代わりであり、一般の利用者や顧客の正解ではない。

### 費用・時間

| 評価者 | 方式 | 呼出し | USD | 時間 | token（入力・cache書込み/読込み・出力） |
| --- | --- | --- | --- | --- | --- |
| Fable | P | 48 | 9.93 | 15.8分 | 288・450,248/1,061,952・62,618 |
| Fable | F講評 | 48 | 7.59 | 18.3分 | 288・277,186/1,058,116・73,323 |
| Fable | F採点 | 48 | 2.24 | 3.0分 | 96・134,258/272,664・672 |
| Fable | 否定の反例 | 40 | 1.15 | 3.1分 | 80・59,354/249,790・3,520 |
| Codex | P・F講評・F採点（有効な3回目。scratchの台帳から親が計算） | 144 | — | 41.2分 | 入力8,068,260（うちcache読込み6,723,840）・出力59,046 |
| Codex | 否定の反例 | 40 | — | 5.3分 | 入力815,942（うちcache読込み705,536）・出力3,351 |

- Fableの合計は本番20.906 USD（`result.json`）・試行1.317 USD（scratchの`trial/ledger.jsonl`、4回）で22.22 USD（上限30 USD）。予算での停止は無い。
- `result.json`の`costs.codex`は、無効にした1回目（画像を開けなかった。P 48・F講評 48・F採点 46回）、2回目（途中で止めた回。台帳にはPの2回）、有効な3回目（144回）を合わせた値で、P・F講評・F採点で計288回・入力17,829,541 token・約82.7分である。
- 費用の条件（Fableの、Pの2倍以内）：Fは0.99倍、Sは0.76倍（Fの講評を含む）で満たすが、上の最低の基準で不採用になる（Sはこの形での判定）。
- Codexの否定の反例（40回）は1回目の結果で、古い冒頭文で動いた（[EVAL_PLAN.md](EVAL_PLAN.md)5節）。
- 欠測は両評価者とも0件（各184回が有効）。Codexの隔離を判定できなかった呼出しが1件ある（欠測にしない規則）。

### 3層の手順を続けるか（計画9節）

**続ける。** 層2で方式の間に大きな差が出た（強い劣化の検出：Pは両評価者で10/10、F・Sは0〜3/10。陰性対照の誤検出：Sは5/6）。計画9節に従い、[shared harness](../shared-harness/README.md)からこの手順へ参照を張った。道具をshared harnessへ移すことは、この結果の範囲には含めない。

この結果から言えることと言えないこと：

- 言える：この3ケース・2種類の劣化では、画面を並べて見せる一対比較（P）が、画面ごとの講評を`anchors.json`の5段階で点にする今回の設計（F・S）より、既知の劣化をよく見分け、再現性も高い。この設計のF・Sは、ASCの評価実験の補助に使わない。
- 言えない：誤検出の差が方式の能力の差だけによること。Pの陰性対照は、pixelが同じ2画面を並べて見せるので、画面を1つずつ見るF・Sより易しい課題である。
- 言えない：論文のSSR（[arXiv 2510.08338](https://arxiv.org/abs/2510.08338)）そのものが働くかどうか。今回のSは、論文が確かめた条件の外で使った。違いは次の3点である（論文側の性質は、共有された解説によるもので、原文では確かめていない）。
  - 用途：論文は、多数の合成回答者のアンケートの回答（購買意向、1〜5）の分布と、コンセプト間の順位の一致を見る。今回は、画面ごとの講評1件を点にして、2画面の優劣を決めた。
  - 基準文：論文の基準文は、対象の調査に合わせて手で調整されている。今回の`anchors.json`は、画面を見る前に軸だけから書いて固定し、調整していない。
  - ペルソナと、複数の回答者による分布：今回はどちらも無い。評価者に渡したのは、評価者という役割（冒頭文）と#1804の依頼文だけである。依頼文の利用者の説明は、ui02・ui03には節があり、ui08は触れる程度である。
    - ペルソナを入れなかったのは、この設計の不足である。#1835の本文には、論文の数値として、ペルソナが無いと相関達成率が約50%に落ちることを引用していた（原文では確かめていない）。それでも手段の案で人物像を作り足さないとし、計画もそのまま固定した。論文の形でSSRを測り直すことは、2026-11-28にownerが行わないと決めた（#1862）。
- 言えない：Pが「ASCとしての基準」と一致すること（層3の一致は Fable 9/12・Codex 8/12 で、組は6組だけ）。良い案どうしの優劣の判定にPを使えるかは、組を増やして確かめる必要がある。

見直しの条件（次のどれかに当たれば、続けるかをownerが決め、その評価のIssueに記録する）：

1. 層2で、全方式・全評価者が弱い劣化まで全件を見分け（天井）、差が出なくなったとき。劣化の種類と強さを作り直す。
2. 評価者のmodel・版・起動方法、または層1の道具（Docker image・`render.mjs`・`first-view.mjs`）や劣化の定義が変わったとき。層1・層2の校正をやり直してから使う。
3. 層3：今の6組（9/12・8/12、2回は独立でない）では、Pとownerの一致を偶然と区別できない。それまでは、Pを良い案どうしの比較に使わない。組を増やすときは、組の数と判定の方法（例：組ごとの多数で、片側の二項検定）を実行の前に計画へ固定する。
4. Fableの費用の見込みが、ownerの決めた上限（今回は30 USD）を超えるとき。
