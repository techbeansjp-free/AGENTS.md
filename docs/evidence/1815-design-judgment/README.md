# デザイン判断の取込み候補の評価（#1815）

開発時の検証資料であり、配布対象に含めない。

**結果：未判定（取り込まない）**。生成の18試行のうち、ASCの本文が読まれたのは2試行、候補の文を置いた`implementation.md`・`journeys.md`は一度も読まれなかった。固定した規則（候補の文がSの3試行中2以上で読まれなければ未判定）により、3ケースとも未判定である。順位付けはownerの判断で行わなかった。候補のSkill本文（S）は取り消し、配布しない。

## 結果

測定は統括が実行した（2026-11-26、固定の記録の7件目 `dd7b7858` の下、release v0.5.109（B）と候補（S、`5fad2293…09af`））。公開する記録は[results/run/](results/run/)（`collect.mjs`の派生の記録と、下の`decide.mjs`の出力`decision-no-ranks.json`。trace・tool log・proxyの記録・screenshotはscratchに残した）。

- **隔離の確認**：B・Sとも20項目すべて合格し、条件の間の比較も合格した（[results/run/probes.json](results/run/probes.json)。費用0.087・0.068 USD）。目印fileは確認の後に消した。
- **生成**：計画の18試行すべてが成功した（終了0、`success`、init eventのtoolとMCPの状態が測定どおり）。置換えは無し。費用は生成3.63 USD、probeを含めて3.79 USD（Hostの計算値）。model `claude-sonnet-5-5`、Claude Code 2.1.323。

| ケース | 試行 | 費用 USD | ASCの本文 | implementation.md | journeys.md | 両幅の描画（生成Agent） | 初期表示の答え 狭幅／広幅 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-03 | B-r1・B-r2・B-r3 | 0.212・0.243・0.264 | なし | なし | なし | 3/3 | 全て○／○ |
| UI-03 | S-r1・S-r2・S-r3 | 0.214・0.207・0.262 | なし | なし | なし | 3/3 | S-r2の狭幅だけ×（温度センサーが初期表示に無い）、他は○／○ |
| UI-07 | B-r1・B-r2・B-r3 | 0.154・0.146・0.136 | なし | なし | なし | 0/3（狭幅だけ） | B-r2の狭幅だけ×（運休が初期表示に無い）、他は○／○ |
| UI-07 | S-r1・S-r2・S-r3 | 0.141・0.144・0.143 | なし | なし | なし | 0/3（狭幅だけ） | 全て○／○ |
| UI-04 | B-r1・B-r2・B-r3 | 0.215・0.218・0.254 | B-r3だけ | なし | なし | 3/3 | 全て○／○ |
| UI-04 | S-r1・S-r2・S-r3 | 0.217・0.249・0.214 | S-r2だけ | なし | なし | 3/3 | 全て○／○ |

- ASCのSkill toolの呼出しは0回。UI-03のB-r3・S-r3は、ASCの外の`dataviz` Skill（試行のHOMEとconfigは空で、projectにはASCのSkillだけを置いたので、Claude Code自身が提供するSkillと推定する。init eventのSkillの一覧に、ASCの16件のほかの17件の1つとして載っていた）を呼び、`.agent-skill-chain/skills/README.md`を読んだが、ASCの本文は読まなかった。2案の描画（`alternativesCompared`）と見本の閲覧（fetch_page・view_page）は全試行で0回。
- **読込みの門**：Sの試行で本文と候補の文のreferenceを読んだのは、全ケースで0/3。規則により**3ケースとも「未判定（候補の文が読まれていない）」**、判定できるケースは0で、全体は**未判定（取り込まない）**。
- **指標**（decision-criteria.md「測れる指標」、[results/run/decision-no-ranks.json](results/run/decision-no-ranks.json)の値。失敗の試行は0なので置換えの値は使っていない）：

| ケース | I1の和 B／S（最大6） | I2の和 B／S | 指標の向き（S） | 非劣化（網羅率の最小・axe serious/criticalの最大・横scroll・外部への要求） | 規則5の害 |
| --- | --- | --- | --- | --- | --- |
| UI-03 | 6／5（S-r2の狭幅で温度センサーが欠け） | 0／0 | 悪い | 網羅率 B 1.0・S 1.0、axe B 8（B-r3）・S 0、横scroll 0・0、外部 0・0：失敗なし | **害に当たる**（指標が「悪い」） |
| UI-07 | 5／6（B-r2の狭幅で運休が欠け） | 0／0 | 良い | 網羅率 1.0・1.0、axe 0・0、横scroll 0・0、外部 0・0：失敗なし | なし |
| UI-04 | 6／6 | 0／0 | 同じ | 網羅率 0.958・0.958（後継品の品番が全試行で欠け）、axe 0・0、横scroll 0・0、外部 0・0：失敗なし | なし |

  UI-04では全試行で狭幅に3項目（改訂日・寸法図・取扱説明書）が操作の後でしか見えないが、依頼が狭幅で一覧から詳細へ移る設計を認めているので、I2（広幅）には数えない。UI-03とUI-07の差は、各条件3回のうち1試行の狭幅の1項目だけで、向きが逆であり、偶然の範囲である。規則の上ではUI-03は害のケースだが、判定できるケースが0なので、全体はどちらにしても**未判定（取り込まない）**である（規則7）。
