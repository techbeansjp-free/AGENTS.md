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
| **CI ワークフロー** | 採用先の `.github/workflows/` | このフォルダの `workflows/ci-check.yml` を `.github/workflows/ci-check.yml` に。プロジェクトに合わせて branches・paths・frontend/backend のパス・Make ターゲット等を変更する。 |
| **監査サマリスクリプト** | 採用先の `.github/scripts/` | このフォルダの `scripts/audit-table.ts` を `.github/scripts/audit-table.ts` に。CI で pnpm audit / pip-audit の結果を Step Summary に出す場合に使用。環境変数 `AUDIT_LABEL`・`AUDIT_JSON_PATH`・`AUDIT_FORMAT` で制御。 |
| **pre-push フック** | 採用先の **`scripts/`**（リポジトリルート） | このフォルダの `scripts/pre-push` を `scripts/pre-push` に。必要なら `scripts/pre-push.conf.example` を `scripts/pre-push.conf` にコピーして編集。フック設置は `make setup-hooks` 等で行う。 |

## pre-push フック

- プッシュ対象の変更パスに応じてスコープ（docs_only / backend_only / frontend_only / full）を判定し、`make test`・`make test-backend`・`make test-frontend` のいずれかを実行する。失敗時は push を中止。
- 環境変数または `scripts/pre-push.conf`（`.pre-push.conf`）で、バックエンド/フロントエンドのパス接頭辞（`PREPUSH_BACKEND_DIR`・`PREPUSH_FRONTEND_DIR`）と Make ターゲット（`PREPUSH_MAKE_FULL`・`PREPUSH_MAKE_BACKEND`・`PREPUSH_MAKE_FRONTEND`）を上書きできる。`packages/backend` のような構成にも対応可能。
- タイムアウトは `PREPUSH_TIMEOUT_SEC`（既定 900 秒）。テスト用に `PREPUSH_TEST_PATHS` でファイルを指定するとスコープのみ表示して終了する。

## CI と監査スクリプト

- `workflows/ci-check.yml` は変更パスに応じて frontend / backend を分岐し、format-check・lint・typecheck・テストに加え、セキュリティ監査（pnpm audit / pip-audit）の結果を Step Summary に出す。
- 監査結果の表示には `scripts/audit-table.ts` を使用する。CI 内では `npx tsx .github/scripts/audit-table.ts` で実行し、`AUDIT_LABEL`・`AUDIT_JSON_PATH`・`AUDIT_FORMAT`（`pip`|`pnpm`）を設定する。フロントのみ・バックのみの構成でも、該当ジョブ内で同じスクリプトを呼べばよい。

## 参照

- Copilot: `.agents/GitHub_Copilot対応.md`
- CodeRabbit: `.agents/GitHub_CodeRabbit対応.md` および `coderabbit/README.md`、[Configuration YAML](https://docs.coderabbit.com/reference/configuration-yaml)
