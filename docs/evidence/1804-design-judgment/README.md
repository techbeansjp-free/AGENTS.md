# 実在事例・制作意図に基づくデザイン判断Skillの採否（#1804）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。`cases/`は架空の依頼で、`results/outputs/`は評価中にモデルが生成した画面（実在の組織・作品ではない）である。第三者のSkill・資料・画像はこのdirectoryに含めない（出典URL・license名・要約だけを記録する）。

## 結論

**4候補とMotion Atlasのどれも、ASCの標準配布にも既存Skillの拡張にも採用しない（現状維持）。配布Skill・CLI・CIは変更しない。** 判定は、モデル実行の前にcommit `59a88e84`で固定した[EVAL_PLAN.md](EVAL_PLAN.md)の規則による（[results/decision.json](results/decision.json)）。

| 候補 | 分類 | 主な根拠 |
| --- | --- | --- |
| Anthropic frontend-design（B） | `reject` | 3ケースのどれでも、Aと3回の範囲が分かれなかった。ui02で、axe-coreのserious違反（文字のコントラスト）が1件あった（非劣化の失敗） |
| Anything Frontend Art Direction（D） | `reject` | 範囲が分かれたケースはない。収録した247件の事例（`references/design-works.md`）を、9試行のどれも開かなかった。Skillの中心である「見本の実見」と「実画面2案の比較」は、この環境（network・ブラウザーなし）では行われず、生成者自身が未実施と記録した |
| Anything Frontend Product Design（E） | `reject` | 範囲が分かれたケースはない（フォーム操作・白黒での異常の読取りを含む）。入れ子の担当Skill（`modules/*/SKILL.md`）は一度も読まれず、ui03では本文も読まれなかった |
| UI/UX Pro Max（C） | `reject`（標準配布）。動的評価は行っていない | 中心機能は同梱Pythonの検索CLIの実行で、生成Agentに第三者コードの実行を許すことになる。今回の安全条件では、評価・利用ともにHostの外の隔離が要る。B〜Eの結果（下記）から、追加の効果が出る見込みも低い |
| Motion Atlas | `reject`（標準配布） | 代表ケースに、モーションが必要なものが無かった。Canvasの数理アニメーション中心で、比較画面には`npm ci`とnative moduleの開発依存が要る。ブラウザー標準とCSSで足りる用途に、新しい依存を加えない |

いずれも、利用者が自分の判断で自分の環境に入れることを妨げない。ASCが案内・同梱・既定登録しないという意味である。

根拠の要約：

- **現行ASCだけ（A）で、品質がすでに上限に近い。** 評価者2名の平均合計（20点満点）は、Aでui02 18〜19、ui03 16.5〜17、ui08 15.5〜19だった。必須情報の網羅、横scrollなし、axeの違反0、外部要求0、focus表示、reduced-motionは、全条件のほぼ全試行で満たした。
- **差が出たのは採点項目の平均だけで、3回の範囲は重なった。** 例：ui03で、Aの「題材適合」と「独自性」は平均1.0だった。Bはそれぞれ1.83・1.67、Dは1.5・1.33だった。しかし、Bの合計は15.5〜19で、Aの16.5〜17と重なる。これは「区別できる」の条件を満たさない。
- **外部Skillの読まれ方が、想定と違った。** 全48試行で、Skill toolの呼出しは0回だった。モデルは`.claude/skills/`をGlobし、`SKILL.md`をReadで読んだ。デザインの依頼（ui02・ui03）では、B・Dは全試行、Eは3/6試行で本文を読んだ。既存デザインシステム上の画面（ui08）とCLIの修正（ui10）では、どの候補も読まなかった。既存デザインシステム上の画面とCLIの修正で、B・D・Eの18試行は外部Skillを読まなかった（誤発火0件）。
- **費用は、ほぼ同じだった。** 生成費用の中央値（ui02・ui03・ui08）は、Aに対しB 1.07倍、D 1.24倍、E 0.98倍だった。Dはcache readが約1.6〜2倍に増えた。
- **全体を通じて、同じ型への収束が見えた。** ui02（郷土資料館の企画展）では、12試行すべてが水面と舟の図を置き、11試行が暗色（紺・深緑）の見出し帯と明朝体の見出しを使った（[12試行の狭幅の初期表示](results/screenshots/ui02-exhibition-all-mobile-top.jpg)。上段がA1〜A3・B1〜B3、下段がD1〜D3・E1〜E3）。背景色は、A・D・Eの9試行が生成り（`rgb(244〜246, 238〜241, 226〜231)`）で、Bの3試行だけが灰緑・白系だった。ただし、評価者はこの構成を題材に合うとして高く採点した（独自性の平均：A 2.0、B 2.0、D 2.0、E 1.67）。収束そのものは、今回の規則では品質の低下として測られない（下記「限界」）。

