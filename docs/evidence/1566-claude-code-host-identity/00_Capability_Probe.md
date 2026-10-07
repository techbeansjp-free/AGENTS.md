# Claude Code Host Identity Capability Probe（Issue #1566）

## 対象と方法

- host: Claude Code `2.1.282`（`claude --version`、hook環境変数`AI_AGENT=claude-code_2-1-282_harness`、subagent transcriptの`version`の3点で一致）
- OS: Ubuntu（Linux 7.2.8）、Node.js 24
- 方法: 隔離したscratch Git projectの`.claude/settings.json`へ、観測専用のtemporary probe hookを19 event（2.1.282 binaryに存在するevent名から、hostの動作を置き換える`WorktreeCreate`・`WorktreeRemove`等を除外）へ登録し、`claude -p`をheadlessで起動した。実験2・3・1（再取得）は`env -i HOME PATH TERM`の最小環境で起動し、進行役sessionの環境変数を継承させていない
- probeの性質: stdinを読み、stdoutへ何も書かず、常にexit 0。prompt本文・tool応答本文は保存せず、key名と長さ、識別子field、`subagent_type`・`description`・`to`等の短い安全fieldを残した。**ただし生probe出力（scratch project内の`events.jsonl`）は、これに加えてBash commandの先頭60文字（`bashCommandHead`）と、名前が`CLAUDE`・`AGENT`・`SESSION`に一致する環境変数（`KEY`・`TOKEN`・`SECRET`・`AUTH`を含む名前を除く）の値（先頭160文字）と`ppid`を含んでいた**（`probe.mjs.txt`は実際に使ったprobeをそのまま記録している）。生probe出力はrepositoryへ置かず、下記のfixture化でこれらのfieldを除去した
- 保存したfixture: `test/fixtures/host-observer/claude-code-2.1.282/*.jsonl`（3実験・106 event）。絶対pathは`<PROJECT>`・`<CLAUDE_PROJECT_STORE>`・`<HOME>`へ置換し、環境変数とPIDは除去した

公式hook reference（https://code.claude.com/docs/en/hooks.md）も確認したが、`SendMessage`の意味論と`agent_id`のresume安定性は文書に記載がなく、以下は実payloadだけを根拠にする。

## 実験

| ID | 手順 | fixture |
|---|---|---|
| EXP-1 | coordinator S1 → fresh Agent A（Bash）→ fresh Agent B（Bash）→ AへSendMessage（Bash）→ Bash `false`（失敗）→ Bash `touch`（許可なし） | `exp1-fresh-a-b-resume-a.jsonl` |
| EXP-2 | `--permission-mode dontAsk`。Agent N が入れ子のAgentを起動 → `isolation: worktree`のAgent C → background Agent → 許可なしBash | `exp2-nested-worktree-background-dontask.jsonl` |
| EXP-3 | session起動しAgent R → `--resume`で同sessionを再開しRへSendMessage → `/compact` → 再度`--resume`しRへSendMessage。SendMessageへadvisory hook（`additionalContext`）を付与 | `exp3-session-resume-compact.jsonl` |

## 一次観測

1. **fresh A/Bの識別。** EXP-1でAは`a136d8cde23fa70ea`、Bは`a227dd…`。`SubagentStart`・subagent内`PreToolUse`/`PostToolUse`・`SubagentStop`の`agent_id`が一致し、coordinatorの`PostToolUse(Agent)`の`tool_response.agentId`とも一致した。`session_id`はA・B・coordinatorで同一である。
2. **Aの再利用の識別。** coordinatorの`PreToolUse(SendMessage)`の`tool_input.to`（および`recipient`）がAの`agent_id`に一致し、続く`SubagentStart`が**同じ`agent_id`**で再出現した。`PostToolUse(SendMessage)`の`tool_response.resumedAgentId`も同値である。EXP-3では**session resumeと`/compact`を跨いでも**同じ`agent_id`へ再開した。
3. **SubagentStart単体ではfresh/resumeを区別できない。** fresh起動と再開の`SubagentStart`はkey集合（`agent_id, agent_type, cwd, hook_event_name, prompt_id, session_id, transcript_path`）も値の形も同じで、resumeを示すfieldはない。
4. **親子関係。** coordinator本体のeventには`agent_id`が無く、subagent内のeventには有る。入れ子（EXP-2）では子の`SubagentStart`に親IDは無いが、親subagentの`PostToolUse(Agent)`が`agent_id=親`と`tool_response.agentId=子`を同時に持つ。親子関係はこの1 eventでだけ判別できる。
5. **cwd。** `isolation: worktree`のAgent Cでは、`SubagentStart`以降のeventの`cwd`がhostの作ったworktree（`<PROJECT>/.claude/worktrees/agent-<agent_id>`）になった。
6. **event順序は不安定。** 再開時の`SubagentStart`は、EXP-1初回では`PostToolUse(SendMessage)`の後、再取得とEXP-3では前に来た。background Agentでは`PostToolUse(Agent)`が`SubagentStop`より先に返る。
7. **終了eventは欠落しうる。** `/compact`はhost内部のagent（`af804d29c51f771b9`）について`SubagentStart`なしの`SubagentStop`だけを出した。`SubagentStart`と`SubagentStop`は対にならない。
8. **拒否は後続eventを出さない。** defaultの`-p`では`PreToolUse`→`PermissionRequest`で終わり、`dontAsk`では`PreToolUse`の後に**何も出ない**。いずれの実験でも`PermissionDenied`は発火しなかった。`PreToolUse`で何かを予約すると解放契機が来ない（#1554〜#1562の障害機構）ことが実測で確認できる。
9. **tool失敗。** `false`は`PostToolUseFailure`（`error`、`is_interrupt`付き）を出した。
10. **advisoryは止めない。** EXP-3で`PreToolUse(SendMessage)`のhookが`hookSpecificOutput.additionalContext`と`systemMessage`をexit 0で返したところ、文言はtranscriptへ注入され、SendMessageは成功した。
11. **exec形式の登録。** `"command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/…"]`（shellを介さない形式）と、settingsの`env`による環境変数の受け渡しが2.1.282で動作した。
12. **subagent transcript。** `SubagentStop`の`agent_transcript_path`は`<transcript_pathのdirectory>/<session_id>/subagents/agent-<agent_id>.jsonl`だった。この配置は文書化されていない。

