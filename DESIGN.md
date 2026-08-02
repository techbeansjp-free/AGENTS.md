# DESIGN: プロジェクトポリシーへのCI確認義務・Codex実装委譲ロールの正規commit化

- Issue: `ISSUE-340`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

SPEC.md の全要件・全 AC-ID が、いずれかの設計要素に対応していることを示す。対応漏れは設計ゲートの立証観点（全要件→設計要素の対応）で指摘される。

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | `.agent-skill-chain/project/RULES.md` の「追加規約」箇条書き | 既存4項目末尾へ5項目目としてCI確認義務文言を一言一句そのまま追記する。既存4項目は変更しない。検証方法見込みは`hybrid`（前提条件：3件のCI検査通過／実質検証：strict profile独立2レビュアの目視確認）であり、CI検査は`.agent-skill-chain/project/`を走査対象に含まないため内容面の検証を代替しない |
| `AC-2` | `.agent-skill-chain/project/manifest.yaml` の `project.policy_version` と `documents.common` | `policy_version` を `2→3`、`documents.common` の末尾へ `interactive-implementation-delegation.md` を追加する。`documents.roles` は変更せず現状の `{}` のまま維持する。他フィールド（`precedence`・`constraints`・`model_selection`）は現状のまま維持する |
| `AC-3` | 新規 `.agent-skill-chain/project/interactive-implementation-delegation.md`（`roles/` ディレクトリ外） | AC-2 で登録した参照先パスと一致させる。内容（(a)〜(d)の4点）は本設計の「コンポーネント構成」で規定する。検証方法見込みはAC-1同様`hybrid` |
| `AC-4` | commit・push・Draft PR 作成という調整状態操作、および `.agent-skill-chain/project/` 配下変更に伴う `required_profile: strict` ゲートレビュー | 成果物ではなくワークフロー手続きのため、設計要素ではなく PLAN.md の変更単位・ゲートレビュー実施方針として扱う |

## 責務・境界

### コンポーネント構成

3件はいずれも `.agent-skill-chain/project/` 配下の静的ポリシー文書であり、実行コードの新設は伴わない。責務は以下のとおり分離済みで、1文書に責務が集中する箇所は無い（反証観点）。

- `RULES.md`「追加規約」節: 本リポジトリ自身を変更する作業に適用する手続き規約。今回追加する1行は「PR作成後のCI確認義務」という手続き上の責務のみを持ち、Codex委譲や他ロールの挙動には関与しない。
- `manifest.yaml`: project policy の登録台帳。`documents.common` 末尾への `interactive-implementation-delegation.md` エントリ追加と `policy_version` 更新という登録責務のみを持ち、`interactive-implementation-delegation.md` 自体の内容には関与しない（内容は参照先ファイルの責務）。登録先を `documents.roles.implementation` ではなく `documents.common` とするのは、`documents.roles.<segment>` が当該segment worker専用の配送チャネルである一方、`interactive-implementation-delegation.md` の想定読者は対話セッション中に実装依頼を受けるAI（進行役・対話エージェント）でありimplementation segment workerではないため、配送先と内容の自己矛盾を避けるためである。`documents.roles` は変更せず現状の `{}` のまま維持する。
- `interactive-implementation-delegation.md`（新規、`.agent-skill-chain/project/roles/` ではなく `.agent-skill-chain/project/` 直下）: 対話セッション中にユーザーから直接実装を依頼された場合に限り、実装作業を Codex CLI（`codex exec`）へ reasoning effort `high`（実装者判断で `xhigh` へ格上げ可）で委譲する旨を定める project 固有ポリシー。ファイル配置を `roles/` 外とするのは、`roles/<role>.md` が AGENTS.md 上 segment worker 固有規約の置き場であるのに対し、本文書の読者は対話セッション中のAI（進行役・対話エージェント）でありimplementation segment workerではないため、`documents.common` 登録という配送実態とパスの見た目を一致させるためである。本文中に以下(a)〜(d)を自己完結して明記する：
  - (a) 対話セッション中の実装依頼をCodex CLI（`codex exec`）へreasoning effort `high`（実装者判断で`xhigh`許可）で委譲する旨
  - (b) 当該委譲が成果物branchへのcommitを正当化するのは、(i) 既存のIssue・ブランチ・worktreeの文脈内であること、(ii) 当該Issueのwriter leaseを取得済みであること、(iii) 実行主体がAGENTS.md「役割・権限・writer lease」表のセグメント作業ワーカーであり進行役ではないこと（I5 進行役の純粋性）、(iv) implementation-gate（I2）を通過すること、の全てを満たす場合に限られる旨
  - (c) agent-skill-chain 正規Issueフロー上の implementation segment worker（`.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.segment_overrides.implementation` が別途・恒久的に規定、ISSUE-307で恒久設定済み）には影響しない旨
  - (d) `xhigh`格上げが `manifest.yaml` の `model_selection.ordinary.behavior: explicit_selection`・`MODEL_TIER_TABLE.md` の恒久設定維持原則と衝突しない旨——両者は「Issueをまたいで維持される恒久設定」と「(b)の4条件下でその場のIssue・PRスコープに閉じる実行時判断」という適用対象が排他的であるため

