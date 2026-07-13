---
document_id: "cc42f9d7-db73-4fb4-9710-f4e3fb2c64f5"
---

# F02: スクリプト群

配備・生成・証跡記録・リリース補助を担う bash スクリプト群。正本は [.agent-skill-chain/source/scripts/](../../../.agent-skill-chain/source/scripts/) 配下の各スクリプトおよび [SETUP.md](../../../.agent-skill-chain/source/SETUP.md)。各スクリプト冒頭のコメントが個別の正本であり、本ドキュメントは役割の俯瞰に留める。

## F02.1 スクリプト一覧

| スクリプト | 役割 |
| ---------- | ---- |
| `setup.sh` | 採用先へ正本を配備し、各ツール向け生成・`workflow.db` 初期化を行う（CLI `init`/`upgrade` の実体） |
| `build-adapters.sh` | `platforms/` 定義からマルチプラットフォーム成果物（claude・apm）を生成 |
| `build-plugin-claude.sh` | Claude プラグイン形式のビルド（`npm run build:claude`） |
| `sync-version.sh` | `package.json` とプラットフォーム側 version の同期（`--write`/`--check`） |
| `write-workflow-log.sh` | 書記専用の `workflow.db` INSERT ラッパー（1 回 1 行・任意 SQL 禁止） |
| `export-ndjson.sh` | `workflow.db` を NDJSON で書き出す（read-only。CLI `export` の実体） |
| `gen-entry-hash.sh` | `entry_hash` 計算の共有関数（改ざん検知の単一正本） |
| `verify-npm-pack.sh` | `npm pack` 成果物に非配布物が混入しないことを検証 |
| `memo-prefix.sh` / `new-workflow-memo.sh` | memo プレフィックス（JST）取得・memo 作成補助 |
| `create-pr-review-issue-dir.sh` | PR 指摘対応サブ issue ディレクトリの作成補助 |
| `lib/` | 上記から共用されるヘルパ群 |

## F02.2 設計方針

- **単一責務**: 各スクリプトは 1 つの役割に限定し、共通ロジックは `lib/` と共有関数（`gen-entry-hash.sh`）へ集約する（再実装禁止・単一正本）。
- **証跡書込の一本化**: `workflow.db` への書込は `write-workflow-log.sh` 経由のみ許可し、`AGENT_ROLE=scribe` を要求する（詳細は [03 データ設計](../../03_データ設計/README.md)・[enforcement](../enforcement/README.md)）。
- **非破壊・tmp 隔離**: install/uninstall/build 等の検証は一時ディレクトリで行い、本番資産を破壊しない（正本: [自己拡張ワークフロー.md §テストの tmp 隔離](../../../.agent-skill-chain/project/自己拡張ワークフロー.md)）。

## F02.3 入出力

- **入力**: 対象ディレクトリ・環境変数（`AGENT_ROLE`・`ENTRY_ID`・`DOCUMENT_ID` 等）・位置引数。
- **出力**: 配備/生成成果物、`workflow.db` への 1 レコード、NDJSON、検証結果の終了コード。

---

## 参考資料

- [.agent-skill-chain/source/SETUP.md](../../../.agent-skill-chain/source/SETUP.md) — 配備手順の正本
- [03 データ設計](../../03_データ設計/README.md) — write-workflow-log.sh が書く `workflow_log`
- [04 機能設計/マルチプラットフォーム生成](../マルチプラットフォーム生成/README.md) — build-adapters.sh の詳細

---

**最終更新**: 2026 年 07 月 13 日
