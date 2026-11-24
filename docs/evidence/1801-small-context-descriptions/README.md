# 200k ContextでのSkill説明文の短縮の効果と非劣性（#1801）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 結論

**判定は「採用」とする（モデル実行の前にcommit `0c9ed39010e962028a5e44224d1f69813a1fafaa`で固定した[採否基準](decision-criteria.md)の3）。配布Skill 16件の`description`を、候補Bの文面へ置き換える（各Skillの`SKILL.md`の`description`の1行だけ）。あわせて、`v05/USAGE.md`のHost設定の案内のうち短縮前の観測を述べた1文を直す。**

- 現行の版でも、200k Contextのモデルでは一覧の予算が8,000文字で、ASCの16件と同梱の13件だけで超過し、ASC 16件のうち11件の説明文が省かれた（#1783と同じ）。
- 候補B（全16件を27〜51文字の1文にし、合計1,992文字を550文字にする）では、200k Contextの一覧でASC 16件すべての説明文が残り、予算超過の警告も出なかった。
- 200k Context（`claude-sonnet-4-5`）では、正例の到達が21試行中11から17へ増えた（基準1「3試行以上多い」が成立）。手順適用は5から6、本文の読込みは11から17。
- 1M Context（`claude-opus-5-5`）では、到達・本文の読込みが21/21のまま、手順適用は18から17（許容幅2の範囲）。負例の過剰適用はどの条件も0/6。基準2（非劣性）のすべての項目が成立した。
- 失敗・API error・traceの欠落は0件。モデル実行の費用は合計24.05 USD（上限30 USD）。

見直し条件：Claude Codeの一覧の予算・順序・同梱Skillが変わり、200k ContextでASCの説明文が再び省かれる場合（同梱Skillが約400文字分増えると省かれ始める。「余裕」）。隣接するSkillへの誤選択（境界の文を落としたことによる）が観測された場合は、予算内で境界の語を戻す。1M Contextで個人用Skillが多い環境の劣化は対象外で、#1783の判定（Host設定の案内）のままである。

## 対象版と実行環境

| 項目 | 値 |
| --- | --- |
| 調査基点 | main `02bb1a0d134a69350416bc92e74c299e017b9d79` |
| 採否基準・候補・harnessの固定 | commit `0c9ed39010e962028a5e44224d1f69813a1fafaa`（モデル実行の前にpush）。依頼集合とgoldは#1783の[cases.json](../1783-skill-coexistence/cases.json)（sha256 `846c724a04510e820f9c97b79ffe75ee285452c747bfb0648f531c21d04f2c15`）と[score.mjs](../1783-skill-coexistence/harness/score.mjs)を変更せずに使った。[candidates.json](candidates.json)のsha256は`496c47560eeca228e6750ff9e7afdc0761bd1bdd6c71a40a206b8ea20608220e` |
| Host | Claude Code 2.1.323（macOS上の実Host。モデル実行）。一覧の観測は同版と、npmの最新版2.1.331のLinux build |
| 200k Contextのモデル | `claude-sonnet-4-5`（モデル実行と一覧の観測。`/context`の表示は200k）、`claude-haiku-4-5`（一覧の観測だけ） |
| 1M Contextのモデル | `claude-opus-5-5`（`/context`の表示は1M） |
| 隔離環境1（一覧の観測） | #1783と同じ方式。`node:22-alpine`にClaude Codeを導入した使い捨てcontainer（[harness/host.Dockerfile](harness/host.Dockerfile)、版ごとにbuild）。`--network none`、read-only root、HOMEはtmpfs、秘密・HOMEのmountなし、メモリ1GB・CPU 2・pids 256、label `asc.worktree`。同じcontainer内のcapture serverへ接続し、モデルへ送られる要求本文を記録する |
| 隔離環境2（モデル実行） | `claude plugin eval`。runごとに一時HOME・一時設定・一時作業ディレクトリを作る。toolは`Read`・`Glob`・`Grep`・`Skill`・`ToolSearch`（`claude-sonnet-4-5`では`TodoWrite`も）。`Agent`・`Task`・`TaskStop`は除外 |

