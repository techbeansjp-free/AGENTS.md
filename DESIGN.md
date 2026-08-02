# DESIGN: security: reconcile workflowがpushトリガーのYAML自己参照によりGate Check Runを偽造可能

- Issue: `ISSUE-342`
- 対応する SPEC: `SPEC.md`

## 背景の要約（本設計の前提）

GitHub Actionsの`push`トリガーは、実行されるワークフローYAML自体を「pushされたコミット」から読み込む。`agent-skill-chain / reconcile`（`.github/workflows/agent-skill-chain-reconcile.yml`）は`on: push`かつ`permissions: checks: write`を持つため、writer権限保有者がワークフローYAML自体・agent-skill-chain CLIソース（`src/agents-md.ts`）・`gate reconcile`実装のいずれかを自分のissueブランチ上で改変してpushするだけで、その改変済みロジックがそのまま実行され`agent-skill-chain/{spec,design,implementation,validation}-gate`のCheck Runを偽造できる。

対照的に`.github/workflows/agent-skill-chain-gate.yml`は`pull_request_target`で起動するため、ワークフローYAML自体は常にdefaultブランチ（trusted）から読まれ、PR headは`actions/checkout`ではなく`git fetch`によるread-onlyなgit objectとしてのみ扱われる。本設計はreconcile側をこの安全な信頼モデルへ揃える。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1（改変内容だけではCheck Run偽造不可） | `agent-skill-chain-reconcile-trigger.yml`（新規・untrusted・no-permission） + `agent-skill-chain-reconcile.yml`（`workflow_run`化・trusted） | `workflow_run`はトリガー元のブランチ内容に関わらず常にdefaultブランチのYAMLを読む（GitHub Actionsの仕様）ため、2ファイル分離自体がAC-1の実現手段そのものである |
| AC-2（既存の正規フロー継続） | `gate-reconcile.sh`・`artifactDigestAtSha`・Check Run再発行/無効化の判定分岐（`src/commands/gate.ts`の`reconcile()`）は無変更。承認済み基準の取得元のみAC-5により変更されるが、GitHubモードの通常フロー（未改ざん）では従来と同一の`approved_artifacts`が得られるため、機能としての既存フローは維持される | issue_id抽出・dependabot許可判定のbashロジックも無変更、入力元イベントのみ変更。承認済み基準取得元の変更点はAC-5行を参照 |
| AC-3（本体・配布テンプレート同期） | 新規ファイルを`.github/workflows/`と`.agent-skill-chain/templates/github/.github/workflows/`の両方へ同一内容で配置、`.agent-skill-chain/ci/verify-template-sync.sh`が既存の仕組みのまま検査対象に含める | 新規ファイル追加であり検査ロジック自体の変更は不要 |
| AC-4（dependabot許可判定の意図維持） | `agent-skill-chain-reconcile.yml`内の`Derive issue_id`ステップ（3分岐ロジック）を字句そのまま維持し、入力元のみ`github.ref_name`/`github.sha`から`github.event.workflow_run.head_branch`/`github.event.workflow_run.head_sha`へ変更 | いずれもpushされた内容ではなくGitHubが提供するイベントメタデータであり、判定ロジック自体は不変 |
| AC-5（承認済み基準データ自体の改ざん耐性） | `resolveApprovedBaseline`（新規・`src/commands/gate.ts`の`reconcile()`内部） | GitHubモードのみ対象。pushされたブランチ上でwriterが改変可能な`issues/<n>/.agent-skill-chain/reviews/<gate>.yaml`（`reviewFilePath`）を承認済み基準として信頼せず、GitHub Check Run発行履歴（`commits/{target_sha}/pulls` → `pulls/{number}/commits` → `commits/{sha}/check-runs`）から`approved_artifacts`を再構築する。さらに候補Check Runごとに`actions/runs?check_suite_id=`でsource identity（発行元workflowファイルパス）を検証し、trusted path（`agent-skill-chain-gate.yml`・`agent-skill-chain-reconcile.yml`）以外から発行された候補（攻撃者が新規追加したuntrustedワークフローが同名で偽装発行したCheck Runを含む）は採用しない。ローカルモードは対象外（既存通り`reviewFilePath`を正本のまま維持、AGENTS.md I6のローカル正本モデルと整合） |
| AC-6（判定対象識別子の出所限定） | 変更単位#2（`workflow_run`化）そのもの＋AC-5の`resolveApprovedBaseline`が`target_sha`のみを起点に照会する構成 | `Derive issue_id`・`Reconcile gates against pushed SHA`ステップの入力元を`github.ref_name`/`github.sha`から`github.event.workflow_run.head_branch`/`head_sha`へ置き換える変更（#2）自体がAC-6の実現手段。`resolveApprovedBaseline`もこの`target_sha`のみを起点とし、pushされたブランチのコミットメッセージ・ファイル内容・環境変数を入力に一切用いない |

