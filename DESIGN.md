# DESIGN: security: reconcile workflowがpushトリガーのYAML自己参照によりGate Check Runを偽造可能

- Issue: `ISSUE-342`
- 対応する SPEC: `SPEC.md`

## 背景の要約（本設計の前提）

GitHub Actionsの`push`トリガーは、実行されるワークフローYAML自体を「pushされたコミット」から読み込む。`agent-skill-chain / reconcile`（`.github/workflows/agent-skill-chain-reconcile.yml`）は`on: push`かつ`permissions: checks: write`を持つため、writer権限保有者がワークフローYAML自体・agent-skill-chain CLIソース（`src/agents-md.ts`）・`gate reconcile`実装のいずれかを自分のissueブランチ上で改変してpushするだけで、その改変済みロジックがそのまま実行され`agent-skill-chain/{spec,design,implementation,validation}-gate`のCheck Runを偽造できる。

design-gateのstrictレビューで、この問題を`workflow_run`によるtrigger/trusted 2ファイル分離（`agent-skill-chain-reconcile-trigger.yml`を`on: push`・無権限で新設し、`agent-skill-chain-reconcile.yml`を`workflow_run`化する）で解消しようとした前ラウンドの設計に根本的な欠陥が指摘された（`reconcile-trigger-workflow-remains-self-referential-push-yaml`）。`agent-skill-chain-reconcile-trigger.yml`自体が`on: push`トリガーのままである以上、そのワークフローYAML自体（`permissions:`ブロックを含む）は攻撃者が完全に制御するpushされたコミットから読み込まれる。したがって攻撃者は`agent-skill-chain-reconcile-trigger.yml`自身の`permissions: {}`を`checks: write`へ書き換え、Checks APIを呼ぶstepを追加するだけで、trusted workflow（`agent-skill-chain-reconcile.yml`）を一切経由せずCheck Runを偽造できてしまう。`workflow_run`による分離は、GITHUB_TOKEN権限がプラットフォームにより自動的に読み取り専用へ制限されるfork由来のpull_request系イベントに対してのみ有効な緩和策であり、同一リポジトリ内のpush（fork不要）には同種の自動制限が働かない。

同リポジトリの`.github/workflows/agent-skill-chain-gate.yml`は`pull_request_target`トリガーにより、この種の自己参照問題を構造的に持たない安全なパターンを既に実装している。`pull_request_target`で起動するワークフローは、ワークフローYAML自体・チェックアウトされ`npm ci && npm run build`されるCLIソースを、常にPRのbaseブランチ（trusted。マージ後は常に最新のdefaultブランチ）から読み込む。PR head（攻撃者が完全に制御する内容）は`actions/checkout`の対象にはせず、`git fetch`によるread-onlyなgit objectとしてのみ取得し実行しない。本設計は`agent-skill-chain-reconcile.yml`をこの`pull_request_target`パターンへ全面的に作り直し、新規`agent-skill-chain-reconcile-trigger.yml`は作成しない。

