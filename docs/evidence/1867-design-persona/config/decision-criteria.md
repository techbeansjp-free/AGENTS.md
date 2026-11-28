# 判定の規則（#1867。モデル実行の前に固定）

対象：#1867の評価。ペルソナ調査の工程を持つデザイン作成Skillの候補（`design-creation`、[../candidate/design-creation/](../candidate/design-creation/)）を入れると、入れない場合より、ownerが良いと判断するデザインになるか。業務の画面で悪くならないか。

正本は評価の計画（[../EVAL_PLAN.md](../EVAL_PLAN.md)）である。この文書は計画の判定を、共通の測定の仕組み（[../../shared-harness/](../../shared-harness/)）の設定として書き直したもので、計画と食い違う場合は計画が正しい。評価結果を見た後に、次の固定するものを変えない（`fixation.mjs`がsha256で照合する。`conditions.json`の`fixedExtra`で`layers/`の5件を加えた）。

- 生成：この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・共通の仕組みのmodule。
- 門の数え：[layers/gate-count.json](layers/gate-count.json)・[layers/gate-count-prompt.md](layers/gate-count-prompt.md)。
- 層1：[layers/layer1-cases.json](layers/layer1-cases.json)・[layers/layer1-gold.json](layers/layer1-gold.json)。
- 層2・層3：[layers/eval.json](layers/eval.json)。
- 道具（sha256では照合しない。固定のcommitで名指す）：[../harness/](../harness/)の`trials.mjs`・`layer-pages.mjs`・`gate-packet.mjs`、#1835の道具（`run-layer1.mjs`・`make-packets.mjs`・`owner-page.mjs`・`run-eval.mjs`と`prompts/`）。

## 決まっていること

