# 評価計画（モデル実行の前に固定、#1804）

開発時の検証資料であり、配布対象に含めない。この計画・[conditions.json](conditions.json)・[gold.json](gold.json)・[rubric.md](rubric.md)・`cases/`・`harness/`は、生成と採点のモデル実行の前にcommitで固定する。結果を見た後に判定基準を変えない。変えた場合は、変えた事実と理由をREADMEに記録する。

## 固定するもの

- 基点：main `7ea505adc8f4fa356dc998caf1d7000c7b6c03d1`。ASC版は`package.json`の`0.5.0`。Host：Claude Code 2.1.323。
- 外部Skill：[ext-commits.json](ext-commits.json)のcommitと内容hash。Issueに記載された調査基点（Art Direction `046e42c7`、Product Design `af656d5f`、Motion Atlas `8cff7604`）と一致する。Anthropic skillsとUI/UX Pro Maxは取得時のdefault branchのHEADで固定した。
- 実行環境：macOS（Darwin 25.6.0）、Docker、描画は使い捨てcontainer（`asc-1804-render:1`。Playwright 1.49.1のChromium、axe-core 4.10.2、Noto CJK等の書体。`--network none`、read-only root）。

## ownerの判断事項の既定（Issueの未決表）

ownerは同種のIssueで判断を推奨どおりに委ねている。今回は次の既定で進め、ここに固定する。

| 未決事項 | 既定 | 根拠 |
| --- | --- | --- |
| Host・モデル | Claude Code。生成は`sonnet`、評価は`opus`。Fableは使わない | Host自身のモデルだけを使う。生成と評価でモデルを分け、同じモデルによる自己評価の偏りを減らす。生成の費用を抑える |
| 評価者と採点 | 事前固定のgold・決定論の採点器と、条件名を伏せた独立Context（読取り専用）の評価者2系統。人間評価は行わない | 審美的判断を観測可能な10項目（[rubric.md](rubric.md)）と決定論の指標へ分解する。人間評価の欠如は限界として記録する |
| 品質下限 | 次のどれかに当たる試行を「低品質」とする：生成・描画の失敗、出力なし・空、必須情報の網羅率0.9未満、狭幅で横scroll、評価者の平均合計10/20未満 | 見た目が良くても使えない画面を高品質としない |
| 許容幅・試行数 | 各条件・各ケース3回。3回の範囲が重ならないときだけ「区別できる」 | 過去の評価（#1801等）と同じ |
| 費用上限 | モデル実行の合計30 USD（Hostの`total_cost_usd`。課金額ではない） | ownerの指定 |
| 外部network | 公開資料・公開repositoryの閲覧と固定commitの取得だけ。生成・評価のAgentにはnetworkのtoolを与えない | ownerの指定 |
| 第三者素材 | repositoryにcommitしない。出典URL・license名・要約だけを記録する | ownerの指定 |

## 比較する条件

全条件で、fixtureの`.claude/skills/`にASCの配布Skill（base時点の`skills/*`の全16件）を置く。条件の差は追加する外部Skillだけである（[conditions.json](conditions.json)）。

| 条件 | 構成 | 動的評価 |
| --- | --- | --- |
| A | 現行ASCのみ | する（対照） |
| B | ASC + Anthropic frontend-design | する |
| D | ASC + Anything Frontend Art Direction（repository全体を1つのSkillとして配置） | する |
| E | ASC + Anything Frontend Product Design（repository全体。入れ子の`modules/*/SKILL.md`を含む） | する |
| C | ASC + UI/UX Pro Max | しない。中心機能が同梱Pythonの検索CLIの実行で、生成Agentに第三者コードの実行（Bash）を許すことになる。ownerの条件（第三者コードはnetworkなしの使い捨てcontainerでだけ実行）と、生成Agentがmodel APIへの接続を要することが両立しない。静的評価だけで判断する |
| F・G・H | 組合せ・最小構成・Motion Atlas | 最初は行わない。下の「追加段階」の条件を満たした場合だけGを行う。Motion Atlasは、代表ケースにモーションが必要なものを含めないため静的評価だけで判断する |

