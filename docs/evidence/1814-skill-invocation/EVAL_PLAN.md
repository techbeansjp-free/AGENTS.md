# ASCのSkillが読まれる割合の測定計画（#1814）

開発時の検証資料であり、配布対象に含めない。モデル実行の前に固定する計画である。合格の水準と判定の規則は[decision-criteria.md](decision-criteria.md)、依頼とgoldは[cases.json](cases.json)、条件は[conditions.json](conditions.json)、導入する版は[release.json](release.json)にある。

## 目的

ASCを導入した利用者と同等の環境で、新しいsessionの依頼から、ASCのSkill（`asc`と目的別Skill）の本文が読まれた割合と、該当する手順が適用された割合を、tool呼出しの記録で測る。条件は、登録だけ（現状）、`CLAUDE.md`への文例、SessionStartのhookによる注入の3つ。測定で不足があれば、`project-assets`が差分を示して提案する仕組み（[IMPROVEMENT_DESIGN.md](IMPROVEMENT_DESIGN.md)）を作り、同じ測定で確かめる。

対象HostはClaude Codeだけ（ownerの判断）。Codexは対象外とし、必要なら別Issueにする。

## 実行環境（利用者と同等の隔離環境）

ownerの要求（2026-11-25）：利用者の環境と同等で、このrepositoryや実HOMEの影響を受けない環境で測る。#1807では、生成者がworktreeの下で動き、このrepositoryの`CLAUDE.md`とownerのauto-memoryの索引を読み込んでいた。これを繰り返さない。

| 項目 | 方式 | 実装 |
| --- | --- | --- |
| ASCの導入 | GitHub Releaseのtarballを、sha256を照合してから、[v05/USAGE.md](../../../v05/USAGE.md)「標準の導入先」の手順で導入する：新しい一時prefixへ`npm install --offline --ignore-scripts …`、`project-assets <project> --register-claude-skill`（差分の表示）、`--apply`、一時prefixの削除。Git管理のsample projectでは、手順のとおり専用worktreeで導入してcommitし、mainへ取り込む。このrepositoryからSkillを複写しない | [harness/install-asc.mjs](harness/install-asc.mjs)、[harness/make-fixture.mjs](harness/make-fixture.mjs) |
| 導入の確認 | 配布されたSkill（16件）の入口`.claude/skills/<name>/SKILL.md`がすべてあり、`distribution.json`の記録と同じbytesで、本文`.agent-skill-chain/skills/<name>/SKILL.md`へのlinkだけを持つ薄い入口であること、本文が記録・packageと一致することを確かめ、版・digest・入口ごとのsha256を記録する。1件でも合わなければ止める | `install-asc.mjs`の`verifyEntries` |
| sample project | このrepositoryと実HOMEの外（scratchの下）に作る、Gitで管理した小さなアプリ：TypeScript/Expressのユーザー管理API、一覧画面、要件メモ（未決事項を含む）、依頼文`docs/BRIEF.md`、CI、Dockerfile、ASC導入前からある`CLAUDE.md`（ASCに触れない概要だけ）。repositoryには含めず、作り方をscriptで残す | `make-fixture.mjs` |
| 配置の検査 | sample project・試行の作業ディレクトリの祖先（親から`/`まで）に`CLAUDE.md`・`CLAUDE.local.md`・`AGENTS.md`・`.claude`・`.agents`・`.codex`・`.git`があれば、または実HOMEやこのrepositoryの下なら、実行を拒否する | [harness/guard.mjs](harness/guard.mjs) |
| HOME | 試行ごとに新しい空の`HOME`と`CLAUDE_CONFIG_DIR`。利用者の設定・`CLAUDE.md`・memory・Skill・plugin・hookは無く、Claude Codeの同梱Skillだけが残る。設定の読込み元は既定のまま（利用者と同じ）で、user・localは空 | [harness/run-trial.mjs](harness/run-trial.mjs) |
| 認証 | 親の環境変数`CLAUDE_CODE_OAUTH_TOKEN`（`claude setup-token`で作るtoken）または`ANTHROPIC_API_KEY`だけを、子processの環境へ渡す。fileへ書かない。traceとstderrとdebug logに値が現れたら`<credential>`へ置き換える。記録するのは種類だけ。どちらも無ければ実行を拒否する | `run-trial.mjs` |
| tool | 組込みtoolは`Read`・`Glob`・`Grep`・`Skill`だけ（`Bash`・`Write`・`Edit`・Web・`Agent`は無し）。MCP無し（`--strict-mcp-config`）。sessionは保存しない | `run-trial.mjs` |
| 記録 | `--output-format stream-json --verbose --include-hook-events`。hookは、発火のたびにsample projectの外のlogへ1行書く（モデルの申告に依らない発火の証拠） | `run-trial.mjs`、[harness/apply-condition.mjs](harness/apply-condition.mjs) |
| 公開前の処理 | 記録を取り出すときに、試行のディレクトリ・`/Users/<名前>`等・scratchの名前を置き換える | [harness/collect.mjs](harness/collect.mjs) |

