---
document_id: "191d3db6-7d20-4667-b639-c3cb0dc737a4"
---

# 2. ステークホルダー

本リポジトリに関わる役割と、その読み方（どのドキュメントから読むか）を定義する。

## 2.1 役割一覧

| 役割 | 説明 | 主な関心 |
| ---- | ---- | -------- |
| 保守者（進行役 / orchestrator） | 本リポジトリの自己拡張を進める開発者。phase 判定・command 選択・サブ委譲を行う。 | ワークフロー・enforcement・証跡 |
| サブエージェント（worker / scribe） | 委譲を受けて実作業（設計・実装・レビュー）を行う worker、および `workflow.db` へ記録する書記（scribe）。 | command の DoD・証跡記録 |
| 消費者プロジェクト | `agents-md` を採用し配備する外部プロジェクト。 | CLI・配備成果物・テンプレート |
| 監査者 | 証跡・順序・品質を確認する。 | audit.sh・workflow.db・doctor |
| CI（GitHub Actions） | リリース自動化と自己強制を実行する非人間アクター。 | release.yml・self-enforce.yml |

## 2.2 役割別の読み方

| 役割 | 最初に読むドキュメント |
| ---- | ---------------------- |
| 保守者 | [04 機能設計](../../04_機能設計/README.md)（CLI・enforcement）→ [.agent-skill-chain/source/README.md](../../../.agent-skill-chain/source/README.md) |
| 消費者プロジェクト | [04 機能設計/CLI](../../04_機能設計/CLI/README.md) → [README.md](../../../README.md) |
| 監査者 | [04 機能設計/enforcement](../../04_機能設計/enforcement/README.md) → [03 データ設計](../../03_データ設計/README.md) |
| 新規参加者 | [01 プロジェクト概要](../01_プロジェクト概要/README.md) → 本ドキュメント → [03 アーキテクチャ](../03_アーキテクチャ/README.md) |

## 2.3 実行契約上の役割分担（正本参照）

進行役（orchestrator）・worker・scribe の権限境界・委譲義務の正本は [.agent-skill-chain/source/boot/CORE.md](../../../.agent-skill-chain/source/boot/CORE.md) および [.agent-skill-chain/source/skills/agent/run_command.md](../../../.agent-skill-chain/source/skills/agent/run_command.md) にある。本仕様書では再定義しない。

---

## 参考資料

- [01 プロジェクト概要](../01_プロジェクト概要/README.md)
- [03 アーキテクチャ](../03_アーキテクチャ/README.md)

---

**最終更新**: 2026 年 07 月 13 日
