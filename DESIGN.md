# DESIGN: worker.agent_tool_dispatch.enabledをtrueにし、Agent tool経由のworker起動を既定で有効化する

- Issue: `ISSUE-470`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（既定値がtrueになっている） | 実効設定ファイル `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.agent_tool_dispatch.enabled` | 値を `false` から `true` へ変更する。この1箇所が既定値の唯一の実体（正本）。 |
| `AC-2`（Claude Code CLIセッション判定が真の場合はAgent tool経由が選択される） | 既存の解決ロジック `resolveWorkerSelection`（`src/lib/worker-selection.ts`）＋既存のセッション判定分岐（`.agent-skill-chain/adapters/claude.sh` `_orchestrator_is_claude_code_cli_session` / ADR-0030 Decision 1） | コード変更なし。設定値の真偽をそのまま機械的に解決する既存ロジックが、値が `true` になったことでAC-2の挙動へ到達する。ISSUE-448の既存テスト（`test/integration/worker-adapters.test.ts`）が既に明示的な `enabled: true` 設定でこの分岐を検証済み。 |
| `AC-3`（既定trueでもClaude Code CLIセッション以外はheadlessへフォールバックする） | 既存のセッション判定分岐（同上）。分岐条件はセッション種別のみであり `agent_tool_dispatch.enabled` の値では変化しない。 | コード変更なし。ISSUE-448の既存テストが `CLAUDECODE` 未設定時の判定を検証済みであり、既定値変更の影響を受けない。 |
| `AC-4`（明示的にfalseへ設定した場合は引き続きfalseとして解決される） | 既存の解決ロジック `resolveWorkerSelection` の `agentToolDispatch: config.worker.agent_tool_dispatch?.enabled === true` という真偽値の厳密等価比較 | コード変更なし。この比較は既定値の変更と独立しており、明示的な `false` を上書きしない。CLI経由（`worker context`コマンド）でも同じ値が反映されることを回帰テストで新設・確認する。 |
| `AC-5`（schema側の既定値・例示表現が矛盾しない） | ドキュメント整合層：`.agent-skill-chain/schemas/config.schema.yaml` の `examples[0]`・`examples[1]`、および `.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md` の既定値の記述 | 両ファイルの `agent_tool_dispatch: {enabled: false}` という例示・説明文を `true` へ更新する。schemaのバリデーション自体（`type: boolean`）は変更しない。 |

## 責務・境界

### コンポーネント構成

- `.agent-skill-chain/config/agent-skill-chain.yaml`（実効設定）: `worker.agent_tool_dispatch.enabled` の値そのものを保持する唯一の実効正本。本Issueが変更する中心的な1ファイル。
- `.agent-skill-chain/schemas/config.schema.yaml`・`.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md`（ドキュメント整合層）: 実効設定の値を人間可読な例示・説明として叙述する文書群。値そのものは持たず、実効設定と矛盾しないことだけに責務を限定する。
- `src/lib/worker-selection.ts`（既存の解決ロジック）・`.agent-skill-chain/adapters/claude.sh`（既存のセッション判定分岐）: 変更なし。設定値とセッション種別だけを入力に、既存の分岐を機械的に評価する。この既存ロジックが「値の変更だけでAC-2/AC-3/AC-4へ到達する」というSPEC.mdの要件そのものを担保する。
- 回帰テスト（`test/unit/config.test.ts`・`test/integration/worker-context.test.ts`）: 実効設定ファイルの値をそのまま読み込んで検証している箇所のみ、期待値を新しい既定値へ追随させる。設定値を明示的に上書きしているテスト（ISSUE-448由来）は対象外であり変更しない。

### 依存関係

```text
実効設定ファイル（agent-skill-chain.yaml） → 既存の解決ロジック（resolveWorkerSelection） → 既存のCLI出力（worker context） → 既存のセッション判定分岐（worker-launch.sh / claude.sh、変更なし）
実効設定ファイル ⇢ ドキュメント整合層（schema examples・AGENT_TOOL_DISPATCH.md、値の叙述のみ・実行時依存なし）
```

### 図示要否の判断

- 判断: `不要`
- 根拠: 依存関係は2系統（実行時の解決経路1本、ドキュメント整合の並行関係1本）で3つ未満、状態遷移は無し（boolean値の変更のみ）、責務境界となるコンポーネントも4つで単純な一段の設定値変更とその整合先に限られ、循環依存も無い。Mermaid図を要する複雑度に該当しない。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0030
    relation: adopts
```

ADR-0030はAgent tool dispatch機構自体（3段分割の起動フロー、I5/I3両立の設計、既定offの理由となった残存リスク）を確定した accepted ADR である。本Issueはこの機構の分岐ロジック・実装を一切変更せず、既定値のみを反転する。ADR-0030の Decision・Consequences は書き換えず、既定値反転という新しい決定を新規ADR（本Issueで作成、`docs/adr/` 配下）として `related: ADR-0030` で記録する。

## 障害・ロールバック考慮

- 想定される失敗モード: Claude Code CLIセッション以外（human運用・CI・cron）で誤ってAgent tool dispatchが有効化される懸念があるが、AC-3が担保する既存のセッション判定分岐（コード変更なし）により、この失敗モードは構造的に生じない。真の残存リスクは、これまでopt-inした一部プロジェクトのみが負っていたADR-0030記載の既知の制約（進行役セッションとworkerの生存期間結合、Bashコマンド単位のツール許可粒度低下、`contract.md`へのRead残存リスク、Agent tool戻り値のコンテキスト漏えい）が、本リポジトリのClaude Code CLIセッション運用全般で既定で発生するようになることである。この受容は新規ADRのConsequencesに明記する。
- ロールバック手順: `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.agent_tool_dispatch.enabled` を `true` から `false` へ書き戻すだけで、既存のheadless subprocess起動のみへ完全に戻る。設定ファイル1箇所の変更で完結し、コード・スキーマの構造変更を伴わないため即時にロールバック可能（ADR-0030 Consequencesが述べる「ロールバックは設定を戻すだけで完結する」という性質がそのまま適用される）。
- 影響を受ける既存機能: Claude Code CLIセッションが進行役を務めるすべてのIssueのsegment worker起動方式（spec/design/implementation/validationの4セグメント共通）。Claude Code CLIセッション以外の運用（human・CI・cron）はAC-3により無影響。
