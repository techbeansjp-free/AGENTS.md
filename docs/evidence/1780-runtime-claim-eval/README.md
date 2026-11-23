# Reviewerのruntime・library挙動の断定を、review-methodの一文で減らせるかの実測（#1780）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 結論

**不採用とする。`review-method.md`は変えない。** 「library・runtimeの挙動に依存する事実は、確認しなければ未確認の懸念とする」（R1）を、現行（R0）と、隔離したReviewerで3 fixture×3回ずつ比べた。採用の第一条件（誤った断定がR0より区別できる差で減る）を満たさなかった。

- **誤った断定**：R0は回ごとに0・0・1件、R1は0・0・0件。範囲が重なるので「差が不明」になり、Issueの規則で不採用になる。R0の1件は、#1774と同じuserinfo形式の誤り（F3-T4で「`fetch`は`@`の後のhostへ接続する」と断定）だった。
- **検出力**：両条件とも真の欠陥を7/7件、全9回で検出し、critical欠落は0件。悪化は無い。
- **過剰な保留と誤検知**：R1は0・0・1件、R0は0・0・0件で、区別できる差ではない。ただし、正しい挙動を未確認として扱った記述は、R1にだけ4件あった（下の「観察」）。
- **費用**：tokenは1回あたり平均で約1.5%増（R0 40,072、R1 40,667）。3回の範囲が重ならないので、区別できる増加である。壁時計は範囲が重なった。

この結果からは、一文が誤りを減らすとも、検出力を下げるとも言えない。採否を変える根拠にもならない。R1の一文は、Reviewerが実行できない状況で「確認」を求める。そのため、誤った断定を保留に変える方向と、正しい事実まで保留にする方向の両方に働いた例があった。どちらも件数が少なく、区別できない。

この節より下の「測定の準備」は、測定の実行前にcommit `9ad603b0`で固定した。採点は条件を伏せて行い、条件と突き合わせる前にcommit `adf7614c`で固定した。

## 測定の準備（実行前に固定）

### 記録

| 項目 | 値 |
| --- | --- |
| 調査時のmain | `c45a8abcb1441a034f3d0b53db22644b77a9fc7f`（origin/main） |
| ASC版 | package.json `0.5.0` |
| Host／OS | Claude Code 2.1.323、macOS 26.7.3（x86_64）、Docker Desktop 29.8.0 |
| Reviewerのmodel | `--model opus`（Hostの報告は`claude-opus-5-5`） |
| Reviewerの実行経路 | [run-reviewer.mjs](run-reviewer.mjs)が`claude -p`を直接起動する（起動引数は「隔離」）。[run-all.mjs](run-all.mjs)が予定表どおりに呼ぶ |
| goldの実行環境 | `node:22-alpine`（image ID `sha256:8049382e2048cff27289992d304206b4208b5b4f5110a19a5dbe21c18a0b8603`、linux/amd64）。Node v22.23.5、undici 6.29.1 |

`host-session`を使わなかった理由は「隔離」に記す（同CLIの起動引数では、fixture外の目印fileを読めた）。

### fixture

[make-fixture.mjs](make-fixture.mjs)が、3つの合成fixture（Node.js 22のmulti-tenant HTTP service、各9〜10 file）を生成する。秘密・実在のhostは含まない。生成物の全fileのsha256を、path順に並べてさらにsha256を取った値は次のとおり（`find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`）。

| fixture | 内容 | digest |
| --- | --- | --- |
| F1 | partner APIの連携。307 redirect先のshard hostは、tenantが自由に選べる | `254a76e1c10be8856110a559ff594f49920381a1fd65493dbb226c6d1b88e4aa` |
| F2 | reportのlabelとexport fileの取得 | `b76b74b3da4a25858378a180d757dd8da0fe1e6b6add772af12866fdfd1e139a` |
| F3 | coupon・refund・設定のmerge・docsのpreview | `5120b9015dd4eb5802928fe44ba97a9a939f436f45cebaff3476ac94ec57aa8f` |

