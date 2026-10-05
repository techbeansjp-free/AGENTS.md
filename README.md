# agent-skill-chain

agent-skill-chainは、人とAI agentが同じ手順で使える、安全側に倒す軽量な開発ワークフローです。要求から実装、検証、レビュー、PRまでをStep契約でつなぎ、権限や証拠が不明な操作は実行しません。

このREADMEは初めて利用する人のための非規範的な公開入口です。規則や製品仕様はここで再定義せず、後述する正本を参照してください。

Claude CodeのAgent Lifecycleは、既存の`install/update --apply`でhook登録と対応CLIまで構成します。追加のenv・hook・版付きCLI path・timeoutの手設定は不要です。更新後は新規sessionを開始してください。設定の所有境界と互換overrideは[hook利用案内](.agent-skill-chain/hooks/00_利用案内.md)を参照してください。

## 前提条件

- Node.js 20以上
- npm
- Git 2.38.0以上
- GitHub CLI（`gh`）2.13.0以上

Semantic Graphの`graph` subcommandだけは、組み込み`node:sqlite`でGraphQLite extensionを読み込むためNode.js 22.13.0以上を必要とします。それ以外のCLIはNode.js 20以上で利用できます。

## 導入と利用

**正式な配布物はGitHub Releaseのasset `agent-skill-chain.tgz`です。** npm registryへは公開していません。

| 用途 | 取得元 |
| ---- | ------ |
| 最新のrelease | `https://github.com/techbeansjp-free/AGENTS.md/releases/latest/download/agent-skill-chain.tgz` |
| 版を固定したrelease | `https://github.com/techbeansjp-free/AGENTS.md/releases/download/v<X.Y.Z>/agent-skill-chain.tgz` |

`<X.Y.Z>`にはreleaseのversion（導入済みCLIの`agent-skill-chain --version`が返す値、またはGitHub Releaseのtag名`v<X.Y.Z>`から`v`を除いた値）を指定します。**GitHubが各Releaseへ自動生成する「Source code (zip)」「Source code (tar.gz)」は正式配布物ではありません。** これらはGitのsource treeそのものであり、`agent-skill-chain.tgz`とは別物です。

**Git remoteから直接実行するsource経路も利用できます。** `npx`は**本package自体をregistryから解決せず**、GitHubから直接取得して実行します。

**ただしregistryを完全に使わないわけではありません。** Git取得時は`prepare`が`npm run build`を実行するため、その過程でdevDependenciesをregistryから取得します。

| 用途 | command |
| ---- | ------- |
| 最新のsourceを使う | `npx github:techbeansjp-free/AGENTS.md doctor --root=.` |
| 版を固定したsourceを使う | `npx github:techbeansjp-free/AGENTS.md#<tag> doctor --root=.` |

`<tag>`にはreleaseのtag（`v<X.Y.Z>`の形）を指定します。**この経路はsource buildであり、`agent-skill-chain --version`はrelease versionを返しません。** **以降の例に現れる`npx agent-skill-chain <command>`は、この`npx github:techbeansjp-free/AGENTS.md <command>`の短縮表記です。**

対象directoryを省略した場合は現在directoryを使います。対象を明示するときは`--root=.`を指定します。

`install`、`update`、`delete`は何も書き換えないpreviewが既定です。表示された変更を確認し、同じcommandへ`--apply`を付けた場合だけ変更します。`doctor`は読み取り専用で、GitとGitHub CLIのversionも診断します。

| 操作 | previewまたは診断                        | 変更の適用                                       |
| ---- | ---------------------------------------- | ------------------------------------------------ |
| 導入 | `npx agent-skill-chain install --root=.` | `npx agent-skill-chain install --root=. --apply` |
| 更新 | `npx agent-skill-chain update --root=.`  | `npx agent-skill-chain update --root=. --apply`  |
| 削除 | `npx agent-skill-chain delete --root=.`  | `npx agent-skill-chain delete --root=. --apply`  |
| 診断 | `npx agent-skill-chain doctor --root=.`  | 変更なし                                         |

<!-- 自動生成: CLI利用案内 -->

