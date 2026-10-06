# agent-skill-chain

agent-skill-chainは、人とAI agentが同じ手順で使える、安全側に倒す軽量な開発ワークフローです。要求から実装、検証、レビュー、PRまでをStep契約でつなぎ、権限や証拠が不明な操作は実行しません。

このREADMEは初めて利用する人のための非規範的な公開入口です。規則や製品仕様はここで再定義せず、後述する正本を参照してください。

Claude CodeのAgent Lifecycleによる常時観測は廃止しました。`install/update --apply`は旧ASC所有hook登録を削除し、利用者のhookと権限設定を保持します。残留session記録の解除は不要です。詳細は[hook利用案内](.agent-skill-chain/hooks/00_利用案内.md)を参照してください。

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

これは担当交代の概念図で、全Stepが必ず1 Agentになるという意味ではありません。次の担当と入力は`workflow advance --staging=<path>`が導出します。進行役は出力の`agentDispatch`をAgentツールの引数へ渡します。 `handoff.workUnit.workUnitId`が担当の識別子で、返却後はそのAgentを再利用しません。Step 9の途中でfresh Agentへ移るときはcheckpoint commit後に`workflow advance --staging=<path> --continue-from=<前のHEAD>`を実行し、新しい`agentDispatch`を渡します。hook自身が次のAgentを自動起動するわけではなく、handoff JSONを利用者が手組みする必要もありません。

目的は、実装から是正まで同じ会話を使い続けることによるcontextの肥大化を抑え、現在のrepositoryに基づく判断と役割分離を保つことです。token・cache readの削減率はまだ実測で確定していません。新しいAgentの初期化・再読コストも含むBefore/After計測はIssue #1546の残件です。

### 何が短命になり、何が継続するか

| 対象 | 挙動 |
| ---- | ---- |
| ASC工程担当のsubagent | 担当Step・role・HEADへ結び付け、完了後は同じIDを再利用しません。別担当・是正・次review roundはfresh Agentへ渡します |
| main / coordinator | 工程の進行、担当の起動、記録を行います。会話の継続・resumeは可能で、hookがmainの会話を自動交換することはありません |
| 通常の調査・資料作成task | 自然言語promptでfresh Agentを起動できます。複数taskの並走も可能ですが、その結果だけではASC工程のreview承認証跡になりません |
| repositoryの成果物・review session | Agentが終了しても残ります。review sessionは複数roundにまたがり、各回のReviewerのagent IDとは別に管理します |
| 会話履歴 | ASCは履歴全体の次Agentへの継承を引継ぎ手段にしません。履歴の保存・削除自体はhostが管理します |

### 常時観測hookの廃止

ASCはsession・agent・toolの常時観測と実行予約を行いません。同一worktreeでも別worktreeでも、残留予約や別sessionの状態を理由に開発操作を拒否しません。担当の引き継ぎにはGit・Issue・staging・review sessionを使います。

`install/update --apply`はASC所有のlifecycle hook登録を削除し、利用者のhookとpermissionsを保持します。既存sessionが旧登録を保持していても、更新された互換hookは状態を読み書きせず正常終了します。古い実行記録の手動解除や、生存sessionの確認は不要です。`ASC_AGENT_BUDGET_MODE`・`ASC_AGENT_MAX_TOOLS`による観測・強制停止も廃止します。

導入・更新後は`doctor --root=.`でmanaged assetsの整合性を確認してください。lifecycle hookが未登録でも正常です。host自身の権限確認、明示的なworkflow・review・配布検証は引き続き有効です。

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
