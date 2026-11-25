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
| 認証 | ownerの決定（2026-11-25、Issueのコメント）：`claude setup-token`で作るtoken（`CLAUDE_CODE_OAUTH_TOKEN`）を、測定を動かすprocessの環境変数だけで子processへ渡す。統括は`CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/asc-eval/claude-oauth-token)" node harness/run-trial.mjs …`の形で起動する（fileはownerが作り、mode 600）。harnessはそのfileを読まず、値を表示・記録しない。子processの環境へ渡すだけで、試行のHOME・設定ディレクトリには書かない。試行の後、それらのディレクトリから値を探して件数だけを`meta.json`に記録（`credentialInChildFiles`）してから消す。`ANTHROPIC_API_KEY`は予備。fileへ書かない。traceとstderrとdebug logに値が現れたら`<credential>`へ置き換える。記録するのは種類だけ。どちらも無ければ実行を拒否する | `run-trial.mjs` |
| tool | 組込みtoolは`Read`・`Glob`・`Grep`・`Skill`だけ（`Bash`・`Write`・`Edit`・Web・`Agent`は無し）。MCP無し（`--strict-mcp-config`）。sessionは保存しない。利用者の環境との意図した違い（下の節） | `run-trial.mjs` |
| model | `sonnet`の別名（統括の決定。#1807の生成と同じ）。試行ごとにinit eventの解決後のmodel idを記録する。`--model`の指定は受け付けない | `conditions.json`の`model`、`run-trial.mjs` |
| 試行のcommit | どの条件でも、条件の適用の後に同じ中立の件名（`Update project files`）のcommitを1件だけ入れる（Rは空のcommit）。Hostがgitの状態として最近のcommitの件名をContextへ入れる場合に、条件ごとに違う文字列が入らないようにする（レビューM1） | `apply-condition.mjs` |
| 試行の後始末 | 試行の`HOME`と設定ディレクトリは、CLIがアカウントの情報を書き得るので、試行の後に消す（レビューL9）。親processが強制終了されて台帳のlockが残った場合は、lockを消す前に`<runs-root>/<試行>/home`と`<runs-root>/<試行>/config`を手で消す（レビューL-5）。公開する記録は、取り出すときにメールアドレス・key・アカウントの欄の形の文字列を置き換え、件数を記録する | `run-trial.mjs`、`collect.mjs` |
| 記録 | `--output-format stream-json --verbose --include-hook-events`。hookは、発火のたびにsample projectの外のlogへ1行書く（モデルの申告に依らない発火の証拠） | `run-trial.mjs`、[harness/apply-condition.mjs](harness/apply-condition.mjs) |
| 公開前の処理 | 記録を取り出すときに、試行のディレクトリ・`/Users/<名前>`等・scratchの名前を置き換える | [harness/collect.mjs](harness/collect.mjs) |

`claude plugin eval`（#1783・#1801）を使わない理由：runごとに一時HOMEと認証を用意する点は合うが、#1783の記録のとおり、runではprojectの`.claude/`が読まれず、ASCをpluginに入れ直す必要があった。それでは、利用者と同じ`.claude/skills/`の登録・projectの`CLAUDE.md`・`.claude/settings.json`のhookを測れない（#1783では文例を`append_system_prompt`で代用した）。今回の3条件は、まさにこの経路の違いを測るので、`claude -p`をsample projectで起動し、HOMEと設定ディレクトリを試行ごとに作る方式にした。

## 利用者の環境との意図した違い

ownerの要求は「利用者と同等の環境」だが、次の点は安全と費用のために意図して変えている（統括の決定。ownerが了承した：2026-11-25、Issueのコメント「ownerの判断（2回目）」）。

