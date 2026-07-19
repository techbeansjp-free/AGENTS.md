# GitHub 用 AI レビュー設定テンプレート

採用先リポジトリで CodeRabbit / GitHub Copilot の指摘対象をそろえるためのテンプレート。

## このテンプレートの配置場所について

**`.agent-skill-chain/runtime/templates/github/` が正しい場所です。**

- AGENTS 規約（`AGENTS.md` の「ファイルテンプレート」）で、GitHub 用テンプレートは **`.agent-skill-chain/runtime/templates/github/`** に置くこととされている。
- CodeRabbit 用はその下の **`coderabbit/`** に格納し、採用先ではリポジトリ**ルート**にコピーして使う（テンプレートは編集用の「元」であり、CodeRabbit が読むのはルートの `.coderabbit.yaml`）。

## レビュー対象外（共通方針）

- **`.agent-skill-chain/runtime/`** … ワークフロー・issue 管理用
- **`.agent-skill-chain/source/`** … AI 向け汎用規約
- **`.agent-skill-chain/project/`** … プロジェクト固有規約

上記はコードレビュー対象外とし、CodeRabbit および GitHub Copilot から指摘が出ないようにする。

## 配置方法

| ツール | 配置先 | コピー元 |
|--------|--------|----------|
| **GitHub Copilot** | 採用先の `.github/` | このフォルダの `copilot-instructions.md` を `.github/copilot-instructions.md` に。`instructions/*.instructions.md` を `.github/instructions/` に。 |
| **CodeRabbit** | 採用先リポジトリ**ルート** | このフォルダの `coderabbit/.coderabbit.yaml` をルートの `.coderabbit.yaml` に。 |
| **CI ワークフロー** | 採用先の `.github/workflows/` | このフォルダの `workflows/ci-check.yml` を `.github/workflows/ci-check.yml` に。プロジェクトに合わせて branches・paths・frontend/backend のパス・Make ターゲット等を変更する。 |
| **enforcement audit CI（最後の砦）** | 採用先の `.github/workflows/` | このフォルダの `workflows/audit.yml` を `.github/workflows/audit.yml` に。`.agent-skill-chain/source/enforcement/ci/audit.sh` を**必須実行**し、失敗で CI を fail させる。 |
| **監査サマリスクリプト** | 採用先の `.github/scripts/` | このフォルダの `scripts/audit-table.ts` を `.github/scripts/audit-table.ts` に。CI で pnpm audit / pip-audit の結果を Step Summary に出す場合に使用。環境変数 `AUDIT_LABEL`・`AUDIT_JSON_PATH`・`AUDIT_FORMAT` で制御。 |
| **pre-push フック** | 採用先の **`scripts/`**（リポジトリルート） | このフォルダの `scripts/pre-push` を `scripts/pre-push` に。必要なら `scripts/pre-push.conf.example` を `scripts/pre-push.conf` にコピーして編集。フック設置は `make setup-hooks` 等で行う。 |

## pre-push フック

- プッシュ対象の変更パスに応じてスコープ（docs_only / infra_only / backend_only / frontend_only / full）を判定し、`make test`・`make test-backend`・`make test-frontend` のいずれかを実行する。docs_only・infra_only のときはコード検証をスキップする。失敗時は push を中止。
- **判定ロジック**: 1 ファイル 1 スコープに分類（`classify_one`）してからマージする方式。パス一覧を明示して保守しやすくし、backend＋docs＋.gitignore 等の変更で意図しない full にならないようにしている。
- 環境変数または `scripts/pre-push.conf`（`.pre-push.conf`）で、バックエンド/フロントエンドのパス接頭辞（`PREPUSH_BACKEND_DIR`・`PREPUSH_FRONTEND_DIR`）と Make ターゲット（`PREPUSH_MAKE_FULL`・`PREPUSH_MAKE_BACKEND`・`PREPUSH_MAKE_FRONTEND`）を上書きできる。`packages/backend` のような構成にも対応可能。
- タイムアウトは `PREPUSH_TIMEOUT_SEC`（既定 900 秒）。テスト用に `PREPUSH_TEST_PATHS` でファイルを指定するとスコープのみ表示して終了する。

## CI と監査スクリプト

- `workflows/ci-check.yml` は変更パスに応じて frontend / backend を分岐し、format-check・lint・typecheck・テストに加え、セキュリティ監査（pnpm audit / pip-audit）の結果を Step Summary に出す。
- 監査結果の表示には `scripts/audit-table.ts` を使用する。CI 内では `npx tsx .github/scripts/audit-table.ts` で実行し、`AUDIT_LABEL`・`AUDIT_JSON_PATH`・`AUDIT_FORMAT`（`pip`|`pnpm`）を設定する。フロントのみ・バックのみの構成でも、該当ジョブ内で同じスクリプトを呼べばよい。
- **採用時の注意**: (1) フロントでは **pnpm を setup-node より先**にセットアップすること（`pnpm/action-setup` → `actions/setup-node` の順）。逆順だと `cache: 'pnpm'` 実行時に pnpm 未導入で失敗する。(2) バックエンドのテストで必須の環境変数（Pydantic Settings 等）がある場合は、`backend-check` ジョブに `env` を追加して CI 用のダミー値を設定すること。(3) バックエンドで再現ビルドしたい場合は `backend` で `uv lock` を実行し `uv.lock` をコミットすること。CI は `uv.lock` があれば `uv lock --check` と `uv sync --locked` を使用する。

## enforcement audit / subagent-guard の棲み分け

- **`workflows/audit.yml`（最後の砦）**: `.agent-skill-chain/source/enforcement/ci/audit.sh` を**必須実行**し、証跡・順序・整合性違反を exit 非 0 で fail させる。全ツール共通の最終強制層（強制力の正本は `.agent-skill-chain/source/enforcement/README.md` §ツール別強制力マトリクス）を CI で確実に効かせたい場合に採用する。
- **`workflows/subagent-guard.yml`（guard ＋ optional audit）**: subagent-guard（内部参照禁止・ログ frontmatter 禁止・`logs/` 廃止）を主とし、audit は任意ステップとして呼ぶ。
- 両者は役割が異なるため**併用可**。audit を確実に効かせたい場合は `audit.yml`、guard 中心なら `subagent-guard.yml` を採用する。

## 参照

- Copilot: `.agent-skill-chain/source/GitHub_Copilot対応.md`
- CodeRabbit: `.agent-skill-chain/source/GitHub_CodeRabbit対応.md` および `coderabbit/README.md`、[Configuration YAML](https://docs.coderabbit.com/reference/configuration-yaml)
