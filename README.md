# agent-skill-chain

Coordination Backend（GitHub の Issue・PR・Check Run、またはローカルの Git 管理下状態）を正本とする、ソフトウェア開発ワークフロー規律のための agentic constitution + CLI パッケージ。思想・不変条件・全ルールの正本は [AGENTS.md](AGENTS.md)。本 README は導入・CLI 操作の手引きに徹し、規律の内容は重複記載しない。実際の動作フロー・シーケンス・コンポーネント構成・状態遷移を図で見たい場合は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、用語・定義・禁止同義語の一覧は [docs/GLOSSARY.md](docs/GLOSSARY.md)、AI が関わる CI/CD がどこを目指すかの構想は [docs/AI_CI_CD_VISION.md](docs/AI_CI_CD_VISION.md) を参照。

## インストール・導入

対象リポジトリのルートで実行する。npm レジストリを経由せず GitHub を直接参照する。

```bash
npx github:techbeansjp-free/AGENTS.md init
```

版を固定する場合は git ref を指定する。

```bash
npx github:techbeansjp-free/AGENTS.md#<tag-or-branch> init
```

`init` は `AGENTS.md`・`CLAUDE.md`・`docs/GLOSSARY.md` をルート直下へ、`standards/templates/schemas/config/adapters/scripts/ci/hooks` を `.agent-skill-chain/` 配下へローカルファイル操作だけで導入する。`.github/` は変更しないため、インストールしただけでGitHub Actionsが追加・更新されることはない。衝突するファイルがある場合は上書きせず日本語の理由付きエラーで停止する。`--dry-run` で実ファイルを書き込まずに導入予定一覧を確認できる。GitHub 側（`.github/` ワークフロー同期・ラベル・branch ruleset）を有効にする場合だけ、続けて次を明示実行する（認証済みの `gh` CLI と対象リポジトリの GitHub remote、または `--repo`/`owner/repo` 引数が必要）。

```bash
npx github:techbeansjp-free/AGENTS.md setup github   # .github同期 + ラベル + ruleset をまとめて実行
npx github:techbeansjp-free/AGENTS.md setup labels [owner/repo]    # ラベルのみ
npx github:techbeansjp-free/AGENTS.md setup ruleset [owner/repo]   # rulesetのみ
```

導入後の更新・撤去には `upgrade`/`uninstall` を使う。

```bash
npx github:techbeansjp-free/AGENTS.md upgrade [target_dir] [--dry-run]     # 正本アセットを更新（project/・展開済み.github/は不可侵）
npx github:techbeansjp-free/AGENTS.md uninstall [target_dir] [--dry-run]  # 安全確認（未commit差分なし・残存worktreeなし）を経て撤去（project/は保持）
```

`setup`（引数なし）はローカル資産だけを導入する非推奨エイリアスとして残置している（実行時にstderrへ非推奨警告を出す）。`setup` と `upgrade` は `.github/` を暗黙変更しない。GitHub連携の追加・更新は `setup github` だけが行う。GitHub Issue/PR/Check Run を使わないローカルモード（`coordination.backend: local`）では `init` のみで導入が完結する。

`enforce on`/`enforce off` は `.claude/settings.json` へ PreToolUse hook を配線/非配線する。配線されるhookは `tool_name=="Bash"` のコマンド文字列のみを検査し、`git worktree remove` の直接実行と命名規約違反のブランチ作成のみを拒否する狭い安全網であり、Agent/Task 等の非Bashツール呼び出しは対象外（拒否されない）。詳細・設計根拠は [AGENTS.md §不変条件](AGENTS.md) を参照。

## CLI コマンド一覧

パッケージ名・bin 名はいずれも `agent-skill-chain`。`agent-skill-chain <command> [subcommand] -h` で各コマンドの使い方を表示する。

| 分類 | コマンド |
|------|----------|
| ライフサイクル | `init [target_dir] [--dry-run]`, `upgrade [target_dir] [--dry-run]`, `uninstall [target_dir] [--dry-run]` |
| enforce | `enforce on [target_dir]`, `enforce off [target_dir]` |
| セットアップ（GitHub側・非推奨エイリアス含む） | `setup [target_dir]`（非推奨）, `setup github [target_dir]`, `setup labels [owner/repo]`, `setup ruleset [owner/repo]`, `sync templates` |
| Issue・worktree | `issue start`, `issue resume`, `checkpoint`, `cleanup` |
| writer lease | `lease acquire`, `lease release`, `lease renew` |
| セグメント・ゲート | `segment start`, `gate review`, `gate publish`, `gate reconcile` |
| PR・ADR | `pr create`, `adr finalize` |
| lint | `lint vocab`, `lint references`, `lint adr` |
| verify（CI 検査） | `verify ac-coverage`, `verify adr`, `verify artifacts`, `verify branch-name`, `verify doc-length`, `verify gate-report`, `verify template-sync`, `verify worktree-path` |
| 運用 | `doctor`, `reconcile` |

各コマンドの役割は [AGENTS.md](AGENTS.md) の該当セクション（不変条件・4 セグメント・writer lease・ゲートの継承・GitHub 配布）に対応する。個別の入出力仕様はコマンド自身の `-h` を正本とする。

## 設定

初期値は配備先の `.agent-skill-chain/config/agent-skill-chain.yaml`。`coordination.backend`（`github` | `local`）でバックエンドを切り替える。プロジェクト固有の追加ルールは `.agent-skill-chain/project/`（`manifest.yaml` + `RULES.md`）に置く。全設定項目の既定値・取りうる値・影響は [docs/CONFIGURATION.md](docs/CONFIGURATION.md) に一覧化している。詳細な規約は [AGENTS.md §設定](AGENTS.md) および [AGENTS.md §プロジェクト固有ポリシー](AGENTS.md)。

### 自走・承認ポリシー

既定では、次の2箇所で人間の明示的な確認を要求する。

- 実装セグメントの着手（`segment start <issue_id> implementation`、`.agent-skill-chain/scripts/worker-launch.sh` 経由の全アダプタが対象）
- PRマージの実行（`agent-skill-chain pr merge`）

いずれも、確認を得ずに実行しようとすると日本語のエラーメッセージで停止する。運用上の経路は2つある。

1. **その場限りの許可**: セッション中に人間が「自走して」等、明示的にその作業の続行を指示した場合、エージェントは設定ファイルを書き換えずにその場の許可として従ってよい。
2. **恒久的な自走への opt-in**: 複数 Issue・複数 PR にわたり毎回の確認を省略したい場合のみ、`.agent-skill-chain/config/agent-skill-chain.yaml` の該当フラグを明示的に変更する。

```yaml
# 実装セグメント着手前の人間確認を省略する（既定 true＝要求する）
human_confirmation:
  before_implementation: false

# PRマージ（agent-skill-chain pr merge コマンド自体）の自動実行を許可する（既定 false＝拒否する）
merge:
  autonomous: true
```

設計根拠（`autonomy: gated | full` との違い、安全側ラチェットI8等）は [AGENTS.md](AGENTS.md) を参照。

## 開発に参加する

このリポジトリ自身の開発（CLI 本体の実装・テスト）については [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

## ライセンス

MIT
