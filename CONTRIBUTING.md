# Contributing

本リポジトリは `agent-skill-chain` パッケージ（CLI + AGENTS.md 憲法 + 配布テンプレート）の正本である。運用規律そのものは [AGENTS.md](AGENTS.md) が正本であり、本リポジトリの開発自体も AGENTS.md の I1〜I8（追跡可能性・フェーズゲート・耐久性・分離・進行役の純粋性・正準モデル・仕様⇔検証の追跡・安全側ラチェット）に従う。本ファイルはパッケージ本体（CLI 実装）の開発手順に限定する。

## 開発環境

```bash
npm install
npm run build       # src/ (TypeScript) → bin/ (gitignore対象のビルド生成物)
npm test            # node --import tsx --test でtest/unit・test/integrationを実行
npm run typecheck   # tsconfig.test.json でsrc/・test/双方を型検査
```

Node.js 20 以上が必要（`package.json` `engines.node`）。

## リポジトリ構成

```
src/agents-md.ts     # CLIエントリポイント（サブコマンドのルーティングのみ）
src/commands/        # サブコマンド実装（issue.ts, lease.ts, gate.ts 等）
src/lib/             # 共有ロジック（yaml-io, schema, worktree, github-lease 等）
test/unit/           # src/lib/ の単体テスト（1モジュール1ファイル対応）
test/integration/    # bin/agents-md.js をsubprocess実行するCLI結合テスト
test/helpers/        # tmp-repo（一時repo構築）, cli（subprocess実行）, gh-stub（ghコマンド偽装）
.agent-skill-chain/  # 配布される正本アセット（standards/templates/schemas/config/adapters/scripts/ci）
```

`bin/` はビルド生成物であり Git 管理対象外（`.gitignore`）。ソースを変更したら `src/` を編集する。

## サブコマンドを追加する

1. `src/commands/<name>.ts` に実装を追加する（既存コマンドと同様、`guard`/`isHelp`/`printUsage` 等 `src/lib/cli-io.ts` の共通ヘルパーに従う）。
2. `src/agents-md.ts` の `routes` に `'<command> <subcommand>': handler` を登録する。
3. `test/unit/` に純粋ロジックの単体テスト、`test/integration/` に `bin/agents-md.js` を subprocess 実行する結合テストを追加する（既存の `test/integration/*.test.ts` を参考にする）。
4. 配布物（`.agent-skill-chain/scripts/*.sh` または `ci/*.sh`）が対応する場合は、そのスクリプトを新コマンドへの薄いラッパーとして揃える。

## テスト方針

型ファースト（TypeScript）。`node:test` + `tsx` を使用し、追加の実行時依存は増やさない。CLI 結合テストは実際に `bin/agents-md.js` をビルド後 subprocess として起動し、GitHub API 呼び出しは `test/helpers/gh-stub.ts` の偽 `gh` コマンドで差し替える（本物の GitHub へは到達しない）。

## ブランチ・worktree・PR

このリポジトリ自身の開発も [AGENTS.md §ブランチ・worktree](AGENTS.md) の規約（`<type>/<issue-id>-<slug>` ブランチ、`.worktrees/<issue起票日時>-<type>-<issue-id>-<slug>/` worktree、1 Issue = 1 ブランチ = 1 worktree = 1 PR）に従う。worktree の削除は `rm -rf` ではなく `.agent-skill-chain/scripts/cleanup.sh`（または `agent-skill-chain cleanup`）経由で行う。

## 実装状況の既知の制約

`.agent-skill-chain/adapters/{claude,codex,human}.sh` は現時点でベンダー中立 role contract のインターフェーススタブであり、各関数はプレースホルダとして明示的に失敗する（サイレント成功を避けるため）。実処理は対応する `.agent-skill-chain/scripts/*.sh` を呼び出す形で今後実装する。

## ライセンス

コントリビュートしたコードは本リポジトリの [LICENSE](LICENSE)（MIT）の下でライセンスされる。
