# GitHub_CodeRabbit対応 - CodeRabbit レビュー対象外設定

> `.workflow/`・`.agents/`・`.agents-project/` を CodeRabbit のレビュー対象外にし、指摘が出ないようにするための設定。  
> **サブエージェント運用時**: CodeRabbit 設定タスクを委譲された worker が本ルールを参照する。

---

## 方針

- **レビュー対象外**: 上記3ディレクトリは AI 向け規約・ワークフロー管理用のため、CodeRabbit の PR レビュー対象から除外する。
- **設定ファイル**: リポジトリルートの `.coderabbit.yaml` で `reviews.path_filters` により除外する。

---

## 設定例（リポジトリルートの .coderabbit.yaml）

```yaml
# 応答言語（日本語）
language: "ja"

reviews:
  path_filters:
    - "!.workflow/**"
    - "!.agents/**"
    - "!.agents-project/**"
  path_instructions:
    - path: "**"
      instructions: |
        コードレビュー、チャット、PR コメント、**Issue の作成・更新**は常に**日本語**で行ってください。
```

- **応答言語（日本語）**: リポジトリの `.coderabbit.yaml` で次のように指定する。(1) トップレベルに `language: "ja"` を追加。(2) `reviews.path_instructions` で全パス（`**`）に「常に日本語で」と指示する。ダッシュボードで言語を設定してもよい。
- 公式のキー名・記法（`path_filters` 等）は [Configuration YAML](https://docs.coderabbit.com/reference/configuration-yaml) で確認し、変更されている場合は合わせて修正すること。

---

## テンプレート

- **配置**: `.workflow/templates/github/coderabbit/` にテンプレートを用意している。
- **採用先**: 同フォルダの `.coderabbit.yaml` をリポジトリルートにコピーして使用する。詳細は `.workflow/templates/github/coderabbit/README.md` を参照。

---

## 関連

- GitHub Copilot で同じパスをレビュー対象外にする: `.agents/GitHub_Copilot対応.md` および `.workflow/templates/github/instructions/no-review-workflow-agents.instructions.md`
- PR 指摘の取得（CodeRabbit コメントの抽出）: `.agents/GitHub_PR指摘取得.md`