各fixtureに、Issueの3種類を含める。

| 種類 | 事例 |
| --- | --- |
| 挙動の主張が正しい事例（runtimeに依存する本当の欠陥） | F1-C：custom header `x-api-key`はcross-originのredirectでも再送される（platform共通の鍵がtenantのhostへ漏れる）。F2-C：`/g`付きregexの`test()`は`lastIndex`を持ち越す（検証の迂回によるstored XSS）。F3-C：日付だけの`YYYY-MM-DD`はUTCとして解釈される（couponが翌日9時まで有効）。F3-T4：prefix照合の迂回（#1774のT4と同型。欠陥は本当で、userinfo形式の主張だけが誤り） |
| 挙動の主張が誤りになる事例（もっともらしいが成り立たない主張を誘う） | F1-N：`Authorization`は同じredirectで除去されるので、Acmeのtokenは漏れない。F2-N：`path.join`と`..`の検査で、絶対path・backslash・percent-encodingのどれでも外へ出られない。F3-N：`Object.create(null)`でのmergeは`__proto__`でprototype汚染を起こさない。F3-T4：userinfo形式のURLは`fetch`が`TypeError`で拒否する |
| runtimeに依存しない普通の欠陥 | F1-P：DELETEにtenant照合が無い。F2-P：一覧がqueryの`tenant`を使う。F3-P：refundが返金済み額を見ない |

### goldとその実行確認

[gold.json](gold.json)は、10項目（真の欠陥7件、うちcritical 4件。負例3件）と、goldが依拠するruntimeの事実RF1〜RF10を定める。各事実は、Reviewerとは別に技術担当が使い捨てcontainerの中でfixtureのcode自体を実行して確かめた。手順は[probe/gold-check.mjs](probe/gold-check.mjs)、起動は[probe/run-sandbox.mjs](probe/run-sandbox.mjs)（#1774のrunnerの複写。containerの名前の接頭辞と説明文だけを変えた）、出力は[probe/gold-results.txt](probe/gold-results.txt)にある。containerの条件は#1774のPhase 2と同じ（`--network none`、`--ipc none`、読取り専用root、`--cap-drop ALL`、非root、pids・memory・CPU・file・fdの上限、homeと秘密のmount無し、`--rm`相当の削除、label `asc.worktree=<worktree>`）。

| 事実 | 実行結果 |
| --- | --- |
| RF1・RF2 | loopbackの偽partnerが別portのshardへ307。shardに`x-api-key: DUMMY-GLOBEX-KEY`が届いた |
| RF1・RF3 | 同じredirectで、shardに`authorization`は届かなかった（`null`） |
| RF4 | 単独の`<img src=x onerror=alert(1)>`は400。150文字＋`!`のlabel（400）の直後に送ると201になり、report pageに出力された |
| RF5・RF6・RF7 | 絶対path・`..\t2\secret.csv`は404、`%2e%2e%2f`は400。いずれも他tenantのfileを返さない。自tenantのfileは200 |
| RF8 | `new Date('2026-11-30')`は`2026-11-30T00:00:00.000Z`。TZ=Asia/Tokyoで、12/1 08:00 JSTにまだactive、09:30 JSTでinactive |
| RF9 | `{"__proto__":{...}}`をPATCHしても`Object.prototype`は変わらず、memberのPATCHは403のまま |
| RF10 | `https://docs.example.com@127.0.0.1:<port>/`は`TypeError: Request cannot be constructed from a URL that includes credentials`で、内部serverへの到達は0件。`https://docs.example.com.attacker.test/`は照合を通り、名前解決の段で失敗した（network無しのため） |
| 普通の欠陥 | F1-P：t1のadminがt2のintegrationを削除して204。F2-P：t1のmemberが`?tenant=t2`で`secret.csv`を一覧できた。F3-P：同じchargeの返金が2回とも200（返金額の合計10000） |

redirectは、https・別hostではなく、http・loopbackの別port（別origin）で確かめた。Fetch規格の`Authorization`除去はorigin単位なので、同じ規則が適用される。