## 記録

| 項目 | 値 |
| --- | --- |
| main完全SHA | `7ea505adc8f4fa356dc998caf1d7000c7b6c03d1`（作業branchの基点） |
| 計画を固定したcommit | `59a88e84`（EVAL_PLAN・gold・rubric・fixture・harness）。その後の変更は下の「計画からの逸脱」 |
| ASC版 | `package.json`の`0.5.0` |
| Host | Claude Code 2.1.323。生成は`sonnet`（initの表記`claude-sonnet-5-5`）、評価は`opus`、事前のdry runと隔離の反例は`haiku`。この作業の親sessionはOpus 5.5 |
| 認証 | `ANTHROPIC_API_KEY`は未設定。`total_cost_usd`はHostの計算値で、課金額ではない（課金額は欠測） |
| 実行環境 | macOS（Darwin 25.6.0）、Docker。描画は`asc-1804-render:1`（Playwright 1.49.1・Chromium、axe-core 4.10.2、Noto CJK・DejaVu・Liberation）。UI-10のtestは`node:22-alpine`。どちらも`--network none`・read-only root・`--cap-drop ALL`・資源上限・label `asc.worktree` |
| 外部Skill | [ext-commits.json](ext-commits.json)。Issueの調査基点と同じcommit（AD `046e42c7`、PD `af656d5f`、MA `8cff7604`）。frontend-designは`anthropics/skills` `e4bb5d96`、UI/UX Pro Maxは`8db36338`（取得時のHEAD） |
| 外部network | 固定commitの取得（git clone）、image build時のpackage取得、出典リンクの到達確認（27 URL）と内容確認（3 URL）だけ。生成・評価のAgentにnetworkのtoolは無い |
| 外部送信 | repositoryや他projectの内容は送っていない。Hostのモデルに送ったのは、架空の依頼文・生成物・screenshot・採点基準だけ |
| 費用 | 合計15.61 USD（上限30）。生成48回 8.06、評価6回 7.54、隔離の反例 0.003、評価器のdry run 0.014。全試行で再実行なし |

## Phase A：現行ASCの能力・責務・不足

現行の配布Skill16件には、審美的判断を主目的とするSkillは無い。デザインに関わる責務は次の箇所に分散している。

| 箇所 | 責務 | 保証の範囲 |
| --- | --- | --- |
| `skills/project-foundation/references/contracts-and-ui.md`「UI部品とトークン」 | design systemと部品の再利用境界、design tokenの正本と値の直書きの検査、semantic・keyboard・focus・contrast・reduced motion・長文・responsiveの確認 | 基盤の決定と機械検査。配色・書体・構図の選び方は扱わない |
| `skills/user-journey-acceptance` | 実画面での一連の操作、保存・失敗・回復の確認 | 操作と結果。見た目の確認だけとは分けている |
| `skills/engineering-judgment/references/conditions-and-counterexamples.md` | 異常時の文言 | 設計案の比較。意匠の比較は扱わない |
| `skills/contract-enforcement/references/counterexamples.md` | UI tokenの直書き・部品の迂回の検査 | 規約の機械検査 |
| `skills/review-and-remediation` | 変更の独立レビュー | 要求・規約への適合。審美的品質の採点は扱わない |
| `skills/asc/references/implementation.md`、`v05/ARCHITECTURE_DECISION_0002.md` | 画面を持つ機能で、既存画面・操作フロー・デザイン規約を確認し、状態・例外・受入条件を具体化する | 業務操作の完了。意匠は扱わない |
| `research-to-implementation`・`security-evidence`・`verification-optimization` | デザイン固有の責務は無い | – |

旧版の`experience` domain（#127、`frame-experience`等の3 phase）は、現行treeに無い。v0.5の契約ではない（Git履歴にだけある）。#1256（業務シナリオと画面の設計契約）、#1552（Coding Engineering・Quality Lens、not planned）も、v0.5の配布Skillには引き継がれていない。