外部Skillの選択は、Hostの通常の仕組み（descriptionによる選択）に任せる。依頼文でSkillを指定しない。Skillが呼ばれなかった試行も、その条件の結果として数える（登録した場合の効果を測る）。呼出しの有無は別に記録する。

## 評価ケース

Issueの代表ケースから、目的の異なる4件を選ぶ。作者の作例（映画祭・ラジオ局）と同じ題材は避けた。

| ID | Issue | 内容 | 主に見るもの |
| --- | --- | --- | --- |
| ui02-exhibition | UI-02・UI-07・UI-11 | 郷土資料館の企画展の案内（日本語と英語、スマートフォン中心） | 題材適合、情報階層、和欧混植、狭幅 |
| ui03-dashboard | UI-03・UI-12 | 倉庫の出荷監視画面（長いID、しきい値超過、データ源の取得失敗） | 情報密度、色だけに頼らない異常表示、error状態 |
| ui08-existing-ds | UI-08・UI-13・UI-05 | 既存デザインシステム上の請求先編集フォーム（検証・保存中・失敗・権限なし） | 既存規約の遵守、不要な意匠変更の抑制、フォームの操作 |
| ui10-cli | UI-10 | CSV集計CLIの不具合修正（UIなし） | デザインSkillの誤発火 |

全ケースで外部networkは使えない（UI-14に相当）。依頼文は`cases/<ID>/BRIEF.md`、依頼の指示は全条件で同じ[harness/gen-prompt.txt](harness/gen-prompt.txt)である。

## 実行の手順と隔離

1. 生成（[harness/run-gen.mjs](harness/run-gen.mjs)）：試行ごとに新しいfixtureを作り、新しいContextで`claude -p`を1回起動する。toolは`Read,Write,Edit,Glob,Grep,Skill`だけ（Bash・Web・MCPなし）、`--setting-sources project`、`--permission-mode acceptEdits`、cwd＝fixture。上限は1回あたり`--max-budget-usd` 1.5（ui10は0.5）、timeout 20分。goldと採点器、他の試行はfixtureの外にある。この起動設定で、fixture外の読取り・symlink経由の読取り・fixture外への書込みが拒否され、networkのtoolが無いことを確認した（[results/isolation-probe.json](results/isolation-probe.json)、合格）。
2. 描画（[harness/run-render.mjs](harness/run-render.mjs)）：使い捨てcontainerで、desktopと狭幅（ui02・ui08は390px、ui03は800px）を描画する。screenshot、本文、axe-core（WCAG 2.1 A/AA）、横scroll、外部への要求、keyboardのfocus表示、reduced-motion、LCP・CLS（lab値）を記録する。ui08ではフォームの操作（空で保存、形式誤り、保存中の無効化、成功、失敗、入力の保持、閲覧権限）を自動で行う（Agentによる模擬操作で、人の操作ではない）。
3. 決定論の採点（[harness/score.mjs](harness/score.mjs)）：goldの必須情報の網羅率、上記の指標、ui08の既存file不変・token違反（画面のCSSにある色の値・書体名の直書き）・部品classの利用、ui10の誤発火（デザインSkillの呼出し、UI fileの作成）と隠しoracleのtest（[harness/run-ui10-tests.mjs](harness/run-ui10-tests.mjs)、container内）。
4. 盲検の評価（[harness/make-blind.mjs](harness/make-blind.mjs)、[harness/run-eval.mjs](harness/run-eval.mjs)）：ケースごとに、乱数IDで条件名を伏せたscreenshot・notesだけのfolderを作り、`opus`の新しいContextを2回起動する（読取り専用のtool、cwd＝そのfolder、表示順は評価者ごとに乱数で変える）。描画できなかった試行は評価に出さず、決定論の側で低品質として数える。
5. 集計と判定（[harness/aggregate.mjs](harness/aggregate.mjs)）：下の規則を機械的に適用する。

事前のdry run（モデルを呼ばない合成の試行：正しい・空・出力なし・外部要求あり・生成失敗・壊れたHTML・規約違反のフォーム、評価器はhaikuで1回）で、描画・採点・盲検・評価・集計の経路が各種を区別することを確認してからcommitする。

## 判定の規則

候補X（B・D・E）を対照Aと、ケースごとに比べる。生成・描画に失敗した試行は、Xでは最悪の値、Aでは最良の値として扱う（採用しにくい側に倒す）。再実行はしない。