| 項目 | 内容 |
| --- | --- |
| 条件 | B：release v0.5.131（現在のmain `221283eb`。17 Skill）。S：Bに`design-creation`（`SKILL.md`とreferences 2件）を足した候補。どちらも`project-assets --register-claude-skill --apply`で導入し、読む契機`claude-md`を採用する。違いは`design-creation`のfileと、その配布の登録だけ（dry runで確かめる） |
| 環境 | 水準W（Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`、Bash・network・browserなし、#1840と同じ隔離の設定）。生成者は`sonnet` |
| ケース | ui02-exhibition・lp-new（公開ページ）、ui03-dashboard・ui08-existing-ds（業務の画面）。#1804の依頼文とfileは変えず、sha256で固定する（`conditions.json`の`fixtures`） |
| 依頼文 | #1804の生成の指示（`gen-prompt.txt`）をそのまま使う。Skill名とBRIEF.md以外のpathを含まない |
| 試行 | 各条件・各ケース3回、計24試行。probeは条件ごとに1回（fixture LP） |
| 人の確認の時点 | 自動の生成（対話できない実行）なので、待たずにAIの案で進む（Skillの4節） |
| 費用 | ownerの上限20 USD＝生成の台帳＋門の数え＋層2のFable（計画の「費用」）。生成の割当ては12 USD（`conditions.json`の`ownerCapUsd`・`capUsd`、停止の線11.5 USD）、門の数えは2 USD（`layers/gate-count.json`）、層2のFableは6 USD（`layers/eval.json`の`budget.capUsd`）。Codexは費用を報告しないので、呼出しの回数（24回、各再試行は最大1回）で抑える。1試行の予算（`--max-budget-usd`）は1.5 USD（#1804の生成と同じ） |

## 判定（計画の「判定」と「層2」）

### 1. 工程が使われたか（門）

> Sの試行で、`design-creation`の`SKILL.md`が読まれ、デザインの記録に利用者の像（根拠と仮説の区別つき）と、判断と利用者の対応がある試行を数える。ケースごとに3回中2回以上なら、そのケースは判定できる。判定できるケースが3未満なら、全体を「未判定」とする。（計画）

数え方を、機械で数える部分と、記録の中身を数える部分に分ける。

- **機械（共通の仕組み）：** Sの各試行で、`SKILL.md`（`^\.agent-skill-chain/(managed-runtime/)?skills/design-creation/SKILL\.md$`）のRead（結果がerrorでないもの）があるか（`cases.json`の`expectReads`、`runs.json`の`expectReadsAll`）。ケースごとの数は、`judge.json`の`perCondition.S.checks.gate-read-<ケース>`（水準`2/3`）に出る。この水準に届かないケースは、記録の中身によらず判定できない。
- **記録の中身：** `collect.mjs`の後に、各試行のデザインの記録（`out/DESIGN-NOTES.md`。手元の`work/`の写し）を読み、次の2つが両方あるかを試行ごとに数える。
  1. (a) 利用者の像があり、その項目のすべてに根拠（出典）か仮説かが付いている。
  2. (b) デザインの判断のうち3つ以上に、どの利用者のどの要求・状況から選んだかが書かれている（計画）。
  - 数えるのは、会話を引き継がない新しいcontext（`opus`、`asc host-session claude`、読取りのみ）。promptは`layers/gate-count-prompt.md`。24試行（B・S）の記録だけを、条件名・ケース名・試行名を伏せ、乱数のIDと順序で渡す（`../harness/gate-packet.mjs pack`、seedは`layers/gate-count.json`）。画面は渡さない。Sの記録に工程の名前が出れば条件が分かるので、伏せ方は完全ではない（計画）。Bの結果は報告だけに使う。
  - 独立に2回数え、(a)・(b)それぞれ2回とも「ある」なら「ある」、割れたら「無い」とする（`gate-packet.mjs combine`）。
  - 数えた結果（試行ごとの可否と、該当する記録の箇所）は、層3のownerの回答と層2の結果を開く前に、記録としてcommitする。IDと試行の対応表は、ownerの回答のcommitの後に開く。
- ケースは、「`SKILL.md`が読まれ、1と2が両方ある」試行が3回中2回以上なら判定できる。判定できるケースが3未満（4ケース中）なら、全体を「未判定」とする。
- Skill toolで`design-creation`を呼んでも、読み込まれるのはClaude Codeの薄い入口だけで本文ではないので、本文の読込みに数えない（計画。#1815・#1840と同じ）。
- 共通の仕組みの`perCondition.S.verdict`（`meets-levels`）は、4ケースすべてが機械の部分を満たしたことだけを示し、門の結果ではない。
- Bの水準（`perCondition.B`）は計算されるが使わない。Bは`design-creation`を持たないので、読込みは構造上0件である。
- 報告するだけのもの（判定に使わない）：referenceの読込み（`reference-read`）、成果物と記録の両方を書いた試行（`written-<ケース>`、`writeOk`）、各試行の`report`（入口・本文・各referenceの読込み、ascの本文の読込み、lp-newの`inquiries.md`の読込み、書いたfileの一覧）、`writesReport`（記録に「仮説」「根拠・出典」「ペルソナ・利用者の像」の語があるか。記録の中身を数えるときの手掛かりで、門ではない）。

### 2. 層1（機械の判定）

- 共通の仕組みの外で、#1835の層1の道具を使う（モデルを呼ばない）。画面は`../harness/layer-pages.mjs`が生の記録から並べ（`<ケース>/<条件>-r<回>/original/`、記録のfileは写さない）、`run-layer1.mjs layer1 <pages> <out>/l1-<ケース> --case <ケース> --cases layers/layer1-cases.json --gold-add layers/layer1-gold.json`で描画・判定する。対象はui02・lp-new・ui03の`out/index.html`、ui08の`app/billing.html`。
- 数える単位は試行。項目は`answerInitialView`・`noOverflowX`・`axeNoSeriousCritical`・`noExternalRequests`（どれも両幅）。
- 記録：ケースごとに、層1が不合格の試行の数（3回中）をS・Bで数え、SがBより多いケースを記録する（判定に使わない）。
- **害：** ケースごとに、`axeNoSeriousCritical`が不合格の試行の数（3回中）をS・Bで数える。SがBより多いケースが2つ以上なら「不採用」。測れなかった試行は不合格として数える。全4ケースに当てる（計画）。

### 3. 層2（一対比較P）：明らかな差の警報

- 共通の仕組みの外で、#1835の道具を`layers/eval.json`で動かす（`make-packets.mjs --seed 18670002`は`pPairs`の12組だけPの束を作る。評価者はFableとCodex、各組2回）。
- **警報：** 両評価者が2回とも同じ側を選んだ組。**確かめられた害：** 警報がBを選び、かつownerもその組でBを選んだ組。あるケースで確かめられた害の組が3組中2組以上なら「不採用」。全4ケースに当てる。警報だけの件数は報告する（計画）。
- #1852の記録から見積もった誤った警報の率：ownerが「同等」とした11組のうち6組（0.55）で警報が出た（計画）。
- Pの結果は、ownerの回答をcommitした後に開く。

### 4. 層3（ownerの盲検の比較）

- `owner-page.mjs --config layers/eval.json --seed 18670003`。36組（`layer3.pairs`）。見せるのは画面（狭幅・広幅）と依頼文だけで、`DESIGN-NOTES.md`は見せない。順・ID・左右は乱数。選択肢はA・B・同等・判断しない（対応表でS側・B側に直す）。同等と判断しないはnから除く。回答の記録の時刻をcommitし、その後に層2の結果と門の数えの対応表を開く（計画）。
- 効果：門で判定できたケースの組だけで、nとkを数える。片側の二項検定（偶然0.5、α 0.05）。nの下限は`ceil(24×判定できたケースの数/4)`（4ケースで24、3ケースで18）。届かなければ「未判定」。
- 害：業務の画面の各ケース（ui03・ui08）で、ownerがBを選んだ組がSを選んだ組より多ければ「不採用」（1対0でも当たる）。全4ケースに当てる（計画）。
- 組は独立ではないので、p値は目安として報告する。

### 5. 結論

> 次の順に当てはめ、最初に当たったものを結論とする。(0) 共通の仕組みの判定が`not-judged`、生成の停止の線への到達、層2の欠け（評価者・回・組のどれか）、費用の超過の見込みのどれかなら「未判定」。(1) 門で「未判定」なら「未判定」。(2) 層1・層2・層3のどれかで害（「不採用」の条件）に当たれば「不採用」。(3) 層3でnが下限に届かなければ「未判定」。(4) 層3で効果ありなら「採用」、無ければ「不採用」。配布するかはownerが決める。（計画）

## 完了と費用

- `maxFailureRate`（失敗した試行の率の上限0.1）、必須の置き換え（失敗した試行1件につき1回）、停止の線は、共通の仕組みの`order.mjs`の規則のまま。停止の線に達したら、その時点で止め、結論は「未判定」とする（計画の結論の0）。足りない試行を報告する。
- 置き換えた試行は、失敗した試行の回（r1〜r3）を引き継ぐ（`../harness/`の`--replace <失敗>=<置き換え>`）。
- 該当しない依頼（negative）は置かない（計画に無い）。共通の仕組みが「該当しない依頼の有効な試行が無い」ことで未判定にしないよう、`rule.negativesRequired`を`false`にした（共通の仕組みの#1867の変更）。
- 生成の台帳と門の数えの費用の合計に、層2のFableの上限6 USDを足して20 USDを超える見込みになれば、層2を始めずに止め、「未判定」とする（計画の「費用」）。

## この測定で確かめられないこと

- 生成者にbrowserが無いため、Skillの6節のうち「描画して確かめる」部分は動かない。この部分の効果は未判定として報告する。
- networkが無いため、根拠は依頼文と置いた資料（lp-newの`inquiries.md`、ui03の`data.json`、ui08の既存のfile）に限られる。
- 読取りはfileの単位で数え、`SKILL.md`のどの節まで読んだかは確かめない。
- 確認の時点（Skillの4節）で人が指摘・指示した場合の動きは、自動の生成なので確かめない。
