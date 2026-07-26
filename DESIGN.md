# DESIGN: 配布テンプレートにagent-skill-chain自身の開発専用CIが混入している

- Issue: `ISSUE-290`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | 配布テンプレート `agent-skill-chain-ci.yml`（自己テストジョブ除去） | consumer向けverify/lintジョブのみ残す |
| `AC-2` | 本リポジトリ専用 `.github/workflows/agent-skill-chain-self-test.yml`（新規） | 配布テンプレート非対象の追加ファイル |
| `AC-3` | `computeTemplateSyncDiffs`（`src/lib/template-sync.ts`） | source⊆dest方向の一致検査のみのため無改修で成立 |
| `AC-4` | 配布テンプレート `agent-skill-chain-ci.yml`（verify/lintジョブ部分は無変更） | diffで確認 |

## 責務・境界

### コンポーネント構成

- `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`（配布正本）: consumer自身のIssue/PR成果物・語彙・参照・ADR・AC対応を検査する `verify-*`/`lint-*` ジョブのみを持つ。
- `.github/workflows/agent-skill-chain-self-test.yml`（本リポジトリのみ・新規）: agent-skill-chain CLI自体のビルド（`npm ci && npm run build`）と自己テストスイート（`npm test`）を実行する。配布テンプレート配下には置かない。
- `.github/workflows/agent-skill-chain-ci.yml`（本リポジトリの展開結果）: 配布正本と内容一致させる（自己テストジョブを含まない状態へ更新）。

### 依存関係

```text
本リポジトリの.github/workflows/agent-skill-chain-self-test.yml → npm ci/build/test（本リポジトリのsrc/test）
本リポジトリの.github/workflows/agent-skill-chain-ci.yml = 配布テンプレートagent-skill-chain-ci.yml（内容一致）
配布テンプレートagent-skill-chain-ci.yml → consumerの.github/workflows/agent-skill-chain-ci.yml（init/setup/upgradeで展開）
```

`computeTemplateSyncDiffs`（`src/lib/template-sync.ts`）は配布テンプレート側に存在するファイルが展開先に存在し内容一致することのみを検査し、展開先が配布テンプレートに無い追加ファイルを持つことは許容する（source→destの片方向検査）。そのため `agent-skill-chain-self-test.yml` を本リポジトリのみに追加しても同期検査を破壊しない。

## 関連ADR

無し（既存アーキテクチャの範囲内でのファイル分割であり、新たな恒久判断を要しない）。

## 障害・ロールバック考慮

- 想定される失敗モード: `agent-skill-chain-ci.yml` からverify/lintジョブの一部を誤って除去してしまい、consumer側の検査が弱まる。
- 対策: `verify-*`/`lint-*` の各ステップ（`if:` 条件式含む）は一切変更せず、`npm ci`・`npm run build`・`npm test` 系の3ステップのみを機械的に別ファイルへ移動する（diffで移動範囲を限定する）。
- ロールバック手順: 本Issueのcommitをrevertすれば、配布テンプレートと本リポジトリの `.github/` は元の単一ファイル構成に戻る。
- 影響を受ける既存機能: 本リポジトリ自身のCIにおける自己テスト実行タイミング・PRチェック名（`agent-skill-chain / ci` → `verify` job名は維持しつつ、自己テストは新設workflow名の別jobとして表示される）。既存の必須statusチェック名（`verify`）を変更しないことで、branch protectionの設定変更を不要にする。