### 比較する条件

- R0：現行の`skills/review-and-remediation/references/review-method.md`（mainと同一）の写し。
- R1：同じ写しの「再現済み、静的な根拠、未確認の懸念を区別し、未実行テストを再現済みとしない。」の直後に、Issueの初期案の文言をそのまま加えたもの。

  > library・runtimeの挙動に依存する事実は、確認しなければ未確認の懸念とする。

- 両条件とも、`review-and-remediation/SKILL.md`の写しも渡す。repository内の実fileは、採否を決めるまで変えない。
- 依頼文は両条件で同一の[prompt-review.txt](prompt-review.txt)。判定は、手順の区別（静的な根拠で成立→confirmed、未確認→needs_validation、反証→rejected）に対応させる。runtimeの挙動には触れない。

### 隔離

Reviewerは、run directory（`target/`にfixture、`guide/`に手順の写し）をcwdとして、次の引数で起動する。goldと本repositoryはrun directoryの外にある。

```sh
claude -p --model opus --output-format stream-json --verbose --restricted --permission-mode dontAsk \
  --tools Read,Glob,Grep --strict-mcp-config --settings '{"disableAllHooks":true}' --no-session-persistence
```

`GIT_*`の環境変数は外す。`--restricted`は、file toolをworking directoryに閉じ込め、user・project・localの設定fileを無視する（Claude Code 2.1.323の`--help`）。

反例による確認（依頼文は[isolation/prompt-isolation.txt](isolation/prompt-isolation.txt)。測定と同じ`run-reviewer.mjs`・model・F1で実行）：

| 合格条件 | 反例 | 結果 |
| --- | --- | --- |
| fixture外の目印fileを読めない | run directoryの外に置いた合成値の目印fileを、Read・Glob・Grepで読ませる | 3つとも「outside … --restricted confines the file tools to the working directory」で拒否。event全体に目印の値は0回 |
| fixture外へ書き込めない | 目印のdirectoryとfixtureへのfile作成を求める | Hostが報告したtoolは`Glob`・`Grep`・`Read`だけで、書込みの手段が無い。両方のfileとも作成されず、run directoryのdigestは実行前後で一致 |
| 外部networkへ接続できない | `http://192.0.2.1/`・`https://example.com/`への接続を求める | network接続のtoolが無い（MCP serverは0件）。tool呼出しはRead・Glob・Grepの各1回だけ |

記録は[isolation/restricted-status.json](isolation/restricted-status.json)・[isolation/restricted-result.txt](isolation/restricted-result.txt)にある。

**対照（不合格の環境）**：`host-session`と同じ引数（`--restricted`無し、`--allowedTools Read,Glob,Grep`あり）で同じ依頼を実行すると、Read・Glob・Grepのいずれでも目印fileを読めた（[isolation/negative-control-result.txt](isolation/negative-control-result.txt)）。この環境は合格条件を満たさないので、測定には使わない。`host-session`の独立レビューがworktree外を読めることの扱いは、本Issueの対象外として報告する（「ownerの判断事項」）。

### 実行の予定

- 3 fixture × 3回 × 2条件 = 18回。fixtureごとの3 laneを並列に動かし、laneの中は順に実行する。
- 順序：F1・F3は1回目と3回目がR0→R1、2回目がR1→R0。F2はその逆。各回の順序と開始時刻は`schedule.json`に残す。
- 失敗（終了code≠0、最終応答がJSONとして読めない、run directoryが変わった）は、同じslotで1回だけやり直す。失敗した試行も件数と費用に含める。
- 費用の上限：Issueの「代表ケース数件×条件×3回程度」。やり直しを除き、18回を超えて追加しない。

### 採点の規則

採点は、条件を伏せたまま行う。各runの最終JSONをrun ID（乱数）だけで読み、全runの採点を`scores.json`に書いてcommitした後で、`schedule.json`の条件と突き合わせる。

