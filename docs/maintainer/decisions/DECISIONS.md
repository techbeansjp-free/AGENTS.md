# DECISIONS — 本リポジトリの恒久 ADR 記録（決定ログ）

本ファイルは、本リポジトリ（`techbeansjp-free/AGENTS.md`）の設計・運用に関する**恒久的な設計判断（ADR: Architecture Decision Records）**を git 追跡で永続保存する単一の記録先である。

`ISSUE_TRACKING_MODE=github_native` 採用により、起票検討段階のローカル issue ドラフト（`docs/maintainer/workflow/**` 配下の 00〜04）は非追跡化され、完了時も `close/` 移動を行わず GitHub Issue の close で完結する。そのため、非追跡ドラフトが破棄されても失われてはならない**恒久的な設計判断**を、追跡ファイルである本ファイルへ集約する（2026-07-15 の worktree 削除で 02/03 が失われた事故の再発防止も兼ねる）。

- **記録形式の正本**: ADR 最小集合の定義は [.agent-skill-chain/source/EVIDENCE_POLICY.md §節2](../../../.agent-skill-chain/source/EVIDENCE_POLICY.md) を正本とする（本ファイルは同形式を適用するのみで再定義しない）。
- **evidence_source の分類定義**: [.agent-skill-chain/source/CONCEPTS.md §外部根拠の必須化](../../../.agent-skill-chain/source/CONCEPTS.md#外部根拠の必須化external-anchor) を正本とする。
- **本リポ運用手順との関係**: 本ファイルへの記録タイミング・両モード運用は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../../.agent-skill-chain/project/自己拡張ワークフロー.md) が正本。

---

## 記録手順（いつ・何を・誰が追記するか）

- **いつ**: 各 issue の完了フェーズ（verify-and-close／04_review 作成時）に、その issue で確定した**恒久的な設計判断**を本ファイルへ転記する。実装途中に判明した重要判断も、遅くとも完了フェーズまでに追記する。
- **何を**: 採否がその issue の成果物の構造・実現可能性・後続フェーズを左右する**重要判断**（[EVIDENCE_POLICY.md §節3](../../../.agent-skill-chain/source/EVIDENCE_POLICY.md)）を、下記「ADR 記録フォーマット」の ADR 最小集合 5 要素で記録する。誤字修正・表現整理等の軽量 issue は対象外（記録不要）。
- **誰が**: 当該 issue の実装・レビューを担当したエージェント（またはその成果を確認した進行役・保守者）。非追跡ドラフトの内容に依存せず、本ファイル単体で判断の背景が辿れるよう自己完結的に記述する。
- **どこへ**: 本ファイル末尾の「## ADR 記録」節へ、新しい ADR を**追記**する（既存エントリは改変しない。決定が覆った場合は新規 ADR として「〜を上書きする」旨を記録し、旧エントリは履歴として残す）。
- **トークン・機密の非混入**: 認証トークンの実値・機密情報を本ファイルへ残さない。

---

## ADR 記録フォーマット（ADR 最小集合 5 要素）

各 ADR は次の 5 見出しで記録する（正本: [EVIDENCE_POLICY.md §節2](../../../.agent-skill-chain/source/EVIDENCE_POLICY.md)）。

```markdown
### ADR-<連番>: <決定の要約タイトル>（<日付 YYYY-MM-DD>・issue: <参照>）

- **コンテキスト**: なぜこの判断が必要か。
- **検討した選択肢**: 比較した候補（2 案以上が望ましい）。
- **決定**: 採用した選択肢。
- **根拠**: 決定に至った理由（**evidence_source 付き**。例: `[evidence_source: observed_runtime]`）。
- **帰結**: この決定によって何が確定し、何に影響するか。
```

---

## ADR 記録

<!--
本節へ各 issue の恒久 ADR を追記する。S-2（本リポ github_native 採用）自身の ADR-S2-1〜S2-7 は、
verify-and-close（04_review）フェーズで本節へ転記する（02_設計 ADR-S2-5 の帰結）。
-->