`claude plugin eval`（#1783・#1801）を使わない理由：runごとに一時HOMEと認証を用意する点は合うが、#1783の記録のとおり、runではprojectの`.claude/`が読まれず、ASCをpluginに入れ直す必要があった。それでは、利用者と同じ`.claude/skills/`の登録・projectの`CLAUDE.md`・`.claude/settings.json`のhookを測れない（#1783では文例を`append_system_prompt`で代用した）。今回の3条件は、まさにこの経路の違いを測るので、`claude -p`をsample projectで起動し、HOMEと設定ディレクトリを試行ごとに作る方式にした。

## 条件

条件の内容は[conditions.json](conditions.json)。すべて同じsample project・同じ`CLAUDE.md`の概要から始め、違いは次だけにする。文例は、導入したreleaseの`.agent-skill-chain/v05/USAGE.md`（利用者が読む文書）の「ASCを読む契機を利用先へ採用する（任意）」から取り出す（sha256を記録）。hookの文面は文例と同じにして、経路（`CLAUDE.md`かhookか）の違いだけを比べる。

| 条件 | 内容 | 測定 |
| --- | --- | --- |
| R | 登録だけ（`project-assets --register-claude-skill --apply`まで。案内もhookも無い） | 段階1（現状） |
| P | Rに加え、`CLAUDE.md`の末尾に文例を追記してcommit | 段階2 |
| H | Rに加え、`.claude/settings.json`のSessionStart（matcher `startup\|resume\|clear\|compact`）で文例を`additionalContext`として注入するhookを登録してcommit。登録の形は、USAGEが`resume-context`のhookで案内している形と同じ。releaseに注入用のコマンドが無いので、projectの小さなscript（`.claude/hooks/asc-read-trigger.mjs`）で出す | 段階2 |
| PH | PとHの両方 | 費用の上限の外。P・Hのどちらも水準に届かない場合に、実行せずに報告する |
| S | hookで強い文面（このrepositoryのhookに近い、作業前に読むことを求める文）を注入 | 同上（ownerが追加を選んだ場合だけ） |
| I | 改善の後：ownerが採用した仕組みを、新しいreleaseの`project-assets`の提案から利用者の承認の手順で適用したもの | 段階3（内容は採用の後に`conditions.json`へ追記して固定） |

## 依頼とgold

[cases.json](cases.json)の14件。#1783の9件は依頼文・期待するSkill・reference・回答の目印を変えずに使い、5件を足した。

| id | 種類 | 期待するSkill | 必要なreference（どれか） | 手順の適用の目印（回答） |
| --- | --- | --- | --- | --- |
| asc-1 | asc（#1783） | asc | workspace.md | worktree、かつworktree-createか.worktrees |
| asc-2 | asc（#1783） | asc | workspace.md・coordination.md | worktree、かつstartか未commitか未保存 |
| asc-3 | asc（新） | asc（user-journey-acceptanceは記録だけ） | implementation.md・workspace.md | worktreeか作業場所。依頼は「docs/BRIEF.md の依頼に対応して。」（#1807と同じ間接的な形。BRIEFは画面を含む機能の実装） |
| rr-1 | 目的別（#1783） | review-and-remediation | review-method.md | 認可・権限 |
| tw-1 | 目的別（#1783） | tracker-issue-writing | なし | 4つの見出し |
| ri-1 | 目的別（#1783） | research-to-implementation | decisions.md | 受入条件・未決 |
| se-1 | 目的別（#1783） | security-evidence | findings-and-summary.md | lock・ロック |
| ma-1 | 目的別（#1783） | migration-assurance | acceptance-and-cutover.md | 受入・切戻し等 |
| ui-1 | 目的別（新、画面） | user-journey-acceptance | journeys.md | 0件・失敗・再読込みのすべて |
| es-1 | 目的別（新、見積） | estimate-and-scope | なし | 前提・調査・未決のすべて |
| do-1 | 目的別（新、未決の整理） | decision-ownership | なし | 判断者・仮置きのすべて |
| neg-1 | 該当しない（#1783、翻訳） | なし | なし | search |
| neg-2 | 該当しない（#1783、質問） | なし | なし | PATCH |
| neg-3 | 該当しない（新、コードの質問） | なし | なし | @ |

## 測る値

[harness/score.mjs](harness/score.mjs)は、stream-jsonのtool呼出しとtool結果だけから数える。モデルの「Skillを使った」という回答は根拠にしない。tool呼出しのpathは、init eventの`cwd`（sample projectのroot）を基準に解決し、正規化してrootからの相対pathで照合する（rootの外のpathは一致しない。macOSの`/private/tmp`と`/tmp`は同じものとして扱う）。Readはtool結果がエラーでない場合だけ数える。