## 責務・境界

### コンポーネント構成

- `agent-skill-chain-reconcile-trigger.yml`（新規）: `on: push`（既存と同一の`branches-ignore`）で起動する、判定ロジックを一切持たないuntrusted workflow。`permissions: {}`、checkoutなし、trivialな1ステップのみ。責務は「`workflow_run`イベントの発生源になること」だけであり、攻撃者が内容を改変しても`checks: write`等の特権操作は一切実行できない。
- `agent-skill-chain-reconcile.yml`（`workflow_run`化）: `on: workflow_run: workflows: ["agent-skill-chain / reconcile-trigger"]`で起動するtrusted workflow。既存の`permissions`（`contents: read`, `checks: write`, `pull-requests: read`）・job名`reconcile`・step名・step id `ctx`・3分岐dependabot判定ロジックはすべて維持し、参照元イベントフィールドのみ`github.event.workflow_run.head_branch`/`head_sha`に置き換える。defaultブランチをtrust rootとしてcheckoutし、pushされたSHAは`git fetch`でread-onlyなgit objectとして取得するのみで、checkoutやビルド対象には含めない。
- `gate-reconcile.sh` / `gate reconcile`サブコマンド（既存・無変更）: 承認済み成果物digestと対象SHAの内容（`git show <sha>:<path>`）を照合し、変化なしなら成功再発行・変化ありなら当該ゲートと全下流ゲートを無効化する。既にread-only git object参照のみで実装されているため、trust root側（default branch）から呼び出しても、pushされたSHA側から呼び出しても、参照先SHAの指定が正しければ同一の照合結果を返す。今回の変更で呼び出し元workflowの起動条件のみが変わり、CLI・スクリプト本体の変更は不要である。
- 既存ユニットテスト（`test/unit/dependabot-ci-skip.test.ts` / `test/unit/dependabot-ci-skip-exec.test.ts`）: reconcile workflowのYAML構造・bashロジックを直接パース・実行して固定化している。新規trigger fileの追加、`on:`変更、参照フィールド変更に追随させる（実装セグメントの変更単位に含む。詳細はPLAN.md）。
- `resolveApprovedBaseline`（新規・`src/commands/gate.ts`）: `reconcile()`がGitHubモード（`config.coordination.backend === 'github'`）で承認済み基準（`approved_artifacts`）を決定する際に用いる。pushされたブランチ上でwriter権限を持つ者が改変できるコミット済みファイル（`reviewFilePath`が指す`issues/<n>/.agent-skill-chain/reviews/<gate>.yaml`）を参照せず、次の手順でGitHub Check Run発行履歴から復元する。
  1. `GET /repos/{owner}/{repo}/commits/{target_sha}/pulls`で対象PRを特定する（`target_sha`はAC-6により`workflow_run.head_sha`由来の値のみ）。対応するPRが0件の場合（Draft PR作成前の最初のpush等）は「承認済み基準なし」として当該ゲートの照合をスキップする（既存の「未レビュー・未発行」時の`continue`動作と同型、I8の安全側）。
  2. `GET /repos/{owner}/{repo}/pulls/{number}/commits`でPRのコミット列（GitHub側の正本）を取得し、target_shaより前のコミットを新しい順に並べる。
  3. 各コミットへ`GET /repos/{owner}/{repo}/commits/{sha}/check-runs?check_name=<config.checks[gateId]>`を照会し、`conclusion=success`なCheck Runを新しい順に走査する。各候補について手順(4)のsource identity検証を行い、検証に通った最初の候補を承認済み基準として採用する。
  4. （source identity検証）手順(3)の各候補Check Runについて、`GET /repos/{owner}/{repo}/actions/runs?check_suite_id=<候補Check Runの`check_suite.id`>`を照会する（`head_sha`も候補コミットのSHAと併せて指定し二重に絞り込む）。応答`workflow_runs[]`のうち`check_suite_id`が一致するエントリの`path`フィールド（そのCheck Runを発行したworkflow定義ファイルのリポジトリ内パス。GitHubがワークフロー実行時に記録する権威あるメタデータであり、`checks: write`権限を持つ`GITHUB_TOKEN`を用いて任意のワークフローファイルから発行されたCheck Runであっても、発行元ファイル自身の実際のパスとしてしか報告されないため、pushされた内容から偽装できない）を検証する。`path`が既知のtrusted workflowファイルパス（`.github/workflows/agent-skill-chain-gate.yml`・`.github/workflows/agent-skill-chain-reconcile.yml`のいずれか）と一致しない場合、その候補は承認済み基準として採用せず、手順(3)へ戻り次に新しい候補を試す（例：攻撃者が新規追加した`.github/workflows/evil.yml`から同名の偽Check Runが発行されていても、`path`が`evil.yml`となり両trusted pathのいずれとも一致しないため棄却される）。手順(3)の候補が尽きるまでtrusted pathと一致する候補が1件も無い場合は、手順(1)でPRが0件の場合と同型に「承認済み基準なし」として当該ゲートの照合をスキップする（I8の安全側）。
  - (1)〜(4)（source identity検証のための`actions/runs`照会を含む）いずれかのGitHub API呼び出し自体がエラー応答した場合（0件応答ではなくAPI呼び出し失敗）は、reconcileコマンド全体を失敗させる（`CliError`）。判定不能を「変化なし」や「スキップ」に倒さない（I8）。0件応答（対応PR無し・過去のsuccess Check Run無し・trusted pathと一致する候補が0件）とAPI呼び出し失敗は区別する。
  - ローカルモード（`config.coordination.backend === 'local'`）の`reconcile()`は無変更。`reviewFilePath`が指す`reviews/<gate>.yaml`（Git管理下）を引き続き正本として用いる（AGENTS.md I6）。`gate publish`/`gate review`/`gate record-verdict`が同ファイルへ書き込む処理自体も無変更（ワーカー向けスキャフォールド・ローカルモード正本としての役割は維持）。

