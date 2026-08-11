# PLAN: Agent tool dispatchがsegmentのadapter設定(codex等)を無視し常に固定のClaudeベースsubagentへディスパッチする

- Issue: `ISSUE-609`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `worker-launch.sh` へ `ASC_WORKER_ADAPTER` export追加 | 既存の `ASC_WORKER_MODEL`/`ASC_WORKER_REASONING_EFFORT`/`ASC_WORKER_MODEL_TIER`/`ASC_AGENT_TOOL_DISPATCH` export群に、既に解決済みの `$ADAPTER` 変数を `ASC_WORKER_ADAPTER` として追加する。値の解決ロジック自体は変更しない | `AC-1, AC-2, AC-3` | なし |
| 2 | `claude.sh` `_dispatch_via_agent_tool` のadapter分岐実装 | `"${ASC_WORKER_ADAPTER:-claude}"` を読み、`claude`（既定）は既存出力を変更せず、`codex` は `_worker_default_cmd "$segment" "$contract"` を呼んでCodexコマンド行を得たうえでdispatch用 `contract_file` からの入力に差し替え、`prompt:` 文言をBash直接実行指示へ差し替える。`human`／未知値はlease解放＋エラー返却とする。`_worker_default_cmd` 失敗時（codex分岐）もlease解放＋エラー返却とする | `AC-1, AC-2, AC-3` | `#1` |
| 3 | `.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md` の更新 | 「Codex adapter、human adapter…のAgent tool可視化は対象外」という現行の対象外記述を、adapter別の新挙動（claude=既存手順、codex=Bash直接実行手順、human=非対応でエラー）を自己完結する形の記述へ更新する | `AC-1, AC-3` | `#2` |
| 4 | `test/integration/worker-adapters.test.ts` へのテスト追加 | (a) adapter=codexでのdispatch: Agent tool dispatch有効＋Claude Code CLIセッション条件下で `worker.segment_overrides.<segment>.adapter: codex` を設定し `worker-launch.sh` を呼び、exit 4の出力がCodexコマンド（モックした `codex` 実行ファイル参照）を指し `subagent_type: agent-skill-chain-worker` を含まないことを検証する（AC-1）。(b) adapter=claudeでの既存テスト（ISSUE-448 AC-1/AC-4/AC-8相当）が無改修で通ることを確認する（AC-2の回帰無し確認）。(c) `ASC_WORKER_ADAPTER=human` を直接与えて `_dispatch_via_agent_tool` 相当の分岐に到達させ、AI起動を伴わずエラー終了することを検証する防御的テスト（AC-3）。(d) 本リポジトリ自身の `implementation: {adapter: codex, ...}` 相当の設定を用いた統合テスト（AC-4） | `AC-1, AC-2, AC-3, AC-4` | `#2` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
