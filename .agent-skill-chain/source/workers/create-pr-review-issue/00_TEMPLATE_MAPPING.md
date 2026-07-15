# 00_要求定義.md 生成 — PrReviewIssueDefinition とテンプレートのマッピング

`create-pr-review-issue` の**トリアージ記録用 00_要求定義.md**（PR レビューバッチにつき 1 つ生成）は、**workflow/TEMPLATES.md の 00_要求定義** の必須セクションを満たしつつ、以下のセクションを **必ず** 含める。PrReviewIssueDefinition のフィールドを次のようにマッピングする。

> **記録面の所在（単一記録面）**: この 00 は、当該 PR レビューバッチの**全指摘の disposition・根拠・一括承認記録を保持する単一の記録面**である。**disposition=起票 の指摘についてのみ**、追加で既存起票フローの成果物（追跡用 sub issue の `90_issues/{ディレクトリ名}/`）を持つ。即時対応・見送りの指摘は追加成果物を持たず、本 00 への disposition 記録のみで処置が完結する。**起票が 0 件（全指摘が即時対応／見送り）でも、監査可能性のため本 00 は必ず生成する**（新たな記録面を増やさず 00 に一本化する）。
>
> データ形式（`Disposition`・`TriageRow`・起票条件チェックリスト C1〜C5・`security_flag`・`defer_reason`）の正本は [OUTPUT_FORMAT.md](./OUTPUT_FORMAT.md)。本ファイルは**その値を 00 のどこへ記録するか**のマッピングのみを定義し、データ形式を再定義しない。

---

## frontmatter

- **document_id**: 新規作成時に UUID を 1 回発行して付与。
- **issue_id**: 新規作成時に UUID を 1 回発行して付与（当該トリアージ記録の一意識別子）。

---

## 見出しとマッピング

| 見出し（必須） | PrReviewIssueDefinition の対応 | 記載内容 |
|----------------|--------------------------------|----------|
| **# 要求定義書: {タイトル}** | title | 例: PR#4 指摘対応（トリアージ記録） |
| **## 1. 目的・背景** | — | 「本 issue は PR 指摘対応のトリアージ記録である」ことを明示。PR URL（pr_url）と親 issue へのリンク（parent_issue_links）を記載。 |
| **## 2. 指摘一覧** | findings, `TriageRow[]` | `ReviewFinding[]` を表形式で展開。各行に id / file / location / summary に加え、**disposition（確定値: 即時対応／起票／見送り）／根拠（rationale）／起票条件該当（matched_criteria = 該当した C1〜C5）／security（`security_flag`）** の列を含める。raw は要約の下に折りたたみまたは注記で参照可能に。**全指摘に disposition が漏れなく付与されていること**（DoD）。 |
| **## 3. 各指摘の対応方針（案 → 確定）** | strategies, disposition | finding.id をキーに対応方針を記載。承認前は disposition 提案（案）、進行役の承認後は**確定 disposition**を反映する。見送りは `defer_reason` を必須記載。定義の正本は [OUTPUT_FORMAT.md](./OUTPUT_FORMAT.md)。 |
| **## 4. 進行役の一括承認ブロック** | ApprovalBlock | **承認者＝進行役／承認日時／承認方式（一括 or 個別修正の別）／個別修正した finding.id 一覧／`security_flag`・C5 該当で個別承認した finding.id 一覧**を記録する。`security_flag=true`・C5 該当は一括承認に埋没させず個別承認する旨も明記（[OUTPUT_FORMAT.md §4.4](./OUTPUT_FORMAT.md) 参照）。 |
| **## 5. 受け入れ基準** | — | 「全指摘に disposition（即時対応／起票／見送り）が漏れなく付与されている」「見送りは理由（`defer_reason`）が必須記録されている」「セキュリティ指摘は軽微でも記録・監査されている」を含める。指摘が 0 件の場合は「指摘一覧が 1 件以上埋まっていること」を追加。 |
| **## 6. 参照元** | pr_url, parent_issue_links | PR URL、親 issue・親 03_実装計画などへのリンク。 |
| **## 7. 次のステップ** | — | 承認済み disposition に基づく対応実施（即時対応＝委譲実行／起票＝既存起票フロー／見送り＝理由記録）を記載。起票対象がある場合は当該サブ issue の 01→02→03 への流れを記載。 |

---

## 記録の一本化（新たな記録面を増やさない）

- 全指摘の disposition・根拠・一括承認記録は、上記の **00_要求定義（指摘一覧・対応方針・承認ブロック）へ一本化**する。別ファイル（例: 対応方針を別の 02 等）へ分散記録しない。
- disposition=起票 の指摘の追跡用 sub issue（`90_issues/{ディレクトリ名}/`）は、本 00 の一本化記録に**加えて**持つ追加成果物であり、記録面の分裂ではない（起票した指摘の下流追跡のためのもの）。

---

## 参照するテンプレート

- **00_要求定義の汎用テンプレート**: `.agent-skill-chain/runtime/templates/00_要求定義.md`（パッケージ内。プロジェクトに `.agent-skill-chain/runtime/templates/00_要求定義.md` が無い場合）。
- 上記テンプレートの「要求定義の全体像」「1. 目的・背景」「成功基準」「次のステップ」等の構成を尊重し、PR 指摘対応のトリアージ記録用に **指摘一覧（disposition 付き）**・**各指摘の対応方針**・**一括承認ブロック** を追加した形で 00 を生成する。
- データ形式の正本は [OUTPUT_FORMAT.md](./OUTPUT_FORMAT.md)。