各commandの必須flagは`--help`で確認できます。必須flag検証より先に評価され、要約、必須flag、条件付きflag、任意flagと既定値、実行例をJSONで返します。

```
npx agent-skill-chain worktree create --help
```

必須flagが不足したまま実行した場合も、不足を1回の実行ですべて列挙します。上の例では6件を一度に返します。値をとるflagは`--flag=値`の形式で指定してください。空白区切りは受理せず、専用の診断で拒否します。

<!-- 自動生成ここまで -->

詳しいowner境界、更新時に保持される資産、各Stepの使い方は[中央利用案内](.agent-skill-chain/00_利用案内.md)から確認できます。

## Claude CodeとCodexとの連携

`install`と`update`は、Claude Code用の`.claude/skills/asc-step/SKILL.md`とCodex用の`.agents/skills/asc-step/SKILL.md`を管理します。各hostはこの登録アダプターから、開発ワークフローと現在のStep契約へ到達できます。配置や内容は`doctor`で診断できます。

## Agent Lifecycle

### short-livedとは

ASCの`short-lived`は、**作業単位ごとに、前の会話履歴を引き継がない新しいsubagentへ担当を渡す実行方式**です。要求整理、設計、実装、レビュー、是正を一つのAgent会話で続けず、担当を終えたsubagentは終了します。Step 10ではreview roundごとに新しいReviewerを使い、是正は別のCorrection Agentへ渡します。Reviewer自身は実装を修正しません。

引き継ぐ状態の正本は、GitのHEAD・差分、Issue、worktree、stagingの計画や成果物、review sessionとfindingです。これを指す情報が**repository-state handoff**です。次のAgentはrepositoryから必要な状態を読み直します。前の会話や自然言語summaryを新しい承認根拠にはせず、既存のHEAD・digest・検証・review gateを通します。

```text
main / coordinator（進行役。継続・resume可能）
  │
  ├─ 要求整理のfresh Agent → 成果物を保存して終了
  ├─ 設計のfresh Agent     → 成果物を保存して終了
  ├─ 実装のfresh Agent     → 検証・commit・返却して終了
  ├─ fresh Reviewer       → findingを返却して終了
  ├─ fresh Correction     → 是正・検証・commit・返却して終了
  └─ 次roundのfresh Reviewer
          ↑ 各担当はrepository stateから再開
          Git / Issue / staging / HEAD / review session
```

これは担当交代の概念図で、全Stepが必ず1 Agentになるという意味ではありません。次の担当と入力は`workflow advance --staging=<path>`が導出します。進行役は出力の`agentDispatch`をAgentツールの引数へ渡します。hook自身が次のAgentを自動起動するわけではなく、handoff JSONを利用者が手組みする必要もありません。

目的は、実装から是正まで同じ会話を使い続けることによるcontextの肥大化を抑え、現在のrepositoryに基づく判断と役割分離を保つことです。token・cache readの削減率はまだ実測で確定していません。新しいAgentの初期化・再読コストも含むBefore/After計測はIssue #1546の残件です。

### 何が短命になり、何が継続するか

| 対象 | 挙動 |
| ---- | ---- |
| ASC工程担当のsubagent | 担当Step・role・HEADへ結び付け、完了後は同じIDを再利用しません。別担当・是正・次review roundはfresh Agentへ渡します |
| main / coordinator | 工程の進行、担当の起動、記録を行います。会話の継続・resumeは可能で、hookがmainの会話を自動交換することはありません |
| 通常の調査・資料作成task | 自然言語promptでfresh Agentを起動できます。複数taskの並走も可能ですが、その結果だけではASC工程のreview承認証跡になりません |
| repositoryの成果物・review session | Agentが終了しても残ります。review sessionは複数roundにまたがり、各回のReviewerのagent IDとは別に管理します |
| 会話履歴 | ASCは履歴全体の次Agentへの継承を引継ぎ手段にしません。履歴の保存・削除自体はhostが管理します |

