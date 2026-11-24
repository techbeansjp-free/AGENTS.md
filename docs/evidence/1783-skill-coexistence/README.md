# 他Skillとの共存時のASC Skill選択の検証と採否（#1783）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 結論

**判定は「不採用」とする（事前に固定した[採否基準](decision-criteria.md)の4。判定の対象は、モデル実行を行った1M Context（`claude-opus-5-5`）の条件である。200k Contextは一覧の観測だけで、採否は判定していない）。ASC固有の仕組み・Skillのdescription・配布処理は変更しない。基準4が許すHost設定の案内だけを、`v05/USAGE.md`の既存の節へ1段落追記する。**

- 問題は実在する。Claude Code 2.1.323・1M Context（`claude-opus-5-5`）では一覧の予算が30,000文字で、ASC単体では起きず、他のSkillとの共存時だけに起きる。使用回数0の個人用Skillが70件（各400文字以下）あると、projectに登録したASC 16件のうち15件の説明文が省かれ、名前だけになった（隔離環境での要求本文の観測）。
- Context容量200kのモデル（`claude-haiku-4-5`・`claude-sonnet-4-5`で観測）では予算が8,000文字で、**ASC単体でも同梱Skillと合わせて超過し、ASC 16件のうち11件の説明文が省かれた**（`asc`は残った）。この観測はモデル実行の後、再レビューの指摘を受けて追加したもので、採否基準の対象外である。全descriptionを60文字に短縮すると13/16が残った。選択精度への影響は測っていない（「Context容量の小さいモデル」）。
- この状態（C）では、正例の到達が21試行中14試行に下がった（説明文が残るBは14/14）。`asc`の再開依頼は0/3（Bは2/2）で、3回中2回が`execution-recovery`へ流れ、1回はどのSkillも選ばなかった。レビュー依頼は0/3で、説明文が残る同梱の`code-review`へ流れた。名前から用途が読める`tracker-issue-writing`・`security-evidence`・`migration-assurance`・`research-to-implementation`は、名前だけでも3/3到達した。
- 既存の直接参照経路（`v05/USAGE.md`の任意の文例。F）を加えると、到達は21/21へ戻った。ただし固定した手順適用の判定（本文・reference・回答の目印）はF 14/21、B 11/14で、基準3の「Bとの差2試行以内」は反復回数の違う比べ方で結果が分かれる（失敗数の差4・Bを21試行へ換算した差2.5は不成立、Fを14試行へ換算した差1.67と成功数そのままの比較は成立）。結果を見て有利な読み方を選ばないよう、表の読み方すべてで成立する場合だけ成立とする扱いにより、基準3（利用手順の限定改善）を不成立とした。この扱いは事後の決定である（「採否」）。外れた7試行はすべて本文とreferenceを読んでおり、回答の目印だけが無かった。
- 1M Contextで基準4により探した製品側の変更は、劣化したSkillの可視性を安定して回復しなかった。全descriptionを60文字に短縮すると、説明文が残ったのは16件中2件（`asc`と`contract-enforcement`）だった。`asc`が残ったのは、ASCより前に並ぶ個人用Skillが使い残した予算に収まったためで、前に並ぶSkillが1件増えれば失われうる。レビュー依頼で劣化した`review-and-remediation`は名前だけのままだった。可視性を回復したのは、Host設定（`skillListingBudgetFraction`、`SLASH_COMMAND_TOOL_CHAR_BUDGET`、`skillListingMaxDescChars`、`skillOverrides`）だけだった。これらは利用者の設定であり、ASCの配布物からは変えない（ADR 0005、#1642の契約）。
- Codexは別の仕様（既定でContextの2%、repo scopeを個人用より先に残す、使用頻度を使わない）で、同じ劣化は同じ形では起きないと読める。実機では測っていない。

後続の提案：200k Contextのモデルを使う利用者では、ASC単体でも専門Skillの説明文が省かれる。description短縮（または入口の数の削減）が選択・適用の精度を保つかを、#1652と同じ依頼集合で測る別Issueを提案する。測るまでは配布物を変えない。

見直し条件：上の後続評価で非劣性が示された場合、Claude Codeが一覧の順序・予算・`skillOverrides`の仕様を変えた場合、projectから一覧の優先度を指定できる手段が提供された場合、またはASCの入口の名前（`asc`）を変える提案が出た場合。

## 対象版と実行環境