Hostの標準能力とASCの責務の分離：Skillの登録・選択・本文の読込み、画像の認識（Read）、ブラウザー操作、外部資料の取得はHostの能力である。ASCは、目的別Skillの本文と、Goal・権限・独立レビュー・完了の契約を持つ。今回の測定でも、外部Skillの選択と読込みはHost（モデルのGlob・Read）が行い、ASCは関与していない。

現行ASCだけで生成した画面の観測（条件A、9試行）：

- 改善の余地が見えた点：
  - ui02の書体・余白（評価の平均1.5）。
  - ui03の題材適合・独自性（各1.0。汎用の業務dashboardの型）。
  - ui08の一貫性（0.67）。既存画面と、見出しや余白の扱いが一部異なった。
- 要求適合・既存規約の遵守は満たした。
  - 網羅率：ui02の1試行だけ0.885。gold側の不備による。下記の逸脱を参照。
  - token違反0、既存fileの変更0。
- Aは、2ケース（ui02・ui03）の5/6試行で、ASCの`project-foundation`の`contracts-and-ui.md`を自分で読んだ。

## Phase B：外部Skillの実装と能力の比較

| 候補 | commit・license | 構成 | 実行コード・依存 | network | ASCとの重複 |
| --- | --- | --- | --- | --- | --- |
| frontend-design | `e4bb5d96`・Apache-2.0 | `SKILL.md`だけ（2 file、19.5 KB） | なし | なし | 品質の下限（responsive・focus・reduced motion・contrast）は`contracts-and-ui.md`と重なる。意匠の方針（定型の回避、2段階の計画と自己批評）はASCに無い |
| Art Direction | `046e42c7`・MIT（NOTICEあり） | 50 file、8.4 MB。`SKILL.md`、`references/`17件（作品案内247件を含む）、`checklists/`4件、`templates/`11件のHTML、作例2件（WebP・PNG・埋込みfont・生成音源）、書体調査のSQLite・CSV | 実行コードなし（HTML作例のJavaScriptを除く） | 一次資料の取得を前提にする（391 host、3,429 URL） | a11y・性能・formの資料は`contracts-and-ui.md`・`user-journey-acceptance`と重なる。事例に基づく意匠判断はASCに無い |
| Product Design | `af656d5f`・MIT | 1,650 file、14.2 MB。入れ子の担当Skill4件、自己評価のcampaign（`campaigns/`・`registry/`）、研究資料 | Python 51・`.mjs` 47。`scripts/find_journeys.py`の実行を手順で求める | 検証scriptがURLを扱う（実行しなければ通信なし） | 機能・情報設計、操作フロー、状態、受入は`asc`の`implementation.md`・`user-journey-acceptance`・`engineering-judgment`と大きく重なる |
| UI/UX Pro Max | `8db36338`・MIT | Skill本体81 file、3.7 MB（CSV 37）。repositoryには他に6 Skill・CLI・preview | 中心機能がPythonの検索CLI（`search.py`）。`--persist`でfileを書く | scriptに通信の実装は見当たらない（字面の検査） | a11y・touch・responsiveの規則は重なる。stack別の指針・palette・font pairはASCに無い |
| Motion Atlas | `8cff7604`・MIT | 73 file、2.3 MB。200作例（Canvas中心） | JavaScript 19、build・serve script。開発依存`@napi-rs/canvas` | 実行時の依存なし | なし（ASCはモーションの作例を持たない） |

READMEの宣伝と実装・作例・実証の区別：

- Art Directionは、収録件数（247事例・292書体記録）を本文で自ら限定している。例：「247件の事例・資料…1行が完成作品1点と必ずしも一致しない」、書体の理由まで確認できたものは46作品。
- Product Designの`campaigns/`は作者自身による評価である。作者は「人による使いやすさや製品間の優越性を示さない」と明記している。
- 独立した第三者の実証は、どの候補にも見当たらなかった（未確認）。

候補同士の関係：

- Art DirectionとProduct Designは互いを参照する。参照先は、GitHubの`main`を指すURLである（版が固定されない）。
- 両者は、受け渡しの書式（`references/handoff.md`）を共有する。
- Motion AtlasはArt Directionの作例に使われている。
- frontend-designとArt Directionは、どちらも「定型の回避」と「題材からの選択」を指示する。互いに矛盾はしない。

依存：

- Art Direction・frontend-designは、特定のHost・Node・Pythonを必要としない。
- Product Design・UI/UX Pro MaxはPythonの実行を手順に含む。
- Motion Atlasは、比較画面にNode 22とnpmが要る。

