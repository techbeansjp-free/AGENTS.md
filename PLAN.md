# PLAN: launch_worker/worker-launch-verify の完了確認が、ワーカーに配達されない report status 投稿を前提としており、実運用で10/10のfalse-positive blockedを生む

- Issue: `ISSUE-642`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `report latest への created_at 出力追加` | `src/commands/report.ts` の `latest()` を、ローカルモードは reportファイルの mtime、GitHubモードは既に取得済みのコメント `createdAt` を用いて `created_at=<UTC ISO8601>` 行を追加出力するよう変更する。既存の `status=`/`target_sha=` 行の内容・順序は変更しない。`test/integration/report.test.ts` へ両モードのcreated_at出力ケースを追加する。 | `AC-4` | なし |
| 2 | `segment start への共通完了報告ブロック付加` | `src/commands/segment.ts` の `start()` に、spec/design/implementation/validationの4ロール共通で `role_contracts.<role>` のYAMLダンプ直後（先頭の `role:` 行は変更しない）に、issue_id・role・segmentを埋め込んだ固定形式の完了報告手順ブロック（`report-status.sh <issue_id> <role> <segment> completed <push済みHEAD>` 相当の実行指示）を付加する処理を追加する。既存の `role_contracts.*.completion` 文言は変更しない。`test/unit/segments.test.ts` またはsegment start相当のテストへ、4ロール全てで付加ブロックが出現すること・`role:` 抽出が壊れないことを検証するケースを追加する。 | `AC-1`, `AC-6` | なし |
| 3 | `_dispatch_via_agent_tool のプロンプト拡張と DISPATCH_STARTED_AT 記録` | `.agent-skill-chain/adapters/claude.sh` の `_dispatch_via_agent_tool` を変更する。(a) claude分岐・codex分岐双方のdispatchプロンプト文言へ、既存の「最終応答は完了状態・target_sha・簡潔な1文要約のみに限定する」指示の直前に、report-status投稿を実行してから最終応答するよう明示する一文を追加する。(b) `dispatch_temp_dir` 作成直後にUTC ISO8601形式の現在時刻を取得し、既存の `contract.sha256` へ `DISPATCH_STARTED_AT=<値>` として追記する（`CONTRACT_SHA256`/`CONTRACT_LINES` と同じファイル、新規ファイルは増やさない）。`test/integration/worker-adapters.test.ts` へ、生成されたdispatchプロンプトに報告指示文言が含まれること・`contract.sha256` に `DISPATCH_STARTED_AT` が記録されることを検証するケースを追加する。 | `AC-2`, `AC-4`（基盤） | なし |
| 4 | `claude.sh への共通完了判定ヘルパー新設` | `.agent-skill-chain/adapters/claude.sh` に、issue_id・role・segment・比較基準時刻を受け取り「報告なし/古い報告のみ→契約不履行の理由」「今回サイクルの報告ありだがstatus/target_sha不一致→診断的な理由」「今回サイクルのcompleted一致→合格」の3分岐を行う共通関数を新設する。DESIGN.mdが定義する判定順序・文言方針に従う。単体で `test/integration/worker-adapters.test.ts` へ、report latestが失敗するケース・created_atがdispatch開始前のケース・created_atがdispatch開始以降でstatus/target_sha不一致のケース・正常一致ケースの4パターンを検証するテストを追加する。 | `AC-4`, `AC-5` | `#1`, `#3` |
| 5 | `launch_worker インライン完了確認・worker-launch-verify.sh の置き換え` | `launch_worker` 末尾のインライン完了確認（worker起動直前に取得したローカル時刻を比較基準として渡す）と `.agent-skill-chain/scripts/worker-launch-verify.sh`（`contract.sha256` から読み取った `DISPATCH_STARTED_AT` を比較基準として渡す）の両方を `#4` のヘルパー呼び出しへ置き換える。既存の `_fail_blocked`/`_release_only_blocked` によるblocked報告・lease解放の呼び出し構造自体は変更しない。既存の `test/integration/worker-adapters.test.ts` の完了・blockedシナリオ（成功経路・完了を騙るケース等）が回帰しないことを確認し、AC-3（正しい報告がcompletedと判定される）・AC-4（前サイクル報告不採用）・AC-5（blocked_reason文言の分離）を検証する新規ケースを追加する。 | `AC-3`, `AC-4`, `AC-5` | `#4` |
| 6 | `既存completion条件の非回帰確認` | `.agent-skill-chain/config/roles.yaml` の `role_contracts.*.completion`・`.agent-skill-chain/schemas/worker-report.schema.yaml`・`.agent-skill-chain/config/agent-skill-chain.yaml` を変更していないことを確認し、`#2`・`#5` 適用後も既存のcommit+push・Draft PR作成等の完了条件チェック（既存テスト群）がそのまま成功することを確認する。新規変更は行わず既存テストスイートの実行結果で確認する。 | `AC-6` | `#2`, `#5` |
| 7 | `AGENT_TOOL_DISPATCH.md の更新` | `.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md` の実行手順・完了条件節を、`#2`・`#3`・`#5` 適用後の実際の挙動（報告手順の明示、鮮度判定の追加、blocked_reason文言の分離）に合わせて更新する。 | `AC-1`〜`AC-5`（記述整合） | `#2`, `#3`, `#5` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
