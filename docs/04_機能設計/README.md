---
document_id: "d15b6983-b0c3-4cd0-95e6-96d8f1d5409c"
---

このドキュメントは、本リポジトリの機能（構成要素）を俯瞰します。各機能の詳細仕様は正本へリンクします（DRY）。

# 4. 機能設計

機能設計は、構成要素（機能単位）別にディレクトリを分割する。各ディレクトリの `README.md` にその機能の俯瞰と正本リンクを置く。

## ドキュメント一覧（機能単位）

| ID | 機能 | 内容 | 正本 |
| -- | ---- | ---- | ---- |
| F01 | [CLI](./CLI/README.md) | `agents-md` コマンド体系（配備・診断・監査・強制着脱） | `src/agents-md.ts` |
| F02 | [スクリプト群](./スクリプト群/README.md) | 配備・生成・証跡記録・リリース補助の bash 群 | `.agent-skill-chain/source/scripts/` |
| F03 | [enforcement](./enforcement/README.md) | 4 層強制・audit.sh 監査項目群 | `.agent-skill-chain/source/enforcement/` |
| F04 | [CI_リリースパイプライン](./CI_リリースパイプライン/README.md) | `release.yml`・`self-enforce.yml` | `.github/workflows/` |
| F05 | [マルチプラットフォーム生成](./マルチプラットフォーム生成/README.md) | `build-adapters.sh`・`platforms/`（claude・apm） | `.agent-skill-chain/source/platforms/` |

証跡 DB（`workflow.db`）のデータモデルは機能ではなくデータ設計として [03 データ設計](../03_データ設計/README.md) に置く。

---

## 参考資料

- [01 システム概要](../01_システム概要/README.md)
- [03 データ設計](../03_データ設計/README.md)
- [05 エラー処理と外部通知](../05_エラー処理と外部通知/README.md)
- [99 ID命名規則と管理](../99_ID命名規則と管理/README.md) — 機能フロー ID（F01〜）の台帳

---

**最終更新**: 2026 年 07 月 13 日
