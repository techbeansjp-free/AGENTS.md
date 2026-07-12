# Contributing — 開発者・自己拡張・メンテナ向けガイド

本リポジトリは仕様パッケージの正本である。拡張・リリースに必要な入口をここに集約する。

## GitHub 直接参照での配備（開発者・自己拡張向け）

`npx` は GitHub リポジトリを直接参照する（`npx github:owner/repo` 記法）。`package.json` の `prepare` フックにより git 経由インストール時に `npm run build` が自動実行され、非追跡（`.gitignore` 対象）の `bin/agents-md.js` が自動生成される。採用先プロジェクトのルートで次を実行する。`init` が内部で `.agent-skill-chain/source/scripts/setup.sh` を呼び、配備一式を行う。

```bash
cd my-project
npx github:techbeansjp-free/AGENTS.md init
```

これで以下が行われる:

- パッケージの `AGENTS.md` と `CLAUDE.md` がプロジェクトルートにコピーされる
- パッケージの `.agent-skill-chain/source/` がプロジェクトの `.agent-skill-chain/source/` にコピーされる
- `.agent-skill-chain/runtime/templates` が無い場合は **`.agent-skill-chain/runtime/templates/`**（パッケージ内）からコピーされる
- `.claude/hooks` と `.cursor/` に enforcement が展開され、スキルが `.claude/skills` と `.cursor/skills` に同期される

npm レジストリを経由しない補助導線である。

## 本リポジトリでテストを回す

本リポジトリ（パッケージ正本／自己拡張）でテストを回す場合は、一括 runner で 1 コマンド実行できる。

```bash
npm test                                  # = bash test/run-all.sh
bash test/run-all.sh                      # npm を使わない場合
```

全テストを順に実行し、末尾サマリ（`合計=N PASS=p FAIL=f SKIP=s`）と終了コード（全成功で 0・1 件以上 FAIL で非 0）を返す。個別実行・前提依存マトリクス（bash/git/node/tar/sqlite3）・SKIP 規約は [.agent-skill-chain/source/SETUP.md](.agent-skill-chain/source/SETUP.md) §テスト実行 を参照。

## リリース（メンテナ向け）

リリースは [.github/workflows/release.yml](.github/workflows/release.yml) が、配布影響パスを含む変更が main へ push（PR レビュー承認済みマージ）されると自動発火し、version bump（patch +1）・日時タグ・GitHub Release 作成 → marketplace 公開 → apm release を直列に実行する。リポジトリ変数 `RELEASE_ENABLED` は緊急停止スイッチ（既定で有効、`false` 設定時のみ停止）。`workflow_dispatch` は緊急時の手動代替。詳細正本は [docs/maintainer/RELEASE.md](docs/maintainer/RELEASE.md)。

## さらに詳しく（詳細正本）

| ファイル | 内容 |
|------|------|
| [docs/maintainer/RELEASE.md](docs/maintainer/RELEASE.md) | リリース詳細正本 |
| [docs/maintainer/adapters.md](docs/maintainer/adapters.md) | Claude/Cursor アダプタ生成 |
| [docs/maintainer/apm-package.md](docs/maintainer/apm-package.md) | apm パッケージ生成 |
| [docs/maintainer/claude-hook-e2e.md](docs/maintainer/claude-hook-e2e.md) | Claude hook E2E 検証 |
