# DESIGN: trusted gate recorder導入後、新規PRのレビュー証跡を生成する経路がCIに存在しない

- Issue: `ISSUE-300`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | `.agent-skill-chain/standards/GATE_REVIEW_OPERATIONS.md`（新設） | 既存3標準文書と同じ配置 |
| `AC-2` | 実PR（PR #282 / Issue #278、strict profile）での`gate-local-review.sh`実地実行 | 現在のmain基準 |
| `AC-3` | 既存コード（`gate-local-review.sh`・`review-evidence.ts`）の該当箇所を引用した確認記述 | 新規実装は行わない |

## 責務・境界

### コンポーネント構成

- `.agent-skill-chain/standards/GATE_REVIEW_OPERATIONS.md`: 「誰が」「いつ」「どのコマンドを」「どのcapability要件で」実行するかを自己完結して記載する新規運用手順文書。既存の`TEST_POLICY.md`と同じ階層・同じ役割（AGENTS.mdが参照する規範文書）とする。
- 完全自動化（CI内でのAIレビュア実行）は`.agent-skill-chain/project/MODEL_TIER_TABLE.md`が既に明示的に禁止している（「GitHub Actionsは...AI、provider CLI、Codex Action、provider API credential、self-hosted runnerを使用しない」）。この制約は本Issueのスコープでは変更しない。したがって完全自動化ではなく、**進行役が明示的に実行する手順を文書化する**ことが本Issueの現実的な到達点である。

### 依存関係

```text
新規PR push
  → CI（verify-and-publish）が証跡なしで human_required
  → 進行役が GATE_REVIEW_OPERATIONS.md の手順に従い gate-local-review.sh を実行
    → protected base worktree（main、clean）から隔離clone作成
    → gate-review.sh（scaffold生成）
    → gate-launch-reviewer.sh × 2（strict時。各slotが独立レビュアを起動）
    → gate submit-evidence（GitHub PR Reviewへ証跡投稿）
    → repository_dispatch → trusted gate recorder workflow が Check Run を発行
  → verify-and-publish が証跡を検証し成功
```

## 独立性の技術的担保（AC-3の確認内容）

- `gate-local-review.sh`は実行前に`CURRENT_ROOT`・`CURRENT_SHA`がprotected base（main、指定base_sha）と一致し、かつcleanであることを検査する（候補ブランチのコードを証跡生成に使わせない）。
- 隔離clone（`TRUSTED_TMP`配下）は`git clone --no-checkout` + `checkout --detach $BASE_SHA` + `remote remove origin`でcredential-bearing remoteを持たない状態にしてからbuildする。
- `launcher-token.json`（`mode 0600`、`wx`フラグで排他生成）が各slotの`run_id`を事前に固定し、`consumed_slots`で一度使った slotの再利用を防ぐ。
- `src/lib/review-evidence.ts`の`verifyGithubReviewEvidence`が、`runIds`・`slots`の`Set`重複検査（`runIds.size !== candidates.length`）で真に独立した2件であることを検証する。同一actorでも`launcher_digest`・`trusted_base_sha`・`prompt_digest`の一致を要求するため、証跡を後から偽装することはできない。

## 関連ADR

無し（新規の恒久判断を伴わない運用文書の追加）。

## 障害・ロールバック考慮

- 想定される失敗モード: 運用手順文書の記載が実際のコマンド仕様（引数・capability要件）と乖離する。
- 対策: 文書内のコマンド例は、本Issueの実地検証（AC-2）で実際に成功した手順をそのまま転記する。
- ロールバック手順: 本Issueのcommitをrevertすれば文書追加前の状態に戻る（コード変更を伴わないため副作用はない）。
- 影響を受ける既存機能: 無し（新規文書追加のみ）。