導入方式の比較：今回の結果では、全体導入・部分導入・考え方だけの採用・既存Skillの拡張のどれについても、効果が観測されなかった。外部オプションとしての利用（ASCは関与しない）だけが残る。

## Phase C：デザイン知識の信頼性と適用可能性（Art Direction）

- **構成**：作品案内247行（6節）、書体調査292記録（`findings.csv`・SQLite）、用途の深さ247行（`usage-depth.csv`）、技術索引（`references/a-*`〜`l-*`）、HTML作例11件。
- **追跡可能性**：作品案内の各行に、次の欄がある。
  - 公開資料のリンク。
  - 確認した範囲と留保（例：「本人回想と後年の現物図を照合。1961年製個体とは未確定」）。
  - 地域・媒体・年。

  書体調査には、版・部位・確認方法（`access`：`live_text` 245、`live_css` 14、`live_render` 13、`saved_text` 10、`artifact` 9、`unavailable` 1）・限界・確認日がある。制作者の説明・実画面の観察・未確認を区別する設計になっている。
- **層化抽出による確認**：6節から各2行（節の先頭と中央）、計12行・27 URLを確認した（[results/source-sample.json](results/source-sample.json)）。
  - 到達：26件が200。MoMAの1件は403で、自動取得の拒否と推定する（未確認）。
  - 内容：3件を開いて、記載と照合した。
    - Framestore（『No Time To Die』）：制作者の記載と一致した。
    - WONDR（Arnotts）：制作年が無いことを含め、記載と一致した。
    - GKの「キッコーマン卓上しょうゆ瓶」：リンク先に「液だれ」への言及が無かった。記載の「液だれの問題に対し、先を切った形の注ぎ口」は、このリンク先では確認できなかった。同じ行のもう1つの出典（MoMA）は403で開けず、未確認である。
  - 未確認：残り235行と、開いていない24 URLの内容。
- **偏り**：247作品の地域は、日本127・日本以外116・未確定4。媒体はWeb 47・広告44・包装43・映像36・空間28・ゲーム27で、アプリは1件だけだった。業務システム・管理画面の事例は、ほぼ含まれない。
- **業務システムへの適用**：Dは、ui03（業務dashboard）でも本文と`visual-direction.md`を読んだ。ただし事例は使わず、評価もAと区別できなかった。美術館・広告の事例を業務画面に移す条件は、資料に明示が無い。今回の評価でも確かめられなかった。
- **一次資料が取れない場合の動作**：Dの生成者は、Skillの指示どおり、次を記録した。
  - 「事例の外部ページや画面図は開いていません…見本の実見は未完了」。
  - 二案の比較・実描画の確認は未実施。

  取得の失敗を確認済みとして扱った試行は無かった（D、全9試行のnotes）。
- **原則の移転と模倣**：Dのui02の1試行は、作者の作例（映画祭のHTML）を読んだ。その試行の画面が作例に似ているかは評価していない（欠測）。

## Phase D：能力の分解

| 能力 | 現行ASC（A）で満たせたか | 外部Skillで差が出たか |
| --- | --- | --- |
| 題材理解・情報設計・視覚的階層 | 満たした（hierarchy 1.83〜2.0） | 区別できず |
| 操作設計（フォーム、ui08） | 合格数8〜11/11 | D 9〜11、E 9〜11、B 9〜11。区別できず |
| Art Direction（書体・配色・構図・余白） | ui02の書体・余白が1.5 | 区別できず。Bはui03の題材適合・独自性の平均が高い（1.83・1.67）が、合計の範囲は重なる |
| デザイン根拠（notes） | rationale 1.83〜2.0 | Dは、未確認・未実施を最も多く明記した。採点は区別できず |
| デザインシステム遵守 | token違反0・既存file変更0 | 全条件で同じ（どの候補も、ui08ではSkillを読まなかった） |
| 実画面評価・比較設計・モーション | 生成Agentにブラウザーが無いため測っていない | 測っていない |

「資料だけ」「手順だけ」「両方」の比較（アブレーション）は行わなかった。理由：候補の全体で効果が観測されなかったため、計画どおりGの段階に進まなかった。また、実際の試行では、資料（`design-works.md`・書体データ）が一度も読まれなかった。「大量の資料を読むこと自体の寄与」は、評価できる状態にならなかった。

## Phase E：供給網・セキュリティ・license

静的な棚卸し（[harness/inventory.mjs](harness/inventory.mjs)、結果は[ext-commits.json](ext-commits.json)）：