| 項目 | 値 |
| --- | --- |
| 調査基点 | main `c45a8abcb1441a034f3d0b53db22644b77a9fc7f`（ASC `package.json` 0.5.0） |
| oracleと採否基準の固定 | モデル実行の前にcommit `2e09cf3e000c2fd6353523fcdfc2176c9e3d9c75`で固定した。採点script [harness/score.mjs](harness/score.mjs)はこのcommitの後、条件Aの実行中に`cases.json`の`scoring`の定義どおりに書き、Aの採点前に完成した。以後、`cases.json`・採否基準・採点に使うharnessは変えていない。モデル実行の後、レビューの是正で`run-suite`の終了code・欠落の記録、`analyze-listing.mjs`の行の解析（1M Contextの結果は不変を確認）、`build-listing-results.mjs`と200k Contextの条件を追加した。実行時の`run-observe`・`run-suite`は同じ処理のshell scriptで、CIの言語規約（TypeScript/JavaScript以外のsourceを拒否）に合わせてNode版へ置き換え、Node版でも条件Aの一覧観測と隔離確認の3件が同じ結果になることを確かめた（[cases.json](cases.json) sha256 `846c724a04510e820f9c97b79ffe75ee285452c747bfb0648f531c21d04f2c15`、[decision-criteria.md](decision-criteria.md) sha256 `59331ccdd388f1f4a404588a59470c67fc19d97887f9fac0bb4f74310cbae10b`） |
| Host | Claude Code 2.1.323（macOS上の実Hostと、同版のLinux build） |
| モデル | `claude-opus-5-5`、Context容量1,000,000 tokens（`/context`の表示） |
| 隔離環境1（一覧の観測） | Docker 29.8.0、`node:22-alpine`にClaude Code 2.1.323を導入した使い捨てcontainer。`--network none`、read-only root、HOMEはtmpfs、秘密・HOMEのmountなし、メモリ1GB・CPU 2・pids 256、label `asc.worktree`。モデルの代わりに同じcontainer内のcapture server（[harness/capture-server.mjs](harness/capture-server.mjs)）へ接続する |
| 隔離環境2（モデル実行） | `claude plugin eval`（Claude Code 2.1.323）。runごとに一時HOME・一時設定・一時作業ディレクトリを作り、利用者の設定・Skill・CLAUDE.md・plugin・memoryを読み込まない（公式資料「How runs are isolated」）。toolは`Read`・`Glob`・`Grep`・`Skill`・`ToolSearch`だけ（`Agent`・`TaskStop`は`--disallow-tools`で除外） |
| Codex | 実機測定なし。公式資料と`openai/codex`のsource（mainのcommit `f64f003d985ae59e82b4c63b37fe8c494d203ce9`、最新tagは`rust-v0.172.0`）で確認した。ローカルのCLIは0.171.0で、版の差は確認していない |

利用者の実環境（`~/.claude`、`~/.claude.json`、このrepositoryの`.claude/`）は使っていない。一覧の観測はcontainer内の空のHOMEで行った。モデル実行を実HOMEで行わなかった理由は、`claude -p --no-session-persistence`でもSkillを呼ぶと`~/.claude.json`の`skillUsage`が増えることを観測したため（下記F-invoke）。利用者の使用回数を変えると、その人の一覧の順位が変わる。

## 現行ASCの配布Skill

[inventory.json](inventory.json)（`node harness/inventory.mjs <repo>`）。

- 標準配布16件、任意導入1件（`model-deliberation`、Codexへの明示採用のみ）。
- 標準16件のdescriptionは合計1,992文字、最長は`decision-ownership`の283文字。Claude Codeの個別上限（`description`と`when_to_use`の合計1,536文字）と、Codexの一覧での上限（1,024文字）を下回る。
- Host登録元：`project-assets --register-claude-skill`で`.claude/skills/<name>/SKILL.md`（Claude Codeではproject scope）、`--register-skill`で`.agents/skills/<name>/SKILL.md`（Codexではrepo scope）。入口はnameとdescriptionを配布元から複写し、本文は`.agent-skill-chain/skills/<name>/SKILL.md`を指す。
- `references/`を持つのは12件（`asc`は7件）。`estimate-and-scope`・`subagent-model-selection`・`tracker-issue-writing`・`work-coordination`は本文だけである。

## 既存の評価資産との関係

- #1652（PR #1653）：依頼集合（`skills/README.md`の「依頼・状況」に沿う自然文、15 Skill×2件と対照2件）と採点（`Skill` toolでの呼出しまたは配布本文の`Read`を到達とし、入口だけを開いたものは数えない）をPR本文で確認した。harnessはrepositoryに残っていない。
- 本評価の[cases.json](cases.json)はその依頼集合から、`asc-1`・`asc-2`・`se-1`・`ma-1`（同文）と`ri-1`（#1652の`ri-2`と同文）を再利用した。`rr-1`は、fixtureにGit履歴が無く`Bash`も無いため、対象ファイルを指定する文に変えた。`tw-1`（起票）は#1652の集合に無いため追加した。負例2件は#1652の対照と同じ趣旨の文である。到達の定義は#1652と同じで、本文・reference・回答の目印による手順適用の判定を加えた。
- #1654（PR #1655）：`research-to-implementation`と`engineering-judgment`のdescriptionの境界を直した変更で、この評価の基点に含まれる。#1652の`ri-1`（BullMQの比較）は#1654の対象だが、本評価では用いていない。

