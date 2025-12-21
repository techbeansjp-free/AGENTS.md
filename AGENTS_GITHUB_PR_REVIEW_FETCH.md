# AGENTS_GITHUB_PR_REVIEW_FETCH - GitHub PR 指摘取得ルール

> このドキュメントは、**GitHub から PR の指摘（CodeRabbit などのレビューツールによる指摘を含む）を取得し、JSON 形式で保存する処理**を体系化したルールです。  
> ワークフロー全体の規約は [`AGENTS.md`](./AGENTS.md)、  
> LLM 向けの全体ルールは [`AGENTS_AI_PLAYBOOK.md`](./AGENTS_AI_PLAYBOOK.md) を参照してください。

---

## クイックリファレンス（絶対に守ること）

1. **リポジトリ情報の取得**: `git remote` から取得するか、手動で指定する
2. **PR 番号の特定**: PR メッセージファイル（`99_PR.md`）から取得するか、GitHub CLI を使用する
3. **GitHub API 認証**: GitHub CLI（`gh`）を使用するか、`GITHUB_TOKEN` 環境変数を設定する
4. **コメントとレビューの取得**: GitHub API を使用して PR コメントとレビューを取得する
5. **CodeRabbit コメントのフィルタリング**: `user.login` が `"coderabbitai[bot]"` のコメントのみを抽出する
6. **JSON 形式での保存**: 取得したコメントとレビューを JSON 形式で保存する

---

## 対象と前提

### この規約がカバーするもの

- GitHub から PR の指摘を取得する処理
- CodeRabbit などのレビューツールによる指摘のフィルタリング
- JSON 形式での保存

### 前提条件

- GitHub リポジトリへのアクセス権限
- GitHub Personal Access Token（PAT）または GitHub CLI（`gh`）の認証
- `curl` コマンドが利用可能（GitHub CLI を使用する場合は `gh` コマンドが利用可能）
- `jq` コマンドがインストールされている（JSON 処理用）

---

## 基本ルール

### 1. リポジトリ情報の取得

#### 基本方針

- **方法 1（推奨）**: `git remote` から取得
- **方法 2**: 手動で指定（`REPO` 環境変数）

#### 正しい例

```bash
# 方法1: git remoteから取得
REPO_URL=$(git remote get-url origin)
# git@github.com:techbeansjp/d-pops-dx-web.git → techbeansjp/d-pops-dx-web
# https://github.com/techbeansjp/d-pops-dx-web.git → techbeansjp/d-pops-dx-web

# 方法2: 手動で指定
export REPO="techbeansjp/d-pops-dx-web"
```

#### 間違った例

```bash
# ❌ NG: リポジトリ情報を推測する
REPO="techbeansjp/d-pops-dx-web"  # 推測に基づく値は禁止
```

**問題点**: リポジトリ情報を推測せず、`git remote` から取得するか、明示的に指定する必要がある

### 2. PR 番号の特定

#### 基本方針

- **方法 1（推奨）**: PR メッセージファイル（`99_PR.md`）から取得
- **方法 2**: GitHub CLI を使用
- **方法 3**: 手動で指定

#### 正しい例

```bash
# 方法1: PRメッセージファイルから取得
PR_NUMBER=$(grep -E "PR #|pull request #|プルリクエスト #" 99_PR.md | grep -oE '[0-9]+' | head -1)

# 方法2: GitHub CLIから取得
PR_NUMBER=$(gh pr view --json number --jq '.number')

# 方法3: 手動で指定
PR_NUMBER=2136
```

#### 間違った例

```bash
# ❌ NG: PR番号を推測する
PR_NUMBER=2136  # 推測に基づく値は禁止（明示的に指定する場合はOK）
```

**問題点**: PR 番号を推測せず、PR メッセージファイルや GitHub CLI から取得するか、明示的に指定する必要がある

### 3. GitHub API 認証

#### 基本方針

- **方法 1（推奨）**: GitHub CLI（`gh`）を使用
- **方法 2**: Personal Access Token（PAT）を使用

#### 正しい例