### 依存関係

`manifest.yaml` の `documents.common` エントリが `interactive-implementation-delegation.md` のパスを保持する片方向の参照であり、逆方向の依存は無い。`RULES.md` の追記項目はいずれの2文書とも独立している。循環依存は存在しない。

```text
manifest.yaml (documents.common) → interactive-implementation-delegation.md
RULES.md（追加規約5項目目）: 独立（他の設計要素に依存しない）
```

## 関連ADR

本Issueは既に内容が確定した3変更の正規化のみを目的とし、新規のアーキテクチャ判断を伴わないため、関連ADRは無い。

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

単純なファイル追記・新規作成のみで実行コードの変更を伴わないため、影響範囲は限定的である。

- 想定される失敗モード: `manifest.yaml` がスキーマ不適合になる（`documents.common` の型誤りや `policy_version` の型誤り）。`interactive-implementation-delegation.md` の文言が禁止語・セクション番号参照・ファイルパス＋行番号参照を含みCI検査（`lint-vocab.sh`・`lint-references.sh`）に失敗する。これら3検査は `.agent-skill-chain/project/` 配下を走査対象に含まないため、(a)〜(d)の記載漏れ・整合性不備はCI検査では検出されず、strict profile独立2レビュアの目視確認が最終防衛線となる。
- ロールバック手順: 3変更は同一commitにまとめてpushするため、当該commitをrevertすれば `RULES.md`・`manifest.yaml`・`interactive-implementation-delegation.md` の3件が同時に元の状態へ即座に戻る。
- 影響を受ける既存機能: 本リポジトリ自身（`agents-md-self-extension`）の project policy のみ。`.agent-skill-chain/project/` は配布対象外のため、consumer project への影響は無い。agent-skill-chain 正規Issueフローの implementation segment worker 起動プロンプト構成（`.agent-skill-chain/config/roles.yaml` 等）は変更対象外であり影響しない。

## 制約

本Issueが変更する3ファイル（`RULES.md`・`manifest.yaml`・`interactive-implementation-delegation.md`）はいずれも `manifest.yaml` の `model_selection.core_review.triggers.path_prefixes` に登録された `.agent-skill-chain/project/` 配下に存在する。このため `classifyCoreReview` によるコアレビュー判定は `core_path_changed` を理由に `required: true` を返し、`required_profile: strict`（専任2体レビュア、各レビュアは `model_tier: frontier_coding` かつ `reasoning_tier: maximum_reasoning` の能力証明を要する）でのゲートレビューが必須となる。レビュア確保が不可能な場合は `unavailable: human_required` に従い人間判断へ昇格する。この判定はレビュープロセス上の制約であり、`RULES.md`・`manifest.yaml`・`interactive-implementation-delegation.md` 自体の内容・責務には影響しない。
