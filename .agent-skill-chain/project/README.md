# project policy

`.agent-skill-chain/project/` は、このリポジトリ自身を開発するときだけに適用する追加ポリシーの置き場である。規範として有効な文書は [`manifest.yaml`](manifest.yaml) に登録されたものに限る。登録されていない文書は履歴・参考情報であり、作業判断の根拠にはしない。

共通の不変条件、4 セグメント、writer lease、branch/worktree、ゲートは [AGENTS.md](../../AGENTS.md) が定める。このディレクトリはそれらを上書きしない。

## 読み方

1. `manifest.yaml` をスキーマで検証する。
2. `documents.common` の順に文書を読む。
3. role 固有文書が登録されていれば、その role の文書だけを追加で読む。

common 文書の一覧は本 README では再掲せず、`manifest.yaml` の `documents.common` を正とする（二重管理による陳腐化を避けるため）。`COVERAGE_EXCEPTIONS.md` は旧運用の参考記録であり、`documents.common` に登録しない。
