# 採否基準（モデル実行の前に固定）

対象：#1801。この文書・[candidates.json](candidates.json)・[harness/make-eval-suites.mjs](harness/make-eval-suites.mjs)は、モデル実行の前にcommitで固定する。評価結果を見た後に変えない。

## 候補と条件

- 候補A：現行のdescription（base `02bb1a0d`）。
- 候補B：全16件のdescriptionを、依頼の種類を示す1文（27〜51文字、合計550文字）へ書き換える。境界・否定の文は落とす（[candidates.json](candidates.json)）。
- 入口の数の削減は候補にしない。理由：候補Bだけで、200k Contextの一覧でASC 16件すべての説明文が残ることを、測定前の一覧の観測で確かめた（[results/listing-observations.json](results/listing-observations.json)）。入口の削減はSkill名・登録処理・本文の参照を変え、変更が大きい。Bが非劣性を満たさない場合の次の候補とする。

| 条件 | モデル（Context） | 候補 | 反復 |
| --- | --- | --- | --- |
| A | `claude-sonnet-4-5`（200k） | A | 3 |
| B | `claude-sonnet-4-5`（200k） | B | 3 |
| C | `claude-opus-5-5`（1M） | A | 3 |
| D | `claude-opus-5-5`（1M） | B | 3 |

依頼集合と採点（gold）は#1783の[cases.json](../1783-skill-coexistence/cases.json)（sha256 `846c724a04510e820f9c97b79ffe75ee285452c747bfb0648f531c21d04f2c15`）と[score.mjs](../1783-skill-coexistence/harness/score.mjs)を変更せずに使う。正例7件×3回＝21試行、負例2件×3回＝6試行が各条件の分母である。

## 指標

正例について、到達（`reach`）、本文の読込み（`bodyRead`）、手順適用（`applied`：本文・reference・回答の目印）の試行数。負例について、過剰適用（`overapplication`）の試行数。定義は`cases.json`の`scoring`のとおり。

## 判定

0. 隔離：`evals-iso`の6件（fixture外の目印fileを読めない・fixture外へ書けない・外部networkに接続できない、を2つのモデルで）がすべて合格した後でだけ、条件A〜Dを実行する。1件でも不合格なら測らず、報告する。
1. 効果（200k）：次のいずれかで「改善あり」とする。
   - Bの到達がAより3試行以上多い。
   - Bの手順適用がAより3試行以上多い。
   - 正例のいずれかで、Aの到達が1/3以下、Bの到達が3/3。
2. 非劣性（許容幅2試行）：次のすべてで「非劣性あり」とする。
   - 200k：Bの到達・本文の読込み・手順適用が、それぞれAの値−2以上。
   - 1M：Dの到達・本文の読込み・手順適用が、それぞれCの値−2以上。
   - 正例のどのケースも、対照（A・C）で到達3/3のとき、短縮側（B・D）で到達1/3以下にならない。
   - 負例の過剰適用が、短縮側（B・D）で対照（A・C）を上回らない。
3. 採否：
   - 1と2がともに成立すれば「採用」。候補Bの文面を配布Skillの`description`へ最小差分で反映する。
   - 2が成立し1が成立しなければ「不採用（効果を観測せず）」。短縮で境界の文を失う代償に見合う効果を確かめられなかったため。
   - 2が成立しなければ「不採用（劣化）」。
4. 失敗・欠測：実行失敗・API error・traceの欠落は試行の結果として扱わず、別に数える。比較では、短縮側（B・D）の失敗は不成功、対照（A・C）の失敗は成功とみなす（採用しにくい側に倒す）。再実行はしない（各条件3回まで）。条件全体の結果が無い場合は「判定不能」とし、不採用として扱う。
5. 費用上限：モデル実行の合計30 USD（`claude plugin eval`の`costUsd`、list価格推定）。suiteごとの上限はA・B各6 USD、C・D各8 USD、`iso` 1 USD。実行済みの費用から合計が30 USDを超える見込みになった時点で止め、報告する。
6. この基準・`candidates.json`・`cases.json`・条件を、評価結果を見た後に変えない。
