---
document_id: "e6331775-095f-4c5c-8dbf-3564e1165afb"
---

# 1. プロジェクト概要

## 1.1 プロジェクト名

**AGENTS.md（配布パッケージ名: `agents-md`）** — AI 実行契約・ワークフロー仕様パッケージ。

## 1.2 目的

AI エージェント（Claude Code / Cursor 等）に対し、逸脱できない実行契約（phase 判定・command による skill chain 実行・サブ委譲・書記による証跡記録）を配布し、採用先プロジェクトへ配備する。あわせて本リポジトリ自身にも同じ仕組みを適用する（自己拡張＝ドッグフーディング）。

## 1.3 二役（配布者かつ自己拡張する消費者）

本リポジトリは 2 つの役割を兼ねる。両者は git の扱いが逆になるため、名前空間を分離している（正本: [.agent-skill-chain/project/自己拡張ワークフロー.md](../../../.agent-skill-chain/project/自己拡張ワークフロー.md)）。

| 役割 | 内容 |
| ---- | ---- |
| 配布者 | `.agent-skill-chain/source/` を正本とし、npm パッケージ `agents-md` として配布する。 |
| 自己拡張する消費者 | 自リポの開発を `docs/maintainer/workflow/` の issue ワークフローで進め、証跡を `workflow.db` に残す。 |

## 1.4 スコープ

本システム仕様書が俯瞰する**ソフトウェア構成要素**は次の 5 系統である（各詳細は [04 機能設計](../../04_機能設計/README.md)・[03 データ設計](../../03_データ設計/README.md) を参照）。

| 構成要素 | 実体 | 正本（詳細） |
| -------- | ---- | ------------ |
| CLI | `src/agents-md.ts`（配布 bin `agents-md`） | [04 機能設計/CLI](../../04_機能設計/CLI/README.md) |
| スクリプト群 | `.agent-skill-chain/source/scripts/` | [04 機能設計/スクリプト群](../../04_機能設計/スクリプト群/README.md) |
| enforcement 機構 | `.agent-skill-chain/source/enforcement/` | [04 機能設計/enforcement](../../04_機能設計/enforcement/README.md) |
| 証跡 DB（ledger） | `workflow.db`（`workflow_log`） | [03 データ設計](../../03_データ設計/README.md) |
| CI/マルチプラットフォーム生成 | `.github/workflows/`・`build-adapters.sh`・`platforms/` | [04 機能設計/CI_リリースパイプライン](../../04_機能設計/CI_リリースパイプライン/README.md)・[マルチプラットフォーム生成](../../04_機能設計/マルチプラットフォーム生成/README.md) |

## 1.5 成果物（配布形態）

- **npm パッケージ `agents-md`**: `package.json` の `files` allowlist が配布対象を規定する（`.agent-skill-chain/source/`・`AGENTS.md`・`CLAUDE.md`・`.agent-skill-chain/runtime/templates/`・`bin/`・`README.md`）。
- **非配布（保守者向け）**: `test/`・`docs/`（本仕様書群を含む）は allowlist 外であり配布されない。

## 1.6 スコープ外

- フレームワーク定義そのもの（`.agent-skill-chain/source/` 配下の各 README/DESIGN/spec）の再文書化。正本参照に留める。
- 抽象仕様のみで未実装の enforcement 機構（系統 A/C/E 等）の実装。

---

## 参考資料

- [02 ステークホルダー](../02_ステークホルダー/README.md)
- [03 アーキテクチャ](../03_アーキテクチャ/README.md)
- [README.md](../../../README.md) — 利用者向け概要（CLI の使い方等）の正本

---

**最終更新**: 2026 年 07 月 13 日
