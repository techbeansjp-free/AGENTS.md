# ADR

```yaml
id: ADR-0058
status: proposed
title: Agent tool dispatch層へ解決済みadapter名を環境変数で伝搬し、adapter別に分岐させる
tags: [agent-tool-dispatch, worker-launch, codex, adapter]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/scripts/worker-launch.sh` は `agent-skill-chain worker context <issue_id> <segment>` を呼び、`worker.segment_overrides.<segment>.adapter → worker.adapter → 既定human` の順で解決した adapter 名（`claude|codex|human`）を得たうえで、対応する `.agent-skill-chain/adapters/<adapter>.sh` を `source` し `launch_worker` を呼ぶ。

`claude.sh` の `launch_worker` は、`worker.agent_tool_dispatch.enabled: true`（既定）かつ `_orchestrator_is_claude_code_cli_session` が真の場合、`_dispatch_via_agent_tool "$issue_id" "$segment"` へ分岐する。この関数は `issue_id` と `segment` だけを引数に取り、標準出力へ固定文字列 `subagent_type: agent-skill-chain-worker`（Claude ベースの Agent tool サブエージェント）を含む `AGENT_TOOL_DISPATCH_REQUIRED` 指示を返して `return 4` する。

`.agent-skill-chain/adapters/codex.sh` は `claude.sh` を `source` し、`launch_worker`（および `launch_gate_reviewer`）だけを `_codex_worker_lifecycle`（`_codex_gate_lifecycle`）へ改名して取り込む。`_worker_default_cmd` は codex.sh 側で再定義し、bash のグローバル関数解決（動的束縛）により `_codex_worker_lifecycle` 内部から呼ばれる `_worker_default_cmd` は codex.sh 版が使われる。これにより Agent tool dispatch を使わない起動経路（`worker.agent_tool_dispatch.enabled: false` またはCLIセッション外）では、`adapter: codex` の設定が Codex 固有のモデル・reasoning effort・sandbox設定へ正しく反映される。

しかし `_dispatch_via_agent_tool` はこの動的束縛の恩恵を受けない——`_worker_default_cmd` を一切呼ばず、`subagent_type` を無条件にリテラル文字列で埋め込むためである。結果として Agent tool dispatch が有効な対話セッションでは、`adapter: codex` を設定していても常に固定の Claude ベース Agent tool サブエージェントへディスパッチされ、Codex（`codex exec`、設定済み model・reasoning effort）には一度も到達しない。本リポジトリ自身の `implementation: {adapter: codex, model_tier: highest_capability, reasoning_effort: high}`（ISSUE-307 恒久設定）で実際にこの不整合が発生し、2026-08-11 時点で複数 Issue の実装セグメントが気づかれないまま Claude ベース subagent により処理されていた。

`worker-launch.sh` は adapter 名を既に `$ADAPTER` として解決済みだが、これを adapter 実装（`launch_worker`/`_dispatch_via_agent_tool`）へ渡す経路を持たない。一方、read-only なゲートレビュア起動側（`.agent-skill-chain/scripts/gate-launch-reviewer.sh`）は同種の問題を、解決済み adapter 名を `ASC_REVIEW_ADAPTER` という環境変数として `export` し、`claude.sh` の `launch_gate_reviewer` がそれを `"${ASC_REVIEW_ADAPTER:-claude}"` として読む、という既存パターンで解決済みである。

### 検討した選択肢

1. **`_dispatch_via_agent_tool` の引数へ adapter を追加し、`launch_worker` 内の呼び出し箇所で渡す。**
   `launch_worker`（`claude.sh` 内の唯一の定義）は codex.sh から `_codex_worker_lifecycle` へ改名されて再利用される関数そのものであり、呼び出し元（`worker-launch.sh`）が解決した adapter 名をこの関数本体が知る手段がない（関数定義側は「自分が今 codex 版として呼ばれているか」を関数内部だけからは判定できない）。`launch_worker` のシグネチャに adapter 引数を追加すると `worker-launch.sh` の呼び出し規約変更に加え、`human.sh` の独立した `launch_worker` 実装や、`WORKER_CMD` 完全上書きでの手動テストとの引数個数不一致を誘発しやすい。
2. **`_dispatch_via_agent_tool` 内部で `agent-skill-chain worker context` を再度呼び、adapter を自己解決する。**
   `worker-launch.sh` が既に1回解決済みの値を、同じロジックで再度問い合わせるだけの二重解決になる。二重解決は解決結果が経路によって食い違う余地（設定の再読込みタイミング差・レース）を生み、`ASC_WORKER_MODEL`/`ASC_WORKER_REASONING_EFFORT`/`ASC_WORKER_MODEL_TIER`/`ASC_AGENT_TOOL_DISPATCH` が既に単方向の「解決済み値を環境変数で渡す」設計（`worker-selection.ts` のコメント参照）に反する。