判定ロジック自体の自己参照とは独立に、`gate reconcile`（`src/commands/gate.ts`の`reconcile()`）が「承認済み基準」（`approved_artifacts`）を、issueブランチへコミット可能な`issues/<id>/.agent-skill-chain/reviews/<gate>.yaml`（`reviewFilePath`）から読み込んでいる問題（承認済み基準データ自体の改ざん耐性、AC-5）、および判定対象識別子（target_sha・issue_id）自体の出所の限定（AC-6）は、前ラウンドで確定済みの設計（`resolveApprovedBaseline`・source identity検証）をそのまま維持する。本ラウンドはトリガー方式の変更にのみ集中する。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1（改変内容だけではCheck Run偽造不可） | `agent-skill-chain-reconcile.yml`の`on: pull_request_target: types: [synchronize]`化（既存ファイルの変更のみ、新規ファイルは作成しない） | `pull_request_target`はワークフローYAML自体・チェックアウトされるCLIソースを常にPRのbaseブランチ（trusted）から読む（GitHub Actionsの仕様）ため、PR head側でどう改変されても判定ロジックには反映されない。`workflow_run`+trigger.yml分離が抱えていたtrigger.yml自体の自己参照問題は、trigger.ymlという別ファイルを作らないため最初から発生しない |
| AC-2（既存の正規フロー継続） | `gate-reconcile.sh`・`artifactDigestAtSha`・Check Run再発行/無効化の判定分岐（`reconcile()`）は無変更 | SPEC.mdのAC-2 Givenは「正規のセグメントワーカーが、issueブランチに紐づくPRのheadブランチへ…push」であり、これは`synchronize`イベントそのものである。issue-start直後・Draft PR作成前の最初のpushはPRが未存在のため`pull_request_target`イベント自体が発火しないが、その時点では承認済みCheck Runがまだ1件も存在せず照合対象が無いため機能上のギャップにならない（後述「障害・ロールバック考慮」参照） |
| AC-3（本体・配布テンプレート同期） | `.github/workflows/agent-skill-chain-reconcile.yml`と`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-reconcile.yml`の内容同期（既存の仕組みのまま） | 新規ファイルを追加しないため、同期対象はIssue着手前と同じ単一ファイルに戻る |
| AC-4（dependabot許可判定の意図維持） | `Derive issue_id`ステップの3分岐ロジックは維持しつつ、判定に用いる実PR作成者を`github.event.pull_request.user.login`から直接取得する（新規`env.PR_AUTHOR`） | `pull_request_target`イベントは常にPRコンテキストを伴うため、`push`イベント時代に必要だった`gh api repos/{owner}/{repo}/pulls?head=...`によるPR特定・作成者照会が不要になる。3分岐の意図（真正dependabotのみ許可、それ以外は`ISSUE-<n>`抽出または拒否）自体は変更しない |
| AC-5（承認済み基準データ自体の改ざん耐性） | `resolveApprovedBaseline`（`src/commands/gate.ts`の`reconcile()`内部、前ラウンドで確定済み） | `pull_request_target`化により`pr_number`が`github.event.pull_request.number`としてワークフロー実行時に直接判明するため、`gate-reconcile.sh`の新設第3引数として渡す。これにより`resolveApprovedBaseline`は`GET commits/{target_sha}/pulls`によるPR特定ステップを（主経路では）省略できる。source identity検証・JSONパース失敗時のフォールバックは前ラウンドの設計をそのまま維持する（詳細は下記「コンポーネント構成」） |
| AC-6（判定対象識別子の出所限定） | `Derive issue_id`ステップの`env.BRANCH`を`github.event.pull_request.head.ref`、`Reconcile gates against pushed SHA`ステップの対象SHA引数を`github.event.pull_request.head.sha`、pr_number引数を`github.event.pull_request.number`から取得 | いずれもGitHub Actionsランタイムが`pull_request_target`イベントの一部として提供する構造化フィールドであり、pushされたブランチのコミットメッセージ・ファイル内容・環境変数からは導出されない。SPEC.mdのAC-6原文は`workflow_run`イベントの構造化フィールドを名指ししているが、本設計は「pushされた内容からではなくGitHub Actionsランタイムが提供する構造化フィールドにのみ基づいて判定対象を導出する」というAC-6の機能的要件を、`pull_request_target`が提供する同種の構造化フィールドで満たす（字句上の差分についてはPLAN.md・進行役への報告を参照） |

## 責務・境界

### コンポーネント構成

