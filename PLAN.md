# PLAN: 配布テンプレートにagent-skill-chain自身の開発専用CIが混入している

- Issue: `ISSUE-290`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 本リポジトリ専用self-testワークフロー新設 | `.github/workflows/agent-skill-chain-self-test.yml` を新規作成し、既存の `npm ci`・`npm run build`・`npm test`・ログartifactアップロードの4ステップをそのまま移す | `AC-2` | なし |
| 2 | 配布テンプレートから自己テストジョブを除去 | `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml` から `npm ci`・`npm run build`・`npm test`・ログartifactアップロードの4ステップを削除する（verify-*/lint-*ステップは変更しない） | `AC-1`, `AC-4` | `#1` |
| 3 | 本リポジトリの展開結果を同期 | `.github/workflows/agent-skill-chain-ci.yml` を `#2` と同一内容へ更新する | `AC-3` | `#2` |
| 4 | 検証 | `npm run build`・`node bin/agents-md.js verify template-sync`・`.agent-skill-chain/scripts/doctor.sh` 相当の確認を実行する | `AC-1`〜`AC-4` | `#1, #2, #3` |

## 実装順序の見直しについて

実装中に作業順序のみを見直す場合は本ファイルのみを更新する。設計要素・責務・境界そのものを変更する場合はDESIGN.mdの更新（および設計ゲートの再通過）が必要になる。
