# DESIGN: プロジェクトポリシーへのCI確認義務・Codex実装委譲ロールの正規commit化

- Issue: `ISSUE-340`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

SPEC.md の全要件・全 AC-ID が、いずれかの設計要素に対応していることを示す。対応漏れは設計ゲートの立証観点（全要件→設計要素の対応）で指摘される。

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | `.agent-skill-chain/project/RULES.md` の「追加規約」箇条書き | 既存4項目末尾へ5項目目としてCI確認義務文言を一言一句そのまま追記する。既存4項目は変更しない |
| `AC-2` | `.agent-skill-chain/project/manifest.yaml` の `project.policy_version` と `documents.roles.implementation` | `policy_version` を `2→3`、`documents.roles.implementation` を `[]`（未設定）から `[roles/implementation.md]` へ変更する。他フィールド（`documents.common`・`precedence`・`constraints`・`model_selection`）は現状のまま維持する |
| `AC-3` | 新規 `.agent-skill-chain/project/roles/implementation.md` | AC-2 で登録した参照先パスと一致させる。内容は本設計の「コンポーネント構成」で規定する |
| `AC-4` | commit・push・Draft PR 作成という調整状態操作 | 成果物ではなくワークフロー手続きのため、設計要素ではなく PLAN.md の変更単位として扱う |

## 責務・境界

### コンポーネント構成

3件はいずれも `.agent-skill-chain/project/` 配下の静的ポリシー文書であり、実行コードの新設は伴わない。責務は以下のとおり分離済みで、1文書に責務が集中する箇所は無い（反証観点）。

- `RULES.md`「追加規約」節: 本リポジトリ自身を変更する作業に適用する手続き規約。今回追加する1行は「PR作成後のCI確認義務」という手続き上の責務のみを持ち、Codex委譲や他ロールの挙動には関与しない。
- `manifest.yaml`: project policy の登録台帳。`documents.roles.implementation` エントリの追加と `policy_version` 更新という登録責務のみを持ち、`roles/implementation.md` 自体の内容には関与しない（内容は参照先ファイルの責務）。
- `roles/implementation.md`（新規）: 対話セッション中にユーザーから直接実装を依頼された場合に限り、実装作業を Codex CLI（`codex exec`）へ reasoning effort `high`（実装者判断で `xhigh` へ格上げ可）で委譲する旨を定める project 固有ポリシー。agent-skill-chain 正規Issueフロー上の implementation segment worker（`.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.segment_overrides.implementation` が別途規定、ISSUE-307で恒久設定済み）には影響しない旨を本文中に明記し、両者の適用範囲が排他的であることを自己完結して記述する。

### 依存関係

`manifest.yaml` の `documents.roles.implementation` エントリが `roles/implementation.md` のパスを保持する片方向の参照であり、逆方向の依存は無い。`RULES.md` の追記項目はいずれの2文書とも独立している。循環依存は存在しない。

```text
manifest.yaml (documents.roles.implementation) → roles/implementation.md
RULES.md（追加規約5項目目）: 独立（他の設計要素に依存しない）
```

## 関連ADR

本Issueは既に内容が確定した3変更の正規化のみを目的とし、新規のアーキテクチャ判断を伴わないため、関連ADRは無い。

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

単純なファイル追記・新規作成のみで実行コードの変更を伴わないため、影響範囲は限定的である。

- 想定される失敗モード: `manifest.yaml` がスキーマ不適合になる（`documents.roles.implementation` の型誤りや `policy_version` の型誤り）。`roles/implementation.md` の文言が禁止語・セクション番号参照・ファイルパス＋行番号参照を含みCI検査（`lint-vocab.sh`・`lint-references.sh`）に失敗する。
- ロールバック手順: 3変更は同一commitにまとめてpushするため、当該commitをrevertすれば `RULES.md`・`manifest.yaml`・`roles/implementation.md` の3件が同時に元の状態へ即座に戻る。
- 影響を受ける既存機能: 本リポジトリ自身（`agents-md-self-extension`）の project policy のみ。`.agent-skill-chain/project/` は配布対象外のため、consumer project への影響は無い。agent-skill-chain 正規Issueフローの implementation segment worker 起動プロンプト構成（`.agent-skill-chain/config/roles.yaml` 等）は変更対象外であり影響しない。
