# PROJECT_POLICY.md — consumer project固有ポリシー（`.agent-skill-chain/project/`）の作り方

## 目的・対象範囲

本成果物は、consumer project が `.agent-skill-chain/project/`（`manifest.yaml` + `RULES.md`、role固有規約が必要な場合のみ `roles/<role>.md`）でプロジェクト固有の追加プロセス規約をどう記述するかを、`init` の散文（AGENTS.md）を読み解かなくても把握できるよう自己完結して説明する。対象は `manifest.yaml` のスキーマ必須フィールドと、`manifest.yaml`・`RULES.md` を組み合わせた最小具体例である。

## 前提・用語

- **manifest.yaml**: `.agent-skill-chain/schemas/project-policy.schema.yaml` で検証される、`.agent-skill-chain/project/` の索引ファイル。ここに登録した文書だけが規範として扱われる（未登録文書はCIが無視する）。
- **RULES.md**: `manifest.yaml` の `documents.common` に登録する、プロジェクト固有の追加規約を自然文で記す文書の一例。ファイル名は固定ではなく、`manifest.yaml` に登録すれば任意の名前・複数ファイルでよい。
- **role**: `spec | design | implementation | validation`。`documents.roles.<role>` に登録した文書は、当該 role のセグメント作業ワーカーにのみ渡る。

## 入力・出力

- **入力**: `agent-skill-chain init`（`--dry-run` 無し）の実行。
- **出力**: `.agent-skill-chain/project/manifest.yaml` が既に存在しない場合のみ、`.agent-skill-chain/project/RULES.md`・`.agent-skill-chain/project/manifest.yaml` の2ファイルが生成される（`manifest.yaml` の存在が「生成済み」の唯一の判定基準）。既に存在する場合は完全に無変更（no-op）。

## `manifest.yaml` の必須フィールド

| フィールド | 内容 |
|---|---|
| `schema_version` | 固定値 `agent-skill-chain/project-policy/v1` |
| `project.id` | プロジェクトを識別する任意の文字列 |
| `project.policy_version` | 1以上の整数。内容変更のたびに増やす運用を推奨 |
| `documents.common` | 全 role 共通で読ませる文書パスの配列（`manifest.yaml` 基点の相対パス） |
| `documents.roles` | role固有の追加文書。`spec`/`design`/`implementation`/`validation` の各キーへパス配列を任意で追加（不要なキーは省略可） |
| `precedence.level` | 固定値 `project` |
| `precedence.overrides` | `package-defaults`・`adapter-defaults` から選ぶ配列 |
| `constraints.may_override_core_invariants` | 固定値 `false`（不変条件は上書き不可） |
| `constraints.unregistered_documents_are_normative` | 固定値 `false`（未登録文書は規範にならない） |

## 最小具体例

`manifest.yaml`:

```yaml
schema_version: agent-skill-chain/project-policy/v1
project:
  id: __PROJECT_ID__
  policy_version: 1
documents:
  common:
    - RULES.md
  roles: {}
precedence:
  level: project
  overrides:
    - package-defaults
    - adapter-defaults
constraints:
  may_override_core_invariants: false
  unregistered_documents_are_normative: false
```

`RULES.md`:

```markdown
# プロジェクト固有の追加規約

## 目的と対象

本規約は、agent-skill-chain の共通規約（AGENTS.md）を補う、このプロジェクト固有の追加プロセス規約を記述する。

## 追加規約（記述例）

- ここにプロジェクト固有の追加ルールを自然文で書く。
```

`init` はこの2ファイルを、`__PROJECT_ID__` を導入先ディレクトリ名へ自動置換した状態でそのまま生成する。`project.id` は導入後にいつでも意味のある値へ書き換えてよい（schema検証は文字列型のみを要求するため、置換結果が空文字列等の意味の薄い値でも検証自体は通る）。

## 制約

- `may_override_core_invariants: false`・`unregistered_documents_are_normative: false` は固定値であり、`.agent-skill-chain/schemas/project-policy.schema.yaml` がこれ以外の値を許容しない。
- `init` が生成する `.agent-skill-chain/project/` 配下のファイルは、`upgrade`（`--dry-run` 無し）を実行しても一切上書き・削除されない（AGENTS.md「プロジェクト固有ポリシー」節が定める不可侵）。
- `uninstall`（`--dry-run` 無し）を実行しても `.agent-skill-chain/project/` 配下は削除されず保持される（同節が定める保持）。
- 上記2点は `init` が新規に `.agent-skill-chain/project/` を生成するようになった後も変更しない既存の不変条件である。

## 完了条件・検証方法

- `agent-skill-chain init`（`--dry-run` 無し）を空のディレクトリに対して実行すると、`.agent-skill-chain/project/manifest.yaml`・`RULES.md` が生成され、`manifest.yaml` が `.agent-skill-chain/schemas/project-policy.schema.yaml` の検証を通ることを自動テストで確認する。
- 既存の `manifest.yaml` を持つディレクトリへ再度 `init` を実行しても内容が変更されないこと、`upgrade`・`uninstall` が `.agent-skill-chain/project/` に触れないことを回帰テストで確認する。

## 未決事項

なし。

## 対象外

- `.agent-skill-chain/project/roles/<role>.md` の雛形・案内（本成果物は `documents.common`（`RULES.md`）と `manifest.yaml` の最小具体例のみを扱う）。
- consumer project が実際にどのような業種・組織固有のルールを書くべきかという内容面のガイダンス。
- `project-policy.schema.yaml` 自体のフィールド追加・変更。