利用者の実HOMEではモデルを実行していない。実行の前後で、実HOMEの`~/.claude.json`の`skillUsage`のsha256は同じで、`project:`で始まる記録も増えなかった。

## 一覧の観測（隔離環境1）

条件は[listing-conditions.json](listing-conditions.json)と[margin-conditions.json](margin-conditions.json)、結果は[results/listing-observations.json](results/listing-observations.json)。fixtureは#1783と同じ構成の合成repo（TypeScript/Expressのユーザー管理API、CI、Dockerfile、要件メモ。repositoryに含めない）に、調査基点のCLIで`project-assets <fixture> --register-claude-skill --apply`を実行したもの。候補Bのfixtureは[harness/apply-descriptions.mjs](harness/apply-descriptions.mjs)で入口と本文の`description`だけを置き換えた。

| 版 | 条件 | 候補 | 一覧の件数 | 説明文あり | ASCの説明文あり | debug logの警告 |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1.323 | haiku（project登録） | A | 29 | 17 | **5/16** | 29件、10,305文字＞8,000 |
| 2.1.323 | sonnet（project登録） | A | 29 | 17 | **5/16** | 29件、10,305文字＞8,000 |
| 2.1.323 | sonnet（plugin `project`。モデル実行と同じ形） | A | 29 | 16 | **5/16** | 29件、10,433文字＞8,000 |
| 2.1.323 | opus（1M） | A | 29 | 29 | 16/16 | なし |
| 2.1.331 | haiku・sonnet（project登録） | A | 29 | 17 | **5/16** | 29件、10,324文字＞8,000 |
| 2.1.331 | sonnet（plugin） | A | 29 | 16 | **5/16** | 29件、10,452文字＞8,000 |
| 2.1.323・2.1.331 | haiku・sonnet・opus（project登録・plugin） | B | 29 | 29 | **16/16** | なし |

- #1783の観測を現行の版で再確認した。予算は8,000文字、合計は10,305文字（2.1.331では10,324文字）、説明文が残ったASCは`asc`・`contract-enforcement`・`decision-ownership`・`engineering-judgment`・`estimate-and-scope`の5件。省かれたのは`execution-recovery`・`migration-assurance`・`project-foundation`・`research-to-implementation`・`review-and-remediation`・`security-evidence`・`subagent-model-selection`・`tracker-issue-writing`・`user-journey-acceptance`・`verification-optimization`・`work-coordination`の11件。同梱Skillは`security-review`（plugin形式では`init`も）以外の説明文が残った。
- 予算超過時、同梱Skill（`dataviz`の1,436文字など）は説明文が残り、ASCは名前順の後ろから省かれた。ASCのdescriptionを短くする以外に、ASCの配布物から順序を変える手段は無い。

### 余裕

実Hostの`/context`には、containerに無い同梱Skill `schedule`があった（feature flagで有効になると見られる。descriptionと`whenToUse`の合計は約400文字）。これを個人用Skill（約400文字）で模した。

| 追加した個人用Skill | 候補 | ASCの説明文あり | debug logの警告 |
| --- | --- | --- | --- |
| 200文字×1 | B | 16/16 | なし |
| 400文字×1 | B | 16/16（省かれたのは`security-review`だけ） | 30件、8,032文字＞8,000 |
| 400文字×1 | A | 4/16 | 超過 |
| 400文字×2 | B | 11/16 | 31件、8,454文字＞8,000 |
| 400文字×3 | B | 4/16 | 32件、8,886文字＞8,000 |

候補Bの余裕は約400文字で、実Hostの構成ではほぼ使い切ると見られる。個人用Skillや同梱Skillがさらに増えれば、200k Contextでは候補Bでも省かれる（そのときの対処は#1783のHost設定の案内）。

実Hostの`/context`（[results/context/](results/context/)、モデルを呼ばないため費用0）では、候補Bの各行は説明文があっても`< 20`や`~20`の表示で、名前だけの行と区別できなかった。実Hostの要求本文は観測していない。

## モデル実行（隔離環境2）

