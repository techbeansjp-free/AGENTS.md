# PLAN: worker完了確認がreported_sha != started_shaの場合に祖先関係を検証せずrollback/履歴書き換えを正当な新規作業として誤通過させる

- Issue: `ISSUE-671`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `_verify_worker_completion_report` 祖先関係検証ブロック追加（`.agent-skill-chain/adapters/claude.sh`） | 既存の `reported_sha == started_sha` 判定（ISSUE-644/ADR-0062）の `else` 側に、`git merge-base --is-ancestor "$started_sha" "$reported_sha"` の終了コードによる3分岐（`0`=pass、`1`=fail「祖先関係不成立」、それ以外の非0=fail「判定不能」）を追加する。`set -euo pipefail` 環境下でスクリプト全体を異常終了させないよう、既存コードと同じ `cmd \|\| rc=$?` 慣用形で終了コードを取得する | `AC-1, AC-2, AC-3, AC-4` | なし |
| 2 | 呼び出し元（`launch_worker`・`worker-launch-verify.sh`）の既存フェイルセーフ経路が変更単位1の新規fail理由でも無変更で動作することの確認 | いずれも `_verify_worker_completion_report` の戻り値と標準出力の理由文字列を既存の `_fail_blocked`（blocked報告＋`human_escalation_requested: true`＋writer lease解放）へそのまま渡す既存の汎用エラー伝播機構を持つため、コード変更は不要。変更単位1のテスト（変更単位4）を通じて実際にblocked経路まで到達することを確認する | `AC-1, AC-2, AC-4` | `#1` |
| 3 | 既存回帰テストの `startedSha` 前提修正（`test/integration/worker-adapters.test.ts`） | `runCompletionReportVerifier` の既存呼び出しのうち、`target_sha`（=HEAD）と異なる `startedSha` を用いて完了確認の成功（`status 0`）を期待している既存ケース（ISSUE-642/ISSUE-658関連テスト。既定値 `'0'.repeat(40)` は実在しないobjectであり、変更単位1適用後は「判定不能」でblockedになってしまう）を、HEADの実在する祖先commit（`setupWorkerIssue` 直後の初期commit等）を明示的に渡す形へ是正する。祖先関係が成立しない・判定不能な場合を検証する既存の意図が無いケースは、この是正で従来通り成功期待のまま通ることを確認する | `AC-3, AC-5` | `#1` |
| 4 | 新規テスト追加（`test/integration/worker-adapters.test.ts`） | `runCompletionReportVerifier` 経由で次のケースを追加する: (a) `started_sha` の祖先でないcommit（無関係な別系統のcommit、または `started_sha` より前のcommit）を `target_sha` として報告するとblocked＋祖先不成立の理由文字列になる（AC-1・AC-2相当）、(b) 存在しないSHA（フォーマット上は40桁16進数だが実在しないobject）を `started_sha` として渡すとblocked＋判定不能の理由文字列になる（AC-4）、(c) 変更単位3で是正した「祖先である正当な子孫commit」ケースが引き続き成功する（AC-3、回帰なし） | `AC-1, AC-2, AC-3, AC-4` | `#1, #3` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

変更単位2は変更単位1に対するコード変更を伴わない確認作業のため、変更単位4（実テストでの実地確認）と合わせて完了する。変更単位3（既存テスト是正）は変更単位1の完了後でなければ、どのケースが影響を受けるか（成功期待だったものがblockedへ変わるか）を機械的に確定できないため、変更単位1の後に置く。変更単位4は、変更単位3で是正済みの「祖先である正当なcommit」ケースを前提として新規ケースを追加するため、変更単位3の後に置く。