- Art Direction・frontend-designには、実行コードが無い。注入文・秘密・外部送信の字面は0件だった。
- Product Designの検出は、次の内訳だった。
  - networkの字面14件：検証scriptのURL解析。
  - 秘密の字面29件：試験用の`process.env`のflag。
  - 実行の字面20件。

  中身を見たところ、評価campaignの試験用で、Skillの通常手順からは呼ばれない。
- UI/UX Pro Maxのscriptに、通信の実装は見当たらなかった。環境変数は`COLORTERM`だけを読む。
- 字面の一致は安全の証明ではない（#1773の結論）。

登録前の扱い：

- 外部Skillは、fixtureの`.claude/skills/`にだけ置いた（使い捨て。Hostの利用者設定には登録していない）。
- 生成Agentには、Bash・Web・MCPのtoolを与えていない。そのため、同梱scriptの実行・外部送信の手段は無い。
- 起動設定の反例（[results/isolation-probe.json](results/isolation-probe.json)、合格）：
  - fixture外の読取り・symlink経由の読取り・fixture外への書込みは拒否された。
  - networkのtoolは無い。
- 評価AgentはHOME・本番repository・goldに到達できない（cwdの外の読取りは拒否される）。

license：

- 各候補のLICENSE（MIT・Apache-2.0）は、そのrepositoryの成果物に適用される。
- Art DirectionのNOTICEは、次を明記している。
  - 作例の書体（SIL OFL 1.1）の扱い。
  - 生成画像・音源の出典。
  - 出典リンクの文書には、各権利者の条件が適用されること。MITが転載・翻訳の許諾を与えないこと。
- 書体のWeb配信・サブセット化の条件は、OFLに従う。今回は書体を配信していない。生成物は、閲覧環境の書体だけを使った。
- 第三者の画像・作品のscreenshotは、repositoryに入れていない。

見つかった懸念（採否には影響しない）：

- 生成Agentの起動一覧に、利用者環境のplugin・組込みSkill（23件）が混入した。`--setting-sources project`でも、一覧はAで39件（ASCの16件＋23件）、B・D・Eで40件（さらに外部Skill1件）だった。全条件に同じく入り、呼出しは0回だった。
- 隔離の合格条件（読取り・書込み・network）は満たした。しかし、「Skillの一覧をproject分だけにする」ことは、この設定では保証されない。

## Phase F〜H：評価の設計と実行

- 固定：[EVAL_PLAN.md](EVAL_PLAN.md)、[conditions.json](conditions.json)、[gold.json](gold.json)、[rubric.md](rubric.md)、`cases/`、`harness/`をcommit `59a88e84`で固定してから、モデルを実行した。
- 事前のdry run（モデルの呼出し0回。評価器だけhaikuで1回）：次の合成試行で、描画・採点・盲検・評価・集計が各種を区別することを確認した。
  - 正しい画面、空の出力、出力なし、外部要求あり、生成失敗、壊れたHTML、規約違反のフォーム、UI-10の正常と誤発火。
  - 評価器は、画像の無い試行を`null`、空の画面を0点にした。
- 盲検：乱数IDで条件名を伏せた。表示順は評価者ごとに変えた。評価者はcwdの外（keyとgold）を読めない。
- 実行：
  - 生成：4条件×3ケース×3回と、ui10の4条件×3回、計48回。全て`success`で、失敗・timeout・上限到達・再実行は0件。
  - 1巡目の後の見込みは23.3 USDだった。停止の規則（28 USD）に当たらなかったので、全試行を行った。
- 評価者間の一致：360項目対のうち87.8%が同点で、合計点の差の平均は0.89点だった。同じモデル（opus）の2回なので、独立した人間の評価者間の一致ではない。

## Phase I〜K：審美・UX・アクセシビリティ

試行ごとの全値は`results/score-*.json`、判定の入力は[results/decision.json](results/decision.json)にある。評価合計は、評価者2名の平均（20点満点）である。