```bash
# 方法1: GitHub CLIを使用
gh auth status  # 認証状態を確認
gh auth login   # 認証されていない場合は認証

# 方法2: Personal Access Tokenを使用
export GITHUB_TOKEN="your_personal_access_token"
```

#### 間違った例

```bash
# ❌ NG: 認証情報をハードコードする
GITHUB_TOKEN="hardcoded_token"  # セキュリティ上の問題
```

**問題点**: 認証情報をハードコードせず、環境変数や GitHub CLI の認証機能を使用する必要がある

### 4. コメントとレビューの取得

#### 基本方針

- GitHub API を使用して PR コメントとレビューを取得する
- ページネーションに対応する（複数ページがある場合）

#### 正しい例

```bash
# GitHub CLIを使用（推奨）
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments > pr_comments.json
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews > pr_reviews.json

# curlを使用
curl -H "Authorization: token $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/comments > pr_comments.json
```

#### 間違った例

```bash
# ❌ NG: ページネーションを考慮しない
curl https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/comments > pr_comments.json
# 複数ページがある場合、すべてのコメントを取得できない
```

**問題点**: ページネーションを考慮し、すべてのコメントとレビューを取得する必要がある

### 5. CodeRabbit コメントのフィルタリング

#### 基本方針

- `user.login` が `"coderabbitai[bot]"` のコメントのみを抽出する
- `jq` コマンドを使用してフィルタリングする

#### 正しい例

```bash
# CodeRabbitのコメントをフィルタリング
jq '[.[] | select(.user.login == "coderabbitai[bot]")]' pr_comments.json > coderabbit_comments.json

# CodeRabbitのレビューをフィルタリング
jq '[.[] | select(.user.login == "coderabbitai[bot]")]' pr_reviews.json > coderabbit_reviews.json
```

#### 間違った例

```bash
# ❌ NG: フィルタリングをしない
cp pr_comments.json coderabbit_comments.json
# すべてのコメントが含まれるため、CodeRabbit以外のコメントも含まれる
```

**問題点**: CodeRabbit のコメントのみを抽出するため、フィルタリングが必要

### 6. JSON 形式での保存

#### 基本方針

- 取得したコメントとレビューを JSON 形式で保存する
- メタデータ（PR 番号、リポジトリ、取得日時）を含める

#### 正しい例

```bash
# 現在の日時を取得
RETRIEVED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# JSON形式で保存
jq -n \
  --argjson comments "$(cat coderabbit_comments.json)" \
  --argjson reviews "$(cat coderabbit_reviews.json)" \
  --arg pr_number "$PR_NUMBER" \
  --arg repository "$REPO" \
  --arg retrieved_at "$RETRIEVED_AT" \
  '{
    comments: $comments,
    reviews: $reviews,
    metadata: {
      pr_number: ($pr_number | tonumber),
      repository: $repository,
      retrieved_at: $retrieved_at
    }
  }' > 01_coderabbit.json
```

#### 間違った例

```bash
# ❌ NG: メタデータを含めない
cat coderabbit_comments.json > 01_coderabbit.json
# メタデータがないため、どのPRのコメントかわからない
```

**問題点**: メタデータを含めることで、後で参照する際にどの PR のコメントかが明確になる

---

## 処理フロー

```mermaid
flowchart TD
    START["処理開始"]
    STEP1["1. リポジトリ情報の取得<br/>git remoteまたは手動指定"]
    STEP2["2. PR番号の特定<br/>99_PR.mdまたはGitHub CLI"]
    STEP3["3. GitHub API認証の確認<br/>gh authまたはGITHUB_TOKEN"]
    STEP4["4. PRコメントの取得<br/>GitHub API"]
    STEP5["5. PRレビューの取得<br/>GitHub API"]
    STEP6["6. CodeRabbitコメントのフィルタリング<br/>jqでuser.login == \"coderabbitai[bot]\"を抽出"]
    STEP7["7. JSON形式での保存<br/>コメント・レビュー・メタデータを含む"]
    END["処理完了"]

    START --> STEP1
    STEP1 --> STEP2
    STEP2 --> STEP3
    STEP3 --> STEP4
    STEP4 --> STEP5
    STEP5 --> STEP6
    STEP6 --> STEP7
    STEP7 --> END
```