構成：[harness/make-eval-suites.mjs](harness/make-eval-suites.mjs)。候補A・Bのfixtureから、#1783の[make-asc-plugin.mjs](../1783-skill-coexistence/harness/make-asc-plugin.mjs)でASCの16入口を`project`という名前のpluginにした（name・descriptionはfixtureと同一）。実行は#1783の[run-suite.mjs](../1783-skill-coexistence/harness/run-suite.mjs)、採点は[score.mjs](../1783-skill-coexistence/harness/score.mjs)で、どちらも変更していない。

| 条件 | モデル（Context） | 候補 | 一覧の状態（隔離環境1の同構成） |
| --- | --- | --- | --- |
| A | `claude-sonnet-4-5`（200k） | A | ASC 5/16に説明文 |
| B | `claude-sonnet-4-5`（200k） | B | ASC 16/16に説明文 |
| C | `claude-opus-5-5`（1M） | A | ASC 16/16に説明文 |
| D | `claude-opus-5-5`（1M） | B | ASC 16/16に説明文 |

隔離の確認（`evals-iso`、反例、2つのモデルで各3件）：fixture外の目印fileの`Read`は「don't ask mode」で拒否され、目印の文字列はtraceに無かった。書込み・network系のtool（`Write`・`Edit`・`Bash`・`WebFetch`・`WebSearch`）はsessionに無く、`ToolSearch`で探しても見つからなかった。目印fileは作られず、network系toolの呼出しも無かった。6件とも合格した後で条件A〜Dを実行した。`claude-sonnet-4-5`の書込みの確認は、`ToolSearch`を繰り返して最大turn数（5）に達して終了した（graderは合格）。

結果（[results/summary.jsonl](results/summary.jsonl)、試行ごとは[results/runs.json](results/runs.json)、suiteの記録は[results/suites.json](results/suites.json)。失敗・API error・traceの欠落は0件）：

| 指標 | A（200k・現行） | B（200k・短縮） | C（1M・現行） | D（1M・短縮） |
| --- | --- | --- | --- | --- |
| 正例の到達 | 11/21 | **17/21** | 21/21 | 21/21 |
| 誤選択 | 0/21 | 0/21 | 0/21 | 0/21 |
| 未選択 | 10/21 | 4/21 | 0/21 | 0/21 |
| 本文の読込み | 11/21 | 17/21 | 21/21 | 21/21 |
| referenceの読込み（到達した試行） | 9/21 | 11/21 | 21/21 | 21/21 |
| 手順適用（本文・reference・回答の目印） | 5/21 | 6/21 | 18/21 | 17/21 |
| 負例の過剰適用 | 0/6 | 0/6 | 0/6 | 0/6 |

ケース別（A＝適用、R＝到達したが目印かreferenceなし、M＝誤選択、U＝未選択、-＝負例で適用なし）：

| ケース | 想定Skill | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| asc-1 開始 | asc | RRU | RRR | AAA | AAA |
| asc-2 再開 | asc | RRA | RRR | AAA | AAA |
| rr-1 レビュー | review-and-remediation | UUU | UUU | AAA | AAA |
| tw-1 起票 | tracker-issue-writing | AAA | AAA | AAA | AAA |
| ri-1 技術調査 | research-to-implementation | RRA | RRR | AAR | RRA |
| se-1 監査 | security-evidence | **UUU** | **ARA** | AAA | AAA |
| ma-1 移行 | migration-assurance | **UUU** | **ARU** | RRA | RRA |
| neg-1 翻訳 | なし | --- | --- | --- | --- |
| neg-2 一般質問 | なし | --- | --- | --- | --- |

読み取れること：

- 200k Contextで増えた到達は、説明文が省かれていた`security-evidence`（0/3→3/3）と`migration-assurance`（0/3→2/3）、および`asc-1`の1回である。Aの未選択では、どのSkillも呼ばず、fixtureのファイルを直接読んで答えていた。#1783の1M Context（条件C）では名前だけでも到達した2件が、`claude-sonnet-4-5`では名前だけだと選ばれなかった。
- `rr-1`（レビュー）は、200k ContextではA・Bとも3回すべてで、`src/users.ts`を読んで直接レビューし、Skillを選ばなかった。説明文の有無では変わらなかった。同梱の`code-review`への誤選択も無かった（#1783の1M Context・条件Cとは異なる）。
- 200k Contextの手順適用は、A・Bとも低い（5/21、6/21）。到達した試行でも、referenceを読まない、または回答に固定の目印が無いことが多かった。`asc-1`・`asc-2`では、Bで`asc`の本文を読んだあと`references/workspace.md`等を読まなかった試行が5回あった（Aでは2回）。`asc`の説明文はA・Bとも一覧に残っており、本文は同一である。説明文の差による影響か、試行のばらつきかは、この試行数では判別できない。手順適用の差（+1）は基準の範囲内である。
- 1M Contextでは、短縮による到達・本文の読込みの低下は無かった。手順適用の差（−1）は`ri-1`の目印（「受入条件」「未決」）による。

