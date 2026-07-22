---
document_id: "a9f7c553-e11d-4cbf-a2f2-f3cac9296931"
---

このドキュメントは、本リポジトリ自身のソフトウェア構成を定義するシステム仕様書です。
システム仕様書作成ルールは [`.agent-skill-chain/source/DOCS_RULES.md`](../.agent-skill-chain/source/DOCS_RULES.md) を参照してください。

> **本仕様書の対象と方針**: 本リポジトリは「AI 実行契約・ワークフロー仕様パッケージ」を配布しつつ自リポにも適用する二役を担う。本 `docs/` は**本リポジトリをソフトウェアとして俯瞰**するための仕様書であり、フレームワーク定義そのもの（`.agent-skill-chain/source/`）は再文書化せず、**要約＋正本への参照**で接続する（DRY・[`DOCS_NOISE_RULES.md`](../.agent-skill-chain/source/DOCS_NOISE_RULES.md)）。既存の [`AI_CI_CD_VISION.md`](./AI_CI_CD_VISION.md)・[`maintainer/`](./maintainer/) はそのまま維持する。

# システム仕様書

## ドキュメント構成

1. **[システム概要](./01_システム概要/README.md)** — 全体像・構成・ステークホルダー・ディレクトリ・規約
2. **[画面設計](./02_画面設計/README.md)** — 該当なし（CLI/非 GUI。根拠を明記）
3. **[データ設計](./03_データ設計/README.md)** — 証跡 DB（`workflow.db` / `workflow_log`）のデータモデル俯瞰
4. **[機能設計](./04_機能設計/README.md)** — CLI・スクリプト群・enforcement・CI・マルチプラットフォーム生成の機能俯瞰
5. **[エラー処理と外部通知](./05_エラー処理と外部通知/README.md)** — CLI/スクリプト/CI の失敗時挙動の方針
6. **[ID命名規則と管理](./99_ID命名規則と管理/README.md)** — 本仕様書群で使用する ID の一元台帳

また、以下も本システム仕様書に含まれます。

- **[00_review](./00_review/README.md)** — システム仕様書のレビュー記録索引（継続追随ゲートの記録先）。

## ドキュメントの読み方

### 対象読者

- **保守者**: 本リポジトリの自己拡張（ドッグフーディング）を行う開発者。
- **監査者**: 構成要素（CLI・スクリプト群・enforcement・DB・CI）の全体像を確認する。
- **新規参加者**: 本リポジトリをソフトウェアとして初見で理解する。

### 記述ルール

- 詳細は正本へ委譲し、本仕様書は俯瞰＋リンクに徹する（正本重複を作らない）。
- ドキュメント間参照は `§節名`・`#見出しアンカー` の安定参照を用い、行番号直リンク（`<file>.md:NNN`）を使用しない（[`DOCS_RULES.md` §行番号直リンク禁止](../.agent-skill-chain/source/DOCS_RULES.md)）。

### 更新履歴

更新履歴の各行は、可能な限り対応するレビュー記録（[00_review/](./00_review/README.md) 配下の `YYYYMMDD_HHMMSS_review.md`）へリンクしてください。継続追随ゲート（[`DOCS_RULES.md` §継続追随ゲート](../.agent-skill-chain/source/DOCS_RULES.md)）に従い、実装変更を伴う更新は版番号・変更内容・レビュー記録の 3 点を相互参照できる状態を保ちます。

| 日付       | バージョン | 更新内容 | 更新者 | 対応レビュー記録 |
| ---------- | ---------- | -------- | ------ | ----------------- |
| 2026-07-13 | 1.0.0      | 初版作成（本リポジトリのソフトウェア構成の俯瞰仕様書を新設） | - | - |

---

## 参考資料

- [.agent-skill-chain/source/README.md](../.agent-skill-chain/source/README.md) — フレームワーク定義の正本入口
- [.agent-skill-chain/project/自己拡張ワークフロー.md](../.agent-skill-chain/project/自己拡張ワークフロー.md) — 名前空間の役割分担（配布物・非配布・生成物）

---

**最終更新**: 2026 年 07 月 13 日
