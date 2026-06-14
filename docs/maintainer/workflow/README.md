# 自己拡張ワークフロー（保守者向け・git 追跡対象）

このディレクトリは、本パッケージ自身を自己拡張（ドッグフーディング）する際の **issue を保管する開発記録**である。

- **なぜ `.workflow/` ではないのか**: ルートの `.workflow/` は「本パッケージを採用した消費者プロジェクトのランタイム名前空間」であり、`.gitignore` で追跡対象外（テンプレート `templates/` のみ正本として追跡）。自己拡張の issue をそこに作ると、パッケージ正本の git にランタイム生成物が混入してしまう（＝二重管理・配布物汚染）。
- **このディレクトリの位置づけ**: `docs/maintainer/` は配布に含めない保守用文書の置き場（`.agents/SETUP.md` 参照）。自己拡張 issue はここに置くことで **git で履歴として残しつつ、消費者ランタイムと分離**できる。

## 作成場所

- **単一 issue**: `docs/maintainer/workflow/<timestamp>_<title>/`
- **サブ issue**（PR 指摘対応等）: `docs/maintainer/workflow/{parent}/90_issues/{ディレクトリ名}/`

`<timestamp>` は JST（例: `TZ=Asia/Tokyo date +%Y%m%d_%H%M%S`）。ファイルセット（`00_要求定義.md` 等）は `.workflow/templates/` の標準テンプレートに従う。

正本ルール: [.agents-project/自己拡張ワークフロー.md](../../../.agents-project/自己拡張ワークフロー.md)
