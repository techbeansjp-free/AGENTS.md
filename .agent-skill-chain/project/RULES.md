# 自己拡張の project rules

## 目的と対象

本規約は `techbeansjp-free/AGENTS.md` 自身を変更する作業だけに適用する。共通規約は AGENTS.md、実行可能な正本アセットは `.agent-skill-chain/`、調整状態は GitHub Issue・branch・PR・Check Run である。

## 追加規約

- GitHub Issue ごとに専用 branch と worktree を使い、branch 上の `SPEC.md`、`DESIGN.md`、`PLAN.md`、`VALIDATION.md` を Git で追跡する。
- 4 成果物は各セグメントの checkpoint で commit・push する。GitHub Issue 本文と PR 本文の `Closes #<id>` は調整状態の恒久証跡であり、作業メモの代替ではない。
- `.agent-skill-chain/project/manifest.yaml` に登録されていない project 文書は規範として読まない。追加・削除時は manifest と検証を同じ変更で更新する。
- 作業固有の一時メモ、ローカル依存、生成済み CLI は Git で追跡しない。`.gitignore` が無視対象の唯一の判断基準である。

## 対象外

- consumer project の project policy をこのリポジトリへ取り込むこと。
- GitHub Coordination Backend の外に Issue、PR、ゲート状態の複製を作ること。
