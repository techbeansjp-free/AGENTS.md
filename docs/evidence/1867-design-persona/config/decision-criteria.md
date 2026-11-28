# 判定の規則（#1867。モデル実行の前に固定）

対象：#1867の評価。ペルソナ調査の工程を持つデザイン作成Skillの候補（`design-creation`、[../candidate/design-creation/](../candidate/design-creation/)）を入れると、入れない場合より、ownerが良いと判断するデザインになるか。業務の画面で悪くならないか。

正本は評価の計画（[../EVAL_PLAN.md](../EVAL_PLAN.md)）である。この文書は計画の判定を、共通の測定の仕組み（[../../shared-harness/](../../shared-harness/)）の設定として書き直したもので、計画と食い違う場合は計画が正しい。評価結果を見た後に、次の固定するものを変えない（`fixation.mjs`がsha256で照合する。`conditions.json`の`fixedExtra`で`layers/`の6件を加えた）。

- 生成：この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・共通の仕組みのmodule。
- 門の数え：[layers/gate-count.json](layers/gate-count.json)・[layers/gate-count-prompt.md](layers/gate-count-prompt.md)。
- 層1：[layers/layer1-cases.json](layers/layer1-cases.json)・[layers/layer1-gold.json](layers/layer1-gold.json)。
- 層2・層3：[layers/eval.json](layers/eval.json)（判定の数値は`decision`）・[layers/lp-new-brief-for-evaluation.md](layers/lp-new-brief-for-evaluation.md)。
- 道具（sha256では照合しない。固定のcommitで名指し、各段階の前に`../harness/stage-check.mjs`が固定のcommitとの`git diff --exit-code`で照合する。`stage-check.mjs`の`TOOLS`と同じ）：[../harness/](../harness/)（`trials.mjs`・`layer-pages.mjs`・`gate-packet.mjs`・`decide.mjs`・`stage-check.mjs`・`power-sim.mjs`）、#1835の`harness/`（`run-layer1.mjs`・`make-packets.mjs`・`owner-page.mjs`・`run-eval.mjs`等）と`prompts/`（`eval.json`のsha256とも照合する）、#1852の`harness/`（`decide.mjs`の二項検定とPの判断をS/Bに戻す処理。第3回レビューのM-1）、#1804の`cases/`（P・ownerに見せる依頼文`BRIEF.md`）と`gold.json`、#1815の`cases.json`。
- 照合の時点：生成の前（`run-trial.mjs`）と、門の数え・層1・owner-page・層2・集計の各段階の前（`stage-check.mjs <段階>`。`fixation.mjs check`、渡した`--fixed-commit`が`results/fixation.json`の`fixedAtCommit`（README.mdに書く固定のcommit）であること、`git diff`、`prompts/`のsha256の4つ。結果を1行ずつ記録し、通らなければその段階を行わない）。

## 決まっていること

