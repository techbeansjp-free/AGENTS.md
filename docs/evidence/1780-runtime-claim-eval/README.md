# Reviewerのruntime・library挙動の断定を、review-methodの一文で減らせるかの実測（#1780）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 結論

（測定後に記入する。この節より下の「測定の準備」は、測定の実行前にcommitで固定した。）

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
