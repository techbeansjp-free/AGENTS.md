# SPEC: worker.agent_tool_dispatch.enabledをtrueにし、Agent tool経由のworker起動を既定で有効化する

- Issue: `ISSUE-470`
- 作成者: `spec_worker`
- 対象ブランチ: `feature/470-agent-tool-dispatch-default-enable`

## 目的・背景

Issue #448（PR #457でマージ済み、2026-08-05）により、進行役がClaude Code CLIセッションである場合に `worker-launch.sh` が起動するsegment worker（spec/design/implementation/validation）を、進行役自身のAgent tool呼び出しとしてサブエージェントツリー上に可視化する仕組み（Agent tool dispatch）が実装された。

しかし `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.agent_tool_dispatch.enabled` は既定 `false` のままであり、実装済みのこの機能は導入後も未使用の状態が続いている。既定offの理由はコメントに「Agent tool経由の起動は、進行役セッションとの生存期間結合など既知の制約を伴うため」と記載されている（進行役セッションが切断・終了するとworkerも道連れで終了する制約）。

2026-08-06、進行役がIssue #461/#462/#429を並行対応中、ユーザーから「Agent tool使うように前に指示したはず」との指摘を受けた。ユーザーは可視性の実現（Issue #448の効果）を実際に有効な状態として期待しており、実装済みだが未有効化のままという状態は期待に反する。本Issueはこの既定値を反転させ、ユーザーの期待と実際の挙動を一致させることを目的とする。

## 要求 → 要件 → 受入条件

### 要求

`worker.agent_tool_dispatch.enabled` の既定値を `true` に変更し、Claude Code CLIセッションが進行役を務める場合はAgent tool経由のworker起動が既定で有効になるようにする。

### 要件

- `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.agent_tool_dispatch.enabled` の値を `false` から `true` へ変更する。
- Issue #448のAC-2（Claude Code CLIセッション以外から呼ばれた場合は既存のheadless subprocess起動へフォールバックする）は変更しない。既定 `true` にしても、Claude Code CLIセッション判定（`_orchestrator_is_claude_code_cli_session`）が偽の場合（human運用・CI・cron等）は従来通りheadless方式のまま動作する。
- 進行役セッション終了時にworkerも終了する生存期間結合の制約自体は、本Issueの対象外としスコープ外に明記する。
- `.agent-skill-chain/schemas/config.schema.yaml` 側に既定値・例示として `agent_tool_dispatch.enabled: false` を保持している箇所があれば、変更後の既定値 `true` と矛盾しないように整合させる。

### 受入条件（Acceptance Criteria）

#### AC-1: worker.agent_tool_dispatch.enabledの既定値がtrueになっている

- Given: `.agent-skill-chain/config/agent-skill-chain.yaml` を変更前の状態から読み込む
- When: `worker.agent_tool_dispatch.enabled` の値を確認する
- Then: 値が `true` である
- 検証方法見込み: `automated`

#### AC-2: 既定trueの状態でClaude Code CLIセッション判定が真の場合にAgent tool経由起動が選択される

- Given: `worker.agent_tool_dispatch.enabled: true`（変更後の既定値）が設定され、進行役セッションがClaude Code CLIセッションであると判定される
- When: `worker-launch.sh` がsegment worker（spec/design/implementation/validationのいずれか）を起動する
- Then: Agent tool経由のworker起動が選択される（Issue #448で実装済みの分岐ロジックに変更を加えず、設定値の反映のみで到達する）
- 検証方法見込み: `automated`

#### AC-3: 既定trueの状態でもClaude Code CLIセッション以外ではheadless方式にフォールバックする

- Given: `worker.agent_tool_dispatch.enabled: true`（変更後の既定値）が設定され、進行役セッションがClaude Code CLIセッションでないと判定される（human運用・CI・cron等）
- When: `worker-launch.sh` がsegment workerを起動する
- Then: 既存のheadless subprocess起動が選択され、Issue #448のAC-2で定めたフォールバック挙動が保持される
- 検証方法見込み: `automated`

#### AC-4: agent_tool_dispatch.enabledを明示的にfalseへ設定した場合は引き続きfalseとして解決される

- Given: `worker.agent_tool_dispatch.enabled: false` を利用者がconfigへ明示的に設定する
- When: worker選択ロジック（`resolveWorkerSelection`）がこの設定を解決する
- Then: `agentToolDispatch` はfalseとして解決され、既定値の変更が明示的なopt-out設定を上書きしない
- 検証方法見込み: `automated`

#### AC-5: schema側の既定値・例示表現が変更後の既定値とactive設定として矛盾しない

- Given: `.agent-skill-chain/schemas/config.schema.yaml` に `agent_tool_dispatch.enabled` の既定値・例示表現が含まれる
- When: `.agent-skill-chain/config/agent-skill-chain.yaml` の実際の既定値を `true` に変更する
- Then: schemaファイル側の対応する記述が、変更後の実際の既定値と矛盾する説明にならないよう整合している（schemaのバリデーション自体は `enabled` を任意のboolean値として引き続き許容する）
- 検証方法見込み: `manual`

## スコープ外

- Agent tool経由起動における進行役セッションとworkerの生存期間結合制約（進行役セッション終了でworkerも終了する）自体の解消。別Issueで扱う。
- Issue #448が実装したAgent tool dispatch機構自体（可視化の仕組み、分岐ロジックの実装）の変更・改善。
- `worker.adapter` や `segment_overrides` など、`agent_tool_dispatch.enabled` 以外のworker設定項目の既定値変更。