- `agent-skill-chain-reconcile.yml`（既存ファイルの`on:`・参照フィールドを変更、trusted。新規ファイルは作成しない）: `on: pull_request_target: types: [synchronize]`で起動する。ジョブに`if: github.event.pull_request.base.ref == github.event.repository.default_branch`を追加し（`gate.yml`と同型）、defaultブランチ以外を対象とするPRでは起動しない。既存の`permissions`（`contents: read`, `checks: write`, `pull-requests: read`）・job名`reconcile`・3分岐dependabot判定ロジックの意図は維持する。
  - checkout: `actions/checkout@v7`に`ref: ${{ github.event.pull_request.base.sha }}`・`fetch-depth: 0`・`persist-credentials: false`を指定し、baseブランチ（trust root）を明示的にcheckoutする（`gate.yml`と同一パターン）。
  - PR headの取得: `git fetch --no-tags origin "pull/${PR_NUMBER}/head:refs/agent-skill-chain/targets/${HEAD_SHA}"`でread-onlyなgit objectとしてのみ取得し、checkoutやビルド対象には含めない（`gate.yml`と同一パターン）。
  - `npm ci && npm run build`: baseブランチ（trust root）由来のCLIソースに対して行う。
  - `Derive issue_id`ステップ（id: `ctx`）: `env.BRANCH`を`${{ github.event.pull_request.head.ref }}`から取得する。dependabot分岐は新規`env.PR_AUTHOR: ${{ github.event.pull_request.user.login }}`を直接参照し、`gh api repos/{owner}/{repo}/pulls?head=...`によるAPI照会ステップを削除する（`pull_request_target`イベントは常にPRコンテキストを伴うため、`push`イベント時代に必要だった代替手段が構造的に不要になる）。`ISSUE-<n>`抽出・非対応ブランチ名でのexit 1・3分岐の字句順序はそのまま維持する。`env.GH_TOKEN`（`github.token`）・`env.REPO`（`github.repository`）・`env.OWNER`（`github.repository_owner`）は変更しない。
  - `Reconcile gates against pushed SHA`ステップ: 対象SHA引数を`${{ github.event.pull_request.head.sha }}`から、新設のpr_number引数を`${{ github.event.pull_request.number }}`から取得し、`gate-reconcile.sh <issue_id> <target_sha> <pr_number>`として呼び出す。
- `gate-reconcile.sh` / `gate reconcile`サブコマンド（既存、シグネチャのみ第3引数`pr_number`を追加）: 既存の`<issue_id> <target_sha>`に加え、`pr_number`（GitHub呼び出し経路では必須、ローカルモード・省略時は空文字列として渡す）を受け取る。`artifactDigestAtSha`が`git show <sha>:<path>`によるread-only参照のみで実装されている既存部分は無変更。
- `resolveApprovedBaseline`（`src/commands/gate.ts`の`reconcile()`内部、前ラウンドで確定済みの設計を維持）: `config.coordination.backend === 'github'`の場合のみ、承認済み基準（`approved_artifacts`）を`reviewFilePath`（issueブランチ上でwriterが改変可能なコミット済みファイル）からではなく、GitHub Check Run発行履歴から復元する。
  1. `pr_number`がワークフローから渡されている場合、`GET pulls/{pr_number}/commits`でPRのコミット列（GitHub側の正本）を直接取得する（`pull_request_target`イベントが常にPR番号を判明させるため、`commits/{target_sha}/pulls`によるPR特定を経由しない）。`pr_number`が空（将来の他呼び出し経路・ローカル検証用途）の場合のみ、従来通り`GET commits/{target_sha}/pulls`でPRを特定するフォールバックを行う。いずれの経路でも対応するPRが0件の場合は「承認済み基準なし」として当該ゲートの照合をスキップする（I8の安全側）。
  2. target_shaより前のコミットを新しい順に並べ、`GET commits/{sha}/check-runs?check_name=<config.checks[gateId]>`で照会し、`conclusion=success`な候補を新しい順に走査する。
  3. （source identity検証）各候補について`GET actions/runs?check_suite_id=<候補の`check_suite.id`>&head_sha=<候補コミットのSHA>`を照会し、応答`workflow_runs[].path`（発行元workflow定義ファイルのリポジトリ内パス、GitHub管理の権威あるメタデータで偽装不能）が既知のtrusted workflowファイルパス（`.github/workflows/agent-skill-chain-gate.yml`・`.github/workflows/agent-skill-chain-reconcile.yml`）のいずれかと一致することを検証する。一致しない候補（`checks: write`権限を持つ攻撃者の新規untrustedワークフローが同名で偽装発行したCheck Runを含む）は棄却し次候補を試す。
  4. source identity検証を通過した候補の`output.text`を`canonicalJson(GateReport)`としてパースし`approved_artifacts`を復元する。GitHub Check Run APIの`output.text`は65,535文字が上限であり、超過時は切り詰められ不正なJSONになりうる。パース失敗時（切り詰めによるものを含む）も当該候補を棄却し次候補を試す。候補が尽きれば「承認済み基準なし」としてスキップする（I8）。
  5. （1）〜（4）いずれかのGitHub API呼び出し自体がエラー応答した場合（0件応答ではなくAPI呼び出し失敗）は、reconcileコマンド全体を失敗させる（`CliError`）。判定不能を「変化なし」や「スキップ」に倒さない。
  - ローカルモード（`config.coordination.backend === 'local'`）の`reconcile()`は無変更。`reviewFilePath`が指す`reviews/<gate>.yaml`（Git管理下）を引き続き正本として用いる（AGENTS.md I6）。

