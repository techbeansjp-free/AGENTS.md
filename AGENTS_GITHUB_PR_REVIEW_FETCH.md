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
5. **レビューツールのコメントのフィルタリング**: 使用するツールに応じて抽出する（CodeRabbit: `user.login == "coderabbitai[bot]"`、Copilot: `copilot-pull-request-reviewer` 等）
6. **Nitpick 取得漏れ防止（必須）**: レビューコメントに加えて**レビュー本体（reviews の body）**も取得し、CodeRabbit が body に記載する「🧹 Nitpick comments」等をパースして指摘一覧に含める（[詳細](#55-coderabbit-の-nitpick-取得漏れ防止必須対応策)）
7. **JSON 形式での保存**: 取得したコメントとレビューを JSON 形式で保存する
8. **指摘対応ディレクトリ（テンプレート必須）**: issue 直下に `指摘対応/` を作成するときは**必ず** [指摘対応用テンプレート](#指摘対応ディレクトリのテンプレート)（`.workflow/templates/指摘対応/` の `00_README.md`・`01_指摘一覧.md`・`02_対応方針.md`）をコピーして使用し、指摘一覧・対応方針を記載する

---

## 対象と前提

### この規約がカバーするもの

- GitHub から PR の指摘を取得する処理
- CodeRabbit / Copilot などのレビューツールによる指摘のフィルタリング
- JSON 形式での保存
- 指摘対応ディレクトリのテンプレート化（指摘一覧・対応方針の管理）

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

### 5.5 CodeRabbit の Nitpick 取得漏れ防止（必須対応策）

#### 背景・原因

- **レビューコメント API**（`pulls/{number}/comments`）が返すのは**インラインの行紐づきコメント**のみである。
- CodeRabbit は **Major など**を「該当行へのインラインコメント」として投稿するため、レビューコメント API で取得できる。
- **Nitpick**（および一部の Minor）は、**レビュー本体（Review body）**のテキスト内に「🧹 Nitpick comments (1)」のように**一覧で記載**している。レビュー本体は **Pull Request Reviews API**（`pulls/{number}/reviews`）の各レビューの `body` に含まれる。
- そのため、**レビューコメントのみを取得していると Nitpick が指摘一覧から漏れる**。

#### 対応策（AI は必ず遵守すること）

1. **取得対象を 2 種類にする**

   - **レビューコメント**（`pulls/{number}/comments`）: インライン指摘（Major 等）を取得する。
   - **レビュー**（`pulls/{number}/reviews`）: 各レビューの `body` を取得する。CodeRabbit の `body` には「🧹 Nitpick comments (N)」「🔵 Minor comments (N)」等のセクションと、ファイル名・行番号・指摘本文が含まれる場合がある。

2. **レビュー body のパース**

   - `user.login == "coderabbitai[bot]"` のレビューについて、`body` をテキストとして検索する。
   - 「Nitpick comments」「Minor comments」等の見出しの直後にある、ファイルパス・行番号・指摘文の一覧を抽出し、指摘として指摘一覧（01*指摘一覧 や 00*指摘事項分析結果 等）に含める。

3. **GitHub CLI を使用する場合**
   - レビューコメント: `gh api repos/{owner}/{repo}/pulls/{number}/comments`
   - **レビュー本体**: `gh api repos/{owner}/{repo}/pulls/{number}/reviews` を**必ず**実行し、各要素の `body` を確認する。

#### 禁止事項

- ❌ レビューコメントのみを取得し、レビュー（reviews）を取得しない。
- ❌ 指摘一覧に Nitpick が含まれているか確認せずに「指摘は以上」とすること。

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
    STEP5["5. PRレビューの取得<br/>GitHub API（必須: Nitpick は body に記載）"]
    STEP5B["5b. レビュー body のパース<br/>Nitpick / Minor を指摘一覧に追加"]
    STEP6["6. CodeRabbitコメントのフィルタリング<br/>jqでuser.login == \"coderabbitai[bot]\"を抽出"]
    STEP7["7. JSON形式での保存<br/>コメント・レビュー・メタデータを含む"]
    END["処理完了"]

    START --> STEP1
    STEP1 --> STEP2
    STEP2 --> STEP3
    STEP3 --> STEP4
    STEP4 --> STEP5
    STEP5 --> STEP5B
    STEP5B --> STEP6
    STEP6 --> STEP7
    STEP7 --> END
```

---

## 指摘対応ディレクトリのテンプレート

PR の指摘を一覧化し、採用・見送り・要検討の対応方針を記録するために、**指摘対応**用のテンプレートを用意する。本節は**汎用版**のため、任意のプロジェクトで利用できる。

**必須**: 指摘対応を開始するとき（issue 直下に `指摘対応/` を作成するとき）は、**必ず**本テンプレート（`.workflow/templates/指摘対応/` の 3 ファイル）をコピーして使用すること。テンプレートを使わずに独自のファイル構成で指摘対応ディレクトリを作成してはならない。

### テンプレートの配置場所

- **ディレクトリ**: `.workflow/templates/指摘対応/`（本規約を採用するプロジェクトのワークフロー直下）
- **ファイル**（上記ディレクトリに配置されている 3 ファイルをそのままコピーして使用する）:
  - `00_README.md` … 本ディレクトリの目的・PR メタ情報（プレースホルダー付き）
  - `01_指摘一覧.md` … 指摘の記載形式と 1 件の例（取得した JSON から転記する）
  - `02_対応方針.md` … 方針の決め方（採用/見送り/要検討）と一覧・詳細のひな形

### 使い方

1. **指摘対応を開始するとき**: issue ディレクトリ直下に `指摘対応/` を作成し、`.workflow/templates/指摘対応/` の 3 ファイルをコピーする。
2. **00_README.md**: PR 番号・URL・取得元（CodeRabbit / Copilot 等）・取得日時・スレッド数など、テンプレートのプレースホルダーを置換する。
3. **01\_指摘一覧.md**: 取得した JSON（PR review comments API のレスポンスやプロジェクトの comments ファイル）または PR 画面から、各指摘を「ファイル・行・スレッド ID・本文」の形式で転記する。
4. **02\_対応方針.md**: 各指摘について採用・見送り・要検討を決め、理由と対応内容（採用時）を記載する。指摘が誤りや過剰な場合もあるため、まず一覧を確認してから方針を立てる。

### 指摘者のフィルタリングについて

- **CodeRabbit**: `user.login == "coderabbitai[bot]"` のコメントを抽出する（本ドキュメントの既存ルール）。
- **Copilot**: `user.login == "copilot-pull-request-reviewer"` のコメントを抽出する。Cursor 等で PR コメントを取得した JSON に `threadsByFile` や `authorLogin` が含まれる場合は、それに合わせて 01\_指摘一覧 に転記する。
- 複数ツールの指摘をまとめて扱う場合は、01\_指摘一覧で「指摘者」を列に含めるか、セクションで分けて記載する。

### 参照

- テンプレート実体: 各プロジェクトの `.workflow/templates/指摘対応/`（本規約を採用している場合）
- 使用例: `.workflow/{YYYYMMDD_HHMMSS_issue_name}/指摘対応/`（各 issue でコピーして利用）

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
- **Nitpick 取得漏れ防止（必須）**: 指摘を漏れなく取得するため、**レビューコメント**（`pulls/{number}/comments`）に加えて**レビュー**（`pulls/{number}/reviews`）も取得すること。CodeRabbit は Nitpick をレビュー本体（各レビューの `body`）に「🧹 Nitpick comments (N)」等として記載するため、`body` をパースし、Nitpick・Minor 等を指摘一覧に含めること。レビューのみ取得して body を参照しないと Nitpick が漏れる。

**禁止事項**:

- ページネーションを考慮しない
- エラーハンドリングをしない
- レート制限を無視する
- **レビューコメントのみ取得し、レビュー（reviews）を取得しない**
- **レビュー body に Nitpick 等が含まれる可能性を確認せずに指摘一覧を確定しない**

### 5. レビューツールコメントのフィルタリングルール

AI は GitHub PR 指摘を取得するとき、**必ず次を守る**：

- **フィルタリング**: 使用するレビューツールに応じて抽出する（CodeRabbit: `user.login == "coderabbitai[bot]"`、Copilot: `"copilot-pull-request-reviewer"` 等）
- **jq コマンドを使用**: JSON 処理には `jq` コマンドを使用する（またはプロジェクトで定めた取得方法に従う）

**禁止事項**:

- フィルタリングをしない（すべてのコメントを含める場合を除く）
- 手動でフィルタリングする（`jq` コマンドまたはプロジェクトの取得方法を使用する）

### 6. JSON 形式での保存ルール

AI は GitHub PR 指摘を取得するとき、**必ず次を守る**：

- **メタデータを含める**: PR 番号、リポジトリ、取得日時を含める
- **JSON 形式**: 有効な JSON 形式で保存する
- **ファイル名**: `01_coderabbit.json` または指定されたファイル名を使用する

**禁止事項**:

- メタデータを含めない
- 無効な JSON 形式で保存する
- ファイル名を推測する（明示的に指定する場合は OK）

### 7. 指摘対応テンプレート使用ルール

AI は指摘対応ディレクトリ（`指摘対応/`）を作成するとき、**必ず次を守る**：

- **テンプレートの使用は必須**: `.workflow/templates/指摘対応/` に配置されている **3 ファイル**（`00_README.md`・`01_指摘一覧.md`・`02_対応方針.md`）を、issue 直下の `指摘対応/` にコピーしてから使用する。指摘一覧や対応方針の記載は、コピーしたテンプレートを編集して行う。
- **禁止事項**: テンプレートをコピーせず、独自のファイル名・構成で `指摘対応/` を作成しないこと。プロジェクトで `00_指摘事項分析結果.md` 等の別形式を採用している場合は、そのプロジェクトの規約に従う。

**詳細**: [指摘対応ディレクトリのテンプレート](#指摘対応ディレクトリのテンプレート)を参照。

### 8. 参照パス確認ルール

AI は GitHub PR 指摘取得時にドキュメントを生成するとき、**必ず次を守る**：

- **参照パス確認は必須**: ドキュメント作成・更新時は、**必ずすべての参照パスが正しいか確認すること**
- **確認タイミング**: ドキュメント作成時、更新時、レビュー時
- **確認方法**: すべての参照パス（Markdown リンク形式）を確認し、実際のファイルパスと一致しているか検証する
- **確認項目**:
  - 相対パスの形式が正しいか（`./`、`../` など）
  - ファイル名が正しいか（大文字小文字、拡張子を含む）
  - ディレクトリ構造が正しいか
  - リンク形式が正しいか（Markdown リンク形式: `[テキスト](./パス)`）
- **禁止事項**:
  - 参照パスを推測する
  - ファイル名を記憶に基づいて記載する
  - ディレクトリ構造を確認せずに参照パスを記載する
  - ファイルが存在しないのに参照パスを記載する
- **必須事項**: 参照パスを記載する前に、必ず実際のファイルパスを確認する
- **詳細**: 参照パス確認の詳細なルールは [`AGENTS.md`](./AGENTS.md) の「ドキュメント原則」セクションを参照

## AI 自己チェックリスト（GitHub PR 指摘取得前）

> **重要**: AI は、GitHub PR 指摘を取得する前に、**必ず以下のチェックリストを自問自答し、すべての項目を確認すること**。

### GitHub PR 指摘取得時の自己チェック

GitHub PR 指摘を取得する前に、以下を確認：

- [ ] **リポジトリ情報**: リポジトリ情報を `git remote` から取得しているか、または明示的に指定しているか？（推測していないか？）
- [ ] **PR 番号**: PR 番号を PR メッセージファイルや GitHub CLI から取得しているか、または明示的に指定しているか？（推測していないか？）
- [ ] **GitHub API 認証**: GitHub CLI が認証されているか、または `GITHUB_TOKEN` 環境変数が設定されているか？
- [ ] **コメントとレビューの取得**: GitHub API を使用して PR コメントとレビューを取得しているか？
- [ ] **レビュー本体（reviews）の取得**: レビューコメントに加えて `pulls/{number}/reviews` も実行し、Nitpick 取得漏れを防いでいるか？
- [ ] **Nitpick のパース**: CodeRabbit のレビュー `body` に「🧹 Nitpick comments」等が含まれる場合、それをパースして指摘一覧に含めているか？
- [ ] **ページネーション**: 複数ページがある場合、すべてのコメントとレビューを取得しているか？
- [ ] **フィルタリング**: 使用するレビューツールのコメントを抽出しているか？（CodeRabbit: `coderabbitai[bot]`、Copilot: `copilot-pull-request-reviewer` 等）
- [ ] **JSON 形式**: 有効な JSON 形式で保存しているか？
- [ ] **メタデータ**: PR 番号、リポジトリ、取得日時を含めているか？
- [ ] **参照パス**: 生成するドキュメント内のすべての参照パスが正しいか？（Markdown リンク形式、相対パス、ファイル名、ディレクトリ構造を確認）
- [ ] **指摘対応ディレクトリ**: issue 直下に指摘をまとめる場合、`.workflow/templates/指摘対応/` をコピーし、00*README / 01*指摘一覧 / 02\_対応方針を埋めているか？

- [ ] **指摘対応テンプレートの使用**: issue 直下に `指摘対応/` を作成する場合、**必ず** `.workflow/templates/指摘対応/` の 3 ファイル（`00_README.md`・`01_指摘一覧.md`・`02_対応方針.md`）をコピーして使用しているか？ テンプレートを使わず独自のファイル構成で作成していないか？

1. **取得前に確認**: GitHub PR 指摘を取得する前に、上記のチェックリストを確認する
2. **不備があれば修正**: チェックリストの項目に不備があれば、取得前に修正する
3. **確認結果を明示**: 取得物と一緒に「自己チェック結果」を簡潔に記載する（例: 「✅ リポジトリ情報は git remote から取得、PR 番号は 99_PR.md から取得、CodeRabbit コメントのみを抽出、メタデータを含めて JSON 形式で保存しました」）

---

## 処理手順書・テンプレートへの参照

詳細な処理手順および指摘対応の管理は、以下のドキュメントを参照してください：

- **指摘対応テンプレート**: `.workflow/templates/指摘対応/`（[指摘対応ディレクトリのテンプレート](#指摘対応ディレクトリのテンプレート)を参照）
  - PR 指摘を一覧化・対応方針（採用/見送り/要検討）を記録するときにコピーして利用する。各プロジェクトのワークフロー直下に配置する。
- **処理手順書**（API 取得用）: `.workflow/{YYYYMMDD_HHMMSS_issue_name}/指摘対応/00_処理手順書.md`（存在する場合）
  - リポジトリ情報の取得方法
  - PR 番号の特定方法
  - GitHub API 認証の確認方法
  - コメントとレビューの取得方法
  - CodeRabbit / Copilot 等のコメントのフィルタリング方法
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

### エラー 5: 指摘漏れ（Nitpick が指摘一覧に含まれていない）

**原因**: レビューコメント（インラインコメント）のみを取得しており、レビュー本体（reviews の `body`）を取得・パースしていない。CodeRabbit は Nitpick をレビュー送信時の「レビュー本文」に「🧹 Nitpick comments (1)」のように記載するため、`pulls/{number}/comments` だけでは取得できない。

**対処法**:

1. **レビュー本体を取得する**: `gh api repos/{owner}/{repo}/pulls/{number}/reviews`（CLI）を実行する。
2. **CodeRabbit のレビューを特定する**: `user.login == "coderabbitai[bot]"` のレビューの `body` を参照する。
3. **body をパースする**: 「Nitpick comments」「Minor comments」等の見出しの直後の、ファイルパス・行番号・指摘文を抽出し、指摘一覧（01*指摘一覧 や 00*指摘事項分析結果 等）に追加する。
4. 手元に PR のレビューサマリー（GitHub の画面やメールの「Nitpick comments (1)」一覧）がある場合は、その内容を手動で指摘一覧に追記してもよい。

**遵守**: 上記は [5.5 CodeRabbit の Nitpick 取得漏れ防止（必須対応策）](#55-coderabbit-の-nitpick-取得漏れ防止必須対応策) に従い、今後は**取得時に reviews も取得し body をパースすること**で未然に防ぐ。

---

## 参考資料

### プロジェクトドキュメント

- [`AGENTS_AI_PLAYBOOK.md`](./AGENTS_AI_PLAYBOOK.md) - LLM エージェント運用ルール
- [`AGENTS.md`](./AGENTS.md) - 開発規約の全体像

### 指摘対応テンプレート・処理手順書

- `.workflow/templates/指摘対応/` - 指摘一覧・対応方針用テンプレート（00*README / 01*指摘一覧 / 02\_対応方針）。各プロジェクトで本規約を採用している場合はワークフロー直下に配置する。
- `.workflow/{YYYYMMDD_HHMMSS_issue_name}/指摘対応/00_処理手順書.md` - API 取得の詳細な処理手順（存在する場合）

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
  1. 指摘対応をまとめるときは `.workflow/templates/指摘対応/` をコピーして利用する
  2. 処理手順書（`00_処理手順書.md`）を参照する（API 取得の詳細）
  3. リポジトリ情報は `git remote` から取得する
  4. PR 番号は PR メッセージファイルから取得する
  5. **レビューコメントとレビュー（reviews）の両方**を取得する（Nitpick 漏れ防止のため必須）。レビュー `body` をパースし、「Nitpick comments」等を指摘一覧に含める
  6. CodeRabbit / Copilot など、使用するレビューツールに応じてコメントを抽出する
  7. メタデータを含めて JSON 形式で保存する
  8. それでも悩んだら `.workflow/{issue}/memo/` にメモを残してから検討

---

**最終更新**: 2026 年 2 月 5 日（CodeRabbit Nitpick 取得漏れ防止のため、レビュー本体（reviews の body）の取得・パースを必須対応策として追記。汎用版）
