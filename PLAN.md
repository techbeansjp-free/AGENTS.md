# PLAN: gate publishのCheck Run発行がGitHub Appトークン無しでは不可能で、配布rulesetの必須化と相まって標準導入経路のPRが恒久的にマージ不能になりうる

- Issue: `ISSUE-593`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `RulesetTemplate`のdrift是正 | `.agent-skill-chain/templates/github/provisioning/rulesets/main.json` の `required_status_checks.required_status_checks` から4つのgate check context（`agent-skill-chain/{spec,design,implementation,validation}-gate`）を削除し、`verify` の1件のみにする。 | `AC-1` | なし |
| 2 | `RulesetRenderer`の条件付きApp binding | `src/commands/setup.ts` の `renderRulesetWithDedicatedApp()` を、`required_status_checks`内に`GATE_CHECK_NAMES`が1件も存在しない場合は`ASC_GATE_APP_ID`を要求せずテンプレートをそのまま返すよう分岐させる。1件以上存在する場合は既存の検証・binding処理を無変更のまま維持する。`test/unit/setup-ruleset.test.ts` へ「4件とも存在しないテンプレートは`ASC_GATE_APP_ID`未設定でも例外なく完走し、入力と同一内容を返す」ケースを追加する。 | `AC-2, AC-4` | `#1`（`#1`適用後の既定テンプレートで実際に0件になることを前提にした分岐設計のため） |
| 3 | `GatePublishCommand`のsync独立化 | `src/commands/gate.ts` の `publish()` 内で、`publishCheckRun()` の呼び出し結果（`published.error`）による早期 `return fail(...)` を、`syncGateArtifacts()` の呼び出し（既存の `try/catch`＋stderr出力）より後ろへ移動する。これにより `publishCheckRun()` が失敗した場合でも `syncGateArtifacts()` が必ず試行され、その結果（成功時のnotes、失敗時のエラーメッセージ）がstderr出力に含まれた上で、最終的な失敗判定（`published.error`があれば`fail`）が行われる。既存のCheck Run成功時の挙動（`ok(published.url ?? '')`）は変更しない。関連する既存単体テストがあれば、この呼び出し順序変更を反映させる。 | `AC-3` | なし（`#1`・`#2`と独立した別データフロー） |
| 4 | 運用制約の文書化 | `docs/ASC_GATE_APP_ID_RUNBOOK.md` の「目的・対象範囲」「設定の確認」節を、`#1`・`#2`適用後は既定テンプレートに対し`setup ruleset`が`ASC_GATE_APP_ID`無しで完走する旨、および本runbookが必要になるのは手元のテンプレート複製へgate check contextを再度加える場合に限られる旨へ更新する。あわせて、Check Runを発行可能なCI workflowが現状このリポジトリにも配布テンプレートにも存在しないこと、`gate publish`のCheck Run発行がrulesetのrequired statusに現状寄与しないこと、`gate publish`が進行役の任意実行による記録専用ツールであることを明記する。`README.md`の`gate publish`記載箇所（コマンド一覧表）から当該runbookへの参照を追加する。 | `AC-5` | `#1, #2` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

`#3`（`GatePublishCommand`のsync独立化）は`#1`・`#2`（ruleset適用系統）と依存関係が無いため、並行して着手してよい。`#4`（文書化）は`#1`・`#2`の最終的な挙動（`ASC_GATE_APP_ID`が既定では不要になること）を正しく記述する必要があるため、`#1`・`#2`の完了を待って着手する。
