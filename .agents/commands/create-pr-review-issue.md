# command: create-pr-review-issue

**本ファイルの責務**: PR 指摘対応 issue の起票を行う command の定義。**どの skill / worker をどの順で実行するか**のみを記載。実行手順・委譲の形は skills/agent/run_command.md に従う。**契約**: [IO_CONTRACT.md](../IO_CONTRACT.md) に従い INPUT / PROCESS / OUTPUT / DONE で定義する。

---

## メタデータ（phase → command 整合用）

| 項目 | 値 |
|------|-----|
| **Allowed Phase** | issue_creation（サブフェーズ: create_pr_review_issue） |
| **Required Inputs** | pr_url, review_comments_raw, issue_dir_hint（任意）, parent_issue_id |
| **Produces** | created_issue_dir（.workflow/{parent}/90_issues/{ディレクトリ名}/）、当該配下の 00_要求定義.md |
| **Next Phase** | 実装（当該サブ issue の 01→02→03→実装→04 へ進む場合） |

---

## INPUT

- **pr_url**: string。PR を一意に特定する URL（例: `https://github.com/techbeansjp-free/AGENTS.md/pull/4`）。
- **review_comments_raw**: string。ユーザーが貼り付けた PR レビューコメント一覧（テキスト）。手動取得前提（github MCP は使わない）。
- **issue_dir_hint**: string | null。既存 issue ディレクトリ名。指定時は新規作成せず当該ディレクトリを採用する。省略時は pr_url からプレフィックスを生成し新規作成する。
- **parent_issue_id**: string。親 issue のディレクトリ名（`.workflow/{parent_issue_id}/` が存在する前提）。

---

## PROCESS（Skill chain・この順で実行）

1. **create-pr-review-issue-worker** — ディレクトリ決定・作成、指摘抽出・対応方針案生成、00_要求定義.md 生成  
   `workers/create-pr-review-issue/`（または scripts/ に配置した実装を呼ぶ）
2. **対応方針の監査** — 00_要求定義.md（指摘一覧・各指摘の対応方針案）を対象に、監査・レビューに依頼する。問題があれば 00 を修正して差し戻し、指摘がなくなるまで繰り返す。証跡は `.workflow/{当該 issue}/memo/` に YYYYMMDD_HHMMSS_ プレフィックスの memo で記録する（PHASES §レビュー成果物の配置ルール・run_command §実装前のドキュメントレビューに準拠）。既存の review-docs やドキュメントレビュー運用（memo ＋ 修正反復）に合わせる。
3. **write-workflow-log** — 書記に依頼し、本 command の実施内容・作成した issue ディレクトリ・00_要求定義.md を workflow.db に記録する。`skills/logging/write-workflow-log/` を参照。

委譲方針: メインエージェントは本 command を run_command 経由でサブに委譲する。サブは上記 1→2→3 の順で実行する。worker 完了後に監査（2）を経て指摘がなくなるまで修正反復し、最後に書記（3）で証跡を記録する。

---

## OUTPUT

- **created_issue_dir**: string。作成または採用した issue ディレクトリのパス（例: `.workflow/{parent_issue_id}/90_issues/20260314_PR4_PR指摘対応/`）。
- 当該ディレクトリ配下の **00_要求定義.md**（90_issues 用テンプレートに従い、指摘一覧・各指摘の対応方針案を埋めた状態）。
- **対応方針の監査完了**: 00 に対する監査を経て指摘がなくなるまで修正反復済みであること。証跡は当該 issue の memo に記録されている。
- **書記記録済み**: write-workflow-log により workflow.db に実施内容・作成 issue ディレクトリ・00_要求定義.md が記録されていること。

---

## DONE（DoD）

- `.workflow/{parent_issue_id}/90_issues/{ディレクトリ名}/` が存在し、その配下に 00_要求定義.md が存在する。
- 00_要求定義.md に指摘一覧・各指摘への対応方針案・受け入れ基準・次のステップ（対応方針レビュー（人間）を含む）が記載されている。
- **対応方針の監査を経ていること**: 00 を対象に監査・レビューを実施し、問題があれば修正して差し戻し、指摘がなくなるまで繰り返している。証跡は当該 issue の `.workflow/{当該 issue}/memo/` に YYYYMMDD_HHMMSS_ プレフィックスの memo で記録されている。
- **書記（write-workflow-log）で証跡が記録されていること**: 本 command の実施内容・作成した issue ディレクトリ・00_要求定義.md が workflow.db に記録されている。

---

## 想定されるユーザーの 1 行指示パターン

- 「`https://github.com/techbeansjp-free/AGENTS.md/pull/4` の指摘対応のための issue を作成して」
- 「この PR コメント一覧で PR 指摘対応 issue を作って」
- 「既存の `AGENTS-PR4_PR指摘対応` ディレクトリを使って、この PR の指摘対応 issue を更新して」

---

## ERROR / Forbidden

- **既存ディレクトリが見つからない**: issue_dir_hint を指定したが `.workflow/{parent_issue_id}/90_issues/{issue_dir_hint}/` が存在しない場合 → エラーとしてユーザーに「指定されたディレクトリが見つかりません。ディレクトリ名を確認するか、未指定で新規作成してください。」を返す。不完全なディレクトリを .workflow 配下に作成しない。
- **指摘一覧が空**: review_comments_raw が空または有意な指摘を 1 件も抽出できなかった場合 → 00_要求定義.md に「指摘一覧が空です。手動で指摘を追加するか、review_comments_raw を再入力してください。」旨を明記し、受け入れ基準に「指摘一覧が 1 件以上埋まっていること」を含める。
- **PR URL が不正形式**: URL として解釈できない・PR 番号が抽出できない場合 → 00_要求定義.md に「PR を一意に特定できるか不明です。有効な PR URL を確認してください。」旨を明記する。処理は継続し、ディレクトリ名はプレフィックスに「PR不明」等のフォールバックを用いてもよい。

---

## 参照

- 02_設計: データモデル（PrReviewIssueRequest, ReviewFinding, PrReviewIssueDefinition）、フロー（ディレクトリ決定・指摘抽出・00 生成）
- workflow/TEMPLATES.md（00_要求定義のテンプレート。90_issues 用は 00_要求定義.md の必須セクションを満たしつつ指摘一覧・対応方針案セクションを追加）
- PHASES.md（issue_creation.create_pr_review_issue サブフェーズ）