| ケース | 指標 | A | B | D | E |
| --- | --- | --- | --- | --- | --- |
| ui02 | 評価合計 | 19, 19, 18 | 17.5, 17.5, 18.5 | 16.5, 17.5, 19.5 | 19, 17.5, 19 |
| ui02 | 網羅率 | 0.885, 1, 1 | 1, 1, 1 | 0.885, 1, 0.885 | 1, 1, 0.885 |
| ui02 | axe serious・criticalのnode数 | 0, 0, 0 | 1, 0, 0 | 0, 0, 0 | 0, 0, 0 |
| ui03 | 評価合計 | 16.5, 17, 17 | 18.5, 15.5, 19 | 18, 19.5, 14.5 | 16, 17, 14 |
| ui03 | 白黒での異常の読取り（再現率） | 1, 1, 1 | 1, 1, 1 | 1, 1, 1 | 1, 1, 1 |
| ui08 | 評価合計 | 18, 15.5, 19 | 19, 19, 18 | 20, 19.5, 17.5 | 19.5, 19.5, 18.5 |
| ui08 | フォーム操作の合格数（11項目） | 8, 9, 11 | 9, 9, 11 | 11, 11, 9 | 10, 9, 11 |
| ui08 | token違反・既存fileの変更 | 0・0 | 0・0 | 0・0 | 0・0 |
| ui10 | 誤発火・oracle合格 | 0・3/3 | 0・3/3 | 0・3/3 | 0・3/3 |

全試行の共通点：

- 次は、全試行で0だった：狭幅の横scroll、外部への要求、reduced-motion非対応、page error。
- focus表示は、全試行で全tab stopにあった。
- LCP（lab値）は61〜313 ms、CLSは0だった。
- 生成物の大きさは8〜19 KB（HTML 1 file）だった。

フォーム操作の失敗：主に「空で保存したとき、`aria-invalid`の付いた項目が5件以上」の判定である。ブラウザー標準の`required`検証を使った試行では、送信自体が止まり、`aria-invalid`は付かない。そのため不合格になる。全条件に同じく起き、条件の差ではない。

UXは、Agentの模擬操作（Playwright）で測った。人の所要時間・誤操作・達成率は測っていない。

## Phase L〜M：モーション・性能・保守性

- モーション：全試行で、`document.getAnimations()`は0か、reduced-motionで停止した。Motion Atlasを使う必然のあるケースは無かった。
- 性能：上記のlab値だけである。フィールド指標（実利用者のLCP・INP）は測っていない。INPは測っていない（欠測）。
- 保守性：ui08で、既存のtoken・部品classを全試行が使った（部品classの利用6〜7/7）。画面専用の色・書体の直書きは0件だった。

## Phase N：判断根拠の追跡

全条件の生成物に`DESIGN-NOTES.md`がある（[results/outputs/](results/outputs/)）。「説明可能性」の採点は、Aで1.83〜2.0だった。どの条件とも区別できなかった。

外部の出典URLを書いた試行は0件だった（networkが無いため）。Dは「見本の実見は未完了」と明記した。これは後付けの説明ではなく、Skillの指示どおりの未確認の表明である。

生成後の後付けかどうかを、設計時点の記録と照合することはしていない。生成は1回のContextで完結し、中間の記録が無いためである（未確認）。

## Phase O：再現性

- 低品質の試行（品質下限の定義による）：A 1、B 0、D 2、E 1。全て、ui02の網羅率0.885による（gold側の不備。下記）。
- 評価合計の最低値：A 15.5、B 15.5、D 14.5、E 14。
- 同じケースの3回で、構成は大きく変わらなかった。ui02は全条件で同じ型だった。
- 長期の再現性・モデルの変更による影響は測っていない。

## Phase P：Skillの選択とContext消費

| 観点 | 結果 |
| --- | --- |
| 配置・一覧 | 外部Skillは、Hostの一覧に入った（initのSkill一覧）。入れ子の`modules/*/SKILL.md`（Product Design）は、一覧に現れなかった |
| 選択 | Skill toolによる呼出しは、全48試行で0回だった。デザインの依頼では、モデルが`SKILL.md`を直接Readした（B 6/6、D 6/6、E 3/6） |
| 不要時の非適用 | ui08（既存デザインシステム）とui10（CLI）で、B・D・Eが外部Skillを読んだ試行は0/18だった |
| reference取得 | Dは`visual-direction.md`だけを読んだ（作品案内・書体データは0回）。Eは担当Skillを読まなかった |
| 他Skillへの影響 | Aは、ASCの`contracts-and-ui.md`を5/6試行で読んだ。B・D・Eのデザイン依頼では読まなかった（0/18）。外部Skillが、ASCの既存referenceの読込みを置き換えた形である。品質の差は観測されなかった |

Claude Codeだけで測った。Codexの登録・読込みとの違いは測っていない。

## Phase Q：費用・速度

中央値（各3回）。費用はHostの計算値である。

