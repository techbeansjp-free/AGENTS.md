# PLAN: 進行役がClaude Codeの場合、worker-launch.shが起動するsegment workerをこのセッションのサブエージェントツリー上で可視化する

- Issue: `ISSUE-448`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | config schema拡張 | `.agent-skill-chain/schemas/config.schema.yaml`・`.agent-skill-chain/config/agent-skill-chain.yaml`へ`worker.agent_tool_dispatch: {enabled: boolean}`（既定false、後方互換な任意項目）を追加 | `AC-8` | なし |
| 2 | worker-selection.ts拡張 | `WorkerSelection`に`agentToolDispatch: boolean`を追加し、`resolveWorkerSelection`で解決。単体テスト追加（未設定/false/true） | `AC-8` | `#1` |
| 3 | worker.ts context拡張 | `context`サブコマンドが常に`agent_tool_dispatch=<true\|false>`行を出力するよう変更。既存出力フォーマットへの追加のみ | `AC-8` | `#2` |
| 4 | セッション判定関数 | `claude.sh`へ`_orchestrator_is_claude_code_cli_session()`を追加（`ASC_ORCHESTRATOR_SESSION_OVERRIDE`モック境界、`CLAUDECODE`厳密一致判定）。単体テスト追加（未設定/`1`/その他の値） | `AC-7` | なし |
| 5 | worker-launch.sh拡張 | `WORKER_CONTEXT`から`agent_tool_dispatch=`行を読み取り`ASC_AGENT_TOOL_DISPATCH`を常にexport。既存のworktree自己解決（ADR-0029）は無変更 | `AC-8` | `#3` |
| 6 | claude.sh launch_worker分岐 | `launch_worker()`冒頭に分岐追加、新関数`_dispatch_via_agent_tool()`を実装（lease取得→segment start→`mktemp -d`一時ディレクトリへcontract.md書き出し→`_dispatch_lease_renew_daemon()`（既定`ASC_DISPATCH_MAX_WAIT_SEC=14400`秒）を`setsid`で起動しrenew.pid書き出し→定型文＋contract.mdパス＋`DISPATCH_TEMP_DIR=<一時ディレクトリの絶対パス>`行＋`CONTRACT_SHA256=<hex>`行＋`CONTRACT_LINES=<n>`行を標準出力→exit 4）。contract本文を標準出力へ書かない点、workerサブプロセスは起動しないがrenewalデーモンは起動する点、`DISPATCH_TEMP_DIR=`行が`#7`のverifyスクリプトへの引数受け渡し手段である点、`CONTRACT_SHA256`/`CONTRACT_LINES`はcontract.mdの完全性を事後照合するための監査証跡である点に注意。`_dispatch_lease_renew_daemon()`はPID再利用対策として自身のコマンドライン引数に一時ディレクトリの絶対パスをそのまま含めて起動する（`#7`の`ps -o args=`照合対象）。既存フルフロー本体は無変更のままelse節に残す | `AC-1, AC-2, AC-4` | `#4, #5` |
| 7 | worker-launch-verify.sh新規作成 | `worker-launch.sh`のworktree自己解決ロジックを再利用し、第1位置引数として一時ディレクトリの絶対パスを必須で受け取る（`#6`が出力する`DISPATCH_TEMP_DIR=`行の値、未指定・存在しないパスはexit 1即時失敗）。有効な場合はまず当該ディレクトリの`renew.pid`があれば`ps -p <pid> -o args=`でコマンドラインに当該一時ディレクトリの絶対パスが含まれることを確認したうえで対応プロセスへ`kill`（SIGTERM）を送り、`kill -0`による短いポーリング（200ms×最大10回）で実際の終了を確認してからディレクトリごと削除する（ポーリング後も生存していれば`kill -9`を試み、それでも終了確認できなければ`release_lease`をブロックせず先へ進める）。PIDファイル無し、またはコマンドラインが一致しない＝PID再利用の場合はkillせずスキップ。続けて`report latest`とHEAD SHA照合→`release_lease`+exit 0（一致）または`report_status blocked`+`release_lease`+exit 2（不一致・未報告）を実装 | `AC-1, AC-3, AC-5` | `#6` |
| 8 | カスタムsubagent種別配布 | `.agent-skill-chain/templates/claude/agents/agent-skill-chain-worker.md`を新規作成（`tools:`は`Read, Grep, Glob, Edit, Write, MultiEdit, Bash`のみ許可、`Agent`等は含めない）。`templates.claude_agents_source`/`templates.claude_agents_target`をconfig schemaへ追加し、`init`/`upgrade`の同期対象・`verify-template-sync.sh`の検査対象へ加える | `AC-1` | なし（`#6`と並行可） |
| 9 | dispatch手順文書化 | `.agent-skill-chain/standards/`へ運用手順の正本を追加し、`_dispatch_via_agent_tool()`のpayload文言（`subagent_type`・定型文「指定ファイルをBashツールで`cat`し、その標準出力全体を一切要約・改変せず動作契約として厳密に実行する」・contract.mdの絶対パス・`run_in_background: false`・完了後に`DISPATCH_TEMP_DIR=`行の値を引数として`worker-launch-verify.sh`を実行する手順）を実装に反映。lease renewalは`_dispatch_lease_renew_daemon()`が自動で行うため進行役への手動実行指示は含めない | `AC-1, AC-4, AC-5` | `#6, #7, #8` |
| 10 | テスト・ドキュメント整合 | 既定off時の既存`WORKER_CMD`回帰テストが分岐を通らないことを確認。`ASC_AGENT_TOOL_DISPATCH=true`＋`ASC_ORCHESTRATOR_SESSION_OVERRIDE=claude_code_cli`によるdispatch分岐専用のスクリプトテスト（Agent tool自体は呼ばずstdout/exit code 4、`CONTRACT_SHA256`/`CONTRACT_LINES`出力を検証）と、`worker-launch-verify.sh`のkill-then-poll-then-release順序を検証するテスト（プロセス生存中に`release_lease`が呼ばれないことを確認）を追加。`worker-launch.sh`冒頭コメントの終了コード一覧へ`4`＝dispatch_required（claude adapter新規、leaseを解放せず復帰）を追加し、既存の`0`＝完了・`3`＝deferred（human専用）・その他＝error（`1`・`2`を包括、既存と同じ意味のため区別を追加しない）はそのまま維持する。新設`worker-launch-verify.sh`には独自の終了コードコメント（`0`＝Completed・`1`＝引数不正・`2`＝Blocked）を新規記載する（DESIGN.md「終了コード対応表」と一致させる） | `AC-6` かつ全AC共通の整合確認 | `#6, #7, #9` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
