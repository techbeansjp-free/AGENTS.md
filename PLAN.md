# PLAN: codex adapterのlaunch_gate_reviewerが`codex exec`未対応の`--ask-for-approval`オプションでゲートレビュー起動に即座に失敗する

- Issue: `ISSUE-356`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `GATE_REVIEWER_CMD`修正 | `.agent-skill-chain/adapters/codex.sh` の `launch_gate_reviewer` 内、既定コマンドライン生成部から `--ask-for-approval never` を除去し、既存の `-c` 指定と同一エスケープ規約で `-c 'approval_policy="never"'` を追加する | `AC-1, AC-2, AC-3` | なし |
| 2 | fakeなcodex実行ファイルによる回帰テスト追加 | `test/integration/gate-adapters.test.ts` に、`--ask-for-approval` を含む引数列を拒否し `approval_policy="never"` 相当のconfig overrideを含む場合のみ正常応答を返すスタブ実行ファイルを用意し、`CODEX_EXECUTABLE` としてこれを指定した状態で（`CODEX_REVIEWER_CMD`/`GATE_REVIEWER_CMD` によるテスト用完全上書きは使わずに）`launch_gate_reviewer` を起動するテストケースを追加する | `AC-1, AC-2, AC-3` | `#1` |
| 3 | `launch_worker`非破壊の確認 | `.agent-skill-chain/adapters/codex.sh` を変更した後も、`launch_worker` のコマンド組み立て（`--ask-for-approval` 不使用）が無変更であることをdiffで確認し、既存の `launch_worker` 関連テスト（`test/integration/gate-adapters.test.ts`・`test/integration/worker-adapters.test.ts`）が引き続き成功することを確認する（コード変更は発生しない） | `AC-4` | `#1` |
| 4 | 既存フェイルセーフ・全体回帰の確認 | 既存の「認証不成立」「CLI不在」テスト（`test/integration/gate-adapters.test.ts`）を含む `npm test` を実行し、全既存テストが成功し続けることを確認する（コード変更は発生しない） | `AC-5, AC-6` | `#1, #2, #3` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
