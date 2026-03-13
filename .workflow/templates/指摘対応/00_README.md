---
# document_id: 必須。作成時または major 更新時に UUID を付与すること。既存の場合は変更しない。
document_id: { uuid }
---

# 指摘対応: PR #{PR_NUMBER} {REVIEW_SOURCE}

**PR**: [#{PR_NUMBER} {PR_TITLE}]({PR_URL})  
**取得元**: {REVIEW_SOURCE}（例: GitHub PR review comments / CodeRabbit / Copilot）  
**取得日時**: {FETCHED_AT}  
**スレッド数**: {TOTAL_THREADS}（未解決 {UNRESOLVED_THREADS} / 解決 {RESOLVED_THREADS}）

---

## 本ディレクトリの目的

- PR の指摘（レビューコメント）を一覧化し、対応方針を記録する。
- 指摘が誤りや過剰な場合もあるため、まず指摘をすべて確認したうえで採用・見送りを決める。

---

## ドキュメント構成

| ファイル                            | 内容                                           |
| ----------------------------------- | ---------------------------------------------- |
| [01\_指摘一覧.md](./01_指摘一覧.md) | 全指摘（ファイル・行・本文・スレッド ID）      |
| [02\_対応方針.md](./02_対応方針.md) | 各指摘への対応方針（採用/見送り/要検討と理由） |

---

## 次のステップ

1. [01\_指摘一覧.md](./01_指摘一覧.md) で指摘内容を確認する。
2. [02\_対応方針.md](./02_対応方針.md) で各指摘の採用/見送りを決め、対応作業に進む。

---

## プレースホルダー置換一覧（汎用）

本テンプレートは**汎用版**です。任意のプロジェクトの issue 直下に `指摘対応/` を作成する際にコピーし、以下をプロジェクト・PR に合わせて置換してください。

| プレースホルダー     | 置換例（参考）                                      | 取得元                                |
| -------------------- | --------------------------------------------------- | ------------------------------------- |
| {PR_NUMBER}          | 1                                                   | PR 番号（99_PR.md または GitHub API） |
| {PR_TITLE}           | 例: 機能追加                                        | PR タイトル                           |
| {PR_URL}             | https://github.com/owner/repo/pull/1                | PR の URL                             |
| {REVIEW_SOURCE}      | GitHub PR review（author: 使用するツールの bot 名） | 指摘の出所（CodeRabbit / Copilot 等） |
| {FETCHED_AT}         | YYYY-MM-DD（取得元ファイル名）                      | 取得日時                              |
| {TOTAL_THREADS}      | 0                                                   | 総スレッド数                          |
| {UNRESOLVED_THREADS} | 0                                                   | 未解決スレッド数                      |
| {RESOLVED_THREADS}   | 0                                                   | 解決済みスレッド数                    |