---

## LLM エージェント向け実行ルール（必須）

> ここから下は、**AI が GitHub PR 指摘を取得するときに絶対に守るチェックリスト**です。

### 共通前提

- すべての GitHub PR 指摘取得は、この `AGENTS_GITHUB_PR_REVIEW_FETCH.md` のルールに従う。
- エラーが発生しやすいパターンを避け、安定した処理を実現する。

### 1. リポジトリ情報の取得ルール

AI は GitHub PR 指摘を取得するとき、**必ず次を守る**：

- **方法 1（推奨）**: `git remote get-url origin` から取得
- **方法 2**: 手動で指定（`REPO` 環境変数）
- **禁止事項**: リポジトリ情報を推測する

**禁止事項**:

- リポジトリ情報を推測する
- ハードコードされたリポジトリ情報を使用する（明示的に指定する場合は OK）

### 2. PR 番号の特定ルール

AI は GitHub PR 指摘を取得するとき、**必ず次を守る**：

- **方法 1（推奨）**: PR メッセージファイル（`99_PR.md`）から取得
- **方法 2**: GitHub CLI を使用
- **方法 3**: 手動で指定
- **禁止事項**: PR 番号を推測する

**禁止事項**:

- PR 番号を推測する
- ハードコードされた PR 番号を使用する（明示的に指定する場合は OK）

### 3. GitHub API 認証ルール

AI は GitHub PR 指摘を取得するとき、**必ず次を守る**：

- **方法 1（推奨）**: GitHub CLI（`gh`）を使用
- **方法 2**: Personal Access Token（PAT）を使用（`GITHUB_TOKEN` 環境変数）
- **禁止事項**: 認証情報をハードコードする

**禁止事項**:

- 認証情報をハードコードする
- 認証なしで GitHub API にアクセスする（レート制限が厳しくなる）

### 4. コメントとレビューの取得ルール

AI は GitHub PR 指摘を取得するとき、**必ず次を守る**：

- **ページネーションに対応**: 複数ページがある場合はすべて取得する
- **エラーハンドリング**: API エラーを適切に処理する
- **レート制限の確認**: GitHub API のレート制限に注意する

**禁止事項**:

- ページネーションを考慮しない
- エラーハンドリングをしない
- レート制限を無視する

### 5. CodeRabbit コメントのフィルタリングルール

AI は GitHub PR 指摘を取得するとき、**必ず次を守る**：

- **フィルタリング**: `user.login` が `"coderabbitai[bot]"` のコメントのみを抽出する
- **jq コマンドを使用**: JSON 処理には `jq` コマンドを使用する

**禁止事項**:

- フィルタリングをしない（すべてのコメントを含める）
- 手動でフィルタリングする（`jq` コマンドを使用する）

### 6. JSON 形式での保存ルール

AI は GitHub PR 指摘を取得するとき、**必ず次を守る**：

- **メタデータを含める**: PR 番号、リポジトリ、取得日時を含める
- **JSON 形式**: 有効な JSON 形式で保存する
- **ファイル名**: `01_coderabbit.json` または指定されたファイル名を使用する

**禁止事項**:

- メタデータを含めない
- 無効な JSON 形式で保存する
- ファイル名を推測する（明示的に指定する場合は OK）

---

## AI 自己チェックリスト（GitHub PR 指摘取得前）

> **重要**: AI は、GitHub PR 指摘を取得する前に、**必ず以下のチェックリストを自問自答し、すべての項目を確認すること**。

### GitHub PR 指摘取得時の自己チェック

GitHub PR 指摘を取得する前に、以下を確認：

