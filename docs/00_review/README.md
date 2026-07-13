---
document_id: "da1d1ce0-c4c5-4566-9487-4a7e46858466"
---

このドキュメントは、システム仕様書（`docs/`）のレビュー記録の**索引**です。個々のレビュー記録は `docs/00_review/YYYYMMDD_HHMMSS_review.md` として作成し、本 README にも 1 行追記してください。

# 0. レビュー記録索引

システム仕様書の作成・更新は基本的に issue を立てず、本ディレクトリにレビュー結果を記載すれば完結します（[`.agent-skill-chain/source/DOCS_RULES.md`](../../.agent-skill-chain/source/DOCS_RULES.md) 参照）。継続追随ゲート（実装変更を伴う issue の close 前のレビュー反復）の記録もここに蓄積します。

## 記録方針

- **継続追随ゲートの発動**: `docs/` を正式採用した本リポジトリでは、以後の**実装変更を伴う issue** の close 時に [`DOCS_RULES.md` §継続追随ゲート](../../.agent-skill-chain/source/DOCS_RULES.md) が発動する。該当セクションと実装を as-built 同期観点で照合し、指摘 0 件まで反復した結果を `docs/00_review/YYYYMMDD_HHMMSS_review.md` に記録する。これにより audit の #31（システム仕様書レビュー証跡欠落）・#32（実装前 review-docs 未実行）の「`docs/` 非採用による SKIP」から外れる。
- **軽量パス**: 実装変更がシステム仕様書の記載範囲に影響しない場合は、根拠付きの「更新不要」判定 1 件で通過してよい（規模比例。[`DOCS_RULES.md` §継続追随ゲート](../../.agent-skill-chain/source/DOCS_RULES.md)）。
- **非遡及運用**: `docs/` 採用**以前**に close 済みの issue（`docs/maintainer/workflow/close/` 配下）には遡及的な仕様書同期を求めない。ゲートの実発動は採用以後の実装変更 issue にのみ適用する（audit.sh #32 の grandfather 方針と同型）。

## レビュー記録一覧

| 日時 | 対象 | 指摘 N→0 | 対応 issue / 版番号 |
| ---- | ---- | -------- | -------------------- |
| （採用以後の実装変更 issue で追記） | — | — | — |

- **日時**: レビュー記録ファイル名の `YYYYMMDD_HHMMSS` プレフィックス。
- **対象**: 照合した実装・レビューしたシステム仕様書のセクション。
- **指摘 N→0**: レビュー反復の指摘件数推移。更新不要判定（軽量パス）の場合はその旨。
- **対応 issue / 版番号**: 実装側の issue パス、または [`docs/README.md`](../README.md) 更新履歴の版番号。

---

## 参考資料

- [docs/README.md](../README.md) §更新履歴 — 版番号・変更内容とレビュー記録の相互リンク先
- [.agent-skill-chain/source/DOCS_RULES.md](../../.agent-skill-chain/source/DOCS_RULES.md) §継続追随ゲート

---

**最終更新**: 2026 年 07 月 13 日
