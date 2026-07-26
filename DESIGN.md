# DESIGN: 配布AGENTS.mdにupgradeコマンドの正確な起動構文が記載されていない

- Issue: `ISSUE-298`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | 配布正本 `AGENTS.md`（`## GitHub配布・マルチAI対応` 段落末尾への追記） | 新規セクションではなく既存の1行段落へ追記し行数を増やさない |
| `AC-2` | 追記文言を1文に絞る | 現在144/150行、既存段落への追記のため改行を増やさず収める |
| `AC-3` | 本リポジトリルート `AGENTS.md`（展開結果）を同一内容へ同期 | `computeTemplateSyncDiffs` はsource⊆dest方向の内容一致検査 |

## 責務・境界

### コンポーネント構成

- `.agent-skill-chain/templates/github/.github/../AGENTS.md`ではなく`.agent-skill-chain/templates/`直下の`AGENTS.md`（`ROOT_LEVEL_ENTRIES`対象、配布正本）: `## GitHub配布・マルチAI対応` 段落の末尾に、`upgrade` の実際の起動コマンド構文（`npx github:techbeansjp-free/AGENTS.md upgrade [target_dir] [--dry-run]`、バージョン固定時は `#<tag-or-branch>`）を1文で追記する。
- 本リポジトリルート `AGENTS.md`（展開結果）: 配布正本と内容一致させる。

### 依存関係

```text
配布正本 .agent-skill-chain/templates/AGENTS.md → (init/upgrade) → consumerのAGENTS.md
配布正本 .agent-skill-chain/templates/AGENTS.md = 本リポジトリルートAGENTS.md（内容一致、verify-template-syncが検査）
```

## 関連ADR

無し（既存文書への1文追記であり、新たな恒久判断を要しない）。

## 障害・ロールバック考慮

- 想定される失敗モード: 追記によりAGENTS.mdが150行を超過する、または既存段落の意味を損なう改変をしてしまう。
- 対策: 改行を増やさず既存段落末尾へ追記する（`verify-doc-length`で機械検査）。既存文の削除・書き換えは行わない（追記のみ）。
- ロールバック手順: 本Issueのcommitをrevertすれば元の文言に戻る。
- 影響を受ける既存機能: 無し（文書追記のみ、CLI挙動・スキーマへの影響なし）。