3. **（採用）`worker-launch.sh` が解決済みの `$ADAPTER` を `ASC_WORKER_ADAPTER` として `export` し、`_dispatch_via_agent_tool` がそれを読んで分岐する。**
   `ASC_REVIEW_ADAPTER`（`gate-launch-reviewer.sh` → `launch_gate_reviewer`）と対称な既存パターンの再利用であり、`ASC_WORKER_MODEL` 等の既存の「解決済み値を環境変数で単方向に渡す」設計とも整合する。関数シグネチャ変更が不要なため `human.sh` の独立実装・既存テストの引数呼び出しへの影響がない。

## Decision

`worker-launch.sh` が解決した adapter 名を `ASC_WORKER_ADAPTER` として `export` し（`ASC_WORKER_MODEL` 等と同じ export 群に追加）、`claude.sh` の `_dispatch_via_agent_tool` は `"${ASC_WORKER_ADAPTER:-claude}"` を読んで次のように分岐する。

- **`claude`（または未設定時の既定）**: 既存動作を変更しない。`subagent_type: agent-skill-chain-worker` を含む固定の `AGENT_TOOL_DISPATCH_REQUIRED` 指示を返す（AC-2、回帰なし）。
- **`codex`**: `_worker_default_cmd "$segment" "$contract"` を呼ぶ。この呼び出しは bash の動的関数束縛により、`codex.sh` が `source` 済みのプロセス内では `codex.sh` 版（`_codex_worker_model`/`_codex_worker_effort`/`_codex_worker_sandbox_opts` を用いて model・reasoning effort・sandbox設定を反映した `codex exec ...` コマンド行を返す）が呼ばれる。返ったコマンド行が stdin 経由でcontractを受け取る形（末尾が単独の `-`）である場合は、dispatch用に書き出し済みの `contract_file` から明示的に読み込む形へ入力元だけを差し替える（`_worker_default_cmd` 自体が持つ contract バイト数閾値によるstdin/引数埋め込みの分岐ロジックは変更・複製しない）。`AGENT_TOOL_DISPATCH_REQUIRED` 指示の `prompt:` は、固定 Claude Agent tool サブエージェントではなく、この Codex コマンドを Bash ツールで直接実行するよう指示する文言に差し替える。`_worker_default_cmd` が失敗（Codex CLI 不在等）した場合は、Agent tool dispatch 自体をフェイルセーフで打ち切り（取得済み lease を解放し非0非3非4を返す）、固定 Claude subagent へのフォールバックは行わない（AC-1）。
- **`human`（または未知の値）**: Agent tool dispatch をこの adapter へは適用しない。lease を解放しエラーとして返す（AI が人間判断を無自覚に代替する経路を作らない、AC-3）。`human.sh` は元々 `claude.sh` を `source` せず独立した `launch_worker` を持つため、通常この分岐には到達しない。到達した場合の安全側フェイルセーフとして定義する。

`.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md`（正本の運用手順書）は、この変更後の adapter 別挙動（claude=既存手順、codex=Bash直接実行、human=非対応でエラー）を自己完結する形で反映するよう同一 Issue 内で更新する。

## Consequences

- 利点: `worker.segment_overrides.<segment>.adapter: codex` の恒久設定が、Agent tool dispatch 有効な対話セッションでも実効的に尊重されるようになり、設定と実際の起動実行系の乖離が解消する。`ASC_REVIEW_ADAPTER` と対称な設計のため、レビュア起動側の既存挙動・テストへの影響がない。
- 欠点: `_dispatch_via_agent_tool` が adapter 分岐ロジックを持つことで当該関数の複雑度がわずかに増す。Codex 向け dispatch はサブエージェントツリーとして進行役セッションに可視化されず、Bash ツールの直接実行として現れるため、Claude 版と体験が異なる（許容: `docs/adr` Decision節が示す通り、Agent tool経由のCodex専用ディスパッチは代替案として棄却していない——将来的に Codex 専用 `subagent_type` が整備された場合はそちらへ切り替えられる余地を残す）。
- フォローアップ: Codex専用 `subagent_type` が将来利用可能になった場合、本ADRのDecisionを見直す新規ADRを作成し、`superseded-by` で関係を記録する。
