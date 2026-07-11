# worker: create-pr-review-issue

**責務**: PR 指摘対応 issue の起票。ディレクトリ決定・作成、指摘一覧抽出・対応方針案生成、00_要求定義.md の生成までを一連で実行する。メインエージェントは commands/create-pr-review-issue.md を run_command 経由でサブに委譲し、本 worker の手順に従って実行する。

---

## INPUT（command から渡される）

- **pr_url**: string
- **review_comments_raw**: string
- **issue_dir_hint**: string | null
- **parent_issue_id**: string（.agent-skill-chain/runtime/{parent_issue_id}/ が存在する前提）

---

## PROCESS（手順）

**既存 issue ディレクトリ（issue_dir_hint）指定時**: ディレクトリ作成（1）は行わず、**指摘一覧の取得・00 への反映・対応方針の決定（手順 2〜4）から**行う。当該ディレクトリを採用したうえで、指摘一覧抽出 → 対応方針案生成 → 00_要求定義.md の生成（または更新）までを実行する。

1. **ディレクトリ決定・作成**  
   `../scripts/create-pr-review-issue-dir.sh` を実行する（または本 README のロジックに従う）。
   - `issue_dir_hint` が指定されている場合: `.agent-skill-chain/runtime/{parent_issue_id}/90_issues/{issue_dir_hint}/` の存在を確認。存在すればそれを採用。存在しなければエラー（ERROR_DIR_NOT_FOUND）とし、ユーザーに「指定されたディレクトリが見つかりません」を返す。
   - `issue_dir_hint` が未指定の場合: pr_url から PR 番号を抽出し、memo-prefix.sh でプレフィックスを取得。`.agent-skill-chain/runtime/{parent_issue_id}/90_issues/{プレフィックス}PR指摘対応/` を新規作成する。
2. **指摘一覧抽出**  
   review_comments_raw から ReviewFinding[] を生成する。**出力形式は [OUTPUT_FORMAT.md](./OUTPUT_FORMAT.md) に固定**する。
3. **対応方針案生成**  
   各 finding に対して strategies（map<finding.id, 対応方針案テキスト>）を生成する。形式は OUTPUT_FORMAT.md §2 に従う。
4. **00_要求定義.md 生成**  
   PrReviewIssueDefinition を [00_TEMPLATE_MAPPING.md](./00_TEMPLATE_MAPPING.md) に従い 90_issues 用 00 にマッピングし、当該ディレクトリに 00_要求定義.md を書き出す。

---

## OUTPUT

- **created_issue_dir**: 採用または作成したディレクトリのパス（.agent-skill-chain/runtime/{parent_issue_id}/90_issues/{ディレクトリ名}/）
- 当該ディレクトリ配下の **00_要求定義.md**

---

## エラーハンドリング（メッセージ設計）

- **既存ディレクトリ未検出**: issue_dir_hint を指定したが該当ディレクトリが存在しない場合 → **「指定されたディレクトリが見つかりません。ディレクトリ名を確認するか、未指定で新規作成してください。」** をユーザーに返す。.workflow 配下に不完全なディレクトリを作成しない。
- **指摘一覧が空**: review_comments_raw が空または有意な指摘を 1 件も抽出できなかった場合 → 00_要求定義.md に **「指摘一覧が空です。手動で指摘を追加するか、review_comments_raw を再入力してください。」** を明記し、受け入れ基準に「指摘一覧が 1 件以上埋まっていること」を含める。
- **PR URL 不正**: PR 番号を抽出できない場合 → 00_要求定義.md の参照元に **「PR を一意に特定できるか不明です。有効な PR URL を確認してください。」** を明記する。処理は継続し、ディレクトリ名のプレフィックスは「PR不明」等のフォールバックを用いてよい。

---

## 参照

- commands/create-pr-review-issue.md
- 02_設計（本 issue）: データモデル・フロー
- workflow/TEMPLATES.md（00_要求定義のテンプレート）
- OUTPUT_FORMAT.md（本ディレクトリ）
- 00_TEMPLATE_MAPPING.md（本ディレクトリ）