- **順位**：ownerの判断（2026-11-26、[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1815#issuecomment-7168583280)）で、FableとCodexの順位付けは行わなかった。読込みの門で全ケースが未判定なので、順位は判定を変えない。
- **decide.mjsの実行（順位なし）**：`decide.mjs`を順位の入力なし（ranksに`-`）で実行し、出力を[results/run/decision-no-ranks.json](results/run/decision-no-ranks.json)に公開した（runs rootのpathは手で`<runs>`に置き換えた。`decide.mjs`の出力は`collect.mjs`の公開の検査を通らないので、置き換えた後に下の「公開の確認」の検索で確かめた）。これで、測定の前提を機械的に確かめた：台帳の予約・試行のdirectory・数える試行の名前の一致、固定の記録との一致（全試行の`fixationSha256`・`fixedAtCommit`）、実行の完全性（欠け0、置換え0、測定の開始後のprobe 0）、失敗0、読込みの門のreadS（Sで本文と候補の文のreferenceを読んだ試行）が全ケース0/3。`decide.mjs`の各ケースの状態は「順位待ち」、全体も「順位待ち」になる。これは、`caseDecision`が順位の有無を読込みの門より先に調べる作りのためである。確かめた値に、固定した読込みの門の規則（[decision-criteria.md](decision-criteria.md)「判定の規則」の3と、全体の6〜8）を当てはめると、3ケースとも「未判定（候補の文が読まれていない）」で、判定できるケースは0、全体は未判定（取り込まない）になる。固定したharnessのfileは変えていない。
- **主な発見**：書込みとbrowserのtoolがある、利用者に近い環境では、`CLAUDE.md`の案内文を採用していても、ASCはほとんど読まれなかった（本文2/18、referenceは0/18）。Read系のtoolだけで依頼した#1814・#1817では本文が読まれていたことと対照的である（#1817の結果：[PR #1819](https://github.com/techbeansjp-free/AGENTS.md/pull/1819)、[Issue #1817のコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1817#issuecomment-7167955108)）。原因の調査と改善は、ownerの判断で[#1820](https://github.com/techbeansjp-free/AGENTS.md/issues/1820)で扱う。
- **候補のSkill本文**：ownerの判断で配布しない。このbranchで候補の追記（`c997f274`・`bb1d1886`）を取り消し、`skills/`はmainと同じにした。[release.json](release.json)のSは、測定した候補の記録として残す。
- **公開の確認**：公開する記録に、localのpath・利用者名・一時directoryの名前・session id・mail address・token・第三者のページの本文・画像のデータが無いことを確かめた（`collect.mjs`の記録では、runs rootを`<runs>`に置き換えるので一時directoryの名前は現れなかった。`decision-no-ranks.json`はruns rootを手で置き換え、同じ検索で0件を確かめた）。

結果の限界：各条件3回で、候補の文がほぼ読まれなかったので、候補の文そのものの効果については何も言えない。読まれない原因（書込みのtoolの有無か、依頼の形か、browserのtoolか）は、この測定では分けていない。

## 段階2（再評価）

段階1（release v0.5.109）は、書込みtoolのある環境でASCがほとんど読まれず、未判定で終わった。#1820でCLAUDE.mdの案内文を直してreleaseしたので、#1815の評価をやり直す。**変えるのは版と候補の元だけ**で、判定の規則（[decision-criteria.md](decision-criteria.md)。上限40 USD、Fableとcodexの盲検の順位、8/9の規則、未判定の規則）、ケース・指標・run-order・harnessの規則は変えない。測定の時点で最新のreleaseを測定の前に固定し、両条件をその同じ版で新しく測る（#1815のownerの判断）。

| 項目 | 段階1 | 段階2 |
| --- | --- | --- |
| B | release v0.5.109 | release v0.5.113（target `72d6524c`、sha256 `750e0e73…2fe7`。SHA256SUMSとGitHubのasset digestに一致） |
| S | `bb1d1886`でpack（sha256 `5fad2293…09af`） | 同じ候補の文を、現在のmain（`72d6524c`）へ当てた`a72a3148`でpack（sha256 `6d55b3f9…9dc0`、3つの別directoryへのpackが同じsha256）。当てるときのずれは無かった（2つのreferenceは`af2ab12e`と`72d6524c`の間で変わっていない）。違うのは`release-identity.json`と2つのreferenceだけで、2つのreferenceの内容は段階1のSと同じ（[release.json](release.json)の`installedReferences`が一致） |
| 台帳・固定の記録 | `results/`（`fixation.json`、台帳はscratch） | **新しい台帳と新しい固定の記録**。`results/stage2/`（段階1の記録は上書きしない） |

候補の文は、段階1と同じく、packした後に取り消したcommitを続けた（配布物はmainのまま。採るのは判定の後）。

harnessの変更は最小で、記録の置き場所を選ぶ`harness/results-dir.mjs`（環境変数`ASC1815_RESULTS`。既定は`results`で段階1と同じ）だけ。段階2では全commandに`ASC1815_RESULTS=results/stage2`を付ける。固定の記録・probeの承認（`results/stage2/probe-approval.json`。ownerが段階2のために改めて確認する）・台帳がこの置き場所で見られ、段階1の記録や台帳では測定が始まらない。試行の公開の記録は`collect.mjs`の出力先を`results/stage2/run`にする。生のtrace・screenshot・tool logはcommitしない（[評価の記録の規約](../../../.agent-skill-chain/project/rules/evaluation-record.json)）。

段階2の開始の手順（モデルを呼ぶのはこの後）：(1) 台帳をrepositoryの外に新しく作り、`ASC1815_RESULTS=results/stage2 node harness/fixation.mjs init results/stage2/fixation.json --ledger <新しい台帳>`、(2) 固定の記録をcommit、(3) この節に最初の記録のcommitを書く（`fixation.mjs`が検査する）、(4) ownerの確認をprobe-approval.jsonに記録してから、probe、生成、順位。最初の記録のcommit：`a431ed7bfeadcdf56da28d51605b962b3db98518`。

### 段階2の結果（2026-11-27）

- 隔離の確認：B・Sとも回1で合格し、比較の差は無かった（費用0.17 USD。[results/stage2/run/probes.json](results/stage2/run/probes.json)）。目印は確認の後に消した。
- 生成：計画の18試行がすべて成功し、置換えは0（生成4.65 USD、probeとの合計4.82 USD）。公開の記録は[results/stage2/run/](results/stage2/run/)（試行の要約・読込み・指標・tool呼出しの順。生のtrace・screenshotは含めない）。
- **ASCの本文の読込み：18/18**（段階1では2/18）。v0.5.113では、書込みのtoolがある環境でも本文が読まれた（段階1から版が変わっており、原因はこの測定では分けていない。#1820の案内文の修正が一因と考えられる）。
- **候補の文のreferenceの読込み（readS）：3ケースとも1/3**（`implementation.md`。`journeys.md`はB・Sとも0/18）。Bでも`implementation.md`は3/9。本文は読まれるが、候補の文を置いたreferenceは多くの試行で読まれない。
- 指標：最初の表示で答えが見える幅の数は、ui03とui04で同じ（6対6）、ui07はSが4対3で上。非劣化の検査では、ui07のS-r2で必須の項目の被覆が0.923（ui07のほかの試行は1）で、ui07が「非劣化の失敗」になった。規則5では害のケース（`harmCases`）に当たるが、全体は規則7で未判定になる。
- 判定（[decision-no-ranks.json](results/stage2/run/decision-no-ranks.json)、順位なし）：固定した読込みの門（Sの3試行のうち2試行以上で候補の文が届くこと）を3ケースとも満たさないので、**3ケースとも「未判定（候補の文が読まれていない）」、判定できるケースは0、全体は未判定（取り込まない）**。`decide.mjs`の表示は「順位待ち」だが、これは順位の有無を読込みの門より先に調べる作りのためである（段階1と同じ）。
- 順位付け（Fable・Codex）は行っていない。固定した規則では、順位がどうでも判定は変わらない（効果ありには、判定できるケースが要る）ので、費用（Fableの予約最大8 USD）を使わないと統括が判断し、ownerへ報告した。ownerはその報告を受けて、取り込まずに閉じると決めた（2026-11-27、会話）。

結果の限界：各条件3回。候補の文が読まれない原因は分けていないが、referenceを開く条件（SKILL.mdの入口の文）が一因と考えられる。候補の文そのものの効果については、段階1と同じく何も言えない。

## 段階3（入口の文を加えた再評価）

段階2は、ASCの本文が18/18で読まれたのに、候補の文を置いたreference（`implementation.md`は各ケース1/3、`journeys.md`は0/18）がほとんど読まれず、3ケースとも未判定で終わった。ownerは2026-11-27に#1815を開き直し、**候補の文が実際に読まれる**ように、`skills/asc/SKILL.md`へ入口の文を1つ加えた案で段階3を行うと決めた。判定の規則（[decision-criteria.md](decision-criteria.md)。上限40 USD、Fableとcodexの盲検の順位2回ずつ、8/9の規則、未判定の規則、読込みの門）、ケース・指標・run-order・harnessの規則は変えない。

| 項目 | 段階2 | 段階3 |
| --- | --- | --- |
| B | release v0.5.113 | release v0.5.114（target `cbc1d006`、sha256 `30eaa420…1a5e`。SHA256SUMSとGitHubのasset digestに一致） |
| S | v0.5.113＋候補の文（2つのreference） | v0.5.114＋**同じ候補の文（`af2ab12e..bb1d1886`の2つのreferenceの差）＋SKILL.mdの入口の文1つ**。`235520a5`でpack（sha256 `8a7a86c4…2aa6`、2つの別directoryへのpackが同じsha256）。違うのは`release-identity.json`・`skills/asc/SKILL.md`・2つのreferenceだけ |
| 比べるもの | 候補の文だけ | **取込みの一式（入口の文＋候補の文）対release**。入口の文だけの効果、候補の文だけの効果は分けない |
| 台帳・固定の記録 | `results/stage2/` | **新しい台帳と新しい固定の記録**。`ASC1815_RESULTS=results/stage3`（段階1・2の記録は変えない） |

入口の文（`skills/asc/SKILL.md`の「業務操作を単位にした実装と完了」の節の末尾。195 byte）：

> 画面を作る・変える依頼は、実装前に[画面の節](references/implementation.md)、完了の確認前に[journeys.md](../user-journey-acceptance/references/journeys.md)を読む。

毎回読む`skills/asc/SKILL.md`の増加：32,764 byte → 32,961 byte（**+197 byte**。入口の文195 byteと、文を分ける空行・改行2 byte）。[評価の記録の規約](../../../.agent-skill-chain/project/rules/evaluation-record.json)に従い、PRの記録にも前後のbyte数を書く。

候補の文と入口の文は、これまでと同じく、packした後に取り消すcommitを続けた（配布物はmainのまま。採るのは判定の後）。harnessは、SKILL.mdがBと違ってよいように`release.json`の`S.differsOnly`と`installedReferences`（`.agent-skill-chain/skills/`と`.agent-skill-chain/managed-runtime/skills/`の両方の`asc/SKILL.md`を加えた）を更新しただけで、コードは変えていない。`run-trial.mjs`は導入後に`installedReferences`のsha256と照合するので、SKILL.mdの内容がSの一式と一致することも同じ検査で確かめられる（dry runでは、B・Sの導入先の差が`installedReferences.B`のfile一覧と一致することで確かめる）。導入後の`asc/SKILL.md`はproject共有用に実行場所の1文が書換えられるので、導入先のsha256は配布物のsha256と違う（BとSの両方で同じ書換え。Sの導入先に入口の文が入ることを確認した）。`.claude/skills/asc/SKILL.md`は本文へのリンクだけの入口で、条件間で同じ。

**固定の前に固定のfileを変える**：この節・[decision-criteria.md](decision-criteria.md)の「段階3」・[release.json](release.json)の変更は、`ASC1815_RESULTS=results/stage3 node harness/fixation.mjs init …`（固定の記録の作成）より前に済ませる。段階3のcommandには全て`ASC1815_RESULTS=results/stage3`を付ける。台帳は`<scratch>/rel1815c/ledger/ledger-1815s3.jsonl`（新しく作る）。最初の記録のcommit：`21e92116a7f52f390a8d6c0f2157527614d7135a`。

段階3の手順は、下の「実行の手順」を次の値に置き換えて行う：`export ASC1815_RESULTS=results/stage3`、`L=<scratch>/rel1815c/ledger/ledger-1815s3.jsonl`、tarballは`<scratch>/rel1815c/`のB・S、probeの承認は`results/stage3/probe-approval.json`、公開の記録は`collect.mjs … results/stage3/run`（`collect.mjs`は出力先を引数で決め、既にある出力先を拒否しないので、段階2の`results/stage2/run`へ書かない）。

準備の確認の記録：試験は[results/stage3/harness-tests.txt](results/stage3/harness-tests.txt)（固定の前なので、固定に依存する2件は失敗）、dry runは[results/stage3/dry-run.json](results/stage3/dry-run.json)（10の確認すべて合格）。**固定の後に`ASC1815_RESULTS=results/stage3`で試験を流し直し、54件合格・skip 0を記録してから、probeに進む。** Sの導入先に入口の文が入ることは、dry runの導入先（3ケースのSの`.agent-skill-chain/skills/asc/SKILL.md`と`.agent-skill-chain/managed-runtime/skills/asc/SKILL.md`）を入口の文で検索して確かめた（6件に当たり、Bの導入先には0件）。

入口の文の名前「画面の節」は、`implementation.md`の見出しの名前ではない。`SKILL.md`の既存の文（UIを変える場合に`implementation.md`を読む）とも一部重なる。測定する案としてはこのままにし、採る場合に文面を整える（測定前のレビューLow-3）。

順位のCodexの`--model`（上の手順の`<許可されたCodexモデル>`）：repositoryには許可されたモデルの一覧が記録されていない（[host-session](../../../skills/asc/references/host-session.md)は`'<許可されたCodexモデル>'`のまま、[subagent-model-selection](../../../skills/subagent-model-selection/SKILL.md)にもCodexのモデル名が無い）。#1807のCodexの順位は`gpt-5.6-sol`で実行された記録がある（[1807のstatus](../1807-design-eval-browser/results/run2/model-ranks/codex-status.json)）。段階3で使うモデルは、順位の前にownerが決める（未決）。

## 目的（計画）

外部のデザイン判断Skillから選んだ上位3案（両幅の初期表示の確認、判断の一文から情報の優先順位と密度を決める、意匠が未定のときだけ2案を描画して比べる）を、ASCの既存のSkillへ追記した版（S）が、現状のASC（B）より、題材と利用目的に合った画面を作らせるかを測る。ASCのSkillが読まれる状態（#1814の条件I）で比べる。効果が無ければ取り込まない。

## ownerの判断

[Issue #1815のコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1815#issuecomment-7159922599)（2026-11-25）：

- 審美：Fable・Codexの盲検の順位を各2回、採点の再現性を記録。測れる指標を併用し、両方が同じ向きのときだけ効果あり。
- 条件：条件I（現状）と、上位3案を既存のSkillへ追記した版。UI-03を含む3ケース×各3回。
- 費用の上限：40 USD。
- 配布するSkill本文には外部Skillへのリンクを載せない（Sの追記はリンクを含まない）。

2026-11-25の会話でのownerの承認（統括の記録）：

- 判定の規則の水準を、[decision-criteria.md](decision-criteria.md)のとおり承認：両評価者のU≥8/9、再現性0.5未満の評価者はそのケースで除外、効果ありが3ケース中2以上、害0、費用の中央値の比3以下、Sの3試行中2以上で本文とreferenceが読まれなければ未判定。
- 2026-11-26：組が9未満のときの比例（改善はU≥ceil(8/9×組の数)、劣化はその鏡像、有効な試行が2未満の条件があれば未判定）を承認。
- 描画用のimage `asc-1807-tools:1`の作成を承認。統括が#1807の`env/Dockerfile`（`tools`段階）から作った。image id `sha256:03213dc6…fcb8`を[conditions.json](conditions.json)の`images`に固定した。

## 条件と作り方

| 条件 | 導入するASC | 固定 |
| --- | --- | --- |
| B | release v0.5.109（target `af2ab12e`）のtarball | sha256 `05901c4b…9a4f`。SHA256SUMSとGitHubのasset digestに一致 |
| S | 候補のtarball。このbranchのcommit `bb1d1886`（`f3202f79`で取り消し済み。`c997f274`の追記に、独立レビューL-1の1文「比べるために作った採らない案は、成果物に残さない。」を加えたもの）で`node scripts/pack-candidate.mjs <新しいdirectory> --version=0.5.109` | sha256 `5fad2293…09af`（`rel1815/candidate2/`）。別のdirectoryへの2回目のpackも同じsha256。最初の候補（`c997f274`、`12c6e2c9…32ba`）は測定の前に置き換えた |

両tarballを展開して比べ、違うのは`package/release-identity.json`、`package/skills/asc/references/implementation.md`、`package/skills/user-journey-acceptance/references/journeys.md`の3つだけだった。2つのreferenceは、`af2ab12e`と`bb1d1886`のgit上のfileとbyte単位で一致した（[release.json](release.json)の`differsOnly`）。

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
- **順位**：ケースごとに、失敗でない試行の画面だけを盲検にし（IDと見る順は回ごとに変える。最大6画面）、Fable・Codexが独立に2回ずつ順位を付ける。2回の平均で、SがBより上の組の数Uを有効な組の数で数え、U≥ceil(8/9×組の数)なら「改善」（9組なら8）、U≤組の数−ceil(8/9×組の数)なら「劣化」（改善と対称。9組なら1。組の数に比例させることはownerが承認した、2026-11-26）。どちらかの条件で有効な試行が2未満、または2回の相関が0.5未満の評価者がいれば、そのケースは「未判定」。
- **判定**：ケースごとに、候補の文がSの2試行以上で読まれ、両評価者が「改善」、指標が悪くなく、非劣化の失敗が無ければ「効果あり」。2ケース以上で効果があり、害が無く、費用の比が3以下なら取り込む。読まれた試行が足りない・順位を使えないケースは「未判定」、失敗が多いケースは「保留」とし、どちらも判定できるケースに数えない。判定できるケースが2未満なら全体を「未判定」とする。
- **実行の順と置換え**：[run-order.json](run-order.json)で固定（反復が外側、UI-03→UI-07→UI-04、奇数回B→S・偶数回S→B）。[harness/run-all.mjs](harness/run-all.mjs)だけがこの順で実行し、`run-trial.mjs`は順に合わない試行を拒否する。k番目の生成の失敗は番号3+kの試行で必ず置き換え、置換えは再び置き換えない。実行器と採点は同じ関数（[harness/order.mjs](harness/order.mjs)）で数える。
- **probeの回数**：各条件1回。1回目が判定済みで不合格の場合だけ再試行を1回。測定の予約が台帳にある後のprobeは拒否する。
- **名前の一致**：採点と盲検の作成の前に、台帳の測定の予約・試行のdirectory・採点が数える（置き換えた・使わないを含む）試行の名前が一致しなければ拒否する。予約した試行のdirectoryを消すと採点できない。
- **未判定になる場合**：計画の試行と必要な置換えが欠けたまま止まった（台帳で上限に達したと示せる場合を除く。ただし測定の開始後にprobeを予約していれば、この例外は使えない）、または有効な試行の無い条件・ケースがある。採点と盲検の作成は、固定の確認に失敗するか、試行の`meta.json`の固定の記録が今の記録と違えば拒否する。

## 隔離の確認（probe）

測定の前に、各条件1回、測定と同じ起動にdebugの記録を加えて行う（[harness/probe.mjs](harness/probe.mjs)。#1814の`probe-check.mjs`の方式を、生成のtoolとMCPがある構成に合わせた）。少なくとも次を確かめる：生成Agentの文脈に祖先の`CLAUDE.md`・ownerのmemory・ownerの設定とSkill・このrepositoryの指示が無い。実HOMEとこのrepositoryの目印fileのReadが拒否され、目印の文字列がどの記録にも無い。debugの記録の指示・memory・設定のpathが試行のdirectoryかprogramの場所だけ。hookが無い。B・Sでtool・Skillの一覧・gitの件名・modelが同じ。

目印fileは実HOMEとこのrepositoryのgit管理外の`.agent-skill-chain/local/`に一時的に置くので、ownerの確認が要る。**統括がownerの確認を`results/probe-approval.json`（`{"ownerConfirmed": true, "at": "...", "reference": "..."}`）に記録してcommitするまで、目印の作成とprobeの起動は拒否される。** 計画の試行は、両条件のprobeと比較が合格するまで拒否される。

## 順位（盲検と評価者の閉込め）

- [harness/make-blind.mjs](harness/make-blind.mjs)は、回ごとに`<blind>/round<回>/`を作る。各画面は`out/index.html`と、そのHTMLとCSSが参照するfileだけを写す（比較のために作った別の案のHTML・folder・notes・参照されないfileは写さない）。写すときに、HTMLのcomment、CSSのcomment（`<style>`と写したCSS file）、SVGのcomment・`<title>`・`<desc>`・`<metadata>`（写したSVG fileとHTMLの中の`<svg>`）、charset・viewport・Content-Type以外の`<meta>`を消し、`<title>`を「画面 <ID>」に置き換える（titleが「案B」等を名指しし得るため）。JavaScriptのcommentは消さない（下の「限界」）。IDと見る順は、実行ごとに乱数で作る種から決め、種はkeysの木（`<keys>/<回>/seed.txt`）にだけ置く。作った時点で、その回のkeysの木とblindの木のsha256を台帳に記録する。blindのdirectoryは、runs・keysとは別の木でなければ拒否する。
- **評価者の閉込め（選んだ方式）**：FableとCodexの両方を`asc host-session`で起動し、対象（＝起動先）を`<blind>/round<回>`にする。このdirectoryはGitの管理外なので、起動先と、読取りを許す対象の両方がこのdirectoryになる。Fable（host `claude`）は`--restricted`で、file toolがRead・Glob・Grepだけで起動先の中に閉じる（host-sessionの記載では実測済み。ただし祖先directoryの`CLAUDE.md`の自動読込みが無いことは確定していない）。Codex（host `codex`）は、実行ごとに作るpermissions profileで対象だけの読取りを許すが、modelを呼ぶturnでの読取りの限定は未実測である（[host-session](../../../skills/asc/references/host-session.md)）。したがって、描画・順位の出力・他の回・keys・runs・このrepositoryが評価者から読めないことは、この起動の設定だけでは保証されない。二重目として次の`lock`と、精算した出力の封を併用する。
- 二重目：回の間は[harness/rank-guard.mjs](harness/rank-guard.mjs)の`lock`で、runs・keys・render・他の回のblindのdirectoryをmode 000にし、終わったら`unlock`で戻す（時刻・回・modeを記録fileに追記）。順位の出力の木（`<ranks>`、host-sessionの`--output-dir`の親）は、host-sessionが書くのでmode 000にできない。その代わり、回のdirectoryと別の木であることを`guardProblems`が確かめ、精算した出力のdirectoryは封（mode 000）をする（下）。実行中の評価者自身の出力先は、上の起動の設定の外にあるだけで、modeでは守っていない。このworktreeのevidenceのdirectoryはmode 000にしない（Gitの作業treeを壊すため）。上の起動の設定の範囲の外にあるが、Codexについては実測していない。
- **評価者は1人ずつ**：予約済みで未精算の回がある間は、次の回を予約できない。回Rでは、Fableを予約・実行・精算してからCodexを予約する。精算は、その出力のdirectoryを直ちにmode 000にする（封をする）。`reserve`と`settle`は、精算済みの出力のdirectoryが1つでもmode 000でなければ拒否する。このため、Codexが動く間はFableの出力が、2回目の間は1回目の全ての出力が読めない（第3のレビューM-1）。全ての回の精算の後に、`decide.mjs`だけが封を解き（mode 700）、そのことをrank-guardの記録に追記する。
- 台帳：各回の開始前に`budget.mjs reserve`で予約する（Fableは4 USD、Codexは0で「費用の報告なし」）。評価者×回の番号ごとに1回だけ。起動自体が失敗した場合に限り、再試行を1回だけ予約できる。終わったら、keysを開く前に（lockのまま）`budget.mjs settle`で、host-sessionの出力（`status.json`・`result.txt`）そのものを確かめて記録する：Hostとmodel、起動先と対象が回のdirectory、session id、開始が予約の後・終了が精算の前、完了したこと。`result.txt`と`status.json`のsha256・session idと、その時点のrank-guardの記録の長さとsha256を台帳に書く。Fableの費用は`events.jsonl`の`total_cost_usd`から取る。起動の失敗としての精算は、`status.json`が無いか完了でない場合だけ受け付ける。`reserve`と`settle`は、lockが掛かっていなければ拒否する。
- `decide.mjs`は、台帳の記録と照らして次を確かめ、違えば拒否する：評価者×回ごとに完了した回がちょうど1つ、`result.txt`・`status.json`が記録のsha256と同じ、精算していない予約・想定外の名前・想定外の出力directoryが無い、keysとblindの木が作成時の記録と同じ、各回の予約から精算までlockが続いていた（rank-guardの記録）、rank-guardの記録が各精算の時点の内容を先頭に保っている（追記だけ）。順位は`result.txt`の最後のJSONから取り出す。

## 運用の前提と、改変の検出の範囲

再レビューの分類に従う。

| 分類 | 内容 |
| --- | --- |
| harnessが検出する | 固定したfileの変更（fixation）、測定の試行の順・置換えの不正、予約した試行のdirectoryの削除・予約の無い試行（名前の一致）、測定の開始後のprobe、条件とtarballの組合せの誤り、imageのidの違い、試行の`meta.json`の固定の記録の違い、順位の回の過不足・未精算・出力の書換え（sha256）、keysとblindの木の書換え、lockを外した状態での順位の回、host-sessionの出力のHost・model・起動先・時刻の不一致、起動が完了したのに「起動の失敗」とした精算 |
| 今回harnessへ移した（再レビューの1〜4） | 精算でhost-sessionの`status.json`・`result.txt`を確かめてid・時刻・sha256を記録（1）、keysの種を実行ごとの乱数にしてkeysの木にだけ置き、keysのsha256を作成時に台帳へ記録してdecideが照合（2）、blindの木のsha256を作成時に台帳へ記録してdecideが照合（3）、予約から精算までlockが続いたことをdecideがrank-guardの記録で確認（4）。第3のレビューで追加：精算した出力の封（mode 000）と、封が解かれていないことのguardでの確認、評価者を1人ずつにすること、精算の時点のrank-guardの記録のsha256を台帳に残し、decideが先頭の一致を確認すること |
| 運用の前提でしか守れない | 台帳fileを手で書き換えない（行の削除・改変はharnessからは区別できない）、起動が失敗していないのに`--launch-failed`で精算しない（`status.json`も消して偽る場合は検出できない）、費用を偽らない（Fableは`events.jsonl`から取るが、そのfile自体の改変は検出できない）、評価者の出力を作らない・書き換えない（host-sessionの実行の後、精算までの間の`result.txt`の差し替えは検出できない）、rank-guardの記録を手で書き換えない（最後の精算より後の書換えと、追記の偽造は検出できない）、lockの間に手でchmodしない（guardは予約・精算の時点のmodeだけを見る） |

## 実行の手順

`<W>`はこのworktree、`<scratch>`はrepositoryとHOMEの外のdirectory。固定の記録：段階1は[results/fixation.json](results/fixation.json)（最初の記録のcommitは`877f83728b29c7f622cad97a16e5fec0b2f2d3ff`、今の記録のcommitは下の「固定」に書く）。段階2は`results/stage2/fixation.json`（最初の記録のcommitは上の「段階2（再評価）」に書く）で、下のcommandは全て`ASC1815_RESULTS=results/stage2`を付けて実行する。台帳：段階2は`<scratch>/rel1815b/ledger/ledger-1815s2.jsonl`（新しく作り、予約なし。段階1の台帳は使わない）。

```sh
cd <W>/docs/evidence/1815-design-judgment
export ASC1815_RESULTS=results/stage2   # 段階2。段階1の記録を読み直すときだけ外す
node --test harness/harness.test.mjs
node harness/dry-run.mjs <B.tgz> <S.tgz> <scratch>/run1815-dry --out <scratch>/dry-run.json   # モデルを呼ばない
L=<scratch>/rel1815b/ledger/ledger-1815s2.jsonl
# 0. 隔離の確認（results/stage2/probe-approval.jsonのcommitの後）
node harness/probe.mjs markers create <W> --ledger $L
for c in B S; do
  ASC1815_ALLOW_PAID=1 CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" node harness/run-trial.mjs <scratch>/runs probe $c 1 \
    --tarball <$c.tgz> --home-marker <home目印> --repo-marker <repo目印> --ledger $L --run
  node harness/probe.mjs check <scratch>/runs/probe/$c-r1 $c <home目印> <repo目印> <W>
done
node harness/probe.mjs compare <scratch>/runs/probe/B-r1/probe-check.json <scratch>/runs/probe/S-r1/probe-check.json --out <scratch>/runs/probe/compare.json
node harness/probe.mjs markers remove <W>
# 1. 生成（run-order.jsonの順だけ。止まったら同じcommandで続きから）
ASC1815_ALLOW_PAID=1 CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" node harness/run-all.mjs planned <scratch>/runs --tarball-B <B.tgz> --tarball-S <S.tgz> --ledger $L --run
ASC1815_ALLOW_PAID=1 CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" node harness/run-all.mjs replacements <scratch>/runs --tarball-B <B.tgz> --tarball-S <S.tgz> --ledger $L --run
# 2. 描画と指標（caseごと、--network none、固定したimage idだけ）
node harness/run-indicators.mjs <scratch>/runs ui03-dashboard <scratch>/render
# 3. 盲検（2回分を先に作る。blind・keys・runs・render・ranksは別の木）
node harness/make-blind.mjs <scratch>/runs <scratch>/render 1 <scratch>/blind <scratch>/keys $L
node harness/make-blind.mjs <scratch>/runs <scratch>/render 2 <scratch>/blind <scratch>/keys $L
mkdir <scratch>/ranks
# 4. 順位（回ごと。R=1、次にR=2）
G="--round $R --runs-root <scratch>/runs --keys-root <scratch>/keys --render-root <scratch>/render --blind-root <scratch>/blind"
node harness/rank-guard.mjs lock $G --record <scratch>/rank-guard.jsonl
#   評価者は1人ずつ：Fableの予約→実行→精算（出力に封）の後に、Codexの予約→実行→精算
node harness/budget.mjs reserve $L fable $R $G --ranks-root <scratch>/ranks
node <W>/bin/asc-v05.mjs host-session claude <scratch>/blind/round$R --name "1815 順位 Fable $R" --model fable --ephemeral \
  --prompt-file <W>/docs/evidence/1815-design-judgment/harness/rank-prompt.txt --output-dir <scratch>/ranks/fable-$R
node harness/budget.mjs settle $L rank-fable-$R --host-output <scratch>/ranks/fable-$R --guard-record <scratch>/rank-guard.jsonl $G --ranks-root <scratch>/ranks
node harness/budget.mjs reserve $L codex $R $G --ranks-root <scratch>/ranks
node <W>/bin/asc-v05.mjs host-session codex <scratch>/blind/round$R --name "1815 順位 Codex $R" --model '<許可されたCodexモデル>' --ephemeral \
  --prompt-file <W>/docs/evidence/1815-design-judgment/harness/rank-prompt.txt --output-dir <scratch>/ranks/codex-$R
node harness/budget.mjs settle $L rank-codex-$R --host-output <scratch>/ranks/codex-$R --guard-record <scratch>/rank-guard.jsonl $G --ranks-root <scratch>/ranks
#   起動が失敗した回：settle <name> --host-output <dir> --guard-record … --launch-failed（同じ引数）の後に、同じ reserve で -retry が1回だけ取れ、
#   出力先は <scratch>/ranks/<評価者>-$R-retry
node harness/rank-guard.mjs unlock $G --record <scratch>/rank-guard.jsonl
# 5. 判定と公開する記録（#1815の測定では、ownerの判断で順位付け（4）と順位を入れたdecideは行っていない。順位なしのdecideだけを実行した：上の「結果」）
node harness/decide.mjs <scratch>/runs <scratch>/render <scratch>/ranks <scratch>/decision.json --ledger $L --keys <scratch>/keys \
  --blind <scratch>/blind --guard-record <scratch>/rank-guard.jsonl
node harness/collect.mjs <scratch>/runs <scratch>/render results/stage2/run
```

### 中断からの再開

- **拒否で止まった**（上限・順・固定等）：`run-trial.mjs`は予約の前に止まるので、理由を直してから同じ`run-all.mjs`のcommandを実行する。予約済みの試行は飛ばされ、次の試行から続く。
- **モデルの実行中にCtrl-Cやkillで止まった**：予約は台帳に残り（予算額で数える）、lock file（`$L.lock`）が残る。次の順で戻す。
  1. 実行中の`run-all.mjs`・`run-trial.mjs`・`claude`のprocessが無いことを確かめる（`ps`で確認。lock fileの中身は止まったprocessのpid）。
  2. その試行のcontainerとnetworkを消す：`docker rm -f -v <prefix>-mcp <prefix>-proxy`、`docker network rm <prefix>-gen <prefix>-egress`（prefixは`asc1815-<ui03|ui07|ui04>-<b|s>-r<n>`。label `asc.evidence=1815`で一覧できる）。
  3. 試行のdirectoryの`home/`と`config/`（認証の情報を含み得る）だけを消す。**試行のdirectory自体は消さない。** `meta.json`の無い試行は生成の失敗として数えられ、計画の後に番号3+kの試行で置き換えられる。directoryを消すと、台帳の予約と合わず、採点が拒否される。
  4. lock file `$L.lock`だけを消す。台帳の行は消さない・書き換えない。
  5. 同じ`run-all.mjs planned`（計画の後なら`replacements`）のcommandで続ける。
- probeの実行中に止まった場合も1〜4は同じ。そのprobeの目印をまだ消していなければ、`probe.mjs check`で判定する（traceの欠けたprobeは不合格になる）。判定済みで不合格なので、その条件の再試行を1回だけ行える。再試行も止まった・不合格なら、その条件は測定しない。

tokenは親processの環境変数`CLAUDE_CODE_OAUTH_TOKEN`からだけ受け取り、harnessはfileを読まず、値を表示しない。子processの環境（HOME・config・PATH・DOCKER_HOSTとtoken等の固定の一覧）だけに渡し、trace・stderr・debug・proxyの記録では置き換え、試行の後に子のHOME・configを検索して件数だけを記録してから削除する。containerがmountする#1807の`env/`のfileは試行のdirectoryへ写して使い（byteで照合）、MCPの設定とdebugの記録にrepositoryのpathが出ないようにした。

### Docker image

| image | 固定したid | このmachine |
| --- | --- | --- |
| `asc-1807-tools:1`（MCP server・描画・判定） | `sha256:03213dc6d4b230f35252f8077c5a5407d1d7c40cec2fb81d5e971103b750fcb8` | あり（統括が2026-11-25に作成。playwright-core 1.49.1・axe-core 4.10.2のtgzはregistryのsha512と一致） |
| `node:22-alpine`（proxy） | `sha256:8049382e2048cff27289992d304206b4208b5b4f5110a19a5dbe21c18a0b8603` | あり |

`run-trial.mjs`・`run-indicators.mjs`は、localのimageのidが固定のidと違えば起動しない。生成のcontainer（MCP server・proxy）と`first-view.mjs`のcontainerは`--pull never`で起動する。#1807の`run-render.mjs`（描画・gold、変えていない）は`--pull never`を付けないが、`run-indicators.mjs`が起動の前にimageのidを確かめるので、固定と違うimageでは動かない。

## 準備の段階の確認（モデルを呼ばない）

| 確認 | 結果 |
| --- | --- |
| harnessの試験（[results/harness-tests.txt](results/harness-tests.txt)） | 53件すべて合格 |
| dry run（[results/dry-run.json](results/dry-run.json)） | すべて合格：組合せの受理と拒否、tarballの差が3fileだけ、3ケース×2条件のsample projectの導入と差、imageのidが固定と一致、空のHOMEでのdocker CLI、networkの作成と削除、imageでの判定（下）、`run-all.mjs`が固定の順の18試行だけを出す、`run-order.json`の妥当性 |
| imageでの判定（dry runの`imageChecks`） | 固定のimageで、#1807の`run-render.mjs`（描画・axe・gold）と`first-view.mjs`を合成の画面に実行。UI-03（800×1280・1440×900、合成の良い例・悪い例：[harness/dryrun/](harness/dryrun/)）・UI-07・UI-04の良い例は両幅でI1を満たし網羅率1.0、悪い例は満たさない。閉じた`details`・非表示・画面外の要素を含む合成の画面（[harness/dryrun/ui07-hidden.html](harness/dryrun/ui07-hidden.html)）では、閉じた`details`の中のお知らせを初期表示に無いと判定し、I2に数えた。描画の失敗0件 |
| 初期表示の判定器のhostでの確認（[results/first-view-dryrun.txt](results/first-view-dryrun.txt)） | 上と同じ判定（hostのplaywright-core 1.60.0。imageが無かった時点の記録） |

注：#1807の`gold-check.mjs`の`firstViewportMissing`は、閉じた`details`の中の文字も見えるものとして数える（ui07-hiddenで欠けを検出しない）。#1815の判定はfirst-view.mjsのI1を使い、#1807のその項目は使わない。

試行あたりの費用の見込みは0.25〜0.6 USD（#1807の手順の指示なし0.15〜0.20、2案と両幅の描画を指示した条件0.28〜0.50、ASCの本文とreferenceの読込みで増える）。18試行で約4.5〜11 USD、probe 2回で約0.3〜0.6 USD、Fableの順位2回で約4〜6 USD、合計で約8.8〜17.4 USD。生成とprobeの停止線は30 USD（上限40−余裕2−Fableの順位2回分の予約8）で、順位の予算を残す（再レビューL-d）。置換えの無い最悪（全試行が予算1.5 USD、probeが0.5 USD）は28 USDで、この停止線の内。Fableの順位2回の予約8を足して36 USDで、停止線38 USD（上限40−余裕2）の内。置換えで停止線に達した場合は、台帳の生成とprobeの費用（順位の費用は数えない。再レビューM-c）で上限に達したことが示せれば、その時点の試行で判定する。Codexの費用はHostで計算されず欠測になる（#1807と同じ）。順位の再試行（起動の失敗の後の1回）の予約までは停止線で確保していない（第3のレビューL-3）。停止線を26 USD（上限40−余裕2−Fable 3回分12）に下げると、計画の最悪（生成とprobeで28 USD）が収まらないため、30 USDのままにした。最悪の場合はFableの再試行の予約が上限で拒否され得て、その回が欠けるので、`decide.mjs`は判定を拒否し、結果は未判定（取り込まない）になる。

## #1807・#1814からの違い（意図したもの）

- 生成のfixtureを、repositoryのworktreeの配下（#1807）から、repositoryとHOMEの外へ移し、ASCをtarballから利用者の手順で導入した（#1814）。#1807では祖先の`CLAUDE.md`とmemoryが文脈に入り、ASCのSkillは`.claude/skills/`への複製だった。
- 設定の読込み元を`--setting-sources project`・hookの無効化（#1807）から、既定（userは空）・hookを無効にしない（#1814）へ変えた。利用者の状態に合わせた。導入されたsample projectにproject設定のhookは無い（dry run）。
- 認証を、hostの保管場所（#1807）から、`CLAUDE_CODE_OAUTH_TOKEN`だけで渡す方式（#1814）へ変えた。空のHOMEにはdockerのcontextが無いので、親のdocker contextから解決した`DOCKER_HOST`だけを子に渡す。
- 組込みtoolは#1807と同じ（Read・Write・Edit・Glob・Grep・Skill）。#1814のRead系だけの構成では画面を作れない。
- containerに`--pull never`とlabel `asc.evidence=1815`を付け、imageのidを固定した。mountする`env/`は試行ごとの写し。
- 隔離の確認は#1814と同じ考え方で、toolとMCPの確認を加え、ownerの確認の記録を起動の条件にした。
- 審美は、ownerの順位（#1807の計画）ではなく、Fable・Codexの2回ずつの順位（#1807の2回目と再採点の方式）。
- 指標に、初期表示の答え（両幅）と操作なしでは見えない必須情報を加えた（#1807はUI-07の狭幅・広幅の2項目だけ）。初期表示の判定では、pageの時計をデータの時刻に固定し、animation・transitionを止め、書体の読込みを待つ。数字だけの項目（例：「48」）は、前後が数字でない場合だけ一致とする。
- 公開する記録は、試行ごとの派生の記録（読込み・中心の手順・指標・費用・init eventのtoolとMCPの状態、本文を除いたtool呼出しの名前と対象）だけにした。trace・tool log・proxyの記録・screenshotはscratchに残し、repositoryに入れない（第三者のページの本文・画像、session idを公開しない）。

#1807と#1814の既存のfileは変えていない。harnessはそれらを読み込んで使い（`core-steps.mjs`・`run-render.mjs`・`render.mjs`・`gold-check.mjs`・`env/`・`install-asc.mjs`・`guard.mjs`・`ledger.mjs`・`collect.mjs`・`probe-check.mjs`の関数）、固定の対象に含めた。

## 限界

[decision-criteria.md](decision-criteria.md)「限界」に加えて：

- **候補の文とケースの適合**：Sの追記（両幅の初期表示の確認、判断の一文から優先順位と密度、方向が未定のときの2案）と、3ケースの選び方（2幅の要求があり、design systemが無い）と、指標（両幅の初期表示の答え）は、同じ考え方から作った。効果が出ても、この種の依頼に限った結果であり、選んだケースと指標が候補に合わせてあることを割り引いて読む。適用しない場面（既存のdesign systemの上、1幅だけの画面）での害は測っていない。
- **偶然**：各条件3回で、1ケース6画面である。差が無くても、1評価者あたり約0.1の確率でU≥8になる。2評価者・指標・2ケース以上を同時に求めて偶然の採用を減らしたが、除き切れない。逆に小さな効果は検出できない。
- モデルの順位であって人の評価でないこと、3案を一括で入れたのでどれが効いたかは分からないこと。
- **採らない案を残さない**：Sの追記（「比べるために作った採らない案は、成果物に残さない。」）は、測定の環境では完全には守れない。生成Agentには削除のtool（Bash等）が無いので、作った別の案のfileを消せない。盲検では`out/index.html`とその参照だけを写すので、評価者には別の案は見えない。
- 盲検の写しでは、HTML・CSS・SVGのcommentとSVGのtitle・desc・metadataを消すが、JavaScriptのcomment・変数名、classとidの名前、`data-*`の名前と値、画面の文言に残った手掛かり（例：`class="plan-b"`、「案B」と表示する文字）は消さない。写したSVG fileの中の`<style>`・`<script>`の中のcomment（CSS・JavaScriptのcomment）と、`data:image/svg+xml`として埋め込まれたSVG（HTMLやCSSの中のdata URL）の中身も消さない。

## 固定

[results/fixation.json](results/fixation.json)は追記だけの記録で、測定には最後の記録を使う。最初の記録：`877f83728b29c7f622cad97a16e5fec0b2f2d3ff`（計画の初版）。2件目（refix）：`ff3dba9eabdc03a3ae0477d1a2be730d2ee57dd0`。3件目（refix）：`79cdf7d6ad2c1c7190bef0c1276c9dcc60a7772e`。4件目（refix、独立レビューの指摘の是正）：`b5bad141fb9c8c924c6fbeb688cbfc763649916d`。5件目（refix、再レビューの指摘の是正）：`9f78bb802f0fd79d010f7066839a07414865b3ac`。6件目（refix、L-cのownerの承認の記録）：`952bf2082c6a8675080bf1ef4a7f8d0bf04fc7e9`。7件目（refix、第3のレビューの指摘の是正）：`dd7b785886c9d5e329e0d724a90b0531f8bc6504`。測定はこの最後の記録で行う。どの記録の時点でも台帳に予約は無い。

注：4件目のrefixの理由の文は「Medium 5・Low 6」と書いたが、是正したLowはL-1〜L-7の7件だった（記録は追記だけなので直さず、5件目の理由で訂正した）。

注：2件目のrefixの`changed`に#1814のfile（`probe-check.mjs`・`score.mjs`）が載っているのは、固定の対象にそれらを新しく加えた（1件目の記録には無かった）ためで、#1814のfileを変えたのではない。#1814・#1807のfileは、このIssueでは一度も変えていない。

## 未決

なし。有料の測定は、ownerが上限40 USDで承認した（2026-11-25、[Issue #1815のコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1815#issuecomment-7159922599)）。測定は終わり、Issueは未判定として開いたままにする（ownerの判断、2026-11-26）。ASCが書込みのtoolのある環境で読まれない問題は、[#1820](https://github.com/techbeansjp-free/AGENTS.md/issues/1820)で扱う。