### 依存関係

```text
PRのheadブランチへのpush（synchronize） → pull_request_target トリガー
                                            │
                                            ▼
agent-skill-chain-reconcile.yml（trusted, PRのbaseブランチ=defaultブランチのYAMLとして解決される）
  → baseブランチをcheckout（trust root, ref = pull_request.base.sha, persist-credentials: false）
  → PR head SHAをgit fetchでread-onlyなgit objectとして取得（checkoutしない）
  → baseブランチ由来のCLIをbuild（npm ci / npm run build）
  → gate-reconcile.sh <issue_id> <pull_request.head.sha> <pull_request.number>
      → resolveApprovedBaseline（GitHubモードのみ）:
          pulls/{pr_number}/commits → commits/{sha}/check-runs
            → actions/runs?check_suite_id=<candidate>（発行元workflowファイルパスのsource identity検証。trusted pathと不一致なら次候補へ）
            → 承認済み基準の再構築
      → artifactDigestAtSha: git show <pull_request.head.sha>:<path> でのみ内容参照
  → GitHub Check Runs API（gh api）
```

循環依存は無い。`resolveApprovedBaseline`が照会するCheck Run履歴・PRメタデータ・workflow run発行元パスもGitHub API（正本）からのみ取得し、対象SHAのブランチ内容物（ファイル・コミットメッセージ）を承認済み基準としては参照しない。候補Check Runがtrusted workflowファイルパス以外から発行されていた場合は、同一`checks: write`権限を持つ任意のワークフローファイル（攻撃者が新規追加したものを含む）を承認済み基準の情報源として信頼しない（AGENTS.md「ゲートの継承・無効化」節が禁じる、App IDのみをsource trustの証明とする構成を回避する）。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0016
    relation: adopts
