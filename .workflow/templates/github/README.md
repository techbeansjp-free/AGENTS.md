# GitHub 用 AI レビュー設定テンプレート

採用先リポジトリで CodeRabbit / GitHub Copilot の指摘対象をそろえるためのテンプレート。

## このテンプレートの配置場所について

**`.workflow/templates/github/` が正しい場所です。**

- AGENTS 規約（`AGENTS.md` の「ファイルテンプレート」）で、GitHub 用テンプレートは **`.workflow/templates/github/`** に置くこととされている。
- CodeRabbit 用はその下の **`coderabbit/`** に格納し、採用先ではリポジトリ**ルート**にコピーして使う（テンプレートは編集用の「元」であり、CodeRabbit が読むのはルートの `.coderabbit.yaml`）。

## レビュー対象外（共通方針）

- **`.workflow/`** … ワークフロー・issue 管理用
- **`.agents/`** … AI 向け汎用規約
- **`.agents-project/`** … プロジェクト固有規約

上記はコードレビュー対象外とし、CodeRabbit および GitHub Copilot から指摘が出ないようにする。

## 配置方法

| ツール | 配置先 | コピー元 |
|--------|--------|----------|
| **GitHub Copilot** | 採用先の `.github/` | このフォルダの `copilot-instructions.md` を `.github/copilot-instructions.md` に。`instructions/*.instructions.md` を `.github/instructions/` に。 |
| **CodeRabbit** | 採用先リポジトリ**ルート** | このフォルダの `coderabbit/.coderabbit.yaml` をルートの `.coderabbit.yaml` に。 |

## 参照

- Copilot: `.agents/GitHub_Copilot対応.md`
- CodeRabbit: `.agents/GitHub_CodeRabbit対応.md` および `coderabbit/README.md`、[Configuration YAML](https://docs.coderabbit.com/reference/configuration-yaml)
