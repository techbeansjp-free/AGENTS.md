---
document_id: "19c54033-bc28-40b2-ba8a-82cbd77ab968"
---

# F05: マルチプラットフォーム生成

`.agent-skill-chain/source/`（単一正本）から、各 AI プラットフォーム向けの成果物を生成する仕組み。正本は [build-adapters.sh](../../../.agent-skill-chain/source/scripts/build-adapters.sh) と [platforms/README.md](../../../.agent-skill-chain/source/platforms/README.md)。本ドキュメントは俯瞰に留める。

## F05.1 概要

- **単一正本 → 多形態生成**: 契約・skill chain・enforcement を `.agent-skill-chain/source/` に一元化し、`build-adapters.sh` が各プラットフォーム形式へ変換・配備する。強制力はプラットフォームごとに異なり、最終保証は CI audit が担う（[enforcement](../enforcement/README.md)）。
- **対象プラットフォーム**: [platforms/](../../../.agent-skill-chain/source/platforms/) 配下に `claude`・`apm` の定義がある。Cursor 向けは setup が `.cursor/` を生成する。

## F05.2 生成物と配備先

| 生成元（正本） | 生成物 | git |
| -------------- | ------ | --- |
| `platforms/claude/` | `.claude/`（settings・hooks・plugin 等） | 無視（生成物） |
| `platforms/apm/` | apm 形式成果物（`.adapters/` 等） | 無視（生成物） |
| `.agent-skill-chain/source/` | `.cursor/`（Cursor 向け） | 無視（生成物） |

生成物は `.gitignore` 対象であり、正本と混同しない（配布物汚染の防止）。

## F05.3 version 同期

各プラットフォーム側の version は `sync-version.sh` により `package.json` と同期する（`--write`/`--check`）。apm 形式の 3 者 version 同期は `test/test-sync-version-apm.sh` で回帰検証される。

## F05.4 設計方針

- **決定性**: `build-adapters.sh` は決定的（同一入力→同一出力）に生成し、`.adapters/` を非改変で扱う（回帰検証: `test/test-build-adapters-apm.sh`）。
- **除外規則**: 生成対象から除外すべきパスは build スクリプトと gitignore で規定する。

---

## 参考資料

- [.agent-skill-chain/source/platforms/README.md](../../../.agent-skill-chain/source/platforms/README.md) — プラットフォーム定義の正本
- [.agent-skill-chain/source/scripts/build-adapters.sh](../../../.agent-skill-chain/source/scripts/build-adapters.sh) — 生成の正本
- [04 機能設計/CI_リリースパイプライン](../CI_リリースパイプライン/README.md) — apm-release ジョブ
- [04 機能設計/スクリプト群](../スクリプト群/README.md) — sync-version.sh・build-adapters.sh

---

**最終更新**: 2026 年 07 月 13 日
