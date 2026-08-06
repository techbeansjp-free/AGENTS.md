# PLAN: worker.agent_tool_dispatch.enabledをtrueにし、Agent tool経由のworker起動を既定で有効化する

- Issue: `ISSUE-470`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 実効設定の既定値反転 | `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.agent_tool_dispatch.enabled` を `false` から `true` へ変更する。 | `AC-1` | なし |
| 2 | スキーマ例示の整合 | `.agent-skill-chain/schemas/config.schema.yaml` の `examples[0]`・`examples[1]` 内 `agent_tool_dispatch: {enabled: false}` を `true` へ更新する。schemaのバリデーション定義（`type: boolean`）自体は変更しない。 | `AC-5` | `#1` |
| 3 | 運用手順ドキュメントの整合 | `.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md` の「新方式は...既定値`false`では従来のheadless subprocess起動を維持する」という記述を、既定値が `true` になったことに合わせて更新する。「明示的に `false` を設定した場合は引き続きheadlessのままである」という説明は保持する（AC-4と整合させるため、optionality自体は失わせない）。 | `AC-5`（準拠） | `#1` |
| 4 | 実効設定値を直接読む回帰テストの追随 | `test/unit/config.test.ts`（AC-6隣接assertion、38行目）と `test/integration/worker-context.test.ts`（複数の `'agent_tool_dispatch=false'` 期待値）のうち、実リポジトリの実効設定値をそのまま読んでいる箇所だけを `true` へ更新する。`setWorkerAgentToolDispatch()` で明示上書きしているISSUE-448由来のテスト（`test/integration/worker-adapters.test.ts` 等）は対象外とし変更しない。 | `AC-1`, `AC-4`（間接確認） | `#1` |
| 5 | 明示opt-outのCLI経由回帰テスト新設 | `test/integration/worker-context.test.ts` に、`setWorkerAgentToolDispatch(repo.dir, false)` で明示的に `false` を設定した場合でも `worker context` コマンドの出力が `agent_tool_dispatch=false` のままであることを確認するテストを追加する。既存のAC-4カバレッジは `test/unit/worker-selection.test.ts` の純粋関数単体テストのみであり、CLI出力経由の確認が無かったギャップを埋める。 | `AC-4` | `#4` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
