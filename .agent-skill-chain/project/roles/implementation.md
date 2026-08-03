# 実装ロール固有規約 — Codexへの実装委譲

## 目的・対象

本規約は `techbeansjp-free/AGENTS.md` 自身の開発における、**対話セッション中にユーザーから直接「実装して」等の依頼を受けた場合の実装作業**の担当・reasoning effortを定める。開発用の project 固有ポリシーであり、`.agent-skill-chain/project/` は配布対象から除外されているため、consumer project の配布物・挙動には一切影響しない。

**適用範囲の限定（重要）**: `segment start`（`src/commands/segment.ts`）が組み立てる自動実装ワーカー起動プロンプトは `.agent-skill-chain/config/roles.yaml` の `role_contracts` のみで構成され、`.agent-skill-chain/project/manifest.yaml` に登録した本文書を読み込まない。したがって本規約は agent-skill-chain の正規Issueフロー上で起動される implementation segment worker には配布されず、自動的には適用されない。当該フローの実装セグメントの担当・reasoning effortは、既に `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.segment_overrides.implementation`（adapter=codex、model_tier=highest_capability、reasoning_effort=high。ISSUE-307で恒久設定済み）が別途・実効的に規定しており、本規約はそれを変更しない。本規約が実際に効くのは、対話セッションで作業するAI（本文書を `.agent-skill-chain/project/manifest.yaml` 経由で直接読む主体）に限る。

## 規約

- 実装作業はClaude自身が直接編集するのではなく、**Codex CLI（`codex exec`）へ委譲する**。呼び出し経路（CLI操作環境が提供するコマンド、直接のシェル呼び出し等）は稼働環境に依存してよいが、規約として固定するのは「最終的に `codex exec` がreasoning effort `high`（既定）で起動されること」である。
- reasoning effortは **`high`** を既定の最上位ティアとする。委譲時は `codex exec` の `model_reasoning_effort` に `high` を明示指定する。
- **実装者（Codex）の判断による `xhigh` への格上げを許可する**。難度が高いと判断した場合、都度のユーザー承認なしに `xhigh` を使ってよい。

## 完了条件

- 対話セッションでの実装依頼は、`codex exec` へreasoning effort `high` 明示で委譲されている（具体的な呼び出しコマンド名は稼働環境依存でよい）。

## 対象外

- agent-skill-chain の正規Issueフロー上で起動される implementation segment worker（担当・reasoning effortは `agent-skill-chain.yaml` の既存恒久設定が規定する。上記「適用範囲の限定」参照）。
- 設計・レビュー・監査など実装以外の作業のモデル選択（`MODEL_TIER_TABLE.md` が別途規定するcore-audit reviewer選定を含む）。
- consumer project の実装ロール運用（本規約は配布されない）。
