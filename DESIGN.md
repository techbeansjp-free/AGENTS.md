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
| AC-2（既存の正規フロー継続） | `gate-reconcile.sh` / `gate reconcile`サブコマンド（`src/commands/gate.ts`）は無変更、`artifactDigestAtSha`が既に`git show <sha>:<path>`のread-only参照実装であるため新設計とそのまま整合 | issue_id抽出・dependabot許可判定のbashロジックも無変更、入力元イベントのみ変更 |
| AC-3（本体・配布テンプレート同期） | 新規ファイルを`.github/workflows/`と`.agent-skill-chain/templates/github/.github/workflows/`の両方へ同一内容で配置、`.agent-skill-chain/ci/verify-template-sync.sh`が既存の仕組みのまま検査対象に含める | 新規ファイル追加であり検査ロジック自体の変更は不要 |
| AC-4（dependabot許可判定の意図維持） | `agent-skill-chain-reconcile.yml`内の`Derive issue_id`ステップ（3分岐ロジック）を字句そのまま維持し、入力元のみ`github.ref_name`/`github.sha`から`github.event.workflow_run.head_branch`/`github.event.workflow_run.head_sha`へ変更 | いずれもpushされた内容ではなくGitHubが提供するイベントメタデータであり、判定ロジック自体は不変 |

## 責務・境界

### コンポーネント構成

- `agent-skill-chain-reconcile-trigger.yml`（新規）: `on: push`（既存と同一の`branches-ignore`）で起動する、判定ロジックを一切持たないuntrusted workflow。`permissions: {}`、checkoutなし、trivialな1ステップのみ。責務は「`workflow_run`イベントの発生源になること」だけであり、攻撃者が内容を改変しても`checks: write`等の特権操作は一切実行できない。
- `agent-skill-chain-reconcile.yml`（`workflow_run`化）: `on: workflow_run: workflows: ["agent-skill-chain / reconcile-trigger"]`で起動するtrusted workflow。既存の`permissions`（`contents: read`, `checks: write`, `pull-requests: read`）・job名`reconcile`・step名・step id `ctx`・3分岐dependabot判定ロジックはすべて維持し、参照元イベントフィールドのみ`github.event.workflow_run.head_branch`/`head_sha`に置き換える。defaultブランチをtrust rootとしてcheckoutし、pushされたSHAは`git fetch`でread-onlyなgit objectとして取得するのみで、checkoutやビルド対象には含めない。
- `gate-reconcile.sh` / `gate reconcile`サブコマンド（既存・無変更）: 承認済み成果物digestと対象SHAの内容（`git show <sha>:<path>`）を照合し、変化なしなら成功再発行・変化ありなら当該ゲートと全下流ゲートを無効化する。既にread-only git object参照のみで実装されているため、trust root側（default branch）から呼び出しても、pushされたSHA側から呼び出しても、参照先SHAの指定が正しければ同一の照合結果を返す。今回の変更で呼び出し元workflowの起動条件のみが変わり、CLI・スクリプト本体の変更は不要である。
- 既存ユニットテスト（`test/unit/dependabot-ci-skip.test.ts` / `test/unit/dependabot-ci-skip-exec.test.ts`）: reconcile workflowのYAML構造・bashロジックを直接パース・実行して固定化している。新規trigger fileの追加、`on:`変更、参照フィールド変更に追随させる（実装セグメントの変更単位に含む。詳細はPLAN.md）。

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
  → gate-reconcile.sh <issue_id> <対象SHA>（git show <対象SHA>:<path> でのみ内容参照）
  → GitHub Check Runs API（gh api）
```

循環依存は無い。trigger workflowはtrusted workflowの起動条件（`workflow_run`のソースイベント）としてのみ機能し、trusted workflow側から逆参照しない。

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
- 影響を受ける既存機能: `agent-skill-chain/{spec,design,implementation,validation}-gate`のreconcileによる再発行・無効化のみ。`agent-skill-chain-gate.yml`（PR gate本体）・`agent-skill-chain-ci.yml`（CI検査）は本設計の変更対象に含まれず影響を受けない。