## Capability Matrix（Claude Code 2.1.282）

| Event | session identity | agent identity | parent relation | cwd | resume識別 | fresh判定 |
|---|---|---|---|---|---|---|
| SessionStart | `session_id`（resume・compact後も同値） | なし | なし | `cwd` | session単位で可（`source`=`startup`/`resume`/`compact`） | session単位のみ。agentは不明 |
| SubagentStart | `session_id` | `agent_id`、`agent_type` | 不明（親IDなし） | `cwd`（worktree隔離時はworktree） | 単体では不明（fresh/resumeでpayload同形） | 単体では不明 |
| PreToolUse（subagent内） | `session_id` | `agent_id`、`agent_type` | 不明 | `cwd` | 単体では不明 | 単体では不明 |
| PreToolUse（`Agent`、coordinator） | `session_id` | 呼出し元の`agent_id`（coordinatorは欠落） | 呼出し元のみ。子IDは未確定 | `cwd` | 該当なし | **可**: `Agent`は毎回新しい`agent_id`を作った（3実験・7件すべて）。`tool_input`にresume指定fieldは存在しない |
| PreToolUse（`SendMessage`） | `session_id` | 送信元の`agent_id`（coordinatorは欠落）、`tool_input.to`=宛先`agent_id` | 送信元→宛先 | `cwd` | **可**: 宛先は既存agentであり、送信自体が再利用である | **可**（否定）: 宛先contextはfreshではない |
| PostToolUse（`Agent`） | `session_id` | 呼出し元`agent_id`、`tool_response.agentId`=子 | **可**（親→子） | `cwd` | 該当なし | 子IDの確定 |
| SubagentStop | `session_id` | `agent_id`、`agent_type`、`agent_transcript_path` | 不明 | `cwd` | 不明 | 不明。欠落・不対応がある（観測7） |
| PermissionRequest / PermissionDenied | `session_id` | 不明 | 不明 | `cwd` | 不明 | 不明。PermissionDeniedは未観測 |

## 結論

- **fresh AとBは`agent_id`で識別できる。**
- **既存agentへの送信（本Probeでは停止後のAの再利用）は、coordinatorの`PreToolUse(SendMessage)`の`tool_input.to`で、再利用が起きる前に、過去の状態を保存せずに識別できる。** 宛先が既存agentであることはtoolの意味から確定するため、ASC側でagent台帳を持つ必要がない。ただしこのeventは宛先が停止済みか実行中かを示さない。
- 宛先がASC Work Unitを担当したかは、(a) 送信本文に含まれるASC handoff（`asc-handoff/v1`・`workUnit`）、または (b) hostが既に保存している宛先のsubagent transcriptの先頭に含まれるASC handoff、から判別できる。(b)は文書化されていない配置（観測12）に依存するため、欠落時は判別不能として何も警告しない。
- **completion evidenceは持たない。** 既存agentへの送信の事実はpayloadが運び、宛先がどのWork Unitの担当としてdispatchされたかはpayloadかhost自身の記録が運ぶ。ASCが書く状態は存在しない。その代わり、terminal Work Unit担当のagentがhandback済みか実行中かはstatelessには区別できない（区別には完了記録が要る）。observerの警告はこの区別をしない前提で書く。
- `SubagentStart`・`SubagentStop`・`PermissionDenied`に依存する設計は、順序不安定・欠落・未発火（観測6〜8）により成立しない。
