---
document_id: "7d229f78-7720-4ab8-8345-790232a225bd"
---

# 5. 規約

本リポジトリのコーディング規約・実行契約規約・文書化規約は、すべて `.agent-skill-chain/source/` 配下に正本がある。本ドキュメントは**索引**であり、内容を複製せず正本へリンクする（DRY）。

## 5.1 規約索引

| 分類 | 正本 | 内容 |
| ---- | ---- | ---- |
| 実行契約 | [boot/CORE.md](../../../.agent-skill-chain/source/boot/CORE.md)・[boot/LOAD_POLICY.md](../../../.agent-skill-chain/source/boot/LOAD_POLICY.md) | 読込順・デフォルト起動・境界・証跡省略禁止 |
| ワークフロー規約 | [RULES.md](../../../.agent-skill-chain/source/RULES.md)・[workflow/PHASES.md](../../../.agent-skill-chain/source/workflow/PHASES.md) | phase・成果物・テスト戦略必須要件・レビュー配置 |
| command / skill | [commands/](../../../.agent-skill-chain/source/commands/)・[skills/agent/run_command.md](../../../.agent-skill-chain/source/skills/agent/run_command.md) | skill chain 定義・委譲 I/F |
| 設計原則 | [spec/01_設計原則.md](../../../.agent-skill-chain/source/spec/01_設計原則.md)・[spec/02_ディレクトリ構造方針.md](../../../.agent-skill-chain/source/spec/02_ディレクトリ構造方針.md) | UNIX 哲学・単一責務・明確な境界・AI フレンドリー設計 |
| 文書化（docs） | [DOCS_RULES.md](../../../.agent-skill-chain/source/DOCS_RULES.md)・[DOCS_NOISE_RULES.md](../../../.agent-skill-chain/source/DOCS_NOISE_RULES.md) | システム仕様書ルール・継続追随ゲート・ノイズ排除 4 種 |
| コードコメント | [CODE_COMMENT_RULES.md](../../../.agent-skill-chain/source/CODE_COMMENT_RULES.md) | コメント/docstring からの外部参照禁止 |
| 根拠・ADR | [EVIDENCE_POLICY.md](../../../.agent-skill-chain/source/EVIDENCE_POLICY.md) | 重要判断の ADR 形式・evidence_source |
| 本リポ固有（最優先） | [.agent-skill-chain/project/自己拡張ワークフロー.md](../../../.agent-skill-chain/project/自己拡張ワークフロー.md) | 名前空間・issue/memo 配置・close 移動・テスト隔離 |

## 5.2 適用の優先順位

本リポジトリでは `.agent-skill-chain/project/` が `.agent-skill-chain/source/` および `CLAUDE.md` の標準フローより**優先**される（同名・同目的は project 側を採用）。正本は [.agent-skill-chain/project/README.md](../../../.agent-skill-chain/project/README.md) §優先順位。

---

## 参考資料

- [01 プロジェクト概要](../01_プロジェクト概要/README.md)
- [04 ディレクトリ構成](../04_ディレクトリ構成/README.md)

---

**最終更新**: 2026 年 07 月 13 日