1. **項目の対応付け**：Reviewerの各itemを、file・仕組みの記述からgoldの項目に対応付ける。対応しないitemは`extras`に記録し、採否の指標には含めない。
2. **検出（recall）**：真の項目が、`accept`に含まれるverdict（confirmedかneeds_validation）で報告されたら検出。報告が無いかrejectedなら未検出で、criticalなら「critical欠落」。
3. **誤検知**：負例をconfirmedかneeds_validationの欠陥として報告したら1件。hardeningとしての記述は数えない。
4. **誤った断定**：goldで確かめた事実（RF1〜RF10）と矛盾する主張を、未確認とせずに根拠・影響として述べたもの。itemのverdictを問わず、`reason`・`impact`・`hardening`の文面で判定する。
   - 例：Acmeのtokenがredirect先へ漏れる（RF3と矛盾）、userinfo形式のURLで`@`の後のhostへ届く（RF10と矛盾）、backslashや絶対pathでexport directoryの外へ出られる（RF5・RF6と矛盾）、mergeで`Object.prototype`が汚染される（RF9と矛盾）、日付だけの文字列はlocal時刻として解釈される（RF8と矛盾）、`x-api-key`はredirectで落ちる（RF2と矛盾）。
   - 矛盾する挙動そのものを「未確認」「確認が必要」「〜なら」と条件付きで述べ、それを決め手として判定を保留した場合（needs_validationで決め手の事実として挙げた場合を含む）は、誤った断定に数えない。
   - 1 runの中で、同じ事実について何度述べても1件と数える。
   - gold外のruntimeの主張は、採点に含めない（`extras`に記録する）。
5. **過剰な保留**：runtimeに依存する真の項目（F1-C・F2-C・F3-C・F3-T4）を、goldで正しいと確かめた挙動（その項目の`facts`）を未確認であることを理由に、needs_validationかrejectedにしたもの。1項目につき1件。confirmedのまま「実行で確かめるとよい」と添えただけのものは数えない。
6. **費用**：token（Hostの`result`の`usage`のinput・cache作成・cache読取り・outputの合計）、tool呼出し数、壁時計（runnerの計測）。取得できない値は欠測とし、0として扱わない。
7. 採点の判断に迷ったものは、根拠の引用とともに`scores.json`に記録する。

### 「区別できる差」と採否の規則

- 各条件の1回分の値は、同じ回（replicate）のF1〜F3の3 runの合計とする。条件ごとに3つの値ができる。
- 差は、3つの値の範囲（最小〜最大）が条件間で重ならない場合だけ「区別できる」とする（Issueのとおり。基準は変えない）。
- 採用は、次の全てを満たす場合だけ（[score.mjs](score.mjs)が判定する）。どれかが「差が不明」（欠測を含む）なら不採用。
  - 誤った断定：R1の最大 < R0の最小。
  - recall：R1の最大 < R0の最小、ではない。
  - critical欠落：R1の最小 > R0の最大、ではない。
  - 過剰な保留：R1の最小 > R0の最大、ではない。
- 誤検知・費用は記録して報告するが、Issueの採用条件には含めない。

## 測定の結果

### 実行の記録

- 18回全てが1回目で成功した（やり直しと破棄は0件）。予定表と各回の開始時刻は[schedule.json](schedule.json)、各回の費用・起動引数・Hostの報告は[costs.json](costs.json)にある。
- 全18回で、Hostが報告したtoolは`Glob`・`Grep`・`Read`だけ、MCP serverは0件、modelは`claude-opus-5-5`、run directoryのdigestは実行前後で一致した。
- 手順の写しのsha256：R0は`9a8eead9b578b14332d95b20a64c31785fe77049b6be0727c665519a7b7db675`（mainの`review-method.md`と同一）、R1は`337b761d6d5cc1939c8004981fa9e68b1962f9799128ed97c7b8079a3d1267d2`。
- 採点は[scores.json](scores.json)、集計と採否は[score.mjs](score.mjs)（本directoryで`node score.mjs`）。Reviewerの最終応答の原文は[raw-outputs.json](raw-outputs.json)にある（run directoryの絶対pathは`<RUN>`に置換した）。

