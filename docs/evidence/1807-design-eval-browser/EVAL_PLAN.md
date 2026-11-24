# 評価計画（#1807、下書き）

開発時の検証資料であり、配布対象に含めない。

**状態**：下書き。ownerの判断（Issue #1807のコメント、2026-11-25）を反映した。生成（モデルの有料実行）は、ownerの別の許可を待つ。許可の前に、この計画・[gold.json](gold.json)・[conditions.json](conditions.json)・[rubric.md](rubric.md)・`cases/`・`harness/`・`env/`をcommitで固定する。結果を見た後に判定の規則・goldを変えない。変えた場合は、変えた事実と理由をREADMEに記録する。

#1804の[評価計画](../1804-design-judgment/EVAL_PLAN.md)を基にし、違う点だけをここに書く。ここに書いていない手順・規則は、#1804の計画に従う。

## ownerの判断（決定済み）

| 事項 | 決定 | この計画での扱い |
| --- | --- | --- |
| 閲覧の許可範囲 | 固定のallowlistだけ。Art Directionが出典に挙げる作品・制作者の公式サイト等から数十件。それ以外と、allowlist外への転送は遮断する。依頼の内容やrepositoryの情報は外部へ送らない | 具体的な一覧の案を[env/allowlist.proposed.json](env/allowlist.proposed.json)に作った（80 host）。**ownerの確認待ち**。確認後に[env/allowlist.json](env/allowlist.json)の`browse.hosts`へ写してcommitする。空のままでは生成の起動器が起動しない |
| 人の審美的評価 | ownerが順位を付ける。条件名を伏せた狭幅・広幅のscreenshotと実画面を、ケースごとに9画面並べる。モデルの採点は補助 | 下の「人の評価」 |
| 試行数・ケース | 3ケース（業務dashboard・検索一覧詳細・モバイル）× A/D/E × 3回＝27生成。差が見えたケースだけ追加する | 追加の判断はownerが行う（下の「追加」） |
| 費用の上限 | 40 USD（Hostの計算値） | 下の「費用と停止」 |
| 採用時の形 | 評価後にownerが決める | 判定の分類を報告し、形はownerが選ぶ |

## ownerに確認したい残りの事項

推奨の既定と理由を付ける。ownerが別に決めない限り、推奨で進める。

| 事項 | 推奨 | 理由 |
| --- | --- | --- |
| allowlistの具体的な一覧 | [env/allowlist.proposed.json](env/allowlist.proposed.json)の80 hostをそのまま使う | 選定規則（画面・案内の作品の行から、作品・制作者・発注者の公式サイトだけ）を機械的に適用した。各hostに出典の行と理由がある |
| 誤発火（UI-10相当）の確認 | D・Eを、#1804のui10-cliで各3回、この生成環境で行う（6生成、見込み2 USD以内） | 完了の基準に誤発火の確認がある。閲覧のtoolを与えると、Skillの選ばれ方が#1804と変わり得る。27生成の外なので、ownerの許可が必要 |
| 生成imageの作成時の通信 | 生成image（`env/Dockerfile`の`generator`段階）の作成で、apt（書体）とnpm registry（Claude Code CLI）への通信を許す | 準備の段階では通信を使わないので、作成していない。作成は実行の許可と同時に行う |
| 実行前の隔離の再確認（実際のCLI） | 生成imageで、モデルを呼ばない反例（`isolation/run.sh`）をやり直し、さらにhaikuの1回（0.05 USD以内）で、fixture外のRead（`/proc/self/environ`・`/config`・`/log`）が拒否されること、許可外のtoolが無いことを確かめる | 準備の段階の反例は、CLIを入れていないimageで行った。認証の情報がcontainerの環境変数にあるので、Readでの読取りが拒否されることを実際のCLIで確かめてから生成する |

## 実装者が決めた技術的な事項（理由付き）

- **生成のモデル**：`sonnet`（#1804と同じ）。補助の採点は`opus`。Fableは使わない。#1804と比べられるようにする。
- **条件E**：Issueの定義どおり「ASC＋Art Direction＋Product Design」（#1804のEはProduct Designだけだった）。
- **全条件に同じtool**：A・D・Eのどれにも、`fetch_page`・`view_page`・`screenshot`（[env/mcp-server.mjs](env/mcp-server.mjs)）と同じ依頼（[env/gen-prompt.txt](env/gen-prompt.txt)）を与える。差は追加するSkillだけ（[conditions.json](conditions.json)）。
- **依頼文にallowlistのhostを書かない**：一覧はArt Directionの資料から作った。依頼文に書くと、その知識をAにも与えることになり、Skillの効果を測れない。allowlistの範囲は全条件で同じにする。
- **依頼文で2案の比較を求めない**：求めると、Aも中心の手順を行い、Skillの効果を測れない。
- **1回の上限**：`--max-budget-usd 1.5`、timeout 25分。閲覧と画像で#1804（1回0.2〜0.3 USD）より増える見込み。
- **狭幅**：UI-03は依頼のとおり800px、UI-04・UI-07は390px。広幅は全ケース1440px。