| ケース | 条件 | 費用 USD | wall 秒 | output tokens | cache read | cache write | tool呼出し |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ui02 | A / B / D / E | 0.197 / 0.208 / 0.267 / 0.192 | 74 / 78 / 92 / 68 | 11,002 / 10,872 / 12,282 / 9,671 | 64,731 / 46,140 / 107,398 / 72,243 | 21,194 / 22,927 / 32,391 / 21,887 | 7 / 6 / 11 / 7 |
| ui03 | A / B / D / E | 0.202 / 0.253 / 0.264 / 0.194 | 68 / 93 / 81 / 67 | 10,480 / 14,165 / 11,994 / 10,098 | 46,276 / 47,006 / 96,303 / 47,954 | 22,965 / 26,657 / 32,736 / 22,088 | 7 / 7 / 9 / 6 |
| ui08 | A / B / D / E | 0.159 / 0.157 / 0.158 / 0.168 | 50 / 49 / 46 / 49 | 7,765 / 7,601 / 7,219 / 7,819 | 45,264 / 45,549 / 48,400 / 49,499 | 19,046 / 19,032 / 20,101 / 21,255 | 10 / 10 / 10 / 10 |
| ui10 | A / B / D / E | 0.064 / 0.064 / 0.070 / 0.073 | 15 / 16 / 17 / 15 | 1,922 / 1,904 / 1,809 / 1,867 | 41,109 / 41,385 / 56,125 / 45,457 | 10,087 / 10,157 / 11,558 / 12,196 | 6 / 6 / 6 / 6 |

- 外部資料の検索・取得は0回だった（networkなし）。
- ブラウザー操作・screenshotは、生成側では0回だった（描画はharness側）。
- デザイン案の生成数は、全試行で1案だった（Dの「二案の比較」は行われなかった）。
- レビューの指摘・修正の反復・人の修正指示・手戻りは、測定の対象外である（1回の生成だけを測った）。
- 配布物の維持費用は、不採用のため発生しない。

## Phase R：採否

上の「結論」のとおり。候補ごとの限界と再評価の条件：

| 候補 | 残存リスク・限界 | 再評価の条件 |
| --- | --- | --- |
| frontend-design | ui03の題材適合・独自性の平均は高かったが、3回では区別できない。コントラスト違反が1件あった | 業務画面のケースで反復を増やす（例：各5回以上）。採否の規則を事前に固定する |
| Art Direction | 中心の手順（見本の実見・実画面2案の比較）は、network・ブラウザーが無いと実行されない。事例資料は読まれなかった。出典の1行で、記載とリンク先が一致しなかった | 生成Agentに、閲覧（固定のallowlist）とブラウザーのscreenshotを許す評価環境を用意できたとき。同時に、外部閲覧の安全条件（redirect・動的内容）を設計する |
| Product Design | 担当Skillは選ばれなかった。ASCの`user-journey-acceptance`・`implementation.md`と重なる | 複数画面の操作フロー（UI-05・UI-06）を、実接続で評価するとき |
| UI/UX Pro Max | 第三者のPython実行が前提 | 検索結果を、事前に隔離環境で生成した静的資料として渡す方式を評価するとき |
| Motion Atlas | モーションが必要なケースが無い | 状態変化の伝達にモーションが必要な受入条件を持つケースが出たとき |

全体導入より小さい構成（G）は、計画の条件（いずれかが`adopt`か`adopt-partial`）を満たさなかったので、行っていない。

## Phase S：採用時の実装計画

不採用のため、製品は変更しない。後続Issueは必須ではない。必要とする場合の候補を、次に示す。

1. 生成Agentに、閲覧とscreenshotを許した評価環境での再評価（Art Directionの中心の手順を測る）。
2. 業務画面での、frontend-designの反復の追加。

どちらも、ownerが費用と外部閲覧の範囲を判断してから行う。

## 計画からの逸脱

- **デザインSkillの利用の判定**：計画では「デザインSkillの呼出し」とした。1巡目の途中で、Skill toolが呼ばれず、`SKILL.md`がReadで読まれることが分かった。そこで、`SKILL.md`・referenceのReadも「利用」に含めるよう`score.mjs`を変えた。ui10（誤発火）の結果を見る前に変えた。どちらの定義でも、ui10の誤発火は0件である。
- **goldの不備**：ui02の関連イベントの日付を「4月24日」の形で求めていた。しかし生成物の一部は、カレンダー型（「4月」「24」「土」を別の行に置く）や「4/24」の形で表示した。その場合、「日」が無いので不合格になった（A 1・D 2・E 1試行で網羅率0.885、低品質に数えられた）。計画どおり、goldは直していない。
  - この不備で、Dの非劣化（低品質の試行数）が失敗になった。
  - ただし、全候補の判定は「改善なし」で決まっている。goldを直しても、分類は変わらない。
