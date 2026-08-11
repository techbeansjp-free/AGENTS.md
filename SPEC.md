<!--
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
<...> のプレースホルダを実際の内容に置き換えて記入すること。
-->

# SPEC: Agent tool dispatchがsegmentのadapter設定(codex等)を無視し常に固定のClaudeベースsubagentへディスパッチする

- Issue: `ISSUE-609`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/609-agent-tool-dispatch-adapter-passthrough`

## 目的・背景

`.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.segment_overrides.<segment>.adapter` は、セグメントごとに起動すべき実行系（`claude` | `codex` | `human`）を確定させる恒久設定である。このリポジトリ自身も `implementation: {adapter: codex, model_tier: highest_capability, reasoning_effort: high}` を恒久設定しており（ISSUE-307）、実装セグメントは常に Codex（`codex exec`、指定モデル・reasoning effort）で起動されることを前提としている。

しかし `.agent-skill-chain/adapters/claude.sh` の `launch_worker()` は、`worker.agent_tool_dispatch.enabled: true`（既定）かつ Claude Code CLI 対話セッション内（`_orchestrator_is_claude_code_cli_session` が真）という条件が揃うと、解決済み adapter の値を一切参照せずに `_dispatch_via_agent_tool "$issue_id" "$segment"` へ分岐する。この関数は `issue_id` と `segment` のみを引数に取り、標準出力へ常に固定文字列 `subagent_type: agent-skill-chain-worker`（Claude ベースの Agent tool サブエージェント）を含む `AGENT_TOOL_DISPATCH_REQUIRED` 指示を返す。

`.agent-skill-chain/adapters/codex.sh` は冒頭で `claude.sh` の `launch_worker` を `source` した上で関数名を `_codex_worker_lifecycle` へ付け替えて取り込んでいるだけであり、この分岐自体は codex adapter 経由でも同一の `_dispatch_via_agent_tool` を通る。結果として、Agent tool dispatch が有効な対話セッションでは `adapter: codex` の設定に関わらず常に固定の Claude ベース Agent tool サブエージェントへディスパッチされ、`codex.sh` 固有のモデル解決（`_codex_worker_model()`）・reasoning effort 解決（`_codex_worker_effort()`）・`codex exec` 起動コマンド組み立て（`_worker_default_cmd` の codex 版）には一切到達しない。

この不整合は本リポジトリ自身の開発セッションで実際に発生した。2026-08-11のClaude Code CLI対話セッション（Agent tool dispatch有効）でISSUE-538・586・588・593・602・590の各Issueの実装セグメントを進行した際、`implementation: {adapter: codex, ...}` という恒久設定にもかかわらず、いずれも固定のClaudeベースsubagentが実装を行い、Codex（`gpt-5.6-sol`）による実装は一度も行われていなかった。設定と実際の動作の乖離が、設定した本人にも気づかれないまま継続していた。

同様に `adapter: human` が設定されたセグメントについても、adapter情報が無視される以上、Agent tool dispatchが誤って自動化してしまう可能性を排除できていない。

## 要求 → 要件 → 受入条件

### 要求

Agent tool dispatchが有効な対話セッションであっても、セグメントに設定されたadapter（`claude` | `codex` | `human`、既定または `segment_overrides` による上書きを含む）の値が実際のディスパッチ先・実行系に反映されるようにしたい。特に `adapter: codex` を明示設定したセグメントでは、実際にCodex（`codex exec`、設定済みmodel・reasoning effort）が実行されることを保証したい。

### 要件

- `launch_worker()` のAgent tool dispatch分岐（`_dispatch_via_agent_tool` 呼び出し）に到達する前に、当該セグメントの解決済みadapter（`worker.segment_overrides.<segment>.adapter` またはセグメント指定が無い場合の `worker.adapter` 既定値）を判定する。
- 解決済みadapterが `codex` の場合、Agent tool dispatch経由であっても以下のいずれかの方法で `codex.sh` 固有のモデル・reasoning effort解決およびサンドボックス設定が実効を持つようにする:
  - Agent toolの `subagent_type` をCodex専用のものへ切り替える、または
  - 進行役向けの `AGENT_TOOL_DISPATCH_REQUIRED` 指示に、Agent tool経由の固定Claudeサブエージェントではなく、Bash経由で `codex exec`（解決済みmodel・reasoning effort・サンドボックス設定を反映したコマンド）を直接起動すべき旨を明記する。
- 解決済みadapterが `human` の場合、Agent tool dispatchが自動的にAIを起動して人間判断を代替してしまわないことを保証する（human向けの適切な取り扱いへ倒す、またはAgent tool dispatch分岐に入らない）。
- 解決済みadapterが `claude`（既定）の場合の既存動作（`subagent_type: agent-skill-chain-worker` への固定ディスパッチ）に回帰を起こさない。
- 本Issueの対応範囲は `_dispatch_via_agent_tool` へadapter情報を渡す経路の追加、およびadapterごとの分岐先の確定に限る。`codex.sh`・`claude.sh` の非Agent tool dispatch経路（`ASC_AGENT_TOOL_DISPATCH` 無効時やCI実行時）が持つ既存のモデル解決・起動コマンド組み立てロジック自体は変更しない。

### 受入条件（Acceptance Criteria）

#### AC-1: `adapter: codex` セグメントでAgent tool dispatch有効時にCodexが実行される

- Given: あるIssueのあるセグメントに `worker.segment_overrides.<segment>.adapter: codex`（および `model_tier`・`reasoning_effort`）が設定されており、`worker.agent_tool_dispatch.enabled: true` かつ Claude Code CLI 対話セッション内で `launch_worker` が呼び出される状況がある
- When: `launch_worker "$issue_id" "$segment"` を実行する
- Then: 最終的にCodex（`codex exec`、設定されたmodel・reasoning effort）が実行される（Bash経由の直接起動、またはAgent tool経由のCodex専用ディスパッチのいずれでもよい）。固定のClaudeベース `subagent_type: agent-skill-chain-worker` へ無条件にディスパッチされることはない
- 検証方法見込み: `automated`

#### AC-2: `adapter: claude`（既定）の既存動作に回帰が無い

- Given: あるIssueのあるセグメントに明示的な `adapter: codex` の上書きが無く、既定の `worker.adapter: claude` が適用される状況で、`worker.agent_tool_dispatch.enabled: true` かつ Claude Code CLI 対話セッション内で `launch_worker` が呼び出される
- When: `launch_worker "$issue_id" "$segment"` を実行する
- Then: 本Issue対応前と同様に、`AGENT_TOOL_DISPATCH_REQUIRED` 指示と `subagent_type: agent-skill-chain-worker` を含む固定ディスパッチが行われ、`_dispatch_via_agent_tool` が既に持つlease取得・segment start・contract一時ファイル書き出し・renewデーモン起動・戻り値4の挙動に変化が無い
- 検証方法見込み: `automated`

#### AC-3: `adapter: human` セグメントでAgent tool dispatchが自動でAIへ代替しない

- Given: あるIssueのあるセグメントに `adapter: human` が設定されており、`worker.agent_tool_dispatch.enabled: true` かつ Claude Code CLI 対話セッション内で `launch_worker` が呼び出される状況がある
- When: `launch_worker "$issue_id" "$segment"` を実行する
- Then: 固定のClaudeベース `subagent_type: agent-skill-chain-worker` （またはその他のAI実行系）が人間判断を代替する形で自動起動されることはない
- 検証方法見込み: `automated`

#### AC-4: 本リポジトリ自身の恒久設定が対話セッションでも尊重されることを統合テストで確認できる

- Given: 本リポジトリ自身の `.agent-skill-chain/config/agent-skill-chain.yaml` が `implementation: {adapter: codex, model_tier: highest_capability, reasoning_effort: high}` を恒久設定している（ISSUE-307）
- When: Claude Code CLI 対話セッション、Agent tool dispatch有効の条件下で、あるIssueの実装セグメントに対し `launch_worker` を呼び出す統合テストを実行する
- Then: テストは実装セグメントの起動がCodex（設定されたmodel・reasoning effort）を実効的に用いる経路を通ることを機械的に検証し、成功する
- 検証方法見込み: `automated`

## スコープ外

- `_dispatch_via_agent_tool` 以外のAgent tool dispatch非経路（`ASC_AGENT_TOOL_DISPATCH` 無効時、CI実行時等）における `codex.sh`・`claude.sh` の起動ロジック自体の変更。
- `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.adapter`・`worker.segment_overrides`・`worker.model_tiers` のスキーマ自体の変更。
- ゲートレビュア起動（`launch_gate_reviewer`）側のAgent tool dispatch対応。本Issueはセグメント作業ワーカー起動（`launch_worker`）に限定する。
- Cursor等、Codex/Claude Code以外のadapterの新規追加・Agent tool dispatch対応。
- `worker.agent_tool_dispatch.enabled` 自体の既定値・無効化条件の変更。