工程のwriterが同一worktreeを使用している間、main・通常task・別sessionからの書込みをhookで拒否します。通常taskは読取・検索・連絡を続けられますが、Bashは読取目的でも拒否されます。先行する通常taskが開始待ち・実行中ならworkflow writerの開始を待ちます。書込みを並走させる場合は別worktreeを使います。工程担当の起動が拒否されたときは、mainによる実装代行へ切り替えず、拒否理由を解消して再委譲します。

この機械強制は対応するClaude Code hookを通る操作が対象です。CodexにはStep skillの登録口を配布しますが、Agent Lifecycle hookによる強制は未対応です。人間のTerminal操作やhookを通らない外部processまで隔離する機能ではありません。

### 既定値とcompatibleの違い

**通常利用ではenvを追加する必要はありません。** この機能を含む版の`install/update --apply`がhook本体・登録・timeout・project-local CLI runtimeを管理します。内部ではhookを使うため、生成されたASCのhook登録は削除せず、そのまま使ってください。適用後は新規Claude Code sessionを開始します。

| 観点 | `short-lived`（未設定の新規sessionの既定） | `compatible`（明示override） |
| ---- | ---- | ---- |
| ASC工程担当の起動 | repositoryから再導出したhandoffでStep・role・HEADを検証 | short-lived固有のhandoff起動制約を適用しない従来互換経路 |
| contextの継承 | `fork`を拒否し、fresh Agentを使う | short-lived固有のfresh-context制約は適用しない |
| 完了したsubagent | 再利用禁止 | 再利用禁止は継続 |
| mainの会話 | 継続・resume可能 | 継続・resume可能 |
| 同一worktreeのwriter保護 | 有効 | short-livedのworkflow writerが占有中ならcompatible sessionも保護対象 |
| 通常の用途 | 標準利用 | 互換性確認・障害切り分けなど、理由がある場合の切替 |

`compatible`はhookや品質gateを無効化する設定ではありません。既存sessionに保存されたmodeは更新で反転しません。また、以前の回避策として明示した`compatible`はupdateでも保持されます。標準方式へ戻す場合はそのoverrideを取り除き、新規sessionを開始してください。

### 必要な場合だけ変更する設定

ここでは、ASC runtimeの環境変数と、Claude Code側でhook実行に影響する設定を分けて説明します。通常は追加設定なしで利用してください。

hookの必須event集合、canonical command、timeout（30秒）、managed runtimeの配置先はASC管理値であり、通常は編集対象ではありません。install/updateはASC所有の登録を標準状態へ揃えます。任意のcommandへ書き換えたラッパーはASC所有と推測せず保持・診断するため、手動変更のすべてを自動修復するわけではありません。利用者のpermissionsや無関係なhookは保持します。

#### ASC runtimeのoverride

次の環境変数はClaude Codeの起動環境や`.claude/settings.local.json`の`env`で明示できます。modeとtool数の目安は新規session開始時に固定され、途中の環境変更やcompactではリセットされません。

| 環境変数 | 未設定時 | 許容値・用途 | 通常変更するか |
| -------- | -------- | ----------- | ------------ |
| `ASC_EXECUTION_CONTEXT_MODE` | `short-lived` | `short-lived` / `compatible`。工程担当の実行方式 | 不要。互換動作が必要な場合だけ`compatible` |
| `ASC_WORKFLOW_CLI` | project-local managed runtime | 開発・緊急用のCLI override。実在する絶対path | 不要。版付きpathを手設定しない |
| `ASC_AGENT_BUDGET_MODE` | `warn` | `observe`は計測のみ、`warn`は警告、`enforce`はsubagent上限を強制する実験用設定 | 不要。`enforce`は標準運用に使わない |
| `ASC_AGENT_MAX_TOOLS` | `120` | `10`〜`1000`の整数。tool試行数の目安 | 不要。この値だけでは強制停止しない |

`compatible`はupdateでも保持する明示overrideです。`short-lived`の明示指定もruntimeでは受理しますが、既定値と同じため、`.claude/settings.local.json`の`env`にある指定はinstall/update時に冗長設定として除去します。起動元shellの環境変数は書き換えません。

tool試行数はAPI call数やcontextのtoken数ではありません。**既定の`warn`では120回でAgentを強制終了しません。** mainはどのbudget modeでもtool数によって停止しません。実験用`enforce`は状態保存完了を待ってから停止する保証がないため、short-livedの標準動作と混同しないでください。