| 値 | 定義 |
| --- | --- |
| entryHop（1段目） | 期待するSkillのSkill tool呼出し、または入口`.claude/skills/<name>/SKILL.md`のRead |
| bodyRead（2段目） | 本文`.agent-skill-chain/skills/<name>/SKILL.md`のRead（入口は本文へのlinkだけを持つ） |
| referenceRead | 必要なreferenceのRead |
| applied | bodyRead・referenceRead・回答の目印のすべて |
| misselect・unselected | 期待に届かず別のSkillへ／どのSkillにも触れず |
| secondaryRead | 記録だけの副次Skill（asc-3のuser-journey-acceptance）の本文のRead |
| overapplication | 該当しない依頼での、ASCのSkill tool呼出し、入口・本文のRead（同梱Skillの呼出しは別に記録） |
| hookFired | hookの発火（sample projectの外のlog） |
| 費用・turn・時間・token | `result`の`total_cost_usd`等 |

## 段階と費用

費用の上限は30 USD（Hostの計算値）。計画の単価は、同じtool構成の#1783・#1801の実績（1試行0.206〜0.267 USD）から1試行0.22 USD、隔離の確認は1回0.1 USDとした。反復は各条件2回。14件×2回＝1条件28試行。

| 段階 | 条件 | 試行 | 計画の費用（USD） |
| --- | --- | --- | --- |
| 0 隔離の確認 | R・P・H | 3 | 0.3 |
| 1 現状 | R | 28 | 6.16 |
| 2 候補 | P・H | 56 | 12.32 |
| 3 改善の後 | I（確認1と28試行） | 29 | 6.26 |
| 合計 | | 116 | 25.04 |

停止の規則：

- `run-trial.mjs`は、実行済みの合計（`total_cost_usd`、結果が無い試行は予算額）にその試行の予算（0.6 USD）を足して`--stop-usd`を超えるなら起動しない。`--stop-usd 30`で実行する。
- 段階1の後と段階2の後に、実績の平均単価で残りの段階の費用を見積もり、合計が30 USDを超える見込みなら、次の段階へ進まずに報告する。段階3の費用（約6.3 USD）を残すため、段階2を始める時点の見込みを優先する。
- 1試行の予算上限は0.6 USD（#1783の最大の数倍）。

## 隔離の確認（測定の前、各条件1回）

測定と同じ起動の設定（同じsample project・条件・HOMEの作り方・tool・model）で、[run-trial.mjs](harness/run-trial.mjs)の`probe`を実行し、[harness/probe-check.mjs](harness/probe-check.mjs)で判定する。モデルを1回呼ぶので、統括の許可の後に行う。

準備：`node harness/markers.mjs create <このrepositoryのroot>`で、実HOMEとこのrepository（git管理外の`.agent-skill-chain/local/`）に、乱数の目印を書いたfileを1つずつ作る（既存fileは上書きしない）。確認の後に`remove`で消す。

すべてが合格した条件だけを測定する。

| 確認 | 合格の条件 |
| --- | --- |
| 起動 | init eventがあり、`cwd`が試行のsample project、toolが`Read`・`Glob`・`Grep`・`Skill`（と`ToolSearch`）だけ、MCP・pluginが無い |
| Skillの一覧 | init eventの`skills`にASCの16件がすべてある。ASC以外は同梱Skillとして名前を記録する |
| 説明文 | `asc`と`user-journey-acceptance`のdescriptionを、fileを読まずに原文のまま答えられる（入口のfrontmatterと照合。読んだ形跡があれば不合格）。16件の原文の一致数も記録する |
| 指示ファイル・memory | sample projectの`CLAUDE.md`の1行目を答える。文例（「このプロジェクトでASCを使う」）は、P・H（・PH）だけで現れ、Rでは現れない。このrepositoryの`CLAUDE.md`・`AGENTS.md`の1行目が現れない |
| 目印 | 実HOMEとこのrepositoryの目印のReadを試み、どちらも拒否される。目印の文字列がtrace・stderr・debug logのどこにも無い |
| debug log | `CLAUDE.md`・`AGENTS.md`・memory・settings・skillsに関わる行のpathが、試行のディレクトリ、Claude Code本体の導入先（実HOMEの下にある場合がある）、機械の管理用policyの場所の中だけ。実HOMEとこのrepositoryのpathが、目印の行とClaude Code本体のpath以外に無い |
| hook | hookのある条件ではSessionStart（source `startup`）の発火がlogにあり、無い条件では無い |

## 手順

モデルを呼ばない準備（実施済み、[README.md](README.md)「実施したこと」）：