## 状態の分け方

次を別の状態として記録した。

1. 配布：`project-assets`が入口と本文を配置した（ファイルの有無）。
2. 登録：Hostが入口を読み込んだ（debug logの`Loaded N unique skills`、`/context`のSource列）。
3. 可視性：モデルへ送られた一覧に、そのSkillのdescriptionがあるか、名前だけか（capture serverが受け取った要求本文）。
4. 選択：`Skill` toolで呼んだ、またはその本文を`Read`した（trace）。
5. 本文読込み：本文（`.agent-skill-chain/skills/<name>/SKILL.md`）を`Read`した。`Skill` toolで読み込まれるのは入口だけである。
6. 手順適用：本文と必要なreferenceを読み、回答に固定の目印がある（[cases.json](cases.json)）。

3はcapture serverの記録だけで判定し、モデルの自己申告を根拠にしない。モデル実行（隔離環境2）では要求本文を観測できないため、同じSkill構成を隔離環境1で観測した結果を対応させた。

## Claude Codeの仕様（公式資料と実Host）

公式資料（2026-11-24に取得）：[Skills](https://code.claude.com/docs/en/skills)の「Skill descriptions are cut short」「Find unused skills」、[Settings reference](https://code.claude.com/docs/en/settings-reference)、[Environment variables](https://code.claude.com/docs/en/env-vars)、[Plugin evals](https://code.claude.com/docs/en/plugin-evals)。

| 項目 | 公式資料 | 2.1.323での観測 |
| --- | --- | --- |
| 一覧予算 | Context容量の1%に比例。`SLASH_COMMAND_TOOL_CHAR_BUDGET`は「既定はContextの1%、fallbackは8,000文字」 | 1M Contextで30,000文字（debug log `... > 30000 budget`） |
| 超過時 | 名前は全て残し、使用回数の少ないSkillから説明文を省く | 一致。省かれた行は`- <name>`だけになる |
| 優先順位 | 使用回数の多いSkillの説明文を残す | 使用回数が同じ（0回）なら一覧の順（個人用→project→plugin。pluginは読込み順）に先頭から残った。後ろの短い説明文（97文字の`contract-enforcement`）も残ったので、残りの予算に収まるものを詰めると見られる（推定）。同梱Skillは一覧の末尾だが、`security-review`以外は説明文が残った。使用回数20回のASC 6件は説明文が残った（C-usage-asc） |
| 個別上限 | `description`＋`when_to_use`で1,536文字。`skillListingMaxDescChars`で変更 | `skillListingMaxDescChars: 200`で全99件に説明文が残った（E-maxdesc-200） |
| 予算の変更 | `skillListingBudgetFraction`（既定0.01、any file）、`SLASH_COMMAND_TOOL_CHAR_BUDGET`（文字数） | 0.02または60000で全99件に説明文が残った |
| `skillOverrides` | `on`／`name-only`／`user-invocable-only`／`off`。plugin Skillには効かない。`/skills`メニューは`.claude/settings.local.json`へ書く | `name-only`の行は予算超過で省かれた行と同じ形式だった（N-overrides-asc）。個人用40件を`name-only`にすると、ASC 16件の説明文が残った（E-overrides-nameonly） |
| 名前の競合 | enterprise＞personal＞project。pluginは名前空間で併存 | 個人用`review-and-remediation`がprojectのASC入口を置き換えた。debug logに警告はなく、`/context`のSourceが`User`になる（X-collision） |
| 名前だけのSkill | 呼び出せるが、自分から選ぶ可能性は下がる | capture serverが名前だけの`asc`を`Skill` toolで呼ぶと、Hostは入口を読み込んだ（F-invoke） |
| 使用回数の記録 | 記載なし | `-p --no-session-persistence`でも`~/.claude.json`の`skillUsage`に記録された（F-invoke） |

設定の適用範囲：3つのsettingsはいずれも「Any file」（user・project・local・managed・`--settings`）。環境変数は設定の段階と別に扱われる。どれも利用者または組織の設定であり、ASCの配布物から変更しない。

### 診断機能が観測できるもの

| 診断 | 観測できたこと | 観測できなかったこと |
| --- | --- | --- |
| `--debug`／`--debug-file` | 超過の警告（Skill数、文字数、予算）、読込み元別の件数 | どのSkillの説明文が省かれたか |
| `/context`（`-p`でも無料で実行できる） | Skills行の合計（超過時は約10k tokens＝予算）、Skillごとの推定token、Source | 省略の有無の正確な判定。超過した4条件すべてで、要求本文では名前だけの`asc`が約60 tokens（説明文あり相当）と表示された。名前だけの他のSkillは`< 20`と表示された |
| `/doctor`（モデルを使うSkill） | 公式資料では一覧の推定費用と大きい要因。条件Cでは、モデルが自分のContextを見て「`project:*`は`contract-enforcement`以外に説明文がない」と報告した（自己申告であり判定の根拠にしない） | 隔離環境では設定directoryを読めず、使用回数に基づく推奨は出なかった |
| `/skill-doctor` | 公式資料ではSkillごとの費用と使用回数、未使用Skillの一覧 | `claude plugin eval`のrunと、network無しのcontainerでは使えなかった（feature flagの取得が必要）。実HOMEでは試していない |
| capture server（本検証のharness） | モデルへ送られた一覧そのもの | 実モデルの選択（別に測る） |

## Codexの仕様（独立に確認）

Claude Codeの設定はCodexに適用されない。Codexの一覧は[公式資料](https://developers.openai.com/codex/skills)と`codex-rs`のsource（`ext/skills/src/render.rs`ほか）で確認した。実機では測っていない。

- 予算：既定はContext容量の2%（4 bytes/tokenで換算）。Context容量が不明なら8,000文字。`skills.max_context_tokens`で変更でき、上限10,000 tokens。
- 超過時：まず説明文を全Skillへ均等に短くし、名前と場所だけでも収まらなければ末尾から一覧に載せない。省いたときは警告を出す。
- 順序：scope（System→Admin→Repo→User）、名前、pathの順。使用頻度は使わない。ASCを`.agents/skills`に登録するとRepo scopeになり、個人用（User scope）より先に残る。
- 個別上限：一覧の説明文は1,024文字で切る。
- 無効化：`[[skills.config]]`の`path`または`name`と`enabled = false`。Skillごとの`allow_implicit_invocation`で暗黙の起動を止められる。
- 名前の競合：統合せず、両方が選択肢に出る（優先順位の記載なし）。

したがって、Claude Codeで観測した「個人用Skillが多いと未使用のproject登録のASCが名前だけになる」は、Codexでは同じ形では起きないと読める。ただし実機では確認していない。

## 一覧の観測（隔離環境1）

条件は[listing-conditions.json](listing-conditions.json)と[plugin-listing-conditions.json](plugin-listing-conditions.json)、結果は[results/listing-observations.json](results/listing-observations.json)。合成Skillは[harness/make-skills.mjs](harness/make-skills.mjs)が作る非機密の文面で、descriptionは最大400文字（単語の境界で切るため396〜400文字）。集計は[harness/build-listing-results.mjs](harness/build-listing-results.mjs)。X-collisionでは、置き換わった個人用`review-and-remediation`（62文字）を「ASCの説明文あり」に数えている（ASCの入口自体は一覧に無い）。

| 条件 | 一覧の件数 | 説明文あり | ASCの説明文あり | 一覧の文字数 | debug logの警告 |
| --- | --- | --- | --- | --- | --- |
| A ASC単体 | 29 | 29 | 16/16 | 8,572 | なし |
| B 個人用40件と共存 | 69 | 69 | 16/16 | 25,537 | なし |
| C 個人用70件と共存 | 99 | 67 | **1/16** | 29,877 | 99件、40,010文字＞30,000 |
| C 合成をpluginで70件 | 99 | 71 | 16/16 | 28,065 | 超過（plugin側が省かれる） |
| C＋ASCを20回ずつ使用（6件） | 99 | 70 | 6/16（使用した6件） | 29,367 | 超過 |
| C＋個人用を5回ずつ使用 | 99 | 67 | 1/16 | 29,877 | 超過 |
| D ASCのdescriptionを60文字に短縮 | 99 | 68 | 2/16 | 29,902 | 超過 |
| E `skillListingBudgetFraction: 0.02` | 99 | 99 | 16/16 | 38,277 | なし |
| E `SLASH_COMMAND_TOOL_CHAR_BUDGET=60000` | 99 | 99 | 16/16 | 38,277 | なし |
| E `skillListingMaxDescChars: 200` | 99 | 99 | 16/16 | 20,630 | なし |
| E 個人用40件を`skillOverrides`で`name-only` | 99 | 59 | 16/16 | 22,274 | なし |
| PE-C（モデル実行Cと同じ構成。ASCをplugin `project`として合成plugin `toolbox`の後に読込む） | 99 | 66 | 1/16 | 29,886 | 超過 |
| PE-C（ASCのpluginを先に読込む） | 99 | 72 | 16/16 | 28,216 | 超過 |

読み取れること：

- 1M ContextのASC単体（A）では予算の29%しか使わず、説明文は全て残る。200k Contextでは別である（次節）。
- 劣化は他のSkillとの共存時だけに起きる。どのSkillが省かれるかは、Skillの数より、一覧の順序と使用回数で決まる。使用回数0の個人用Skillはprojectより先に並ぶため、ASCが省かれる。pluginはprojectより後に並ぶため、plugin側が省かれる。
- 一度使ったASC Skillは説明文が残る。使用回数の少ない専門Skill（監査・移行等）ほど省かれやすい。
- descriptionの短縮（D）は、ASCより前に並ぶSkillが予算を使い切るため、ほとんど効かない（1/16→2/16）。増えた1件は`asc`で、残り予算（警告の合計はCより1,924文字少ない。短縮で減る量1,032文字との差の原因は未確認）に収まったためである。
- Hostの設定（E）はどれも可視性を回復した。

## Context容量の小さいモデル（隔離環境1、追加観測）

再レビューで「1M以外のContext容量では予算の前提が変わる」と指摘されたため、モデル実行の後に追加した。条件は[small-context-conditions.json](small-context-conditions.json)、結果は[results/listing-observations-small-context.json](results/listing-observations-small-context.json)。採否基準の対象外として扱う。

| 条件（ASC単体） | Context | 一覧の件数 | 説明文あり | ASCの説明文あり | debug logの警告 |
| --- | --- | --- | --- | --- | --- |
| `claude-haiku-4-5` | 200k | 29 | 17 | **5/16** | 29件、10,305文字＞8,000 |
| `claude-sonnet-4-5` | 200k | 29 | 17 | **5/16** | 同上 |
| haiku＋ASCの6件を20回ずつ使用 | 200k | 29 | 19 | 7/16（使用した6件と`contract-enforcement`） | 同上 |
| haiku＋全descriptionを60文字に短縮 | 200k | 29 | 25 | 13/16 | 29件、8,381文字＞8,000 |
| haiku＋`skillListingBudgetFraction: 0.02` | 200k | 29 | 29 | 16/16 | なし |

- 予算は8,000文字で、1%×200k×4文字/tokenと一致する（`skillListingBudgetFraction: 0.02`で警告が消えたので、Context容量に応じて計算されている）。1M Contextの30,000文字は同じ計算（40,000文字）より小さく、上限がある可能性がある（未確認）。
- ASCの16件と同梱の13件だけで超過する。説明文が残ったのは`asc`から`estimate-and-scope`まで（名前順の先頭5件）で、`review-and-remediation`・`security-evidence`・`migration-assurance`・`tracker-issue-writing`・`research-to-implementation`等の11件は名前だけになった。同梱Skillは`security-review`以外の説明文が残った。
- 1M Contextと違い、ここではdescriptionの短縮が効く（13/16）。ただし短縮後の文面で選択・適用の精度が保たれるかは測っていない。#1652・#1654はdescriptionの用途と境界の書き方で到達が変わることを示しており、短縮はその改善を失う恐れがある。
- 200k Contextでのモデル実行は行っていない。名前だけになった`review-and-remediation`がレビュー依頼で同梱の`code-review`へ流れるかは、1M Contextの条件Cから類推できるだけである。

## モデル実行の対照評価（隔離環境2）

構成：[harness/make-eval-suites.mjs](harness/make-eval-suites.mjs)。fixtureの`.claude/skills`は`claude plugin eval`で読み込まれないため、ASCの16入口を`project`という名前のpluginに入れ直した（[harness/make-asc-plugin.mjs](harness/make-asc-plugin.mjs)。name・descriptionは同一。本文へのリンクだけを作業ディレクトリ基準へ書き換えた）。合成Skillは`toolbox` plugin（40件または70件、各400文字以下、ASCと用途が重ならない文面）。

| 条件 | 構成 | 反復 | 一覧の状態（隔離環境1の同構成で観測） |
| --- | --- | --- | --- |
| A | `project`だけ | 2 | ASC 16/16に説明文 |
| B | `toolbox` 40件→`project` | 2 | 全件に説明文（予算内） |
| C | `toolbox` 70件→`project` | 3 | 予算超過。ASCは`contract-enforcement`以外の15件が名前だけ（PE-C） |
| F | Cと同じ。`append_system_prompt`に`v05/USAGE.md`「ASCを読む契機を利用先へ採用する（任意）」の文例（`2e09cf3e`の版、298文字、sha256 `7b3c5054f8a73d15a9d8b54beebc49f7864d6b2eae34436d7c35f05ca1e308cb`） | 3 | Cと同じ |

実Hostでの対応の確認：各条件で`/context`を実行した（`evals-diag`、費用0）。Skills行はA 3k、B 8.7k、C 10k tokensで、Cは予算に達していた。`toolbox`の行のうち`< 20`（名前だけ相当）は実Hostで18件、隔離環境1のPE-Cの要求本文では名前だけが17件だった。同梱Skillは実Hostに`schedule`が1件多く（14件）、その分だけ予算が減ったためと見られる（未確認）。`/context`の個別行ではCの`project:asc`が約60 tokensだったが、隔離環境1では同じ表示のときに要求本文で名前だけだったので、個別行からは判定していない。

隔離の確認（`evals-iso`、反例）：fixture外の目印fileの`Read`は「don't ask mode」で拒否され、目印の文字列はtraceに無かった。書込み・network系のtool（`Write`・`Edit`・`Bash`・`WebFetch`・`WebSearch`）はsessionに無く（sessionのtool一覧は[results/suites.json](results/suites.json)の`sessionTools`・`modelRunTools`）、目印fileは作られず、network系toolの呼出しも無かった。3件とも合格した後でモデル実行を行った。

結果（[results/summary.jsonl](results/summary.jsonl)、試行ごとは[results/runs.json](results/runs.json)。失敗・API error・timeoutは0件）：

| 指標 | A | B | C | F |
| --- | --- | --- | --- | --- |
| 正例の到達 | 14/14 | 14/14 | **14/21** | 21/21 |
| 誤選択 | 0/14 | 0/14 | 6/21 | 0/21 |
| 未選択 | 0/14 | 0/14 | 1/21 | 0/21 |
| 本文の読込み | 14/14 | 14/14 | 14/21 | 21/21 |
| referenceの読込み（分母は正例の全試行） | 14/14 | 14/14 | 14/21 | 21/21 |
| 手順適用（本文・reference・回答の目印） | 11/14 | 11/14 | 12/21 | 14/21 |
| 期待外のSkill呼出し（正例） | 0 | 0 | 5 | 0 |
| 合成Skillの呼出し | 0 | 0 | 0 | 0 |
| 目的別一覧（README）の読込み | 0/18 | 0/18 | 1/27 | 14/27 |
| 負例の過剰適用 | 0/4 | 0/4 | 0/6 | 0/6 |

ケース別（A＝適用、R＝到達したが目印なし、M＝誤選択、U＝未選択、-＝負例で適用なし）：

| ケース | 想定Skill | A | B | C | F |
| --- | --- | --- | --- | --- | --- |
| asc-1 開始 | asc | AA | AA | MAA | AAA |
| asc-2 再開 | asc | AA | AA | **MUM** | RRA |
| rr-1 レビュー | review-and-remediation | AA | AA | **MMM** | AAA |
| tw-1 起票 | tracker-issue-writing | AA | AA | AAA | AAA |
| ri-1 技術調査 | research-to-implementation | RR | RR | AAR | RRR |
| se-1 監査 | security-evidence | AA | AA | AAA | AAA |
| ma-1 移行 | migration-assurance | AR | RA | AAR | RAR |
| neg-1 翻訳 | なし | -- | -- | --- | --- |
| neg-2 一般質問 | なし | -- | -- | --- | --- |

Cの誤選択の行き先：asc-1は`work-coordination`（1回）。asc-2は`execution-recovery`（Skill呼出し1回、本文の直接読込み1回）と、どのSkillも読まない1回。rr-1は3回とも同梱の`code-review`。`code-review`は同梱Skillのため説明文が残っていた。

手順適用の目印が無かった試行：
- ri-1は「受入条件」と「未決」の両方がある回答がA 0/2、B 0/2、C 2/3、F 0/3だった。Fは3回とも本文と`references/decisions.md`を読んでいたが、Cより少ない。直接参照経路で適用が変わった可能性は否定できない（試行数が少なく判別できない）。
- Fのasc-2の2回は、`asc`本文と`references/coordination.md`を読み、worktreeの有無・未追跡の状態を確認していた。回答の表現が「未commit」「未保存」「start」のどれでもなかった。
- ma-1は全条件で揺れた（A 1/2、B 1/2、C 2/3、F 1/3）。

使用頻度が低くても重要なSkill：Cでは全Skillの使用回数が0で、ASCのうち15件が名前だけだった。名前から用途が読めるSkillは到達を保った（4件×3回＝12/12）。名前が略号の`asc`と、説明文の残る同梱Skillと用途が重なる`review-and-remediation`が劣化した。

費用・効率（list価格の推定。`claude plugin eval`の`costUsd`。input・outputは非cache分）：

| | A | B | C | F |
| --- | --- | --- | --- | --- |
| 試行 | 18 | 18 | 27 | 27 |
| 費用（USD） | 3.71 | 4.47 | 6.84 | 7.21 |
| 1試行あたり費用 | 0.206 | 0.249 | 0.253 | 0.267 |
| input／output tokens | 222／53,078 | 206／54,223 | 292／74,495 | 268／78,753 |
| cache read／write tokens | 1,360,856／296,567 | 1,553,453／384,684 | 2,377,811／556,707 | 2,607,281／638,527 |
| モデル呼出し（`num_turns`の合計。API要求の回数ではない） | 209 | 202 | 272 | 277 |
| 1試行あたりの所要時間（秒、`duration_ms`の平均） | 32 | 31 | 31 | 42 |
| suite全体の実時間（秒、並列4） | 190 | 168 | 249 | 436 |
| 初期Context（`/context`のTokens／Skills行） | 5.7k／3k | 10.7k／8.7k | 12k／10k | Cと同じ構成 |

モデル実行全体（隔離確認・診断を含む）の推定費用は23.0 USDで、上限50 USDを下回った。

## 配布物への影響

- `v05/USAGE.md`：package.jsonの`files`に含まれ、`project-assets`が利用先の`.agent-skill-chain/v05/USAGE.md`と`.agent-skill-chain/managed-runtime/v05/USAGE.md`へ複写する。利用者が次に配布版を更新したときに届く。ただし利用者がこのfileを編集していれば、更新は競合として止まり上書きされない。追記は1段落で、既存の文例・手順・CLIの挙動は変えない。
- `docs/evidence/1783-skill-coexistence/**`：`files`に含まれず、配布されない。
- 配布Skill（`skills/**`）、`src/`、`bin/`、`test/`は変更していない。

## 採否

[decision-criteria.md](decision-criteria.md)を順に適用した。

| 基準 | 結果 | 判定 |
| --- | --- | --- |
| 1 劣化の有無 | rr-1とasc-2がBで2/2、Cで0/3（「Bで2/2のときCで1/3以下」に該当）。正例の到達もB 14/14に対しC 14/21 | 劣化あり |
| 2 現行方式で十分 | 1で劣化あり | 不成立 |
| 3 既存経路で回復 | 到達はF 21/21で回復。手順適用はF 14/21、B 11/14で、下の表のとおり読み方により成立・不成立が分かれる。表の読み方すべてで成立する場合だけ成立とする扱い（事後の決定）により | 不成立 |
| 4 製品の最小変更 | descriptionの短縮（D）は2/16で、`asc`の回復は残り予算に依存し、`review-and-remediation`は回復しない。短縮がA・Bでの選択を悪化させないかは測っていない。Skillの名前・配布処理・referenceの変更では一覧の順序（個人用→project）と使用回数の優先を変えられない。可視性を回復したのはHost設定だけ | 製品変更を確認できず「不採用」。Host設定の案内に限る |

基準1・3は反復回数の違う条件（B 2回、C・F 3回）を比べるが、比べ方を事前に決めていなかった。基準3の手順適用（B 11/14、F 14/21）は、読み方で結果が分かれる。

| 読み方 | B | F | 差 | 基準3 |
| --- | --- | --- | --- | --- |
| 失敗の試行数 | 3 | 7 | 4 | 不成立 |
| Bを21試行へ換算した成功数 | 16.5 | 14 | 2.5 | 不成立 |
| Fを14試行へ換算した成功数 | 11 | 9.33 | 1.67 | 成立 |
| 成功数そのまま | 11 | 14 | Fが上回る | 成立 |

読み方は結果を見た後に選ぶことになるため、本記録は「表の読み方すべてで成立した場合だけ基準3を成立とする」とした（結果を見て有利な読み方を選ばない＝基準を緩めない側）。この扱い自体も事後の決定であり、ownerが別の読み方を指定すれば基準3が成立しうる。その場合の結論は「利用手順の限定改善」（既存の任意文例と予算設定の案内）で、本PRの追記との差は既存文例を推奨に含めるかどうかである。基準1は「Bで2/2のときCで1/3以下」（rr-1・asc-2）で成立する。「Bより3試行以上少ない」の部分は、失敗数で読めば到達（B失敗0、C失敗7）で成立し、成功数そのまま（14対14）で読めば成立しないが、後者の条件だけで判定は変わらない。

採否の扱い：

- 新しいSkill・診断CLI・router・hook・設定の自動変更は導入しない。全Skillの一括読込みも要求しない。
- 配布Skillのdescriptionは変えない（短縮は`asc`以外を回復せず、`asc`の回復も残り予算次第で、他Skillの選択への影響は未測定）。
- `v05/USAGE.md`の「ASCを読む契機を利用先へ採用する（任意）」の節へ、Host設定の案内を1段落追記した。内容は一覧予算（1M Contextで30,000文字、200k Contextで8,000文字）と省略の条件、200k ContextではASC単体でも超えること、超過の確認方法（debug log・`/context`のSkills行）、`/context`の個別行の限界、利用者が選べる設定（`skillListingBudgetFraction`、`skillOverrides`）とその代償、効果は一覧の可視性までしか確かめていないこと、ASCは設定を変えないこと、Codexとの違い（実機未測定）。既存の任意文例の位置付けと本文は変えていない。
- 参考（判定には使わない）：既存の任意文例（F）は、到達・本文・referenceの読込みを21/21へ戻し、負例への過剰適用も起こさなかった。費用は1試行あたりCより約5%多く、所要時間は約35%長かった。

利用者の作業負担：Host設定による対処は、設定fileへ1 keyを書く作業である。超過は`--debug`のログか`/context`のSkills行で分かる。どのSkillが名前だけになったかは、Hostの既存診断では正確に分からなかった（`/context`の個別行が一致しない場合がある。`/skill-doctor`は隔離環境で使えなかった）。

## 欠測・限界

- モデルは1種類、fixtureは1つ、各ケース2〜3回。統計的な発火率ではない。Context容量200kのモデルでは一覧の観測だけで、モデル実行をしていない。200kの観測はnetwork無しのcontainer（feature flagを取得せず、同梱Skillが実Hostより1件少ない）で、`claude-haiku-4-5`と`claude-sonnet-4-5`の2つだけである。実Hostの`/context`では確かめていない。`skillOverrides`の効果は1M Contextでだけ観測した。
- モデル実行では、ASCの入口をproject登録ではなくplugin（`project:<name>`）として読み込んだ。名前に`project:`が付き、本文へのリンクを作業ディレクトリ基準に書き換えた。CLAUDE.mdの代わりに`append_system_prompt`で文例を与えた（F）。実際のproject登録・CLAUDE.mdとは経路が異なる。
- モデル実行の一覧は直接観測していない。同じplugin構成を隔離環境1で観測し、実Hostの`/context`のSkills行・名前だけの件数と照合した。隔離環境1はnetwork無しで、feature flagを取得しない。同梱Skillの数が実Hostと1件異なる（`schedule`）。
- 隔離環境1と2のどちらも使用回数0から始めた。使用履歴の効果は一覧の観測（C-usage-asc、C-usage-personal）だけで、モデル実行では測っていない。
- 他のSkillへの悪影響は、負例（翻訳・一般質問）と合成Skillの呼出し数でしか測っていない。ASC以外のSkillを正解とする正例は無い。
- 合成Skillは用途がASCと重ならない文面にした。用途の重なる外部Skillとの競合（誤選択）は、同梱の`code-review`との間でだけ観測した。
- E（Host設定の変更）はモデルで測っていない。一覧がBと同じく全件に説明文がある状態になることだけを観測した。
- 手順適用の判定は、本文・referenceの`Read`と回答の固定した語の有無である。回答の質は採点していない。ri-1の目印はC以外で全て外れた。
- 名前の競合（X-collision）は一覧での置換えだけを観測し、モデルの選択は測っていない。
- `/skill-doctor`は実HOMEでは試していない（利用者の使用回数・設定を読むため）。`/doctor`は条件Cで1回だけ実行した。
- Codexは実機で測っていない。sourceはmainのcommitで、ローカルのCLI（0.171.0）と同じ版かは確認していない。
- 費用はlist価格の推定で、課金額とは限らない。親sessionの調整・採点・レビューの消費は含まない。
- 欠測：Issueの効果測定のうち、API課金額の実額と、実HOMEでの`/skill-doctor`の出力。

## 再現手順

1. fixture：小さなTypeScript/Expressの合成repo（ユーザー管理API、CI、Dockerfile、要件メモ。lockfileなし）に、調査基点のCLIで`project-assets <fixture> --register-claude-skill --apply`を実行する。fixture本体はrepositoryに含めない（作り方は本READMEのとおり）。
2. 一覧の観測：`docker build -t asc-1783-host:2.1.323 -f harness/host.Dockerfile harness`のあと、条件ごとに`node harness/run-observe.mjs <label> <fixture> listing-conditions.json <condition> <out>`、`node harness/analyze-listing.mjs <out>`。
3. モデル実行：`node harness/make-eval-suites.mjs <fixture> <suites> <outside-marker-file>`、`node harness/run-suite.mjs <suites> <A|B|C|F|diag|iso> <out> <max-cost-usd>`、`node harness/score.mjs cases.json <out>/traces A B C F --runs-json results/runs.json`。一覧の集計は`node harness/build-listing-results.mjs <observations-dir> results/listing-observations.json`。`run-suite.mjs`は`claude plugin eval`の一時directoryからtraceを複写したあと、その一時directoryを削除する。引数は絶対pathで渡す。suite全体が結果JSONを出さずに失敗した場合は`traces/<suite>.missing-json`を作るので、失敗として別に数える（今回は0件）。終了codeの反映は、モデル実行の後に独立レビューの指摘で追加した（結果には影響しない）。削除の対象はmacOSで観測した`/private/tmp/e-*`の形だけで、他のOSでは手で確認する。`claude plugin eval`の終了codeは`<suite>.exit`に残し、script自体もその値で終了する。