| 違い | 理由 | 観測への影響 |
| --- | --- | --- |
| 組込みtoolを`Read`・`Glob`・`Grep`・`Skill`に限る（`Bash`・`Write`・`Edit`・Web・`Agent`無し） | 試行がsample projectの外へ書き込む・通信する・コードを実行する経路を無くす。#1783・#1801と比べられる。費用を上限内に収める | 本文・referenceの読込み（このIssueの主な測定値）は観測できる。手順の実行（作業場所の作成、テスト、ブラウザーの操作、commit）は観測できず、回答の目印で代える。実装の依頼（asc-3）では、編集のtoolが無いことがSkillの選び方を変えうる（読込みを増やす方向にも減らす方向にも働きうる）。利用者の環境での読込み率と同じとは言えない |
| sessionを保存しない、MCP無し | 実HOME・他の設定の影響を無くす | Skillの一覧とContextの内容には影響しない（隔離の確認で確かめる） |

## 条件

条件の内容は[conditions.json](conditions.json)。すべて同じsample project・同じ`CLAUDE.md`の概要から始め、違いは次だけにする。文例は、導入したreleaseの`.agent-skill-chain/v05/USAGE.md`（利用者が読む文書）の「ASCを読む契機を利用先へ採用する（任意）」から取り出す（sha256を記録）。hookの文面は文例と同じにして、経路（`CLAUDE.md`かhookか）の違いだけを比べる。

| 条件 | 内容 | 測定 |
| --- | --- | --- |
| R | 登録だけ（`project-assets --register-claude-skill --apply`まで。案内もhookも無い） | 段階1（現状） |
| P | Rに加え、`CLAUDE.md`の末尾に文例を追記してcommit | 段階2 |
| H | Rに加え、`.claude/settings.json`のSessionStart（matcher `startup\|resume\|clear\|compact`）で文例を`additionalContext`として注入するhookを登録してcommit。登録の形は、USAGEが`resume-context`のhookで案内している形と同じ。releaseに注入用のコマンドが無いので、projectの小さなscript（`.claude/hooks/asc-read-trigger.mjs`）で出す | 段階2 |
| PH | PとHの両方 | 費用の上限の外。P・Hのどちらも水準に届かない場合に、実行せずに報告する |
| S | hookで強い文面（このrepositoryのhookに近い、作業前に読むことを求める文）を注入 | 同上（ownerが追加を選んだ場合だけ） |
| I | 改善の後：ownerが採用した仕組みを、新しいreleaseの`project-assets`の提案から利用者の承認の手順で適用したもの。sample projectを`make-fixture.mjs --adopt <選択肢のid>`で作り、導入のときに承認する（`install-asc.mjs`が計画の`readTrigger`の選択肢を、表示されたsha256付きで`--adopt-read-trigger`に渡す）。hookが製品のcommandの場合（`hook: "product"`）、発火はtraceのSessionStartのhook eventで数える | 段階3（定義の形は`conditions.json`の`conditionISchema`。追加の手順は下の「段階3の固定」） |

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

- 全段階（隔離の確認、段階1〜3、再実行）で、repositoryの外の**1つの台帳file**（`--ledger`）を使う（レビューM4）。台帳は`fixation.mjs init --ledger`で作り、1行目の台帳idを`fixation.json`に記録する。`run-trial.mjs`は、別のidの台帳や存在しない台帳では起動しない。試行の`meta.json`・`trials.json`に台帳idと予約の番号（seq）を残し、`collect.mjs`・`score.mjs`は、違う台帳idや重なったseqが混ざれば拒否する（レビューN-1）。ただし、同じidの台帳を前の状態（複製や、行を消した状態）に戻すことは、codeでは防げない。戻した後の試行のseqが、既に集めてcommitした試行のseqと重なる場合にだけ検出できる。このため、次の手順を必須とする（レビューL-α）：各段階の後（少なくとも段階1の後と段階2の後）に、ただちに`collect.mjs`で記録を集めてcommitする。統括は各段階の後に、台帳の行数とsha256をIssueに記録する。次の段階の前に、台帳の行数がその記録以上で、記録した行数までの内容が同じであることを確かめる。予約には試行ごとに一意なidを付け、累計はidごとに数える。同じ試行名は台帳に1回しか予約できない（再実行は新しい反復の番号で行う。レビューN1）。試行は起動の前に予算額（0.6 USD）を台帳へ予約し、終了後にHostの`total_cost_usd`で精算する。精算されなかった試行（親processの強制終了等）は予算額のまま数える。
- `run-trial.mjs`は、台帳の累計にその試行の予算を足して、上限30 USDから余裕1 USDを引いた29 USDを超えるなら起動しない。上限・余裕・1試行の予算（0.6 USD）は`conditions.json`の`budget`だけから取り、`--stop-usd`・`--budget`の引数は拒否する（レビューL-a）。最後の試行の実際の費用が`--max-budget-usd`を少し超えても、30 USDに届かないようにする（レビューL-5）。
- 試行は1つずつ順に実行する。台帳のlock fileが残っていれば、人が台帳を確かめてlockを消すまで、次の試行は起動しない。
- `results/fixation.json`の最後の記録（測定の前のHEADと、条件・gold・判定・起動に関わるfileのsha256）と現在のfileが違えば起動しない。各試行の`meta.json`に、`fixation.json`のsha256・記録のcommit・段階を残す（レビューN2）。
- 有料の試行は、`release.json`にあるtarballから導入したsample projectでだけ起動する。複製の直後に、HEADが導入の記録の`sampleHead`と同じで、未commit・未追跡のfileが無いことも確かめる（本文や後から置いたfileの改変を検出する。レビューL-b）。導入の記録（`<sample>.install.json`）が無い、dry runの代用品で作った、試行の複製の入口・`distribution.json`が記録と違う、条件Iの採用した選択肢が条件と違う、のどれかなら起動しない（レビューL-2）。
- 再実行：規則5の失敗だけ、同じ条件・ケースで次の番号の試行を1回実行でき、採点では失敗の代わりに数える。それ以外の追加の試行は採点に含めず、別に報告する（`score.mjs`の`selectCounted`。レビューL-3）。

