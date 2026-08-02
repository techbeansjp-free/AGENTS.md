<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
-->

# PLAN: trusted gate recorderを専用GitHub App登録なしでもfailureにしない

- Issue: `ISSUE-331`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `record job entry guardの追加` | `.github/workflows/agent-skill-chain-trusted-gate.yml`と、配布正本である`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-trusted-gate.yml`の両方へ、`record` jobのjob-level `if:`に`vars.ASC_GATE_APP_ENABLED == 'true'`を追加条件として組み込む。既存step（checkout〜finalize）の内容・順序は変更しない。 | `AC-1, AC-3, AC-5` | なし |
| 2 | `trusted-gate-workflow.test.tsの更新` | `test/unit/trusted-gate-workflow.test.ts`に、新しいjob-level `if:`条件（`vars.ASC_GATE_APP_ENABLED`を含む）が両ファイルへ同一に反映されていることを検証する正規表現アサーションを追加する。 | `AC-1, AC-5` | `#1` |
| 3 | `既存関連テストの回帰確認` | `test/unit/durable-gate-record.test.ts`・`test/unit/gate-provenance.test.ts`・`test/unit/trusted-gate-recorder.test.ts`・`test/integration/gate-evidence.test.ts`を実行し、guard追加がApp設定済み経路（既存のprepare/attest/verify/finalizeロジック）の既存アサーションへ影響しないことを確認する。影響が確認された場合のみ、当該テストを更新する（既存のfailure検出ロジック自体は変更しない前提のため、追加のみで通過する想定）。 | `AC-2, AC-3` | `#1, #2` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