費用・効率（list価格の推定。`claude plugin eval`の`costUsd`）：

| | A | B | C | D |
| --- | --- | --- | --- | --- |
| 試行 | 27 | 27 | 27 | 27 |
| 費用（USD） | 5.81 | 6.41 | 5.73 | 5.55 |
| 1試行あたり費用 | 0.215 | 0.237 | 0.212 | 0.205 |
| モデル呼出し（`num_turns`の合計） | 276 | 356 | 304 | 309 |
| 1試行あたりの所要時間（秒、平均） | 69 | 79 | 30 | 30 |
| suite全体の実時間（秒、並列4） | 587 | 617 | 225 | 228 |
| 初期Context（`/context`のSkills行） | 2k | 1.9k | 3k | 2.5k |

モデル実行全体の推定費用は24.05 USD（隔離確認0.55、診断0、A〜D 23.50）で、上限30 USDを下回った。固定したsuiteごとの上限のうち、BはA・Bの並列実行中に6.41 USDとなり、上限6 USDを0.41 USD超えた。`claude plugin eval`の`--max-cost-usd 6`は実行を止めなかった（`partial: false`）。この超過はA・Bの完了後に確認した。合計の上限30 USDは超えていない。200k Contextでは1試行あたりの費用・turn数が短縮側で増えたが、到達したSkillの本文・referenceを読む分の増加である。

## 採否

[decision-criteria.md](decision-criteria.md)を順に適用した。全条件で試行数が同じ（各27、失敗0）で、比べ方の読み分けは生じない。

| 基準 | 結果 | 判定 |
| --- | --- | --- |
| 0 隔離 | 6件すべて合格 | 合格 |
| 1 効果（200k） | 到達 B 17 − A 11 ＝ 6（≥3） | 改善あり |
| 2 非劣性・200k | 到達 17 ≥ 11−2、本文 17 ≥ 11−2、手順適用 6 ≥ 5−2 | 成立 |
| 2 非劣性・1M | 到達 21 ≥ 21−2、本文 21 ≥ 21−2、手順適用 17 ≥ 18−2 | 成立 |
| 2 ケース別 | 対照で3/3のケース（Aの`tw-1`、Cの全7件）は、短縮側でもすべて3/3 | 成立 |
| 2 負例 | 過剰適用 B 0 ≤ A 0、D 0 ≤ C 0 | 成立 |
| 3 採否 | 1・2とも成立 | **採用** |

採否の扱い：

- 配布Skill 16件の`SKILL.md`の`description`の行を、[candidates.json](candidates.json)の候補Bの文面へ置き換えた。本文・reference・Skill名・配布処理・登録処理は変えていない。mainをmergeする前の変更後のtree（commit `780756461cc76618cff6c4104132687bd24c91d5`の内容）から作り直したfixtureで、`project-assets`が配置するClaude Codeの入口（`.claude/skills`）・本文（`.agent-skill-chain/skills`）・同梱本体（`.agent-skill-chain/managed-runtime/skills`）が、評価に使った候補Bのfixtureとbyte単位で一致することを`diff -r`で確かめた。
- 落とした文：各descriptionの後半にあった境界・否定の文（例：`asc`の「変更のレビューや指摘の是正、調査・見積などは目的別Skillが扱う」、`decision-ownership`の担当外のSkillの列挙、各Skillの「〜だけには適用しない」）。これらはSkillを選ぶ前の一覧の文であり、適用の規則は各Skillの本文に残る。境界を問う依頼（#1654の`research-to-implementation`と`engineering-judgment`の取り違え等）は、この依頼集合では測っていない（「欠測・限界」）。
- Host設定（`skillListingBudgetFraction`等）は変えない。#1783で`v05/USAGE.md`へ追記したHost設定の案内のうち、「200k ContextではASCの入口と同梱Skillだけで予算を超え、11件が名前だけになった」の1文だけを、短縮前の観測であることと、短縮後は収まるが余裕が約400文字であることへ直した。設定の選択肢・代償・Codexの記述は変えていない。