### 固定の記録と変えてよい範囲（レビューN2・M-1・L-c・L-d）

`results/fixation.json`は追記だけの記録である。`run-trial.mjs`は最後の記録と照合し、加えて、`fixation.json`がcommit済みで変更が無いこと、各記録のcommitがHEADの履歴にあること、最初の記録のcommitがこのREADMEに書かれていることを確かめる。

- **最初の記録**：`fixation.mjs init`。既存のfileは上書きしない。
- **段階0の後の是正（refix）**：隔離の確認の結果、`probe-check.mjs`を直す必要が出た場合は、測定の前の是正として扱う。`node harness/fixation.mjs refix results/fixation.json --ledger <台帳> --reason <理由> --review <独立レビューの参照>`で、段階0〜2の記録を足す。足せるのは、台帳fileが存在して`init`で記録した台帳idと同じで、probeの予約が1件以上あり、段階1・2の予約が1件も無い場合だけ。変えてよいfileは`harness/probe-check.mjs`だけで、`conditions.json`（`budget`・`model`・`runs`を含む）・`decision-criteria.md`・`cases.json`・`score.mjs`等はbytesで同じでなければ拒否する（レビューN-1）。`run-trial.mjs`は、refixの記録の時刻が台帳の最初の段階1・2の予約より後なら起動しない。refixの前に独立レビューを通す。
- **段階3（条件I）**：`node harness/fixation.mjs stage3 results/fixation.json [--change <file> --reason <理由> --review <参照>]…`で1回だけ足す。最新の段階0〜2の記録と比べて、次をすべて満たす場合だけ足せる。
  1. `conditions.json`の違いが`conditions.I`の追加だけで、`conditions.I`が`conditionISchema`を満たす（`pointer: false`、`hook`は`null`か`"product"`、`pointerDelivered: true`、`adopt`は選択肢のid、許された項目だけ）。
  2. `release.json`の違いが`phase3`の記入だけ。
  3. 変えてよいfileの一覧（`STAGE3_ALLOWED`）は`harness/condition-i.mjs`だけ。条件Iに固有の部分（製品のinterfaceの前提：計画の`readTrigger`の形と`--adopt-read-trigger`の指定、条件Iのprobeの期待と照合する文例の頭の文面、製品のhookの発火の数え方）をこのfileに集めた。変える場合は、fileごとに理由と独立レビューの参照を付け、記録に残す。exportの名前の一覧とimportの行が最初の記録と同じで、最上位の処理（import・export・注記以外の行）が無いことを`stage3`が機械的に確かめる。独立レビューでは加えて、規則5の意味（hookが発火しなかった試行は失敗）が保たれていること、R/P/Hの採点に影響する変更が無いことを確かめる（レビューL-1）。機械の検査は行の頭だけを見るので、字下げした最上位の文、exportの初期化式の中の処理（関数の呼出し・即時実行・top-levelの`await`）、`export {…}`や`export async function`による追加は見落とす。`condition-i.mjs`は`run-trial`（`make-fixture`・`install-asc`経由）・`collect`（`apply-condition`経由）・`score`・`probe-check`の読込み時に評価されるので、Reviewerは本文を読んで、読込みの時の処理（副作用）が無いこと、global・他のmoduleの状態を変えないこと、上の見落とす形が無いことを確かめる（レビューL-β）。
  4. それ以外の固定したfile（採点・判定・gold・判定の規則・R/P/Hの経路・起動・台帳・固定のscript）は、bytesで同じ。
  満たさなければ足さずに止まる。その場合は段階3へ進まず、統括・ownerへ報告する。
