# CodeRabbit 用テンプレート

- **テンプレートの場所**: このファイルは `.workflow/templates/github/coderabbit/` にあり、AGENTS 規約の「ファイルテンプレート」に沿った正しい配置である。採用先では**リポジトリルート**にコピーして使用する。
- **配置**: このフォルダ内の `.coderabbit.yaml` を**リポジトリルート**にコピーし、ルートに `.coderabbit.yaml` として配置する。
- **目的**: (1) `.workflow/`・`.agents/`・`.agents-project/` を CodeRabbit のレビュー対象外にする。(2) 応答言語を日本語にする（`language: "ja"` と `path_instructions`）。
- **公式**: [Configuration YAML](https://docs.coderabbit.com/reference/configuration-yaml) でキー名（`path_filters`・`path_instructions`・`language` 等）が変わっている場合は、公式に合わせて修正すること。