## 比較する条件とケース

| 条件 | 構成 |
| --- | --- |
| A | 現行ASCのみ（対照） |
| D | ASC＋Anything Frontend Art Direction |
| E | ASC＋Anything Frontend Art Direction＋Anything Frontend Product Design |

外部Skillは#1804の[ext-commits.json](../1804-design-judgment/ext-commits.json)の固定commitを使う。

| ID | Issueの番号 | 内容 | 狭幅・広幅 |
| --- | --- | --- | --- |
| ui03-dashboard | UI-03 | 倉庫の出荷監視画面（#1804のケースをそのまま使う） | 800・1440 |
| ui04-parts-search | UI-04 | 部品の技術資料の検索・一覧・詳細（[cases/ui04-parts-search/](cases/ui04-parts-search/)） | 390・1440 |
| ui07-bus-mobile | UI-07 | バス停の発車案内（スマートフォン向け、[cases/ui07-bus-mobile/](cases/ui07-bus-mobile/)） | 390・1440 |

ケースの題材・会社・市・人は架空である。

## 生成環境

[README](README.md#生成環境)に構成と隔離の反例を書いた。要点：

- 生成Agent（Claude Code）は、使い捨てのcontainerで動く。read-only root、cap-drop ALL、no-new-privileges、資源の上限、home・秘密のmountなし、Bash・Web系の組込みtoolなし。
- containerは内部専用のnetworkにだけ接続する。外へ出る経路は、allowlistを適用するproxyだけである。proxyには、モデルAPI用（`model`、CONNECTだけ）と閲覧用（`browse`）の2つの入口があり、それぞれ別のallowlistを持つ。
- 転送（redirect）は、各hopをproxyとtoolの両方で検査し、allowlist外なら遮断する。
- 外部ページの内容は、命令ではないことを明記した区切り（`<untrusted-content>`）で包んで返す。ページの中の区切り文字は無効化する。

## 手順

1. ownerがallowlistの案を確認し、`env/allowlist.json`へ写してcommitする。この計画・gold・規則も同じcommitで固定する。
2. 実行の許可の後、生成imageを作り、上の「実行前の隔離の再確認」を行う。不合格なら生成しない。
3. 生成（[harness/run-gen-docker.mjs](harness/run-gen-docker.mjs)）：順序を固定する。1巡目（3ケース×A・D・Eの1回目）、2巡目、3巡目。各試行は新しいfixture・新しいnetwork・新しいproxyで行う。再実行はしない。
4. 中心の手順の集計（[harness/core-steps.mjs](harness/core-steps.mjs)）：各試行のstream-json（tool呼出しの記録）とproxyの記録から数える。notesの自己申告は使わない。
5. 描画・決定論の採点：[harness/gold-check.mjs](harness/gold-check.mjs)（必須情報の網羅率、狭幅の横scroll、外部への要求、UI-04の検索操作、UI-07の初期表示範囲と押せる要素の大きさ）と、#1804の描画器（axe-core、keyboardのfocus、reduced-motion）。#1804の描画器のUI-04・UI-07への対応は未実施（READMEの「未実施」）。
6. 盲検の資料：ケースごとに9画面（3条件×3回）へ乱数IDを付け、狭幅・広幅のscreenshotと実画面（生成したHTMLを、外部通信のない状態で開ける形）を並べる。条件名とnotesを伏せる（#1804の`make-blind.mjs`を、notesを含めない設定で使う）。
7. 人の評価：ownerが、ケースごとに9画面へ1〜9の順位を付ける（同順位なし）。順位を付けた後に、keyを開く。
8. 補助の採点：`opus`の新しいContextで、ケースごとに1回、[rubric.md](rubric.md)で採点する（notesは伏せる）。結果は人の順位との一致度を報告するだけで、判定に使わない。
9. 集計と判定：下の規則を機械的に適用する。

## 中心の手順の判定（候補ごと・ケースごと）

tool呼出しの記録だけで、次を数える（定義は[harness/core-steps.mjs](harness/core-steps.mjs)の冒頭に固定）。

- 見本の閲覧：`fetch_page`か`view_page`の成功が1回以上。
- 2案の実描画比較：`screenshot`で、異なる2つ以上のHTMLファイルの描画に成功。同じファイルの描き直しは数えない（参考として版の数を別に記録する）。
- 狭幅・広幅の確認：そのケースの狭幅と広幅のそれぞれで、`screenshot`の成功が1回以上。
- 中心の手順＝見本の閲覧と2案の実描画比較の両方。

候補（D・E）ごと・ケースごとに、中心の手順を行った試行が、そのケースの試行数（生成に失敗した試行を含む）の過半に満たなければ、その候補のそのケースを「未判定」とする（「効果なし」としない）。行われなかった試行は、数と理由（toolの失敗、呼出しなし、上限到達等）を記録する。Aには中心の手順を求めない（対照）。

## 判定の規則

生成・描画に失敗した試行は、Xでは最も悪い値、Aでは最も良い値として扱う（#1804と同じ）。

- **審美的品質の改善**（人の順位）：ケースごとに、候補Xの3画面とAの3画面の順位を比べる。Xの画面がAの画面より上位である組の数（9組のうち）が8以上なら「改善」、1以下なら「劣化」、それ以外は「差なし」。偶然に8以上となる確率は、順位が無作為なら2/84（約0.024）である。描画に失敗した画面は、Xでは最下位、Aでは最上位として数える。
- **UXの改善**：UI-04の検索操作の合格数、UI-07の初期表示範囲の必須項目の合格数で、Xの最小値がAの最大値より大きい。
- **非劣化**：#1804の規則（必須情報の網羅率、axe-coreのserious・criticalのnode数、狭幅の横scroll・外部への要求・reduced-motion非対応・低品質の試行数、UI-03の白黒での再現率）をそのまま使う。追加：UI-04の検索操作の合格数の最小値がAの最小値以上。UI-07の押せる要素の最小の大きさが、Aの最小値以上、または44px以上。UI-03の白黒での再現率は、#1804と同じく補助の採点者が読み取った値を使う（審美の判定ではない）。
- **誤発火**：上の「ownerに確認したい残りの事項」で行う場合、デザインSkillの呼出し・UI fileの作成が0回であること（#1804と同じ）。行わない場合は、#1804の結果（各Skill単独で0回）を参考とし、この環境では未確認と記録する。
- **費用比**：#1804と同じ（生成費用の中央値の比、X÷A）。
- **分類**（候補ごと）：
  - 判定可能なケース（中心の手順が過半）が1件以下 → `未判定`。
  - 判定可能なケースのどれかで、X・Aの失敗が2回以上、または3回そろわない → `defer`。
  - 判定可能なケースのうち改善（審美・UXのどちらか）が2件以上、非劣化の失敗なし、費用比3以下 → `adopt`。
  - 改善が1件、非劣化の失敗なし、費用比3以下 → `adopt-partial`（改善したケースの種類に限る）。
  - 改善が1件以上あるが、非劣化の失敗・誤発火・費用比のどれかを満たさない → `optional`。
  - 判定可能なケースが2件以上で、改善なし → `reject`。

採用時の形（標準配布・任意登録・部分取込み）はownerが選ぶ。

## 追加

ownerの判断どおり、差が見えたケース（「改善」か「劣化」の候補があるケース、または改善・差なしの境界のケース）だけ、追加の試行をownerに提案する。追加の規則は、提案の時にownerが決める。

## 費用と停止

- 上限40 USD（Hostの`total_cost_usd`の合計）。見込み：生成27回×1回0.4〜1.0 USD＝11〜27 USD、補助の採点3回×約1.3 USD＝約4 USD、実行前の確認0.05 USD。誤発火の確認を行う場合は、さらに約2 USD。
- 1巡目（9生成）の後に、実績の平均から全体の見込みを計算する。見込みが38 USDを超えるなら、補助の採点を止める。それでも超えるなら、Eの3回目、次にDの3回目を止める（結果を見て選ばないよう、順序をここで固定する）。止めた候補・ケースは、試行数が足りないので`defer`か`未判定`になる。
- 実行済みの合計が36 USDを超えた時点で、新しい実行を始めない（起動器が拒否する）。
- timeout・API error・上限到達は、その試行の失敗として記録し、再実行しない。