- **評価のkey**：盲検のfolderから、描画できなかった試行を除く処理（`make-blind.mjs`）を、本番の前に加えた。本番で除かれた試行は0件だった。

## 限界と未確認

- 人間による審美的評価は行っていない。評価は、同じモデル（opus）の2回である。評価者の好みや、モデル特有の偏りは除けない。
- 評価者は上限近くを付けた（Aでも16.5〜19）。上限効果で、小さな差を区別できない可能性がある。
- 「独自性」は、評価者が題材との関係で採点した。全条件で同じ型に収束した（ui02）ことは、この採点では減点されなかった。収束を直接の指標にする方法（構造の類似度等）は、審美的品質の代理としての限界もあり、今回は記述統計だけにした。
- 生成Agentには、ブラウザー・network・Bashが無い。実画面の確認・外部事例の参照・2案の比較を手順に含むSkill（Art Direction・Product Design）には不利な条件である。ただし、条件は全候補で同じで、事前に固定した。
- 代表ケースは4件だけである。UI-01・UI-04・UI-06・UI-09・UI-12の一部・UI-13は評価していない。モデルはsonnetだけで、Host・モデルの非劣性（Stage 4）は測っていない。
- 1回の生成だけを測った。修正の対話・手戻りを含む総費用（H6）は測っていない。

## 再現

外部Skillの取得（`ext/`は空のdirectoryに作る。hookは無効）：

```sh
git -c core.hooksPath=/dev/null clone --filter=blob:none --no-checkout <url> <name> && git -C <name> -c core.hooksPath=/dev/null checkout <commit>
```

`<name>`は`ad`・`pd`・`ma`・`as`・`uipm`（[ext-commits.json](ext-commits.json)）。

描画imageの作成：

```sh
docker build --label asc.worktree=<worktree> -t asc-1804-render:1 -f render.Dockerfile <空のdirectory>
```

Dockerfileの内容は次のとおり。

```dockerfile
FROM mcr.microsoft.com/playwright:v1.49.1-noble
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-noto-cjk-extra fonts-dejavu-core fonts-liberation && rm -rf /var/lib/apt/lists/* && fc-cache -f
WORKDIR /opt/r
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.49.1 axe-core@4.10.2
```

実行（`<RUNS>`等はworktree外の新しいdirectory）：

```sh
ASC1804_EXT=<ext> node harness/run-gen.mjs <RUNS> <case> <A|B|D|E> <rep> --budget 1.5   # ui10-cliは0.5
node harness/run-render.mjs <worktree> <RUNS> <case> <RENDER>/<case>
node harness/run-ui10-tests.mjs <worktree> <RUNS> <OUT>/ui10-tests.json
node harness/make-blind.mjs <RUNS> <RENDER>/<case> <case> <BLIND>/<case> <KEYS>/<case>.json 1804-<case>
node harness/run-eval.mjs <BLIND>/<case> <EVALS>/<case>-e1.json order-1 --model opus --budget 4   # e2はorder-2
node harness/score.mjs <RUNS> <RENDER>/<case> <case> <SCORE>/<case>.json --key <KEYS>/<case>.json --evals <EVALS>/<case>-e1.json,<EVALS>/<case>-e2.json
node harness/aggregate.mjs <OUT>/decision.json <SCORE>/ui02-exhibition.json <SCORE>/ui03-dashboard.json <SCORE>/ui08-existing-ds.json <SCORE>/ui10-cli.json <OUT>/ui10-tests.json
```

dry run：`node harness/make-dryrun.mjs <DRY>/runs`の後、同じ描画・採点を行う。

保存したもの：

- `results/gen-runs.json`：全48試行のmeta。
- `results/score-*.json`、`results/evals/`、`results/keys/`、`results/decision.json`、`results/ui10-tests.json`。
- `results/outputs/`：生成されたHTML・CSS・notes・CLIの修正。
- `results/screenshots/`：代表8枚と、ui02の12試行の初期表示を並べた1枚（縮小JPEG）。
- `results/source-sample.json`：出典の抽出と確認。

全試行のscreenshotと、session記録（stream-json）は、容量のため作業directoryにだけ残した。repositoryには入れていない。