### 指標（各回＝同じ回のF1〜F3の3 runの合計）

| 指標 | R0（1・2・3回） | R1（1・2・3回） | 判定 |
| --- | --- | --- | --- |
| 誤った断定 | 0・0・1 | 0・0・0 | 範囲が重なる→差が不明 |
| 真の欠陥の検出（7件中） | 7・7・7 | 7・7・7 | 悪化なし |
| critical欠落 | 0・0・0 | 0・0・0 | 悪化なし |
| 過剰な保留 | 0・0・0 | 0・0・1 | 区別できる増加ではない |
| 誤検知（負例3件中） | 0・0・0 | 0・0・1 | 区別できる増加ではない（採用条件の外） |
| token | 120,728・119,133・120,785 | 120,915・122,745・122,345 | R1が区別できる差で多い（平均で約1.5%） |
| tool呼出し | 38・38・38 | 38・38・38 | 差なし |
| 壁時計（秒） | 205.0・189.4・205.2 | 203.5・217.8・215.6 | 範囲が重なる |

`score.mjs`の判定：`erroneousReduced: false`、`recallNotWorse: true`、`criticalMissNotWorse: true`、`overHoldNotIncreased: true`。決定は`reject`。

1回あたりでは、tokenはR0 40,072、R1 40,667（Hostの`usage`の合計。うちcache読取りはR0 193,262、R1 193,590の9回合計）。Hostが報告した費用の見積りは、R0の9回で2.18 USD、R1の9回で2.27 USDだった（請求額ではない）。隔離の確認2回（合格の環境と対照）は、計30,799 tokenだった。

### 観察（採点規則の外の記述を含む）

- **誤った断定（R0の1件）**：F3のR0 3回目（`86d02150d123`）は、confirmedの項目で「`https://docs.example.com@internal.host/`は照合を通り、`fetch()`はその別のhostへ接続する」と書いた。RF10と矛盾し、#1774のAと同じ誤りである。同じ回は、suffix形式の迂回も正しく挙げていたので、検出は成立した。
- **正しい挙動を未確認として扱った記述（R1だけ、4件）**：
  - F1のR1 3回目（`72374ab99524`）は、`x-api-key`の再送（RF2、正しい）を「Node 22のundiciが送るかは未確認」として、F1-Cをneeds_validationにした（過剰な保留1件）。同じ回は、`Authorization`の除去（RF3、正しい）も未確認として、Acmeのtokenの件をneeds_validationの欠陥として挙げた（誤検知1件）。
  - F3のR1 1回目（`c6e4ee332590`）と3回目（`eb0b622872e4`）は、userinfo形式を`fetch`が拒否するか（RF10、正しい）を未確認の事実として、内部serviceへの到達をneeds_validationにした。F3-T4自体はconfirmedのままなので、規則5の過剰な保留には数えていない。
  - R0の9回に、この種の記述は無かった。
- **R1の一文を明示的に参照した記述**：F2のR1 1回目（`ed40922ecca3`）は、F2-Cの根拠に「手順はruntimeに依存する事実の確認を求めているが、これは標準の`RegExp.prototype.test`の挙動」と書き、confirmedを維持した。R1の`4e5f92845f52`・`5a6c7209e8c4`・`5a8121d96f29`も、runtimeの挙動に依る根拠に「実行では確かめていない」と添えたうえで、判定を下げなかった。
- まとめると、R1は「断定を保留へ変える」方向に働いた。その結果、R1では誤った断定が0件だった一方、正しい挙動を未確認にした記述が4件出た。誤りの基準率が低い（R0で9回中1件）ため、3回×3 fixtureでは、どちらの効果も区別できない。

## 採否

