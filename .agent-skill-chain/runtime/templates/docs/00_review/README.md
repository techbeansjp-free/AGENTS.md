---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "00000000-0000-0000-0000-000000000000"
---

このドキュメントは、システム仕様書（`docs/`）のレビュー記録の**索引**です。個々のレビュー記録は `docs/00_review/YYYYMMDD_HHMMSS_review.md`（テンプレートは [YYYYMMDD_HHMMSS_review.md](./YYYYMMDD_HHMMSS_review.md)）として作成し、本 README にも 1 行追記してください。

# 0. レビュー記録索引

システム仕様書の作成・更新は基本的に issue を立てず、本ディレクトリにレビュー結果を記載すれば完結します（[`.agent-skill-chain/source/DOCS_RULES.md`](../../../../../.agent-skill-chain/source/DOCS_RULES.md) 参照）。継続追随ゲート（実装変更を伴う issue の close 前のレビュー反復）の記録もここに蓄積します。

## レビュー記録一覧

| 日時 | 対象 | 指摘 N→0 | 対応 issue / 版番号 |
| ---- | ---- | -------- | -------------------- |
| YYYYMMDD_HHMMSS | {対象ドキュメント・実装範囲} | {N→0 または 更新不要判定} | {対応 issue パス または docs/README.md 版番号} |

- **日時**: レビュー記録ファイル名の `YYYYMMDD_HHMMSS` プレフィックス。
- **対象**: 照合した実装・レビューしたシステム仕様書のセクション。
- **指摘 N→0**: レビュー反復の指摘件数推移。更新不要判定（軽量パス）の場合はその旨を記載。
- **対応 issue / 版番号**: 実装側の issue パス、または `docs/README.md` 更新履歴の版番号。

---

## 参考資料

- [docs/README.md](../README.md) §更新履歴 — 版番号・変更内容とレビュー記録の相互リンク先
- [.agent-skill-chain/source/DOCS_RULES.md](../../../../../.agent-skill-chain/source/DOCS_RULES.md) §継続追随ゲート

---

**最終更新**: YYYY 年 MM 月 DD 日
