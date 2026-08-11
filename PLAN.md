# PLAN: worker完了報告の照合がタイムスタンプ比較のみに依存し、target_shaが変化しない再試行で無関係な過去サイクルの報告を誤って完了根拠として採用しうる

- Issue: `ISSUE-661`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `worker-report.schema.yaml`への`dispatch_token`任意プロパティ追加 | `.agent-skill-chain/schemas/worker-report.schema.yaml`へ`dispatch_token: {type: string}`を`required`に含めない形で追加する。`schema_version`は変更しない。 | `AC-3, AC-7` | なし |
| 2 | `report status` CLIの`dispatch_token`受理 | `src/commands/report.ts`の`status()`へ8番目の任意位置引数`dispatch_token`を追加し、`WorkerReport.dispatch_token`へ値がある場合のみ設定してスキーマ検証にかける。`.agent-skill-chain/scripts/report-status.sh`はパススルーのため変更不要（動作確認のみ）。 | `AC-3, AC-7` | `#1` |
| 3 | `report latest` CLIの`dispatch_token`出力 | `src/commands/report.ts`の`latest()`（ローカル・GitHub両分岐）へ`dispatch_token=<値または空文字>`の出力行を追加する。 | `AC-3, AC-8` | `#1` |
| 4 | `claude.sh`: Agent tool dispatch経路のトークン生成・監査記録 | `_dispatch_via_agent_tool`にて、`dispatch_temp_dir`の`basename`をdispatchトークンとして採用し、`contract.sha256`へ`DISPATCH_TOKEN=<値>`を追記する（`DISPATCH_STARTED_AT`と同じ書式）。 | `AC-1` | なし |
| 5 | `claude.sh`: Agent tool dispatchの`prompt:`行へのトークン埋め込み | `_dispatch_via_agent_tool`のclaude分岐・codex分岐の両方の`prompt:`行へ、変更単位4で生成したトークン値と「report-status.sh実行時に末尾の追加引数として渡す」ことを指示する一文を追記する。既存の`report-status.sh`指示文言・`worker-launch-verify.sh`呼出し指示文言は変更しない。 | `AC-2, AC-7` | `#4` |
| 6 | `claude.sh`: headless起動経路（`launch_worker`）のトークン生成・contractへの追記 | `launch_worker`にて、`worker_started_at`取得と同じ箇所で`mktemp -u`ベースのdispatchトークンを生成し、`prompt_file`へ書き込む`contract`本文の末尾へ変更単位5と同内容の一文を追記する。 | `AC-1, AC-2` | なし |
| 7 | `claude.sh`: `_verify_worker_completion_report`へのトークン照合追加 | シグネチャへ5番目の引数`expected_dispatch_token`を追加し、既存の未報告・鮮度・status/target_sha判定の後段に、`report latest`の`dispatch_token=`値との完全一致判定を追加する。不一致・空は専用の`blocked_reason`文言を返す。 | `AC-4, AC-5, AC-6` | `#3` |
| 8 | `launch_worker`呼び出し側の引数配線 | 変更単位6で生成したトークンを、`launch_worker`内の`_verify_worker_completion_report`呼び出しの5番目の引数として渡す。 | `AC-4, AC-5, AC-6` | `#6, #7` |
| 9 | `worker-launch-verify.sh`の`DISPATCH_TOKEN`読み出し・配線 | `contract.sha256`から`DISPATCH_TOKEN`を読み出し、既存の`DISPATCH_STARTED_AT`欠落チェックと同様に欠落・空を`INTEGRITY_ERROR`として扱う。読み出せた場合は`_verify_worker_completion_report`の5番目の引数として渡す。 | `AC-2, AC-4, AC-5, AC-6` | `#4, #7` |
| 10 | ADR作成（`status: proposed`） | `docs/adr/ADR-0061-...md`を作成し、DESIGN.mdの設計判断（トークン再利用方式・contractへの付加方式・スキーマ非破壊追加・タイムスタンプ比較との併用）を記録する。 | 全AC共通の意思決定記録 | `#1〜#9`の設計内容確定後（実装完了を待たない） |
| 11 | `.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md`の更新 | `contract.sha256`が保持するキーの説明・`worker-launch-verify.sh`の照合内容説明へ、`DISPATCH_TOKEN`と新しいblocked条件を追記する（現状追従、新たな決定ではない）。 | `AC-2`の運用文書整合 | `#4, #5, #9` |
| 12 | 単体・統合テストの追加 | `test/integration/worker-adapters.test.ts`へAC-1〜AC-6相当のケース（トークン生成の非衝突性、`prompt:`/`contract`本文へのトークン埋め込み、`_verify_worker_completion_report`の新分岐、`worker-launch-verify.sh`の`DISPATCH_TOKEN`欠落時blocked）を追加する。`test/integration/report.test.ts`へAC-3・AC-8相当のケース（`report status`/`report latest`の`dispatch_token`受理・出力、ローカル/GitHub両モード）を追加する。既存テストが変更なしで通過することを回帰確認する（AC-7）。 | `AC-1〜AC-8` | `#1〜#9` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

変更単位4・6（各起動経路のトークン生成）は互いに独立であり並行実装可能。変更単位1（スキーマ）は変更単位2・3より先に完了させる必要がある（`report status`/`report latest`の実装がスキーマの新プロパティ定義を前提とするため）。変更単位7（判定ロジック本体）は変更単位3（`dispatch_token=`出力）が無いと動作確認できないため、`#3`完了後に着手する。