```sh
node --test docs/evidence/1814-skill-invocation/harness/score.test.mjs docs/evidence/1814-skill-invocation/harness/probe.test.mjs
node docs/evidence/1814-skill-invocation/harness/dry-run.mjs <tarball> <sha256> <新しいscratchのdirectory> --out <json>
```

測定（統括の許可の後。`ASC1814_ALLOW_PAID=1`と認証の環境変数を、実行するshellだけに設定する）：

1. `gh release download v0.5.106 --pattern 'agent-skill-chain-0.5.106.tgz' --pattern SHA256SUMS --dir <scratch>/release`。tarballのsha256が`release.json`の`assetSha256`とSHA256SUMSの両方と一致することを確かめる。
2. `node harness/make-fixture.mjs <tarball> <sha256> <scratch>/sample <scratch>/tmp > <scratch>/install.json`（導入と入口の照合。版・digest・入口のsha256を記録する）。
3. 段階0：`node harness/markers.mjs create <repo>`、条件R・P・Hごとに`node harness/run-trial.mjs <scratch>/runs <条件> probe 1 --fixture <scratch>/sample --model <model> --home-marker <…> --repo-marker <…> --stop-usd 30 --run`、`node harness/probe-check.mjs <scratch>/runs/<条件>-probe-1 <条件> <…> <…> <repo>`、`node harness/markers.mjs remove <repo>`。
4. 段階1・2：`node harness/run-trial.mjs <scratch>/runs <条件> <case> <1|2> --fixture <scratch>/sample --model <model> --stop-usd 30 --run`を全ケースで。
5. `node harness/collect.mjs <scratch>/runs results/traces`、`node harness/score.mjs cases.json results/traces R P H --runs-json results/runs.json --judge R P`（Hも同様）。
6. 段階3は、採用した仕組みを含むreleaseで2〜5を繰り返す（条件I）。

## 実装者が決めた技術的な事項（理由付き）

| 事項 | 決めたこと | 理由 |
| --- | --- | --- |
| model | `claude-sonnet-4-5`を推奨（統括の確認事項） | #1807で本文が0/69だった生成は`sonnet`で行われた。200k Contextでは一覧の予算が厳しく、#1801の短縮の後でASC 16件の説明文が残ることが観測済み（余裕はほぼ無い）なので、隔離の確認で一覧と説明文を確かめてから測る。1試行の費用は#1801でopusとほぼ同じ |
| 反復 | 各条件2回 | 上限30 USDで、現状・候補2つ・改善の後を同じ試行数（28）で比べるため。3回では段階3が上限を超える |
| tool | 読取りとSkillだけ | #1783・#1801と同じで比較でき、費用と隔離の検査が小さい。実装まで進む依頼（asc-3）では、編集の前の読込みと回答だけを見る（限界） |
| 文例とhookの文面 | 同じ文（USAGEの文例） | 経路の違いだけを比べるため。強い文面（S）は任意の追加 |
| hookのcommand | projectのscript | releaseに注入用のコマンドが無い。改善ではCLIの副コマンドにする案（IMPROVEMENT_DESIGN.md） |
| sample projectの`CLAUDE.md` | 導入前からある概要だけの`CLAUDE.md` | 多くの利用先には既存の`CLAUDE.md`がある。Pは利用者が文例を追記した状態に当たる |

## 実行の前に統括・ownerが用意すること

- 認証：試行ごとの空のHOMEではOSの資格情報の保管場所を使わないので、`CLAUDE_CODE_OAUTH_TOKEN`（`claude setup-token`）または`ANTHROPIC_API_KEY`を、実行するshellの環境変数として用意する。値はrepository・記録に残らない（`run-trial.mjs`が置き換える）。
- releaseのtarballとSHA256SUMSの取得（GitHubからのdownload）。
- 実HOMEへの目印fileの作成と削除（ownerの要求による。`markers.mjs`が作る1 fileだけ）。
- modelの確定（推奨は上の表）。

## 限界

- モデル1種類、sample project 1つ、各条件2回。統計的な発火率ではなく、水準の判定は粗い（該当する依頼22試行で、80%は18試行以上）。
- 読取りのtoolだけなので、実装の依頼（asc-3）で作業場所を作る・テストを走らせる等の手順の実行は観測しない。回答の目印で代える。
- 回答の目印は、Skillを読まなくても書かれ得る。手順の適用は本文・referenceの読込みと合わせて判定する。
- hookのcommandは利用者向けの正式なコマンドではない（段階3で正式な形を測る）。
- 試行は利用者のmachineと同じHost上で動き、sample projectの外の読書きの拒否はClaude Codeの権限の仕組みによる（#1807と同じ。OSの境界ではない）。隔離の確認で反例を確かめる。
- 機械の管理用policy（managed settings）は利用者の環境の一部として残る。debug logに現れた場合は記録する。