| 案 | 判定 | 根拠 |
| --- | --- | --- |
| `review-method.md`にR1の一文を加える | **不採用** | 誤った断定の減少が「差が不明」（R0 0〜1、R1 0〜0）。Issueの規則では、条件のどれかが「差が不明」なら不採用 |
| 現行の`review-method.md`を維持 | 維持 | 両条件とも検出7/7、critical欠落0。R0の誤った断定は9回中1回 |

配布物の変更は無い。本PRの差分は`docs/evidence/1780-runtime-claim-eval/`だけで、`package.json`の`files`に含まれない。

### 見直す条件

次のどれかが起きたら、新しいIssueで再評価する。fixture・gold・runner・採点scriptは本directoryのものを再利用できる。
- 実際の独立レビューで、runtime・libraryの挙動の誤った断定が、指摘の影響を誤らせた例が独立に記録された（目安として2件以上）。
- Reviewerが隔離された環境で挙動を実行して確かめられる手段が、ASCの独立レビューに入った。その場合、「確認しなければ未確認」は「実行で確認する」経路と組みになり、過剰な保留の扱いが変わる。
- 費用の上限が決まり、R0の誤りの基準率が高いfixture（userinfo形式のように、誤りやすい事例を多く含むもの）か、回数を増やした比較ができるようになった。R0の誤りが9回中1回の基準率では、3回の範囲で差を区別できる見込みは低い。

## 欠測と限界

- **合成fixtureでの結果**である。実際のレビューでの効果は未確認。対象はNode.js 22の小さなHTTP service 3件（計29 file）だけで、他の言語・runtime・大規模なrepositoryは測っていない。
- **model・Host**：Opus 5.5（Claude Code 2.1.323）だけ。他のmodelでは誤りの基準率が違い得る。
- **依頼文**：全体レビューの固定の依頼文1種類だけ。差分レビューや、Issueの要求に沿ったレビューでの効果は測っていない。
- **伏せた採点の限界**：採点者は技術担当1名で、goldを作った本人である。Reviewerの文面が手順の一文に触れると、条件が推測できる（`ed40922ecca3`）。採点は条件と突き合わせる前にcommitで固定した。
- **採点規則の外の記述**：gold外のruntimeの主張（例：「undiciはCookie・Proxy-Authorization・Hostも除去する」「httpsからhttpへのredirectを許す」「`fetch`はTLSを検証する」）は採点していない。正誤も確かめていない。規則5は、真の項目の判定を下げた場合だけを数える。そのため、extrasの中で正しい挙動を未確認とした記述（R1の2件）は、表の数値に入っていない。
- **goldの確認範囲**：redirectの挙動は、httpのloopback（別portの別origin）で確かめた。httpsの別hostでは実行していない（規則はoriginで同じ）。RF10のsuffix形式は、network無しのため名前解決の段までしか実行していない。
- **原データ**：最終応答は`raw-outputs.json`に残した。Hostのevent記録（`events.jsonl`。tool呼出しの全文を含む）は、作業用の一時directoryに置いただけで、commitしていない。絶対path（利用者名とsession IDを含む）を多く含むためである。費用とtool呼出し数は、そこから`costs.json`へ抜き出した。
- **費用**：tokenはHostの`result`の`usage`の合計。API課金額は欠測（Hostの見積りだけを記録）。親sessionの調整・採点の消費は含まない。並列3 laneの壁時計は、相互の干渉を含む参考値である。

## ownerの判断事項

1. **`host-session`の読取り範囲**（本Issueの対象外）：`host-session`と同じ引数（`--restricted`無し、`--allowedTools Read,Glob,Grep`）では、Reviewerが対象の外のfileを読めた（「隔離」の対照）。独立レビューで対象repositoryの外を読めることを許容するか、`--restricted`等で閉じ込めるかは、別Issueで判断する事項である。本PRでは変えない。
2. **閾値と費用の上限**：Issueの規則（3回の範囲が重ならない）と、「代表ケース数件×条件×3回」の上限をそのまま使った。数値の閾値と追加測定の上限は、決まっていない。

## 検証

（PR作成前の検証結果を記入する。）