| 項目 | 内容 |
| --- | --- |
| 条件 | B：release v0.5.131（現在のmain `221283eb`。17 Skill）。S：Bに`design-creation`（`SKILL.md`とreferences 2件）を足した候補。どちらも`project-assets --register-claude-skill --apply`で導入し、読む契機`claude-md`を採用する。違いは`design-creation`のfileと、その配布の登録だけ（dry runで確かめる） |
| 環境 | 水準W（Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`、Bash・network・browserなし、#1840と同じ隔離の設定）。生成者は`sonnet` |
| ケース | ui02-exhibition・lp-new（公開ページ）、ui03-dashboard・ui08-existing-ds（業務の画面）。#1804の依頼文とfileは変えず、sha256で固定する（`conditions.json`の`fixtures`） |
| 依頼文 | #1804の生成の指示（`gen-prompt.txt`）をそのまま使う。Skill名とBRIEF.md以外のpathを含まない |
| 試行 | 各条件・各ケース3回、計24試行。probeは条件ごとに1回（fixture LP） |
| 人の確認の時点 | 自動の生成（対話できない実行）なので、待たずにAIの案で進む（Skillの4節） |
| 費用 | ownerの上限20 USD＝生成の台帳＋門の数え＋層2のFable（計画の「費用」）。生成の割当ては12 USD（`conditions.json`の`ownerCapUsd`・`capUsd`、停止の線11.5 USD）、門の数えは見込み2 USD（各回`--max-budget-usd 1.5`。`layers/gate-count.json`）、層2のFableの上限はmin(8, 20 −（生成の台帳の実費＋門の数えの実費）)で、6 USD未満なら層2を始めずに未判定（`layers/eval.json`の`decision.budget`、`../harness/decide.mjs cap`）。Codexは費用を報告しないので、呼出しの回数（24回。各呼出しの再試行は最大1回なので、再試行を含めて最大48回）で抑える。1試行の予算（`--max-budget-usd`）は1.5 USD（#1804の生成と同じ） |

## 判定（計画の「判定」と「層2」）

### 1. 工程が使われたか（門）

> Sの試行で、`design-creation`の`SKILL.md`が読まれ、デザインの記録に利用者の像（根拠と仮説の区別つき）と、判断と利用者の対応がある試行を数える。ケースごとに3回中2回以上なら、そのケースは判定できる。判定できるケースが3未満なら、全体を「未判定」とする。（計画）

数え方を、機械で数える部分と、記録の中身を数える部分に分ける。

- **機械（共通の仕組み）：** Sの各試行で、`SKILL.md`（`^\.agent-skill-chain/(managed-runtime/)?skills/design-creation/SKILL\.md$`）のRead（結果がerrorでないもの）があるか（`cases.json`の`expectReads`、`runs.json`の`expectReadsAll`）。ケースごとの数は、`judge.json`の`perCondition.S.checks.gate-read-<ケース>`（水準`2/3`）に出る。この水準に届かないケースは、記録の中身によらず判定できない。
- **記録の中身：** `collect.mjs`の後に、各試行のデザインの記録（`out/DESIGN-NOTES.md`。手元の`work/`の写し）を読み、次の2つが両方あるかを試行ごとに数える。
  1. (a) 利用者の像があり、その項目のすべてに根拠（出典）か仮説かが付いている。
  2. (b) デザインの判断のうち3つ以上に、どの利用者のどの要求・状況から選んだかが書かれている（計画）。
  - 数えるのは、会話を引き継がない新しいcontext（`opus`。`asc host-session claude`と同じ起動の制限の`claude -p`に`--max-budget-usd 1.5`を付けて直接起動する。読取りのみ。`layers/gate-count.json`の`host`）。promptは`layers/gate-count-prompt.md`。24試行（B・S）の記録だけを、条件名・ケース名・試行名を伏せ、乱数のIDと順序で渡す（`../harness/gate-packet.mjs pack`、seedは`layers/gate-count.json`）。画面は渡さない。Sの記録に工程の名前が出れば条件が分かるので、伏せ方は完全ではない（計画）。Bの結果は報告だけに使う。
  - 独立に2回数え、(a)・(b)それぞれ2回とも「ある」なら「ある」、割れたら「無い」とする（`gate-packet.mjs combine`）。
  - 回答が無い、JSONが読めない、一部のIDに(a)・(b)の真偽が無い回（`gate-packet.mjs check`が1で終わる）は、必ず新しいcontextで1回やり直す。やり直した回答をその回の回答とし、やり直しても答えの無いIDは「無い」とする。checkが通った回はやり直さない（`combine`が確かめる）。
  - 数えた結果（各回の回答のfile。試行ごとの可否と、該当する記録の箇所）は、層3のownerの回答と層2の結果を開く前に、記録としてcommitする。IDと試行の対応表（key）は、ownerの回答のcommitの後に開くので、`combine`はそのcommitの後に行う。
  - `pack`（`--runs-json`が必須）・`combine`・`layer-pages.mjs`は、置き換え（`--replace`）が`results/runs.json`の`counted: true`の行と一致することを確かめる。
  - 置き換えも失敗したslot（`counted: true`で`failure`のある行。有効な試行も記録も無い）は、門の数えの束に入れない（keyの`absent`）。門の数えでは「無い」として扱い、(a)・(b)・門のどれも満たさない。`combine`は、束から外したslotが`runs.json`の失敗した行と一致することを確かめる。
- ケースは、「`SKILL.md`が読まれ、1と2が両方ある」試行が3回中2回以上なら判定できる。判定できるケースが3未満（4ケース中）なら、全体を「未判定」とする。
- Skill toolで`design-creation`を呼んでも、読み込まれるのはClaude Codeの薄い入口だけで本文ではないので、本文の読込みに数えない（計画。#1815・#1840と同じ）。
- 共通の仕組みの`perCondition.S.verdict`（`meets-levels`）は、4ケースすべてが機械の部分を満たしたことだけを示し、門の結果ではない。
- Bの水準（`perCondition.B`）は計算されるが使わない。Bは`design-creation`を持たないので、読込みは構造上0件である。
- 報告するだけのもの（判定に使わない）：referenceの読込み（`reference-read`）、成果物と記録の両方を書いた試行（`written-<ケース>`、`writeOk`）、各試行の`report`（入口・本文・各referenceの読込み、ascの本文の読込み、lp-newの`inquiries.md`の読込み、書いたfileの一覧）、`writesReport`（記録に「仮説」「根拠・出典」「ペルソナ・利用者の像」の語があるか。記録の中身を数えるときの手掛かりで、門ではない）。

### 2. 層1（機械の判定）

- 共通の仕組みの外で、#1835の層1の道具を使う（モデルを呼ばない）。画面は`../harness/layer-pages.mjs`が生の記録から並べ（`<ケース>/<条件>-r<回>/original/`、記録のfileは写さない）、`run-layer1.mjs layer1 <pages> <out>/l1-<ケース> --case <ケース> --cases layers/layer1-cases.json --gold-add layers/layer1-gold.json`で描画・判定する。対象はui02・lp-new・ui03の`out/index.html`、ui08の`app/billing.html`。
- 数える単位は試行。項目は`answerInitialView`・`noOverflowX`・`axeNoSeriousCritical`・`noExternalRequests`（どれも両幅）。
- 記録：ケースごとに、層1が不合格の試行の数（3回中）をS・Bで数え、SがBより多いケースを記録する（判定に使わない）。
- **害：** ケースごとに、`axeNoSeriousCritical`が不合格の試行の数（3回中）をS・Bで数える。SがBより多いケースが2つ以上なら「不採用」。測れなかった試行と、画面の無い試行（`layer1.json`に無いslot、置き換えも失敗したslot）は不合格として数える。全4ケースに当てる（計画）。

### 3. 層2（一対比較P）：明らかな差の警報

- 共通の仕組みの外で、#1835の道具を`layers/eval.json`で動かす（`make-packets.mjs --seed 18670002 --allow-missing`は`pPairs`の12組だけPの束を作る。評価者はFableとCodex、各組2回、`run-eval.mjs --retries 1`）。
- **警報：** 両評価者が2回とも同じ側を選んだ組。**確かめられた害：** 警報がBを選び、かつownerもその組でBを選んだ組。あるケースで確かめられた害の組が3組中2組以上で、かつそのケースの層3の9組でownerがBを選んだ組がSを選んだ組より多ければ（画面の欠けで決まった勝ちは欠けた画面1つにつき1組。4.の害）「不採用」（ownerの決定 2026-11-28）。全4ケースに当てる。警報だけの件数は報告する（計画）。
- **欠けた判断：** 有効な判断の無い呼出しは、全部をSで埋めた場合と全部をBで埋めた場合で結論（5.の「採用」「不採用」「未判定」）を出し、同じならその結論（理由はSで埋めた場合のもの）、変わるときだけ「未判定」（結論の0。第3回レビューのL-4）。層2の害の有無だけが変わり、結論が同じなら未判定にしない。
- **画面の無い組：** 片方だけに画面が無ければ、画面のある側を選んだものとし（Pの判断・ownerの回答によらない）、両方に無ければ「同等」。
- #1852の記録から見積もった誤った警報の率：ownerが「同等」とした11組のうち6組（0.55）で警報が出た（計画）。
- Pの結果は、ownerの回答をcommitした後に開く。

### 4. 層3（ownerの盲検の比較）

- `owner-page.mjs --config layers/eval.json --seed 18670003 --allow-missing`（画面の無い側は「画面なし」の札。その組は上の層2の「画面の無い組」と同じ規則で決まる）。36組（`layer3.pairs`）。見せるのは画面（狭幅・広幅）と依頼文だけで、`DESIGN-NOTES.md`は見せない。順・ID・左右は乱数。選択肢はA・B・同等・判断しない（対応表でS側・B側に直す）。同等と判断しないはnから除く。回答の記録の時刻をcommitし、その後に層2の結果と門の数えの対応表を開く（計画）。
- 効果：門で判定できたケースの組だけで、nとkを数える。片側の二項検定（偶然0.5、α 0.05）。nの下限は`ceil(24×判定できたケースの数/4)`（4ケースで24、3ケースで18）。届かなければ「未判定」。
- 害：業務の画面の各ケース（ui03・ui08）で、ownerがBを選んだ組の数がSを選んだ組の数を3以上上回れば「不採用」（ownerの決定 2026-11-28）。全4ケースに当てる（計画）。害の規則を数えるときだけ、画面が欠けたことで勝ちが決まった組は、どちらの側（Sの欠けによるBの勝ち、Bの欠けによるSの勝ち）でも、欠けた画面1つにつき1組と数える（統括の決定、第3回レビューのM-2の(b)。画面1つの欠けを3対0の差として数えないため）。この数え方は、層2の「そのケースの9組でownerがBを多く選んだ」にも当てる。効果のn・kは、欠けた画面の組を1組ずつ数える。
- 組は独立ではないので、p値は目安として報告する。

### 5. 結論

> 次の順に当てはめ、最初に当たったものを結論とする。(0) 共通の仕組みの判定が`not-judged`、生成が完了せずに停止の線で止まった、層2の欠けを全部Sで埋めるか全部Bで埋めるかで結論が変わる、費用の超過（層2の上限が6 USD未満、またはFableの実費が上限を超えた）のどれかなら「未判定」。(1) 門で「未判定」なら「未判定」。(2) 層1・層2・層3のどれかで害（「不採用」の条件）に当たれば「不採用」。(3) 層3でnが下限に届かなければ「未判定」。(4) 層3で効果ありなら「採用」、無ければ「不採用」。配布するかはownerが決める。「不採用」は「この規模では効果を示せなかった」という意味である。（計画）

`../harness/decide.mjs decide`が、この順で結論（0〜4の段と理由）と各数値を出す。取り違えを防ぐため、ownerの対応表とPのkeyのseed（`eval.json`の`seeds`）、Pのkeyの回（`rounds`）、Pの台帳のheaderの`capUsd`（層2の上限）を照合し、ownerの回答の知らない選択肢とともに、違えば止まる。誤った不採用の率と検出力の見積りは計画の「規模と、誤った不採用の率・検出力」。

## 完了と費用

- `maxFailureRate`（失敗した試行の率の上限0.1）、必須の置き換え（失敗した試行1件につき1回）、停止の線は、共通の仕組みの`order.mjs`の規則のまま。停止の線に達したら、その時点で止め、結論は「未判定」とする（計画の結論の0）。足りない試行を報告する。結論の0に当たるのは、完了せずに止まった場合（`completion.capReached`で`complete`でない）だけである。24試行と必須の置き換えを終えた評価は、台帳が停止の線に近く`capReached`が真でも判定する（第3回レビューのHigh-1）。
- 置き換えた試行は、失敗した試行の回（r1〜r3）を引き継ぐ（`../harness/`の`--replace <失敗>=<置き換え>`）。
- 該当しない依頼（negative）は置かない（計画に無い）。共通の仕組みが「該当しない依頼の有効な試行が無い」ことで未判定にしないよう、`rule.negativesRequired`を`false`にした（共通の仕組みの#1867の変更）。
- 層2の上限＝min(8, 20 −（生成の台帳の実費＋門の数えの実費）)。6 USD未満なら層2を始めずに止め、「未判定」とする（計画の「費用」、`../harness/decide.mjs cap`）。有料の層2の実行には、FableとCodexのどちらにもこの値の`--cap-usd`が必須（`budget.capFromArg`。第3回レビューのL-6）。

## この測定で確かめられないこと

- 生成者にbrowserが無いため、Skillの6節のうち「描画して確かめる」部分は動かない。この部分の効果は未判定として報告する。
- networkが無いため、根拠は依頼文と置いた資料（lp-newの`inquiries.md`、ui03の`data.json`、ui08の既存のfile）に限られる。
- 読取りはfileの単位で数え、`SKILL.md`のどの節まで読んだかは確かめない。
- 確認の時点（Skillの4節）で人が指摘・指示した場合の動きは、自動の生成なので確かめない。