- **条件Iのprobeの期待**：文例の頭が回答の**どこかに**現れること（最後の行でなくてよい）。採用した塊が`CLAUDE.md`の末尾に閉じの区切りを置く形でも判定できるよう、probeの質問8で「`.agent-skill-chain/skills/asc/SKILL.md`を含む文」を原文で答えさせる。
- 段階1の後と段階2の後に、実績の平均単価で残りの段階の費用を見積もり、合計が30 USDを超える見込みなら、次の段階へ進まずに報告する。段階3の費用（約6.3 USD）を残すため、段階2を始める時点の見込みを優先する。
- 1試行の予算上限は0.6 USD（#1783の最大の数倍）。

## 隔離の確認（測定の前、各条件1回）

測定と同じ起動の設定（同じsample project・条件・HOMEの作り方・tool・model）で、[run-trial.mjs](harness/run-trial.mjs)の`probe`を実行し、[harness/probe-check.mjs](harness/probe-check.mjs)で判定する。モデルを1回呼ぶので、統括の許可の後に行う。

準備（ownerの了承：実HOMEに一時的に置き、確認の後に削除する）：`node harness/markers.mjs create <このrepositoryのroot>`で、実HOME（`asc1814-home-marker.txt`）とこのrepository（git管理外の`.agent-skill-chain/local/asc1814-repo-marker.txt`）に、乱数の目印を書いたfileを1つずつ作る（既存fileは上書きしない）。2つの名前を変え、完全なpathでそれぞれの読込みの試みを照合する（レビューL1）。確認の後に`remove`で消す。

すべてが合格した条件だけを測定する。

