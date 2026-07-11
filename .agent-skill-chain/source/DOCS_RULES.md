# DOCS_RULES — システム仕様書の作成・更新ルール

プロジェクトで**システム仕様書**（`docs/`）を運用するときのルール。AI と人が守る。

---

## 基本方針：issue を立てない

**システム仕様書の作成および更新は、基本的に issue を立てる必要はない。**

理由: システム仕様書直下に**レビュー用ディレクトリ**（`docs/00_review/`）があり、そこにレビュー結果を記載すればよい。変更内容・整合性確認・更新履歴は `docs/00_review/` に記録する。

---

## レビュー用ディレクトリ

| 場所 | 役割 |
|------|------|
| **docs/00_review/** | システム仕様書のレビュー結果を格納する。ここに記載すれば issue を立てずに仕様書の更新・整合性確認が完結する。 |
| **docs/00_review/YYYYMMDD_HHMMSS_review.md** | 1 回のレビュー結果。テンプレートは `.agent-skill-chain/runtime/templates/docs/00_review/YYYYMMDD_HHMMSS_review.md` を参照。 |

- 仕様書を更新したら、必要に応じて `docs/00_review/` にレビュー結果（実装との整合性・更新内容）を追記する。
- issue 完了時に「システム仕様書の更新が必要か」を確認するが、**その更新作業のために新規 issue を立てる必要はない**。`docs/00_review/` に記載する。

---

## Issue 完了時のシステム仕様書更新チェック

レビューフェーズ（verify-and-close）完了時に、次を実施する。

1. **更新要否の確認**: 実装内容に応じて、システム仕様書（`docs/`）の更新が必要か判定する。
2. **必要な場合**: 該当セクション（01_システム概要、02_画面設計、03_データ設計、04_機能設計 等）を加筆修正する。**新規 issue は立てない。**
3. **記録**: 更新内容・整合性確認結果を **docs/00_review/** に記録する（例: `docs/00_review/YYYYMMDD_HHMMSS_review.md`）。04_review.md の「9. システム仕様書の更新」セクションにも要約を書く。
4. **更新履歴**: `docs/README.md` の「更新履歴」に日付・バージョン・更新内容を追記する。

---

## ドキュメント間参照：行番号直リンク禁止

- コア／command／spec のドキュメント間参照では `<file>.md:NNN` の**行番号直リンクを新規使用しない**。行挿入・削除で容易に陳腐化し、読み手を誤った正本へ誘導するためである。原則・規約を指すときは `§<節名>` または `#<見出しアンカー>` の**安定参照**を用いる（コードコメントの参照規約は責務が異なるため [CODE_COMMENT_RULES.md](CODE_COMMENT_RULES.md) を参照。本規約はドキュメント間参照に限る）。

---

## 参照

| 参照先 | 内容 |
|--------|------|
| .agent-skill-chain/source/RULES.md | 実行契約・証跡のルール |
| .agent-skill-chain/source/boot/CORE.md | 読了義務・証跡省略禁止 |
| .agent-skill-chain/source/commands/verify-and-close.md | 検証・クローズ command |
| .agent-skill-chain/runtime/templates/04_review.md | 04_review（§11 システム仕様書の更新） |
| .agent-skill-chain/runtime/templates/docs/00_review/YYYYMMDD_HHMMSS_review.md | レビュー結果テンプレート |
