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
| 6 | claude.sh launch_worker分岐 | `launch_worker()`冒頭に分岐追加、新関数`_dispatch_via_agent_tool()`を実装（lease取得→segment start→dispatch payload出力→exit 4、サブプロセス起動なし・lease解放なし）。既存フルフロー本体は無変更のままelse節に残す | `AC-1, AC-2, AC-4` | `#4, #5` |
| 7 | worker-launch-verify.sh新規作成 | `worker-launch.sh`のworktree自己解決ロジックを再利用し、`report latest`とHEAD SHA照合→`release_lease`（一致）または`report_status blocked`+`release_lease`（不一致・未報告）を実装 | `AC-1, AC-3, AC-5` | `#6` |
| 8 | カスタムsubagent種別配布 | `.agent-skill-chain/templates/claude/agents/agent-skill-chain-worker.md`を新規作成（`tools:`は`Read, Grep, Glob, Edit, Write, MultiEdit, Bash`のみ許可、`Agent`等は含めない）。`templates.claude_agents_source`/`templates.claude_agents_target`をconfig schemaへ追加し、`init`/`upgrade`の同期対象・`verify-template-sync.sh`の検査対象へ加える | `AC-1` | なし（`#6`と並行可） |
| 9 | dispatch手順文書化 | `.agent-skill-chain/standards/`へ運用手順の正本を追加し、`_dispatch_via_agent_tool()`のpayload文言（`subagent_type`・`prompt`・`run_in_background: false`・完了後の`worker-launch-verify.sh`実行・待機超過時の`lease-renew.sh`実行）を実装に反映 | `AC-1, AC-4, AC-5` | `#6, #7, #8` |
| 10 | テスト・ドキュメント整合 | 既定off時の既存`WORKER_CMD`回帰テストが分岐を通らないことを確認。`ASC_AGENT_TOOL_DISPATCH=true`＋`ASC_ORCHESTRATOR_SESSION_OVERRIDE=claude_code_cli`によるdispatch分岐専用のスクリプトテスト（Agent tool自体は呼ばずstdout/exit code 4を検証）を追加。`worker-launch.sh`冒頭コメントの終了コード一覧を`0/3/4/other`へ更新 | `AC-6` かつ全AC共通の整合確認 | `#6, #7, #9` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