## 配布物への影響

- `skills/<name>/SKILL.md`（16件）：`package.json`の`files`に含まれる。`project-assets`が利用先の本文と同梱本体へ複写し、登録済みのHost入口（Codexの`.agents/skills`、Claude Codeの`.claude/skills`）の`description`も次の更新で置き換わる。利用者が入口を編集していれば、更新は競合として止まり上書きされない。
- Codex：一覧の予算は既定でContextの2%で、短縮で一覧の文字数は減る。Codexでの選択の精度は測っていない。
- `v05/USAGE.md`：`files`に含まれ、`project-assets`が利用先へ複写する。Host設定の案内の1文だけを直した（上記）。
- `test/helpers/foundation-skill.mjs`：`project-foundation`の配布本文のbyteを固定したsha256を、新しい`SKILL.md`の値へ更新した（`description`の1行の変更による）。配布されない。
- `docs/evidence/1801-small-context-descriptions/**`：`files`に含まれず、配布されない。

## 欠測・限界

- 200k Contextのモデル実行は`claude-sonnet-4-5`の1種類だけで、`claude-haiku-4-5`は一覧の観測だけである。1M Contextは`claude-opus-5-5`だけ。fixtureは1つ、各ケース3回。統計的な発火率ではない。
- 依頼集合は#1783の正例7件（6 Skill）と負例2件で、`execution-recovery`・`verification-optimization`・`work-coordination`等の、短縮で説明文が見えるようになった他のSkillの到達は測っていない。隣接するSkillの境界を問う依頼も無い。
- モデル実行ではASCの入口をplugin（`project:<name>`）として読み込んだ。実際のproject登録とは名前と読込み順が異なる。一覧の観測では、どちらの形でも候補Bは16/16、候補Aは5/16だった。
- 実Hostの要求本文は観測していない。containerには同梱Skillの`schedule`が無く、余裕の評価は個人用Skillで模した推定である。実Hostの`/context`の個別行では候補Bの可視性を判定できなかった。
- 手順適用の判定は、本文・referenceの`Read`と回答の固定した語の有無である。回答の質は採点していない。
- 評価の後にmainをmergeし、#1781で`subagent-model-selection`の本文（`description`以外）が変わった。評価で使った本文とは異なるが、このSkillは依頼集合の対象外で、`description`は候補Bのままである。
- 使用回数はすべて0から始めた。使用履歴による一覧の優先は測っていない。
- 費用はlist価格の推定で、課金額とは限らない。親sessionの調整・採点・レビューの消費は含まない。suite Bは固定したsuiteごとの上限を0.41 USD超えた（「費用・効率」）。

## 再現手順

1. fixture：上記の合成repoに、調査基点のCLIで`project-assets <fixture> --register-claude-skill --apply`を実行する。候補Bは`node harness/apply-descriptions.mjs <fixture> <fixture-B> candidates.json B`。
2. 一覧の観測：`docker build --build-arg VERSION=<版> -t asc-1801-host:<版> -f harness/host.Dockerfile harness`のあと、条件ごとに`node harness/run-observe.mjs <label> asc-1801-host:<版> <fixture> listing-conditions.json <condition> <out>`。集計は#1783の`build-listing-results.mjs`と`analyze-listing.mjs`。
3. モデル実行：`node harness/make-eval-suites.mjs <fixture> <fixture-B> <suites> <outside-marker-file>`、#1783の`node run-suite.mjs <suites> <iso|diag|A|B|C|D> <out> <max-cost-usd>`、`node score.mjs ../1783-skill-coexistence/cases.json <out>/traces A B C D --runs-json results/runs.json`。引数は絶対pathで渡す。