- **審美的品質の改善**（ui02・ui03・ui08）：評価者2名の平均合計（0〜20）で、Xの3回の最小値がAの3回の最大値より大きい。
- **UXの改善**：ui08のフォーム操作の合格数（11項目）、またはui03の白黒画面でのしきい値超過の読取り（評価者の再現率の平均）で、Xの最小値がAの最大値より大きい。
- **非劣化**（全ケース。1つでも満たさなければ「非劣化の失敗」）：
  - 必須情報の網羅率：Xの最小値 ≥ Aの最小値 − 0.05。
  - axe-coreのserious・criticalのnode数：Xの最大値 ≤ Aの最大値。
  - 狭幅の横scroll・外部への要求・reduced-motion非対応・低品質の試行数：XがAより多くない。
  - ui08：token違反の最大値がAを超えない。既存fileを変えた試行数がAより多くない。フォーム操作の合格数の最小値 ≥ Aの最小値 − 1。
  - ui03：白黒での再現率の最小値 ≥ Aの最小値。
  - ui10：デザインSkillの呼出し・UI fileの作成が0回。oracleに合格した試行数がA以上。
- **費用比**：ui02・ui03・ui08の生成費用の中央値の比（X÷A）。
- **分類**（Issueの分類案）：
  - いずれかのケースで、X・Aの失敗が2回以上ある、または3回そろわない → `defer`。
  - 改善したケース（審美・UXのどちらか）が2件以上、非劣化の失敗なし、費用比3以下 → `adopt`。
  - 改善が1件、非劣化の失敗なし、費用比3以下 → `adopt-partial`（改善したケースの種類に限る）。
  - 改善が1件以上あるが、非劣化の失敗・誤発火・費用比のどれかを満たさない → `optional`（利用者の任意導入。ASCの標準配布にしない）。
  - 改善なし → `reject`。
- C（UI/UX Pro Max）とMotion Atlasは、動的評価をしないので、上の分類を適用しない。静的評価の結果（供給網・license・依存・ASCとの重複）から、根拠付きで判断する。

## 追加段階（G：既存Skillの最小拡張）

B・D・Eのいずれかが`adopt`か`adopt-partial`で、残りの予算が8 USD以上ある場合だけ行う。改善したSkillの有効な指示を、既存のASC Skillのreferenceへ最小の文面で足した構成Gを作り、改善したケースで3回ずつ、同じ手順と規則でAと比べる（Aの結果は再利用する）。Gが同じ規則で改善と非劣化を満たした場合だけ、その文面を製品へ反映する。満たさなければ製品は変えず、後続Issueの案として報告する。外部Skill自体の同梱・既定登録は、ライセンス・正本の二重化・更新の審査の費用から、この段階でも行わない。

## 費用と停止

- 合計30 USD（Hostの`total_cost_usd`の合計）。内訳の見込み：生成 3ケース×4条件×3回＝36回と、ui10 4条件×3回＝12回。評価 3ケース×2回＝6回。
- 1巡目（全ケース・全条件の1回目とui10の1回目）の後に、実績の平均から全体の見込みを計算する。見込みが28 USDを超えるなら、Eの2回目以降を止め、それでも超えるならBの2回目以降を止める（結果を見て選ばないよう、順序をここで固定する）。止めた条件は`defer`とする。
- 実行済みの費用が28 USDを超えた時点で、新しい実行を始めない。
- 生成のtimeout・API error・上限到達は、その試行の失敗として記録し、再実行しない。

## 静的評価（モデル実行なし、または閲覧だけ）

- 供給網：各候補のfile構成、実行コード、外部URL、network・秘密・実行・書込みの字面、注入文の字面を[harness/inventory.mjs](harness/inventory.mjs)で数える（字面の一致は安全の証明ではない。#1773の結論どおり、Hostの読取りで補う）。license・NOTICE・第三者素材の扱いを読む。
- 知識の信頼性（Art Direction）：作品案内（`references/design-works.md`）の節ごとに2行ずつ層化して抽出し、リンク先の到達・転送先・記載との一致を確認する。抽出しなかった行数を未確認として記録する。