### 依存関係

```text
push (issueブランチ) → agent-skill-chain-reconcile-trigger.yml（untrusted, no-permission, 何もしない）
                                │
                                │ workflow_run(completed)
                                ▼
agent-skill-chain-reconcile.yml（trusted, defaultブランチのYAMLとして解決される）
  → defaultブランチをcheckout（trust root）
  → 対象SHAをgit fetchでread-onlyなgit objectとして取得（checkoutしない）
  → defaultブランチ由来のCLIをbuild（npm ci / npm run build）
  → gate-reconcile.sh <issue_id> <対象SHA>
      → resolveApprovedBaseline（GitHubモードのみ）:
          commits/{対象SHA}/pulls → pulls/{number}/commits → commits/{sha}/check-runs
            → actions/runs?check_suite_id=<candidate>（発行元workflowファイルパスのsource identity検証。trusted pathと不一致なら次候補へ）
            → 承認済み基準の再構築
      → artifactDigestAtSha: git show <対象SHA>:<path> でのみ内容参照（対象SHA自体は照合対象の再計算にのみ用いる）
  → GitHub Check Runs API（gh api）
```

循環依存は無い。trigger workflowはtrusted workflowの起動条件（`workflow_run`のソースイベント）としてのみ機能し、trusted workflow側から逆参照しない。`resolveApprovedBaseline`が照会するCheck Run履歴・PRメタデータ・workflow run発行元パスもGitHub API（正本）からのみ取得し、対象SHAのブランチ内容物（ファイル・コミットメッセージ）を承認済み基準としては参照しない。候補Check Runがtrusted workflowファイルパス以外から発行されていた場合は同一checks:write権限を持つ任意のワークフローファイル（攻撃者が新規追加したものを含む）を承認済み基準の情報源として信頼しない（AGENTS.md「ゲートの継承・無効化」節が禁じる、App IDのみをsource trustの証明とする構成を回避する）。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0016
    relation: adopts