| 確認 | 合格の条件 |
| --- | --- |
| 起動 | init eventがあり、`cwd`が試行のsample project、toolが`Read`・`Glob`・`Grep`・`Skill`（と`ToolSearch`）だけ、MCP・pluginが無い。Claude Code本体のディレクトリ（実行fileのあるディレクトリ）が、実HOME・利用者の設定ディレクトリ・このrepositoryを含まず、それらの中にも無い（レビューM2） |
| Skillの一覧 | init eventの`skills`にASCの16件がすべてある。ASC以外は同梱Skillとして名前を記録する |
| 説明文 | `asc`と`user-journey-acceptance`のdescriptionを、fileを読まずに原文のまま答えられる（入口のfrontmatterと照合。読んだ形跡があれば不合格）。16件の原文の一致数も記録する |
| 指示ファイル・memory | 各指示fileとSessionStartで足された文脈の、最初の1行と最後の1行を答えさせる（Pの文例は`CLAUDE.md`の最後の段落なので、最初の1行だけでは現れない。レビューN3）。sample projectの`CLAUDE.md`の1行目を答える（`#`の有無は問わない）。文例（「このプロジェクトでASCを使う」）は、P・H（・PH・I）だけで現れ、Rでは現れない。このrepositoryの`CLAUDE.md`・`AGENTS.md`の1行目が現れない。ownerの実際の指示・memory（`~/.claude`と、照合を実行するshellの`CLAUDE_CONFIG_DIR`の`CLAUDE.md`、各projectのmemoryの索引`MEMORY.md`）の先頭の行が、回答にもdebug logにも現れない。照合に使う行は出力に残さず、件数だけを残す（レビューM3） |
| Skillの出所 | ASC以外のSkillの名前が、ownerの個人用Skill（上の設定ディレクトリの`skills/`）の名前と重ならない（レビューM3） |
| gitの状態 | 回答に出たcommitの件名に、条件ごとの文字列（read trigger等）が無い（レビューM1） |
| 目印 | 実HOMEとこのrepositoryの目印のReadを、完全なpathでそれぞれ試み、どちらも拒否される。2つの目印の文字列がそろって読めること（読めなければ不合格。レビューL2）と、それがtrace・stderr・debug logのどこにも無いこと |
| debug log | `CLAUDE.md`・`AGENTS.md`・memory・settings・skillsに関わる行のpathが、試行のディレクトリ、Claude Code本体の導入先（実HOMEの下にある場合がある）、機械の管理用policyの場所の中だけ。実HOMEとこのrepositoryのpathが、目印の行とClaude Code本体のpath以外に無い |
| hook | fixtureのhookの条件ではSessionStart（source `startup`）の発火がlogにあり、製品のhook（条件I）ではtraceにSessionStartの応答のeventがあり、hookの無い条件ではどちらも無い。traceのhook eventはevent名で分け、SessionStart以外のevent、条件以外のcommand、fixtureのhookのlogの件数を超えるSessionStartの応答があれば不合格（レビューM3・L-1）。eventの実際の形は段階0で初めて分かる。形が想定と違って不合格になった場合は、測定へ進まずに報告する |
| 説明文の出所 | 説明文を答える前に、`.claude/skills`・`.agent-skill-chain`・`SKILL.md`をRead・Grep・Globしていない（レビューL4） |
| 条件の間の比較 | `node harness/probe-check.mjs compare <各条件の結果>`で、tool・ASC以外のSkillの一覧・gitの状態（commitの件名の集合として比べる。レビューL-7）・解決後のmodelが条件の間で同じこと。違ってよいのは`CLAUDE.md`とhookの出力だけ（レビューM1）。ただし、Hostが送るsystem contextそのものは観測できない（capture serverを使わないため）。モデルの回答とinit eventから確かめられる範囲に限る |

## 手順

モデルを呼ばない準備（実施済み、[README.md](README.md)「実施したこと」）：

```sh
node --test docs/evidence/1814-skill-invocation/harness/score.test.mjs docs/evidence/1814-skill-invocation/harness/probe.test.mjs
node docs/evidence/1814-skill-invocation/harness/dry-run.mjs <tarball> <sha256> <新しいscratchのdirectory> --out <json>
```

測定（統括の許可の後。`ASC1814_ALLOW_PAID=1`と認証の環境変数を、実行するcommandだけに付ける。例：`ASC1814_ALLOW_PAID=1 CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/asc-eval/claude-oauth-token)" node harness/run-trial.mjs …`）：

