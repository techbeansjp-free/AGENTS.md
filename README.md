# agent-skill-chain

Coordination Backend（GitHub の Issue・PR・Check Run、またはローカルの Git 管理下状態）を正本とする、ソフトウェア開発ワークフロー規律のための agentic constitution + CLI パッケージ。思想・不変条件・全ルールの正本は [AGENTS.md](AGENTS.md)。本 README は導入・CLI 操作の手引きに徹し、規律の内容は重複記載しない。

## インストール・導入

対象リポジトリのルートで実行する。npm レジストリを経由せず GitHub を直接参照する。

```bash
npx github:techbeansjp-free/AGENTS.md setup
```

版を固定する場合は git ref を指定する。

```bash
npx github:techbeansjp-free/AGENTS.md#<tag-or-branch> setup
```

`setup` は `AGENTS.md`・`CLAUDE.md`・`docs/GLOSSARY.md` をルート直下へ、`standards/templates/schemas/config/adapters/scripts/ci` を `.agent-skill-chain/` 配下へ配置したうえで、続けて `.github/` ワークフロー一式の同期・ラベル（`type:*` 等）・branch ruleset（`main` 保護・4 ゲートの required status checks）の適用まで一括で行う（衝突するファイルがある場合は上書きせず日本語の理由付きエラーで停止する）。ラベル・ruleset の適用には認証済みの `gh` CLI と対象リポジトリの GitHub remote（または `--repo`/`owner/repo` 引数）が必要。

`.github/` 同期・ラベル・ruleset の適用だけを単体で再実行したい場合（テンプレート更新後の再同期など）は次を使う。

```bash
npx github:techbeansjp-free/AGENTS.md setup github   # 3つまとめて再実行
npx github:techbeansjp-free/AGENTS.md setup labels [owner/repo]    # ラベルのみ
npx github:techbeansjp-free/AGENTS.md setup ruleset [owner/repo]   # rulesetのみ
```

GitHub Issue/PR/Check Run を使わないローカルモード（`coordination.backend: local`）では GitHub 側の適用は不要だが、現状 `setup` は無条件に GitHub 適用まで行うため、`gh` 未認証・remote 未設定の環境では `setup` 自体が失敗する。

## CLI コマンド一覧

パッケージ名・bin 名はいずれも `agent-skill-chain`。`agent-skill-chain <command> [subcommand] -h` で各コマンドの使い方を表示する。

| 分類 | コマンド |
|------|----------|
| セットアップ | `setup [target_dir]`, `setup github [target_dir]`, `setup labels [owner/repo]`, `setup ruleset [owner/repo]`, `sync templates` |
| Issue・worktree | `issue start`, `issue resume`, `checkpoint`, `cleanup` |
| writer lease | `lease acquire`, `lease release`, `lease renew` |
| セグメント・ゲート | `segment start`, `gate review`, `gate publish`, `gate reconcile` |
| PR・ADR | `pr create`, `adr finalize` |
| lint | `lint vocab`, `lint references`, `lint adr` |
| verify（CI 検査） | `verify ac-coverage`, `verify adr`, `verify artifacts`, `verify branch-name`, `verify doc-length`, `verify gate-report`, `verify template-sync`, `verify worktree-path` |
| 運用 | `doctor`, `reconcile` |

各コマンドの役割は [AGENTS.md](AGENTS.md) の該当セクション（不変条件・4 セグメント・writer lease・ゲートの継承・GitHub 配布）に対応する。個別の入出力仕様はコマンド自身の `-h` を正本とする。

## 設定

初期値は配備先の `.agent-skill-chain/config/agent-skill-chain.yaml`。`coordination.backend`（`github` | `local`）でバックエンドを切り替える。プロジェクト固有の追加ルールは `.agent-skill-chain/project/`（`manifest.yaml` + `RULES.md`）に置く。詳細は [AGENTS.md §設定](AGENTS.md) および [AGENTS.md §プロジェクト固有ポリシー](AGENTS.md)。

## 開発に参加する

このリポジトリ自身の開発（CLI 本体の実装・テスト）については [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

## ライセンス

MIT