```

## 障害・ロールバック考慮

- 想定される失敗モード（1）: `agent-skill-chain-reconcile-trigger.yml`の`name:`とtrusted workflow側の`workflows: [...]`指定が不一致になると、`workflow_run`イベントが発火せずreconcileが一切起動しなくなる。影響は当該pushのreconcileが実行されないことに限られ（fail-safe、Check Run偽造の方向には倒れない）、次の正しいpushで復旧する。
- 想定される失敗モード（2）: 攻撃者が自分のissueブランチ上で`agent-skill-chain-reconcile-trigger.yml`自体を削除・空ステップ化しても、trigger workflow自体が特権を持たないため得られる利益が無い。結果として当該ブランチのreconcileが起動しなくなるのみ（自分自身のブランチのreconcileが止まるだけで、他Issueや他人のCheck Run偽造には至らない）。
- ロールバック手順: `agent-skill-chain-reconcile.yml`の`on:`を`workflow_run`から`push`へ戻し、`agent-skill-chain-reconcile-trigger.yml`を削除すれば旧構成に復帰できる（単一commitのrevertで両ファイルとも復元可能）。ロールバックすると本Issueが解消する脆弱性が再発する点に留意する。
- 想定される失敗モード（3）: `resolveApprovedBaseline`のGitHub API照会（`commits/{sha}/pulls`・`pulls/{number}/commits`・`commits/{sha}/check-runs`・source identity検証用の`actions/runs?check_suite_id=`）自体がエラー応答（レート制限・一時的な障害等）した場合、reconcileコマンド全体を失敗させる（判定不能を「変化なし」や無効化スキップへ倒さない、I8）。0件応答（対応PR無し・過去のsuccess Check Run無し・trusted workflowパスと一致する候補が0件）は既存同様に当該ゲートの照合をスキップする安全側動作とし、API呼び出し失敗とは区別する。
- 想定される失敗モード（4）: 攻撃者が自分のissueブランチへ`checks: write`権限を持つ全く新規のuntrustedワークフローファイル（例: `.github/workflows/evil.yml`）を追加し、`agent-skill-chain/{spec,design,implementation,validation}-gate`と同名の偽Check Run（`conclusion=success`、改ざんした`approved_artifacts`を`output.text`へ埋め込み）を発行しても、`resolveApprovedBaseline`のsource identity検証（手順(4)）が当該Check Runの発行元workflow run `path`を`evil.yml`と特定し、trusted workflowファイルパスのいずれとも不一致のため候補から棄却する。この検証が無ければAC-1〜AC-4の保護がAC-5経由で迂回されうる（2名の独立strictレビュアが指摘した経路、`resolve-approved-baseline-no-source-identity-check`）。
- ロールバック手順（AC-5分）: `resolveApprovedBaseline`導入コミットをrevertし、`reconcile()`の承認済み基準取得を`reviewFilePath`読み込みへ戻せば旧挙動に復帰できる。ロールバックするとAC-5が解消する脆弱性（承認済み基準データ自体の改ざん）が再発する点に留意する。
- 影響を受ける既存機能: `agent-skill-chain/{spec,design,implementation,validation}-gate`のreconcileによる再発行・無効化のみ。`agent-skill-chain-gate.yml`（PR gate本体）・`agent-skill-chain-ci.yml`（CI検査）は本設計の変更対象に含まれず影響を受けない。`gate publish`/`gate review`/`gate record-verdict`が書き込む`issues/<n>/.agent-skill-chain/reviews/<gate>.yaml`自体の生成・スキーマは無変更（ローカルモードの正本、GitHubモードでもワーカー向けスキャフォールドとして引き続き使用）。変更されるのはGitHubモードの`reconcile()`が承認済み基準をどこから読むかのみである。