#### Claude Code側のhook設定

| 設定 | 意味 | ASCの扱い・通常の利用 |
| ---- | ---- | ------------------- |
| `disableAllHooks: true` | Claude Code側でhookを無効化する設定。project-localのASC Agent Lifecycle hookも停止する | 通常は使用しません。install/updateは明示的な無効化の意図を保持し、doctorはproject-local設定を不健全として報告します |

`disableAllHooks`は`env`内の文字列ではなく、Claude Code settingsのトップレベルに置くbooleanです。ASCの`compatible`とは異なり、ASC以外のhookにも影響します。通常運用へ戻す場合は有効な設定元を確認して無効化を解除し、doctorで再確認して新規sessionを開始してください。global・managed・plugin側の設定までproject-localのdoctorが観測できるわけではありません。local設定ではmanaged policyのhookを無効化できません。設定階層による適用範囲は[Claude Code公式仕様](https://code.claude.com/docs/en/hooks#disable-or-remove-hooks)を参照してください。この表はASC連携に関わる項目の説明であり、Claude Code全設定の一覧ではありません。

### 診断と復旧の入口

導入・更新後は`doctor --root=.`で登録とruntimeを確認してください。`runtimeVerified: false`は実hostでhookが発火したことまでは確認していないという意味です。

更新で廃止されたruntime fileが変更済みの場合、ASCは内容を消さず保持し、信頼対象から外します。この未登録fileが残る間はdoctorとtrusted CLIが拒否します。**再度`update --apply`するだけでは除去されません。** 報告されたpathの内容を確認し、必要ならruntime外へ退避してから当該fileを除去し、doctorを再実行してください。runtime全体や管理記録をまとめて削除しないでください。

hookの停止記録やwriter予約が残った場合も、時刻だけで自動解放しません。詳細な設定所有境界、拒否理由、owner停止確認とdigestを使う復旧手順は[hook利用案内](.agent-skill-chain/hooks/00_利用案内.md#agent-lifecycle--handoffissue-1546)を参照してください。

## 正本と仕様

- リポジトリでの入口: [AGENTS.md](AGENTS.md)
- package全体の案内: [中央利用案内](.agent-skill-chain/00_利用案内.md)
- 権限と所有権: [運用ポリシー](.agent-skill-chain/docs/00_運用ポリシー.md)
- Step 0〜11の順序: [開発ワークフロー](.agent-skill-chain/docs/01_開発ワークフロー.md)
- 開発、テスト、レビュー、安全gate: [品質基準](.agent-skill-chain/docs/02_品質基準.md)
- 現在の製品仕様: [製品仕様利用案内](docs/specs/00_利用案内.md)

困ったときや不具合を見つけたときは、[GitHub Issues](https://github.com/techbeansjp-free/AGENTS.md/issues)で相談・報告してください。

最新版への更新依頼は[更新の入口](.agent-skill-chain/00_利用案内.md#ascを最新版にしてと依頼された場合)に従う。`update --latest --root=. --apply`で正式版の解決・更新・doctorを続けて実行し、必要な場合だけ新sessionへの切替を案内する。

## 手動releaseの工程監査例外

mainへのpushによる自動releaseは維持します。releaseは`verify:distribution`で品質・全test・build・conformance・配布物を検査します。PR用のレビュー証跡差分監査（`audit:check`）はreleaseでは実行しません。代わりにremote既定branch tipとの一致、親が2つのmerge commit、一意な比較基点とmerge integrityを必須とし、観測不能・変更消失は公開を止めます。

PRのCIと通常の`verify:distribution`は従来のレビュー証跡監査を維持します。手動releaseでは`version`と`dry_run`を指定できます。工程監査例外のSHA・理由はreleaseの入力として不要です。

release workflowの検証stepだけが`ASC_RELEASE_INTEGRITY_ONLY=true`を設定する。既定branchのpushまたは手動Actionsで、実HEADと実行SHAが一致するときだけ切り替える。PR event・別branch・不完全な実行情報では切り替えを拒否する。