```

## 障害・ロールバック考慮

- 想定される失敗モード（1）: PRのbaseブランチがdefaultブランチ以外へ変更（retarget）された場合、ジョブ条件`if: github.event.pull_request.base.ref == github.event.repository.default_branch`によりreconcileは起動しない。影響は当該PRのreconcileが実行されないことに限られ（fail-safe、Check Run偽造の方向には倒れない）、baseがdefaultブランチへ戻れば次のsynchronizeで復旧する。
- 想定される失敗モード（2）: 攻撃者が自分のPR head側で`agent-skill-chain-reconcile.yml`自体を改変・削除しても、`pull_request_target`はワークフローYAML自体を常にPRのbaseブランチ（trusted）から読むため、この改変は一切実行に反映されない。`workflow_run`+trigger.yml分離案が抱えていた「trigger.yml自体が攻撃者の完全な制御下にあるpushから読まれる」という自己参照問題は、trigger.ymlという別ファイルを作らない本設計では構造的に発生しない。
- 想定される失敗モード（3）: `resolveApprovedBaseline`のGitHub API照会（`pulls/{pr_number}/commits`・`commits/{sha}/check-runs`・source identity検証用の`actions/runs?check_suite_id=`、`pr_number`未提供時は`commits/{sha}/pulls`も含む）自体がエラー応答（レート制限・一時的な障害等）した場合、reconcileコマンド全体を失敗させる（判定不能を「変化なし」や無効化スキップへ倒さない、I8）。0件応答（対応PR無し・過去のsuccess Check Run無し・trusted workflowパスと一致する候補が0件）は既存同様に当該ゲートの照合をスキップする安全側動作とし、API呼び出し失敗とは区別する。
- 想定される失敗モード（4）: 攻撃者が自分のPR head側へ`checks: write`権限を持つ全く新規のuntrustedワークフローファイル（例: `.github/workflows/evil.yml`）を追加し、`agent-skill-chain/{spec,design,implementation,validation}-gate`と同名の偽Check Run（`conclusion=success`、改ざんした`approved_artifacts`を`output.text`へ埋め込み）を発行しても、`resolveApprovedBaseline`のsource identity検証が当該Check Runの発行元workflow run `path`を`evil.yml`と特定し、trusted workflowファイルパスのいずれとも不一致のため候補から棄却する。
- 想定される失敗モード（5）: GitHub Check Run APIの`output.text`フィールドの65,535文字上限により、承認済み成果物点数が多いゲート（実装・検証ゲート、`docs/system-spec/`のような多数ファイルパッケージを含むゲート）では`canonicalJson(GateReport)`が切り詰められ不正なJSONになりうる。`resolveApprovedBaseline`は当該候補のJSONパース失敗時点で「承認済み基準として使用不可」と判定し次候補を試す。API呼び出し自体のエラー応答（失敗モード3、reconcileコマンド全体を失敗させる）とは区別し、こちらは次候補フォールバックとして扱う（I8の安全側）。
- ロールバック手順: `agent-skill-chain-reconcile.yml`の`on:`を`pull_request_target`から`push`へ戻せば旧構成（本Issueが解消しようとする脆弱性を含む）に復帰できる。単一commitのrevertで復元可能。`resolveApprovedBaseline`導入分は独立にrevert可能で、revertすると`reconcile()`の承認済み基準取得は`reviewFilePath`読み込みへ戻る（AC-5が解消する脆弱性が再発する点に留意）。
- 移行ギャップについて（`workflow_run`分離案からの改善点）: 前ラウンドの`workflow_run`分離設計には、「本修正のマージ後も、マージ前から存在し新しいmain内容を取り込んでいない既存issueブランチは、旧`on: push`の自己参照構成をブランチ内に保持し続け、そのブランチへの新規pushに限り脆弱性が残存する」という移行ギャップがあった。本設計（`pull_request_target`）はこのギャップを構造的に解消する。`pull_request_target`はワークフローYAML自体・チェックアウトされるCLIソースを常にPRのbaseブランチ（マージ後は新しいdefaultブランチ）から読むため、進行中の既存PRブランチがPR head側に旧YAMLファイルをそのまま保持していても、それは一切参照されない。マージ後の次のsynchronizeイベントから、既存の開いているPRを含め即座に新しい安全な構成が適用される。したがって本設計は、既存issueブランチに新しいmain内容を取り込ませる運用上の追従手順（`git merge origin/main`等）を必要としない。
- 影響を受ける既存機能: `agent-skill-chain/{spec,design,implementation,validation}-gate`のreconcileによる再発行・無効化のみ。`agent-skill-chain-gate.yml`（PR gate本体）・`agent-skill-chain-ci.yml`（CI検査）は本設計の変更対象に含まれず影響を受けない。`issues/<n>/.agent-skill-chain/reviews/<gate>.yaml`自体の生成・スキーマは無変更（ローカルモードの正本、GitHubモードでもワーカー向けスキャフォールドとして引き続き使用）。