0. `node harness/fixation.mjs check results/fixation.json`が一致すること（`run-trial.mjs`も起動の前に確かめる）。
1. `gh release download v0.5.106 --pattern 'agent-skill-chain-0.5.106.tgz' --pattern SHA256SUMS --dir <scratch>/release`。tarballのsha256が`release.json`の`assetSha256`とSHA256SUMSの両方と一致することを確かめる。
2. `node harness/dry-run.mjs <tarball> <sha256> <scratch>/dry-release`（`--allow-unreleased`なし）で、本物のreleaseでも採点器のSkillの一覧が配布一覧と一致すること等を確かめる。続いて`node harness/make-fixture.mjs <tarball> <sha256> <scratch>/sample <scratch>/tmp`。sha256が`release.json`のものでなければ止まる（dry runだけが`--allow-unreleased`で外す。レビューL7）。版・digest・入口のsha256・sample projectのHEADを`<scratch>/sample.install.json`に記録し、各試行の`meta.json`へ写す（レビューL8）。
3. 段階0：`node harness/markers.mjs create <repo>`、条件R・P・Hごとに`node harness/run-trial.mjs <scratch>/runs <条件> probe 1 --fixture <scratch>/sample --home-marker <…> --repo-marker <…> --ledger <台帳（initで記録したもの）> --run`、`node harness/probe-check.mjs <scratch>/runs/<条件>-probe-1 <条件> <…> <…> <repo> > <scratch>/probe-<条件>.json`、`node harness/probe-check.mjs compare <scratch>/probe-*.json`、`node harness/markers.mjs remove <repo>`。
4. 段階1・2：`node harness/run-trial.mjs <scratch>/runs <条件> <case> <1|2> --fixture <scratch>/sample --ledger <台帳> --run`を全ケースで、1つずつ順に。
5. `node harness/collect.mjs <scratch>/runs results/traces`、`node harness/score.mjs cases.json results/traces R P H --runs-json results/runs.json --judge R P`（Hも同様）。
6. 段階3：`conditions.json`へ`conditions.I`を、`release.json`へ`phase3`を記入してcommitし（製品のinterfaceが前提と違えば`harness/condition-i.mjs`だけを直し、独立レビューを通す）、`node harness/fixation.mjs stage3 results/fixation.json …`で記録を足してcommitする。採用した仕組みを含むreleaseで、`make-fixture.mjs … --adopt <選択肢のid>`から2〜5を繰り返す。runs-rootは分けてよいが、台帳は同じfileを使う。

## 実装者が決めた技術的な事項（理由付き）

| 事項 | 決めたこと | 理由 |
| --- | --- | --- |
| model | `sonnet`の別名（統括の決定、[decision-criteria.md](decision-criteria.md)で固定） | #1807で本文が0/69だった生成と同じ。別名が指す版は時期で変わりうるので、試行ごとに解決後のmodel idを記録する。結果を見た後に変えない |
| 反復 | 各条件2回 | 上限30 USDで、現状・候補2つ・改善の後を同じ試行数（28）で比べるため。3回では段階3が上限を超える |
| tool | 読取りとSkillだけ（統括の決定） | 「利用者の環境との意図した違い」の節 |
| 文例とhookの文面 | 同じ文（USAGEの文例） | 経路の違いだけを比べるため。強い文面（S）は任意の追加 |
| hookのcommand | projectのscript | releaseに注入用のコマンドが無い。改善ではCLIの副コマンドにする案（IMPROVEMENT_DESIGN.md） |
| sample projectの`CLAUDE.md` | 導入前からある概要だけの`CLAUDE.md` | 多くの利用先には既存の`CLAUDE.md`がある。Pは利用者が文例を追記した状態に当たる |

## 実行の前に統括・ownerが用意すること

- 認証（ownerが決定済み）：試行ごとの空のHOMEではOSの資格情報の保管場所を使わないので、`CLAUDE_CODE_OAUTH_TOKEN`（`claude setup-token`）または`ANTHROPIC_API_KEY`を、実行するshellの環境変数として用意する。値はrepository・記録に残らない（`run-trial.mjs`が置き換える）。
- releaseのtarballとSHA256SUMSの取得（GitHubからのdownload）。
- 実HOMEへの目印fileの作成と削除（ownerが了承済み。`markers.mjs`が作る1 fileだけで、確認の後に消す）。
- 台帳file（repositoryの外）の置き場所。

## 限界

- モデル1種類、sample project 1つ、各条件2回。統計的な発火率ではなく、水準の判定は粗い（該当する依頼22試行で、80%は18試行以上）。
- 読取りのtoolだけなので、実装の依頼（asc-3）で作業場所を作る・テストを走らせる等の手順の実行は観測しない。回答の目印で代える。
- 回答の目印は、Skillを読まなくても書かれ得る。手順の適用は本文・referenceの読込みと合わせて判定する。
- hookのcommandは利用者向けの正式なコマンドではない（段階3で正式な形を測る）。
- 試行は利用者のmachineと同じHost上で動き、sample projectの外の読書きの拒否はClaude Codeの権限の仕組みによる（#1807と同じ。OSの境界ではない）。隔離の確認で反例を確かめる。
- 機械の管理用policy（managed settings）は利用者の環境の一部として残る。debug logに現れた場合は記録する。