- [ ] **リポジトリ情報**: リポジトリ情報を `git remote` から取得しているか、または明示的に指定しているか？（推測していないか？）
- [ ] **PR 番号**: PR 番号を PR メッセージファイルや GitHub CLI から取得しているか、または明示的に指定しているか？（推測していないか？）
- [ ] **GitHub API 認証**: GitHub CLI が認証されているか、または `GITHUB_TOKEN` 環境変数が設定されているか？
- [ ] **コメントとレビューの取得**: GitHub API を使用して PR コメントとレビューを取得しているか？
- [ ] **ページネーション**: 複数ページがある場合、すべてのコメントとレビューを取得しているか？
- [ ] **フィルタリング**: CodeRabbit のコメントのみを抽出しているか？（`user.login == "coderabbitai[bot]"`）
- [ ] **JSON 形式**: 有効な JSON 形式で保存しているか？
- [ ] **メタデータ**: PR 番号、リポジトリ、取得日時を含めているか？

### チェックリストの使い方

1. **取得前に確認**: GitHub PR 指摘を取得する前に、上記のチェックリストを確認する
2. **不備があれば修正**: チェックリストの項目に不備があれば、取得前に修正する
3. **確認結果を明示**: 取得物と一緒に「自己チェック結果」を簡潔に記載する（例: 「✅ リポジトリ情報は git remote から取得、PR 番号は 99_PR.md から取得、CodeRabbit コメントのみを抽出、メタデータを含めて JSON 形式で保存しました」）

---

## 処理手順書への参照

詳細な処理手順は、以下のドキュメントを参照してください：

- **処理手順書**: `.workflow/{YYYYMMDD_HHMMSS_issue_name}/指摘対応/00_処理手順書.md`
  - リポジトリ情報の取得方法
  - PR 番号の特定方法
  - GitHub API 認証の確認方法
  - コメントとレビューの取得方法
  - CodeRabbit コメントのフィルタリング方法
  - JSON 形式での保存方法
  - 完全な処理スクリプト
  - トラブルシューティング

---

## よくあるエラーと対処法

### エラー 1: `fatal: not a git repository`

**原因**: リポジトリのルートディレクトリで実行していない

**対処法**: リポジトリのルートディレクトリに移動するか、`REPO` 環境変数を手動で設定する

### エラー 2: `GitHub CLI not available or not authenticated`

**原因**: GitHub CLI がインストールされていない、または認証されていない

**対処法**: GitHub CLI をインストールして認証するか、`GITHUB_TOKEN` 環境変数を設定する

### エラー 3: `jq: command not found`

**原因**: `jq` コマンドがインストールされていない

**対処法**: `jq` コマンドをインストールする

### エラー 4: `API rate limit exceeded`

**原因**: GitHub API のレート制限に達した

**対処法**: 認証済みリクエストを使用するか、しばらく待ってから再実行する

---

## 参考資料

### プロジェクトドキュメント

- [`AGENTS_AI_PLAYBOOK.md`](./AGENTS_AI_PLAYBOOK.md) - LLM エージェント運用ルール
- [`AGENTS.md`](./AGENTS.md) - 開発規約の全体像

### 処理手順書

- `.workflow/{YYYYMMDD_HHMMSS_issue_name}/指摘対応/00_処理手順書.md` - 詳細な処理手順

### 外部参考資料

- [GitHub REST API - Pull Requests](https://docs.github.com/en/rest/pulls)
- [List review comments on a pull request](https://docs.github.com/en/rest/pulls/comments#list-review-comments-on-a-pull-request)
- [List reviews for a pull request](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request)
- [GitHub CLI 公式ドキュメント](https://cli.github.com/)
- [jq 公式ドキュメント](https://stedolan.github.io/jq/)

---

## 最後に（人間向け）

- この `AGENTS_GITHUB_PR_REVIEW_FETCH.md` は、**GitHub から PR の指摘を取得する処理に特化した規約**です。
- 迷ったときは：
  1. 処理手順書（`00_処理手順書.md`）を参照する
  2. リポジトリ情報は `git remote` から取得する
  3. PR 番号は PR メッセージファイルから取得する
  4. CodeRabbit コメントのみを抽出する
  5. メタデータを含めて JSON 形式で保存する
  6. それでも悩んだら `.workflow/{issue}/memo/` にメモを残してから検討

---

**最終更新**: 2025 年 12 月 22 日（GitHub PR 指摘取得ルールの初版作成）
