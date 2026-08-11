# DESIGN: Agent tool dispatchがsegmentのadapter設定(codex等)を無視し常に固定のClaudeベースsubagentへディスパッチする

- Issue: `ISSUE-609`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（adapter: codex 時にCodexが実行される） | `worker-launch.sh` の `ASC_WORKER_ADAPTER` export、`claude.sh` `_dispatch_via_agent_tool` のcodex分岐、`_worker_default_cmd`（動的束縛によるcodex.sh版）再利用 | Bash直接実行方式を採用（ADR-0058） |
| `AC-2`（adapter: claude 既定の回帰無し） | `_dispatch_via_agent_tool` の `"${ASC_WORKER_ADAPTER:-claude}"` 既定分岐（既存の固定 `subagent_type: agent-skill-chain-worker` 経路を変更しない） | `ASC_WORKER_ADAPTER` 未設定環境（既存呼び出し元・既存テスト）でも既定値`claude`で従来どおり動作 |
| `AC-3`（adapter: human 時にAI自動代替しない） | `_dispatch_via_agent_tool` のhuman/未知adapter分岐（フェイルセーフでエラー・lease解放、AI起動なし） | `human.sh` は元々 `claude.sh` を source しないため通常到達しない防御的分岐 |
| `AC-4`（本リポジトリ自身の恒久設定が対話セッションでも尊重される統合テスト） | `test/integration/worker-adapters.test.ts` への新規テストケース追加（`worker.segment_overrides.implementation: {adapter: codex}` 相当の設定＋Agent tool dispatch有効＋Claude Code CLIセッション条件下で `worker-launch.sh` を呼び、返る dispatch 指示がCodexコマンドを指すことを検証） | `codex` バイナリは既存テストと同様のPATH上モック（echo等）で代替し、実CLI呼出しは行わない |

## 責務・境界

### コンポーネント構成

- `.agent-skill-chain/scripts/worker-launch.sh`: `agent-skill-chain worker context` から解決済み adapter 名を得て、既存の `ASC_WORKER_MODEL`/`ASC_WORKER_REASONING_EFFORT`/`ASC_WORKER_MODEL_TIER`/`ASC_AGENT_TOOL_DISPATCH` の export 群に `ASC_WORKER_ADAPTER` を追加する（解決済み値を環境変数で下流へ単方向に渡す既存責務の範囲内）。adapter 名から挙動を分岐させる判断は持たない。
- `.agent-skill-chain/adapters/claude.sh` の `_dispatch_via_agent_tool`: Agent tool dispatch が必要な場合の、adapter 別の dispatch 指示（`AGENT_TOOL_DISPATCH_REQUIRED` 出力）を組み立てる。`ASC_WORKER_ADAPTER` を読み、`claude`（既定）/`codex`/その他（human・未知値）で分岐する。lease取得・segment start・contract一時ファイル書き出し・renewデーモン起動という既存の共通処理は変更しない。
- `.agent-skill-chain/adapters/claude.sh` の `_worker_default_cmd`: 既存のまま（claude CLI起動コマンド組み立て）。
- `.agent-skill-chain/adapters/codex.sh` の `_worker_default_cmd`（同名関数の再定義、動的束縛で `_dispatch_via_agent_tool` からも参照される）: 既存のまま。Codex起動コマンド（model・reasoning effort・sandbox設定込み）を組み立てる責務は変更しない。`_dispatch_via_agent_tool` からの呼び出し時にも、非dispatch経路と同一のモデル・reasoning effort解決ロジックが再利用される。
- `.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md`: 運用手順の正本。adapter別の挙動（claude=既存Agent tool手順、codex=Bash直接実行手順、human=非対応）を自己完結する形で反映する。

### 依存関係

```text
worker-launch.sh（adapter解決・ASC_WORKER_ADAPTER export）
  → claude.sh#launch_worker / codex.sh#launch_worker(=_codex_worker_lifecycle)
    → claude.sh#_dispatch_via_agent_tool（ASC_WORKER_ADAPTERを読み分岐）
      → [codex分岐] _worker_default_cmd（動的束縛: codex.sh版 or claude.sh版）
        → codex.sh#_codex_worker_model / _codex_worker_effort / _codex_worker_sandbox_opts
```

`_dispatch_via_agent_tool` は `claude.sh` に単一定義のまま存在し続け、codex.sh は追加のソースコード変更を必要としない（既存の `_worker_default_cmd` オーバーライドがそのまま dispatch 経路でも再利用される設計のため）。循環依存は生じない——`_dispatch_via_agent_tool` は `_worker_default_cmd` を一方向に呼ぶだけであり、`_worker_default_cmd` 側は dispatch の有無を意識しない。

### 図示要否の判断

- 判断: `不要`
- 根拠: 依存関係は上記テキスト矢印表記どおり一本の呼び出し連鎖（worker-launch.sh → launch_worker → `_dispatch_via_agent_tool` → `_worker_default_cmd` → codex固有解決関数群）であり、分岐先は2系統（claude既定 / codex）＋防御的なhuman/未知分岐の計3系統に留まる。状態遷移も「adapter値による分岐」の1段のみで、責務境界（コンポーネント）も3つ未満（worker-launch.sh・claude.sh内`_dispatch_via_agent_tool`・codex.sh内モデル解決群の3者は同一ファイル内の関数連鎖であり独立コンポーネントとして数えるほどの複雑さがない）。図示基準（依存3件以上・状態遷移2件以上・責務境界3件以上）のいずれにも該当しない。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0058
    relation: adopts
```

## 障害・ロールバック考慮

- 想定される失敗モード:
  - `ASC_WORKER_ADAPTER` が何らかの理由で未設定・空のまま `_dispatch_via_agent_tool` に到達した場合、既定値 `claude` にフォールバックし従来どおりの固定 Claude subagent dispatchを行う（安全側：未知の場合は既存の実績ある経路を維持する）。
  - `codex` 分岐で `_worker_default_cmd` が失敗した場合（`codex` CLI が PATH 上に無い等）、Agent tool dispatch 自体を打ち切り、取得済み lease を解放したうえでエラーを返す。固定 Claude subagent への無条件フォールバックは行わない（設定と異なる実行系が気づかれずに使われる、本Issueの根本原因と同種の事故を再発させないため）。
  - `human` 分岐に到達した場合（本来 `human.sh` 経由では発生しない防御的ケース）、lease を解放しエラーを返す。AIによる自動代替は行わない。
- ロールバック手順: `worker-launch.sh` の `ASC_WORKER_ADAPTER` export 追加行と、`claude.sh` `_dispatch_via_agent_tool` のadapter分岐差分を revert すれば、Issue着手前の「常に固定Claude subagentへdispatch」という既存動作へ戻る。設定ファイル（`agent-skill-chain.yaml`）・スキーマ・`worker.segment_overrides` の構造自体は変更しないため、revertに追加のmigrationは不要。
- 影響を受ける既存機能: `worker.agent_tool_dispatch.enabled: true` かつ Claude Code CLI 対話セッション内で `launch_worker` を呼ぶ既存の全セグメント起動経路（AC-2で回帰なしを保証）。read-only な `launch_gate_reviewer`（ゲートレビュア起動）は本Issueのスコープ外であり変更しない。
